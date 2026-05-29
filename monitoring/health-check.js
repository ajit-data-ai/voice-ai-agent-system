/**
 * Health check + monitoring endpoints
 * Used by uptime monitors (UptimeRobot, Better Uptime, etc.)
 */

const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const twilio = require('twilio');
const logger = require('../utils/logger');

router.get('/health', async (req, res) => {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    services: {}
  };

  // Check Google Calendar connectivity
  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.calendarList.list({ maxResults: 1 });
    checks.services.google_calendar = 'ok';
  } catch (err) {
    checks.services.google_calendar = `error: ${err.message}`;
    checks.status = 'degraded';
  }

  // Check Twilio connectivity
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    checks.services.twilio = 'ok';
  } catch (err) {
    checks.services.twilio = `error: ${err.message}`;
    checks.status = 'degraded';
  }

  checks.services.server = 'ok';

  const httpStatus = checks.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(checks);
});

// Simple liveness probe
router.get('/ping', (req, res) => {
  res.json({ pong: true, ts: Date.now() });
});

module.exports = router;
