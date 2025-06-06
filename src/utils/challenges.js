const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');

// Standard and Hard challenges are always available
const PERMANENT_CHALLENGES = {
    standard: {
        id: 'standard',
        name: 'Standard Challenge',
        description: 'A balanced test of skill and team-building! With only 3 lives, each match counts. Win 6 games before you\'re knocked out to claim victory.',
        lives: 3,
        winsRequired: 6,
        icon: 'https://i.imgur.com/wqVC8gr.png',
        reward: 'badge_standard_challenge',
        type: 'PERMANENT',
        cooldown: 0 // No cooldown for permanent challenges
    },
    hard: {
        id: 'hard',
        name: 'Hard Challenge',
        description: 'For the seasoned sluggers! This mode doubles the length and the pressure—12 wins stand between you and the title, but you still only have 3 lives.',
        lives: 3,
        winsRequired: 12,
        icon: 'https://i.imgur.com/IsEUINk.png',
        reward: 'badge_hard_challenge',
        type: 'PERMANENT',
        cooldown: 0 // No cooldown for permanent challenges
    }
};

// Validation constants
const VALID_CHALLENGE_STATUSES = ['ACTIVE', 'COMPLETED', 'FAILED', 'ARCHIVED', 'PAUSED'];
const MAX_EVENT_CHALLENGES = 1;
const MIN_LIVES = 1;
const MAX_LIVES = 10;
const MIN_WINS_REQUIRED = 1;
const MAX_WINS_REQUIRED = 50;
const MAX_DAILY_ATTEMPTS = 10;
const MAX_CHALLENGE_NAME_LENGTH = 50;
const MAX_CHALLENGE_DESCRIPTION_LENGTH = 500;
const MIN_CHALLENGE_NAME_LENGTH = 3;
const RATE_LIMIT_WINDOW = 3600000; // 1 hour in milliseconds
const MAX_CHALLENGES_PER_WINDOW = 3;
const MAX_FAILED_ATTEMPTS = 5;
const COOLDOWN_PERIOD = 300000; // 5 minutes in milliseconds

// Cache for rate limiting
const rateLimitCache = new Map();

// Challenge statuses
const CHALLENGE_STATUS = {
    ACTIVE: 'active',
    PAUSED: 'paused',
    ARCHIVED: 'archived'
};

/**
 * Check if user is rate limited
 * @param {string} userId - User's Discord ID
 * @returns {boolean} Whether user is rate limited
 */
function isRateLimited(userId) {
    const now = Date.now();
    const userRateLimit = rateLimitCache.get(userId) || { count: 0, windowStart: now };
    
    // Reset window if expired
    if (now - userRateLimit.windowStart > RATE_LIMIT_WINDOW) {
        userRateLimit.count = 0;
        userRateLimit.windowStart = now;
    }
    
    // Update cache
    rateLimitCache.set(userId, userRateLimit);
    
    return userRateLimit.count >= MAX_CHALLENGES_PER_WINDOW;
}

/**
 * Update rate limit counter for user
 * @param {string} userId - User's Discord ID
 */
function updateRateLimit(userId) {
    const now = Date.now();
    const userRateLimit = rateLimitCache.get(userId) || { count: 0, windowStart: now };
    
    // Reset window if expired
    if (now - userRateLimit.windowStart > RATE_LIMIT_WINDOW) {
        userRateLimit.count = 1;
        userRateLimit.windowStart = now;
    } else {
        userRateLimit.count++;
    }
    
    rateLimitCache.set(userId, userRateLimit);
}

/**
 * Validate challenge parameters
 * @param {Object} challenge - Challenge object to validate
 * @returns {Object} { isValid: boolean, error?: string }
 */
function validateChallenge(challenge) {
    // Check required fields
    const requiredFields = ['id', 'name', 'description', 'lives', 'winsRequired', 'icon', 'reward', 'type'];
    for (const field of requiredFields) {
        if (!challenge[field]) {
            return { isValid: false, error: `Missing required field: ${field}` };
        }
    }

    // Validate challenge ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(challenge.id)) {
        return { isValid: false, error: 'Challenge ID can only contain letters, numbers, underscores, and hyphens' };
    }

    // Validate name length
    if (challenge.name.length < MIN_CHALLENGE_NAME_LENGTH || 
        challenge.name.length > MAX_CHALLENGE_NAME_LENGTH) {
        return { 
            isValid: false, 
            error: `Challenge name must be between ${MIN_CHALLENGE_NAME_LENGTH} and ${MAX_CHALLENGE_NAME_LENGTH} characters` 
        };
    }

    // Validate description length
    if (challenge.description.length > MAX_CHALLENGE_DESCRIPTION_LENGTH) {
        return { 
            isValid: false, 
            error: `Challenge description cannot exceed ${MAX_CHALLENGE_DESCRIPTION_LENGTH} characters` 
        };
    }

    // Validate lives
    if (!Number.isInteger(challenge.lives) || 
        challenge.lives < MIN_LIVES || 
        challenge.lives > MAX_LIVES) {
        return { 
            isValid: false, 
            error: `Lives must be between ${MIN_LIVES} and ${MAX_LIVES}` 
        };
    }

    // Validate wins required
    if (!Number.isInteger(challenge.winsRequired) || 
        challenge.winsRequired < MIN_WINS_REQUIRED || 
        challenge.winsRequired > MAX_WINS_REQUIRED) {
        return { 
            isValid: false, 
            error: `Wins required must be between ${MIN_WINS_REQUIRED} and ${MAX_WINS_REQUIRED}` 
        };
    }

    // Validate type
    if (!['PERMANENT', 'EVENT'].includes(challenge.type)) {
        return { isValid: false, error: 'Invalid challenge type' };
    }

    // Validate icon URL
    try {
        const url = new URL(challenge.icon);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return { isValid: false, error: 'Icon URL must use HTTP or HTTPS protocol' };
        }
    } catch {
        return { isValid: false, error: 'Invalid icon URL' };
    }

    // Validate event challenge specific fields
    if (challenge.type === 'EVENT') {
        if (!challenge.startTime || !challenge.endTime) {
            return { isValid: false, error: 'Event challenges must have start and end times' };
        }

        const startTime = new Date(challenge.startTime);
        const endTime = new Date(challenge.endTime);
        const now = new Date();

        if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
            return { isValid: false, error: 'Invalid start or end time format' };
        }

        if (endTime <= startTime) {
            return { isValid: false, error: 'End time must be after start time' };
        }

        if (endTime <= now) {
            return { isValid: false, error: 'End time must be in the future' };
        }
    }

    return { isValid: true };
}

