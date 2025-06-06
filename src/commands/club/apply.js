const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('apply')
                .setDescription('Apply to join a club')
                .addStringOption(option =>
                    option
                        .setName('club_id')
                        .setDescription('The ID of the club to apply to')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('reason')
                        .setDescription('Why do you want to join this club?')
                        .setRequired(true)
                        .setMinLength(10)
                        .setMaxLength(1000))),

    async execute(interaction) {
        try {
            const clubId = interaction.options.getString('club_id').toUpperCase();
            const reason = interaction.options.getString('reason');

            // Check if user is already in a club
            const userClub = await Club.findOne({ 'members.userId': interaction.user.id });
            if (userClub) {
                return interaction.reply({
                    content: 'You are already in a club. Leave your current club before applying to join another one.',
                    ephemeral: true
                });
            }

            // Find the target club
            const club = await Club.findOne({ clubId });
            if (!club) {
                return interaction.reply({
                    content: 'Club not found. Please check the club ID and try again.',
                    ephemeral: true
                });
            }

            // Check if club is accepting applications
            if (club.privacy === 'open') {
                return interaction.reply({
                    content: 'This club is open to join. Use the "Apply to Join" button in the club info instead.',
                    ephemeral: true
                });
            }

            if (club.privacy === 'invite_only') {
                return interaction.reply({
                    content: 'This club is invite-only. You must be invited by a club owner or captain to join.',
                    ephemeral: true
                });
            }

            // Check if club is full
            if (club.members.length >= 10) {
                return interaction.reply({
                    content: 'This club is full (10/10 members).',
                    ephemeral: true
                });
            }

            // Check for existing pending application
            const existingApplication = club.applications?.find(a => 
                a.userId === interaction.user.id && 
                a.status === 'pending' &&
                new Date() - new Date(a.timestamp) < 7 * 24 * 60 * 60 * 1000 // 7 days
            );

            if (existingApplication) {
                return interaction.reply({
                    content: 'You already have a pending application to this club. Please wait for a response or for your application to expire (7 days).',
                    ephemeral: true
                });
            }

            // Create application
            const application = {
                userId: interaction.user.id,
                username: interaction.user.username,
                reason: reason,
                timestamp: new Date(),
                status: 'pending'
            };

            // Add application to club
            await Club.updateOne(
                { clubId },
                { $push: { applications: application } }
            );

            // Create confirmation embed
            const embed = new EmbedBuilder()
                .setColor('#80FFFF')
                .setTitle('Application Submitted')
                .setDescription(`Your application to join **${club.name}** has been submitted.`)
                .addFields(
                    {
                        name: 'Club Information',
                        value: [
                            `**Club Name:** ${club.name}`,
                            `**Club ID:** ${club.clubId}`,
                            `**Privacy:** ${club.privacy.charAt(0).toUpperCase() + club.privacy.slice(1)}`,
                            `**Members:** ${club.members.length}/10`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Your Application',
                        value: reason,
                        inline: false
                    },
                    {
                        name: 'What happens next?',
                        value: 'Club owners and captains will review your application. You will be notified when a decision is made. Applications expire after 7 days if not reviewed.',
                        inline: false
                    }
                );

            // Notify club owner and captains
            const notificationEmbed = new EmbedBuilder()
                .setColor('#80FFFF')
                .setTitle('New Club Application')
                .setDescription(`**${interaction.user.username}** has applied to join **${club.name}**`)
                .addFields(
                    {
                        name: 'Applicant Information',
                        value: [
                            `**User:** ${interaction.user.username} (${interaction.user.id})`,
                            `**Joined Discord:** <t:${Math.floor(interaction.user.createdTimestamp / 1000)}:R>`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Application Reason',
                        value: reason,
                        inline: false
                    }
                );

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`club_approve_${interaction.user.id}`)
                        .setLabel('Approve')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`club_deny_${interaction.user.id}`)
                        .setLabel('Deny')
                        .setStyle(ButtonStyle.Danger)
                );

            // Send notifications to owner and captains
            try {
                const owner = await interaction.client.users.fetch(club.owner);
                await owner.send({ embeds: [notificationEmbed], components: [buttons] });
            } catch (error) {
                logger.error(`Failed to send application notification to club owner ${club.owner}:`, error);
            }

            for (const captainId of club.captains) {
                try {
                    const captain = await interaction.client.users.fetch(captainId);
                    await captain.send({ embeds: [notificationEmbed], components: [buttons] });
                } catch (error) {
                    logger.error(`Failed to send application notification to captain ${captainId}:`, error);
                }
            }

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });

        } catch (error) {
            logger.error('Error in club apply command:', error);
            await interaction.reply({
                content: 'An error occurred while submitting your application.',
                ephemeral: true
            });
        }
    }
}; 