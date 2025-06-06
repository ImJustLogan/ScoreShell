
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

            // Check if user has permission to invite (owner or captain)
            if (club.owner !== interaction.user.id && !club.captains.includes(interaction.user.id)) {
                return interaction.reply({
                    content: 'Only club owners and captains can invite members!',
                    ephemeral: true
                });
            }

            // Check if target user is already in a club
            const targetUserData = await User.findOne({ discordId: targetUser.id });
            if (targetUserData?.club) {
                return interaction.reply({
                    content: `${targetUser.username} is already in a club!`,
                    ephemeral: true
                });
            }

            // Check if club is at member limit
            if (club.members.length >= 10) {
                return interaction.reply({
                    content: 'Your club has reached the maximum member limit of 10!',
                    ephemeral: true
                });
            }

            // Check if club is invite-only
            if (club.privacy !== 'INVITE') {
                return interaction.reply({
                    content: 'Your club is not set to invite-only mode! Use club settings to change this.',
                    ephemeral: true
                });
            }

            // Create invite buttons
            const inviteRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('accept_invite')
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('decline_invite')
                        .setLabel('Decline')
                        .setStyle(ButtonStyle.Danger)
                );

            // Create invite embed
            const inviteEmbed = new EmbedBuilder()
                .setTitle('Club Invitation')
                .setDescription(`${interaction.user.username} has invited you to join **${club.name}**!`)
                .addFields(
                    { name: 'Club ID', value: club.id, inline: true },
                    { name: 'Members', value: `${club.members.length}/10`, inline: true }
                )
                .setColor('#0099ff')
                .setThumbnail(club.icon);

            try {
                // Send invite to target user
                await targetUser.send({
                    embeds: [inviteEmbed],
                    components: [inviteRow]
                });

                // Send confirmation to inviter
                await interaction.reply({
                    content: `Invitation sent to ${targetUser.username}!`,
                    ephemeral: true
                });

                // Create collector for invite response
                const filter = i => (i.customId === 'accept_invite' || i.customId === 'decline_invite') && i.user.id === targetUser.id;
                const collector = targetUser.dmChannel.createMessageComponentCollector({
                    filter,
                    time: 300000 // 5 minutes
                });

                collector.on('collect', async (i) => {
                    if (i.customId === 'accept_invite') {
                        try {
                            // Check if club still exists and has space
                            const updatedClub = await Club.findById(club._id);
                            if (!updatedClub) {
                                await i.update({
                                    content: 'This club no longer exists.',
                                    embeds: [],
                                    components: []
                                });
                                return;
                            }

                            if (updatedClub.members.length >= 10) {
                                await i.update({
                                    content: 'This club is now full.',
                                    embeds: [],
                                    components: []
                                });
                                return;
                            }

                            // Add user to club
                            await User.findOneAndUpdate(
                                { discordId: targetUser.id },
                                { 
                                    club: club._id,
                                    clubRole: 'MEMBER'
                                }
                            );

                            // Add user to club members
                            await Club.findByIdAndUpdate(club._id, {
                                $push: { members: targetUser.id }
                            });

                            // Send success message to user
                            const successEmbed = new EmbedBuilder()
                                .setTitle('Welcome to the Club!')
                                .setDescription(`You have joined **${club.name}**!`)
                                .setColor('#00ff00')
                                .setThumbnail(club.icon);

                            await i.update({
                                embeds: [successEmbed],
                                components: []
                            });

                            // Notify club owner
                            const owner = await interaction.client.users.fetch(club.owner);
                            if (owner) {
                                await owner.send(`${targetUser.username} has joined your club!`);
                            }

                            logger.info('User joined club', {
                                userId: targetUser.id,
                                clubId: club.id,
                                clubName: club.name
                            });

                        } catch (error) {
                            logger.error('Error accepting club invite:', error);
                            await i.update({
                                content: 'An error occurred while joining the club. Please try again.',
                                embeds: [],
                                components: []
                            });
                        }
                    } else if (i.customId === 'decline_invite') {
                        await i.update({
                            content: 'You have declined the club invitation.',
                            embeds: [],
                            components: []
                        });

                        // Notify inviter
                        await interaction.followUp({
                            content: `${targetUser.username} has declined your club invitation.`,
                            ephemeral: true
                        });
                    }
                    collector.stop();
                });

                collector.on('end', async (collected, reason) => {
                    if (reason === 'time') {
                        try {
                            await targetUser.send('Club invitation has expired.');
                        } catch (error) {
                            logger.error('Error sending invite expiration message:', error);
                        }
                    }
                });

            } catch (error) {
                if (error.code === 50007) { // Cannot send messages to this user
                    await interaction.reply({
                        content: `Cannot send invitation to ${targetUser.username}. They may have DMs disabled.`,
                        ephemeral: true
                    });
                } else {
                    throw error;
                }
            }

        } catch (error) {
            logger.error('Error in club invite command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 