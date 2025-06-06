const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('leave')
                .setDescription('Leave your current club')),

    async execute(interaction) {
        try {
            // Find user's club
            const club = await Club.findOne({
                'members.userId': interaction.user.id
            });

            if (!club) {
                return interaction.reply({
                    content: 'You are not a member of any club.',
                    ephemeral: true
                });
            }

            // Check if user is the owner
            if (club.owner === interaction.user.id) {
                return interaction.reply({
                    content: 'Club owners cannot leave their club. Use `/club disband` if you wish to delete the club.',
                    ephemeral: true
                });
            }

            // Get member info
            const member = club.members.find(m => m.userId === interaction.user.id);
            const isCaptain = club.captains.includes(interaction.user.id);

            // Create confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ Leave Club')
                .setDescription(`Are you sure you want to leave **${club.name}**?`)
                .addFields(
                    { 
                        name: 'Club Information', 
                        value: [
                            `**Club Name:** ${club.name}`,
                            `**Club ID:** ${club.clubId}`,
                            `**Your Role:** ${isCaptain ? 'Captain' : 'Member'}`,
                            `**Joined:** <t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>`
                        ].join('\n'),
                        inline: false 
                    }
                );

            // Add warning for captains
            if (isCaptain) {
                confirmEmbed.addFields({
                    name: '⚠️ Captain Warning',
                    value: 'As a captain, you will lose your captain privileges when leaving the club.',
                    inline: false
                });
            }

            // Add club league warning if active
            const now = new Date();
            const isClubLeagueActive = now.getDate() <= 7; // Club league is active during first week of month
            if (isClubLeagueActive) {
                confirmEmbed.addFields({
                    name: '⚠️ Club League Warning',
                    value: 'Club League is currently active. You will not be able to use any remaining tickets if you leave.',
                    inline: false
                });
            }

            confirmEmbed.setFooter({ text: 'This action cannot be undone!' });

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('club_leave_confirm')
                        .setLabel('Leave Club')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('club_leave_cancel')
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
                time: 30000 // 30 seconds
            });

            collector.on('collect', async i => {
                if (i.customId === 'club_leave_confirm') {
                    try {
                        // Remove user from club
                        await Club.updateOne(
                            { _id: club._id },
                            { 
                                $pull: { 
                                    members: { userId: interaction.user.id },
                                    captains: interaction.user.id
                                }
                            }
                        );

                        // Create success embed
                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Left Club')
                            .setDescription(`You have left **${club.name}**.`)
                            .addFields(
                                { 
                                    name: 'Club Information', 
                                    value: [
                                        `**Club Name:** ${club.name}`,
                                        `**Club ID:** ${club.clubId}`,
                                        `**Previous Role:** ${isCaptain ? 'Captain' : 'Member'}`
                                    ].join('\n'),
                                    inline: false 
                                }
                            );

                        // Add club league note if active
                        if (isClubLeagueActive) {
                            successEmbed.addFields({
                                name: 'Club League Note',
                                value: 'You will not be able to use any remaining club league tickets until the next season.',
                                inline: false
                            });
                        }

                        // Update confirmation message
                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify club owner and captains
                        try {
                            const notifyEmbed = new EmbedBuilder()
                                .setColor('#ff9900')
                                .setTitle('Member Left Club')
                                .setDescription(`**${interaction.user.tag}** has left the club.`)
                                .addFields(
                                    { 
                                        name: 'Member Information', 
                                        value: [
                                            `**Previous Role:** ${isCaptain ? 'Captain' : 'Member'}`,
                                            `**Joined:** <t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>`,
                                            `**Left:** <t:${Math.floor(Date.now() / 1000)}:R>`
                                        ].join('\n'),
                                        inline: false 
                                    }
                                );

                            // Notify owner
                            const owner = await interaction.client.users.fetch(club.owner);
                            await owner.send({ embeds: [notifyEmbed] });

                            // Notify captains
                            for (const captainId of club.captains) {
                                if (captainId !== interaction.user.id) { // Don't notify the leaving captain
                                    try {
                                        const captain = await interaction.client.users.fetch(captainId);
                                        await captain.send({ embeds: [notifyEmbed] });
                                    } catch (error) {
                                        logger.error(`Error notifying captain ${captainId} of member leave:`, error);
                                    }
                                }
                            }
                        } catch (error) {
                            logger.error('Error notifying club management of member leave:', error);
                        }

                        // Log the leave action
                        logger.info(`User ${interaction.user.tag} (${interaction.user.id}) left club ${club.name} (${club.clubId}). Previous role: ${isCaptain ? 'Captain' : 'Member'}`);

                    } catch (error) {
                        logger.error('Error processing club leave:', error);
                        await i.reply({
                            content: 'An error occurred while leaving the club. Please try again.',
                            ephemeral: true
                        });
                    }
                } else if (i.customId === 'club_leave_cancel') {
                    await i.update({
                        embeds: [confirmEmbed.setDescription('Club leave cancelled.')],
                        components: []
                    });
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        embeds: [confirmEmbed.setDescription('Leave confirmation timed out.')],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club leave command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the leave command.',
                ephemeral: true
            });
        }
    }
}; 