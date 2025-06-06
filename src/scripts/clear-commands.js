const { REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('../config.json');
const logger = require('../utils/logger');

const rest = new REST().setToken(token);

async function clearCommands() {
    try {
        logger.info('Started clearing application (/) commands.');

        // Clear guild commands
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: [] }
        );
        logger.info('Successfully cleared guild commands.');

        // Clear global commands
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: [] }
        );
        logger.info('Successfully cleared global commands.');

    } catch (error) {
        logger.error('Error clearing commands:', error);
    }
}

// Run the clear function
clearCommands(); 