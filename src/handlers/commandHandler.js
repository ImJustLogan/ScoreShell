const fs = require('fs').promises;
const path = require('path');
const { REST, Routes, Collection } = require('discord.js');
const config = require('../config/config');
const { logger } = require('../utils/logger');
const { PermissionFlagsBits } = require('discord.js');

// Command validation constants
const MAX_DESCRIPTION_LENGTH = 100;
const MAX_OPTION_NAME_LENGTH = 32;
const MAX_OPTION_DESCRIPTION_LENGTH = 100;
const MAX_CHOICES = 25;
const MAX_OPTIONS = 25;

// Command option types
const OPTION_TYPES = {
    SUB_COMMAND: 1,
    SUB_COMMAND_GROUP: 2,
    STRING: 3,
    INTEGER: 4,
    BOOLEAN: 5,
    USER: 6,
    CHANNEL: 7,
    ROLE: 8,
    MENTIONABLE: 9,
    NUMBER: 10,
    ATTACHMENT: 11
};

// Track command names and aliases for validation
const commandNames = new Set();
const commandAliases = new Set();

// Validate command options
function validateCommandOptions(options) {
    if (!Array.isArray(options)) return true;
    if (options.length > MAX_OPTIONS) {
        throw new Error(`Command has too many options (max ${MAX_OPTIONS})`);
    }

    for (const option of options) {
        // Validate option name
        if (!option.name || typeof option.name !== 'string') {
            throw new Error('Option name is required and must be a string');
        }
        if (option.name.length > MAX_OPTION_NAME_LENGTH) {
            throw new Error(`Option name "${option.name}" is too long (max ${MAX_OPTION_NAME_LENGTH} characters)`);
        }
        if (!/^[\w-]{1,32}$/.test(option.name)) {
            throw new Error(`Option name "${option.name}" contains invalid characters`);
        }

        // Validate option description
        if (!option.description || typeof option.description !== 'string') {
            throw new Error(`Description is required for option "${option.name}"`);
        }
        if (option.description.length > MAX_OPTION_DESCRIPTION_LENGTH) {
            throw new Error(`Description for option "${option.name}" is too long (max ${MAX_OPTION_DESCRIPTION_LENGTH} characters)`);
        }

        // Validate option type
        if (!option.type || !Object.values(OPTION_TYPES).includes(option.type)) {
            throw new Error(`Invalid type for option "${option.name}"`);
        }

        // Validate choices if present
        if (option.choices) {
            if (!Array.isArray(option.choices)) {
                throw new Error(`Choices for option "${option.name}" must be an array`);
            }
            if (option.choices.length > MAX_CHOICES) {
                throw new Error(`Too many choices for option "${option.name}" (max ${MAX_CHOICES})`);
            }
            for (const choice of option.choices) {
                if (!choice.name || !choice.value) {
                    throw new Error(`Choice for option "${option.name}" must have name and value`);
                }
                if (choice.name.length > MAX_OPTION_NAME_LENGTH) {
                    throw new Error(`Choice name for option "${option.name}" is too long`);
                }
            }
        }

        // Validate required flag
        if (typeof option.required !== 'boolean') {
            option.required = false;
        }

        // Validate min/max values for number/integer options
        if (option.type === OPTION_TYPES.INTEGER || option.type === OPTION_TYPES.NUMBER) {
            if (option.min_value !== undefined && typeof option.min_value !== 'number') {
                throw new Error(`min_value for option "${option.name}" must be a number`);
            }
            if (option.max_value !== undefined && typeof option.max_value !== 'number') {
                throw new Error(`max_value for option "${option.name}" must be a number`);
            }
            if (option.min_value !== undefined && option.max_value !== undefined && option.min_value > option.max_value) {
                throw new Error(`min_value cannot be greater than max_value for option "${option.name}"`);
            }
        }

        // Recursively validate subcommands
        if (option.type === OPTION_TYPES.SUB_COMMAND || option.type === OPTION_TYPES.SUB_COMMAND_GROUP) {
            if (option.options) {
                validateCommandOptions(option.options);
            }
        }
    }
    return true;
}

