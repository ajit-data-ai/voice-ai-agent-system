/**
 * Appointments orchestration layer
 * Combines calendar + SMS + logging into unified functions
 * This is what the webhook calls — not calendar.js directly
 */

const calendarFns = require('./calendar');
const smsFns = require('./sms');
const logger = require('../utils/logger');
const clinicConfig = require('../config/clinic-config.json');

// Simple in-memory store for callback requests (replace with DB in production)
const callbackRequests = [];

/**
 * Full booking flow: check → book → confirm SMS → alert staff if new patient
 */
async function processBooking(params) {
  // 1. Book the appointment
  const result = await calendarFns.bookAppointment(params);

  if (!result.success) {
    return result; // Propagate error back to agent
  }

  const { appointment, _notifications } = result;

  // 2. Send confirmation SMS (non-blocking — don't fail booking if SMS fails)
  if (clinicConfig.booking.send_sms_confirmation && _notifications?.phone) {
    smsFns.sendConfirmationSMS({
      patient_name: appointment.patient_name,
      patient_phone: _notifications.phone,
      service: appointment.service,
      display_datetime: appointment.display,
      clinic_name: clinicConfig.clinic.name,
      clinic_phone: clinicConfig.clinic.phone
    }).catch(err => logger.error('Confirmation SMS failed (non-fatal)', { error: err.message }));
  }

  // 3. Send intake form SMS for new patients
  if (_notifications?.is_new_patient && _notifications?.phone) {
    const intakeUrl = process.env.INTAKE_FORM_URL || null;
    smsFns.sendIntakeFormSMS({
      patient_name: appointment.patient_name,
      patient_phone: _notifications.phone,
      intake_form_url: intakeUrl
    }).catch(err => logger.error('Intake form SMS failed (non-fatal)', { error: err.message }));
  }

  // 4. Alert staff about new patient bookings
  if (appointment.is_new_patient) {
    smsFns.alertStaff({
      subject: `New Patient Booked: ${appointment.patient_name}`,
      message: `New patient appointment:\n${appointment.display}\nService: ${appointment.service}\nPhone: ${appointment.patient_phone}`,
      urgency: 'normal'
    }).catch(err => logger.error('Staff alert failed (non-fatal)', { error: err.message }));
  }

  return result;
}

/**
 * Process a transfer request — alert staff with call summary
 */
async function processTransfer({ reason, urgency, caller_name, caller_phone, summary }) {
  const isUrgent = urgency === 'critical' || urgency === 'high';
  const clinicPhone = clinicConfig.clinic.phone;
  const emergencyPhone = clinicConfig.clinic.emergency_phone;

  // Alert staff immediately for urgent cases
  if (isUrgent) {
    await smsFns.alertStaff({
      subject: `URGENT Transfer: ${reason} — ${caller_name || 'Unknown caller'}`,
      message: `Caller: ${caller_name || 'Unknown'}\nPhone: ${caller_phone || 'Unknown'}\nReason: ${reason}\nSummary: ${summary || 'N/A'}`,
      urgency
    });
  }

  logger.info('Transfer requested', { reason, urgency, caller_name, caller_phone });

  return {
    success: true,
    transfer_to: isUrgent ? emergencyPhone : clinicPhone,
    message: urgency === 'critical'
      ? 'Transferring you now — please stay on the line.'
      : 'Let me connect you with our team. Please hold for just a moment.'
  };
}

/**
 * Log a callback request for after-hours callers
 */
async function logCallbackRequest({ caller_name, caller_phone, reason, urgency, preferred_callback_time }) {
  const entry = {
    id: Date.now(),
    caller_name,
    caller_phone,
    reason,
    urgency,
    preferred_callback_time,
    logged_at: new Date().toISOString(),
    status: 'pending'
  };

  callbackRequests.push(entry);

  logger.info('Callback request logged', entry);

  // Alert staff if urgent
  if (urgency === 'high') {
    await smsFns.alertStaff({
      subject: `Callback Request: ${caller_name || caller_phone}`,
      message: `After-hours callback request\nName: ${caller_name || 'Unknown'}\nPhone: ${caller_phone}\nReason: ${reason}`,
      urgency: 'high'
    });
  }

  // Acknowledge to caller via SMS
  if (caller_phone) {
    await smsFns.sendCallbackAcknowledgementSMS({
      patient_phone: caller_phone,
      clinic_name: clinicConfig.clinic.name
    });
  }

  return { success: true, callback_id: entry.id };
}

module.exports = {
  processBooking,
  processTransfer,
  logCallbackRequest,
  getCallbackRequests: () => callbackRequests
};
