const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('disband')
                .setDescription('Permanently delete your club (Club Owner Only)')),

    async execute(interaction) {
        try {
            // Find user's club
            const club = await Club.findOne({ owner: interaction.user.id });
            if (!club) {
                return interaction.reply({
                    content: 'You must be a club owner to use this command.',
                    ephemeral: true
                });
            }

            // Create confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('⚠️ Disband Club')
                .setDescription(`Are you sure you want to permanently disband **${club.name}**?`)
                .addFields(
                    { 
                        name: 'This action will:', 
                        value: [
                            '• Permanently delete the club',
                            '• Remove all members from the club',
                            '• Delete all club data and statistics',
                            '• Cannot be undone'
                        ].join('\n'),
                        inline: false 
                    },
                    { 
                        name: 'Club Details', 
                        value: [
                            `**Members:** ${club.memberCount}/10`,
                            `**Captains:** ${club.captains.length}`,
                            `**Total Trophies:** ${club.stats.trophies}`,
                            `**Club ID:** ${club.clubId}`
                        ].join('\n'),
                        inline: true 
                    }
                )
                .setFooter({ text: 'This action is permanent and cannot be undone!' });

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('club_disband_confirm')
                        .setLabel('Disband Club')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('club_disband_cancel')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send confirmation message
            const message = await interaction.reply({
                embeds: [confirmEmbed],
                components: [confirmRow],
                ephemeral: true
            });

            // Create collector for confirmation
            const filter = i => i.user.id === interaction.user.id;
            const collector = message.createMessageComponentCollector({ 
                filter, 
                time: 60000 // 1 minute
            });

            collector.on('collect', async i => {
                if (i.customId === 'club_disband_confirm') {
                    try {
                        // Get all members for notification
                        const members = [...club.members];
                        const captains = [...club.captains];

                        // Delete the club
                        await Club.deleteOne({ _id: club._id });

                        // Create success embed
                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Club Disbanded')
                            .setDescription(`**${club.name}** has been permanently disbanded.`)
                            .addFields(
                                { 
                                    name: 'Club Information', 
                                    value: [
                                        `**Club ID:** ${club.clubId}`,
                                        `**Members Affected:** ${members.length}`,
                                        `**Captains Affected:** ${captains.length}`,
                                        `**Trophies Lost:** ${club.stats.trophies}`
                                    ].join('\n'),
                                    inline: false 
                                }
                            );

                        // Update confirmation message
                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify all members
                        for (const member of members) {
                            try {
                                const user = await interaction.client.users.fetch(member.userId);
                                await user.send({
                                    embeds: [new EmbedBuilder()
                                        .setColor('#ff0000')
                                        .setTitle('Club Disbanded')
                                        .setDescription(`**${club.name}** has been disbanded by the club owner.`)
                                        .addFields(
                                            { 
                                                name: 'Club Information', 
                                                value: [
                                                    `**Club ID:** ${club.clubId}`,
                                                    `**Trophies Lost:** ${club.stats.trophies}`
                                                ].join('\n'),
                                                inline: false 
                                            }
                                        )]
                                });
                            } catch (error) {
                                logger.error(`Error notifying member ${member.userId} of club disband:`, error);
                            }
                        }

                        // Log the disband action
                        logger.info(`Club ${club.name} (${club.clubId}) disbanded by owner ${interaction.user.tag} (${interaction.user.id})`);

                    } catch (error) {
                        logger.error('Error disbanding club:', error);
                        await i.reply({
                            content: 'An error occurred while disbanding the club. Please try again.',
                            ephemeral: true
                        });
                    }
                } else if (i.customId === 'club_disband_cancel') {
                    await i.update({
                        embeds: [confirmEmbed.setDescription('Club disband cancelled.')],
                        components: []
                    });
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        embeds: [confirmEmbed.setDescription('Disband confirmation timed out.')],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club disband command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the disband command.',
                ephemeral: true
            });
        }
    }
}; 