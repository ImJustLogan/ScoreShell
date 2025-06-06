const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('deny')
                .setDescription('Deny a club application')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user whose application to deny')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('reason')
                        .setDescription('Reason for denying the application')
                        .setRequired(false)
                        .setMaxLength(1000))),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';

            // Find the club where the user is an owner or captain
            const club = await Club.findOne({
                $or: [
                    { owner: interaction.user.id },
                    { captains: interaction.user.id }
                ]
            });

            if (!club) {
                return interaction.reply({
                    content: 'You must be a club owner or captain to deny applications.',
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

            // Remove application
            await Club.updateOne(
                { clubId: club.clubId },
                { $pull: { applications: { userId: targetUser.id } } }
            );

            // Create success embed
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Application Denied')
                .setDescription(`Successfully denied ${targetUser.username}'s application to join **${club.name}**`)
                .addFields(
                    {
                        name: 'Club Information',
                        value: [
                            `**Club Name:** ${club.name}`,
                            `**Club ID:** ${club.clubId}`,
                            `**Members:** ${club.members.length}/10`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Application Details',
                        value: application.reason,
                        inline: false
                    },
                    {
                        name: 'Denial Reason',
                        value: reason,
                        inline: false
                    }
                );

            // Notify applicant
            try {
                const applicantEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Application Denied')
                    .setDescription(`Your application to join **${club.name}** has been denied.`)
                    .addFields(
                        {
                            name: 'Club Information',
                            value: [
                                `**Club Name:** ${club.name}`,
                                `**Club ID:** ${club.clubId}`
                            ].join('\n'),
                            inline: false
                        },
                        {
                            name: 'Reason for Denial',
                            value: reason,
                            inline: false
                        },
                        {
                            name: 'What happens next?',
                            value: 'You can apply to other clubs or try applying to this club again in the future if you believe you can better meet their requirements.',
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
                    await user.send(`${interaction.user.username} has denied ${targetUser.username}'s application to join ${club.name}.`);
                } catch (error) {
                    logger.error(`Failed to notify club manager ${userId}:`, error);
                }
            }

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });

        } catch (error) {
            logger.error('Error in club deny command:', error);
            await interaction.reply({
                content: 'An error occurred while denying the application.',
                ephemeral: true
            });
        }
    }
}; 