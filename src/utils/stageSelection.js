const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');

// Stage data
const STAGES = {
    'Mario Stadium': {
        id: 'mario_stadium',
        emoji: '🏟️',
        description: 'The classic Mario Stadium'
    },
    'Luigi\'s Mansion': {
        id: 'luigi_mansion',
        emoji: '🏰',
        description: 'Spooky mansion with unique fielding mechanics'
    },
    'Peach Ice Garden': {
        id: 'peach_ice',
        emoji: '❄️',
        description: 'Slippery ice field with unique movement'
    },
    'Daisy Cruiser': {
        id: 'daisy_cruiser',
        emoji: '🚢',
        description: 'Cruise ship with tilting mechanics'
    },
    'Daisy Cruiser (Night)': {
        id: 'daisy_cruiser_night',
        emoji: '🌙',
        description: 'Night version of Daisy Cruiser'
    },
    'Yoshi Park': {
        id: 'yoshi_park',
        emoji: '🦖',
        description: 'Dinosaur-themed park with unique obstacles'
    },
    'Yoshi Park (Night)': {
        id: 'yoshi_park_night',
        emoji: '🌠',
        description: 'Night version of Yoshi Park'
    },
    'Wario City': {
        id: 'wario_city',
        emoji: '🌆',
        description: 'Urban environment with buildings'
    },
    'Bowser Jr. Playroom': {
        id: 'bowser_jr_playroom',
        emoji: '🎮',
        description: 'Toy-themed stage with unique mechanics'
    },
    'Bowser Castle': {
        id: 'bowser_castle',
        emoji: '🏰',
        description: 'Fiery castle with lava hazards'
    }
};

// Constants for stage selection
const STAGE_SELECTION_CONFIG = {
    BAN_TIMEOUT: 60000, // 60 seconds to ban a stage
    MAX_BANS: 4, // Number of stages to ban (will leave 1 stage)
    SELECTION_COLOR: '#5865F2',
    TIMEOUT_COLOR: '#FF0000'
};

/**
 * Start stage ban phase
 * @param {Object} client - Discord client
 * @param {string} matchId - Match ID
 * @param {Object} match - Match data
 * @returns {Promise<string>} Selected stage ID
 */
