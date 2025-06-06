const fs = require('fs').promises;
const path = require('path');
const { Collection } = require('discord.js');
const logger = require('../utils/logger');
const config = require('../config/config');

// Event priorities
const EVENT_PRIORITIES = {
    CRITICAL: 0,  // Critical system events (ready, error, etc.)
    HIGH: 1,      // Important events (messageCreate, interactionCreate)
    MEDIUM: 2,    // Regular events (guildMemberAdd, etc.)
    LOW: 3,       // Non-critical events (typingStart, etc.)
    MONITOR: 4    // Monitoring events (debug, warn, etc.)
};

// Track registered events for cleanup
const registeredEvents = new Map();

// Validate event handler
function validateEventHandler(handler, eventName) {
    if (typeof handler !== 'function') {
        throw new Error(`Event handler for ${eventName} must be a function`);
    }
    if (handler.constructor.name !== 'AsyncFunction') {
        throw new Error(`Event handler for ${eventName} must be an async function`);
    }
    return true;
}

// Validate event name
function validateEventName(eventName) {
    if (typeof eventName !== 'string') {
        throw new Error('Event name must be a string');
    }
    // Log warning for unknown event names
    if (!['ready', 'error', 'warn', 'debug', 'messageCreate', 'interactionCreate'].includes(eventName)) {
        logger.warn(`Unknown event name: ${eventName}`);
    }
    return true;
}

// Execute event handler with error handling
async function executeEventHandler(handler, eventName, ...args) {
    try {
        await handler(...args);
    } catch (error) {
        // Handle specific error types
        if (error.code === 'ECONNRESET') {
            logger.warn(`Connection reset during ${eventName} event, attempting recovery...`);
            // Attempt recovery for connection resets
            try {
                await new Promise(resolve => setTimeout(resolve, 5000));
                await handler(...args);
                logger.info(`Successfully recovered from connection reset in ${eventName} event`);
                return;
            } catch (recoveryError) {
                logger.error(`Failed to recover from connection reset in ${eventName} event:`, recoveryError);
            }
        } else if (error.code === 'ETIMEDOUT') {
            logger.warn(`Timeout during ${eventName} event, attempting retry...`);
            // Attempt retry for timeouts
            try {
                await new Promise(resolve => setTimeout(resolve, 3000));
                await handler(...args);
                logger.info(`Successfully retried ${eventName} event after timeout`);
                return;
            } catch (retryError) {
                logger.error(`Failed to retry ${eventName} event after timeout:`, retryError);
            }
        }

        // Log error and attempt recovery for critical events
        if (eventName === 'ready' || eventName === 'error') {
            logger.error(`Critical error in ${eventName} event:`, error);
            // Attempt to recover critical events
            try {
                await new Promise(resolve => setTimeout(resolve, 5000));
                await handler(...args);
                logger.info(`Successfully recovered ${eventName} event`);
            } catch (recoveryError) {
                logger.error(`Failed to recover ${eventName} event:`, recoveryError);
                // If we can't recover a critical event, we should probably restart
                if (eventName === 'ready') {
                    process.exit(1);
                }
            }
        } else {
            logger.error(`Error in ${eventName} event:`, error);
        }
    }
}

// Load events from directory
async function loadEvents(client) {
    try {
        // Initialize event collections
        client.events = new Collection();
        client.eventPriorities = new Map();

        // Clear existing registered events
        registeredEvents.clear();

        const eventsDir = path.join(__dirname, '..', 'events');
        const files = await fs.readdir(eventsDir);

        for (const file of files) {
            if (!file.endsWith('.js')) continue;

            const filePath = path.join(eventsDir, file);
            try {
                const event = require(filePath);
                const eventName = path.basename(file, '.js');

                // Validate event properties
                if (!event.execute || typeof event.execute !== 'function') {
                    throw new Error(`Event ${eventName} is missing execute function`);
                }

                validateEventName(eventName);
                validateEventHandler(event.execute, eventName);

                // Set default priority if not specified
                const priority = event.priority ?? EVENT_PRIORITIES.MEDIUM;
                if (!Object.values(EVENT_PRIORITIES).includes(priority)) {
                    throw new Error(`Invalid priority for event ${eventName}`);
                }

                // Check for duplicate event registration
                if (client.events.has(eventName)) {
                    logger.warn(`Duplicate event registration for ${eventName}, overwriting...`);
                }

                // Store event handler and priority
                client.events.set(eventName, event.execute);
                client.eventPriorities.set(eventName, priority);

                // Create event handler with priority management
                const handler = async (...args) => {
                    // Execute critical events immediately
                    if (priority === EVENT_PRIORITIES.CRITICAL) {
                        await executeEventHandler(event.execute, eventName, ...args);
                        return;
                    }

                    // Queue other events based on priority
                    const queue = client.eventQueue || new Map();
                    if (!queue.has(priority)) {
                        queue.set(priority, []);
                    }
                    queue.get(priority).push(() => executeEventHandler(event.execute, eventName, ...args));

                    // Process queue if not already processing
                    if (!client.isProcessingEvents) {
                        client.isProcessingEvents = true;
                        processEventQueue(client, queue);
                    }
                };

                // Register event with client
                if (event.once) {
                    client.once(eventName, handler);
                } else {
                    client.on(eventName, handler);
                }

                // Track registered event for cleanup
                registeredEvents.set(eventName, { handler, once: event.once });

                logger.info(`Loaded event: ${eventName} (Priority: ${priority})`);
            } catch (error) {
                logger.error(`Error loading event from ${filePath}:`, error);
            }
        }

        // Register common events
        registerCommonEvents(client);

        logger.info(`Loaded ${client.events.size} events`);
        return client.events;
    } catch (error) {
        logger.error('Error loading events:', error);
        throw error;
    }
}

