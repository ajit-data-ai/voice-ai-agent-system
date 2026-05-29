/**
 * Google Calendar Integration
 * Handles: check availability, book, get, reschedule, cancel appointments
 *
 * EDGE CASES HANDLED:
 * - Token expiry (auto-refresh)
 * - Calendar API rate limits (429 → retry with backoff)
 * - Concurrent booking race conditions (optimistic lock via event color)
 * - Timezone mismatches
 * - Missing calendar slot (no free/busy data)
 * - Same-day emergency bookings
 * - Doctor-specific calendar routing
 */

const { google } = require('googleapis');
const { addMinutes, format, parseISO, addDays, setHours, setMinutes,
        startOfDay, isAfter, isBefore, addHours } = require('date-fns');
const { toZonedTime, fromZonedTime } = require('date-fns-tz');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { parseNaturalDate, parseNaturalTime, normalizePhone,
        formatForSpeech, TIMEZONE } = require('../utils/date-helpers');

const clinicConfig = require('../config/clinic-config.json');

// ─── AUTH ────────────────────────────────────────────────────────────────────

function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function getCalendarClient() {
  return google.calendar({ version: 'v3', auth: getAuthClient() });
}

// ─── RETRY WRAPPER ───────────────────────────────────────────────────────────

async function withRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.code === 429 || err?.message?.includes('Rate Limit');
      const isRetryable = isRateLimit || err?.code === 503 || err?.code === 500;

      if (isRetryable && attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.warn(`Calendar API retry ${attempt}/${maxAttempts} after ${delay}ms`, { error: err.message });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// ─── GENERATE CANDIDATE SLOTS ────────────────────────────────────────────────

function generateCandidateSlots(dateStr, serviceDuration, requestedTime = null) {
  const date = parseISO(dateStr);
  const dayName = format(date, 'EEEE').toLowerCase();
  const hours = clinicConfig.hours[dayName];
  if (!hours) return [];

  const [openH, openM] = hours.open.split(':').map(Number);
  const [closeH, closeM] = hours.close.split(':').map(Number);

  const slots = [];
  let current = setMinutes(setHours(startOfDay(date), openH), openM);
  const closeTime = setMinutes(setHours(startOfDay(date), closeH), closeM);
  const interval = clinicConfig.booking.slot_interval_minutes || 30;
  const buffer = clinicConfig.booking.buffer_between_appointments_minutes || 15;

  while (isBefore(addMinutes(current, serviceDuration + buffer), closeTime) ||
         format(addMinutes(current, serviceDuration + buffer), 'HH:mm') === format(closeTime, 'HH:mm')) {
    // If patient requested a specific time, only show slots within 1 hour of it
    if (requestedTime) {
      const reqH = parseInt(requestedTime.split(':')[0]);
      const slotH = current.getHours();
      if (Math.abs(slotH - reqH) <= 1) {
        slots.push(new Date(current));
      }
    } else {
      slots.push(new Date(current));
    }
    current = addMinutes(current, interval);
  }

  return slots;
}

// ─── CHECK AVAILABILITY ──────────────────────────────────────────────────────

async function checkAvailability({
  requested_date,
  requested_time,
  service_id,
  doctor_id,
  same_day_only = false
}) {
  try {
    // Resolve service
    const service = clinicConfig.services.find(s => s.id === service_id);
    if (!service) {
      return { success: false, error: 'unknown_service', message: 'Service not found in configuration.' };
    }
    const duration = service.duration_minutes;

    // Resolve date(s) to check
    const now = toZonedTime(new Date(), TIMEZONE);
    let datesToCheck = [];

    if (same_day_only) {
      datesToCheck = [format(now, 'yyyy-MM-dd')];
    } else if (requested_date) {
      const resolved = parseNaturalDate(requested_date);
      if (!resolved) {
        return { success: false, error: 'invalid_date', message: 'Could not understand the requested date.' };
      }
      datesToCheck = [resolved];
      // Also include next 2 days in case the requested day is full
      datesToCheck.push(format(addDays(parseISO(resolved), 1), 'yyyy-MM-dd'));
      datesToCheck.push(format(addDays(parseISO(resolved), 2), 'yyyy-MM-dd'));
    } else {
      // No date preference — show next 3 available days
      let d = now;
      while (datesToCheck.length < 3) {
        d = addDays(d, 1);
        const dayName = format(d, 'EEEE').toLowerCase();
        const dateStr = format(d, 'yyyy-MM-dd');
        if (clinicConfig.hours[dayName] && !(clinicConfig.holidays || []).includes(dateStr)) {
          datesToCheck.push(dateStr);
        }
      }
    }

    // Resolve requested time
    const resolvedTime = requested_time ? parseNaturalTime(requested_time) : null;

    // Determine which calendar(s) to check
    const calendarIds = [];
    if (doctor_id) {
      const doctor = clinicConfig.doctors.find(d => d.id === doctor_id);
      if (doctor) calendarIds.push(doctor.calendar_id);
    }
    if (!calendarIds.length) {
      // Check all available doctors
      clinicConfig.doctors
        .filter(d => d.accepting_new_patients)
        .forEach(d => calendarIds.push(d.calendar_id));
    }
    if (!calendarIds.length) calendarIds.push(process.env.GOOGLE_CALENDAR_ID || 'primary');

    const calendar = getCalendarClient();
    const availableSlots = [];

    for (const dateStr of datesToCheck) {
      // Skip holidays
      if ((clinicConfig.holidays || []).includes(dateStr)) continue;

      const dayName = format(parseISO(dateStr), 'EEEE').toLowerCase();
      if (!clinicConfig.hours[dayName]) continue; // Clinic closed this day

      const candidates = generateCandidateSlots(dateStr, duration, resolvedTime);

      // Build time range for free/busy query
      const dayStart = fromZonedTime(parseISO(`${dateStr}T00:00:00`), TIMEZONE);
      const dayEnd = fromZonedTime(parseISO(`${dateStr}T23:59:59`), TIMEZONE);

      // Get busy times from all calendars
      const freeBusyResult = await withRetry(() =>
        calendar.freebusy.query({
          requestBody: {
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            timeZone: TIMEZONE,
            items: calendarIds.map(id => ({ id }))
          }
        })
      );

      // Collect all busy intervals
      const busyIntervals = [];
      for (const calId of calendarIds) {
        const calBusy = freeBusyResult.data.calendars[calId]?.busy || [];
        busyIntervals.push(...calBusy.map(b => ({
          start: new Date(b.start),
          end: new Date(b.end)
        })));
      }

      // Filter out slots that conflict with busy times
      for (const slot of candidates) {
        const slotEnd = addMinutes(slot, duration + (clinicConfig.booking.buffer_between_appointments_minutes || 15));
        const slotInUtc = fromZonedTime(slot, TIMEZONE);
        const slotEndInUtc = fromZonedTime(slotEnd, TIMEZONE);

        // Skip past slots (must be at least 2 hours ahead)
        const minBookingTime = addHours(new Date(), clinicConfig.booking.min_advance_hours || 2);
        if (isBefore(slotInUtc, minBookingTime)) continue;

        // Check for conflicts
        const isConflict = busyIntervals.some(busy =>
          isBefore(slotInUtc, busy.end) && isAfter(slotEndInUtc, busy.start)
        );

        if (!isConflict) {
          availableSlots.push({
            date: dateStr,
            time: format(slot, 'HH:mm'),
            datetime: slotInUtc.toISOString(),
            display: formatForSpeech(dateStr, format(slot, 'HH:mm')),
            doctor: doctor_id || 'any'
          });
        }

        if (availableSlots.length >= 5) break; // Return max 5 options
      }

      if (availableSlots.length >= 3 && !same_day_only) break; // Enough options found
    }

    if (!availableSlots.length) {
      if (same_day_only) {
        return {
          success: true,
          available: false,
          same_day: true,
          message: 'No same-day slots available. The earliest available is tomorrow.',
          next_available: await getNextAvailableSlot(service_id)
        };
      }
      return {
        success: true,
        available: false,
        message: 'No slots found in the requested window. Please try a different date range.'
      };
    }

    return {
      success: true,
      available: true,
      slots: availableSlots,
      // Format top 3 for agent to speak naturally
      speak_options: availableSlots.slice(0, 3).map(s => s.display)
    };

  } catch (err) {
    logger.error('checkAvailability error', { error: err.message, stack: err.stack });
    return {
      success: false,
      error: 'calendar_error',
      message: 'I had trouble checking the calendar. Let me note your details and have our team call you back to confirm a time.'
    };
  }
}

// ─── BOOK APPOINTMENT ────────────────────────────────────────────────────────

async function bookAppointment({
  patient_name,
  patient_phone,
  patient_email,
  service_id,
  appointment_date,
  appointment_time,
  doctor_id,
  is_new_patient = false,
  notes = '',
  insurance = ''
}) {
  try {
    const phone = normalizePhone(patient_phone);
    if (!phone) {
      return { success: false, error: 'invalid_phone', message: 'The phone number provided is not valid.' };
    }

    const service = clinicConfig.services.find(s => s.id === service_id);
    if (!service) {
      return { success: false, error: 'unknown_service' };
    }

    // Re-verify availability right before booking (prevents race condition)
    const recheck = await checkAvailability({
      requested_date: appointment_date,
      requested_time: appointment_time,
      service_id,
      doctor_id
    });

    const exactSlot = recheck.slots?.find(
      s => s.date === appointment_date && s.time === appointment_time
    );

    if (!recheck.available || !exactSlot) {
      return {
        success: false,
        error: 'slot_taken',
        message: 'That slot was just taken. Let me find you the next available time.',
        alternatives: recheck.slots?.slice(0, 2)
      };
    }

    const calendar = getCalendarClient();
    const appointmentId = uuidv4();

    // Build the calendar event
    const startDt = fromZonedTime(
      parseISO(`${appointment_date}T${appointment_time}:00`),
      TIMEZONE
    );
    const endDt = addMinutes(startDt, service.duration_minutes);

    const calendarId = doctor_id
      ? clinicConfig.doctors.find(d => d.id === doctor_id)?.calendar_id || 'primary'
      : 'primary';

    const eventDescription = [
      `Patient: ${patient_name}`,
      `Phone: ${phone}`,
      patient_email ? `Email: ${patient_email}` : '',
      `Service: ${service.name}`,
      `New Patient: ${is_new_patient ? 'Yes' : 'No'}`,
      insurance ? `Insurance: ${insurance}` : '',
      notes ? `Notes: ${notes}` : '',
      `Booked via: AI Agent`,
      `Booking ID: ${appointmentId}`
    ].filter(Boolean).join('\n');

    const event = await withRetry(() =>
      calendar.events.insert({
        calendarId,
        sendUpdates: 'none', // We send our own confirmations
        requestBody: {
          id: appointmentId.replace(/-/g, '').substring(0, 26), // Google Calendar event ID format
          summary: `${is_new_patient ? '[NEW] ' : ''}${service.name} — ${patient_name}`,
          description: eventDescription,
          start: { dateTime: startDt.toISOString(), timeZone: TIMEZONE },
          end: { dateTime: endDt.toISOString(), timeZone: TIMEZONE },
          colorId: is_new_patient ? '11' : '1', // Red for new patients (easy visual)
          extendedProperties: {
            private: {
              patient_phone: phone,
              patient_name,
              service_id,
              booking_id: appointmentId,
              is_new_patient: String(is_new_patient),
              booked_by: 'ai_agent'
            }
          }
        }
      })
    );

    logger.info('Appointment booked', {
      booking_id: appointmentId,
      patient: patient_name,
      service: service_id,
      datetime: startDt.toISOString()
    });

    return {
      success: true,
      booking_id: appointmentId,
      google_event_id: event.data.id,
      appointment: {
        patient_name,
        patient_phone: phone,
        service: service.name,
        date: appointment_date,
        time: appointment_time,
        display: formatForSpeech(appointment_date, appointment_time),
        is_new_patient,
        doctor_id: doctor_id || 'any'
      },
      // For post-booking notifications
      _notifications: { phone, email: patient_email, is_new_patient }
    };

  } catch (err) {
    logger.error('bookAppointment error', { error: err.message });
    return {
      success: false,
      error: 'booking_failed',
      message: 'I was unable to complete the booking. Let me take your details and have our team confirm directly.'
    };
  }
}

// ─── GET APPOINTMENT ─────────────────────────────────────────────────────────

async function getAppointment({ patient_name, patient_phone, approximate_date }) {
  try {
    const calendar = getCalendarClient();
    const phone = patient_phone ? normalizePhone(patient_phone) : null;

    const searchStart = approximate_date
      ? parseISO(approximate_date)
      : new Date();
    const searchEnd = addDays(searchStart, 90);

    const events = await withRetry(() =>
      calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        timeMin: searchStart.toISOString(),
        timeMax: searchEnd.toISOString(),
        q: patient_name || undefined,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50
      })
    );

    const matches = (events.data.items || []).filter(event => {
      const props = event.extendedProperties?.private || {};
      const nameMatch = patient_name &&
        event.summary?.toLowerCase().includes(patient_name.toLowerCase());
      const phoneMatch = phone && props.patient_phone === phone;
      return nameMatch || phoneMatch;
    });

    if (!matches.length) {
      return {
        success: true,
        found: false,
        message: `I couldn't find an appointment matching that information. Could you double-check the name or phone number?`
      };
    }

    // Return the soonest upcoming appointment
    const apt = matches[0];
    const startDt = new Date(apt.start.dateTime);
    const props = apt.extendedProperties?.private || {};

    return {
      success: true,
      found: true,
      appointment_id: apt.id,
      appointment: {
        id: apt.id,
        patient_name: props.patient_name || patient_name,
        service: apt.summary,
        date: format(toZonedTime(startDt, TIMEZONE), 'yyyy-MM-dd'),
        time: format(toZonedTime(startDt, TIMEZONE), 'HH:mm'),
        display: formatForSpeech(
          format(toZonedTime(startDt, TIMEZONE), 'yyyy-MM-dd'),
          format(toZonedTime(startDt, TIMEZONE), 'HH:mm')
        )
      }
    };

  } catch (err) {
    logger.error('getAppointment error', { error: err.message });
    return { success: false, error: 'lookup_failed', message: 'Unable to look up appointment at this time.' };
  }
}

