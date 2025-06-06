const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');
const { updateQueueDisplay } = require('./queueDisplay');
const { startStageBan } = require('./stageSelection');
const { recordError, recordMatchmakingAttempt, recordMatchCompletion } = require('./performanceMonitor');
const { 
    processQueueBatch, 
    cleanupQueue, 
    QUEUE_CONFIG,
    calculateMatchQuality 
} = require('./queueManager');
const PreGameManager = require('./preGameManager');
const RoomCodeManager = require('./roomCodeManager');
const Match = require('../models/Match');

// Constants for matchmaking
const MATCHMAKING_CONFIG = {
    MIN_PLAYERS: 2,
    MATCHMAKING_TIMEOUT: 10000, // 10 seconds
    MAX_RANK_DIFFERENCE: 3, // Maximum rank difference between players
    MAX_REGION_DISTANCE: 2, // Maximum region distance (1 = same country, 2 = neighboring, etc.)
    MATCH_CANCEL_TIMEOUT: 5400000, // 1.5 hours in milliseconds
    PREGAME_TIMEOUT: 600000, // 10 minutes in milliseconds
    MATCH_COLOR: '#00FF00',
    MATCHMAKING_COLOR: '#FFA500',
    MAX_RETRIES: 3,
    RETRY_DELAY: 5000, // 5 seconds
    NETWORK_TIMEOUT: 10000, // 10 seconds
    RECOVERY_INTERVAL: 30000 // 30 seconds
};

// Error recovery state
const recoveryState = {
    isRecovering: false,
    lastRecoveryAttempt: null,
    recoveryAttempts: 0,
    failedMatches: new Set(),
    networkErrors: 0
};

class MatchmakingSystem {
    constructor(client) {
        this.client = client;
        this.queue = new Map(); // Map of userId -> { timestamp, region }
        this.preGameManager = new PreGameManager(client);
        this.roomCodeManager = new RoomCodeManager(client);
        this.activeMatches = new Map(); // Map of matchId -> { channel, timeout }
    }

    async addToQueue(userId, region) {
        if (this.queue.has(userId)) {
            return false; // Already in queue
        }

        // Check if user is in an active match
        const activeMatch = await Match.findOne({
            'players.userId': userId,
            status: { $in: ['PREGAME', 'IN_PROGRESS'] }
        });

        if (activeMatch) {
            return false; // User is in an active match
        }

        this.queue.set(userId, {
            timestamp: Date.now(),
            region
        });

        return true;
    }

    async removeFromQueue(userId) {
        return this.queue.delete(userId);
    }

    async findMatch(userId) {
        const player = this.queue.get(userId);
        if (!player) return null;

        // Find best match based on region and queue time
        let bestMatch = null;
        let bestScore = Infinity;

        for (const [otherId, other] of this.queue.entries()) {
            if (otherId === userId) continue;

            // Calculate match score (lower is better)
            const timeDiff = Math.abs(player.timestamp - other.timestamp);
            const regionMatch = player.region === other.region ? 0 : 1;
            const score = timeDiff + (regionMatch * 300000); // 5 minutes penalty for different regions

            if (score < bestScore) {
                bestScore = score;
                bestMatch = otherId;
            }
        }

        if (bestMatch) {
            // Remove both players from queue
            this.queue.delete(userId);
            this.queue.delete(bestMatch);
            return bestMatch;
        }

        return null;
    }

    async createMatch(player1Id, player2Id, channel) {
        // Create match document
        const match = new Match({
            type: 'RANKED',
            status: 'PREGAME',
            players: [
                { userId: player1Id, score: 0, captain: null, isHost: false },
                { userId: player2Id, score: 0, captain: null, isHost: false }
            ],
            startTime: new Date(),
            history: [{
                action: 'CREATED',
                timestamp: new Date()
            }]
        });

        await match.save();

        // Start pre-game phase
        await this.preGameManager.startPreGame(match, channel);

        // Set timeout for entire pre-game phase
        const timeout = setTimeout(async () => {
            if (this.activeMatches.has(match._id)) {
                await this.handlePreGameTimeout(match, channel);
            }
        }, 600000); // 10 minutes

        this.activeMatches.set(match._id, {
            channel,
            timeout
        });

        return match;
    }

