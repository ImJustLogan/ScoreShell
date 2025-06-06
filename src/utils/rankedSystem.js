const logger = require('./logger');
const { getRankInfo } = require('./helpers');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Constants for ranked system
const QUEUE_CONFIG = {
    MIN_PLAYERS: 2,
    MATCHMAKING_TIMEOUT: 10000, // 10 seconds
    MAX_QUEUE_SIZE: 50,
    MAX_REP_DIFFERENCE: 2000, // Maximum rep difference for fair matches
    REGION_PRIORITY: true, // Whether to prioritize same-region matches
    MATCHMAKING_INTERVAL: 5000, // Check for matches every 5 seconds
    QUEUE_UPDATE_INTERVAL: 10000, // Update queue display every 10 seconds
    MAX_ACTIVE_MATCHES: 1, // Maximum number of active matches per player
    MATCH_TIMEOUT: 5400000, // 1.5 hours in milliseconds
    PREGAME_TIMEOUT: 600000, // 10 minutes in milliseconds
    ROOM_CODE_TIMEOUT: 120000, // 2 minutes in milliseconds
    MAX_QUEUE_AGE: 3600000, // 1 hour in milliseconds
    MIN_RANK_DIFFERENCE: 2, // Maximum rank difference for fair matches
    HYPERCHARGE_CHANCE: 0.1, // 10% chance for hypercharge
    HYPERCHARGE_MULTIPLIER: 0.5, // 50% rep multiplier
    MAX_MATCH_SCORE: 2.0,           // Maximum acceptable match score
    REGION_PENALTY: 0.5,            // Penalty for cross-region matches
    MIN_QUEUE_TIME: 30000,          // Minimum time in queue before cross-region (30 seconds)
    MAX_QUEUE_TIME: 300000,         // Maximum time in queue before forcing match (5 minutes)
};

// Add new constants for queue management
const QUEUE_CLEANUP_CONFIG = {
    CLEANUP_INTERVAL: 300000, // 5 minutes
    MAX_QUEUE_AGE: 3600000, // 1 hour
    MAX_MATCHMAKING_ATTEMPTS: 10,
    MATCHMAKING_BACKOFF: 5000 // 5 seconds between attempts
};

// Add new constants for match phase handling
const MATCH_PHASE_CONFIG = {
    PHASE_TRANSITION_TIMEOUT: 5000, // 5 seconds to transition between phases
    MAX_RETRIES: 3, // Maximum number of retries for phase transitions
    RETRY_DELAY: 1000, // 1 second between retries
    LOCK_TIMEOUT: 30000, // 30 seconds for phase locks
    CLEANUP_INTERVAL: 60000 // 1 minute
};

// Match phases and their timeouts
const MATCH_PHASES = {
    STAGE_SELECT: {
        name: 'Stage Selection',
        timeout: 60000, // 1 minute per ban
        description: 'Players take turns banning stages until one remains',
        stages: [
            'Mario Stadium',
            'Luigi\'s Mansion',
            'Peach Ice Garden',
            'Daisy Cruiser',
            'Daisy Cruiser (Night)',
            'Yoshi Park',
            'Yoshi Park (Night)',
            'Wario City',
            'Bowser Jr. Playroom',
            'Bowser Castle'
        ]
    },
    CAPTAIN_SELECT: {
        name: 'Captain Selection',
        timeout: 60000, // 1 minute per pick
        description: 'Players select their captains',
        captains: [
            'Mario', 'Luigi', 'Peach', 'Daisy', 'Yoshi', 'Birdo',
            'Wario', 'Waluigi', 'Donkey Kong', 'Diddy Kong',
            'Bowser', 'Bowser Jr.'
        ]
    },
    HOST_SELECT: {
        name: 'Host Selection',
        timeout: 30000, // 30 seconds
        description: 'Players decide who will host the match'
    },
    ROOM_CODE: {
        name: 'Room Code',
        timeout: 120000, // 2 minutes
        description: 'Host provides the room code'
    },
    ACTIVE: {
        name: 'Match in Progress',
        timeout: 5400000, // 1.5 hours
        description: 'Match is being played'
    }
};

