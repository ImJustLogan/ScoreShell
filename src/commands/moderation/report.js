const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const Report = require('../../models/Report');
const logger = require('../../utils/logger');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Report a user for misconduct')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to report')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the report')
                .setRequired(true)
                .addChoices(
                    { name: 'Harassment and Bullying', value: 'HARASSMENT' },
                    { name: 'Leaving Prematurely', value: 'LEAVING' },
                    { name: 'Bad Connection', value: 'CONNECTION' },
                    { name: 'Cheating or Entering False Scores', value: 'CHEATING' }
                ))
        .addStringOption(option =>
            option.setName('explanation')
                .setDescription('Additional explanation (optional)')
                .setRequired(false)),

    async execute(interaction) {
        const { user, reason, explanation } = interaction.options;
        const targetUser = interaction.options.getUser('user');

        // Prevent self-reporting
        if (targetUser.id === interaction.user.id) {
            return interaction.reply({
                content: 'You cannot report yourself!',
                ephemeral: true
            });
        }

        // Create the report
        const result = await interaction.client.moderationManager.createReport(
            interaction.guildId,
            interaction.user.id,
            targetUser.id,
            reason,
            explanation
        );

        if (result.error) {
            return interaction.reply({
                content: result.error,
                ephemeral: true
            });
        }

        await interaction.reply({
            content: 'Your report has been submitted successfully. Our moderators will review it shortly.',
            ephemeral: true
        });
    }
}; 