const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const logger = require('../../../utils/logger');
const User = require('../../../models/User');
const Club = require('../../../models/Club');

module.exports = {
    async execute(interaction, { CLUB_ICONS, PRIVACY_TYPES }) {
        try {
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

            // Check if user is the club owner
            if (club.owner !== interaction.user.id) {
                return interaction.reply({
                    content: 'Only the club owner can manage club settings!',
                    ephemeral: true
                });
            }

            // Create settings embed
            const settingsEmbed = new EmbedBuilder()
                .setTitle('Club Settings')
                .setDescription(`Manage settings for **${club.name}**`)
                .setColor('#0099ff')
                .setThumbnail(club.icon)
                .addFields(
                    { name: 'Current Settings', value: 
                        `• Privacy: ${club.privacy}\n` +
                        `• Icon: ${Object.entries(CLUB_ICONS).find(([key, data]) => data.image === club.icon)?.[0] || 'Custom'}\n` +
                        `• Member Count: ${club.members.length}/10\n` +
                        `• Captains: ${club.captains.length}`
                    }
                );

            // Create settings menu
            const settingsRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('club_settings')
                        .setPlaceholder('Select a setting to change')
                        .addOptions([
                            {
                                label: 'Change Privacy',
                                description: 'Set who can join your club',
                                value: 'privacy',
                                emoji: '🔒'
                            },
                            {
                                label: 'Change Icon',
                                description: 'Change your club\'s icon',
                                value: 'icon',
                                emoji: '🖼️'
                            }
                        ])
                );

            const response = await interaction.reply({
                embeds: [settingsEmbed],
                components: [settingsRow],
                ephemeral: true
            });

            // Create collector for settings menu
            const collector = response.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300000 // 5 minutes
            });

            collector.on('collect', async (i) => {
                if (i.customId === 'club_settings') {
                    const setting = i.values[0];

                    if (setting === 'privacy') {
                        // Create privacy menu
                        const privacyRow = new ActionRowBuilder()
                            .addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId('privacy_setting')
                                    .setPlaceholder('Select privacy setting')
                                    .addOptions(
                                        Object.entries(PRIVACY_TYPES).map(([key, data]) => ({
                                            label: data.label,
                                            description: data.description,
                                            value: key.toUpperCase(),
                                            emoji: data.emoji
                                        }))
                                    )
                            );

                            await i.update({
                                embeds: [settingsEmbed.setDescription('Select a new privacy setting for your club:')],
                                components: [privacyRow]
                            });

                    } else if (setting === 'icon') {
                        // Create icon menu
                        const iconRow = new ActionRowBuilder()
                            .addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId('icon_setting')
                                    .setPlaceholder('Select club icon')
                                    .addOptions(
                                        Object.entries(CLUB_ICONS).map(([key, data]) => ({
                                            label: key.replace('club_', '').charAt(0).toUpperCase() + key.slice(5),
                                            description: `Set club icon to ${key.replace('club_', '')}`,
                                            value: key,
                                            emoji: data.emoji
                                        }))
                                    )
                            );

                            await i.update({
                                embeds: [settingsEmbed.setDescription('Select a new icon for your club:')],
                                components: [iconRow]
                            });
                    }
                } else if (i.customId === 'privacy_setting') {
                    const newPrivacy = i.values[0];

                    try {
                        // Update club privacy
                        await Club.findByIdAndUpdate(club._id, { privacy: newPrivacy });

                        // Update embed with new settings
                        const updatedEmbed = EmbedBuilder.from(settingsEmbed)
                            .setDescription(`Settings updated for **${club.name}**`)
                            .spliceFields(0, 1, {
                                name: 'Current Settings',
                                value: 
                                    `• Privacy: ${PRIVACY_TYPES[newPrivacy.toLowerCase()].label}\n` +
                                    `• Icon: ${Object.entries(CLUB_ICONS).find(([key, data]) => data.image === club.icon)?.[0] || 'Custom'}\n` +
                                    `• Member Count: ${club.members.length}/10\n` +
                                    `• Captains: ${club.captains.length}`
                            });

                            await i.update({
                                embeds: [updatedEmbed],
                                components: [settingsRow]
                            });

                            logger.info('Club privacy updated', {
                                clubId: club.id,
                                clubName: club.name,
                                newPrivacy: newPrivacy,
                                updatedBy: interaction.user.id
                            });

                    } catch (error) {
                        logger.error('Error updating club privacy:', error);
                        await i.update({
                            content: 'An error occurred while updating privacy settings. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }

                } else if (i.customId === 'icon_setting') {
                    const newIconKey = i.values[0];
                    const newIcon = CLUB_ICONS[newIconKey];

                    try {
                        // Update club icon
                        await Club.findByIdAndUpdate(club._id, { 
                            icon: newIcon.image,
                            iconEmoji: newIcon.emoji
                        });

                        // Update embed with new settings
                        const updatedEmbed = EmbedBuilder.from(settingsEmbed)
                            .setDescription(`Settings updated for **${club.name}**`)
                            .setThumbnail(newIcon.image)
                            .spliceFields(0, 1, {
                                name: 'Current Settings',
                                value: 
                                    `• Privacy: ${PRIVACY_TYPES[club.privacy.toLowerCase()].label}\n` +
                                    `• Icon: ${newIconKey.replace('club_', '').charAt(0).toUpperCase() + newIconKey.slice(5)}\n` +
                                    `• Member Count: ${club.members.length}/10\n` +
                                    `• Captains: ${club.captains.length}`
                            });

                            await i.update({
                                embeds: [updatedEmbed],
                                components: [settingsRow]
                            });

                            logger.info('Club icon updated', {
                                clubId: club.id,
                                clubName: club.name,
                                newIcon: newIconKey,
                                updatedBy: interaction.user.id
                            });

                    } catch (error) {
                        logger.error('Error updating club icon:', error);
                        await i.update({
                            content: 'An error occurred while updating icon settings. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Settings menu timed out. Use /club settings to open it again.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club settings command:', error);
            await interaction.reply({
                content: 'An error occurred while managing club settings. Please try again.',
                ephemeral: true
            });
        }
    }
}; 