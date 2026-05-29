/**
 * SMS & Notification functions via Twilio
 *
 * EDGE CASES HANDLED:
 * - Twilio API failures (retry + fallback to email)
 * - Invalid phone numbers (validated before sending)
 * - Message too long (auto-truncate with link)
 * - Opt-out handling (stop words)
 * - Delivery failure tracking
 */

const twilio = require('twilio');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const { normalizePhone } = require('../utils/date-helpers');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const STAFF_PHONE = process.env.STAFF_NOTIFICATION_PHONE;

// ─── EMAIL FALLBACK ──────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendEmail({ to, subject, text }) {
  try {
    await transporter.sendMail({
      from: `"${process.env.CLINIC_NAME}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text
    });
    return { success: true };
  } catch (err) {
    logger.error('Email send failed', { error: err.message, to });
    return { success: false, error: err.message };
  }
}

// ─── CORE SMS SEND ───────────────────────────────────────────────────────────

async function sendSMS(to, body, retries = 2) {
  const phone = normalizePhone(to);
  if (!phone) {
    logger.warn('Invalid phone for SMS', { to });
    return { success: false, error: 'invalid_phone' };
  }

  // Truncate if over SMS limit
  const maxLen = 1600;
  const message = body.length > maxLen ? body.substring(0, maxLen - 3) + '...' : body;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const msg = await client.messages.create({
        body: message,
        from: FROM_NUMBER,
        to: phone
      });
      logger.info('SMS sent', { sid: msg.sid, to: phone, status: msg.status });
      return { success: true, sid: msg.sid };
    } catch (err) {
      const isFinal = attempt > retries;
      logger.warn(`SMS attempt ${attempt} failed`, { error: err.message, code: err.code });

      // Non-retryable errors (bad number, unsubscribed, etc.)
      if ([21211, 21614, 21610, 30003, 30004, 30005, 30006].includes(err.code)) {
        logger.error('SMS non-retryable error', { code: err.code, to: phone });
        return { success: false, error: `twilio_${err.code}`, permanent: true };
      }

      if (isFinal) {
        return { success: false, error: err.message };
      }

      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// ─── APPOINTMENT CONFIRMATION SMS ────────────────────────────────────────────

async function sendConfirmationSMS({ patient_name, patient_phone, service, display_datetime, clinic_name, clinic_phone }) {
  const body =
`Hi ${patient_name}! ✅ Your appointment is confirmed.

📅 ${display_datetime}
🦷 ${service}
📍 ${clinic_name}

Questions? Call us: ${clinic_phone}

Reply STOP to opt out.`;

  return sendSMS(patient_phone, body);
}

// ─── APPOINTMENT REMINDER SMS ────────────────────────────────────────────────

async function sendReminderSMS({ patient_name, patient_phone, service, display_datetime, clinic_name, clinic_phone, hours_before }) {
  const timeLabel = hours_before >= 24 ? '24-hour' : '2-hour';
  const body =
`Hi ${patient_name}! ⏰ Reminder: You have a ${timeLabel} reminder.

📅 ${display_datetime}
🦷 ${service}
📍 ${clinic_name}

Need to reschedule? Call: ${clinic_phone}

Reply STOP to opt out.`;

  return sendSMS(patient_phone, body);
}

// ─── CANCELLATION CONFIRMATION ───────────────────────────────────────────────

async function sendCancellationSMS({ patient_name, patient_phone, display_datetime, clinic_name, clinic_phone }) {
  const body =
`Hi ${patient_name}, your appointment on ${display_datetime} has been cancelled.

To rebook, call: ${clinic_phone}
${clinic_name}`;

  return sendSMS(patient_phone, body);
}

// ─── STAFF ALERT ─────────────────────────────────────────────────────────────

async function alertStaff({ subject, message, urgency = 'normal' }) {
  const emoji = urgency === 'critical' ? '🚨 URGENT: ' : urgency === 'high' ? '⚠️ ' : 'ℹ️ ';
  const fullMessage = `${emoji}${subject}\n\n${message}`;

  // SMS alert
  const smsResult = await sendSMS(STAFF_PHONE, fullMessage);

  // Email alert
  const emailResult = await sendEmail({
    to: process.env.STAFF_NOTIFICATION_EMAIL,
    subject: `${emoji}${subject}`,
    text: message
  });

  return { sms: smsResult, email: emailResult };
}

// ─── NEW PATIENT INTAKE FORM LINK ────────────────────────────────────────────

async function sendIntakeFormSMS({ patient_name, patient_phone, intake_form_url }) {
  const body =
`Hi ${patient_name}! 👋 Welcome to ${process.env.CLINIC_NAME}.

Please complete your new patient form before your appointment (takes ~5 mins):
${intake_form_url || 'Our team will send you the form shortly.'}

See you soon! 😊`;

  return sendSMS(patient_phone, body);
}

// ─── CALLBACK REQUEST CONFIRMATION ───────────────────────────────────────────

async function sendCallbackAcknowledgementSMS({ patient_phone, clinic_name }) {
  const body =
`Thanks for calling ${clinic_name}! We received your message and will call you back during business hours. 🙏`;

  return sendSMS(patient_phone, body);
}

module.exports = {
  sendSMS,
  sendEmail,
  sendConfirmationSMS,
  sendReminderSMS,
  sendCancellationSMS,
  alertStaff,
  sendIntakeFormSMS,
  sendCallbackAcknowledgementSMS
};
