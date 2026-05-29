const logger = require('../utils/logger');

/**
 * Global error handler middleware
 * Catches all unhandled errors — prevents server crashes from killing calls
 */
function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  logger.error('Unhandled error', {
    status,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(status).json({
    error: true,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
}

/**
 * 404 handler
 */
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found', path: req.path });
}

module.exports = { errorHandler, notFoundHandler };
