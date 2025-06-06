
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

            // Check if user has permission to kick (owner or captain)
            if (club.owner !== interaction.user.id && !club.captains.includes(interaction.user.id)) {
                return interaction.reply({
                    content: 'Only club owners and captains can remove members!',
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

            // Prevent kicking the owner
            if (club.owner === targetUser.id) {
                return interaction.reply({
                    content: 'You cannot kick the club owner!',
                    ephemeral: true
                });
            }

            // Prevent kicking other captains (unless you're the owner)
            if (club.captains.includes(targetUser.id) && club.owner !== interaction.user.id) {
                return interaction.reply({
                    content: 'Only the club owner can kick captains!',
                    ephemeral: true
                });
            }

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_kick')
                        .setLabel('Confirm')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_kick')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send confirmation message
            const confirmEmbed = new EmbedBuilder()
                .setTitle('Remove Member')
                .setDescription(`Are you sure you want to remove ${targetUser.username} from **${club.name}**?`)
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
                if (i.customId === 'confirm_kick') {
                    try {
                        // Remove user from club
                        await User.findOneAndUpdate(
                            { discordId: targetUser.id },
                            { $unset: { club: "", clubRole: "" } }
                        );

                        // Remove user from club members and captains
                        await Club.findByIdAndUpdate(club._id, {
                            $pull: { 
                                members: targetUser.id,
                                captains: targetUser.id
                            }
                        });

                        // Send success message
                        const successEmbed = new EmbedBuilder()
                            .setTitle('Member Removed')
                            .setDescription(`${targetUser.username} has been removed from **${club.name}**.`)
                            .setColor('#ff0000');

                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify kicked user
                        try {
                            const kickEmbed = new EmbedBuilder()
                                .setTitle('Removed from Club')
                                .setDescription(`You have been removed from **${club.name}**.`)
                                .setColor('#ff0000')
                                .setThumbnail(club.icon);

                            await targetUser.send({ embeds: [kickEmbed] });
                        } catch (error) {
                            logger.error('Error sending kick notification:', error);
                        }

                        logger.info('User kicked from club', {
                            userId: targetUser.id,
                            clubId: club.id,
                            clubName: club.name,
                            kickedBy: interaction.user.id
                        });

                    } catch (error) {
                        logger.error('Error kicking user from club:', error);
                        await i.update({
                            content: 'An error occurred while removing the member. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }
                } else if (i.customId === 'cancel_kick') {
                    await i.update({
                        content: 'Member removal cancelled.',
                        embeds: [],
                        components: []
                    });
                }
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Kick confirmation timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club kick command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 