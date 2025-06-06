const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from ranked matches')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to unban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unbanning')
                .setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        // Check if user is actually banned
        const ban = await interaction.client.moderationManager.getUserBan(targetUser.id, interaction.guildId);
        if (!ban) {
            return interaction.reply({
                content: `${targetUser.tag} is not banned in this server.`,
                ephemeral: true
            });
        }

        // Unban the user
        try {
            await interaction.client.moderationManager.unbanUser(targetUser.id, interaction.guildId, interaction.user.id, reason);
            
            // Notify the user if possible
            try {
                await targetUser.send(`You have been unbanned from ranked matches in ${interaction.guild.name}.\nReason: ${reason}`);
            } catch (error) {
                // User might have DMs disabled, that's okay
            }

            // Notify the owner about the unban
            const owner = await interaction.client.users.fetch('816854656097583135');
            if (owner) {
                await owner.send({
                    content: `**Unban Notification**\nUser ${targetUser.tag} (${targetUser.id}) has been unbanned from ${interaction.guild.name} (${interaction.guild.id})\nUnbanned by: ${interaction.user.tag} (${interaction.user.id})\nReason: ${reason}`
                });
            }

            return interaction.reply({
                content: `Successfully unbanned ${targetUser.tag} from ranked matches.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error unbanning user:', error);
            return interaction.reply({
                content: 'An error occurred while trying to unban the user. Please try again later.',
                ephemeral: true
            });
        }
    }
}; 