// Rank configuration
const RANKS = {
    BRONZE: {
        name: 'Bronze',
        emoji: '1348460284951400570',
        color: '#f59833',
        tiers: [
            { name: 'I', points: 0 },
            { name: 'II', points: 500 },
            { name: 'III', points: 1000 }
        ]
    },
    SILVER: {
        name: 'Silver',
        emoji: '1348460318753296466',
        color: '#6774c9',
        tiers: [
            { name: 'I', points: 1500 },
            { name: 'II', points: 2000 },
            { name: 'III', points: 2500 }
        ]
    },
    GOLD: {
        name: 'Gold',
        emoji: '1348460332825186326',
        color: '#ffc11b',
        tiers: [
            { name: 'I', points: 3000 },
            { name: 'II', points: 3500 },
            { name: 'III', points: 4000 }
        ]
    },
    DIAMOND: {
        name: 'Diamond',
        emoji: '1348460344049401877',
        color: '#05c2f7',
        tiers: [
            { name: 'I', points: 4500 },
            { name: 'II', points: 5000 },
            { name: 'III', points: 5500 }
        ]
    },
    MYTHIC: {
        name: 'Mythic',
        emoji: '1348460358951768084',
        color: '#ce17ef',
        tiers: [
            { name: 'I', points: 6000 },
            { name: 'II', points: 6500 },
            { name: 'III', points: 7000 }
        ]
    },
    LEGENDARY: {
        name: 'Legendary',
        emoji: '1348460371392073829',
        color: '#fc3434',
        tiers: [
            { name: 'I', points: 7500 },
            { name: 'II', points: 8000 },
            { name: 'III', points: 8500 }
        ]
    },
    MASTERS: {
        name: 'Masters',
        emoji: '1348460383396167681',
        color: '#741904',
        tiers: [
            { name: '', points: 9000 }
        ]
    }
};

// Cache for active queues and matches
const queueCache = new Map();
const matchCache = new Map();
const matchmakingCache = new Map();

/**
 * Get player's current rank information
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @returns {Promise<Object>} Rank information
 */
async function getPlayerRankInfo(db, userId) {
    try {
        const user = await db.collection('users').findOne({ userId });
        if (!user) {
            throw new Error('User not found');
        }

        const rankInfo = getRankInfo(user.rep);
        return {
            rank: rankInfo.rank,
            tier: rankInfo.tier,
            rep: user.rep,
            region: user.region,
            winStreak: user.winStreak || 0,
            rankEmoji: RANKS[rankInfo.rank].emoji,
            rankColor: RANKS[rankInfo.rank].color
        };
    } catch (error) {
        logger.error('Error getting player rank info:', error);
        throw error;
    }
}

/**
 * Check if a player can join the queue
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @returns {Promise<{ canJoin: boolean, error?: string }>}
 */
async function canJoinQueue(db, userId) {
    try {
        // Check if user is in an active match
        const activeMatch = await db.collection('matches').findOne({
            $or: [
                { 'player1.userId': userId },
                { 'player2.userId': userId }
            ],
            status: { $in: ['PREGAME', 'ACTIVE'] }
        });

        if (activeMatch) {
            return { canJoin: false, error: 'You are currently in an active match.' };
        }

        // Check if user is in queue
        const inQueue = await db.collection('queue').findOne({
            userId,
            status: 'ACTIVE'
        });

        if (inQueue) {
            return { canJoin: false, error: 'You are already in queue.' };
        }

        // Check if user has been inactive for too long
        const lastMatch = await db.collection('matches')
            .findOne(
                {
                    $or: [
                        { 'player1.userId': userId },
                        { 'player2.userId': userId }
                    ]
                },
                { sort: { endTime: -1 } }
            );
        
        if (lastMatch && (Date.now() - lastMatch.endTime > 604800000)) { // 1 week
            return { canJoin: false, error: 'You have been inactive for too long. Please play a casual match first.' };
        }

        return { canJoin: true };
    } catch (error) {
        logger.error('Error checking queue eligibility:', error);
        return { canJoin: false, error: 'Database error occurred' };
    }
}

