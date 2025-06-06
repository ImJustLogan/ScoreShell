
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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
                    content: 'Only the club owner can rename the club!',
                    ephemeral: true
                });
            }

            const newName = interaction.options.getString('name');

            // If name is provided in the command, update directly
            if (newName !== null) {
                // Validate name length
                if (newName.length < 3 || newName.length > 32) {
                    return interaction.reply({
                        content: 'Club name must be between 3 and 32 characters long!',
                        ephemeral: true
                    });
                }

                try {
                    // Check if name is already taken
                    const existingClub = await Club.findOne({ 
                        name: newName,
                        _id: { $ne: club._id }
                    });

                    if (existingClub) {
                        return interaction.reply({
                            content: 'This club name is already taken! Please choose a different name.',
                            ephemeral: true
                        });
                    }

                    // Update club name
                    await Club.findByIdAndUpdate(club._id, { name: newName });

                    // Create response embed
                    const embed = new EmbedBuilder()
                        .setTitle('Club Renamed')
                        .setDescription(`Your club has been renamed to **${newName}**!`)
                        .setColor('#00ff00')
                        .setThumbnail(club.icon);

                    await interaction.reply({
                        embeds: [embed],
                        ephemeral: true
                    });

                    // Notify club members
                    try {
                        const members = await User.find({ club: club._id });
                        const notifyEmbed = new EmbedBuilder()
                            .setTitle('Club Renamed')
                            .setDescription(`Your club has been renamed to **${newName}**!`)
                            .setColor('#00ff00')
                            .setThumbnail(club.icon);

                        for (const member of members) {
                            if (member.discordId !== interaction.user.id) { // Don't notify the owner
                                try {
                                    await interaction.client.users.send(member.discordId, { embeds: [notifyEmbed] });
                                } catch (error) {
                                    logger.error('Error sending rename notification to member:', error);
                                }
                            }
                        }
                    } catch (error) {
                        logger.error('Error notifying club members of rename:', error);
                    }

                    logger.info('Club renamed', {
                        clubId: club.id,
                        oldName: club.name,
                        newName: newName,
                        updatedBy: interaction.user.id
                    });

                } catch (error) {
                    logger.error('Error updating club name:', error);
                    await interaction.reply({
                        content: 'An error occurred while updating the club name. Please try again.',
                        ephemeral: true
                    });
                }
                return;
            }

            // If no name provided, show modal for editing
            const modal = new ModalBuilder()
                .setCustomId('club_rename_modal')
                .setTitle('Rename Club');

            const nameInput = new TextInputBuilder()
                .setCustomId('name_input')
                .setLabel('New Club Name')
                .setPlaceholder('Enter your club\'s new name (3-32 characters)')
                .setStyle(TextInputStyle.Short)
                .setMinLength(3)
                .setMaxLength(32)
                .setValue(club.name)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder().addComponents(nameInput);
            modal.addComponents(firstActionRow);

            await interaction.showModal(modal);

            // Handle modal submission
            try {
                const submitted = await interaction.awaitModalSubmit({
                    time: 300000, // 5 minutes
                    filter: i => i.customId === 'club_rename_modal'
                });

                const submittedName = submitted.fields.getTextInputValue('name_input');

                // Check if name is already taken
                const existingClub = await Club.findOne({ 
                    name: submittedName,
                    _id: { $ne: club._id }
                });

                if (existingClub) {
                    await submitted.reply({
                        content: 'This club name is already taken! Please choose a different name.',
                        ephemeral: true
                    });
                    return;
                }

                // Update club name
                await Club.findByIdAndUpdate(club._id, { name: submittedName });

                // Create response embed
                const embed = new EmbedBuilder()
                    .setTitle('Club Renamed')
                    .setDescription(`Your club has been renamed to **${submittedName}**!`)
                    .setColor('#00ff00')
                    .setThumbnail(club.icon);

                await submitted.reply({
                    embeds: [embed],
                    ephemeral: true
                });

                // Notify club members
                try {
                    const members = await User.find({ club: club._id });
                    const notifyEmbed = new EmbedBuilder()
                        .setTitle('Club Renamed')
                        .setDescription(`Your club has been renamed to **${submittedName}**!`)
                        .setColor('#00ff00')
                        .setThumbnail(club.icon);

                    for (const member of members) {
                        if (member.discordId !== interaction.user.id) { // Don't notify the owner
                            try {
                                await interaction.client.users.send(member.discordId, { embeds: [notifyEmbed] });
                            } catch (error) {
                                logger.error('Error sending rename notification to member:', error);
                            }
                        }
                    }
                } catch (error) {
                    logger.error('Error notifying club members of rename:', error);
                }

                logger.info('Club renamed via modal', {
                    clubId: club.id,
                    oldName: club.name,
                    newName: submittedName,
                    updatedBy: interaction.user.id
                });

            } catch (error) {
                if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
                    logger.info('Club rename modal timed out', {
                        clubId: club.id,
                        clubName: club.name,
                        userId: interaction.user.id
                    });
                } else {
                    logger.error('Error handling club rename modal:', error);
                    await interaction.followUp({
                        content: 'An error occurred while updating the club name. Please try again.',
                        ephemeral: true
                    });
                }
            }

        } catch (error) {
            logger.error('Error in club rename command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 