    async handlePreGameTimeout(match, channel) {
        const matchData = this.activeMatches.get(match._id);
        if (!matchData) return;

        clearTimeout(matchData.timeout);
        this.activeMatches.delete(match._id);

        // Cancel any active room code request
        await this.roomCodeManager.cancelRequest(match._id);

        // Update match status
        match.status = 'CANCELLED';
        match.endTime = new Date();
        match.history.push({
            action: 'CANCELLED',
            reason: 'Pre-game phase timeout',
            timestamp: new Date()
        });
        await match.save();

        // Notify players
        const embed = new EmbedBuilder()
            .setTitle('Match Cancelled')
            .setDescription('Match was cancelled due to pre-game phase timeout.')
            .setColor('#FF0000');

        await channel.send({
            content: match.players.map(p => `<@${p.userId}>`).join(' '),
            embeds: [embed]
        });
    }

    async handleMatchComplete(matchId) {
        const matchData = this.activeMatches.get(matchId);
        if (matchData) {
            clearTimeout(matchData.timeout);
            this.activeMatches.delete(matchId);
        }
    }

    getQueueStatus() {
        return Array.from(this.queue.entries()).map(([userId, data]) => ({
            userId,
            region: data.region,
            waitTime: Date.now() - data.timestamp
        }));
    }
}

/**
 * Handle network errors and attempt recovery
 * @param {Object} client - Discord client
 * @param {Error} error - Error object
 */
async function handleNetworkError(client, error) {
    recordError('network', error);
    recoveryState.networkErrors++;
    
    if (recoveryState.networkErrors >= 3 && !recoveryState.isRecovering) {
        await startRecovery(client);
    }
}

/**
 * Start recovery process
 * @param {Object} client - Discord client
 */
async function startRecovery(client) {
    if (recoveryState.isRecovering) return;
    
    recoveryState.isRecovering = true;
    recoveryState.lastRecoveryAttempt = Date.now();
    recoveryState.recoveryAttempts++;
    
    logger.warn('Starting matchmaking recovery process');
    
    try {
        // 1. Verify database connection
        await client.db.command({ ping: 1 });
        
        // 2. Clean up any stale matches
        const staleMatches = await client.db.collection('matches').find({
            status: { $in: ['PREGAME', 'ACTIVE'] },
            startTime: { $lt: new Date(Date.now() - MATCHMAKING_CONFIG.MATCH_CANCEL_TIMEOUT) }
        }).toArray();
        
        for (const match of staleMatches) {
            await cancelMatch(client, match._id, 'Match cancelled during recovery');
        }
        
        // 3. Reset queue state
        await client.db.collection('queue').updateMany(
            { status: 'MATCHING' },
            { $set: { status: 'ACTIVE', matchmakingAttempts: 0 } }
        );
        
        // 4. Clear recovery state
        recoveryState.failedMatches.clear();
        recoveryState.networkErrors = 0;
        recoveryState.isRecovering = false;
        
        logger.info('Matchmaking recovery completed successfully');
        
        // 5. Restart matchmaking service
        await updateQueueDisplay(client, false);
        startMatchmakingService(client);
        
    } catch (error) {
        logger.error('Recovery process failed:', error);
        recoveryState.isRecovering = false;
        
        // Schedule another recovery attempt if we haven't exceeded max retries
        if (recoveryState.recoveryAttempts < MATCHMAKING_CONFIG.MAX_RETRIES) {
            setTimeout(() => startRecovery(client), MATCHMAKING_CONFIG.RECOVERY_INTERVAL);
        } else {
            logger.error('Max recovery attempts reached. Manual intervention required.');
            // Notify administrators
            const owner = await client.users.fetch('816854656097583135');
            if (owner) {
                await owner.send({
                    content: '⚠️ Matchmaking system requires manual intervention. Max recovery attempts reached.'
                }).catch(() => {});
            }
        }
    }
}

/**
 * Start matchmaking process with enhanced error handling
 * @param {Object} client - Discord client
 */
