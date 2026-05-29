const { parseISO, format, addMinutes, isWithinInterval, setHours, setMinutes,
        isWeekend, addDays, startOfDay, isValid, parse, isBefore, isAfter,
        differenceInHours } = require('date-fns');
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');

const TIMEZONE = process.env.CLINIC_TIMEZONE || 'America/New_York';

/**
 * Convert a natural language date string to YYYY-MM-DD
 * Handles: "today", "tomorrow", "next monday", "june 15", "2026-06-15"
 */
function parseNaturalDate(input) {
  if (!input) return null;

  const now = toZonedTime(new Date(), TIMEZONE);
  const lower = input.toLowerCase().trim();

  if (lower === 'today') return format(now, 'yyyy-MM-dd');
  if (lower === 'tomorrow') return format(addDays(now, 1), 'yyyy-MM-dd');
  if (lower === 'day after tomorrow') return format(addDays(now, 2), 'yyyy-MM-dd');

  // Next weekday (e.g. "next monday")
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < weekdays.length; i++) {
    if (lower.includes(weekdays[i])) {
      const targetDay = i;
      const currentDay = now.getDay();
      let daysAhead = targetDay - currentDay;
      if (daysAhead <= 0) daysAhead += 7;
      return format(addDays(now, daysAhead), 'yyyy-MM-dd');
    }
  }

  // ISO format already
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

  // Try various parse formats
  const formats = ['MM/dd/yyyy', 'M/d/yyyy', 'MMMM d', 'MMMM d yyyy', 'MMM d'];
  for (const fmt of formats) {
    try {
      const parsed = parse(input, fmt, now);
      if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
    } catch {}
  }

  return null;
}

/**
 * Convert natural language time to HH:MM (24h)
 * Handles: "2pm", "2:30pm", "14:00", "2 o'clock", "morning", "afternoon"
 */
function parseNaturalTime(input) {
  if (!input) return null;
  const lower = input.toLowerCase().trim();

  // Vague time preferences
  if (lower.includes('morning')) return '09:00';
  if (lower.includes('afternoon')) return '13:00';
  if (lower.includes('evening')) return '16:00';
  if (lower.includes('first available') || lower.includes('any')) return null;

  // Regex for times like 2pm, 2:30pm, 14:00
  const timeRegex = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
  const match = lower.match(timeRegex);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2] || '0', 10);
    const meridiem = match[3]?.toLowerCase();

    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
  }

  return null;
}

/**
 * Check if clinic is open at a given datetime
 */
function isClinicOpen(dateTimeStr, clinicConfig) {
  const dt = toZonedTime(new Date(dateTimeStr), TIMEZONE);
  const dayName = format(dt, 'EEEE').toLowerCase();
  const hours = clinicConfig.hours[dayName];

  if (!hours) return false; // Closed day (null hours = closed)

  const dateStr = format(dt, 'yyyy-MM-dd');
  if (clinicConfig.holidays && clinicConfig.holidays.includes(dateStr)) return false;

  const [openH, openM] = hours.open.split(':').map(Number);
  const [closeH, closeM] = hours.close.split(':').map(Number);

  const openTime = setMinutes(setHours(startOfDay(dt), openH), openM);
  const closeTime = setMinutes(setHours(startOfDay(dt), closeH), closeM);

  return isWithinInterval(dt, { start: openTime, end: closeTime });
}

/**
 * Get next available business day
 */
function getNextBusinessDay(fromDate, clinicConfig) {
  let candidate = addDays(fromDate, 1);
  let attempts = 0;
  while (attempts < 30) {
    const dayName = format(candidate, 'EEEE').toLowerCase();
    const dateStr = format(candidate, 'yyyy-MM-dd');
    if (clinicConfig.hours[dayName] &&
        !(clinicConfig.holidays || []).includes(dateStr)) {
      return candidate;
    }
    candidate = addDays(candidate, 1);
    attempts++;
  }
  return null;
}

/**
 * Check minimum advance booking requirement
 */
function meetsMinAdvance(appointmentDatetime, minHours = 2) {
  const now = new Date();
  return differenceInHours(new Date(appointmentDatetime), now) >= minHours;
}

/**
 * Format a datetime nicely for speaking (TTS-friendly)
 * Returns: "Monday, June 15th at 2:30 PM"
 */
function formatForSpeech(dateStr, timeStr) {
  try {
    const dt = parseISO(`${dateStr}T${timeStr}`);
    const zonedDt = toZonedTime(dt, TIMEZONE);
    return formatInTimeZone(zonedDt, TIMEZONE, "EEEE, MMMM do 'at' h:mm a");
  } catch {
    return `${dateStr} at ${timeStr}`;
  }
}

/**
 * Validate a US phone number — returns normalized +1XXXXXXXXXX or null
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

module.exports = {
  parseNaturalDate,
  parseNaturalTime,
  isClinicOpen,
  getNextBusinessDay,
  meetsMinAdvance,
  formatForSpeech,
  normalizePhone,
  TIMEZONE
};
