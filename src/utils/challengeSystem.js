const logger = require('./logger');
const { getRankInfo } = require('./helpers');

// Challenge configuration
const CHALLENGE_CONFIG = {
    TYPES: {
        STANDARD: {
            id: 'standard',
            name: 'Standard Challenge',
            lives: 3,
            winsRequired: 6,
            description: 'A balanced test of skill and team-building! With only 3 lives, each match counts. Win 6 games before you\'re knocked out to claim victory.',
            icon: 'https://i.imgur.com/wqVC8gr.png'
        },
        HARD: {
            id: 'hard',
            name: 'Hard Challenge',
            lives: 3,
            winsRequired: 12,
            description: 'For the seasoned sluggers! This mode doubles the length and the pressure—12 wins stand between you and the title, but you still only have 3 lives.',
            icon: 'https://i.imgur.com/IsEUINk.png'
        }
    },
    VALIDATION: {
        MAX_ACTIVE_CHALLENGES: 3,
        MIN_CHALLENGE_DURATION: 3600000, // 1 hour
        MAX_CHALLENGE_DURATION: 604800000, // 1 week
        COMPENSATION_REP: 50,
        HYPERCHARGE: {
            DEFAULT_MULTIPLIER: 0.5,
            MAX_MULTIPLIER: 2.0
        }
    },
    PARTICIPANT_LIMITS: {
        MAX_PARTICIPANTS: 1000,
        MIN_PARTICIPANTS: 1
    }
};

// Enhanced validation patterns
const CHALLENGE_VALIDATION = {
    NAME: {
        MIN_LENGTH: 3,
        MAX_LENGTH: 32,
        PATTERN: /^[a-zA-Z0-9\s\-_]+$/
    },
    ID: {
        PATTERN: /^[a-zA-Z0-9\-_]+$/,
        MAX_LENGTH: 32
    },
    ICON: {
        PATTERN: /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)$/
    },
    LIVES: {
        MIN: 1,
        MAX: 10
    },
    WINS_REQUIRED: {
        MIN: 1,
        MAX: 50
    }
};

// Challenge state management
const CHALLENGE_STATES = {
    SCHEDULED: 'SCHEDULED',
    ACTIVE: 'ACTIVE',
    PAUSED: 'PAUSED',
    ENDED: 'ENDED',
    ARCHIVED: 'ARCHIVED'
};

// Challenge logging events
const ChallengeEvent = {
    CHALLENGE: {
        CREATED: 'challenge_created',
        STARTED: 'challenge_started',
        PAUSED: 'challenge_paused',
        ENDED: 'challenge_ended',
        ARCHIVED: 'challenge_archived',
        EDITED: 'challenge_edited',
        DELETED: 'challenge_deleted'
    },
    PARTICIPANT: {
        JOINED: 'participant_joined',
        LEFT: 'participant_left',
        PROGRESS: 'participant_progress',
        COMPLETED: 'participant_completed',
        DNF: 'participant_dnf'
    },
    REWARD: {
        AWARDED: 'reward_awarded',
        REVOKED: 'reward_revoked'
    },
    HYPERCHARGE: {
        STARTED: 'hypercharge_started',
        ENDED: 'hypercharge_ended'
    }
};

// Cache for active challenges and participants
const challengeCache = new Map();
const participantCache = new Map();

/**
 * Create a new challenge
 * @param {Object} db - Database instance
 * @param {Object} challengeData - Challenge data
 * @returns {Promise<{ success: boolean, error?: string, challengeId?: string }>}
 */