/**
 * Check if user can participate in challenges
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @returns {Promise<{ canParticipate: boolean, error?: string, cooldown?: number }>}
 */
async function canParticipateInChallenges(db, userId) {
    try {
        // Check rate limiting
        if (isRateLimited(userId)) {
            return { 
                canParticipate: false, 
                error: 'You have reached the maximum number of challenges for this time period',
                cooldown: RATE_LIMIT_WINDOW
            };
        }

        // Check if user exists
        const user = await db.collection('users').findOne({ userId });
        if (!user) {
            return { canParticipate: false, error: 'User not found' };
        }

        // Check if user is banned
        if (user.banned) {
            return { canParticipate: false, error: 'User is banned from challenges' };
        }

        // Check if user is in an active match
        const activeMatch = await db.collection('matches')
            .findOne({ 
                $or: [
                    { 'player1.userId': userId },
                    { 'player2.userId': userId }
                ],
                status: 'ACTIVE'
            });
        
        if (activeMatch) {
            return { canParticipate: false, error: 'User is in an active match' };
        }

        // Check daily attempt limit
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const attemptsToday = await db.collection('challengeParticipants')
            .countDocuments({
                userId,
                startTime: { $gte: today }
            });

        if (attemptsToday >= MAX_DAILY_ATTEMPTS) {
            return { 
                canParticipate: false, 
                error: 'You have reached the maximum number of challenge attempts for today' 
            };
        }

        // Check failed attempts
        const failedAttempts = await db.collection('challengeParticipants')
            .countDocuments({
                userId,
                status: 'FAILED',
                lastAttempt: { $gte: new Date(Date.now() - COOLDOWN_PERIOD) }
            });

        if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
            const cooldownEnd = new Date(Date.now() + COOLDOWN_PERIOD);
            return { 
                canParticipate: false, 
                error: 'Too many failed attempts. Please wait before trying again.',
                cooldown: COOLDOWN_PERIOD
            };
        }

        return { canParticipate: true };
    } catch (error) {
        logger.error('Error checking challenge participation eligibility:', error);
        return { canParticipate: false, error: 'Database error occurred' };
    }
}

/**
 * Get all available challenges for a user
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @returns {Promise<{ challenges: Array, error?: string }>}
 */
async function getAvailableChallenges(db, userId) {
    try {
        // Check if user can participate
        const participationCheck = await canParticipateInChallenges(db, userId);
        if (!participationCheck.canParticipate) {
            return { challenges: [], error: participationCheck.error };
        }

        // Get user's current challenge participation
        const userChallenge = await db.collection('challengeParticipants')
            .findOne({ 
                userId, 
                status: { $in: ['ACTIVE', 'FAILED'] }
            });

        // Get active event challenge if any
        const eventChallenge = await db.collection('challenges')
            .findOne({ 
                type: 'EVENT', 
                status: 'ACTIVE',
                startTime: { $lte: new Date() },
                endTime: { $gt: new Date() }
            });

        const availableChallenges = [];

        // Add permanent challenges
        availableChallenges.push(PERMANENT_CHALLENGES.standard);
        availableChallenges.push(PERMANENT_CHALLENGES.hard);

        // Add event challenge if available and user isn't in a challenge
        if (eventChallenge && !userChallenge) {
            // Validate event challenge
            const validation = validateChallenge(eventChallenge);
            if (!validation.isValid) {
                logger.error('Invalid event challenge found:', validation.error);
                return { challenges: availableChallenges };
            }

            availableChallenges.push({
                id: eventChallenge.id,
                name: eventChallenge.name,
                description: eventChallenge.description,
                lives: eventChallenge.lives,
                winsRequired: eventChallenge.winsRequired,
                icon: eventChallenge.icon,
                reward: eventChallenge.reward,
                type: 'EVENT',
                startTime: eventChallenge.startTime,
                endTime: eventChallenge.endTime
            });
        }

        return { challenges: availableChallenges };
    } catch (error) {
        logger.error('Error getting available challenges:', error);
        return { challenges: [], error: 'Database error occurred' };
    }
}

/**
 * Start a challenge for a user
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @param {string} challengeId - Challenge ID to start
 * @returns {Promise<{ success: boolean, error?: string, cooldown?: number }>}
 */