// Validate command structure
function validateCommand(command) {
    // Check required properties
    const requiredProps = ['name', 'description', 'execute'];
    for (const prop of requiredProps) {
        if (!command[prop]) {
            throw new Error(`Command is missing required property: ${prop}`);
        }
    }

    // Validate command name
    if (typeof command.name !== 'string') {
        throw new Error('Command name must be a string');
    }
    if (!/^[\w-]{1,32}$/.test(command.name)) {
        throw new Error(`Command name "${command.name}" contains invalid characters`);
    }
    if (commandNames.has(command.name)) {
        throw new Error(`Duplicate command name: ${command.name}`);
    }
    commandNames.add(command.name);

    // Validate description
    if (typeof command.description !== 'string') {
        throw new Error(`Description for command "${command.name}" must be a string`);
    }
    if (command.description.length > MAX_DESCRIPTION_LENGTH) {
        throw new Error(`Description for command "${command.name}" is too long (max ${MAX_DESCRIPTION_LENGTH} characters)`);
    }

    // Validate cooldown
    if (command.cooldown !== undefined) {
        if (typeof command.cooldown !== 'number' || command.cooldown < 0) {
            throw new Error(`Invalid cooldown value for command "${command.name}"`);
        }
    }

    // Validate permissions
    if (command.permissions) {
        if (!Array.isArray(command.permissions)) {
            throw new Error(`Permissions for command "${command.name}" must be an array`);
        }
        for (const perm of command.permissions) {
            if (typeof perm !== 'string') {
                throw new Error(`Invalid permission type for command "${command.name}"`);
            }
        }
    }

    // Validate aliases
    if (command.aliases) {
        if (!Array.isArray(command.aliases)) {
            throw new Error(`Aliases for command "${command.name}" must be an array`);
        }
        for (const alias of command.aliases) {
            if (typeof alias !== 'string') {
                throw new Error(`Invalid alias type for command "${command.name}"`);
            }
            if (commandAliases.has(alias)) {
                throw new Error(`Duplicate alias: ${alias}`);
            }
            commandAliases.add(alias);
        }
    }

    // Validate options
    if (command.options) {
        validateCommandOptions(command.options);
    }

    return true;
}

// Check command cooldown
function checkCooldown(command, userId, cooldowns) {
    if (!command.cooldown) return false;

    const now = Date.now();
    const timestamps = cooldowns.get(command.name) || new Collection();
    const cooldownAmount = command.cooldown * 1000;

    if (timestamps.has(userId)) {
        const expirationTime = timestamps.get(userId) + cooldownAmount;
        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return timeLeft;
        }
    }

    timestamps.set(userId, now);
    cooldowns.set(command.name, timestamps);
    return false;
}

// Cleanup cooldowns
function cleanupCooldowns(cooldowns, commands) {
    if (!cooldowns) return;
    const now = Date.now();
    for (const [commandName, timestamps] of cooldowns) {
        for (const [userId, timestamp] of timestamps) {
            const cooldownAmount = commands.get(commandName)?.cooldown * 1000 || 0;
            if (now > timestamp + cooldownAmount) {
                timestamps.delete(userId);
            }
        }
        if (timestamps.size === 0) {
            cooldowns.delete(commandName);
        }
    }
}

// Load commands from directory
async function loadCommandsFromDir(dir, client) {
    const commands = [];
    const files = await fs.readdir(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);

        if (stat.isDirectory()) {
            // Handle command groups
            const groupFiles = await fs.readdir(filePath);
            const groupCommands = [];

            for (const groupFile of groupFiles) {
                if (!groupFile.endsWith('.js')) continue;
                const groupFilePath = path.join(filePath, groupFile);
                try {
                    const command = require(groupFilePath);
                    if (validateCommand(command)) {
                        groupCommands.push(command);
                    }
                } catch (error) {
                    logger.error(`Error loading command from ${groupFilePath}:`, error);
                }
            }

            if (groupCommands.length > 0) {
                commands.push(...groupCommands);
            }
        } else if (file.endsWith('.js')) {
            try {
                const command = require(filePath);
                if (validateCommand(command)) {
                    commands.push(command);
                }
            } catch (error) {
                logger.error(`Error loading command from ${filePath}:`, error);
            }
        }
    }

    return commands;
}

