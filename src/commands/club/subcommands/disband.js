
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
                    content: 'Only the club owner can disband the club!',
                    ephemeral: true
                });
            }

            // Create confirmation buttons
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_disband')
                        .setLabel('Confirm')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_disband')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send confirmation message
            const confirmEmbed = new EmbedBuilder()
                .setTitle('Disband Club')
                .setDescription(`Are you sure you want to disband **${club.name}**?\n\nThis action cannot be undone!`)
                .setColor('#ff0000')
                .setThumbnail(club.icon);

            const response = await interaction.reply({
                embeds: [confirmEmbed],
                components: [confirmRow],
                ephemeral: true
            });

            // Create button collector
            const collector = response.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 30000 // 30 seconds
            });

            collector.on('collect', async (i) => {
                if (i.customId === 'confirm_disband') {
                    try {
                        // Remove club from all members
                        await User.updateMany(
                            { club: club._id },
                            { $unset: { club: "", clubRole: "" } }
                        );

                        // Delete the club
                        await Club.findByIdAndDelete(club._id);

                        // Send success message
                        const successEmbed = new EmbedBuilder()
                            .setTitle('Club Disbanded')
                            .setDescription(`**${club.name}** has been disbanded.`)
                            .setColor('#ff0000');

                        await i.update({
                            embeds: [successEmbed],
                            components: []
                        });

                        logger.info('Club disbanded', {
                            clubId: club.id,
                            clubName: club.name,
                            ownerId: interaction.user.id
                        });

                    } catch (error) {
                        logger.error('Error disbanding club:', error);
                        await i.update({
                            content: 'An error occurred while disbanding the club. Please try again.',
                            embeds: [],
                            components: []
                        });
                    }
                } else if (i.customId === 'cancel_disband') {
                    await i.update({
                        content: 'Club disband cancelled.',
                        embeds: [],
                        components: []
                    });
                }
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Disband confirmation timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club disband command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 