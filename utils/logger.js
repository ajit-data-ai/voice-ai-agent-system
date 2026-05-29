const winston = require('winston');
const path = require('path');

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  if (Object.keys(meta).length) {
    log += ` | ${JSON.stringify(meta)}`;
  }
  return log;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat)
    })
  ]
});

// Add file logging in production
if (process.env.LOG_TO_FILE === 'true') {
  logger.add(new winston.transports.File({
    filename: path.join(__dirname, '../logs/error.log'),
    level: 'error',
    maxsize: 5 * 1024 * 1024, // 5MB
    maxFiles: 5
  }));
  logger.add(new winston.transports.File({
    filename: path.join(__dirname, '../logs/combined.log'),
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 10
  }));
}

module.exports = logger;
