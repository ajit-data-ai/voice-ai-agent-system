/**
 * Retell AI Webhook Handler
 *
 * Two webhook types:
 * 1. /llm-websocket  — Real-time LLM websocket (custom LLM mode)
 * 2. /retell-webhook — Post-call event processing
 *
 * EDGE CASES HANDLED:
 * - Signature verification failure (reject invalid requests)
 * - Function call timeout (return graceful fallback)
 * - Unknown function calls (don't crash)
 * - Malformed parameters (validate before processing)
 * - Concurrent calls (each call is stateless)
 */

const express = require('express');
const router = express.Router();
const Retell = require('retell-sdk');
const calendarFns = require('../functions/calendar');
const appointmentFns = require('../functions/appointments');
const logger = require('../utils/logger');
const clinicConfig = require('../config/clinic-config.json');

const retellClient = new Retell({ apiKey: process.env.RETELL_API_KEY });

// ─── SIGNATURE VERIFICATION MIDDLEWARE ──────────────────────────────────────

function verifyRetellSignature(req, res, next) {
  try {
    const signature = req.headers['x-retell-signature'];
    if (!signature) {
      logger.warn('Missing Retell signature');
      return res.status(401).json({ error: 'Missing signature' });
    }

    const isValid = retellClient.verify(
      JSON.stringify(req.body),
      process.env.RETELL_API_KEY,
      signature
    );

    if (!isValid) {
      logger.warn('Invalid Retell signature — possible spoofed request');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  } catch (err) {
    logger.error('Signature verification error', { error: err.message });
    return res.status(401).json({ error: 'Verification failed' });
  }
}

// ─── FUNCTION CALL ROUTER ────────────────────────────────────────────────────

const FUNCTION_TIMEOUT_MS = 8000; // 8 seconds max — Retell times out at 10s

async function withTimeout(fn, timeoutMs = FUNCTION_TIMEOUT_MS) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Function call timed out')), timeoutMs)
    )
  ]);
}

/**
 * Route a Retell function call to the appropriate handler
 */
async function handleFunctionCall(name, args) {
  logger.info(`Function call: ${name}`, { args });

  try {
    switch (name) {

      case 'check_availability':
        return await withTimeout(() => calendarFns.checkAvailability(args));

      case 'book_appointment':
        return await withTimeout(() => appointmentFns.processBooking(args));

      case 'get_appointment':
        return await withTimeout(() => calendarFns.getAppointment(args));

      case 'reschedule_appointment':
        return await withTimeout(() => calendarFns.rescheduleAppointment(args));

      case 'cancel_appointment':
        return await withTimeout(() => calendarFns.cancelAppointment(args));

      case 'transfer_to_staff':
        return await withTimeout(() => appointmentFns.processTransfer(args));

      case 'log_callback_request':
        return await withTimeout(() => appointmentFns.logCallbackRequest(args));

      default:
        logger.warn(`Unknown function called: ${name}`);
        return {
          success: false,
          error: 'unknown_function',
          message: 'I was unable to complete that action. Let me have our team assist you directly.'
        };
    }
  } catch (err) {
    const isTimeout = err.message === 'Function call timed out';
    logger.error(`Function call error: ${name}`, { error: err.message, isTimeout });

    return {
      success: false,
      error: isTimeout ? 'timeout' : 'function_error',
      message: isTimeout
        ? 'That\'s taking a bit longer than expected. Let me note your information and have someone confirm with you shortly.'
        : 'I ran into an issue completing that. Let me take your details and have our team follow up.'
    };
  }
}

// ─── POST-CALL WEBHOOK ───────────────────────────────────────────────────────

router.post('/retell-webhook', verifyRetellSignature, async (req, res) => {
  // Respond immediately — Retell requires fast acknowledgement
  res.status(200).json({ received: true });

  const { event, call } = req.body;

  logger.info('Retell webhook event', { event, call_id: call?.call_id });

  try {
    switch (event) {

      case 'call_started':
        logger.info('Call started', {
          call_id: call.call_id,
          from: call.from_number,
          to: call.to_number
        });
        break;

      case 'call_ended': {
        const analysis = call.call_analysis || {};
        const outcome = analysis.custom_analysis_data?.call_outcome || 'unknown';
        const patientPhone = analysis.custom_analysis_data?.patient_phone;
        const wasEmergency = analysis.custom_analysis_data?.was_emergency;

        logger.info('Call ended', {
          call_id: call.call_id,
          duration_s: call.duration_ms ? Math.round(call.duration_ms / 1000) : null,
          outcome,
          sentiment: analysis.custom_analysis_data?.caller_sentiment
        });

        // Alert staff if emergency was detected but not transferred
        if (wasEmergency && outcome !== 'transferred_to_staff') {
          await appointmentFns.processTransfer({
            reason: 'dental_emergency',
            urgency: 'high',
            caller_phone: call.from_number,
            summary: `Emergency call ended without transfer. Call ID: ${call.call_id}`
          });
        }

        // Log unhandled requests for quality improvement
        const unhandled = analysis.custom_analysis_data?.unhandled_request;
        if (unhandled) {
          logger.warn('Unhandled request detected', { call_id: call.call_id, unhandled });
        }

        break;
      }

      case 'call_analyzed':
        logger.info('Call analysis complete', {
          call_id: call.call_id,
          analysis: call.call_analysis
        });
        break;

      default:
        logger.debug('Unknown event', { event });
    }
  } catch (err) {
    logger.error('Post-call webhook processing error', { error: err.message, event });
    // Don't re-throw — already responded 200
  }
});

// ─── LLM WEBSOCKET (Custom LLM Mode — Alternative to Retell's built-in LLM) ─
// Only needed if you use custom LLM mode instead of Retell's hosted LLM.
// Most users should skip this and use Retell's built-in LLM configuration.

router.ws('/llm-websocket/:call_id', (ws, req) => {
  const callId = req.params.call_id;
  logger.info('LLM WebSocket connected', { call_id: callId });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      logger.warn('Invalid WebSocket message', { call_id: callId });
      return;
    }

    // Handle function calls from the LLM
    if (msg.interaction_type === 'reminder_required') {
      ws.send(JSON.stringify({
        response_type: 'response',
        response_id: msg.response_id,
        content: 'Just pulling that up for you...',
        content_complete: true
      }));
      return;
    }

    if (msg.interaction_type === 'update_only') return;

    // Regular LLM response is handled by Retell's hosted model
    // This handler only processes tool/function calls
    if (msg.tool_call) {
      const result = await handleFunctionCall(
        msg.tool_call.name,
        msg.tool_call.arguments
      );
      ws.send(JSON.stringify({
        response_type: 'tool_call_result',
        tool_call_id: msg.tool_call.id,
        result: JSON.stringify(result)
      }));
    }
  });

  ws.on('close', () => {
    logger.info('LLM WebSocket disconnected', { call_id: callId });
  });

  ws.on('error', (err) => {
    logger.error('LLM WebSocket error', { call_id: callId, error: err.message });
  });
});

// Export the function handler separately for use in REST API mode
module.exports = { router, handleFunctionCall };
