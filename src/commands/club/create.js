const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Create a new club')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
        .setDescription('Create a new club')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of your club')
                .setRequired(true)
                        .setMinLength(3)
                .setMaxLength(32))
        .addStringOption(option =>
            option.setName('id')
                        .setDescription('A unique 3-5 letter code for your club')
                .setRequired(true)
                .setMinLength(3)
                        .setMaxLength(5))),

    async execute(interaction) {
        try {
            // Check if user is already in a club
            const existingClub = await Club.findOne({
                'members.userId': interaction.user.id
            });

            if (existingClub) {
                return interaction.reply({
                    content: 'You are already a member of a club. Leave your current club before creating a new one.',
                    ephemeral: true
                });
            }

            // Check if club ID is already taken
            const clubId = interaction.options.getString('id').toUpperCase();
            if (!/^[A-Z0-9]+$/.test(clubId)) {
                return interaction.reply({
                    content: 'Club ID can only contain letters and numbers.',
                    ephemeral: true
                });
            }

            const existingClubId = await Club.findOne({ clubId });
            if (existingClubId) {
                return interaction.reply({
                    content: 'This club ID is already taken. Please choose a different one.',
                    ephemeral: true
                });
            }

            // Create icon selection menu
            const iconSelect = new StringSelectMenuBuilder()
                .setCustomId('club_icon')
                .setPlaceholder('Select a club icon')
                .addOptions([
                    {
                        label: 'Red',
                        description: 'A bold red icon',
                        value: 'club_red',
                        emoji: '1340463594055139328'
                    },
                    {
                        label: 'Blue',
                        description: 'A cool blue icon',
                        value: 'club_blue',
                        emoji: '1340464817428758558'
                    },
                    {
                        label: 'Yellow',
                        description: 'A bright yellow icon',
                        value: 'club_yellow',
                        emoji: '1340464843576049774'
                    },
                    {
                        label: 'Green',
                        description: 'A fresh green icon',
                        value: 'club_green',
                        emoji: '1340464944126230598'
                    },
                    {
                        label: 'Pink',
                        description: 'A vibrant pink icon',
                        value: 'club_pink',
                        emoji: '1340464971741528084'
                    },
                    {
                        label: 'Cyan',
                        description: 'A calming cyan icon',
                        value: 'club_cyan',
                        emoji: '1340465007598764124'
                    }
                ]);

            // Create privacy selection menu
            const privacySelect = new StringSelectMenuBuilder()
                .setCustomId('club_privacy')
                .setPlaceholder('Select privacy settings')
                .addOptions([
                    {
                        label: 'Open',
                        description: 'Anyone can join without approval',
                        value: 'OPEN'
                    },
                    {
                        label: 'Application Required',
                        description: 'Users must apply to join',
                        value: 'APPLICATION'
                    },
                    {
                        label: 'Invite Only',
                        description: 'Users must be invited to join',
                        value: 'INVITE_ONLY'
                    }
                ]);

            // Create confirm/cancel buttons
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('club_confirm')
                        .setLabel('Create Club')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('club_cancel')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Danger)
                );

            // Create setup embed
            const setupEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Club Creation')
                .setDescription('Let\'s set up your club! Follow these steps:')
                .addFields(
                    { name: '1. Club Name', value: interaction.options.getString('name'), inline: true },
                    { name: '2. Club ID', value: clubId, inline: true },
                    { name: '3. Club Icon', value: 'Select an icon below', inline: false },
                    { name: '4. Privacy Settings', value: 'Choose who can join your club', inline: false }
                )
                .setFooter({ text: 'You can cancel at any time' });

            // Send initial setup message
            const setupMessage = await interaction.reply({
                embeds: [setupEmbed],
                components: [
                    new ActionRowBuilder().addComponents(iconSelect),
                    new ActionRowBuilder().addComponents(privacySelect),
                    buttons
                ],
                ephemeral: true
            });

            // Store setup data
            const setupData = {
                name: interaction.options.getString('name'),
                clubId,
                icon: null,
                privacy: null
            };

            // Create collector for setup interactions
            const filter = i => i.user.id === interaction.user.id;
            const collector = setupMessage.createMessageComponentCollector({ filter, time: 300000 }); // 5 minutes

            collector.on('collect', async i => {
                if (i.customId === 'club_icon') {
                    setupData.icon = i.values[0];
                    await i.update({
                        embeds: [setupEmbed.setFields(
                            { name: '1. Club Name', value: setupData.name, inline: true },
                            { name: '2. Club ID', value: setupData.clubId, inline: true },
                            { name: '3. Club Icon', value: `Selected: ${i.values[0]}`, inline: false },
                            { name: '4. Privacy Settings', value: setupData.privacy ? `Selected: ${setupData.privacy}` : 'Choose who can join your club', inline: false }
                        )]
                    });
                }
                else if (i.customId === 'club_privacy') {
                    setupData.privacy = i.values[0];
                    await i.update({
                        embeds: [setupEmbed.setFields(
                            { name: '1. Club Name', value: setupData.name, inline: true },
                            { name: '2. Club ID', value: setupData.clubId, inline: true },
                            { name: '3. Club Icon', value: setupData.icon ? `Selected: ${setupData.icon}` : 'Select an icon below', inline: false },
                            { name: '4. Privacy Settings', value: `Selected: ${i.values[0]}`, inline: false }
                        )]
                    });
                }
                else if (i.customId === 'club_confirm') {
                    if (!setupData.icon || !setupData.privacy) {
                        await i.reply({
                            content: 'Please select both an icon and privacy settings before creating the club.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Create the club
                    const club = new Club({
                        name: setupData.name,
                        clubId: setupData.clubId,
                        icon: setupData.icon,
                        privacy: setupData.privacy,
                        owner: interaction.user.id,
                        members: [{
                            userId: interaction.user.id,
                            joinedAt: new Date()
                        }]
                    });

                    await club.save();

                    // Create success embed
                    const successEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('Club Created!')
                        .setDescription(`Your club "${setupData.name}" has been created successfully!`)
                        .addFields(
                            { name: 'Club ID', value: setupData.clubId, inline: true },
                            { name: 'Privacy', value: setupData.privacy, inline: true },
                            { name: 'Members', value: '1/10', inline: true }
                        )
                        .setThumbnail(`https://i.imgur.com/${setupData.icon.split('_')[1]}.png`)
                        .setFooter({ text: 'Use /club info to view your club details' });

                    await i.update({
                        embeds: [successEmbed],
                        components: []
                    });

                    collector.stop();
                }
                else if (i.customId === 'club_cancel') {
                    await i.update({
                        content: 'Club creation cancelled.',
                        embeds: [],
                        components: []
                    });
                    collector.stop();
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Club creation timed out. Please try again.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club create command:', error);
            await interaction.reply({
                content: 'An error occurred while creating your club. Please try again.',
                ephemeral: true
            });
        }
    }
}; 