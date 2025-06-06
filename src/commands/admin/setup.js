const { SlashCommandBuilder } = require('discord.js');
const SetupManager = require('../../utils/setupManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set up ScoreShell for your server')
        .setDefaultMemberPermissions(0), // Only server admins can see this command

    async execute(interaction) {
        const setupManager = interaction.client.setupManager;
        if (!setupManager) {
            interaction.client.setupManager = new SetupManager(interaction.client);
        }

        await interaction.client.setupManager.startSetup(interaction);
    }
}; 