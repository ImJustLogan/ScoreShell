const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('banlist')
        .setDescription('View all banned users in this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const bans = await interaction.client.moderationManager.getServerBans(interaction.guildId);
        
        if (!bans || bans.length === 0) {
            return interaction.reply({
                content: 'No banned users found in this server.',
                ephemeral: true
            });
        }

        let currentPage = 0;
        const bansPerPage = 5;
        const totalPages = Math.ceil(bans.length / bansPerPage);

        const generateBanEmbed = () => {
            const embed = new EmbedBuilder()
                .setTitle('Server Ban List')
                .setColor('#ff0000')
                .setFooter({ text: `Page ${currentPage + 1}/${totalPages}` });

            const start = currentPage * bansPerPage;
            const end = Math.min(start + bansPerPage, bans.length);

            for (let i = start; i < end; i++) {
                const ban = bans[i];
                const user = interaction.client.users.cache.get(ban.userId);
                const moderator = interaction.client.users.cache.get(ban.moderatorId);
                const unbannedBy = ban.unbannedBy ? interaction.client.users.cache.get(ban.unbannedBy) : null;

                let banInfo = `**User:** ${user ? user.tag : 'Unknown'} (${ban.userId})\n`;
                banInfo += `**Reason:** ${ban.reason}\n`;
                banInfo += `**Banned By:** ${moderator ? moderator.tag : 'Unknown'}\n`;
                banInfo += `**Banned At:** <t:${Math.floor(ban.createdAt.getTime() / 1000)}:R>\n`;
                
                if (ban.expiresAt) {
                    banInfo += `**Expires:** <t:${Math.floor(ban.expiresAt.getTime() / 1000)}:R>\n`;
                }
                
                if (ban.unbannedAt) {
                    banInfo += `**Unbanned By:** ${unbannedBy ? unbannedBy.tag : 'Unknown'}\n`;
                    banInfo += `**Unbanned At:** <t:${Math.floor(ban.unbannedAt.getTime() / 1000)}:R>\n`;
                    if (ban.unbanReason) {
                        banInfo += `**Unban Reason:** ${ban.unbanReason}\n`;
                    }
                }

                embed.addFields({
                    name: `Ban #${i + 1}`,
                    value: banInfo,
                    inline: false
                });
            }

            return embed;
        };

        const generateButtons = () => {
            return new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('banlist_prev')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId('banlist_next')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === totalPages - 1)
                );
        };

        const message = await interaction.reply({
            embeds: [generateBanEmbed()],
            components: [generateButtons()],
            ephemeral: true
        });

        const collector = message.createMessageComponentCollector({
            time: 300000 // 5 minutes
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({
                    content: 'Only the command user can navigate the ban list.',
                    ephemeral: true
                });
            }

            switch (i.customId) {
                case 'banlist_prev':
                    currentPage = Math.max(0, currentPage - 1);
                    break;

                case 'banlist_next':
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                    break;
            }

            await i.update({
                embeds: [generateBanEmbed()],
                components: [generateButtons()]
            });
        });

        collector.on('end', () => {
            interaction.editReply({
                components: []
            }).catch(() => {});
        });
    }
}; 