async function startChallenge(db, userId, challengeId) {
    const session = db.startSession();
    
    try {
        // Check if user can participate
        const participationCheck = await canParticipateInChallenges(db, userId);
        if (!participationCheck.canParticipate) {
            return { 
                success: false, 
                error: participationCheck.error,
                cooldown: participationCheck.cooldown
            };
        }

        await session.withTransaction(async () => {
            // Check if user is already in a challenge
            const existingChallenge = await db.collection('challengeParticipants')
                .findOne({ 
                    userId, 
                    status: { $in: ['ACTIVE', 'FAILED'] }
                });
            
            if (existingChallenge) {
                throw new Error('You are already participating in a challenge');
            }

            // Get challenge details
            let challenge;
            if (challengeId === 'standard' || challengeId === 'hard') {
                challenge = PERMANENT_CHALLENGES[challengeId];
            } else {
                challenge = await db.collection('challenges')
                    .findOne({ 
                        id: challengeId, 
                        status: 'ACTIVE',
                        startTime: { $lte: new Date() },
                        endTime: { $gt: new Date() }
                    });
                
                if (!challenge) {
                    throw new Error('Challenge not found or not active');
                }

                // Validate event challenge
                const validation = validateChallenge(challenge);
                if (!validation.isValid) {
                    throw new Error(`Invalid challenge configuration: ${validation.error}`);
                }

                // Check if challenge is paused
                if (challenge.status === 'PAUSED') {
                    throw new Error('This challenge is currently paused');
                }
            }

            // Create new challenge participation
            await db.collection('challengeParticipants').insertOne({
                userId,
                challengeId,
                status: 'ACTIVE',
                lives: challenge.lives,
                wins: 0,
                startTime: new Date(),
                lastAttempt: new Date(),
                attempts: 1,
                totalMatches: 0,
                totalWins: 0,
                totalLosses: 0,
                consecutiveLosses: 0,
                bestWinStreak: 0,
                currentWinStreak: 0
            });

            // Update rate limit
            updateRateLimit(userId);

            // Log challenge start
            logger.info('Challenge started', {
                userId,
                challengeId,
                challengeType: challenge.type,
                timestamp: new Date()
            });
        });

        return { success: true };
    } catch (error) {
        logger.error('Error starting challenge:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Update challenge progress after a match
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @param {boolean} won - Whether the user won the match
 * @returns {Promise<{ success: boolean, completed?: boolean, error?: string }>}
 */
async function updateChallengeProgress(db, userId, won) {
    const session = db.startSession();
    
    try {
        let result = { success: true };
        
        await session.withTransaction(async () => {
            // Get user's active challenge
            const participation = await db.collection('challengeParticipants')
                .findOne({ 
                    userId, 
                    status: 'ACTIVE'
                });
            
            if (!participation) {
                throw new Error('No active challenge found');
            }

            // Get challenge details
            let challenge;
            if (participation.challengeId === 'standard' || participation.challengeId === 'hard') {
                challenge = PERMANENT_CHALLENGES[participation.challengeId];
            } else {
                challenge = await db.collection('challenges')
                    .findOne({ 
                        id: participation.challengeId,
                        status: 'ACTIVE',
                        startTime: { $lte: new Date() },
                        endTime: { $gt: new Date() }
                    });

                if (!challenge) {
                    // Challenge ended while user was participating
                    await db.collection('challengeParticipants').updateOne(
                        { userId, status: 'ACTIVE' },
                        { 
                            $set: { 
                                status: 'FAILED',
                                failureReason: 'Challenge ended while in progress'
                            }
                        },
                        { session }
                    );
                    throw new Error('Challenge is no longer active');
                }

                // Check if challenge is paused
                if (challenge.status === 'PAUSED') {
                    await db.collection('challengeParticipants').updateOne(
                        { userId, status: 'ACTIVE' },
                        { 
                            $set: { 
                                status: 'PAUSED',
                                pauseReason: 'Challenge was paused by admin'
                            }
                        },
                        { session }
                    );
                    throw new Error('Challenge has been paused');
                }
            }

            // Update match statistics and streaks
            const updateData = {
                $inc: { 
                    totalMatches: 1,
                    totalWins: won ? 1 : 0,
                    totalLosses: won ? 0 : 1,
                    consecutiveLosses: won ? 0 : 1,
                    currentWinStreak: won ? 1 : 0
                },
                $set: { lastAttempt: new Date() }
            };

            if (won) {
                // Update win streak
                const newWinStreak = participation.currentWinStreak + 1;
                if (newWinStreak > participation.bestWinStreak) {
                    updateData.$set.bestWinStreak = newWinStreak;
                }
                updateData.$set.currentWinStreak = newWinStreak;
            } else {
                // Reset win streak and increment consecutive losses
                updateData.$set.currentWinStreak = 0;
                updateData.$inc.consecutiveLosses = 1;
            }

            await db.collection('challengeParticipants').updateOne(
                { userId, status: 'ACTIVE' },
                updateData,
                { session }
            );

            if (won) {
                // Update wins
                await db.collection('challengeParticipants').updateOne(
                    { userId, status: 'ACTIVE' },
                    { $inc: { wins: 1 } },
                    { session }
                );

                // Check if challenge completed
                if (participation.wins + 1 >= challenge.winsRequired) {
                    await db.collection('challengeParticipants').updateOne(
                        { userId, status: 'ACTIVE' },
                        { 
                            $set: { 
                                status: 'COMPLETED',
                                completedAt: new Date(),
                                completionTime: new Date() - participation.startTime
                            }
                        },
                        { session }
                    );

                    // Award badge
                    await db.collection('users').updateOne(
                        { userId },
                        { $addToSet: { badges: challenge.reward } },
                        { session }
                    );

                    // Log completion
                    logger.info('Challenge completed', {
                        userId,
                        challengeId: challenge.id,
                        challengeType: challenge.type,
                        totalMatches: participation.totalMatches + 1,
                        totalWins: participation.totalWins + 1,
                        completionTime: new Date() - participation.startTime,
                        bestWinStreak: Math.max(participation.bestWinStreak, participation.currentWinStreak + 1)
                    });

                    result.completed = true;
                }
            } else {
                // Update lives
                await db.collection('challengeParticipants').updateOne(
                    { userId, status: 'ACTIVE' },
                    { $inc: { lives: -1 } },
                    { session }
                );

                // Check if out of lives
                if (participation.lives <= 1) {
                    // Reset progress but keep participation active
                    await db.collection('challengeParticipants').updateOne(
                        { userId, status: 'ACTIVE' },
                        { 
                            $set: { 
                                wins: 0,
                                lives: challenge.lives,
                                currentWinStreak: 0,
                                consecutiveLosses: 0
                            },
                            $inc: { attempts: 1 }
                        },
                        { session }
                    );

                    // Log attempt reset
                    logger.info('Challenge attempt reset', {
                        userId,
                        challengeId: challenge.id,
                        challengeType: challenge.type,
                        attempt: participation.attempts + 1,
                        reason: 'Out of lives'
                    });
                }
            }
        });

        return result;
    } catch (error) {
        logger.error('Error updating challenge progress:', error);
        return { success: false, error: error.message };
    } finally {
        await session.endSession();
    }
}

/**
 * Get user's current challenge status
 * @param {Object} db - Database instance
 * @param {string} userId - User's Discord ID
 * @returns {Promise<{ status: Object, error?: string }>}
 */
async function getChallengeStatus(db, userId) {
    try {
        const participation = await db.collection('challengeParticipants')
            .findOne({ 
                userId, 
                status: { $in: ['ACTIVE', 'FAILED'] }
            });
        
        if (!participation) {
            return { status: null };
        }

        // Get challenge details
        let challenge;
        if (participation.challengeId === 'standard' || participation.challengeId === 'hard') {
            challenge = PERMANENT_CHALLENGES[participation.challengeId];
        } else {
            challenge = await db.collection('challenges')
                .findOne({ 
                    id: participation.challengeId,
                    status: 'ACTIVE'
                });

            if (!challenge) {
                // Challenge ended while user was participating
                await db.collection('challengeParticipants').updateOne(
                    { userId, status: 'ACTIVE' },
                    { $set: { status: 'FAILED' } }
                );
                return { 
                    status: null, 
                    error: 'Challenge is no longer active' 
                };
            }
        }

        return {
            status: {
                ...participation,
                challengeName: challenge.name,
                challengeIcon: challenge.icon,
                winsRequired: challenge.winsRequired,
                type: challenge.type,
                timeRemaining: challenge.type === 'EVENT' ? 
                    challenge.endTime - new Date() : null
            }
        };
    } catch (error) {
        logger.error('Error getting challenge status:', error);
        return { status: null, error: 'Database error occurred' };
    }
}

/**
 * Create a new challenge
 */
async function createChallenge(client, name, id, icon, lives, winsRequired, reward, startTime = null, endTime = null) {
    try {
        // Validate challenge ID format
        if (!/^[a-zA-Z0-9-]+$/.test(id)) {
            throw new Error('Challenge ID must be alphanumeric with hyphens');
        }

        // Check if ID is taken
        const existingChallenge = await client.db.collection('challenges').findOne({ id });
        if (existingChallenge) {
            throw new Error('Challenge ID already taken');
        }

        // Validate badge exists
        const badge = await client.db.collection('badges').findOne({ id: reward });
        if (!badge) {
            throw new Error('Reward badge not found');
        }

        // Validate times if provided
        if (startTime && endTime) {
            const start = new Date(startTime);
            const end = new Date(endTime);
            if (start >= end) {
                throw new Error('Start time must be before end time');
            }

            // Check for overlapping challenges
            const overlapping = await client.db.collection('challenges').findOne({
                status: CHALLENGE_STATUS.ACTIVE,
                $or: [
                    {
                        startTime: { $lte: end },
                        endTime: { $gte: start }
                    }
                ]
            });
            if (overlapping) {
                throw new Error('Challenge time overlaps with existing active challenge');
            }
        }

        // Create challenge
        const challenge = {
            name,
            id,
            icon,
            lives,
            winsRequired,
            reward,
            startTime: startTime ? new Date(startTime) : new Date(),
            endTime: endTime ? new Date(endTime) : null,
            status: CHALLENGE_STATUS.ACTIVE,
            description: '',
            participants: [],
            createdAt: new Date()
        };

        await client.db.collection('challenges').insertOne(challenge);
        return challenge;

    } catch (error) {
        logger.error('Error in createChallenge:', error);
        throw error;
    }
}

/**
 * View challenge(s)
 */
async function viewChallenge(client, id = null) {
    try {
        if (id) {
            // View specific challenge
            const challenge = await client.db.collection('challenges').findOne({ id });
            if (!challenge) {
                throw new Error('Challenge not found');
            }

            // Get participant count
            const participantCount = challenge.participants.length;

            return {
                challenge,
                participantCount
            };
        } else {
            // List all challenges
            const challenges = await client.db.collection('challenges')
                .find()
                .sort({ createdAt: -1 })
                .limit(5)
                .toArray();

            const total = await client.db.collection('challenges').countDocuments();

            return {
                challenges,
                total,
                page: 1,
                totalPages: Math.ceil(total / 5)
            };
        }
    } catch (error) {
        logger.error('Error in viewChallenge:', error);
        throw error;
    }
}

/**
 * Delete a challenge
 */
async function deleteChallenge(client, id) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Check if challenge is active
        if (challenge.status === CHALLENGE_STATUS.ACTIVE) {
            const now = new Date();
            if (now >= challenge.startTime && (!challenge.endTime || now <= challenge.endTime)) {
                throw new Error('Cannot delete active challenge');
            }
        }

        // Delete challenge and all participant data
        await Promise.all([
            client.db.collection('challenges').deleteOne({ id }),
            client.db.collection('challenge_participants').deleteMany({ challengeId: id })
        ]);

        return challenge;

    } catch (error) {
        logger.error('Error in deleteChallenge:', error);
        throw error;
    }
}

/**
 * Start a challenge
 */
async function startChallenge(client, id) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Check if another challenge is active
        const activeChallenge = await client.db.collection('challenges').findOne({
            status: CHALLENGE_STATUS.ACTIVE,
            id: { $ne: id }
        });

        if (activeChallenge) {
            // Compensate active participants
            const activeParticipants = await client.db.collection('challenge_participants')
                .find({ challengeId: activeChallenge.id, status: 'in_progress' })
                .toArray();

            for (const participant of activeParticipants) {
                await client.db.collection('users').updateOne(
                    { discordId: participant.userId },
                    { $inc: { rep: 50 } }
                );

                const user = await client.users.fetch(participant.userId).catch(() => null);
                if (user) {
                    const embed = new EmbedBuilder()
                        .setColor('#ffff00')
                        .setTitle('Challenge Compensation')
                        .setDescription(`You have been compensated with 50 rep for the interrupted challenge ${activeChallenge.name}.`)
                        .setTimestamp();

                    await user.send({ embeds: [embed] }).catch(() => {});
                }
            }

            // End the active challenge
            await client.db.collection('challenges').updateOne(
                { id: activeChallenge.id },
                { $set: { status: CHALLENGE_STATUS.ARCHIVED } }
            );
        }

        // Start the new challenge
        await client.db.collection('challenges').updateOne(
            { id },
            {
                $set: {
                    status: CHALLENGE_STATUS.ACTIVE,
                    startTime: new Date(),
                    endTime: null
                }
            }
        );

        return { ...challenge, status: CHALLENGE_STATUS.ACTIVE };

    } catch (error) {
        logger.error('Error in startChallenge:', error);
        throw error;
    }
}

