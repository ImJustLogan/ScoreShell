
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../../../utils/logger');
const User = require('../../../models/User');
const Club = require('../../../models/Club');

module.exports = {
    async execute(interaction, { CLUB_ICONS, PRIVACY_TYPES }) {
        try {
            // Get user's club
            const user = await User.findOne({ discordId: interaction.user.id });
            if (!user?.club) {
                return interaction.reply({
                    content: 'You are not in a club!',
                    ephemeral: true
                });
            }

            // Get club details
            const club = await Club.findById(user.club);
            if (!club) {
                return interaction.reply({
                    content: 'Club not found. Please contact an administrator.',
                    ephemeral: true
                });
            }

            // Check if user is the club owner
            if (club.owner === interaction.user.id) {
                return interaction.reply({
                    content: 'You cannot leave the club as the owner! Use `/club transfer` to transfer ownership first, or `/club disband` to disband the club.',
                    ephemeral: true
                });
            }

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_leave')
                        .setLabel('Leave Club')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_leave')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send confirmation message
            const confirmEmbed = new EmbedBuilder()
                .setTitle('Leave Club')
                .setDescription(`Are you sure you want to leave **${club.name}**?\n\nThis action cannot be undone!`)
                .setColor('#ff0000')
                .setThumbnail(club.icon);

            const response = await interaction.reply({
                embeds: [confirmEmbed],
                components: [confirmRow],
                ephemeral: true
            });

            // Create button collector
            const collector = response.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 30000 // 30 seconds
            });

            collector.on('collect', async (i) => {
                if (i.customId === 'confirm_leave') {
                    try {
                        // Remove user from club
                        await Club.findByIdAndUpdate(club._id, {
                            $pull: { 
                                members: interaction.user.id,
                                captains: interaction.user.id // Also remove from captains if they were one
                            }
                        });

                        // Update user's club status
                        await User.findOneAndUpdate(
                            { discordId: interaction.user.id },
                            { 
                                $unset: { club: 1 },
                                clubRole: 'NONE'
                            }
                        );

                        // Send success message
                        const successEmbed = new EmbedBuilder()
                            .setTitle('Left Club')
                            .setDescription(`You have left **${club.name}**!`)
                            .setColor('#ff0000');

                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify club owner
                        try {
                            const ownerEmbed = new EmbedBuilder()
                                .setTitle('Member Left')
                                .setDescription(`${interaction.user.username} has left **${club.name}**!`)
                                .setColor('#ff0000')
                                .setThumbnail(club.icon);

                            await interaction.client.users.send(club.owner, { embeds: [ownerEmbed] });
                        } catch (error) {
                            logger.error('Error sending owner notification:', error);
                        }

                        logger.info('User left club', {
                            userId: interaction.user.id,
                            clubId: club.id,
                            clubName: club.name
                        });

                    } catch (error) {
                        logger.error('Error removing user from club:', error);
                        await i.update({
                            content: 'An error occurred while leaving the club. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }
                } else if (i.customId === 'cancel_leave') {
                    await i.update({
                        content: 'Club leave cancelled.',
                        embeds: [],
                        components: []
                    });
                }
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Leave confirmation timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club leave command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 