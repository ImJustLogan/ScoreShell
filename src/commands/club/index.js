const { Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

// Import the main club command definition
const clubCommand = require('./club');

// Create a collection to store subcommand handlers
const subcommands = new Collection();

// Load all subcommand handlers
const subcommandFiles = fs.readdirSync(path.join(__dirname, 'subcommands'))
    .filter(file => file.endsWith('.js'));

for (const file of subcommandFiles) {
    const subcommand = require(`./subcommands/${file}`);
    const name = path.basename(file, '.js');
    subcommands.set(name, subcommand);
}

// Export the command with its subcommand handlers
module.exports = {
    ...clubCommand,
    subcommands,
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const handler = subcommands.get(subcommand);
        
        if (!handler) {
            logger.error(`No handler found for club subcommand: ${subcommand}`);
            return await interaction.reply({
                content: 'This subcommand is not implemented yet.',
                ephemeral: true
            });
        }

        try {
            await handler.execute(interaction, {
                CLUB_ICONS: clubCommand.CLUB_ICONS,
                PRIVACY_TYPES: clubCommand.PRIVACY_TYPES
            });
        } catch (error) {
            logger.error(`Error executing club ${subcommand} command:`, error);
            await interaction.reply({
                content: 'An error occurred while executing this command.',
                ephemeral: true
            });
        }
    }
}; 