const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('approve')
                .setDescription('Approve a club application')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user whose application to approve')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');

            // Find the club where the user is an owner or captain
            const club = await Club.findOne({
                $or: [
                    { owner: interaction.user.id },
                    { captains: interaction.user.id }
                ]
            });

            if (!club) {
                return interaction.reply({
                    content: 'You must be a club owner or captain to approve applications.',
                    ephemeral: true
                });
            }

            // Find the application
            const application = club.applications?.find(a => 
                a.userId === targetUser.id && 
                a.status === 'pending' &&
                new Date() - new Date(a.timestamp) < 7 * 24 * 60 * 60 * 1000 // 7 days
            );

            if (!application) {
                return interaction.reply({
                    content: 'No pending application found for this user.',
                    ephemeral: true
                });
            }

            // Check if club is full
            if (club.members.length >= 10) {
                return interaction.reply({
                    content: 'Cannot approve application: club is full (10/10 members).',
                    ephemeral: true
                });
            }

            // Check if applicant is still not in a club
            const applicantClub = await Club.findOne({ 'members.userId': targetUser.id });
            if (applicantClub) {
                return interaction.reply({
                    content: 'Cannot approve application: user has already joined another club.',
                    ephemeral: true
                });
            }

            // Add user to club
            const newMember = {
                userId: targetUser.id,
                username: targetUser.username,
                joinedAt: new Date()
            };

            await Club.updateOne(
                { clubId: club.clubId },
                { 
                    $push: { members: newMember },
                    $pull: { applications: { userId: targetUser.id } }
                }
            );

            // Create success embed
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Application Approved')
                .setDescription(`Successfully approved ${targetUser.username}'s application to join **${club.name}**`)
                .addFields(
                    {
                        name: 'Club Information',
                        value: [
                            `**Club Name:** ${club.name}`,
                            `**Club ID:** ${club.clubId}`,
                            `**Members:** ${club.members.length + 1}/10`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Application Details',
                        value: application.reason,
                        inline: false
                    }
                );

            // Notify applicant
            try {
                const applicantEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('Application Approved!')
                    .setDescription(`Your application to join **${club.name}** has been approved!`)
                    .addFields(
                        {
                            name: 'Club Information',
                            value: [
                                `**Club Name:** ${club.name}`,
                                `**Club ID:** ${club.clubId}`,
                                `**Owner:** <@${club.owner}>`,
                                `**Members:** ${club.members.length + 1}/10`
                            ].join('\n'),
                            inline: false
                        },
                        {
                            name: 'What happens next?',
                            value: 'You are now a member of the club! You can use `/club info` to view club information and `/club leave` if you wish to leave the club.',
                            inline: false
                        }
                    );

                await targetUser.send({ embeds: [applicantEmbed] });
            } catch (error) {
                logger.error(`Failed to notify applicant ${targetUser.id}:`, error);
                embed.addFields({
                    name: '⚠️ Note',
                    value: 'Could not send DM to the applicant. They may have DMs disabled.',
                    inline: false
                });
            }

            // Notify other club managers
            const notifyUsers = [club.owner, ...club.captains].filter(id => id !== interaction.user.id);
            for (const userId of notifyUsers) {
                try {
                    const user = await interaction.client.users.fetch(userId);
                    await user.send(`${interaction.user.username} has approved ${targetUser.username}'s application to join ${club.name}.`);
                } catch (error) {
                    logger.error(`Failed to notify club manager ${userId}:`, error);
                }
            }

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });

        } catch (error) {
            logger.error('Error in club approve command:', error);
            await interaction.reply({
                content: 'An error occurred while approving the application.',
                ephemeral: true
            });
        }
    }
}; 