// Load and register commands
async function loadCommands(client) {
    try {
        // Initialize collections
        client.commands = new Collection();
        client.cooldowns = new Collection();
        client.commandCategories = new Map();
        client.aliases = new Map();
        client.commandGroups = new Map();

        // Clear existing command names and aliases
        commandNames.clear();
        commandAliases.clear();

        // Load commands from directories
        const commandsDir = path.join(__dirname, '..', 'commands');
        const commands = await loadCommandsFromDir(commandsDir, client);

        // Register commands with Discord
        try {
            const rest = new REST({ version: '10' }).setToken(config.token);
            logger.info('Started refreshing application (/) commands.');

            if (!config.clientId) {
                throw new Error('CLIENT_ID environment variable is not set');
            }

            // Store original commands for rollback
            const originalCommands = new Map(client.commands);

            try {
                if (config.guildId) {
                    // Guild commands (faster for development)
                    await rest.put(
                        Routes.applicationGuildCommands(config.clientId, config.guildId),
                        { body: commands }
                    );
                    logger.info(`Successfully reloaded ${commands.length} guild commands.`);
                } else {
                    // Global commands
                    await rest.put(
                        Routes.applicationCommands(config.clientId),
                        { body: commands }
                    );
                    logger.info(`Successfully reloaded ${commands.length} global commands.`);
                }

                // Log command categories
                logger.info('Command categories:', Array.from(client.commandCategories.keys()));

            } catch (error) {
                // Rollback on failure
                logger.error('Error registering commands, rolling back:', error);
                client.commands = originalCommands;
                throw error;
            }

        } catch (error) {
            logger.error('Fatal error in command registration:', error);
            throw error;
        }

        // Set up cooldown cleanup interval
        const cleanupInterval = setInterval(() => {
            cleanupCooldowns(client.cooldowns, client.commands);
        }, 60000); // Clean up every minute

        // Store cleanup interval for shutdown
        client.commandCleanupInterval = cleanupInterval;

        logger.info(`Loaded ${client.commands.size} commands`);
        return client.commands;
    } catch (error) {
        logger.error('Error loading commands:', error);
        throw error;
    }
}

// Command permission check
async function checkPermissions(command, interaction) {
    if (!command.permissions) return true;

    const member = interaction.member;
    if (!member) return false;

    // Check if user has required permissions
    const missingPermissions = command.permissions.filter(
        permission => !member.permissions.has(permission)
    );

    if (missingPermissions.length > 0) {
        await interaction.reply({
            content: `You need the following permissions to use this command: ${missingPermissions.join(', ')}`,
            ephemeral: true
        });
        return false;
    }

    return true;
}

// Command reloading
async function reloadCommand(client, commandName) {
    try {
        // Find the command file
        const commandsPath = path.join(__dirname, '..', 'commands');
        let commandPath = null;
        
        async function findCommandFile(dirPath) {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    const found = await findCommandFile(fullPath);
                    if (found) return found;
                } else if (entry.isFile() && entry.name.endsWith('.js')) {
                    const cmd = require(fullPath);
                    if (cmd.data && cmd.data.name === commandName) {
                        return fullPath;
                    }
                }
            }
            return null;
        }

        commandPath = await findCommandFile(commandsPath);
        if (!commandPath) {
            throw new Error(`Command ${commandName} not found`);
        }

        // Clear require cache for the command
        delete require.cache[require.resolve(commandPath)];

        // Load the command
        const command = require(commandPath);
        validateCommand(command);

        // Update the command in collections
        client.commands.set(command.data.name, command);

        // Update Discord commands
        const rest = new REST({ version: '10' }).setToken(config.token);
        if (config.guildId) {
            await rest.put(
                Routes.applicationGuildCommand(config.clientId, config.guildId, command.data.id),
                { body: command.data.toJSON() }
            );
        } else {
            await rest.put(
                Routes.applicationCommand(config.clientId, command.data.id),
                { body: command.data.toJSON() }
            );
        }

        logger.info(`Successfully reloaded command: ${commandName}`);
        return true;
    } catch (error) {
        logger.error(`Error reloading command ${commandName}:`, error);
        return false;
    }
}

// Get commands by category
function getCommandsByCategory(category) {
    return client.commandCategories.get(category) || new Collection();
}

// Get all categories
function getCategories() {
    return Array.from(client.commandCategories.keys());
}

// Get command by name or alias
function getCommand(name) {
    return client.commands.get(name) || client.commands.get(client.aliases.get(name));
}

// Get command group
function getCommandGroup(groupName) {
    return client.commandGroups.get(groupName);
}

module.exports = {
    loadCommands,
    validateCommand,
    checkPermissions,
    checkCooldown,
    reloadCommand,
    getCommandsByCategory,
    getCategories,
    getCommand,
    getCommandGroup,
    OPTION_TYPES
}; 