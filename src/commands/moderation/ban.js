const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from ranked matches')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to ban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the ban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Ban duration (e.g., 1d, 1w, permanent)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('global')
                .setDescription('Apply ban globally across all servers')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const duration = interaction.options.getString('duration');
        const isGlobal = interaction.options.getBoolean('global') || false;

        // Prevent self-banning
        if (targetUser.id === interaction.user.id) {
            return interaction.reply({
                content: 'You cannot ban yourself!',
                ephemeral: true
            });
        }

        // Parse duration
        let durationInSeconds = null;
        if (duration && duration.toLowerCase() !== 'permanent') {
            const match = duration.match(/^(\d+)([dw])$/);
            if (!match) {
                return interaction.reply({
                    content: 'Invalid duration format. Use format like "1d" for days or "1w" for weeks, or "permanent" for permanent ban.',
                    ephemeral: true
                });
            }

            const [, amount, unit] = match;
            durationInSeconds = parseInt(amount) * (unit === 'd' ? 86400 : 604800);
        }

        // Check if user is already banned
        const existingBan = await interaction.client.moderationManager.getActiveBans(
            isGlobal ? null : interaction.guildId
        ).then(bans => bans.find(ban => ban.userId === targetUser.id));

        if (existingBan) {
            return interaction.reply({
                content: `This user is already banned${existingBan.type === 'GLOBAL' ? ' globally' : ''}.`,
                ephemeral: true
            });
        }

        // Ban the user
        const result = await interaction.client.moderationManager.banUser(
            interaction.guildId,
            targetUser.id,
            interaction.user.id,
            reason,
            durationInSeconds,
            isGlobal ? 'GLOBAL' : 'SERVER'
        );

        if (result.error) {
            return interaction.reply({
                content: result.error,
                ephemeral: true
            });
        }

        const durationText = durationInSeconds 
            ? `for ${duration}` 
            : 'permanently';

        await interaction.reply({
            content: `Successfully banned ${targetUser.tag} ${durationText}${isGlobal ? ' globally' : ''}.`,
            ephemeral: true
        });
    }
}; 