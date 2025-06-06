
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
                    content: 'Only the club owner can promote members to captain!',
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

            // Check if user is already a captain
            if (club.captains.includes(targetUser.id)) {
                return interaction.reply({
                    content: `${targetUser.username} is already a club captain!`,
                    ephemeral: true
                });
            }

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_promote')
                        .setLabel('Confirm')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('cancel_promote')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send confirmation message
            const confirmEmbed = new EmbedBuilder()
                .setTitle('Promote to Captain')
                .setDescription(`Are you sure you want to promote ${targetUser.username} to captain of **${club.name}**?`)
                .setColor('#0099ff')
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
                if (i.customId === 'confirm_promote') {
                    try {
                        // Add user to club captains
                        await Club.findByIdAndUpdate(club._id, {
                            $push: { captains: targetUser.id }
                        });

                        // Update user's club role
                        await User.findOneAndUpdate(
                            { discordId: targetUser.id },
                            { clubRole: 'CAPTAIN' }
                        );

                        // Send success message
                        const successEmbed = new EmbedBuilder()
                            .setTitle('Member Promoted')
                            .setDescription(`${targetUser.username} has been promoted to captain of **${club.name}**!`)
                            .setColor('#00ff00');

                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify promoted user
                        try {
                            const promoteEmbed = new EmbedBuilder()
                                .setTitle('Promoted to Captain')
                                .setDescription(`You have been promoted to captain of **${club.name}**!`)
                                .setColor('#00ff00')
                                .setThumbnail(club.icon);

                            await targetUser.send({ embeds: [promoteEmbed] });
                        } catch (error) {
                            logger.error('Error sending promotion notification:', error);
                        }

                        logger.info('User promoted to captain', {
                            userId: targetUser.id,
                            clubId: club.id,
                            clubName: club.name,
                            promotedBy: interaction.user.id
                        });

                    } catch (error) {
                        logger.error('Error promoting user to captain:', error);
                        await i.update({
                            content: 'An error occurred while promoting the member. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }
                } else if (i.customId === 'cancel_promote') {
                    await i.update({
                        content: 'Promotion cancelled.',
                        embeds: [],
                        components: []
                    });
                }
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Promotion confirmation timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club promote command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 