async function startMatchmaking(client) {
    const startTime = Date.now();
    
    try {
        // Clean up stale queue entries
        await cleanupQueue(client);
        
        // Get current queue with timeout
        const queue = await Promise.race([
            client.db.collection('queue')
                .find({ status: 'ACTIVE' })
                .sort({ joinTime: 1 })
                .toArray(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Database timeout')), MATCHMAKING_CONFIG.NETWORK_TIMEOUT)
            )
        ]);

        // Check if we have enough players
        if (queue.length < QUEUE_CONFIG.MIN_QUEUE_SIZE) {
            return;
        }

        // Update queue display to show matchmaking
        await updateQueueDisplay(client, true);

        // Wait for matchmaking timeout
        await new Promise(resolve => setTimeout(resolve, MATCHMAKING_CONFIG.MATCHMAKING_TIMEOUT));

        // Process queue batch for potential matches
        const potentialMatches = await processQueueBatch(client, queue);
        
        if (potentialMatches.length === 0) {
            await updateQueueDisplay(client, false);
            return;
        }

        // Create matches for the best quality matches
        for (const match of potentialMatches) {
            try {
                // Record matchmaking attempt
                const matchmakingTime = Date.now() - startTime;
                const isCrossRegion = match.player1.region !== match.player2.region;
                recordMatchmakingAttempt(match, match.quality, matchmakingTime, isCrossRegion);

                // Create match with retry logic
                let retries = 0;
                while (retries < MATCHMAKING_CONFIG.MAX_RETRIES) {
                    try {
                        await createMatch(client, {
                            player1: match.player1,
                            player2: match.player2,
                            score: match.quality
                        });
                        break;
                    } catch (error) {
                        retries++;
                        if (retries === MATCHMAKING_CONFIG.MAX_RETRIES) {
                            throw error;
                        }
                        await new Promise(resolve => setTimeout(resolve, MATCHMAKING_CONFIG.RETRY_DELAY));
                    }
                }
            } catch (error) {
                logger.error('Error creating match:', error);
                recordError('match_creation', error);
            }
        }

    } catch (error) {
        logger.error('Error in matchmaking:', error);
        recordError('matchmaking', error);
        
        if (error.name === 'MongoNetworkError' || error.message === 'Database timeout') {
            await handleNetworkError(client, error);
        }
        
        await updateQueueDisplay(client, false);
    }
}

/**
 * Create a new match
 * @param {Object} client - Discord client
 * @param {Object} matchData - Match data
 */
async function createMatch(client, matchData) {
    const { player1, player2, score } = matchData;
    
    // Create match document
    const match = {
        players: [
            {
                userId: player1.userId,
                username: player1.username,
                rank: player1.rank,
                region: player1.region,
                score: 0,
                reported: false,
                captain: null,
                isHost: false
            },
            {
                userId: player2.userId,
                username: player2.username,
                rank: player2.rank,
                region: player2.region,
                score: 0,
                reported: false,
                captain: null,
                isHost: false
            }
        ],
        status: 'PREGAME',
        startTime: new Date(),
        endTime: null,
        winner: null,
        matchQuality: score,
        stage: null,
        roomCode: null,
        reportedBy: [],
        disputes: [],
        chatChannel: null,
        history: []
    };

    // Insert match into database
    const result = await client.db.collection('matches').insertOne(match);
    const matchId = result.insertedId;

    // Remove players from queue
    await Promise.all([
        client.db.collection('queue').deleteOne({ userId: player1.userId }),
        client.db.collection('queue').deleteOne({ userId: player2.userId })
    ]);

    // Create match channel
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const category = await guild.channels.fetch(process.env.MATCHES_CATEGORY_ID);
    
    const channel = await guild.channels.create({
        name: `match-${matchId}`,
        type: 0, // Text channel
        parent: category.id,
        permissionOverwrites: [
            {
                id: guild.id,
                deny: ['ViewChannel']
            },
            {
                id: player1.userId,
                allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
            },
            {
                id: player2.userId,
                allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
            }
        ]
    });

    // Update match with channel ID
    await client.db.collection('matches').updateOne(
        { _id: matchId },
        { $set: { chatChannel: channel.id } }
    );

    // Send match announcement
    const embed = new EmbedBuilder()
        .setTitle('Match Found!')
        .setColor(MATCHMAKING_CONFIG.MATCH_COLOR)
        .setDescription('Starting pregame phase...')
        .addFields(
            { name: 'Player 1', value: `<@${player1.userId}> (Rank ${player1.rank})`, inline: true },
            { name: 'Player 2', value: `<@${player2.userId}> (Rank ${player2.rank})`, inline: true }
        )
        .setFooter({ 
            text: `Match ID: ${matchId} | Match Quality: ${Math.round(score * 100)}% [Learn More](https://sites.google.com/view/mario-all-star-league/faq#:~:text=What%20is%20%22Match%20Quality%3F%22)`
        });

    await channel.send({ embeds: [embed] });

    // Initialize pre-game manager and start pre-game phase
    const preGameManager = new PreGameManager(client);
    await preGameManager.startPreGame({ ...match, _id: matchId }, channel);

    // Start match timeout
    setTimeout(async () => {
        const currentMatch = await client.db.collection('matches').findOne({ _id: matchId });
        if (currentMatch && currentMatch.status === 'PREGAME') {
            await cancelMatch(client, matchId, 'Match cancelled due to timeout');
        }
    }, MATCHMAKING_CONFIG.PREGAME_TIMEOUT);

    return matchId;
}