/**
 * Join the ranked queue
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @param {string} serverId - Server ID where queue was joined
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function joinQueue(db, userId, serverId) {
    const session = db.startSession();
    
    try {
        // Check if user can join queue
        const eligibilityCheck = await canJoinQueue(db, userId);
        if (!eligibilityCheck.canJoin) {
            return { success: false, error: eligibilityCheck.error };
        }

        await session.withTransaction(async () => {
            // Get player's rank info
            const rankInfo = await getPlayerRankInfo(db, userId);

            // Add to queue
            await db.collection('queue').insertOne({
                userId,
                serverId,
                status: 'ACTIVE',
                joinTime: new Date(),
                rank: rankInfo.rank,
                tier: rankInfo.tier,
                rep: rankInfo.rep,
                region: rankInfo.region,
                winStreak: rankInfo.winStreak,
                rankEmoji: rankInfo.rankEmoji,
                rankColor: rankInfo.rankColor,
                matchmakingAttempts: 0
            });

            // Update queue cache
            const queueEntry = {
                userId,
                serverId,
                joinTime: new Date(),
                rankInfo
            };
            queueCache.set(userId, queueEntry);

            // Log queue join
            logger.info('Player joined queue', {
                userId,
                serverId,
                rank: rankInfo.rank,
                tier: rankInfo.tier,
                rep: rankInfo.rep,
                region: rankInfo.region
            });
        });

        return { success: true };
    } catch (error) {
        logger.error('Error joining queue:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Leave the ranked queue
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function leaveQueue(db, userId) {
    const session = db.startSession();
    
    try {
        await session.withTransaction(async () => {
            // Remove from queue
            const result = await db.collection('queue').deleteOne({
                userId,
                status: 'ACTIVE'
            });

            if (result.deletedCount === 0) {
                throw new Error('You are not in queue.');
            }

            // Clear queue cache
            queueCache.delete(userId);

            // Log queue leave
            logger.info('Player left queue', { userId });
        });

        return { success: true };
    } catch (error) {
        logger.error('Error leaving queue:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Add queue cleanup function
 * @param {Object} db - Database instance
 */
async function cleanupQueue(db) {
    try {
        const now = Date.now();
        
        // Remove stale queue entries
        const result = await db.collection('queue').deleteMany({
            $or: [
                { joinTime: { $lt: new Date(now - QUEUE_CLEANUP_CONFIG.MAX_QUEUE_AGE) } },
                { matchmakingAttempts: { $gte: QUEUE_CLEANUP_CONFIG.MAX_MATCHMAKING_ATTEMPTS } }
            ]
        });

        if (result.deletedCount > 0) {
            logger.info(`Cleaned up ${result.deletedCount} stale queue entries`);
        }

        // Clear stale cache entries
        for (const [userId, entry] of queueCache.entries()) {
            if (now - entry.joinTime > QUEUE_CLEANUP_CONFIG.MAX_QUEUE_AGE) {
                queueCache.delete(userId);
            }
        }

        // Clear stale matchmaking cache entries
        for (const [userId, entry] of matchmakingCache.entries()) {
            if (now - entry.startTime > QUEUE_CLEANUP_CONFIG.MATCHMAKING_BACKOFF) {
                matchmakingCache.delete(userId);
            }
        }
    } catch (error) {
        logger.error('Error cleaning up queue:', error);
    }
}

/**
 * Modify startMatchmaking function for better efficiency
 * @param {Object} db - Database instance
 * @param {Object} client - Discord client
 * @returns {Promise<void>}
 */
