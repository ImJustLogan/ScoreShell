const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('invite')
                .setDescription('Invite a player to your club')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to invite')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');
            
            // Get the user's club
            const club = await Club.findOne({
                $or: [
                    { owner: interaction.user.id },
                    { captains: interaction.user.id }
                ]
            });

            if (!club) {
                return interaction.reply({
                    content: 'You must be a club owner or captain to invite members.',
                    ephemeral: true
                });
            }

            // Check if club is full
            if (club.memberCount >= 10) {
                return interaction.reply({
                    content: 'Your club has reached the maximum member limit of 10.',
                    ephemeral: true
                });
            }

            // Check if target user is already in a club
            const targetClub = await Club.findOne({ 'members.userId': targetUser.id });
            if (targetClub) {
                return interaction.reply({
                    content: `${targetUser.username} is already in a club.`,
                    ephemeral: true
                });
            }

            // Check if user already has a pending invite
            if (club.invites.some(invite => invite.userId === targetUser.id)) {
                return interaction.reply({
                    content: `${targetUser.username} already has a pending invite to your club.`,
                    ephemeral: true
                });
            }

            // Create invite embed
            const inviteEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`Club Invitation: ${club.name}`)
                .setDescription(`You have been invited to join ${club.name}!`)
                .addFields(
                    { 
                        name: 'Club Details', 
                        value: [
                            `**Club ID:** ${club.clubId}`,
                            `**Members:** ${club.memberCount}/10`,
                            `**Privacy:** ${club.privacy.charAt(0) + club.privacy.slice(1).toLowerCase()}`,
                            `**Trophies:** ${club.stats.trophies} <:icon_club_trophy_point:1379175523720237258>`
                        ].join('\n'),
                        inline: true 
                    },
                    { 
                        name: 'Invited By', 
                        value: interaction.user.username,
                        inline: true 
                    }
                )
                .setThumbnail(`https://i.imgur.com/${club.icon.split('_')[1]}.png`)
                .setFooter({ text: 'This invite will expire in 24 hours' });

            // Create accept/decline buttons
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`club_invite_accept_${club.clubId}`)
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`club_invite_decline_${club.clubId}`)
                        .setLabel('Decline')
                        .setStyle(ButtonStyle.Danger)
                );

            // Send invite to target user
            try {
                const inviteMessage = await targetUser.send({
                    embeds: [inviteEmbed],
                    components: [buttons]
                });

                // Add invite to club's invites
                club.invites.push({
                    userId: targetUser.id,
                    invitedBy: interaction.user.id,
                    invitedAt: new Date(),
                    messageId: inviteMessage.id
                });
                await club.save();

                // Create collector for invite response
                const filter = i => i.user.id === targetUser.id && 
                    (i.customId === `club_invite_accept_${club.clubId}` || 
                     i.customId === `club_invite_decline_${club.clubId}`);
                
                const collector = inviteMessage.createMessageComponentCollector({ 
                    filter, 
                    time: 24 * 60 * 60 * 1000 // 24 hours
                });

                collector.on('collect', async i => {
                    const [action, type, response, clubId] = i.customId.split('_');
                    
                    if (action !== 'club' || type !== 'invite' || clubId !== club.clubId) return;

                    try {
                        if (response === 'accept') {
                            // Check if club is still not full
                            if (club.memberCount >= 10) {
                                await i.update({
                                    content: 'Sorry, the club is now full.',
                                    embeds: [],
                                    components: []
                                });
                                return;
                            }

                            // Check if user is still not in a club
                            const userClub = await Club.findOne({ 'members.userId': targetUser.id });
                            if (userClub) {
                                await i.update({
                                    content: 'You have already joined another club.',
                                    embeds: [],
                                    components: []
                                });
                                return;
                            }

                            // Add user to club
                            await club.addMember(targetUser.id);
                            
                            // Remove invite
                            club.invites = club.invites.filter(inv => inv.userId !== targetUser.id);
                            await club.save();

                            // Update invite message
                            await i.update({
                                content: `You have joined ${club.name}!`,
                                embeds: [],
                                components: []
                            });

                            // Notify inviter
                            try {
                                const inviter = await interaction.client.users.fetch(interaction.user.id);
                                await inviter.send(`${targetUser.username} has accepted your invitation to join ${club.name}!`);
                            } catch (error) {
                                logger.error(`Error notifying inviter ${interaction.user.id}:`, error);
                            }
                        } else {
                            // Remove invite
                            club.invites = club.invites.filter(inv => inv.userId !== targetUser.id);
                            await club.save();

                            // Update invite message
                            await i.update({
                                content: 'You have declined the club invitation.',
                                embeds: [],
                                components: []
                            });

                            // Notify inviter
                            try {
                                const inviter = await interaction.client.users.fetch(interaction.user.id);
                                await inviter.send(`${targetUser.username} has declined your invitation to join ${club.name}.`);
                            } catch (error) {
                                logger.error(`Error notifying inviter ${interaction.user.id}:`, error);
                            }
                        }
                    } catch (error) {
                        logger.error('Error handling invite response:', error);
                        await i.reply({
                            content: 'An error occurred while processing your response.',
                            ephemeral: true
                        });
                    }
                });

                collector.on('end', async collected => {
                    if (collected.size === 0) {
                        // Remove expired invite
                        club.invites = club.invites.filter(inv => inv.userId !== targetUser.id);
                        await club.save();

                        try {
                            await inviteMessage.edit({
                                content: 'This invitation has expired.',
                                embeds: [],
                                components: []
                            });
                        } catch (error) {
                            logger.error('Error updating expired invite message:', error);
                        }
                    }
                });

                await interaction.reply({
                    content: `Invitation sent to ${targetUser.username}!`,
                    ephemeral: true
                });

            } catch (error) {
                if (error.code === 50007) { // Cannot send messages to this user
                    return interaction.reply({
                        content: `Cannot send invitation to ${targetUser.username}. They may have DMs disabled.`,
                        ephemeral: true
                    });
                }
                throw error;
            }

        } catch (error) {
            logger.error('Error in club invite command:', error);
            await interaction.reply({
                content: 'An error occurred while sending the invitation.',
                ephemeral: true
            });
        }
    }
}; 