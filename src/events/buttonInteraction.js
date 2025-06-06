const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { joinQueue, leaveQueue } = require('../utils/rankedSystem');
const { updateQueueDisplay } = require('../utils/queueDisplay');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton()) return;

        try {
            const [action, type, mode] = interaction.customId.split('_');

            switch (action) {
                case 'queue':
                    await handleQueueButton(interaction, type, mode);
                    break;
                default:
                    logger.warn(`Unknown button interaction: ${interaction.customId}`);
                    await interaction.reply({
                        content: 'This button is no longer valid.',
                        ephemeral: true
                    });
            }
        } catch (error) {
            logger.error('Error handling button interaction:', error);
            await interaction.reply({
                content: 'There was an error processing your request.',
                ephemeral: true
            }).catch(() => {});
        }
    }
};

/**
 * Handle queue-related button interactions
 * @param {ButtonInteraction} interaction - The button interaction
 * @param {string} type - The type of queue action (join/leave)
 * @param {string} mode - The queue mode (standard/challenge)
 */
async function handleQueueButton(interaction, type, mode) {
    const { user, guild } = interaction;

    // Defer reply since queue operations might take time
    await interaction.deferReply({ ephemeral: true });

    try {
        switch (type) {
            case 'join':
                // Check if user can join queue
                const canJoin = await joinQueue(user.id, guild.id, mode);
                if (!canJoin.success) {
                    await interaction.editReply({
                        content: canJoin.message,
                        ephemeral: true
                    });
                    return;
                }

                // Update queue display
                await updateQueueDisplay(interaction.client);
                
                await interaction.editReply({
                    content: `You have joined the ${mode} queue!`,
                    ephemeral: true
                });
                break;

            case 'leave':
                // Check if user can leave queue
                const canLeave = await leaveQueue(user.id, guild.id, mode);
                if (!canLeave.success) {
                    await interaction.editReply({
                        content: canLeave.message,
                        ephemeral: true
                    });
                    return;
                }

                // Update queue display
                await updateQueueDisplay(interaction.client);

                await interaction.editReply({
                    content: `You have left the ${mode} queue.`,
                    ephemeral: true
                });
                break;

            default:
                await interaction.editReply({
                    content: 'Invalid queue action.',
                    ephemeral: true
                });
        }
    } catch (error) {
        logger.error('Error in handleQueueButton:', error);
        await interaction.editReply({
            content: 'There was an error processing your queue request.',
            ephemeral: true
        });
    }
} 