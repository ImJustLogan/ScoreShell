require('dotenv').config();
console.log('Starting ScoreShell bot...');

const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
console.log('Discord.js imported successfully');

const { MongoClient, ServerApiVersion } = require('mongodb');
console.log('MongoDB imported successfully');

const { logger } = require('./utils/logger');
console.log('Logger initialized');

const { registerCommonEvents, loadEvents } = require('./handlers/eventHandler');
const { loadCommands } = require('./handlers/commandHandler');
const TaskManager = require('./utils/taskManager');
const ChallengeManager = require('./utils/challengeManager');
const HealthCheck = require('./utils/healthCheck');
const { startQueueDisplayUpdates } = require('./utils/queueDisplay');
const { startMatchmakingService } = require('./utils/matchmaking');
const QueueManager = require('./utils/queueManager');
const SetupManager = require('./utils/setupManager');

// Create client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Initialize collections
client.commands = new Collection();

// Database connection options
const dbOptions = {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    },
    maxPoolSize: 10,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    retryReads: true,
    heartbeatFrequencyMS: 10000,
    monitorCommands: true
};

// Initialize database connection with retry logic
async function connectWithRetry(uri, options, maxRetries = 5, retryDelay = 5000) {
    let retries = 0;
    let lastError = null;

    while (retries < maxRetries) {
        try {
            const mongoClient = new MongoClient(uri, options);
            
            // Add connection event listeners
            mongoClient.on('connected', () => {
                logger.info('MongoDB connected');
            });

            mongoClient.on('disconnected', () => {
                logger.warn('MongoDB disconnected');
            });

            mongoClient.on('error', (error) => {
                logger.error('MongoDB error:', error);
            });

            await mongoClient.connect();
            
            // Test the connection
            await mongoClient.db().command({ ping: 1 });
            logger.info('Database connection established and tested');
            
            return mongoClient;
        } catch (error) {
            lastError = error;
            retries++;
            logger.error(`Database connection attempt ${retries} failed:`, error);
            
            if (retries === maxRetries) {
                throw new Error(`Failed to connect to database after ${maxRetries} attempts. Last error: ${lastError.message}`);
            }
            
            // Exponential backoff
            const delay = retryDelay * Math.pow(2, retries - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Initialize database connection
async function initializeDatabase() {
    let mongoClient;
    try {
        mongoClient = await connectWithRetry(process.env.MONGODB_URI, dbOptions);
        client.db = mongoClient.db();
        
        // Set up database error handling on the client instance
        mongoClient.on('error', async (error) => {
            logger.error('Database error:', error);
            if (error.name === 'MongoNetworkError') {
                try {
                    await mongoClient.close();
                    mongoClient = await connectWithRetry(process.env.MONGODB_URI, dbOptions);
                    client.db = mongoClient.db();
                    logger.info('Database connection recovered');
                } catch (retryError) {
                    logger.error('Failed to recover database connection:', retryError);
                    process.exit(1);
                }
            }
        });

        // Add connection event listeners
        mongoClient.on('connected', () => {
            logger.info('MongoDB connected');
        });

        mongoClient.on('disconnected', () => {
            logger.warn('MongoDB disconnected');
        });

        return mongoClient;
    } catch (error) {
        logger.error('Fatal database connection error:', error);
        process.exit(1);
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
    logger.error('Uncaught Exception:', error);
    await cleanup();
    process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', async (error) => {
    logger.error('Unhandled Rejection:', error);
    await cleanup();
    process.exit(1);
});

// Cleanup function
async function cleanup() {
    logger.info('Starting cleanup...');
    try {
        // Close database connection
        if (mongoClient) {
            try {
                await mongoClient.close();
                logger.info('Database connection closed');
            } catch (error) {
                logger.error('Error closing database connection:', error);
            }
        }

        // Clear collections
        if (client.commands) client.commands.clear();
        if (client.cooldowns) client.cooldowns.clear();
        if (client.commandCategories) client.commandCategories.clear();
        if (client.aliases) client.aliases.clear();

        // Destroy client
        if (client.destroy) {
            try {
                await client.destroy();
                logger.info('Discord client destroyed');
            } catch (error) {
                logger.error('Error destroying Discord client:', error);
            }
        }
    } catch (error) {
        logger.error('Error during cleanup:', error);
    }
}

// Handle shutdown signals
process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal');
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal');
    await cleanup();
    process.exit(0);
});

// Initialize and start the bot
async function startBot() {
    console.log('Starting bot initialization...');
    try {
        // Initialize health check
        console.log('Initializing health check...');
        const healthCheck = new HealthCheck(client);
        client.healthCheck = healthCheck;

        // Initialize database
        console.log('Connecting to database...');
        mongoClient = await initializeDatabase();
        console.log('Database connected successfully');

        // Start health check service
        console.log('Starting health check service...');
        await healthCheck.start();

        // Load commands
        console.log('Loading commands...');
        try {
            await loadCommands(client);
            logger.info('Commands loaded');
        } catch (error) {
            console.error('Failed to load commands:', error);
            logger.error('Failed to load commands:', error);
            if (error.message.includes('CLIENT_ID')) {
                console.error('Please set the CLIENT_ID environment variable in your .env file');
                logger.error('Please set the CLIENT_ID environment variable in your .env file');
                process.exit(1);
            }
        }

        // Load events
        console.log('Loading events...');
        await loadEvents(client);
        logger.info('Events loaded');

        // Initialize task manager
        console.log('Initializing task manager...');
        client.taskManager = new TaskManager(client.db);
        await client.taskManager.initialize();
        logger.info('Task manager initialized');

        // Initialize challenge manager
        console.log('Initializing challenge manager...');
        client.challengeManager = new ChallengeManager(client.db);
        logger.info('Challenge manager initialized');

        // Register common event handlers
        console.log('Registering common events...');
        registerCommonEvents(client);

        // Start queue display updates
        console.log('Starting queue display updates...');
        startQueueDisplayUpdates(client);
        logger.info('Queue display updates started');

        // Start matchmaking service
        console.log('Starting matchmaking service...');
        startMatchmakingService(client);
        logger.info('Matchmaking service started');

        // Login to Discord
        console.log('Logging in to Discord...');
        await client.login(process.env.DISCORD_TOKEN);
        logger.info('Bot is ready!');

        // Set up periodic status updates
        setInterval(async () => {
            try {
                const status = await healthCheck.getStatus();
                const commandStats = await healthCheck.getCommandStats();
                
                // Update bot status with health information
                const totalCommands = commandStats.reduce((sum, cmd) => sum + cmd.totalUses, 0);
                const successRate = commandStats.length > 0
                    ? commandStats.reduce((sum, cmd) => sum + cmd.successRate, 0) / commandStats.length
                    : 0;

                await client.user.setPresence({
                    activities: [{
                        name: `${totalCommands} commands | ${successRate.toFixed(1)}% success`,
                        type: ActivityType.Watching
                    }],
                    status: healthCheck.isHealthy ? 'online' : 'dnd'
                });

                // Log health status if unhealthy
                if (!healthCheck.isHealthy) {
                    logger.warn('Bot health status:', status);
                }
            } catch (error) {
                logger.error('Error updating bot status:', error);
            }
        }, 60000); // Update every minute

        // Handle shutdown
        const shutdown = async () => {
            logger.info('Shutting down bot...');
            
            try {
                // Stop health check service
                await healthCheck.stop();
                
                // Clean up database connection
                if (client.db) {
                    await client.db.close();
                    logger.info('Database connection closed');
                }

                // Clear collections
                if (client.commands) client.commands.clear();
                if (client.cooldowns) client.cooldowns.clear();
                if (client.events) client.events.clear();

                // Destroy client
                await client.destroy();
                logger.info('Bot shutdown complete');
                
                process.exit(0);
            } catch (error) {
                logger.error('Error during shutdown:', error);
                process.exit(1);
            }
        };

        // Handle process signals
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Handle uncaught errors
        process.on('uncaughtException', async (error) => {
            logger.error('Uncaught Exception:', error);
            await healthCheck.notifyAdministrators();
            await shutdown();
        });

        process.on('unhandledRejection', async (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            await healthCheck.notifyAdministrators();
        });

        client.once('ready', async () => {
            try {
                logger.info(`Logged in as ${client.user.tag}`);

                // Initialize queue manager
                client.queueManager = new QueueManager(client);
                
                // Initialize challenge manager
                client.challengeManager = new ChallengeManager(client);

                // Set up queue displays in all servers
                const guilds = await client.guilds.fetch();
                for (const [guildId, guild] of guilds) {
                    try {
                        const rankedChannel = guild.channels.cache.find(
                            channel => channel.name.includes('1v1-ranked') && 
                            channel.parent?.name === 'Sluggers ranked'
                        );
                        
                        if (rankedChannel) {
                            await client.queueManager.initializeQueue(guildId, rankedChannel);
                        }
                    } catch (error) {
                        logger.error(`Failed to initialize queue for guild ${guildId}:`, error);
                    }
                }

                logger.info('Bot is ready!');
            } catch (error) {
                logger.error('Error during bot initialization:', error);
            }
        });

    } catch (error) {
        logger.error('Error starting bot:', error);
        await cleanup();
        process.exit(1);
    }
}

// Start the bot
startBot(); 