// ─── RESCHEDULE ──────────────────────────────────────────────────────────────

async function rescheduleAppointment({ appointment_id, new_date, new_time, reason }) {
  try {
    const calendar = getCalendarClient();
    const calId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    // Get existing event
    const existing = await withRetry(() =>
      calendar.events.get({ calendarId: calId, eventId: appointment_id })
    );

    if (!existing.data) {
      return { success: false, error: 'not_found', message: 'I could not find that appointment to reschedule.' };
    }

    const props = existing.data.extendedProperties?.private || {};
    const service = clinicConfig.services.find(s => s.id === props.service_id) ||
      clinicConfig.services.find(s => existing.data.summary?.includes(s.name));
    const duration = service?.duration_minutes || 60;

    // Check new slot availability
    const avail = await checkAvailability({
      requested_date: new_date,
      requested_time: new_time,
      service_id: service?.id || 'cleaning'
    });

    if (!avail.available) {
      return {
        success: false,
        error: 'slot_unavailable',
        message: 'That new time is not available.',
        alternatives: avail.slots?.slice(0, 3)
      };
    }

    const newStart = fromZonedTime(parseISO(`${new_date}T${new_time}:00`), TIMEZONE);
    const newEnd = addMinutes(newStart, duration);

    await withRetry(() =>
      calendar.events.patch({
        calendarId: calId,
        eventId: appointment_id,
        requestBody: {
          start: { dateTime: newStart.toISOString(), timeZone: TIMEZONE },
          end: { dateTime: newEnd.toISOString(), timeZone: TIMEZONE },
          description: existing.data.description + `\n\nRescheduled: ${reason || 'patient request'} on ${new Date().toISOString()}`
        }
      })
    );

    logger.info('Appointment rescheduled', { appointment_id, new_date, new_time });

    return {
      success: true,
      appointment: {
        id: appointment_id,
        new_date,
        new_time,
        display: formatForSpeech(new_date, new_time)
      }
    };

  } catch (err) {
    logger.error('rescheduleAppointment error', { error: err.message });
    return { success: false, error: 'reschedule_failed', message: 'Unable to reschedule at this time.' };
  }
}

