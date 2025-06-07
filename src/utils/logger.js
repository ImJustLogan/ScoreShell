const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// Define log colors
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`,
    ),
);

// Create a basic logger instance
const logger = winston.createLogger({
    level: 'info', // Default level
    levels,
    format,
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            filename: path.join('logs', 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join('logs', 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join('logs', 'exceptions.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join('logs', 'rejections.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});

// Function to update logger with config
function updateLoggerWithConfig(config) {
    if (config.logLevel) {
        logger.level = config.logLevel;
    }
}

// Create a stream object for Morgan middleware
logger.stream = {
    write: (message) => logger.http(message.trim()),
};

// Add a method to log Discord.js events
logger.discord = (event, data) => {
    logger.debug(`Discord Event: ${event}`, { data });
};

// Add a method to log database operations
logger.db = (operation, collection, data) => {
    logger.debug(`Database ${operation} on ${collection}`, { data });
};

// Add a method to log match events
logger.match = (matchId, event, data) => {
    logger.info(`Match ${matchId}: ${event}`, { data });
};

// Add a method to log challenge events
logger.challenge = (challengeId, event, data) => {
    logger.info(`Challenge ${challengeId}: ${event}`, { data });
};

// Add a method to log club events
logger.club = (clubId, event, data) => {
    logger.info(`Club ${clubId}: ${event}`, { data });
};

// Add a method to log user events
logger.user = (userId, event, data) => {
    logger.info(`User ${userId}: ${event}`, { data });
};

// Add a method to log moderation actions
logger.moderation = (action, moderator, target, reason) => {
    logger.warn(`Moderation: ${action} by ${moderator} on ${target}`, { reason });
};

module.exports = {
    logger,
    updateLoggerWithConfig
}; 