/**
 * End a challenge
 */
async function endChallenge(client, id) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Get active participants
        const activeParticipants = await client.db.collection('challenge_participants')
            .find({ challengeId: id, status: 'in_progress' })
            .toArray();

        // Mark incomplete participants as DNF
        for (const participant of activeParticipants) {
            await client.db.collection('challenge_participants').updateOne(
                { _id: participant._id },
                { $set: { status: 'dnf' } }
            );

            const user = await client.users.fetch(participant.userId).catch(() => null);
            if (user) {
                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Challenge Ended')
                    .setDescription(`The challenge ${challenge.name} has ended. Your progress has been marked as DNF.`)
                    .setTimestamp();

                await user.send({ embeds: [embed] }).catch(() => {});
            }
        }

        // Archive challenge
        await client.db.collection('challenges').updateOne(
            { id },
            { $set: { status: CHALLENGE_STATUS.ARCHIVED } }
        );

        return { ...challenge, status: CHALLENGE_STATUS.ARCHIVED };

    } catch (error) {
        logger.error('Error in endChallenge:', error);
        throw error;
    }
}

/**
 * Edit a challenge
 */
async function editChallenge(client, id, field, value) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Validate field
        const validFields = ['name', 'icon', 'lives', 'wins', 'reward', 'start', 'end', 'description'];
        if (!validFields.includes(field)) {
            throw new Error('Invalid field to edit');
        }

        // Handle different field types
        let update = {};
        switch (field) {
            case 'name':
                update.name = value;
                break;
            case 'icon':
                if (!value.match(/^https?:\/\/.+/)) {
                    throw new Error('Invalid icon URL');
                }
                update.icon = value;
                break;
            case 'lives':
                const lives = parseInt(value);
                if (isNaN(lives) || lives < 1) {
                    throw new Error('Lives must be a positive integer');
                }
                update.lives = lives;
                break;
            case 'wins':
                const wins = parseInt(value);
                if (isNaN(wins) || wins < 1) {
                    throw new Error('Wins required must be a positive integer');
                }
                update.winsRequired = wins;
                break;
            case 'reward':
                const badge = await client.db.collection('badges').findOne({ id: value });
                if (!badge) {
                    throw new Error('Reward badge not found');
                }
                update.reward = value;
                break;
            case 'start':
            case 'end':
                const time = new Date(value);
                if (isNaN(time.getTime())) {
                    throw new Error('Invalid date format');
                }
                if (field === 'start') {
                    update.startTime = time;
                } else {
                    update.endTime = time;
                }
                // Validate time order
                if (update.startTime && update.endTime && update.startTime >= update.endTime) {
                    throw new Error('Start time must be before end time');
                }
                break;
            case 'description':
                update.description = value;
                break;
        }

        // Update challenge
        await client.db.collection('challenges').updateOne(
            { id },
            { $set: update }
        );

        return { ...challenge, ...update };

    } catch (error) {
        logger.error('Error in editChallenge:', error);
        throw error;
    }
}

