require('dotenv').config();

const { logger, updateLoggerWithConfig } = require('../utils/logger');

// Configuration validation helpers
const validators = {
    isString: (value) => typeof value === 'string',
    isNumber: (value) => typeof value === 'number' && !isNaN(value),
    isBoolean: (value) => typeof value === 'boolean',
    isArray: (value) => Array.isArray(value),
    isObject: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    isHexColor: (value) => /^#[0-9A-Fa-f]{6}$/.test(value),
    isUrl: (value) => {
        try {
            new URL(value);
            return true;
        } catch {
            return false;
        }
    },
    isEmojiId: (value) => /^\d{17,20}$/.test(value),
    isEnvironment: (value) => ['development', 'production', 'test'].includes(value),
    isPort: (value) => {
        const port = parseInt(value);
        return !isNaN(port) && port > 0 && port < 65536;
    }
};

// Required environment variables with their types and validators
const requiredEnvVars = {
    DISCORD_TOKEN: { type: 'string', validator: validators.isString },
    CLIENT_ID: { type: 'string', validator: validators.isString },
    OWNER_ID: { type: 'string', validator: validators.isString },
    MONGODB_URI: { type: 'string', validator: validators.isString }
};

// Optional environment variables with defaults and validators
const optionalEnvVars = {
    LOG_LEVEL: {
        type: 'string',
        default: 'info',
        validator: (value) => ['error', 'warn', 'info', 'debug'].includes(value)
    },
    GUILD_ID: {
        type: 'string',
        default: null,
        validator: (value) => value === null || validators.isString(value)
    },
    NODE_ENV: {
        type: 'string',
        default: 'development',
        validator: validators.isEnvironment
    },
    PORT: {
        type: 'number',
        default: 3000,
        validator: validators.isPort
    }
};

// Validate environment variables
function validateEnvVars() {
    const errors = [];

    // Check required variables
    for (const [name, { type, validator }] of Object.entries(requiredEnvVars)) {
        if (!process.env[name]) {
            errors.push(`Missing required environment variable: ${name}`);
        } else if (!validator(process.env[name])) {
            errors.push(`Invalid type for ${name}: expected ${type}`);
        }
    }

    // Check optional variables
    for (const [name, { type, default: defaultValue, validator }] of Object.entries(optionalEnvVars)) {
        if (process.env[name] && !validator(process.env[name])) {
            errors.push(`Invalid type for ${name}: expected ${type}`);
        }
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}

// Set defaults for optional variables
function setDefaults() {
    Object.entries(optionalEnvVars).forEach(([key, { default: defaultValue }]) => {
        if (!process.env[key]) {
            process.env[key] = defaultValue;
        }
    });
}

// Validate rank configuration
function validateRankConfig(ranks) {
    const errors = [];
    const requiredRankProps = ['emoji', 'color', 'image', 'tiers'];
    const requiredTierProps = ['points'];

    for (const [rankName, rank] of Object.entries(ranks)) {
        // Check required properties
        for (const prop of requiredRankProps) {
            if (!rank[prop]) {
                errors.push(`Rank ${rankName} is missing required property: ${prop}`);
            }
        }

        // Validate emoji
        if (rank.emoji && !validators.isEmojiId(rank.emoji)) {
            errors.push(`Invalid emoji ID for rank ${rankName}`);
        }

        // Validate color
        if (rank.color && !validators.isHexColor(rank.color)) {
            errors.push(`Invalid color for rank ${rankName}: ${rank.color}`);
        }

        // Validate image URL
        if (rank.image && !validators.isUrl(rank.image)) {
            errors.push(`Invalid image URL for rank ${rankName}: ${rank.image}`);
        }

        // Validate tiers
        if (rank.tiers) {
            if (!validators.isObject(rank.tiers)) {
                errors.push(`Invalid tiers for rank ${rankName}: must be an object`);
            } else {
                for (const [tierName, tier] of Object.entries(rank.tiers)) {
                    // Check required tier properties
                    for (const prop of requiredTierProps) {
                        if (!tier[prop]) {
                            errors.push(`Tier ${tierName} of rank ${rankName} is missing required property: ${prop}`);
                        }
                    }

                    // Validate points
                    if (tier.points !== undefined && !validators.isNumber(tier.points)) {
                        errors.push(`Invalid points for tier ${tierName} of rank ${rankName}`);
                    }
                }
            }
        }
    }

    if (errors.length > 0) {
        throw new Error(`Rank configuration validation failed:\n${errors.join('\n')}`);
    }
}

// Validate environment
function validateEnvironment() {
    const requiredEnvVars = [
        'DISCORD_TOKEN',
        'MONGODB_URI',
        'CLIENT_ID',
        'GUILD_ID'
    ];

    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            throw new Error(`Missing required environment variable: ${envVar}`);
        }
    }

    // Validate MongoDB URI format
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
        throw new Error('Invalid MongoDB URI format');
    }

    // Validate Discord token format
    const token = process.env.DISCORD_TOKEN;
    if (!/^[\w-]{24,28}\.[\w-]{6}\.[\w-]{27}$/.test(token)) {
        throw new Error('Invalid Discord token format');
    }

    // Validate client ID format
    const clientId = process.env.CLIENT_ID;
    if (!/^\d{17,19}$/.test(clientId)) {
        throw new Error('Invalid client ID format');
    }

    // Validate guild ID format if provided
    const guildId = process.env.GUILD_ID;
    if (guildId && !/^\d{17,19}$/.test(guildId)) {
        throw new Error('Invalid guild ID format');
    }

    return true;
}

