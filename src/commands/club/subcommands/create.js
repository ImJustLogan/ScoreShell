const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const logger = require('../../../utils/logger');
const User = require('../../../models/User');
const Club = require('../../../models/Club');

// Club icons from design doc
const CLUB_ICONS = {
    'club_red': {
        emoji: '1340463594055139328',
        url: 'https://i.imgur.com/sy8o63Y.png'
    },
    'club_blue': {
        emoji: '1340464817428758558',
        url: 'https://i.imgur.com/2jH5dQU.png'
    },
    'club_yellow': {
        emoji: '1340464843576049774',
        url: 'https://i.imgur.com/nywWQyZ.png'
    },
    'club_green': {
        emoji: '1340464944126230598',
        url: 'https://i.imgur.com/JnBP5ro.png'
    },
    'club_pink': {
        emoji: '1340464971741528084',
        url: 'https://i.imgur.com/ToavyvN.png'
    },
    'club_cyan': {
        emoji: '1340465007598764124',
        url: 'https://i.imgur.com/81HXsR8.png'
    }
};

module.exports = {
    async execute(interaction, { CLUB_ICONS }) {
        try {
            // Check if user is already in a club
            const user = await User.findOne({ discordId: interaction.user.id });
            if (user?.club) {
                return interaction.reply({
                    content: 'You are already in a club! Leave your current club before creating a new one.',
                    ephemeral: true
                });
            }

            const name = interaction.options.getString('name');
            const id = interaction.options.getString('id').toUpperCase();

            // Validate club ID format (alphanumeric only)
            if (!/^[A-Z0-9]+$/.test(id)) {
                return interaction.reply({
                    content: 'Club ID can only contain letters and numbers.',
                    ephemeral: true
                });
            }

            // Check if club ID is already taken
            const existingClub = await Club.findOne({ id });
            if (existingClub) {
                return interaction.reply({
                    content: 'This club ID is already taken. Please choose a different one.',
                    ephemeral: true
                });
            }

            // Create icon selection menu
            const iconRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('club_icon_select')
                        .setPlaceholder('Select a club icon')
                        .addOptions([
                            {
                                label: 'Red Club',
                                description: 'A red club icon',
                                value: 'club_red',
                                emoji: CLUB_ICONS.club_red.emoji
                            },
                            {
                                label: 'Blue Club',
                                description: 'A blue club icon',
                                value: 'club_blue',
                                emoji: CLUB_ICONS.club_blue.emoji
                            },
                            {
                                label: 'Yellow Club',
                                description: 'A yellow club icon',
                                value: 'club_yellow',
                                emoji: CLUB_ICONS.club_yellow.emoji
                            },
                            {
                                label: 'Green Club',
                                description: 'A green club icon',
                                value: 'club_green',
                                emoji: CLUB_ICONS.club_green.emoji
                            },
                            {
                                label: 'Pink Club',
                                description: 'A pink club icon',
                                value: 'club_pink',
                                emoji: CLUB_ICONS.club_pink.emoji
                            },
                            {
                                label: 'Cyan Club',
                                description: 'A cyan club icon',
                                value: 'club_cyan',
                                emoji: CLUB_ICONS.club_cyan.emoji
                            }
                        ])
                );

            // Create privacy selection menu
            const privacyRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('club_privacy_select')
                        .setPlaceholder('Select privacy setting')
                        .addOptions([
                            {
                                label: 'Open',
                                description: 'Anyone can join',
                                value: 'OPEN'
                            },
                            {
                                label: 'Application Needed',
                                description: 'Players must request to join',
                                value: 'APPLICATION'
                            },
                            {
                                label: 'Invite Only',
                                description: 'Players must be invited',
                                value: 'INVITE'
                            }
                        ])
                );

            // Send initial setup message
            const setupEmbed = new EmbedBuilder()
                .setTitle('Create New Club')
                .setDescription(`Please select an icon and privacy setting for your club:\n\n**Name:** ${name}\n**ID:** ${id}`)
                .setColor('#0099ff');

            const response = await interaction.reply({
                embeds: [setupEmbed],
                components: [iconRow, privacyRow],
                ephemeral: true
            });

            // Create collector for icon selection
            const iconCollector = response.createMessageComponentCollector({
                filter: i => i.customId === 'club_icon_select' && i.user.id === interaction.user.id,
                time: 300000 // 5 minutes
            });

            // Create collector for privacy selection
            const privacyCollector = response.createMessageComponentCollector({
                filter: i => i.customId === 'club_privacy_select' && i.user.id === interaction.user.id,
                time: 300000 // 5 minutes
            });

            let selectedIcon = null;
            let selectedPrivacy = null;

            // Handle icon selection
            iconCollector.on('collect', async (i) => {
                selectedIcon = i.values[0];
                await i.update({ components: [iconRow, privacyRow] });
                
                if (selectedIcon && selectedPrivacy) {
                    await createClub(interaction, name, id, selectedIcon, selectedPrivacy);
                    iconCollector.stop();
                    privacyCollector.stop();
                }
            });

            // Handle privacy selection
            privacyCollector.on('collect', async (i) => {
                selectedPrivacy = i.values[0];
                await i.update({ components: [iconRow, privacyRow] });
                
                if (selectedIcon && selectedPrivacy) {
                    await createClub(interaction, name, id, selectedIcon, selectedPrivacy);
                    iconCollector.stop();
                    privacyCollector.stop();
                }
            });

            // Handle timeout
            iconCollector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Club creation timed out. Please try again.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error creating club:', error);
            await interaction.reply({
                content: 'An error occurred while creating your club. Please try again.',
                ephemeral: true
            });
        }
    }
};

async function createClub(interaction, name, id, icon, privacy) {
    try {
        // Create new club
        const club = new Club({
            name,
            id,
            icon: CLUB_ICONS[icon].url,
            iconEmoji: CLUB_ICONS[icon].emoji,
            privacy,
            owner: interaction.user.id,
            members: [interaction.user.id],
            captains: [],
            createdAt: new Date(),
            trophies: 0,
            currentSeasonRep: 0,
            totalRep: 0
        });

        await club.save();

        // Update user's club membership
        await User.findOneAndUpdate(
            { discordId: interaction.user.id },
            { 
                club: club._id,
                clubRole: 'OWNER'
            },
            { upsert: true }
        );

        // Send success message
        const successEmbed = new EmbedBuilder()
            .setTitle('Club Created!')
            .setDescription(`Your club "${name}" has been created successfully!\n\n**Club ID:** ${id}\n**Privacy:** ${privacy}\n**Icon:** ${CLUB_ICONS[icon].emoji}`)
            .setColor('#00ff00');

        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });

    } catch (error) {
        logger.error('Error saving club:', error);
        await interaction.editReply({
            content: 'An error occurred while saving your club. Please try again.',
            embeds: [],
            components: []
        });
    }
} 