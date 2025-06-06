
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
                    content: 'Only the club owner can set the club description!',
                    ephemeral: true
                });
            }

            const description = interaction.options.getString('description');

            // If description is provided in the command, update directly
            if (description !== null) {
                try {
                    // Update club description
                    await Club.findByIdAndUpdate(club._id, { 
                        description: description || null // Remove description if empty string
                    });

                    // Create response embed
                    const embed = new EmbedBuilder()
                        .setTitle('Club Description Updated')
                        .setDescription(description 
                            ? `Your club's description has been updated to:\n\n${description}`
                            : 'Your club\'s description has been removed.')
                        .setColor('#00ff00')
                        .setThumbnail(club.icon);

                    await interaction.reply({
                        embeds: [embed],
                        ephemeral: true
                    });

                    logger.info('Club description updated', {
                        clubId: club.id,
                        clubName: club.name,
                        updatedBy: interaction.user.id,
                        hasDescription: !!description
                    });

                } catch (error) {
                    logger.error('Error updating club description:', error);
                    await interaction.reply({
                        content: 'An error occurred while updating the club description. Please try again.',
                        ephemeral: true
                    });
                }
                return;
            }

            // If no description provided, show modal for editing
            const modal = new ModalBuilder()
                .setCustomId('club_description_modal')
                .setTitle('Set Club Description');

            const descriptionInput = new TextInputBuilder()
                .setCustomId('description_input')
                .setLabel('Club Description')
                .setPlaceholder('Enter your club\'s description (max 1000 characters)')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setValue(club.description || '')
                .setRequired(false);

            const firstActionRow = new ActionRowBuilder().addComponents(descriptionInput);
            modal.addComponents(firstActionRow);

            await interaction.showModal(modal);

            // Handle modal submission
            try {
                const submitted = await interaction.awaitModalSubmit({
                    time: 300000, // 5 minutes
                    filter: i => i.customId === 'club_description_modal'
                });

                const newDescription = submitted.fields.getTextInputValue('description_input');

                // Update club description
                await Club.findByIdAndUpdate(club._id, { 
                    description: newDescription || null // Remove description if empty string
                });

                // Create response embed
                const embed = new EmbedBuilder()
                    .setTitle('Club Description Updated')
                    .setDescription(newDescription 
                        ? `Your club's description has been updated to:\n\n${newDescription}`
                        : 'Your club\'s description has been removed.')
                    .setColor('#00ff00')
                    .setThumbnail(club.icon);

                await submitted.reply({
                    embeds: [embed],
                    ephemeral: true
                });

                logger.info('Club description updated via modal', {
                    clubId: club.id,
                    clubName: club.name,
                    updatedBy: interaction.user.id,
                    hasDescription: !!newDescription
                });

            } catch (error) {
                if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
                    logger.info('Club description modal timed out', {
                        clubId: club.id,
                        clubName: club.name,
                        userId: interaction.user.id
                    });
                } else {
                    logger.error('Error handling club description modal:', error);
                    await interaction.followUp({
                        content: 'An error occurred while updating the club description. Please try again.',
                        ephemeral: true
                    });
                }
            }

        } catch (error) {
            logger.error('Error in club description command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 