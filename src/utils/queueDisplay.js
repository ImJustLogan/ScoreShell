const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');
const { getRankEmoji } = require('./helpers');

// Constants for queue display
const QUEUE_DISPLAY_CONFIG = {
    UPDATE_INTERVAL: 10000, // Update every 10 seconds
    MAX_PLAYERS_PER_ROW: 2,
    MATCHMAKING_TIMEOUT: 10000, // 10 seconds
    QUEUE_COLOR: '#5865F2',
    MATCHMAKING_COLOR: '#ff9900',
    EMPTY_QUEUE_MESSAGE: 'No players in queue'
};

/**
 * Update queue display across all servers
 * @param {Object} client - Discord client
 * @param {boolean} isMatchmaking - Whether matchmaking is in progress
 */
async function updateQueueDisplay(client, isMatchmaking = false) {
    try {
        // Get current queue state
        const queue = await client.db.collection('queue')
            .find({ status: 'ACTIVE' })
            .sort({ joinTime: 1 })
            .toArray();

        // Get all servers with ranked channels
        const servers = await client.db.collection('servers').find({
            'channels.rankedQueue': { $exists: true }
        }).toArray();

        // Create queue embed
        const embed = createQueueEmbed(queue, isMatchmaking);

        // Create queue buttons
        const buttons = createQueueButtons();

        // Update display in each server
        for (const server of servers) {
            try {
                const channel = await client.channels.fetch(server.channels.rankedQueue);
                if (!channel) continue;

                // Get or create queue message
                let queueMessage = await getQueueMessage(channel, server.queueMessageId);
                
                // Update message
                await queueMessage.edit({
                    embeds: [embed],
                    components: [buttons]
                });

                // Update server's queue message ID if needed
                if (queueMessage.id !== server.queueMessageId) {
                    await client.db.collection('servers').updateOne(
                        { _id: server._id },
                        { $set: { queueMessageId: queueMessage.id } }
                    );
                }
            } catch (error) {
                logger.error(`Error updating queue display in server ${server._id}:`, error);
            }
        }
    } catch (error) {
        logger.error('Error in updateQueueDisplay:', error);
    }
}

/**
 * Create queue embed
 * @param {Array} queue - Current queue entries
 * @param {boolean} isMatchmaking - Whether matchmaking is in progress
 * @returns {EmbedBuilder} Queue embed
 */
function createQueueEmbed(queue, isMatchmaking) {
    const embed = new EmbedBuilder()
        .setColor(isMatchmaking ? QUEUE_DISPLAY_CONFIG.MATCHMAKING_COLOR : QUEUE_DISPLAY_CONFIG.QUEUE_COLOR)
        .setTitle('Standard Queue')
        .setTimestamp();

    if (isMatchmaking) {
        embed.setDescription('Matchmaking in progress...');
    }

    // Group players into rows
    const playerRows = [];
    for (let i = 0; i < queue.length; i += QUEUE_DISPLAY_CONFIG.MAX_PLAYERS_PER_ROW) {
        const row = queue.slice(i, i + QUEUE_DISPLAY_CONFIG.MAX_PLAYERS_PER_ROW);
        playerRows.push(row);
    }

    // Add player slots
    if (playerRows.length > 0) {
        embed.addFields(
            playerRows.map((row, index) => ({
                name: `Slot ${index * QUEUE_DISPLAY_CONFIG.MAX_PLAYERS_PER_ROW + 1}-${index * QUEUE_DISPLAY_CONFIG.MAX_PLAYERS_PER_ROW + row.length}`,
                value: row.map(p => {
                    const rankEmoji = getRankEmoji(p.rank);
                    return `${rankEmoji} <@${p.userId}>`;
                }).join('\n'),
                inline: true
            }))
        );
    } else {
        embed.addFields({
            name: 'Empty Queue',
            value: QUEUE_DISPLAY_CONFIG.EMPTY_QUEUE_MESSAGE,
            inline: false
        });
    }

    return embed;
}

/**
 * Create queue buttons
 * @returns {ActionRowBuilder} Queue buttons
 */
function createQueueButtons() {
    const joinButton = new ButtonBuilder()
        .setCustomId('queue_join_standard')
        .setLabel('Join Standard')
        .setStyle(ButtonStyle.Primary);

    const leaveButton = new ButtonBuilder()
        .setCustomId('queue_leave_standard')
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(joinButton, leaveButton);
}

/**
 * Get or create queue message
 * @param {TextChannel} channel - Channel to get/create message in
 * @param {string} messageId - Existing message ID
 * @returns {Promise<Message>} Queue message
 */
async function getQueueMessage(channel, messageId) {
    try {
        if (messageId) {
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (message) return message;
        }

        // Create new message if none exists
        const embed = createQueueEmbed([], false);
        const buttons = createQueueButtons();
        return await channel.send({ embeds: [embed], components: [buttons] });
    } catch (error) {
        logger.error('Error getting queue message:', error);
        throw error;
    }
}

/**
 * Start queue display updates
 * @param {Object} client - Discord client
 */
function startQueueDisplayUpdates(client) {
    setInterval(async () => {
        try {
            await updateQueueDisplay(client);
        } catch (error) {
            logger.error('Error in queue display update interval:', error);
        }
    }, QUEUE_DISPLAY_CONFIG.UPDATE_INTERVAL);
}

module.exports = {
    QUEUE_DISPLAY_CONFIG,
    updateQueueDisplay,
    startQueueDisplayUpdates
}; 