/**
 * Cancel a match
 * @param {Object} client - Discord client
 * @param {ObjectId} matchId - Match ID
 * @param {string} reason - Cancellation reason
 */
async function cancelMatch(client, matchId, reason) {
    try {
        const match = await client.db.collection('matches').findOne({ _id: matchId });
        if (!match) return;

        // Update match status
        await client.db.collection('matches').updateOne(
            { _id: matchId },
            { 
                $set: { 
                    status: 'CANCELLED',
                    endTime: new Date(),
                    cancellationReason: reason
                }
            }
        );

        // Return players to queue if they were in queue
        const players = [match.player1, match.player2];
        for (const player of players) {
            const queueEntry = await client.db.collection('queue').findOne({ userId: player.userId });
            if (!queueEntry) {
                await client.db.collection('queue').insertOne({
                    userId: player.userId,
                    username: player.username,
                    rank: player.rank,
                    region: player.region,
                    joinTime: new Date(),
                    status: 'ACTIVE',
                    matchmakingAttempts: 0
                });
            }
        }

        // Delete match channel
        if (match.chatChannel) {
            try {
                const channel = await client.channels.fetch(match.chatChannel);
                if (channel) await channel.delete();
            } catch (error) {
                logger.error('Error deleting match channel:', error);
            }
        }

        // Record match completion
        recordMatchCompletion(match, 'CANCELLED', reason);

    } catch (error) {
        logger.error('Error cancelling match:', error);
        recordError('match_cancellation', error);
    }
}

/**
 * Start matchmaking service with enhanced error handling
 * @param {Object} client - Discord client
 */
function startMatchmakingService(client) {
    let serviceInterval;
    
    const startService = () => {
        if (serviceInterval) {
            clearInterval(serviceInterval);
        }
        
        serviceInterval = setInterval(async () => {
            try {
                if (!recoveryState.isRecovering) {
                    await startMatchmaking(client);
                }
            } catch (error) {
                logger.error('Error in matchmaking service:', error);
                recordError('matchmaking', error);
                
                if (error.name === 'MongoNetworkError') {
                    await handleNetworkError(client, error);
                }
            }
        }, MATCHMAKING_CONFIG.MATCHMAKING_TIMEOUT);
    };
    
    startService();
    
    // Restart service periodically to prevent memory leaks
    setInterval(() => {
        startService();
    }, 3600000); // Restart every hour
}

module.exports = {
    MATCHMAKING_CONFIG,
    startMatchmaking,
    startMatchmakingService,
    handleNetworkError,
    startRecovery,
    cancelMatch,
    createMatch,
    MatchmakingSystem
}; 