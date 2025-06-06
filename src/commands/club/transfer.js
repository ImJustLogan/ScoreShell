const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('transfer')
                .setDescription('Transfer club ownership to another member')
                .addUserOption(option =>
                    option
                        .setName('member')
                        .setDescription('The member to transfer ownership to')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('member');

            // Find user's club
            const club = await Club.findOne({
                owner: interaction.user.id
            });

            if (!club) {
                return interaction.reply({
                    content: 'You are not the owner of any club.',
                    ephemeral: true
                });
            }

            // Check if target user is a member of the club
            const targetMember = club.members.find(m => m.userId === targetUser.id);
            if (!targetMember) {
                return interaction.reply({
                    content: `${targetUser.tag} is not a member of your club.`,
                    ephemeral: true
                });
            }

            // Check if target user is already the owner
            if (club.owner === targetUser.id) {
                return interaction.reply({
                    content: `${targetUser.tag} is already the owner of this club.`,
                    ephemeral: true
                });
            }

            // Create confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ Transfer Club Ownership')
                .setDescription(`Are you sure you want to transfer ownership of **${club.name}** to **${targetUser.tag}**?`)
                .addFields(
                    { 
                        name: 'Club Information', 
                        value: [
                            `**Club Name:** ${club.name}`,
                            `**Club ID:** ${club.clubId}`,
                            `**Current Owner:** ${interaction.user.tag}`,
                            `**New Owner:** ${targetUser.tag}`,
                            `**Member Since:** <t:${Math.floor(targetMember.joinedAt.getTime() / 1000)}:R>`
                        ].join('\n'),
                        inline: false 
                    },
                    {
                        name: '⚠️ Important',
                        value: [
                            '• This action cannot be undone',
                            '• You will become a regular member',
                            '• The new owner will have full control over the club',
                            '• Club settings and permissions will be transferred'
                        ].join('\n'),
                        inline: false
                    }
                );

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('club_transfer_confirm')
                        .setLabel('Transfer Ownership')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('club_transfer_cancel')
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
                if (i.customId === 'club_transfer_confirm') {
                    try {
                        // Update club ownership
                        await Club.updateOne(
                            { _id: club._id },
                            { 
                                $set: { 
                                    owner: targetUser.id,
                                    updatedAt: new Date()
                                }
                            }
                        );

                        // Create success embed
                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Ownership Transferred')
                            .setDescription(`Club ownership has been transferred to **${targetUser.tag}**.`)
                            .addFields(
                                { 
                                    name: 'Club Information', 
                                    value: [
                                        `**Club Name:** ${club.name}`,
                                        `**Club ID:** ${club.clubId}`,
                                        `**Previous Owner:** ${interaction.user.tag}`,
                                        `**New Owner:** ${targetUser.tag}`
                                    ].join('\n'),
                                    inline: false 
                                }
                            );

                        // Update confirmation message
                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        // Notify new owner
                        try {
                            const notifyEmbed = new EmbedBuilder()
                                .setColor('#00ff00')
                                .setTitle('Club Ownership Transferred')
                                .setDescription(`You are now the owner of **${club.name}**!`)
                                .addFields(
                                    { 
                                        name: 'Club Information', 
                                        value: [
                                            `**Club Name:** ${club.name}`,
                                            `**Club ID:** ${club.clubId}`,
                                            `**Previous Owner:** ${interaction.user.tag}`,
                                            `**Member Count:** ${club.members.length}`,
                                            `**Captain Count:** ${club.captains.length}`
                                        ].join('\n'),
                                        inline: false 
                                    },
                                    {
                                        name: 'Owner Privileges',
                                        value: [
                                            '• Manage club settings',
                                            '• Add/remove captains',
                                            '• Transfer ownership',
                                            '• Disband the club'
                                        ].join('\n'),
                                        inline: false
                                    }
                                );

                            await targetUser.send({ embeds: [notifyEmbed] });
                        } catch (error) {
                            logger.error(`Error notifying new owner ${targetUser.id} of transfer:`, error);
                        }

                        // Notify all captains
                        for (const captainId of club.captains) {
                            if (captainId !== targetUser.id) { // Don't notify the new owner if they were a captain
                                try {
                                    const captain = await interaction.client.users.fetch(captainId);
                                    const captainNotifyEmbed = new EmbedBuilder()
                                        .setColor('#ff9900')
                                        .setTitle('Club Ownership Changed')
                                        .setDescription(`**${targetUser.tag}** is now the owner of **${club.name}**.`)
                                        .addFields(
                                            { 
                                                name: 'Club Information', 
                                                value: [
                                                    `**Previous Owner:** ${interaction.user.tag}`,
                                                    `**New Owner:** ${targetUser.tag}`,
                                                    `**Changed:** <t:${Math.floor(Date.now() / 1000)}:R>`
                                                ].join('\n'),
                                                inline: false 
                                            }
                                        );

                                    await captain.send({ embeds: [captainNotifyEmbed] });
                                } catch (error) {
                                    logger.error(`Error notifying captain ${captainId} of ownership transfer:`, error);
                                }
                            }
                        }

                        // Log the transfer
                        logger.info(`Club ${club.name} (${club.clubId}) ownership transferred from ${interaction.user.tag} (${interaction.user.id}) to ${targetUser.tag} (${targetUser.id})`);

                    } catch (error) {
                        logger.error('Error processing club transfer:', error);
                        await i.reply({
                            content: 'An error occurred while transferring ownership. Please try again.',
                            ephemeral: true
                        });
                    }
                } else if (i.customId === 'club_transfer_cancel') {
                    await i.update({
                        embeds: [confirmEmbed.setDescription('Ownership transfer cancelled.')],
                        components: []
                    });
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        embeds: [confirmEmbed.setDescription('Transfer confirmation timed out.')],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club transfer command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the transfer command.',
                ephemeral: true
            });
        }
    }
}; 