async function startStageBan(client, matchId, match) {
    try {
        // Get all servers with ranked channels
        const servers = await client.db.collection('servers').find({
            'channels.rankedQueue': { $exists: true }
        }).toArray();

        // Initialize stage ban state
        const availableStages = Object.keys(STAGES);
        const bannedStages = [];
        let currentBanIndex = 0;
        let currentPlayer = match.player1; // Player 1 bans first

        // Create initial stage ban message
        const embed = createStageBanEmbed(match, availableStages, bannedStages, currentPlayer);
        const buttons = createStageButtons(availableStages);

        // Send stage ban message to all servers
        let stageBanMessage = null;
        for (const server of servers) {
            try {
                const channel = await client.channels.fetch(server.channels.rankedQueue);
                if (!channel) continue;

                stageBanMessage = await channel.send({
                    content: `<@${currentPlayer.userId}>, it's your turn to ban a stage!`,
                    embeds: [embed],
                    components: [buttons]
                });
                break; // Only send to first available server
            } catch (error) {
                logger.error(`Error sending stage ban message in server ${server._id}:`, error);
            }
        }

        if (!stageBanMessage) {
            throw new Error('Could not send stage ban message to any server');
        }

        // Create button collector
        const collector = stageBanMessage.createMessageComponentCollector({
            filter: i => i.user.id === currentPlayer.userId,
            time: STAGE_SELECTION_CONFIG.BAN_TIMEOUT
        });

        // Handle stage bans
        return new Promise((resolve, reject) => {
            collector.on('collect', async (interaction) => {
                try {
                    const stageName = interaction.customId.replace('stage_ban_', '');
                    if (!availableStages.includes(stageName)) {
                        await interaction.reply({
                            content: 'This stage is no longer available.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Ban the stage
                    bannedStages.push(stageName);
                    availableStages.splice(availableStages.indexOf(stageName), 1);

                    // Update message
                    currentBanIndex++;
                    if (currentBanIndex < STAGE_SELECTION_CONFIG.MAX_BANS) {
                        // Switch players
                        currentPlayer = currentPlayer === match.player1 ? match.player2 : match.player1;

                        // Update embed and buttons
                        const updatedEmbed = createStageBanEmbed(match, availableStages, bannedStages, currentPlayer);
                        const updatedButtons = createStageButtons(availableStages);

                        await stageBanMessage.edit({
                            content: `<@${currentPlayer.userId}>, it's your turn to ban a stage!`,
                            embeds: [updatedEmbed],
                            components: [updatedButtons]
                        });

                        // Reset collector for next player
                        collector.resetTimer();
                    } else {
                        // Stage ban phase complete
                        const selectedStage = availableStages[0];
                        await stageBanMessage.edit({
                            content: `Stage selected: ${selectedStage} ${STAGES[selectedStage].emoji}`,
                            embeds: [createStageBanEmbed(match, availableStages, bannedStages, null, selectedStage)],
                            components: []
                        });

                        // Update match with selected stage
                        await client.db.collection('matches').updateOne(
                            { _id: matchId },
                            { $set: { stage: selectedStage } }
                        );

                        collector.stop('complete');
                        resolve(selectedStage);
                    }

                    await interaction.deferUpdate();
                } catch (error) {
                    logger.error('Error handling stage ban:', error);
                    reject(error);
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'complete') return;

                // Handle timeout or error
                const timeoutEmbed = new EmbedBuilder()
                    .setColor(STAGE_SELECTION_CONFIG.TIMEOUT_COLOR)
                    .setTitle('Stage Ban Timeout')
                    .setDescription(`<@${currentPlayer.userId}> did not ban a stage in time.`)
                    .setTimestamp();

                await stageBanMessage.edit({
                    content: null,
                    embeds: [timeoutEmbed],
                    components: []
                });

                reject(new Error('Stage ban timeout'));
            });
        });

    } catch (error) {
        logger.error('Error in stage ban phase:', error);
        throw error;
    }
}

/**
 * Create stage ban embed
 * @param {Object} match - Match data
 * @param {Array} availableStages - Available stages
 * @param {Array} bannedStages - Banned stages
 * @param {Object} currentPlayer - Current player
 * @param {string} selectedStage - Selected stage (if any)
 * @returns {EmbedBuilder} Stage ban embed
 */
function createStageBanEmbed(match, availableStages, bannedStages, currentPlayer, selectedStage = null) {
    const embed = new EmbedBuilder()
        .setColor(STAGE_SELECTION_CONFIG.SELECTION_COLOR)
        .setTitle('Stage Ban Phase')
        .setTimestamp();

    if (selectedStage) {
        embed.setDescription(`Stage selected: ${selectedStage} ${STAGES[selectedStage].emoji}`);
    } else {
        embed.setDescription(`<@${currentPlayer.userId}>'s turn to ban a stage`);
    }

    // Add available stages
    if (availableStages.length > 0) {
        embed.addFields({
            name: 'Available Stages',
            value: availableStages.map(stage => `${STAGES[stage].emoji} ${stage}`).join('\n'),
            inline: true
        });
    }

    // Add banned stages
    if (bannedStages.length > 0) {
        embed.addFields({
            name: 'Banned Stages',
            value: bannedStages.map(stage => `${STAGES[stage].emoji} ${stage}`).join('\n'),
            inline: true
        });
    }

    return embed;
}

/**
 * Create stage buttons
 * @param {Array} availableStages - Available stages
 * @returns {ActionRowBuilder} Stage buttons
 */
function createStageButtons(availableStages) {
    const buttons = availableStages.map(stage => 
        new ButtonBuilder()
            .setCustomId(`stage_ban_${stage}`)
            .setLabel(stage)
            .setEmoji(STAGES[stage].emoji)
            .setStyle(ButtonStyle.Secondary)
    );

    // Split buttons into rows of 5
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(
            new ActionRowBuilder().addComponents(buttons.slice(i, i + 5))
        );
    }

    return rows;
}

module.exports = {
    STAGES,
    STAGE_SELECTION_CONFIG,
    startStageBan
}; 