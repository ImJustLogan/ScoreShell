const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

// Club icon options with their emoji IDs and image URLs
const CLUB_ICONS = {
    red: {
        emoji: '1340463594055139328',
        image: 'https://i.imgur.com/sy8o63Y.png'
    },
    blue: {
        emoji: '1340464817428758558',
        image: 'https://i.imgur.com/2jH5dQU.png'
    },
    yellow: {
        emoji: '1340464843576049774',
        image: 'https://i.imgur.com/nywWQyZ.png'
    },
    green: {
        emoji: '1340464944126230598',
        image: 'https://i.imgur.com/JnBP5ro.png'
    },
    pink: {
        emoji: '1340464971741528084',
        image: 'https://i.imgur.com/ToavyvN.png'
    },
    cyan: {
        emoji: '1340465007598764124',
        image: 'https://i.imgur.com/81HXsR8.png'
    }
};

// Privacy settings
const PRIVACY_SETTINGS = {
    open: {
        name: 'Open',
        description: 'Anyone can join without approval',
        value: 'open'
    },
    application: {
        name: 'Application Required',
        description: 'Users must apply to join',
        value: 'application'
    },
    invite: {
        name: 'Invite Only',
        description: 'Users must be invited to join',
        value: 'invite'
    }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('settings')
                .setDescription('Manage your club settings')),

    async execute(interaction) {
        try {
            // Find user's club
            const club = await Club.findOne({
                owner: interaction.user.id
            });

            if (!club) {
                return interaction.reply({
                    content: 'You must be a club owner to use this command.',
                    ephemeral: true
                });
            }

            // Create main settings embed
            const mainEmbed = new EmbedBuilder()
                .setColor('#80FFFF')
                .setTitle('Club Settings')
                .setDescription(`Manage settings for **${club.name}**`)
                .addFields(
                    {
                        name: 'Current Settings',
                        value: [
                            `**Club Name:** ${club.name}`,
                            `**Club ID:** ${club.clubId}`,
                            `**Club Icon:** <:club_${club.icon}:${CLUB_ICONS[club.icon].emoji}>`,
                            `**Privacy:** ${PRIVACY_SETTINGS[club.privacy].name}`,
                            `**Description:** ${club.description || 'No description set'}`
                        ].join('\n'),
                        inline: false
                    }
                )
                .setThumbnail(CLUB_ICONS[club.icon].image)
                .setFooter({ text: 'Select an option below to modify settings' });

            // Create settings menu
            const settingsMenu = new StringSelectMenuBuilder()
                .setCustomId('club_settings_menu')
                .setPlaceholder('Select a setting to modify')
                .addOptions([
                    {
                        label: 'Change Club Icon',
                        description: 'Select a new icon for your club',
                        value: 'icon',
                        emoji: '🎨'
                    },
                    {
                        label: 'Update Privacy Settings',
                        description: 'Change how users can join your club',
                        value: 'privacy',
                        emoji: '🔒'
                    },
                    {
                        label: 'Edit Club Name',
                        description: 'Change your club\'s display name',
                        value: 'name',
                        emoji: '📝'
                    },
                    {
                        label: 'Edit Description',
                        description: 'Update your club\'s description',
                        value: 'description',
                        emoji: '📄'
                    }
                ]);

            const row = new ActionRowBuilder().addComponents(settingsMenu);

            // Send initial settings message
            const message = await interaction.reply({
                embeds: [mainEmbed],
                components: [row],
                ephemeral: true
            });

            // Create collector for menu interactions
            const filter = i => i.user.id === interaction.user.id;
            const collector = message.createMessageComponentCollector({ 
                filter, 
                time: 300000 // 5 minutes
            });

            collector.on('collect', async i => {
                if (i.customId === 'club_settings_menu') {
                    const setting = i.values[0];

                    switch (setting) {
                        case 'icon':
                            // Create icon selection menu
                            const iconMenu = new StringSelectMenuBuilder()
                                .setCustomId('club_icon_menu')
                                .setPlaceholder('Select a new club icon')
                                .addOptions(Object.entries(CLUB_ICONS).map(([key, value]) => ({
                                    label: key.charAt(0).toUpperCase() + key.slice(1),
                                    value: key,
                                    emoji: value.emoji,
                                    default: key === club.icon
                                })));

                            const iconRow = new ActionRowBuilder().addComponents(iconMenu);
                            await i.update({
                                embeds: [mainEmbed.setDescription('Select a new club icon:')],
                                components: [iconRow]
                            });
                            break;

                        case 'privacy':
                            // Create privacy settings menu
                            const privacyMenu = new StringSelectMenuBuilder()
                                .setCustomId('club_privacy_menu')
                                .setPlaceholder('Select privacy setting')
                                .addOptions(Object.values(PRIVACY_SETTINGS).map(setting => ({
                                    label: setting.name,
                                    description: setting.description,
                                    value: setting.value,
                                    default: setting.value === club.privacy
                                })));

                            const privacyRow = new ActionRowBuilder().addComponents(privacyMenu);
                            await i.update({
                                embeds: [mainEmbed.setDescription('Select a new privacy setting:')],
                                components: [privacyRow]
                            });
                            break;

                        case 'name':
                            // Create name edit modal
                            const nameModal = new ModalBuilder()
                                .setCustomId('club_name_modal')
                                .setTitle('Edit Club Name');

                            const nameInput = new TextInputBuilder()
                                .setCustomId('club_name_input')
                                .setLabel('New Club Name')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Enter new club name')
                                .setValue(club.name)
                                .setRequired(true)
                                .setMinLength(3)
                                .setMaxLength(32);

                            const nameRow = new ActionRowBuilder().addComponents(nameInput);
                            nameModal.addComponents(nameRow);

                            await i.showModal(nameModal);
                            break;

                        case 'description':
                            // Create description edit modal
                            const descModal = new ModalBuilder()
                                .setCustomId('club_description_modal')
                                .setTitle('Edit Club Description');

                            const descInput = new TextInputBuilder()
                                .setCustomId('club_description_input')
                                .setLabel('New Description')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('Enter new club description')
                                .setValue(club.description || '')
                                .setRequired(false)
                                .setMaxLength(1000);

                            const descRow = new ActionRowBuilder().addComponents(descInput);
                            descModal.addComponents(descRow);

                            await i.showModal(descModal);
                            break;
                    }
                } else if (i.customId === 'club_icon_menu') {
                    const newIcon = i.values[0];
                    try {
                        await Club.updateOne(
                            { _id: club._id },
                            { 
                                $set: { 
                                    icon: newIcon,
                                    updatedAt: new Date()
                                }
                            }
                        );

                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Club Icon Updated')
                            .setDescription(`Club icon has been updated to <:club_${newIcon}:${CLUB_ICONS[newIcon].emoji}>`)
                            .setThumbnail(CLUB_ICONS[newIcon].image);

                        await i.update({
                            embeds: [successEmbed],
                            components: [row]
                        });

                        // Update main embed for next interaction
                        mainEmbed.setThumbnail(CLUB_ICONS[newIcon].image);
                        mainEmbed.fields[0].value = mainEmbed.fields[0].value.replace(
                            /(\*\*Club Icon:\*\* ).*/,
                            `$1<:club_${newIcon}:${CLUB_ICONS[newIcon].emoji}>`
                        );

                        logger.info(`Club ${club.name} (${club.clubId}) icon updated to ${newIcon} by ${interaction.user.tag}`);
                    } catch (error) {
                        logger.error('Error updating club icon:', error);
                        await i.reply({
                            content: 'An error occurred while updating the club icon.',
                            ephemeral: true
                        });
                    }
                } else if (i.customId === 'club_privacy_menu') {
                    const newPrivacy = i.values[0];
                    try {
                        await Club.updateOne(
                            { _id: club._id },
                            { 
                                $set: { 
                                    privacy: newPrivacy,
                                    updatedAt: new Date()
                                }
                            }
                        );

                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Privacy Settings Updated')
                            .setDescription(`Club privacy has been updated to **${PRIVACY_SETTINGS[newPrivacy].name}**`)
                            .addFields({
                                name: 'New Setting',
                                value: PRIVACY_SETTINGS[newPrivacy].description,
                                inline: false
                            });

                        await i.update({
                            embeds: [successEmbed],
                            components: [row]
                        });

                        // Update main embed for next interaction
                        mainEmbed.fields[0].value = mainEmbed.fields[0].value.replace(
                            /(\*\*Privacy:\*\* ).*/,
                            `$1${PRIVACY_SETTINGS[newPrivacy].name}`
                        );

                        logger.info(`Club ${club.name} (${club.clubId}) privacy updated to ${newPrivacy} by ${interaction.user.tag}`);
                    } catch (error) {
                        logger.error('Error updating club privacy:', error);
                        await i.reply({
                            content: 'An error occurred while updating privacy settings.',
                            ephemeral: true
                        });
                    }
                }
            });

            // Handle modal submissions
            interaction.client.on('interactionCreate', async modalInteraction => {
                if (!modalInteraction.isModalSubmit()) return;
                if (modalInteraction.user.id !== interaction.user.id) return;

                try {
                    if (modalInteraction.customId === 'club_name_modal') {
                        const newName = modalInteraction.fields.getTextInputValue('club_name_input');
                        
                        // Check if name is already taken
                        const existingClub = await Club.findOne({ name: newName });
                        if (existingClub && existingClub._id.toString() !== club._id.toString()) {
                            await modalInteraction.reply({
                                content: 'This club name is already taken. Please choose a different name.',
                                ephemeral: true
                            });
                            return;
                        }

                        await Club.updateOne(
                            { _id: club._id },
                            { 
                                $set: { 
                                    name: newName,
                                    updatedAt: new Date()
                                }
                            }
                        );

                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Club Name Updated')
                            .setDescription(`Club name has been updated to **${newName}**`);

                        await modalInteraction.reply({
                            embeds: [successEmbed],
                            components: [row],
                            ephemeral: true
                        });

                        // Update main embed for next interaction
                        mainEmbed.setDescription(`Manage settings for **${newName}**`);
                        mainEmbed.fields[0].value = mainEmbed.fields[0].value.replace(
                            /(\*\*Club Name:\*\* ).*/,
                            `$1${newName}`
                        );

                        logger.info(`Club ${club.clubId} name updated from "${club.name}" to "${newName}" by ${interaction.user.tag}`);

                    } else if (modalInteraction.customId === 'club_description_modal') {
                        const newDescription = modalInteraction.fields.getTextInputValue('club_description_input');

                        await Club.updateOne(
                            { _id: club._id },
                            { 
                                $set: { 
                                    description: newDescription || null,
                                    updatedAt: new Date()
                                }
                            }
                        );

                        const successEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('Club Description Updated')
                            .setDescription(`Club description has been ${newDescription ? 'updated' : 'cleared'}`)
                            .addFields({
                                name: 'New Description',
                                value: newDescription || 'No description set',
                                inline: false
                            });

                        await modalInteraction.reply({
                            embeds: [successEmbed],
                            components: [row],
                            ephemeral: true
                        });

                        // Update main embed for next interaction
                        mainEmbed.fields[0].value = mainEmbed.fields[0].value.replace(
                            /(\*\*Description:\*\* ).*/,
                            `$1${newDescription || 'No description set'}`
                        );

                        logger.info(`Club ${club.name} (${club.clubId}) description updated by ${interaction.user.tag}`);
                    }
                } catch (error) {
                    logger.error('Error processing modal submission:', error);
                    await modalInteraction.reply({
                        content: 'An error occurred while updating the club settings.',
                        ephemeral: true
                    });
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        embeds: [mainEmbed.setDescription('Settings menu timed out. Use `/club settings` to reopen.')],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club settings command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the settings command.',
                ephemeral: true
            });
        }
    }
}; 