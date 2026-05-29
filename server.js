/**
 * Voice AI Agent System — Main Server
 * Express + WebSocket server for Retell AI integration
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const expressWs = require('express-ws');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const healthRouter = require('./monitoring/health-check');
const { router: retellRouter } = require('./webhooks/retell-webhook');

const app = express();
expressWs(app); // Enable WebSocket support

// ─── SECURITY MIDDLEWARE ─────────────────────────────────────────────────────

app.use(helmet());
app.set('trust proxy', 1);

// Rate limiting — protect against abuse
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
  skip: (req) => req.path === '/ping' // Don't rate-limit health checks
}));

// ─── BODY PARSING ────────────────────────────────────────────────────────────

// Raw body needed for Retell signature verification
app.use('/retell-webhook', express.raw({ type: '*/*' }), (req, res, next) => {
  req.body = JSON.parse(req.body.toString());
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── REQUEST LOGGING ─────────────────────────────────────────────────────────

app.use((req, res, next) => {
  if (req.path !== '/ping') {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      ua: req.headers['user-agent']?.substring(0, 80)
    });
  }
  next();
});

// ─── ROUTES ──────────────────────────────────────────────────────────────────

app.use('/', healthRouter);
app.use('/', retellRouter);

// ─── ERROR HANDLING ──────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ─── PROCESS-LEVEL ERROR HANDLING ────────────────────────────────────────────
// Prevents the entire server from crashing on an unhandled promise rejection

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: String(reason),
    promise: String(promise)
  });
  // Don't exit — keep server running for other calls
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  // Give logger time to flush, then exit gracefully
  setTimeout(() => process.exit(1), 500);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down gracefully');
  process.exit(0);
});

// ─── START ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🎙️  Voice AI Agent Server running`, {
    port: PORT,
    env: process.env.NODE_ENV,
    clinic: process.env.CLINIC_NAME
  });
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Retell webhook: http://localhost:${PORT}/retell-webhook`);
});

module.exports = app;
