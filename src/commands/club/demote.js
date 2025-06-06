const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('demote')
                .setDescription('Demote a captain to regular member (Club Owner only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The captain to demote')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');

            // Find user's club
            const club = await Club.findOne({ owner: interaction.user.id });
            if (!club) {
                return interaction.reply({
                    content: 'You must be a club owner to use this command.',
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

            // Check if target is a captain
            if (!club.captains.includes(targetUser.id)) {
                return interaction.reply({
                    content: 'This user is not a captain.',
                    ephemeral: true
                });
            }

            // Check if target is the owner
            if (club.owner === targetUser.id) {
                return interaction.reply({
                    content: 'The club owner cannot be demoted.',
                    ephemeral: true
                });
            }

            // Create confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ Demote Captain')
                .setDescription(`Are you sure you want to demote **${targetUser.tag}** from captain in **${club.name}**?`)
                .addFields(
                    { 
                        name: 'Member Information', 
                        value: [
                            `**Current Role:** Captain`,
                            `**Joined:** <t:${Math.floor(targetMember.joinedAt.getTime() / 1000)}:R>`,
                            `**New Role:** Member`
                        ].join('\n'),
                        inline: false 
                    },
                    {
                        name: 'Lost Privileges',
                        value: [
                            '• Can no longer invite new members',
                            '• Can no longer kick regular members',
                            '• Can no longer approve/deny applications'
                        ].join('\n'),
                        inline: false
                    }
                )
                .setFooter({ text: 'This action can be reversed using /club promote' });

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('club_demote_confirm')
                        .setLabel('Demote to Member')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('club_demote_cancel')
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
                if (i.customId === 'club_demote_confirm') {
                    try {
                        // Remove user from captains array
                        await Club.updateOne(
                            { _id: club._id },
                            { $pull: { captains: targetUser.id } }
                        );

                        // Create success embed
                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Captain Demoted')
                            .setDescription(`**${targetUser.tag}** has been demoted to member in **${club.name}**.`)
                            .addFields(
                                { 
                                    name: 'Demotion Information', 
                                    value: [
                                        `**Demoted by:** ${interaction.user.tag}`,
                                        `**Club:** ${club.name} (${club.clubId})`,
                                        `**New Role:** Member`
                                    ].join('\n'),
                                    inline: false 
                                }
                            );

                        // Update confirmation message
                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify the demoted member
                        try {
                            await targetUser.send({
                                embeds: [new EmbedBuilder()
                                    .setColor('#ff9900')
                                    .setTitle('You have been demoted to Member')
                                    .setDescription(`You have been demoted to member in **${club.name}**.`)
                                    .addFields(
                                        { 
                                            name: 'Demotion Information', 
                                            value: [
                                                `**Club:** ${club.name} (${club.clubId})`,
                                                `**Demoted by:** ${interaction.user.tag}`,
                                                `**New Role:** Member`
                                            ].join('\n'),
                                            inline: false 
                                        },
                                        {
                                            name: 'Lost Privileges',
                                            value: [
                                                '• Can no longer invite new members',
                                                '• Can no longer kick regular members',
                                                '• Can no longer approve/deny applications'
                                            ].join('\n'),
                                            inline: false
                                        }
                                    )]
                            });
                        } catch (error) {
                            logger.error(`Error notifying demoted member ${targetUser.id}:`, error);
                        }

                        // Log the demotion
                        logger.info(`User ${targetUser.tag} (${targetUser.id}) demoted from captain in club ${club.name} (${club.clubId}) by ${interaction.user.tag} (${interaction.user.id})`);

                    } catch (error) {
                        logger.error('Error demoting member:', error);
                        await i.reply({
                            content: 'An error occurred while demoting the member. Please try again.',
                            ephemeral: true
                        });
                    }
                } else if (i.customId === 'club_demote_cancel') {
                    await i.update({
                        embeds: [confirmEmbed.setDescription('Member demotion cancelled.')],
                        components: []
                    });
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        embeds: [confirmEmbed.setDescription('Demotion confirmation timed out.')],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club demote command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the demote command.',
                ephemeral: true
            });
        }
    }
}; 