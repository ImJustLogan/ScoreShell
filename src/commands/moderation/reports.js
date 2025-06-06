const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reports')
        .setDescription('View and handle pending reports')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const reports = await interaction.client.moderationManager.getPendingReports(interaction.guildId);
        
        if (!reports || reports.length === 0) {
            return interaction.reply({
                content: 'No pending reports found.',
                ephemeral: true
            });
        }

        let currentPage = 0;
        const reportsPerPage = 1; // Show one report at a time for better handling
        const totalPages = Math.ceil(reports.length / reportsPerPage);

        const generateReportEmbed = (report) => {
            const reporter = interaction.client.users.cache.get(report.reporterId);
            const target = interaction.client.users.cache.get(report.targetId);
            const moderator = report.moderatorId ? interaction.client.users.cache.get(report.moderatorId) : null;

            return new EmbedBuilder()
                .setTitle(`Report #${report._id}`)
                .setColor(report.priority === 'HIGH' ? '#ff0000' : report.priority === 'MEDIUM' ? '#ffa500' : '#ffff00')
                .addFields(
                    { name: 'Reporter', value: reporter ? `${reporter.tag} (${reporter.id})` : 'Unknown', inline: true },
                    { name: 'Target', value: target ? `${target.tag} (${target.id})` : 'Unknown', inline: true },
                    { name: 'Category', value: report.category, inline: true },
                    { name: 'Reason', value: report.reason || 'No reason provided' },
                    { name: 'Evidence', value: report.evidence || 'No evidence provided' },
                    { name: 'Status', value: report.status, inline: true },
                    { name: 'Priority', value: report.priority, inline: true },
                    { name: 'Reported At', value: `<t:${Math.floor(report.createdAt.getTime() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: `Page ${currentPage + 1}/${totalPages}` });

            if (moderator) {
                embed.addFields({ name: 'Handled By', value: `${moderator.tag}`, inline: true });
            }
            if (report.moderatorNotes) {
                embed.addFields({ name: 'Moderator Notes', value: report.moderatorNotes });
            }
        };

        const generateButtons = (report) => {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('reports_prev')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId('reports_next')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === totalPages - 1),
                    new ButtonBuilder()
                        .setCustomId('reports_resolve')
                        .setLabel('Resolve')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('reports_ban')
                        .setLabel('Ban User')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('reports_dismiss')
                        .setLabel('Dismiss')
                        .setStyle(ButtonStyle.Secondary)
                );
            return row;
        };

        const message = await interaction.reply({
            embeds: [generateReportEmbed(reports[currentPage])],
            components: [generateButtons(reports[currentPage])],
            ephemeral: true
        });

        const collector = message.createMessageComponentCollector({
            time: 300000 // 5 minutes
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({
                    content: 'Only the command user can handle reports.',
                    ephemeral: true
                });
            }

            const currentReport = reports[currentPage];

            switch (i.customId) {
                case 'reports_prev':
                    currentPage = Math.max(0, currentPage - 1);
                    break;

                case 'reports_next':
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                    break;

                case 'reports_resolve':
                    await interaction.client.moderationManager.resolveReport(currentReport._id, interaction.user.id, 'RESOLVED');
                    reports.splice(currentPage, 1);
                    if (reports.length === 0) {
                        collector.stop();
                        return i.update({
                            content: 'All reports have been handled.',
                            embeds: [],
                            components: []
                        });
                    }
                    currentPage = Math.min(currentPage, reports.length - 1);
                    break;

                case 'reports_ban':
                    await interaction.client.moderationManager.banUser(
                        currentReport.targetId,
                        interaction.guildId,
                        interaction.user.id,
                        `Banned due to report: ${currentReport.reason}`,
                        '7d' // 7 day ban by default
                    );
                    await interaction.client.moderationManager.resolveReport(currentReport._id, interaction.user.id, 'RESOLVED');
                    reports.splice(currentPage, 1);
                    if (reports.length === 0) {
                        collector.stop();
                        return i.update({
                            content: 'All reports have been handled.',
                            embeds: [],
                            components: []
                        });
                    }
                    currentPage = Math.min(currentPage, reports.length - 1);
                    break;

                case 'reports_dismiss':
                    await interaction.client.moderationManager.resolveReport(currentReport._id, interaction.user.id, 'DISMISSED');
                    reports.splice(currentPage, 1);
                    if (reports.length === 0) {
                        collector.stop();
                        return i.update({
                            content: 'All reports have been handled.',
                            embeds: [],
                            components: []
                        });
                    }
                    currentPage = Math.min(currentPage, reports.length - 1);
                    break;
            }

            await i.update({
                embeds: [generateReportEmbed(reports[currentPage])],
                components: [generateButtons(reports[currentPage])]
            });
        });

        collector.on('end', () => {
            interaction.editReply({
                components: []
            }).catch(() => {});
        });
    }
}; 