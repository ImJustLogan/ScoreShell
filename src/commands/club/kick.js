const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('kick')
                .setDescription('Remove a member from your club (Club Owner or Captains only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user to kick from the club')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('reason')
                        .setDescription('Reason for kicking the member')
                        .setRequired(false))),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';

            // Find user's club
            const club = await Club.findOne({
                $or: [
                    { owner: interaction.user.id },
                    { captains: interaction.user.id }
                ]
            });

            if (!club) {
                return interaction.reply({
                    content: 'You must be a club owner or captain to use this command.',
                    ephemeral: true
                });
            }

            // Check if target is in the club
            const targetMember = club.members.find(m => m.userId === targetUser.id);
            if (!targetMember) {
                return interaction.reply({
                    content: 'This user is not a member of your club.',
                    ephemeral: true
                });
            }

            // Prevent kicking owner
            if (club.owner === targetUser.id) {
                return interaction.reply({
                    content: 'You cannot kick the club owner.',
                    ephemeral: true
                });
            }

            // Prevent captains from kicking other captains
            if (club.captains.includes(targetUser.id) && !club.owner === interaction.user.id) {
                return interaction.reply({
                    content: 'Only the club owner can kick captains.',
                    ephemeral: true
                });
            }

            // Create confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ Kick Member')
                .setDescription(`Are you sure you want to kick **${targetUser.tag}** from **${club.name}**?`)
                .addFields(
                    { 
                        name: 'Member Information', 
                        value: [
                            `**Role:** ${club.captains.includes(targetUser.id) ? 'Captain' : 'Member'}`,
                            `**Joined:** <t:${Math.floor(targetMember.joinedAt.getTime() / 1000)}:R>`,
                            `**Reason:** ${reason}`
                        ].join('\n'),
                        inline: false 
                    }
                )
                .setFooter({ text: 'This action cannot be undone!' });

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('club_kick_confirm')
                        .setLabel('Kick Member')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('club_kick_cancel')
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
                if (i.customId === 'club_kick_confirm') {
                    try {
                        // Remove member from club
                        await Club.updateOne(
                            { _id: club._id },
                            { 
                                $pull: { 
                                    members: { userId: targetUser.id },
                                    captains: targetUser.id
                                }
                            }
                        );

                        // Create success embed
                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Member Kicked')
                            .setDescription(`**${targetUser.tag}** has been kicked from **${club.name}**.`)
                            .addFields(
                                { 
                                    name: 'Kick Information', 
                                    value: [
                                        `**Kicked by:** ${interaction.user.tag}`,
                                        `**Reason:** ${reason}`,
                                        `**Club:** ${club.name} (${club.clubId})`
                                    ].join('\n'),
                                    inline: false 
                                }
                            );

                        // Update confirmation message
                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify the kicked member
                        try {
                            await targetUser.send({
                                embeds: [new EmbedBuilder()
                                    .setColor('#ff0000')
                                    .setTitle('You have been kicked from a club')
                                    .setDescription(`You have been kicked from **${club.name}**.`)
                                    .addFields(
                                        { 
                                            name: 'Kick Information', 
                                            value: [
                                                `**Club:** ${club.name} (${club.clubId})`,
                                                `**Kicked by:** ${interaction.user.tag}`,
                                                `**Reason:** ${reason}`
                                            ].join('\n'),
                                            inline: false 
                                        }
                                    )]
                            });
                        } catch (error) {
                            logger.error(`Error notifying kicked member ${targetUser.id}:`, error);
                        }

                        // Log the kick action
                        logger.info(`User ${targetUser.tag} (${targetUser.id}) kicked from club ${club.name} (${club.clubId}) by ${interaction.user.tag} (${interaction.user.id}). Reason: ${reason}`);

                    } catch (error) {
                        logger.error('Error kicking member:', error);
                        await i.reply({
                            content: 'An error occurred while kicking the member. Please try again.',
                            ephemeral: true
                        });
                    }
                } else if (i.customId === 'club_kick_cancel') {
                    await i.update({
                        embeds: [confirmEmbed.setDescription('Member kick cancelled.')],
                        components: []
                    });
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        embeds: [confirmEmbed.setDescription('Kick confirmation timed out.')],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club kick command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the kick command.',
                ephemeral: true
            });
        }
    }
}; 