// Environment-specific configuration
const envConfig = {
    production: {
        logging: {
            level: 'info',
            file: 'logs/production.log'
        },
        database: {
            poolSize: 10,
            retryWrites: true,
            w: 'majority'
        },
        rateLimits: {
            commands: 5,
            windowMs: 60000
        }
    },
    development: {
        logging: {
            level: 'debug',
            file: 'logs/development.log'
        },
        database: {
            poolSize: 5,
            retryWrites: true,
            w: 1
        },
        rateLimits: {
            commands: 10,
            windowMs: 30000
        }
    },
    test: {
        logging: {
            level: 'error',
            file: 'logs/test.log'
        },
        database: {
            poolSize: 1,
            retryWrites: false,
            w: 0
        },
        rateLimits: {
            commands: 100,
            windowMs: 1000
        }
    }
};

// Base configuration
const baseConfig = {
    // Bot settings
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    status: {
        message: 'ScoreShell',
        type: 'PLAYING',
        status: 'online'
    },

    // Database settings
    mongodb: {
        uri: process.env.MONGODB_URI,
        options: {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            autoIndex: process.env.NODE_ENV !== 'production'
        }
    },

    // Rate limiting
    rateLimits: {
        commands: 5,
        windowMs: 60000,
        message: 'You are being rate limited. Please try again later.'
    },

    // Logging
    logging: {
        level: 'info',
        file: 'logs/bot.log',
        maxSize: '10m',
        maxFiles: 5
    },

    // Rank configuration
    ranks: {
        BRONZE: {
            name: 'Bronze',
            minScore: 0,
            maxScore: 999,
            color: '#CD7F32',
            icon: '🥉',
            rewards: {
                roles: ['Bronze'],
                permissions: []
            }
        },
        SILVER: {
            name: 'Silver',
            minScore: 1000,
            maxScore: 2499,
            color: '#C0C0C0',
            icon: '🥈',
            rewards: {
                roles: ['Silver'],
                permissions: []
            }
        },
        GOLD: {
            name: 'Gold',
            minScore: 2500,
            maxScore: 4999,
            color: '#FFD700',
            icon: '🥇',
            rewards: {
                roles: ['Gold'],
                permissions: []
            }
        },
        PLATINUM: {
            name: 'Platinum',
            minScore: 5000,
            maxScore: 9999,
            color: '#E5E4E2',
            icon: '💎',
            rewards: {
                roles: ['Platinum'],
                permissions: []
            }
        },
        DIAMOND: {
            name: 'Diamond',
            minScore: 10000,
            maxScore: 19999,
            color: '#B9F2FF',
            icon: '💎',
            rewards: {
                roles: ['Diamond'],
                permissions: []
            }
        },
        MASTER: {
            name: 'Master',
            minScore: 20000,
            maxScore: 49999,
            color: '#FF69B4',
            icon: '👑',
            rewards: {
                roles: ['Master'],
                permissions: []
            }
        },
        GRANDMASTER: {
            name: 'Grandmaster',
            minScore: 50000,
            maxScore: Infinity,
            color: '#FF0000',
            icon: '👑',
            rewards: {
                roles: ['Grandmaster'],
                permissions: []
            }
        }
    }
};

