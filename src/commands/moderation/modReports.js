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
        .setName('mod')
        .setDescription('Moderation commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reports')
                .setDescription('View and manage user reports')
                .addStringOption(option =>
                    option.setName('status')
                        .setDescription('Filter reports by status')
                        .addChoices(
                            { name: 'Pending', value: 'PENDING' },
                            { name: 'Resolved', value: 'RESOLVED' },
                            { name: 'Dismissed', value: 'DISMISSED' }
                        ))
                .addIntegerOption(option =>
                    option.setName('page')
                        .setDescription('Page number')
                        .setMinValue(1))),

    async execute(interaction) {
        try {
            // Check if user has admin role
            const serverConfig = await interaction.client.db.collection('serverConfigs')
                .findOne({ guildId: interaction.guildId });

            if (!serverConfig?.adminRole) {
                return interaction.reply({
                    content: 'This server has not been set up for moderation.',
                    ephemeral: true
                });
            }

            const member = await interaction.guild.members.fetch(interaction.user.id);
            if (!member.roles.cache.has(serverConfig.adminRole)) {
                return interaction.reply({
                    content: 'You do not have permission to use this command.',
                    ephemeral: true
                });
            }

            const status = interaction.options.getString('status') || 'PENDING';
            const page = interaction.options.getInteger('page') || 1;
            const limit = 5;
            const skip = (page - 1) * limit;

            // Get reports
            const [reports, totalReports] = await Promise.all([
                Report.find({ 
                    serverId: interaction.guildId,
                    status 
                })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('reporter', 'discordId username')
                .populate('reportedUser', 'discordId username')
                .populate('resolvedBy', 'discordId username'),
                Report.countDocuments({ 
                    serverId: interaction.guildId,
                    status 
                })
            ]);

            if (reports.length === 0) {
                return interaction.reply({
                    content: `No ${status.toLowerCase()} reports found.`,
                    ephemeral: true
                });
            }

            const totalPages = Math.ceil(totalReports / limit);

            // Create embed for each report
            const reportEmbeds = await Promise.all(reports.map(async (report) => {
                const reporter = await interaction.client.users.fetch(report.reporter.discordId);
                const reportedUser = await interaction.client.users.fetch(report.reportedUser.discordId);
                const resolver = report.resolvedBy ? 
                    await interaction.client.users.fetch(report.resolvedBy.discordId) : null;

                const embed = new EmbedBuilder()
                    .setColor(status === 'PENDING' ? '#ff0000' : 
                             status === 'RESOLVED' ? '#00ff00' : '#808080')
                    .setTitle(`Report #${report._id}`)
                    .setDescription(`Status: ${status}`)
                    .addFields(
                        { 
                            name: 'Reported User', 
                            value: `${reportedUser} (${reportedUser.tag})`,
                            inline: true 
                        },
                        { 
                            name: 'Reporter', 
                            value: `${reporter} (${reporter.tag})`,
                            inline: true 
                        },
                        { 
                            name: 'Reason', 
                            value: report.reason.replace('_', ' '),
                            inline: true 
                        },
                        { 
                            name: 'Explanation', 
                            value: report.explanation || 'No explanation provided'
                        }
                    )
                    .setTimestamp(report.createdAt);

                if (status !== 'PENDING') {
                    embed.addFields(
                        { 
                            name: 'Resolved By', 
                            value: resolver ? `${resolver} (${resolver.tag})` : 'Unknown',
                            inline: true 
                        },
                        { 
                            name: 'Resolution', 
                            value: report.resolution || 'None',
                            inline: true 
                        },
                        { 
                            name: 'Resolution Note', 
                            value: report.resolutionNote || 'No note provided'
                        }
                    );
                }

                return embed;
            }));

            // Create navigation buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev_page')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === 1),
                    new ButtonBuilder()
                        .setCustomId('next_page')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === totalPages),
                    new ButtonBuilder()
                        .setCustomId('resolve')
                        .setLabel('Resolve')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(status !== 'PENDING'),
                    new ButtonBuilder()
                        .setCustomId('dismiss')
                        .setLabel('Dismiss')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(status !== 'PENDING')
                );

            // Send initial message
            const message = await interaction.reply({
                embeds: [reportEmbeds[0]],
                components: [row],
                ephemeral: true
            });

            // Create collector for button interactions
            const collector = message.createMessageComponentCollector({
                time: 300000 // 5 minutes
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({
                        content: 'You cannot use these buttons.',
                        ephemeral: true
                    });
                }

                if (i.customId === 'prev_page' || i.customId === 'next_page') {
                    const newPage = i.customId === 'prev_page' ? page - 1 : page + 1;
                    const newSkip = (newPage - 1) * limit;

                    const newReports = await Report.find({
                        serverId: interaction.guildId,
                        status
                    })
                    .sort({ createdAt: -1 })
                    .skip(newSkip)
                    .limit(limit)
                    .populate('reporter', 'discordId username')
                    .populate('reportedUser', 'discordId username')
                    .populate('resolvedBy', 'discordId username');

                    const newEmbeds = await Promise.all(newReports.map(async (report) => {
                        // ... (same embed creation code as above)
                        // Reuse the embed creation code from above
                    }));

                    const newRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('prev_page')
                                .setLabel('Previous')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(newPage === 1),
                            new ButtonBuilder()
                                .setCustomId('next_page')
                                .setLabel('Next')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(newPage === totalPages),
                            new ButtonBuilder()
                                .setCustomId('resolve')
                                .setLabel('Resolve')
                                .setStyle(ButtonStyle.Success)
                                .setDisabled(status !== 'PENDING'),
                            new ButtonBuilder()
                                .setCustomId('dismiss')
                                .setLabel('Dismiss')
                                .setStyle(ButtonStyle.Danger)
                                .setDisabled(status !== 'PENDING')
                        );

                    await i.update({
                        embeds: [newEmbeds[0]],
                        components: [newRow]
                    });

                } else if (i.customId === 'resolve' || i.customId === 'dismiss') {
                    const modal = new ModalBuilder()
                        .setCustomId(`mod_action_${i.customId}`)
                        .setTitle(i.customId === 'resolve' ? 'Resolve Report' : 'Dismiss Report');

                    const noteInput = new TextInputBuilder()
                        .setCustomId('note')
                        .setLabel('Add a note about your decision')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMaxLength(1000);

                    if (i.customId === 'resolve') {
                        const resolutionInput = new TextInputBuilder()
                            .setCustomId('resolution')
                            .setLabel('Resolution (WARNING or BAN)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setPlaceholder('WARNING or BAN')
                            .setMaxLength(10);

                        modal.addComponents(
                            new ActionRowBuilder().addComponents(resolutionInput),
                            new ActionRowBuilder().addComponents(noteInput)
                        );
                    } else {
                        modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
                    }

                    await i.showModal(modal);

                    const filter = m => m.customId.startsWith('mod_action_') && m.user.id === i.user.id;
                    const modalSubmit = await i.awaitModalSubmit({ filter, time: 300000 });

                    const note = modalSubmit.fields.getTextInputValue('note');
                    const resolution = i.customId === 'resolve' ? 
                        modalSubmit.fields.getTextInputValue('resolution').toUpperCase() : 'DISMISSED';

                    if (i.customId === 'resolve' && !['WARNING', 'BAN'].includes(resolution)) {
                        return modalSubmit.reply({
                            content: 'Invalid resolution. Must be either WARNING or BAN.',
                            ephemeral: true
                        });
                    }

                    const currentReport = reports[0];
                    if (i.customId === 'resolve') {
                        await currentReport.resolve(interaction.user.id, resolution, note);
                        
                        if (resolution === 'BAN') {
                            // Ban the user
                            await interaction.client.db.collection('users').updateOne(
                                { _id: currentReport.reportedUser._id },
                                { 
                                    $set: { 
                                        isBanned: true,
                                        banReason: note,
                                        banExpires: null // Permanent ban
                                    }
                                }
                            );
                        }
                    } else {
                        await currentReport.dismiss(interaction.user.id, note);
                    }

                    // Update the embed to show the resolution
                    const updatedEmbed = reportEmbeds[0]
                        .setColor(i.customId === 'resolve' ? '#00ff00' : '#808080')
                        .setDescription(`Status: ${i.customId === 'resolve' ? 'RESOLVED' : 'DISMISSED'}`)
                        .addFields(
                            { 
                                name: 'Resolved By', 
                                value: `${interaction.user} (${interaction.user.tag})`,
                                inline: true 
                            },
                            { 
                                name: 'Resolution', 
                                value: resolution,
                                inline: true 
                            },
                            { 
                                name: 'Resolution Note', 
                                value: note
                            }
                        );

                    // Disable all buttons
                    const disabledRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('prev_page')
                                .setLabel('Previous')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId('next_page')
                                .setLabel('Next')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId('resolve')
                                .setLabel('Resolve')
                                .setStyle(ButtonStyle.Success)
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId('dismiss')
                                .setLabel('Dismiss')
                                .setStyle(ButtonStyle.Danger)
                                .setDisabled(true)
                        );

                    await modalSubmit.update({
                        embeds: [updatedEmbed],
                        components: [disabledRow]
                    });

                    // Notify the reported user
                    const reportedUser = await interaction.client.users.fetch(currentReport.reportedUser.discordId);
                    try {
                        await reportedUser.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(i.customId === 'resolve' ? '#00ff00' : '#808080')
                                    .setTitle('Report Resolution')
                                    .setDescription(`A report against you has been ${i.customId === 'resolve' ? 'resolved' : 'dismissed'}.`)
                                    .addFields(
                                        { 
                                            name: 'Resolution', 
                                            value: resolution,
                                            inline: true 
                                        },
                                        { 
                                            name: 'Note', 
                                            value: note
                                        }
                                    )
                                    .setTimestamp()
                            ]
                        });
                    } catch (error) {
                        logger.error('Error sending resolution DM:', error);
                    }
                }
            });

            collector.on('end', () => {
                // Disable all buttons when collector expires
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('prev_page')
                            .setLabel('Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('next_page')
                            .setLabel('Next')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('resolve')
                            .setLabel('Resolve')
                            .setStyle(ButtonStyle.Success)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('dismiss')
                            .setLabel('Dismiss')
                            .setStyle(ButtonStyle.Danger)
                            .setDisabled(true)
                    );

                interaction.editReply({
                    components: [disabledRow]
                }).catch(() => {});
            });

        } catch (error) {
            logger.error('Error in mod reports command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the command.',
                ephemeral: true
            });
        }
    }
}; 