// Process event queue
async function processEventQueue(client, queue) {
    try {
        // Process events in priority order
        for (let priority = EVENT_PRIORITIES.CRITICAL; priority <= EVENT_PRIORITIES.MONITOR; priority++) {
            const events = queue.get(priority) || [];
            while (events.length > 0) {
                const handler = events.shift();
                await handler();
            }
        }
    } catch (error) {
        logger.error('Error processing event queue:', error);
    } finally {
        client.isProcessingEvents = false;
    }
}

// Register common events
function registerCommonEvents(client) {
    // Ready event
    client.once('ready', async () => {
        try {
            logger.info(`Logged in as ${client.user.tag}`);
            // Set bot status
            await client.user.setPresence({
                activities: [{ name: config.status.message, type: config.status.type }],
                status: config.status.status
            });
        } catch (error) {
            logger.error('Error in ready event:', error);
            // Attempt recovery
            try {
                await new Promise(resolve => setTimeout(resolve, 5000));
                await client.user.setPresence({
                    activities: [{ name: 'Recovering...', type: 'PLAYING' }],
                    status: 'idle'
                });
            } catch (recoveryError) {
                logger.error('Failed to recover ready event:', recoveryError);
                process.exit(1);
            }
        }
    });

    // Error event
    client.on('error', async (error) => {
        logger.error('Client error:', error);
        // Attempt recovery for specific errors
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            try {
                await new Promise(resolve => setTimeout(resolve, 5000));
                await client.login(config.token);
                logger.info('Successfully recovered from client error');
            } catch (recoveryError) {
                logger.error('Failed to recover from client error:', recoveryError);
                process.exit(1);
            }
        }
    });

    // Warn event
    client.on('warn', (warning) => {
        logger.warn('Client warning:', warning);
    });

    // Handle shutdown
    const shutdown = async () => {
        logger.info('Shutting down...');
        try {
            // Clean up event listeners
            for (const [eventName, { handler, once }] of registeredEvents) {
                if (once) {
                    client.removeListener(eventName, handler);
                } else {
                    client.off(eventName, handler);
                }
            }
            registeredEvents.clear();

            // Clear event collections
            client.events.clear();
            client.eventPriorities.clear();
            if (client.eventQueue) {
                client.eventQueue.clear();
            }

            // Destroy client
            await client.destroy();
            logger.info('Client destroyed');
        } catch (error) {
            logger.error('Error during shutdown:', error);
        } finally {
            process.exit(0);
        }
    };

    // Handle termination signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// Reload events
async function reloadEvents(client) {
    try {
        // Remove all event listeners
        for (const [eventName, { handler, once }] of registeredEvents) {
            if (once) {
                client.removeListener(eventName, handler);
            } else {
                client.off(eventName, handler);
            }
        }
        registeredEvents.clear();

        // Clear event collections
        client.events.clear();
        client.eventPriorities.clear();
        if (client.eventQueue) {
            client.eventQueue.clear();
        }

        // Reload events
        await loadEvents(client);
        logger.info('Events reloaded successfully');
        return true;
    } catch (error) {
        logger.error('Error reloading events:', error);
        return false;
    }
}

module.exports = {
    loadEvents,
    reloadEvents,
    EVENT_PRIORITIES
}; 