// Validate rank configuration
function validateRanks(ranks) {
    const rankNames = new Set();
    const scoreRanges = new Set();

    for (const [rankId, rank] of Object.entries(ranks)) {
        // Validate required properties
        const requiredProps = ['name', 'minScore', 'maxScore', 'color', 'icon', 'rewards'];
        for (const prop of requiredProps) {
            if (!(prop in rank)) {
                throw new Error(`Rank ${rankId} is missing required property: ${prop}`);
            }
        }

        // Validate rank name
        if (typeof rank.name !== 'string' || rank.name.length === 0) {
            throw new Error(`Invalid name for rank ${rankId}`);
        }
        if (rankNames.has(rank.name)) {
            throw new Error(`Duplicate rank name: ${rank.name}`);
        }
        rankNames.add(rank.name);

        // Validate score range
        if (typeof rank.minScore !== 'number' || typeof rank.maxScore !== 'number') {
            throw new Error(`Invalid score range for rank ${rankId}`);
        }
        if (rank.minScore >= rank.maxScore) {
            throw new Error(`Invalid score range for rank ${rankId}: minScore must be less than maxScore`);
        }
        const rangeKey = `${rank.minScore}-${rank.maxScore}`;
        if (scoreRanges.has(rangeKey)) {
            throw new Error(`Overlapping score range for rank ${rankId}`);
        }
        scoreRanges.add(rangeKey);

        // Validate color
        if (!/^#[0-9A-Fa-f]{6}$/.test(rank.color)) {
            throw new Error(`Invalid color format for rank ${rankId}`);
        }

        // Validate icon
        if (typeof rank.icon !== 'string' || rank.icon.length === 0) {
            throw new Error(`Invalid icon for rank ${rankId}`);
        }

        // Validate rewards
        if (!rank.rewards || typeof rank.rewards !== 'object') {
            throw new Error(`Invalid rewards for rank ${rankId}`);
        }
        if (!Array.isArray(rank.rewards.roles)) {
            throw new Error(`Invalid roles array for rank ${rankId}`);
        }
        if (!Array.isArray(rank.rewards.permissions)) {
            throw new Error(`Invalid permissions array for rank ${rankId}`);
        }
    }

    return true;
}

// Load configuration
function loadConfig() {
    try {
        console.log('Starting config load...');
        console.log('Checking environment variables...');
        
        // Log which env vars are present (without showing values)
        const requiredVars = ['DISCORD_TOKEN', 'CLIENT_ID', 'OWNER_ID', 'MONGODB_URI'];
        requiredVars.forEach(varName => {
            console.log(`${varName} is ${process.env[varName] ? 'present' : 'missing'}`);
        });

        // Validate environment variables
        console.log('Validating environment variables...');
        validateEnvVars();
        
        // Set defaults for optional variables
        console.log('Setting defaults for optional variables...');
        setDefaults();
        
        // Create config object
        console.log('Creating config object...');
        const config = {
            // Environment
            env: process.env.NODE_ENV || 'development',
            port: parseInt(process.env.PORT) || 3000,
            
            // Discord
            token: process.env.DISCORD_TOKEN,
            clientId: process.env.CLIENT_ID,
            ownerId: process.env.OWNER_ID,
            guildId: process.env.GUILD_ID,
            
            // Database
            mongodbUri: process.env.MONGODB_URI,
            
            // Logging
            logLevel: process.env.LOG_LEVEL || 'info',
        };

        // Update logger with config
        console.log('Updating logger with config...');
        updateLoggerWithConfig(config);
        
        console.log('Config loaded successfully');
        return config;
    } catch (error) {
        console.error('Error loading configuration:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

// Export the configuration
module.exports = loadConfig(); 