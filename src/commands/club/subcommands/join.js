
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../../../utils/logger');
const User = require('../../../models/User');
const Club = require('../../../models/Club');

module.exports = {
    async execute(interaction, { CLUB_ICONS, PRIVACY_TYPES }) {
        try {
            const clubId = interaction.options.getString('club_id').toUpperCase();

            // Check if user is already in a club
            const user = await User.findOne({ discordId: interaction.user.id });
            if (user?.club) {
                return interaction.reply({
                    content: 'You are already in a club! Use `/club leave` to leave your current club first.',
                    ephemeral: true
                });
            }

            // Find the club
            const club = await Club.findOne({ clubId });
            if (!club) {
                return interaction.reply({
                    content: 'Club not found! Please check the club ID and try again.',
                    ephemeral: true
                });
            }

            // Check if club is full
            const memberCount = await User.countDocuments({ club: club._id });
            if (memberCount >= 10) {
                return interaction.reply({
                    content: 'This club is full! (10/10 members)',
                    ephemeral: true
                });
            }

            // Check if club is invite-only
            if (club.privacy === 'INVITE_ONLY') {
                // Check if user has a pending invite
                const hasInvite = club.pendingInvites?.includes(interaction.user.id);
                if (!hasInvite) {
                    return interaction.reply({
                        content: 'This club is invite-only! You need to be invited by the club owner or a captain.',
                        ephemeral: true
                    });
                }
            }

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_join')
                        .setLabel('Join Club')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('cancel_join')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send confirmation message
            const confirmEmbed = new EmbedBuilder()
                .setTitle('Join Club')
                .setDescription(`Are you sure you want to join **${club.name}**?\n\nClub Info:\n• Owner: <@${club.owner}>\n• Privacy: ${club.privacy}\n• Members: ${memberCount}/10`)
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
                if (i.customId === 'confirm_join') {
                    try {
                        // Double check club is not full
                        const currentMemberCount = await User.countDocuments({ club: club._id });
                        if (currentMemberCount >= 10) {
                            await i.update({
                                content: 'This club is now full! (10/10 members)',
                                embeds: [],
                                components: []
                            });
                            return;
                        }

                        // Add user to club
                        await Club.findByIdAndUpdate(club._id, {
                            $push: { members: interaction.user.id },
                            $pull: { pendingInvites: interaction.user.id } // Remove from pending invites if they were invited
                        });

                        // Update user's club status
                        await User.findOneAndUpdate(
                            { discordId: interaction.user.id },
                            { 
                                club: club._id,
                                clubRole: 'MEMBER'
                            }
                        );

                        // Send success message
                        const successEmbed = new EmbedBuilder()
                            .setTitle('Joined Club')
                            .setDescription(`You have joined **${club.name}**!\n\nUse \`/club info\` to view club details.`)
                            .setColor('#00ff00');

                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify club owner
                        try {
                            const ownerEmbed = new EmbedBuilder()
                                .setTitle('New Member Joined')
                                .setDescription(`${interaction.user.username} has joined **${club.name}**!`)
                                .setColor('#00ff00')
                                .setThumbnail(club.icon);

                            await interaction.client.users.send(club.owner, { embeds: [ownerEmbed] });
                        } catch (error) {
                            logger.error('Error sending owner notification:', error);
                        }

                        logger.info('User joined club', {
                            userId: interaction.user.id,
                            clubId: club.id,
                            clubName: club.name
                        });

                    } catch (error) {
                        logger.error('Error adding user to club:', error);
                        await i.update({
                            content: 'An error occurred while joining the club. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }
                } else if (i.customId === 'cancel_join') {
                    await i.update({
                        content: 'Club join cancelled.',
                        embeds: [],
                        components: []
                    });
                }
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Join confirmation timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club join command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 