async function startMatchmaking(db, client) {
    try {
        // Get all active queue entries, sorted by join time
        const queue = await db.collection('queue')
            .find({ 
                status: 'ACTIVE',
                matchmakingAttempts: { $lt: QUEUE_CLEANUP_CONFIG.MAX_MATCHMAKING_ATTEMPTS }
            })
            .sort({ joinTime: 1 })
            .toArray();

        // Skip if not enough players
        if (queue.length < QUEUE_CONFIG.MIN_PLAYERS) {
            return;
        }

        // Group players by region for more efficient matching
        const playersByRegion = new Map();
        for (const player of queue) {
            if (!playersByRegion.has(player.region)) {
                playersByRegion.set(player.region, []);
            }
            playersByRegion.get(player.region).push(player);
        }

        // Process each region's players
        for (const [region, players] of playersByRegion) {
            // Try to match players within the same region first
            for (let i = 0; i < players.length; i++) {
                const player = players[i];
                
                // Skip if already in matchmaking
                if (matchmakingCache.has(player.userId)) {
                    continue;
                }

                // Find best match within region
                let bestMatch = null;
                let bestScore = Infinity;

                for (let j = i + 1; j < players.length; j++) {
                    const potentialMatch = players[j];
                    if (matchmakingCache.has(potentialMatch.userId)) continue;

                    const matchScore = await calculateMatchScore(db, player, potentialMatch);
                    if (matchScore < bestScore) {
                        bestMatch = potentialMatch;
                        bestScore = matchScore;
                    }
                }

                // If no good match found in region, try other regions
                if (!bestMatch || bestScore > QUEUE_CONFIG.MAX_MATCH_SCORE) {
                    for (const [otherRegion, otherPlayers] of playersByRegion) {
                        if (otherRegion === region) continue;

                        for (const potentialMatch of otherPlayers) {
                            if (matchmakingCache.has(potentialMatch.userId)) continue;

                            const matchScore = await calculateMatchScore(db, player, potentialMatch);
                            const adjustedScore = matchScore + QUEUE_CONFIG.REGION_PENALTY;
                            
                            if (adjustedScore < bestScore) {
                                bestMatch = potentialMatch;
                                bestScore = adjustedScore;
                            }
                        }
                    }
                }

                // If found a suitable match, create it
                if (bestMatch && bestScore <= QUEUE_CONFIG.MAX_MATCH_SCORE) {
                    // Mark both players as in matchmaking
                    matchmakingCache.set(player.userId, {
                        matchId: bestMatch.userId,
                        startTime: Date.now()
                    });
                    matchmakingCache.set(bestMatch.userId, {
                        matchId: player.userId,
                        startTime: Date.now()
                    });

                    // Increment matchmaking attempts
                    await db.collection('queue').updateMany(
                        { userId: { $in: [player.userId, bestMatch.userId] } },
                        { $inc: { matchmakingAttempts: 1 } }
                    );

                    // Create match
                    await createMatch(db, client, player, bestMatch);
                }
            }
        }
    } catch (error) {
        logger.error('Error in matchmaking process:', error);
    }
}

/**
 * Find the best match for a player in queue
 * @param {Object} db - Database instance
 * @param {Object} player - Player in queue
 * @returns {Promise<Object|null>} Best match or null if none found
 */
async function findMatch(db, player) {
    try {
        // Get all active players in queue
        const queue = await db.collection('queue')
            .find({
                status: 'ACTIVE',
                userId: { $ne: player.userId }
            })
            .sort({ joinTime: 1 })
            .toArray();

        if (queue.length === 0) return null;

        let bestMatch = null;
        let bestScore = Infinity;

        // First pass: Try to find a match in the same region
        for (const potentialMatch of queue) {
            if (potentialMatch.region === player.region) {
                const matchScore = await calculateMatchScore(db, player, potentialMatch);
                if (matchScore < bestScore) {
                    bestMatch = potentialMatch;
                    bestScore = matchScore;
                }
            }
        }

        // If no good match found in same region, try other regions
        if (!bestMatch || bestScore > QUEUE_CONFIG.MAX_MATCH_SCORE) {
            for (const potentialMatch of queue) {
                if (potentialMatch.region !== player.region) {
                    const matchScore = await calculateMatchScore(db, player, potentialMatch);
                    // Add region penalty to score
                    const regionPenalty = QUEUE_CONFIG.REGION_PENALTY;
                    const adjustedScore = matchScore + regionPenalty;
                    
                    if (adjustedScore < bestScore) {
                        bestMatch = potentialMatch;
                        bestScore = adjustedScore;
                    }
                }
            }
        }

        // Only return match if score is within acceptable range
        if (bestMatch && bestScore <= QUEUE_CONFIG.MAX_MATCH_SCORE) {
            return bestMatch;
        }

        return null;
    } catch (error) {
        logger.error('Error finding match:', error);
        return null;
    }
}

/**
 * Calculate match score between two players
 * @param {Object} db - Database instance
 * @param {Object} player1 - First player
 * @param {Object} player2 - Second player
 * @returns {Promise<number>} Match score (lower is better)
 */