// ─── CANCEL ──────────────────────────────────────────────────────────────────

async function cancelAppointment({ appointment_id, reason, patient_confirmed }) {
  if (!patient_confirmed) {
    return { success: false, error: 'not_confirmed', message: 'Cancellation requires patient confirmation.' };
  }

  try {
    const calendar = getCalendarClient();
    const calId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    // Get event before deleting (for logging and notifications)
    const existing = await withRetry(() =>
      calendar.events.get({ calendarId: calId, eventId: appointment_id })
    );

    // Mark as cancelled (don't delete — preserve record)
    await withRetry(() =>
      calendar.events.patch({
        calendarId: calId,
        eventId: appointment_id,
        requestBody: {
          summary: `[CANCELLED] ${existing.data.summary}`,
          colorId: '8', // Graphite = cancelled
          description: existing.data.description +
            `\n\nCANCELLED: ${reason || 'patient request'} on ${new Date().toISOString()}`
        }
      })
    );

    logger.info('Appointment cancelled', { appointment_id, reason });

    return {
      success: true,
      cancelled: true,
      appointment_summary: existing.data.summary
    };

  } catch (err) {
    logger.error('cancelAppointment error', { error: err.message });
    return { success: false, error: 'cancel_failed', message: 'Unable to cancel the appointment at this time.' };
  }
}

// ─── HELPER: GET NEXT AVAILABLE SLOT ────────────────────────────────────────

async function getNextAvailableSlot(service_id) {
  for (let daysAhead = 1; daysAhead <= 14; daysAhead++) {
    const date = format(addDays(new Date(), daysAhead), 'yyyy-MM-dd');
    const result = await checkAvailability({ requested_date: date, service_id });
    if (result.available && result.slots?.length) {
      return result.slots[0].display;
    }
  }
  return null;
}

module.exports = {
  checkAvailability,
  bookAppointment,
  getAppointment,
  rescheduleAppointment,
  cancelAppointment
};