async function createChallenge(db, challengeData) {
    const session = db.startSession();
    
    try {
        // Validate challenge data
        const validation = validateChallengeData(challengeData);
        if (!validation.valid) {
            return { success: false, error: validation.reason };
        }

        // Check for ID uniqueness
        const existingChallenge = await db.collection('challenges')
            .findOne({ id: challengeData.id });
        if (existingChallenge) {
            return { success: false, error: 'Challenge ID already exists' };
        }

        // Check for active challenge overlap
        if (challengeData.startTime && challengeData.endTime) {
            const overlap = await checkChallengeOverlap(db, challengeData);
            if (overlap) {
                return { success: false, error: 'Challenge time overlaps with existing active challenge' };
            }
        }

        await session.withTransaction(async () => {
            // Create challenge record
            const challenge = {
                ...challengeData,
                state: challengeData.startTime > Date.now() ? 
                    CHALLENGE_STATES.SCHEDULED : CHALLENGE_STATES.ACTIVE,
                createdAt: new Date(),
                updatedAt: new Date(),
                participantCount: 0,
                completedCount: 0,
                totalMatches: 0,
                totalRepAwarded: 0,
                hypercharge: null
            };

            const result = await db.collection('challenges').insertOne(challenge);
            const challengeId = result.insertedId;

            // Add to cache
            challengeCache.set(challengeId.toString(), challenge);

            // Log challenge creation
            await logChallengeEvent(db, ChallengeEvent.CHALLENGE.CREATED, {
                challengeId: challengeId.toString(),
                challengeData
            });

            return { success: true, challengeId: challengeId.toString() };
        });
    } catch (error) {
        logger.error('Error creating challenge:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Validate challenge data
 * @param {Object} data - Challenge data to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateChallengeData(data) {
    // Validate required fields
    const requiredFields = ['id', 'name', 'lives', 'winsRequired', 'rewardBadgeId'];
    for (const field of requiredFields) {
        if (!data[field]) {
            return { valid: false, reason: `Missing required field: ${field}` };
        }
    }

    // Validate name
    if (data.name.length < CHALLENGE_VALIDATION.NAME.MIN_LENGTH ||
        data.name.length > CHALLENGE_VALIDATION.NAME.MAX_LENGTH ||
        !CHALLENGE_VALIDATION.NAME.PATTERN.test(data.name)) {
        return { valid: false, reason: 'Invalid challenge name' };
    }

    // Validate ID
    if (!CHALLENGE_VALIDATION.ID.PATTERN.test(data.id) ||
        data.id.length > CHALLENGE_VALIDATION.ID.MAX_LENGTH) {
        return { valid: false, reason: 'Invalid challenge ID' };
    }

    // Validate icon URL
    if (data.icon && !CHALLENGE_VALIDATION.ICON.PATTERN.test(data.icon)) {
        return { valid: false, reason: 'Invalid icon URL' };
    }

    // Validate lives
    if (data.lives < CHALLENGE_VALIDATION.LIVES.MIN ||
        data.lives > CHALLENGE_VALIDATION.LIVES.MAX) {
        return { valid: false, reason: 'Invalid number of lives' };
    }

    // Validate wins required
    if (data.winsRequired < CHALLENGE_VALIDATION.WINS_REQUIRED.MIN ||
        data.winsRequired > CHALLENGE_VALIDATION.WINS_REQUIRED.MAX) {
        return { valid: false, reason: 'Invalid number of wins required' };
    }

    // Validate time window
    if (data.startTime && data.endTime) {
        const duration = data.endTime - data.startTime;
        if (duration < CHALLENGE_CONFIG.VALIDATION.MIN_CHALLENGE_DURATION ||
            duration > CHALLENGE_CONFIG.VALIDATION.MAX_CHALLENGE_DURATION) {
            return { valid: false, reason: 'Invalid challenge duration' };
        }
    }

    return { valid: true };
}

/**
 * Check for challenge time overlap
 * @param {Object} db - Database instance
 * @param {Object} challengeData - Challenge data to check
 * @returns {Promise<boolean>}
 */
async function checkChallengeOverlap(db, challengeData) {
    const { startTime, endTime } = challengeData;
    
    const overlappingChallenge = await db.collection('challenges')
        .findOne({
            state: { $in: [CHALLENGE_STATES.ACTIVE, CHALLENGE_STATES.SCHEDULED] },
            $or: [
                {
                    startTime: { $lte: endTime },
                    endTime: { $gte: startTime }
                },
                {
                    startTime: { $gte: startTime, $lte: endTime }
                },
                {
                    endTime: { $gte: startTime, $lte: endTime }
                }
            ]
        });

    return !!overlappingChallenge;
}

/**
 * Start a challenge
 * @param {Object} db - Database instance
 * @param {string} challengeId - Challenge ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function startChallenge(db, challengeId) {
    const session = db.startSession();
    
    try {
        await session.withTransaction(async () => {
            const challenge = await db.collection('challenges')
                .findOne({ _id: challengeId });

            if (!challenge) {
                throw new Error('Challenge not found');
            }

            if (challenge.state !== CHALLENGE_STATES.SCHEDULED) {
                throw new Error('Challenge is not in scheduled state');
            }

            // Check for active challenge overlap
            if (challenge.startTime && challenge.endTime) {
                const overlap = await checkChallengeOverlap(db, challenge);
                if (overlap) {
                    throw new Error('Challenge time overlaps with existing active challenge');
                }
            }

            // Update challenge state
            await db.collection('challenges').updateOne(
                { _id: challengeId },
                {
                    $set: {
                        state: CHALLENGE_STATES.ACTIVE,
                        startTime: new Date(),
                        updatedAt: new Date()
                    }
                }
            );

            // Update cache
            const cachedChallenge = challengeCache.get(challengeId.toString());
            if (cachedChallenge) {
                cachedChallenge.state = CHALLENGE_STATES.ACTIVE;
                cachedChallenge.startTime = new Date();
                cachedChallenge.updatedAt = new Date();
                challengeCache.set(challengeId.toString(), cachedChallenge);
            }

            // Log challenge start
            await logChallengeEvent(db, ChallengeEvent.CHALLENGE.STARTED, {
                challengeId: challengeId.toString()
            });

            return { success: true };
        });
    } catch (error) {
        logger.error('Error starting challenge:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * End a challenge
 * @param {Object} db - Database instance
 * @param {string} challengeId - Challenge ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function endChallenge(db, challengeId) {
    const session = db.startSession();
    
    try {
        await session.withTransaction(async () => {
            const challenge = await db.collection('challenges')
                .findOne({ _id: challengeId });

            if (!challenge) {
                throw new Error('Challenge not found');
            }

            if (challenge.state !== CHALLENGE_STATES.ACTIVE) {
                throw new Error('Challenge is not active');
            }

            // Get all active participants
            const activeParticipants = await db.collection('challenge_participants')
                .find({
                    challengeId,
                    state: 'ACTIVE'
                })
                .toArray();

            // Mark remaining participants as DNF
            for (const participant of activeParticipants) {
                await db.collection('challenge_participants').updateOne(
                    { _id: participant._id },
                    {
                        $set: {
                            state: 'DNF',
                            endTime: new Date(),
                            updatedAt: new Date()
                        }
                    }
                );

                // Log DNF
                await logChallengeEvent(db, ChallengeEvent.PARTICIPANT.DNF, {
                    challengeId: challengeId.toString(),
                    userId: participant.userId
                });
            }

            // Update challenge state
            await db.collection('challenges').updateOne(
                { _id: challengeId },
                {
                    $set: {
                        state: CHALLENGE_STATES.ENDED,
                        endTime: new Date(),
                        updatedAt: new Date()
                    }
                }
            );

            // Update cache
            const cachedChallenge = challengeCache.get(challengeId.toString());
            if (cachedChallenge) {
                cachedChallenge.state = CHALLENGE_STATES.ENDED;
                cachedChallenge.endTime = new Date();
                cachedChallenge.updatedAt = new Date();
                challengeCache.set(challengeId.toString(), cachedChallenge);
            }

            // Log challenge end
            await logChallengeEvent(db, ChallengeEvent.CHALLENGE.ENDED, {
                challengeId: challengeId.toString(),
                dnfCount: activeParticipants.length
            });

            return { success: true };
        });
    } catch (error) {
        logger.error('Error ending challenge:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Join a challenge
 * @param {Object} db - Database instance
 * @param {string} challengeId - Challenge ID
 * @param {string} userId - User ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function joinChallenge(db, challengeId, userId) {
    const session = db.startSession();
    
    try {
        await session.withTransaction(async () => {
            const challenge = await db.collection('challenges')
                .findOne({ _id: challengeId });

            if (!challenge) {
                throw new Error('Challenge not found');
            }

            if (challenge.state !== CHALLENGE_STATES.ACTIVE) {
                throw new Error('Challenge is not active');
            }

            // Check participant limit
            if (challenge.participantCount >= CHALLENGE_CONFIG.PARTICIPANT_LIMITS.MAX_PARTICIPANTS) {
                throw new Error('Challenge has reached maximum participant limit');
            }

            // Check if user is already participating
            const existingParticipant = await db.collection('challenge_participants')
                .findOne({
                    challengeId,
                    userId,
                    state: { $in: ['ACTIVE', 'COMPLETED'] }
                });

            if (existingParticipant) {
                throw new Error('User is already participating in this challenge');
            }

            // Check if user is in any other active challenge
            const otherActiveChallenge = await db.collection('challenge_participants')
                .findOne({
                    userId,
                    state: 'ACTIVE',
                    challengeId: { $ne: challengeId }
                });

            if (otherActiveChallenge) {
                throw new Error('User is already participating in another challenge');
            }

            // Create participant record
            const participant = {
                challengeId,
                userId,
                state: 'ACTIVE',
                startTime: new Date(),
                updatedAt: new Date(),
                wins: 0,
                losses: 0,
                lives: challenge.lives,
                matches: [],
                completed: false
            };

            await db.collection('challenge_participants').insertOne(participant);

            // Update challenge participant count
            await db.collection('challenges').updateOne(
                { _id: challengeId },
                { $inc: { participantCount: 1 } }
            );

            // Update cache
            const cachedChallenge = challengeCache.get(challengeId.toString());
            if (cachedChallenge) {
                cachedChallenge.participantCount++;
                challengeCache.set(challengeId.toString(), cachedChallenge);
            }

            participantCache.set(`${challengeId}-${userId}`, participant);

            // Log participant join
            await logChallengeEvent(db, ChallengeEvent.PARTICIPANT.JOINED, {
                challengeId: challengeId.toString(),
                userId
            });

            return { success: true };
        });
    } catch (error) {
        logger.error('Error joining challenge:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Update challenge progress
 * @param {Object} db - Database instance
 * @param {string} challengeId - Challenge ID
 * @param {string} userId - User ID
 * @param {Object} matchResult - Match result data
 * @returns {Promise<{ success: boolean, error?: string, completed?: boolean }>}
 */
async function updateChallengeProgress(db, challengeId, userId, matchResult) {
    const session = db.startSession();
    
    try {
        await session.withTransaction(async () => {
            const participant = await db.collection('challenge_participants')
                .findOne({
                    challengeId,
                    userId,
                    state: 'ACTIVE'
                });

            if (!participant) {
                throw new Error('Participant not found or not active');
            }

            const challenge = await db.collection('challenges')
                .findOne({ _id: challengeId });

            if (!challenge) {
                throw new Error('Challenge not found');
            }

            if (challenge.state !== CHALLENGE_STATES.ACTIVE) {
                throw new Error('Challenge is not active');
            }

            // Validate match result
            if (!validateMatchResult(matchResult)) {
                throw new Error('Invalid match result');
            }

            // Update participant progress
            const isWin = matchResult.winner === userId;
            const updates = {
                $inc: {
                    wins: isWin ? 1 : 0,
                    losses: isWin ? 0 : 1,
                    lives: isWin ? 0 : -1
                },
                $push: {
                    matches: {
                        matchId: matchResult.matchId,
                        result: isWin ? 'WIN' : 'LOSS',
                        timestamp: new Date()
                    }
                },
                $set: {
                    updatedAt: new Date()
                }
            };

            // Check if challenge is completed
            const newWins = participant.wins + (isWin ? 1 : 0);
            const newLives = participant.lives + (isWin ? 0 : -1);
            const completed = newWins >= challenge.winsRequired;

            if (completed) {
                updates.$set.state = 'COMPLETED';
                updates.$set.completed = true;
                updates.$set.endTime = new Date();

                // Award badge
                await awardChallengeBadge(db, challengeId, userId, challenge.rewardBadgeId);

                // Update challenge completed count
                await db.collection('challenges').updateOne(
                    { _id: challengeId },
                    { $inc: { completedCount: 1 } }
                );
            } else if (newLives <= 0) {
                updates.$set.state = 'DNF';
                updates.$set.endTime = new Date();
            }

            await db.collection('challenge_participants').updateOne(
                { _id: participant._id },
                updates
            );

            // Update cache
            const cachedParticipant = participantCache.get(`${challengeId}-${userId}`);
            if (cachedParticipant) {
                Object.assign(cachedParticipant, updates.$set, {
                    wins: participant.wins + (isWin ? 1 : 0),
                    losses: participant.losses + (isWin ? 0 : 1),
                    lives: newLives
                });
                participantCache.set(`${challengeId}-${userId}`, cachedParticipant);
            }

            // Log progress
            await logChallengeEvent(db, ChallengeEvent.PARTICIPANT.PROGRESS, {
                challengeId: challengeId.toString(),
                userId,
                matchResult,
                completed
            });

            return { success: true, completed };
        });
    } catch (error) {
        logger.error('Error updating challenge progress:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Validate match result
 * @param {Object} result - Match result to validate
 * @returns {boolean}
 */
function validateMatchResult(result) {
    return result &&
        typeof result.matchId === 'string' &&
        typeof result.winner === 'string' &&
        ['WIN', 'LOSS'].includes(result.result);
}

/**
 * Award challenge badge
 * @param {Object} db - Database instance
 * @param {string} challengeId - Challenge ID
 * @param {string} userId - User ID
 * @param {string} badgeId - Badge ID
 * @returns {Promise<void>}
 */
async function awardChallengeBadge(db, challengeId, userId, badgeId) {
    try {
        // Check if user already has badge
        const existingBadge = await db.collection('user_badges')
            .findOne({
                userId,
                badgeId
            });

        if (existingBadge) {
            return;
        }

        // Award badge
        await db.collection('user_badges').insertOne({
            userId,
            badgeId,
            challengeId,
            awardedAt: new Date()
        });

        // Log badge award
        await logChallengeEvent(db, ChallengeEvent.REWARD.AWARDED, {
            challengeId: challengeId.toString(),
            userId,
            badgeId
        });
    } catch (error) {
        logger.error('Error awarding challenge badge:', error);
        throw error;
    }
}

/**
 * Log challenge event
 * @param {Object} db - Database instance
 * @param {string} event - Event type
 * @param {Object} data - Event data
 * @returns {Promise<void>}
 */
async function logChallengeEvent(db, event, data) {
    try {
        const logEntry = {
            timestamp: new Date(),
            event,
            data,
            metadata: {
                challengeId: data.challengeId,
                userId: data.userId
            }
        };

        await db.collection('challenge_logs').insertOne(logEntry);

        // Log to console based on event type
        switch (event) {
            case ChallengeEvent.CHALLENGE.CREATED:
            case ChallengeEvent.CHALLENGE.STARTED:
            case ChallengeEvent.CHALLENGE.ENDED:
                logger.info(event, data);
                break;
            case ChallengeEvent.PARTICIPANT.JOINED:
            case ChallengeEvent.PARTICIPANT.COMPLETED:
                logger.info(event, data);
                break;
            case ChallengeEvent.PARTICIPANT.DNF:
            case ChallengeEvent.REWARD.REVOKED:
                logger.warn(event, data);
                break;
            default:
                logger.debug(event, data);
        }
    } catch (error) {
        logger.error('Error logging challenge event:', error);
    }
}

/**
 * Get challenge leaderboard
 * @param {Object} db - Database instance
 * @param {string} challengeId - Challenge ID
 * @param {number} page - Page number
 * @param {number} limit - Entries per page
 * @returns {Promise<{ success: boolean, error?: string, leaderboard?: Array, totalPages?: number }>}
 */
async function getChallengeLeaderboard(db, challengeId, page = 1, limit = 10) {
    try {
        const challenge = await db.collection('challenges')
            .findOne({ _id: challengeId });

        if (!challenge) {
            return { success: false, error: 'Challenge not found' };
        }

        // Get total count
        const total = await db.collection('challenge_participants')
            .countDocuments({ challengeId });

        // Get participants sorted by completion time and wins
        const participants = await db.collection('challenge_participants')
            .find({ challengeId })
            .sort([
                { completed: -1 },
                { endTime: 1 },
                { wins: -1 }
            ])
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

        // Get user details
        const userIds = participants.map(p => p.userId);
        const users = await db.collection('users')
            .find({ userId: { $in: userIds } })
            .toArray();

        const userMap = new Map(users.map(u => [u.userId, u]));

        // Format leaderboard entries
        const leaderboard = participants.map(p => {
            const user = userMap.get(p.userId);
            return {
                userId: p.userId,
                username: user?.username || 'Unknown',
                rank: user?.rank || 'BRONZE',
                tier: user?.tier || 'I',
                wins: p.wins,
                losses: p.losses,
                lives: p.lives,
                completed: p.completed,
                endTime: p.endTime,
                matches: p.matches.length
            };
        });

        return {
            success: true,
            leaderboard,
            totalPages: Math.ceil(total / limit)
        };
    } catch (error) {
        logger.error('Error getting challenge leaderboard:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Apply hypercharge to challenge
 * @param {Object} db - Database instance
 * @param {string} challengeId - Challenge ID
 * @param {number} multiplier - Rep multiplier
 * @param {number} duration - Duration in milliseconds
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function applyHypercharge(db, challengeId, multiplier, duration) {
    const session = db.startSession();
    
    try {
        await session.withTransaction(async () => {
            const challenge = await db.collection('challenges')
                .findOne({ _id: challengeId });

            if (!challenge) {
                throw new Error('Challenge not found');
            }

            if (challenge.state !== CHALLENGE_STATES.ACTIVE) {
                throw new Error('Challenge is not active');
            }

            // Validate multiplier
            if (multiplier < 0 || multiplier > CHALLENGE_CONFIG.VALIDATION.HYPERCHARGE.MAX_MULTIPLIER) {
                throw new Error('Invalid hypercharge multiplier');
            }

            // Update challenge
            await db.collection('challenges').updateOne(
                { _id: challengeId },
                {
                    $set: {
                        hypercharge: {
                            multiplier,
                            startTime: new Date(),
                            endTime: new Date(Date.now() + duration)
                        },
                        updatedAt: new Date()
                    }
                }
            );

            // Update cache
            const cachedChallenge = challengeCache.get(challengeId.toString());
            if (cachedChallenge) {
                cachedChallenge.hypercharge = {
                    multiplier,
                    startTime: new Date(),
                    endTime: new Date(Date.now() + duration)
                };
                cachedChallenge.updatedAt = new Date();
                challengeCache.set(challengeId.toString(), cachedChallenge);
            }

            // Log hypercharge start
            await logChallengeEvent(db, ChallengeEvent.HYPERCHARGE.STARTED, {
                challengeId: challengeId.toString(),
                multiplier,
                duration
            });

            // Set timeout to end hypercharge
            setTimeout(async () => {
                try {
                    await endHypercharge(db, challengeId);
                } catch (error) {
                    logger.error('Error ending hypercharge:', error);
                }
            }, duration);

            return { success: true };
        });
    } catch (error) {
        logger.error('Error applying hypercharge:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * End hypercharge
 * @param {Object} db - Database instance
 * @param {string} challengeId - Challenge ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function endHypercharge(db, challengeId) {
    const session = db.startSession();
    
    try {
        await session.withTransaction(async () => {
            const challenge = await db.collection('challenges')
                .findOne({ _id: challengeId });

            if (!challenge) {
                throw new Error('Challenge not found');
            }

            if (!challenge.hypercharge) {
                return { success: true };
            }

            // Update challenge
            await db.collection('challenges').updateOne(
                { _id: challengeId },
                {
                    $set: {
                        hypercharge: null,
                        updatedAt: new Date()
                    }
                }
            );

            // Update cache
            const cachedChallenge = challengeCache.get(challengeId.toString());
            if (cachedChallenge) {
                cachedChallenge.hypercharge = null;
                cachedChallenge.updatedAt = new Date();
                challengeCache.set(challengeId.toString(), cachedChallenge);
            }

            // Log hypercharge end
            await logChallengeEvent(db, ChallengeEvent.HYPERCHARGE.ENDED, {
                challengeId: challengeId.toString()
            });

            return { success: true };
        });
    } catch (error) {
        logger.error('Error ending hypercharge:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

// Export functions and constants
module.exports = {
    CHALLENGE_CONFIG,
    CHALLENGE_VALIDATION,
    CHALLENGE_STATES,
    ChallengeEvent,
    createChallenge,
    startChallenge,
    endChallenge,
    joinChallenge,
    updateChallengeProgress,
    getChallengeLeaderboard,
    applyHypercharge,
    endHypercharge
}; 