async function calculateMatchScore(db, player1, player2) {
    try {
        // Get player stats
        const [stats1, stats2] = await Promise.all([
            getPlayerStats(db, player1.userId),
            getPlayerStats(db, player2.userId)
        ]);

        // Calculate base score components
        const repDifference = Math.abs(player1.rep - player2.rep);
        const rankDifference = Math.abs(
            getRankInfo(player1.rep).points - 
            getRankInfo(player2.rep).points
        );
        const queueTimeDifference = Math.abs(
            player1.joinTime - player2.joinTime
        ) / 1000;

        // Calculate win rates
        const winRate1 = stats1.totalMatches > 0 ? stats1.wins / stats1.totalMatches : 0.5;
        const winRate2 = stats2.totalMatches > 0 ? stats2.wins / stats2.totalMatches : 0.5;
        const winRateDifference = Math.abs(winRate1 - winRate2);

        // Calculate weighted score
        const weights = {
            REP_DIFFERENCE: 0.4,    // Increased weight for rep difference
            RANK_DIFFERENCE: 0.3,   // Increased weight for rank difference
            QUEUE_TIME: 0.2,        // Moderate weight for queue time
            WIN_RATE: 0.1           // Lower weight for win rate
        };

        const matchScore = 
            (repDifference / 225) * weights.REP_DIFFERENCE +  // Normalize rep difference
            (rankDifference / 500) * weights.RANK_DIFFERENCE + // Normalize rank difference
            (queueTimeDifference / 300) * weights.QUEUE_TIME + // Normalize queue time (5 minutes)
            winRateDifference * weights.WIN_RATE;

        return matchScore;
    } catch (error) {
        logger.error('Error calculating match score:', error);
        throw error;
    }
}

/**
 * Create a new match
 * @param {Object} db - Database instance
 * @param {Object} client - Discord client
 * @param {Object} player1 - First player
 * @param {Object} player2 - Second player
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function createMatch(db, client, player1, player2) {
    const session = db.startSession();
    
    try {
        await session.withTransaction(async () => {
            // Remove both players from queue
            await db.collection('queue').deleteMany({
                userId: { $in: [player1.userId, player2.userId] },
                status: 'ACTIVE'
            });

            // Clear matchmaking cache
            matchmakingCache.delete(player1.userId);
            matchmakingCache.delete(player2.userId);

            // Determine if match is hypercharged
            const isHypercharged = Math.random() < QUEUE_CONFIG.HYPERCHARGE_CHANCE;

            // Create match record
            const match = {
                player1: {
                    userId: player1.userId,
                    rank: player1.rank,
                    tier: player1.tier,
                    rep: player1.rep,
                    region: player1.region,
                    winStreak: player1.winStreak
                },
                player2: {
                    userId: player2.userId,
                    rank: player2.rank,
                    tier: player2.tier,
                    rep: player2.rep,
                    region: player2.region,
                    winStreak: player2.winStreak
                },
                status: 'PREGAME',
                startTime: new Date(),
                lastUpdate: new Date(),
                isHypercharged,
                repMultiplier: isHypercharged ? 
                    1 + QUEUE_CONFIG.HYPERCHARGE_MULTIPLIER : 1,
                stage: null,
                captains: {
                    player1: null,
                    player2: null
                },
                host: null,
                roomCode: null,
                currentPhase: 'STAGE_SELECT',
                currentTurn: player1.userId, // First player to join goes first
                phaseStartTime: new Date(),
                banHistory: [],
                pickHistory: []
            };

            const result = await db.collection('matches').insertOne(match);
            const matchId = result.insertedId;

            // Add to match cache
            matchCache.set(matchId.toString(), {
                ...match,
                _id: matchId
            });

            // Notify players
            await notifyMatchFound(client, match);
        });

        return { success: true };
    } catch (error) {
        logger.error('Error creating match:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Notify players that a match has been found
 * @param {Object} client - Discord client
 * @param {Object} match - Match object
 */
async function notifyMatchFound(client, match) {
    try {
        const player1User = await client.users.fetch(match.player1.userId);
        const player2User = await client.users.fetch(match.player2.userId);

        const matchEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Match Found!')
            .setDescription(`${player1User} vs ${player2User}`)
            .addFields(
                { name: 'Player 1', value: `${match.player1.rank} ${match.player1.tier}`, inline: true },
                { name: 'Player 2', value: `${match.player2.rank} ${match.player2.tier}`, inline: true }
            )
            .setTimestamp();

        if (match.isHypercharged) {
            matchEmbed.addFields({
                name: '🎉 Hypercharged Match!',
                value: 'This match has a 50% rep multiplier!'
            });
        }

        // Send match notification to both players
        await Promise.all([
            player1User.send({ embeds: [matchEmbed] }).catch(() => {}),
            player2User.send({ embeds: [matchEmbed] }).catch(() => {})
        ]);

        // Start pre-game phase
        await startPreGamePhase(db, match);
    } catch (error) {
        logger.error('Error notifying players of match:', error);
    }
}

