const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('promote')
                .setDescription('Promote a member to captain (Club Owner only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The member to promote to captain')
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

            // Check if target is already a captain
            if (club.captains.includes(targetUser.id)) {
                return interaction.reply({
                    content: 'This user is already a captain.',
                    ephemeral: true
                });
            }

            // Check if target is the owner
            if (club.owner === targetUser.id) {
                return interaction.reply({
                    content: 'The club owner cannot be promoted to captain.',
                    ephemeral: true
                });
            }

            // Create confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ Promote to Captain')
                .setDescription(`Are you sure you want to promote **${targetUser.tag}** to captain in **${club.name}**?`)
                .addFields(
                    { 
                        name: 'Member Information', 
                        value: [
                            `**Current Role:** Member`,
                            `**Joined:** <t:${Math.floor(targetMember.joinedAt.getTime() / 1000)}:R>`,
                            `**New Role:** Captain`
                        ].join('\n'),
                        inline: false 
                    },
                    {
                        name: 'Captain Privileges',
                        value: [
                            '• Can invite new members',
                            '• Can kick regular members',
                            '• Can approve/deny applications',
                            '• Cannot kick other captains or the owner'
                        ].join('\n'),
                        inline: false
                    }
                )
                .setFooter({ text: 'This action can be reversed using /club demote' });

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('club_promote_confirm')
                        .setLabel('Promote to Captain')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('club_promote_cancel')
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
                if (i.customId === 'club_promote_confirm') {
                    try {
                        // Add user to captains array
                        await Club.updateOne(
                            { _id: club._id },
                            { $push: { captains: targetUser.id } }
                        );

                        // Create success embed
                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Member Promoted')
                            .setDescription(`**${targetUser.tag}** has been promoted to captain in **${club.name}**.`)
                            .addFields(
                                { 
                                    name: 'Promotion Information', 
                                    value: [
                                        `**Promoted by:** ${interaction.user.tag}`,
                                        `**Club:** ${club.name} (${club.clubId})`,
                                        `**New Role:** Captain`
                                    ].join('\n'),
                                    inline: false 
                                }
                            );

                        // Update confirmation message
                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify the promoted member
                        try {
                            await targetUser.send({
                                embeds: [new EmbedBuilder()
                                    .setColor('#00ff00')
                                    .setTitle('You have been promoted to Captain')
                                    .setDescription(`You have been promoted to captain in **${club.name}**.`)
                                    .addFields(
                                        { 
                                            name: 'Promotion Information', 
                                            value: [
                                                `**Club:** ${club.name} (${club.clubId})`,
                                                `**Promoted by:** ${interaction.user.tag}`,
                                                `**New Role:** Captain`
                                            ].join('\n'),
                                            inline: false 
                                        },
                                        {
                                            name: 'Captain Privileges',
                                            value: [
                                                '• Can invite new members',
                                                '• Can kick regular members',
                                                '• Can approve/deny applications',
                                                '• Cannot kick other captains or the owner'
                                            ].join('\n'),
                                            inline: false
                                        }
                                    )]
                            });
                        } catch (error) {
                            logger.error(`Error notifying promoted member ${targetUser.id}:`, error);
                        }

                        // Log the promotion
                        logger.info(`User ${targetUser.tag} (${targetUser.id}) promoted to captain in club ${club.name} (${club.clubId}) by ${interaction.user.tag} (${interaction.user.id})`);

                    } catch (error) {
                        logger.error('Error promoting member:', error);
                        await i.reply({
                            content: 'An error occurred while promoting the member. Please try again.',
                            ephemeral: true
                        });
                    }
                } else if (i.customId === 'club_promote_cancel') {
                    await i.update({
                        embeds: [confirmEmbed.setDescription('Member promotion cancelled.')],
                        components: []
                    });
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        embeds: [confirmEmbed.setDescription('Promotion confirmation timed out.')],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club promote command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the promote command.',
                ephemeral: true
            });
        }
    }
}; 