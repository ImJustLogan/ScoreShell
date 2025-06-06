
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../../../utils/logger');
const User = require('../../../models/User');
const Club = require('../../../models/Club');

module.exports = {
    async execute(interaction, { CLUB_ICONS, PRIVACY_TYPES }) {
        try {
            const targetUser = interaction.options.getUser('user');

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
            if (club.owner !== interaction.user.id) {
                return interaction.reply({
                    content: 'Only the club owner can demote captains!',
                    ephemeral: true
                });
            }

            // Check if target user is in the club
            const targetUserData = await User.findOne({ discordId: targetUser.id });
            if (!targetUserData?.club || targetUserData.club.toString() !== club._id.toString()) {
                return interaction.reply({
                    content: `${targetUser.username} is not a member of your club!`,
                    ephemeral: true
                });
            }

            // Check if user is actually a captain
            if (!club.captains.includes(targetUser.id)) {
                return interaction.reply({
                    content: `${targetUser.username} is not a club captain!`,
                    ephemeral: true
                });
            }

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_demote')
                        .setLabel('Confirm')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_demote')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send confirmation message
            const confirmEmbed = new EmbedBuilder()
                .setTitle('Demote Captain')
                .setDescription(`Are you sure you want to demote ${targetUser.username} from captain of **${club.name}**?`)
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
                if (i.customId === 'confirm_demote') {
                    try {
                        // Remove user from club captains
                        await Club.findByIdAndUpdate(club._id, {
                            $pull: { captains: targetUser.id }
                        });

                        // Update user's club role
                        await User.findOneAndUpdate(
                            { discordId: targetUser.id },
                            { clubRole: 'MEMBER' }
                        );

                        // Send success message
                        const successEmbed = new EmbedBuilder()
                            .setTitle('Captain Demoted')
                            .setDescription(`${targetUser.username} has been demoted from captain of **${club.name}**!`)
                            .setColor('#ff0000');

                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify demoted user
                        try {
                            const demoteEmbed = new EmbedBuilder()
                                .setTitle('Demoted from Captain')
                                .setDescription(`You have been demoted from captain of **${club.name}**!`)
                                .setColor('#ff0000')
                                .setThumbnail(club.icon);

                            await targetUser.send({ embeds: [demoteEmbed] });
                        } catch (error) {
                            logger.error('Error sending demotion notification:', error);
                        }

                        logger.info('User demoted from captain', {
                            userId: targetUser.id,
                            clubId: club.id,
                            clubName: club.name,
                            demotedBy: interaction.user.id
                        });

                    } catch (error) {
                        logger.error('Error demoting user from captain:', error);
                        await i.update({
                            content: 'An error occurred while demoting the captain. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }
                } else if (i.customId === 'cancel_demote') {
                    await i.update({
                        content: 'Demotion cancelled.',
                        embeds: [],
                        components: []
                    });
                }
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Demotion confirmation timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club demote command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 