/**
 * Add phase transition helper
 * @param {Object} db - Database instance
 * @param {string} matchId - Match ID
 * @param {string} newPhase - New phase
 * @param {Object} updateData - Additional data to update
 * @returns {Promise<boolean>} Whether the phase transition succeeded
 */
async function transitionMatchPhase(db, matchId, newPhase, updateData = {}) {
    const session = db.startSession();
    let retries = 0;

    while (retries < MATCH_PHASE_CONFIG.MAX_RETRIES) {
        try {
            await session.withTransaction(async () => {
                // Get current match state
                const match = await db.collection('matches').findOne(
                    { _id: matchId },
                    { session }
                );

                if (!match) {
                    throw new Error('Match not found');
                }

                // Verify phase transition is valid
                const currentPhase = match.currentPhase;
                const validTransitions = {
                    'STAGE_SELECT': ['CAPTAIN_SELECT', 'FAILED'],
                    'CAPTAIN_SELECT': ['HOST_SELECT', 'FAILED'],
                    'HOST_SELECT': ['ROOM_CODE', 'FAILED'],
                    'ROOM_CODE': ['ACTIVE', 'CANCELLED', 'FAILED'],
                    'ACTIVE': ['COMPLETED', 'CANCELLED', 'FAILED'],
                    'PREGAME': ['STAGE_SELECT', 'FAILED']
                };

                if (!validTransitions[currentPhase]?.includes(newPhase)) {
                    throw new Error(`Invalid phase transition from ${currentPhase} to ${newPhase}`);
                }

                // Update match phase
                const update = {
                    $set: {
                        currentPhase: newPhase,
                        phaseStartTime: new Date(),
                        phaseTimeout: new Date(Date.now() + MATCH_PHASES[newPhase].timeout),
                        lastUpdate: new Date(),
                        ...updateData
                    }
                };

                const result = await db.collection('matches').updateOne(
                    { 
                        _id: matchId,
                        currentPhase: currentPhase // Ensure phase hasn't changed
                    },
                    update,
                    { session }
                );

                if (result.modifiedCount === 0) {
                    throw new Error('Phase transition failed - match state changed');
                }
            });

            return true;
        } catch (error) {
            retries++;
            if (retries === MATCH_PHASE_CONFIG.MAX_RETRIES) {
                logger.error(`Failed to transition match ${matchId} to ${newPhase} after ${retries} attempts:`, error);
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, MATCH_PHASE_CONFIG.RETRY_DELAY));
        } finally {
            await session.endSession();
        }
    }
}

// Add phase timeout handler
async function handlePhaseTimeout(db, match) {
    try {
        const now = Date.now();
        const phaseTimeout = match.phaseTimeout?.getTime() || 0;

        if (now >= phaseTimeout) {
            switch (match.currentPhase) {
                case 'STAGE_SELECT':
                    // Auto-ban a random stage
                    const availableStages = MATCH_PHASES.STAGE_SELECT.stages
                        .filter(s => !match.banHistory?.includes(s));
                    const randomStage = availableStages[Math.floor(Math.random() * availableStages.length)];
                    
                    await transitionMatchPhase(db, match._id, 'CAPTAIN_SELECT', {
                        banHistory: [...(match.banHistory || []), randomStage],
                        autoBanned: true,
                        selectedStage: availableStages.length === 1 ? availableStages[0] : null
                    });
                    break;

                case 'CAPTAIN_SELECT':
                    // Auto-select random captain for current player
                    const availableCaptains = MATCH_PHASES.CAPTAIN_SELECT.captains
                        .filter(c => !match.pickHistory?.includes(c));
                    const randomCaptain = availableCaptains[Math.floor(Math.random() * availableCaptains.length)];
                    
                    await transitionMatchPhase(db, match._id, 'HOST_SELECT', {
                        pickHistory: [...(match.pickHistory || []), randomCaptain],
                        autoSelected: true,
                        captains: {
                            ...match.captains,
                            [match.currentTurn === match.player1.userId ? 'player1' : 'player2']: randomCaptain
                        }
                    });
                    break;

                case 'HOST_SELECT':
                    // Auto-assign host based on rank
                    const hostId = match.player1.rep >= match.player2.rep ? 
                        match.player1.userId : match.player2.userId;
                    
                    await transitionMatchPhase(db, match._id, 'ROOM_CODE', {
                        host: hostId,
                        autoAssigned: true
                    });
                    break;

                case 'ROOM_CODE':
                    // Cancel match if no room code provided
                    await transitionMatchPhase(db, match._id, 'CANCELLED', {
                        endReason: 'No room code provided',
                        endTime: new Date()
                    });
                    break;

                case 'ACTIVE':
                    // Auto-cancel match if timeout
                    await transitionMatchPhase(db, match._id, 'CANCELLED', {
                        endReason: 'Match timeout',
                        endTime: new Date()
                    });
                    break;

                default:
                    logger.warn(`Unexpected phase timeout for match ${match._id} in phase ${match.currentPhase}`);
            }
        }
    } catch (error) {
        logger.error(`Error handling phase timeout for match ${match._id}:`, error);
        // Try to transition to FAILED state
        try {
            await transitionMatchPhase(db, match._id, 'FAILED', {
                error: 'Phase timeout handling failed',
                endTime: new Date()
            });
        } catch (transitionError) {
            logger.error(`Failed to transition match ${match._id} to FAILED state:`, transitionError);
        }
    }
}

