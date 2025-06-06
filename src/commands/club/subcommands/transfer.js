
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
                    content: 'Only the club owner can transfer ownership!',
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

            // Check if trying to transfer to self
            if (targetUser.id === interaction.user.id) {
                return interaction.reply({
                    content: 'You cannot transfer ownership to yourself!',
                    ephemeral: true
                });
            }

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_transfer')
                        .setLabel('Confirm Transfer')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_transfer')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send confirmation message
            const confirmEmbed = new EmbedBuilder()
                .setTitle('Transfer Club Ownership')
                .setDescription(`Are you absolutely sure you want to transfer ownership of **${club.name}** to ${targetUser.username}?\n\nThis action cannot be undone and you will lose all owner privileges!`)
                .setColor('#ff0000')
                .setThumbnail(club.icon)
                .addFields(
                    { name: 'Warning', value: 'This is a permanent action that cannot be reversed!' }
                );

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
                if (i.customId === 'confirm_transfer') {
                    try {
                        // Update club owner
                        await Club.findByIdAndUpdate(club._id, {
                            owner: targetUser.id,
                            $pull: { captains: targetUser.id } // Remove from captains if they were one
                        });

                        // Update user roles
                        await User.findOneAndUpdate(
                            { discordId: interaction.user.id },
                            { clubRole: 'MEMBER' }
                        );
                        await User.findOneAndUpdate(
                            { discordId: targetUser.id },
                            { clubRole: 'OWNER' }
                        );

                        // Send success message
                        const successEmbed = new EmbedBuilder()
                            .setTitle('Ownership Transferred')
                            .setDescription(`Ownership of **${club.name}** has been transferred to ${targetUser.username}!`)
                            .setColor('#ff0000');

                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify new owner
                        try {
                            const transferEmbed = new EmbedBuilder()
                                .setTitle('Club Ownership Transferred')
                                .setDescription(`You are now the owner of **${club.name}**!\n\nYou have full control over the club, including:\n• Managing members\n• Promoting/demoting captains\n• Club settings\n• Disbanding the club`)
                                .setColor('#ff0000')
                                .setThumbnail(club.icon);

                            await targetUser.send({ embeds: [transferEmbed] });
                        } catch (error) {
                            logger.error('Error sending transfer notification:', error);
                        }

                        // Notify old owner
                        try {
                            const oldOwnerEmbed = new EmbedBuilder()
                                .setTitle('Club Ownership Transferred')
                                .setDescription(`You have transferred ownership of **${club.name}** to ${targetUser.username}.\n\nYou are now a regular member of the club.`)
                                .setColor('#ff0000')
                                .setThumbnail(club.icon);

                            await interaction.user.send({ embeds: [oldOwnerEmbed] });
                        } catch (error) {
                            logger.error('Error sending old owner notification:', error);
                        }

                        logger.info('Club ownership transferred', {
                            oldOwnerId: interaction.user.id,
                            newOwnerId: targetUser.id,
                            clubId: club.id,
                            clubName: club.name
                        });

                    } catch (error) {
                        logger.error('Error transferring club ownership:', error);
                        await i.update({
                            content: 'An error occurred while transferring ownership. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }
                } else if (i.customId === 'cancel_transfer') {
                    await i.update({
                        content: 'Ownership transfer cancelled.',
                        embeds: [],
                        components: []
                    });
                }
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Ownership transfer confirmation timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club transfer command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 