/**
 * List challenge participants
 */
async function listParticipants(client, id, page = 1) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        const perPage = 20;
        const skip = (page - 1) * perPage;

        const participants = await client.db.collection('challenge_participants')
            .find({ challengeId: id })
            .sort({ joinedAt: 1 })
            .skip(skip)
            .limit(perPage)
            .toArray();

        const total = await client.db.collection('challenge_participants')
            .countDocuments({ challengeId: id });

        return {
            participants,
            page,
            totalPages: Math.ceil(total / perPage),
            total
        };

    } catch (error) {
        logger.error('Error in listParticipants:', error);
        throw error;
    }
}

/**
 * Add a participant to a challenge
 */
async function addParticipant(client, id, userId) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Check if user is already a participant
        const existingParticipant = await client.db.collection('challenge_participants')
            .findOne({ challengeId: id, userId });
        if (existingParticipant) {
            throw new Error('User is already a participant');
        }

        // Add participant
        const participant = {
            challengeId: id,
            userId,
            wins: 0,
            lives: challenge.lives,
            status: 'in_progress',
            joinedAt: new Date()
        };

        await client.db.collection('challenge_participants').insertOne(participant);

        // Notify user
        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Added to Challenge')
            .setDescription(`You have been added to the challenge ${challenge.name}!`)
            .addFields(
                { name: 'Lives', value: challenge.lives.toString(), inline: true },
                { name: 'Wins Required', value: challenge.winsRequired.toString(), inline: true }
            )
            .setTimestamp();

        await user.send({ embeds: [embed] }).catch(() => {
            throw new Error('Could not send DM to user');
        });

        return participant;

    } catch (error) {
        logger.error('Error in addParticipant:', error);
        throw error;
    }
}