// Modify startPreGamePhase to use new phase transition system
async function startPreGamePhase(db, match) {
    try {
        // Transition to STAGE_SELECT phase
        await transitionMatchPhase(db, match._id, 'STAGE_SELECT');

        // Create stage selection embed and buttons
        const stageEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Stage Selection')
            .setDescription(`${match.player1.userId} vs ${match.player2.userId}\n${match.player1.userId} goes first!`)
            .addFields(
                { name: 'Available Stages', value: MATCH_PHASES.STAGE_SELECT.stages.join('\n') }
            )
            .setTimestamp();

        // Set up phase timeout handler
        const timeoutHandler = setInterval(async () => {
            const currentMatch = await db.collection('matches').findOne({ _id: match._id });
            if (!currentMatch || currentMatch.currentPhase !== 'STAGE_SELECT') {
                clearInterval(timeoutHandler);
                return;
            }
            await handlePhaseTimeout(db, currentMatch);
        }, 1000);

        // Store timeout handler ID in match for cleanup
        await db.collection('matches').updateOne(
            { _id: match._id },
            { $set: { timeoutHandlerId: timeoutHandler } }
        );

        return true;
    } catch (error) {
        logger.error('Error in pre-game phase:', error);
        await transitionMatchPhase(db, match._id, 'FAILED', {
            error: error.message,
            endTime: new Date()
        });
        return false;
    }
}

// Add cleanup function for phase handlers
async function cleanupPhaseHandlers(db) {
    try {
        const matches = await db.collection('matches').find({
            timeoutHandlerId: { $exists: true },
            currentPhase: { $in: ['COMPLETED', 'CANCELLED', 'FAILED'] }
        }).toArray();

        for (const match of matches) {
            if (match.timeoutHandlerId) {
                clearInterval(match.timeoutHandlerId);
                await db.collection('matches').updateOne(
                    { _id: match._id },
                    { $unset: { timeoutHandlerId: "" } }
                );
            }
        }
    } catch (error) {
        logger.error('Error cleaning up phase handlers:', error);
    }
}

// Add cleanup interval for phase handlers
setInterval(() => {
    cleanupPhaseHandlers(db).catch(error => {
        logger.error('Error in phase handler cleanup interval:', error);
    });
}, MATCH_PHASE_CONFIG.CLEANUP_INTERVAL);

// Add cleanup interval
setInterval(() => {
    cleanupQueue(db).catch(error => {
        logger.error('Error in queue cleanup interval:', error);
    });
}, QUEUE_CLEANUP_CONFIG.CLEANUP_INTERVAL);

// Export functions and constants
module.exports = {
    QUEUE_CONFIG,
    QUEUE_CLEANUP_CONFIG,
    MATCH_PHASE_CONFIG,
    MATCH_PHASES,
    RANKS,
    getPlayerRankInfo,
    canJoinQueue,
    joinQueue,
    leaveQueue,
    startMatchmaking,
    cleanupQueue,
    createMatch,
    findMatch,
    calculateMatchScore,
    notifyMatchFound,
    startPreGamePhase,
    handlePhaseTimeout,
    cleanupPhaseHandlers,
    transitionMatchPhase
}; 