/**
 * Remove a participant from a challenge
 */
async function removeParticipant(client, id, userId) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Check if user is a participant
        const participant = await client.db.collection('challenge_participants')
            .findOne({ challengeId: id, userId });
        if (!participant) {
            throw new Error('User is not a participant');
        }

        // Remove participant
        await client.db.collection('challenge_participants').deleteOne({
            challengeId: id,
            userId
        });

        // Notify user
        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Removed from Challenge')
            .setDescription(`You have been removed from the challenge ${challenge.name}.`)
            .setTimestamp();

        await user.send({ embeds: [embed] }).catch(() => {});

        return participant;

    } catch (error) {
        logger.error('Error in removeParticipant:', error);
        throw error;
    }
}

/**
 * Pause a challenge
 */
async function pauseChallenge(client, id) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        if (challenge.status !== CHALLENGE_STATUS.ACTIVE) {
            throw new Error('Challenge is not active');
        }

        // Pause challenge
        await client.db.collection('challenges').updateOne(
            { id },
            { $set: { status: CHALLENGE_STATUS.PAUSED } }
        );

        // Notify participants
        const participants = await client.db.collection('challenge_participants')
            .find({ challengeId: id, status: 'in_progress' })
            .toArray();

        for (const participant of participants) {
            const user = await client.users.fetch(participant.userId).catch(() => null);
            if (user) {
                const embed = new EmbedBuilder()
                    .setColor('#ffff00')
                    .setTitle('Challenge Paused')
                    .setDescription(`The challenge ${challenge.name} has been paused.`)
                    .setTimestamp();

                await user.send({ embeds: [embed] }).catch(() => {});
            }
        }

        return { ...challenge, status: CHALLENGE_STATUS.PAUSED };

    } catch (error) {
        logger.error('Error in pauseChallenge:', error);
        throw error;
    }
}

/**
 * Extend a challenge
 */
async function extendChallenge(client, id, duration) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Parse duration
        const match = duration.match(/^(\d+)([hd])$/);
        if (!match) {
            throw new Error('Invalid duration format (e.g., "2d" or "5h")');
        }

        const [, amount, unit] = match;
        const hours = unit === 'h' ? parseInt(amount) : parseInt(amount) * 24;

        // Calculate new end time
        const newEndTime = new Date(challenge.endTime || new Date());
        newEndTime.setHours(newEndTime.getHours() + hours);

        // Validate new end time
        if (challenge.startTime && newEndTime <= challenge.startTime) {
            throw new Error('New end time must be after start time');
        }

        // Update challenge
        await client.db.collection('challenges').updateOne(
            { id },
            { $set: { endTime: newEndTime } }
        );

        return { ...challenge, endTime: newEndTime };

    } catch (error) {
        logger.error('Error in extendChallenge:', error);
        throw error;
    }
}

/**
 * Shorten a challenge
 */
async function shortenChallenge(client, id, duration) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        if (!challenge.endTime) {
            throw new Error('Challenge has no end time to shorten');
        }

        // Parse duration
        const match = duration.match(/^(\d+)([hd])$/);
        if (!match) {
            throw new Error('Invalid duration format (e.g., "2d" or "5h")');
        }

        const [, amount, unit] = match;
        const hours = unit === 'h' ? parseInt(amount) : parseInt(amount) * 24;

        // Calculate new end time
        const newEndTime = new Date(challenge.endTime);
        newEndTime.setHours(newEndTime.getHours() - hours);

        // Validate new end time
        if (challenge.startTime && newEndTime <= challenge.startTime) {
            throw new Error('New end time must be after start time');
        }

        // Update challenge
        await client.db.collection('challenges').updateOne(
            { id },
            { $set: { endTime: newEndTime } }
        );

        // Handle participants who will be affected
        const participants = await client.db.collection('challenge_participants')
            .find({
                challengeId: id,
                status: 'in_progress',
                lastMatchAt: { $gt: newEndTime }
            })
            .toArray();

        for (const participant of participants) {
            await client.db.collection('challenge_participants').updateOne(
                { _id: participant._id },
                { $set: { status: 'dnf' } }
            );

            const user = await client.users.fetch(participant.userId).catch(() => null);
            if (user) {
                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Challenge Shortened')
                    .setDescription(`The challenge ${challenge.name} has been shortened. Your progress has been marked as DNF.`)
                    .setTimestamp();

                await user.send({ embeds: [embed] }).catch(() => {});
            }
        }

        return { ...challenge, endTime: newEndTime };

    } catch (error) {
        logger.error('Error in shortenChallenge:', error);
        throw error;
    }
}

/**
 * Get challenge leaderboard
 */
async function getChallengeLeaderboard(client, id, page = 1) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        const perPage = 10;
        const skip = (page - 1) * perPage;

        // Get completed participants first
        const completed = await client.db.collection('challenge_participants')
            .find({
                challengeId: id,
                status: 'completed'
            })
            .sort({ completedAt: 1 })
            .toArray();

        // Get incomplete participants
        const incomplete = await client.db.collection('challenge_participants')
            .find({
                challengeId: id,
                status: 'in_progress'
            })
            .sort({ wins: -1, lives: -1 })
            .toArray();

        // Combine and paginate
        const allParticipants = [...completed, ...incomplete];
        const total = allParticipants.length;
        const paginated = allParticipants.slice(skip, skip + perPage);

        return {
            participants: paginated,
            page,
            totalPages: Math.ceil(total / perPage),
            total
        };

    } catch (error) {
        logger.error('Error in getChallengeLeaderboard:', error);
        throw error;
    }
}

/**
 * Award a badge for a challenge
 */
async function awardChallengeBadge(client, id, userId, badgeId) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Verify badge exists
        const badge = await client.db.collection('badges').findOne({ id: badgeId });
        if (!badge) {
            throw new Error('Badge not found');
        }

        // Check if user already has badge
        const user = await client.db.collection('users').findOne({
            discordId: userId,
            'badges.id': badgeId
        });
        if (user) {
            throw new Error('User already has this badge');
        }

        // Award badge
        await client.db.collection('users').updateOne(
            { discordId: userId },
            { $push: { badges: { id: badgeId, awardedAt: new Date() } } }
        );

        // Notify user
        const userObj = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Badge Awarded')
            .setDescription(`You have been awarded badge ${badgeId} for challenge ${challenge.name}!`)
            .setTimestamp();

        await userObj.send({ embeds: [embed] }).catch(() => {});

        return { userId, badgeId };

    } catch (error) {
        logger.error('Error in awardChallengeBadge:', error);
        throw error;
    }
}

/**
 * Revoke a challenge badge
 */
async function revokeChallengeBadge(client, id, userId, badgeId) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Check if user has badge
        const user = await client.db.collection('users').findOne({
            discordId: userId,
            'badges.id': badgeId
        });
        if (!user) {
            throw new Error('User does not have this badge');
        }

        // Remove badge
        await client.db.collection('users').updateOne(
            { discordId: userId },
            { $pull: { badges: { id: badgeId } } }
        );

        // Notify user
        const userObj = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Badge Revoked')
            .setDescription(`Your badge ${badgeId} for challenge ${challenge.name} has been revoked.`)
            .setTimestamp();

        await userObj.send({ embeds: [embed] }).catch(() => {});

        return { userId, badgeId };

    } catch (error) {
        logger.error('Error in revokeChallengeBadge:', error);
        throw error;
    }
}

/**
 * Archive a challenge
 */
async function archiveChallenge(client, id) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Check if challenge can be archived
        if (challenge.status === CHALLENGE_STATUS.ACTIVE) {
            const now = new Date();
            if (now < challenge.endTime) {
                throw new Error('Cannot archive active challenge before end time');
            }
        }

        // Get final standings
        const participants = await client.db.collection('challenge_participants')
            .find({ challengeId: id })
            .sort({ status: 1, completedAt: 1, wins: -1 })
            .limit(3)
            .toArray();

        // Calculate stats
        const stats = await client.db.collection('challenge_participants').aggregate([
            { $match: { challengeId: id } },
            {
                $group: {
                    _id: null,
                    totalMatches: { $sum: '$matchesPlayed' },
                    totalParticipants: { $sum: 1 },
                    totalRep: { $sum: '$repEarned' }
                }
            }
        ]).toArray();

        // Archive challenge
        await client.db.collection('challenges').updateOne(
            { id },
            { $set: { status: CHALLENGE_STATUS.ARCHIVED } }
        );

        // Create summary embed
        const summary = {
            topFinishers: participants.map(p => ({
                userId: p.userId,
                time: p.completedAt
            })),
            stats: stats[0] || {
                totalMatches: 0,
                totalParticipants: 0,
                totalRep: 0
            }
        };

        return summary;

    } catch (error) {
        logger.error('Error in archiveChallenge:', error);
        throw error;
    }
}

/**
 * Reset a challenge
 */
async function resetChallenge(client, id) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Delete all participant data
        await client.db.collection('challenge_participants').deleteMany({ challengeId: id });

        // Reset challenge
        await client.db.collection('challenges').updateOne(
            { id },
            {
                $set: {
                    status: CHALLENGE_STATUS.ACTIVE,
                    startTime: new Date(),
                    endTime: null
                }
            }
        );

        return { ...challenge, status: CHALLENGE_STATUS.ACTIVE };

    } catch (error) {
        logger.error('Error in resetChallenge:', error);
        throw error;
    }
}

/**
 * Apply hypercharge to a challenge
 */
async function hyperchargeChallenge(client, id, multiplier, duration) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Parse duration
        const match = duration.match(/^(\d+)([hd])$/);
        if (!match) {
            throw new Error('Invalid duration format (e.g., "2d" or "5h")');
        }

        const [, amount, unit] = match;
        const hours = unit === 'h' ? parseInt(amount) : parseInt(amount) * 24;

        // Calculate end time
        const endTime = new Date();
        endTime.setHours(endTime.getHours() + hours);

        // Update challenge
        await client.db.collection('challenges').updateOne(
            { id },
            {
                $set: {
                    hypercharge: {
                        multiplier: parseInt(multiplier) / 100,
                        endTime
                    }
                }
            }
        );

        // Notify participants
        const participants = await client.db.collection('challenge_participants')
            .find({ challengeId: id, status: 'in_progress' })
            .toArray();

        for (const participant of participants) {
            const user = await client.users.fetch(participant.userId).catch(() => null);
            if (user) {
                const embed = new EmbedBuilder()
                    .setColor('#ffff00')
                    .setTitle('Challenge Hypercharged')
                    .setDescription(`The challenge ${challenge.name} has been hypercharged with a ${multiplier}% rep multiplier for ${duration}!`)
                    .setTimestamp();

                await user.send({ embeds: [embed] }).catch(() => {});
            }
        }

        return {
            ...challenge,
            hypercharge: {
                multiplier: parseInt(multiplier) / 100,
                endTime
            }
        };

    } catch (error) {
        logger.error('Error in hyperchargeChallenge:', error);
        throw error;
    }
}

/**
 * Get challenge statistics
 */
async function getChallengeStats(client, id) {
    try {
        const challenge = await client.db.collection('challenges').findOne({ id });
        if (!challenge) {
            throw new Error('Challenge not found');
        }

        // Get participant stats
        const stats = await client.db.collection('challenge_participants').aggregate([
            { $match: { challengeId: id } },
            {
                $group: {
                    _id: null,
                    totalParticipants: { $sum: 1 },
                    totalMatches: { $sum: '$matchesPlayed' },
                    totalRep: { $sum: '$repEarned' },
                    completedCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    averageWins: { $avg: '$wins' },
                    averageLives: { $avg: '$lives' }
                }
            }
        ]).toArray();

        // Get rank distribution
        const participants = await client.db.collection('challenge_participants')
            .find({ challengeId: id })
            .toArray();

        const rankDistribution = {};
        for (const participant of participants) {
            const user = await client.db.collection('users').findOne({ discordId: participant.userId });
            if (user && user.rank) {
                rankDistribution[user.rank] = (rankDistribution[user.rank] || 0) + 1;
            }
        }

        // Get highest ranked finisher
        const completedParticipants = await client.db.collection('challenge_participants')
            .find({ challengeId: id, status: 'completed' })
            .toArray();

        let highestRankedFinisher = null;
        let highestRank = -1;

        for (const participant of completedParticipants) {
            const user = await client.db.collection('users').findOne({ discordId: participant.userId });
            if (user && user.rank) {
                const rankValue = getRankValue(user.rank);
                if (rankValue > highestRank) {
                    highestRank = rankValue;
                    highestRankedFinisher = user;
                }
            }
        }

        return {
            ...stats[0],
            rankDistribution,
            highestRankedFinisher: highestRankedFinisher ? {
                userId: highestRankedFinisher.discordId,
                rank: highestRankedFinisher.rank
            } : null
        };

    } catch (error) {
        logger.error('Error in getChallengeStats:', error);
        throw error;
    }
}

// Helper function to get rank value for comparison
function getRankValue(rank) {
    const rankOrder = {
        'BRONZE_I': 1, 'BRONZE_II': 2, 'BRONZE_III': 3,
        'SILVER_I': 4, 'SILVER_II': 5, 'SILVER_III': 6,
        'GOLD_I': 7, 'GOLD_II': 8, 'GOLD_III': 9,
        'DIAMOND_I': 10, 'DIAMOND_II': 11, 'DIAMOND_III': 12,
        'MYTHIC_I': 13, 'MYTHIC_II': 14, 'MYTHIC_III': 15,
        'LEGENDARY_I': 16, 'LEGENDARY_II': 17, 'LEGENDARY_III': 18,
        'MASTERS': 19
    };
    return rankOrder[rank] || 0;
}

module.exports = {
    CHALLENGE_STATUS,
    createChallenge,
    viewChallenge,
    deleteChallenge,
    startChallenge,
    endChallenge,
    editChallenge,
    listParticipants,
    addParticipant,
    removeParticipant,
    pauseChallenge,
    extendChallenge,
    shortenChallenge,
    getChallengeLeaderboard,
    awardChallengeBadge,
    revokeChallengeBadge,
    archiveChallenge,
    resetChallenge,
    hyperchargeChallenge,
    getChallengeStats,
    getAvailableChallenges,
    updateChallengeProgress,
    getChallengeStatus,
    validateChallenge,
    canParticipateInChallenges,
    isRateLimited,
    updateRateLimit
}; 