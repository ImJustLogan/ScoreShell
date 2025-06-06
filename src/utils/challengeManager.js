const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const logger = require('./logger');
const { getRankInfo } = require('./helpers');

class ChallengeManager {
    constructor(client) {
        this.client = client;
        this.db = client.db;
        this.activeChallenges = new Map();
        this.challengeStates = new Map();
        this.leaderboardCache = new Map();
        this.statsCache = new Map();
        
        // Initialize challenge monitoring
        this.startChallengeMonitoring();
    }

    // Challenge Lifecycle Management
    async startChallenge(challengeId) {
        try {
            const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge) {
                throw new Error('Challenge not found');
            }

            // Check if another challenge is active
            const activeChallenge = await this.db.collection('challenges').findOne({
                status: 'ACTIVE',
                id: { $ne: challengeId }
            });

            if (activeChallenge) {
                // Compensate active participants
                await this.compensateActiveParticipants(activeChallenge.id);
                // End the active challenge
                await this.endChallenge(activeChallenge.id);
            }

            // Update challenge status
            await this.db.collection('challenges').updateOne(
                { id: challengeId },
                {
                    $set: {
                        status: 'ACTIVE',
                        startedAt: new Date(),
                        hypercharge: {
                            active: false,
                            multiplier: 0,
                            expiresAt: null
                        }
                    }
                }
            );

            // Initialize challenge state
            this.challengeStates.set(challengeId, {
                participants: new Set(),
                matches: new Map(),
                leaderboard: new Map(),
                stats: {
                    totalMatches: 0,
                    totalParticipants: 0,
                    averageWins: 0,
                    averageLivesUsed: 0,
                    rankDistribution: new Map(),
                    completionRate: 0
                }
            });

            // Announce challenge start
            await this.announceChallengeStart(challenge);
            
            logger.info('Challenge started', { challengeId });
            return challenge;
        } catch (error) {
            logger.error('Error starting challenge', { error, challengeId });
            throw error;
        }
    }

    async pauseChallenge(challengeId) {
        try {
            const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge || challenge.status !== 'ACTIVE') {
                throw new Error('Challenge not found or not active');
            }

            // Update challenge status
            await this.db.collection('challenges').updateOne(
                { id: challengeId },
                {
                    $set: {
                        status: 'PAUSED',
                        pausedAt: new Date()
                    }
                }
            );

            // Notify participants
            await this.notifyParticipants(challengeId, 'Challenge Paused', 
                'This challenge has been paused. No new matches or wins will count until it is resumed.');

            logger.info('Challenge paused', { challengeId });
            return challenge;
        } catch (error) {
            logger.error('Error pausing challenge', { error, challengeId });
            throw error;
        }
    }

    async resumeChallenge(challengeId) {
        try {
            const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge || challenge.status !== 'PAUSED') {
                throw new Error('Challenge not found or not paused');
            }

            // Update challenge status
            await this.db.collection('challenges').updateOne(
                { id: challengeId },
                {
                    $set: {
                        status: 'ACTIVE',
                        resumedAt: new Date()
                    }
                }
            );

            // Notify participants
            await this.notifyParticipants(challengeId, 'Challenge Resumed', 
                'This challenge has been resumed. You can now continue earning progress!');

            logger.info('Challenge resumed', { challengeId });
            return challenge;
        } catch (error) {
            logger.error('Error resuming challenge', { error, challengeId });
            throw error;
        }
    }

    async endChallenge(challengeId) {
        try {
            const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge) {
                throw new Error('Challenge not found');
            }

            // Calculate final stats
            const stats = await this.calculateChallengeStats(challengeId);
            
            // Update challenge status and stats
            await this.db.collection('challenges').updateOne(
                { id: challengeId },
                {
                    $set: {
                        status: 'ENDED',
                        endedAt: new Date(),
                        finalStats: stats
                    }
                }
            );

            // Process rewards
            await this.processChallengeRewards(challengeId);

            // Generate and store final leaderboard
            const leaderboard = await this.generateLeaderboard(challengeId);
            await this.db.collection('challengeLeaderboards').insertOne({
                challengeId,
                leaderboard,
                createdAt: new Date()
            });

            // Notify participants
            await this.notifyParticipants(challengeId, 'Challenge Ended', 
                'This challenge has ended. Check your rewards and the final leaderboard!');

            // Clean up challenge state
            this.challengeStates.delete(challengeId);
            this.leaderboardCache.delete(challengeId);
            this.statsCache.delete(challengeId);

            logger.info('Challenge ended', { challengeId, stats });
            return { challenge, stats, leaderboard };
        } catch (error) {
            logger.error('Error ending challenge', { error, challengeId });
            throw error;
        }
    }

    async archiveChallenge(challengeId) {
        try {
            const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge || challenge.status !== 'ENDED') {
                throw new Error('Challenge not found or not ended');
            }

            // Update challenge status
            await this.db.collection('challenges').updateOne(
                { id: challengeId },
                {
                    $set: {
                        status: 'ARCHIVED',
                        archivedAt: new Date()
                    }
                }
            );

            // Generate summary embed
            const summary = await this.generateChallengeSummary(challengeId);
            
            // Store summary
            await this.db.collection('challengeArchives').insertOne({
                challengeId,
                summary,
                archivedAt: new Date()
            });

            logger.info('Challenge archived', { challengeId });
            return { challenge, summary };
        } catch (error) {
            logger.error('Error archiving challenge', { error, challengeId });
            throw error;
        }
    }

    // Leaderboard Management
    async generateLeaderboard(challengeId, page = 1, perPage = 10) {
        try {
            const cacheKey = `${challengeId}_${page}`;
            const cached = this.leaderboardCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
                return cached.data;
            }

            const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge) {
                throw new Error('Challenge not found');
            }

            // Get participants with their progress
            const participants = await this.db.collection('challengeParticipants')
                .find({ challengeId })
                .sort({ 
                    completed: -1, // Completed first
                    wins: -1,     // Then by wins
                    livesLeft: -1, // Then by lives left
                    joinedAt: 1    // Then by join date
                })
                .skip((page - 1) * perPage)
                .limit(perPage)
                .toArray();

            // Get total count for pagination
            const total = await this.db.collection('challengeParticipants')
                .countDocuments({ challengeId });

            // Format leaderboard entries
            const entries = await Promise.all(participants.map(async (participant) => {
                const user = await this.client.users.fetch(participant.userId);
                const rankInfo = await getRankInfo(participant.userId);
                
                return {
                    userId: participant.userId,
                    username: user.username,
                    rank: rankInfo.rank,
                    rankEmoji: rankInfo.emoji,
                    wins: participant.wins,
                    livesLeft: participant.livesLeft,
                    completed: participant.completed,
                    completedAt: participant.completedAt,
                    matchesPlayed: participant.matchesPlayed,
                    winRate: participant.matchesPlayed > 0 
                        ? (participant.wins / participant.matchesPlayed * 100).toFixed(1)
                        : '0.0'
                };
            }));

            const leaderboard = {
                entries,
                total,
                page,
                totalPages: Math.ceil(total / perPage),
                challenge: {
                    id: challenge.id,
                    name: challenge.name,
                    icon: challenge.icon
                }
            };

            // Cache the result
            this.leaderboardCache.set(cacheKey, {
                data: leaderboard,
                timestamp: Date.now()
            });

            return leaderboard;
        } catch (error) {
            logger.error('Error generating leaderboard', { error, challengeId });
            throw error;
        }
    }

    // Stats Management
    async calculateChallengeStats(challengeId) {
        try {
            const cacheKey = challengeId;
            const cached = this.statsCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
                return cached.data;
            }

            const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge) {
                throw new Error('Challenge not found');
            }

            // Get all participants
            const participants = await this.db.collection('challengeParticipants')
                .find({ challengeId })
                .toArray();

            // Calculate basic stats
            const totalParticipants = participants.length;
            const completedParticipants = participants.filter(p => p.completed).length;
            const totalMatches = participants.reduce((sum, p) => sum + p.matchesPlayed, 0);
            const totalWins = participants.reduce((sum, p) => sum + p.wins, 0);
            const totalLivesUsed = participants.reduce((sum, p) => 
                sum + (challenge.lives - p.livesLeft), 0);

            // Calculate rank distribution
            const rankDistribution = new Map();
            for (const participant of participants) {
                const rankInfo = await getRankInfo(participant.userId);
                const rank = rankInfo.rank;
                rankDistribution.set(rank, (rankDistribution.get(rank) || 0) + 1);
            }

            // Calculate averages and rates
            const stats = {
                totalParticipants,
                totalMatches,
                totalWins,
                averageWins: totalParticipants > 0 ? totalWins / totalParticipants : 0,
                averageLivesUsed: totalParticipants > 0 ? totalLivesUsed / totalParticipants : 0,
                completionRate: totalParticipants > 0 ? (completedParticipants / totalParticipants * 100) : 0,
                rankDistribution: Object.fromEntries(rankDistribution),
                topPerformers: await this.getTopPerformers(challengeId, 3),
                matchOutcomes: await this.getMatchOutcomes(challengeId),
                timeStats: await this.getTimeStats(challengeId)
            };

            // Cache the result
            this.statsCache.set(cacheKey, {
                data: stats,
                timestamp: Date.now()
            });

            return stats;
        } catch (error) {
            logger.error('Error calculating challenge stats', { error, challengeId });
            throw error;
        }
    }

    // Reward Management
    async processChallengeRewards(challengeId) {
        try {
            const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge) {
                throw new Error('Challenge not found');
            }

            // Get all completed participants
            const participants = await this.db.collection('challengeParticipants')
                .find({ 
                    challengeId,
                    completed: true
                })
                .toArray();

            // Process rewards for each participant
            for (const participant of participants) {
                try {
                    // Award badge if specified
                    if (challenge.rewardBadge) {
                        await this.awardBadge(participant.userId, challenge.rewardBadge);
                    }

                    // Award rep bonus
                    const repBonus = this.calculateRepBonus(challenge, participant);
                    if (repBonus > 0) {
                        await this.awardRep(participant.userId, repBonus);
                    }

                    // Update participant's reward status
                    await this.db.collection('challengeParticipants').updateOne(
                        { _id: participant._id },
                        {
                            $set: {
                                rewardAwarded: true,
                                rewardAwardedAt: new Date(),
                                repBonus
                            }
                        }
                    );

                    // Notify user
                    await this.notifyReward(participant.userId, challenge, repBonus);
                } catch (error) {
                    logger.error('Error processing reward for participant', {
                        error,
                        challengeId,
                        userId: participant.userId
                    });
                }
            }

            logger.info('Challenge rewards processed', { 
                challengeId,
                participantsProcessed: participants.length
            });
        } catch (error) {
            logger.error('Error processing challenge rewards', { error, challengeId });
            throw error;
        }
    }

    // Helper Methods
    async compensateActiveParticipants(challengeId) {
        const participants = await this.db.collection('challengeParticipants')
            .find({ 
                challengeId,
                status: 'ACTIVE'
            })
            .toArray();

        for (const participant of participants) {
            try {
                await this.awardRep(participant.userId, 50); // Compensation rep
                await this.notifyParticipant(participant.userId, 
                    'Challenge Compensation',
                    'You have received 50 rep as compensation for the challenge being ended early.'
                );
            } catch (error) {
                logger.error('Error compensating participant', {
                    error,
                    challengeId,
                    userId: participant.userId
                });
            }
        }
    }

    async notifyParticipants(challengeId, title, message) {
                const participants = await this.db.collection('challengeParticipants')
                    .find({ challengeId })
                    .toArray();

        for (const participant of participants) {
            try {
                await this.notifyParticipant(participant.userId, title, message);
            } catch (error) {
                logger.error('Error notifying participant', {
                    error,
                    challengeId,
                    userId: participant.userId
                });
            }
        }
    }

    async notifyParticipant(userId, title, message) {
        try {
            const user = await this.client.users.fetch(userId);
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(message)
                .setColor('#0099ff')
                .setTimestamp();

            await user.send({ embeds: [embed] });
        } catch (error) {
            logger.error('Error sending notification to user', {
                error,
                userId
            });
        }
    }

    async notifyReward(userId, challenge, repBonus) {
        try {
            const user = await this.client.users.fetch(userId);
            const embed = new EmbedBuilder()
                .setTitle('Challenge Reward Awarded!')
                .setDescription(`Congratulations on completing the ${challenge.name} challenge!`)
                .addFields(
                    { name: 'Rep Bonus', value: `+${repBonus} rep` },
                    { name: 'Badge', value: challenge.rewardBadge ? 'Awarded' : 'None' }
                )
                .setColor('#00ff00')
                .setTimestamp();

            await user.send({ embeds: [embed] });
        } catch (error) {
            logger.error('Error sending reward notification', {
                error,
                userId,
                challengeId: challenge.id
            });
        }
    }

    calculateRepBonus(challenge, participant) {
        // Base bonus for completion
        let bonus = 100;

        // Bonus for speed (if applicable)
        if (participant.completedAt && challenge.startedAt) {
            const completionTime = participant.completedAt - challenge.startedAt;
            const hoursToComplete = completionTime / (1000 * 60 * 60);
            
            // Bonus for completing within 24 hours
            if (hoursToComplete <= 24) {
                bonus += 50;
            }
        }

        // Bonus for lives remaining
        bonus += participant.livesLeft * 10;

        // Bonus for win rate
        if (participant.matchesPlayed > 0) {
            const winRate = participant.wins / participant.matchesPlayed;
            if (winRate >= 0.8) bonus += 50;
            else if (winRate >= 0.6) bonus += 25;
        }

        return bonus;
    }

    async awardBadge(userId, badgeId) {
        try {
            await this.db.collection('userBadges').updateOne(
                { userId },
                {
                    $addToSet: { badges: badgeId },
                    $setOnInsert: { userId }
                },
                { upsert: true }
            );
        } catch (error) {
            logger.error('Error awarding badge', {
                error,
                userId,
                badgeId
            });
            throw error;
        }
    }

    async awardRep(userId, amount) {
        try {
            await this.db.collection('users').updateOne(
                { discordId: userId },
                { $inc: { rep: amount } }
            );
        } catch (error) {
            logger.error('Error awarding rep', {
                error,
                userId,
                amount
            });
            throw error;
        }
    }

    async getTopPerformers(challengeId, limit = 3) {
        return this.db.collection('challengeParticipants')
                .find({ 
                    challengeId,
                completed: true
            })
            .sort({ 
                completedAt: 1,  // Fastest completion first
                livesLeft: -1,   // Then by lives remaining
                wins: -1         // Then by wins
            })
            .limit(limit)
            .toArray();
    }

    async getMatchOutcomes(challengeId) {
        const matches = await this.db.collection('challengeMatches')
            .find({ challengeId })
                .toArray();

        return {
            total: matches.length,
            averageScore: matches.reduce((sum, m) => sum + m.score, 0) / matches.length,
            closeMatches: matches.filter(m => Math.abs(m.score) <= 2).length,
            blowouts: matches.filter(m => Math.abs(m.score) >= 5).length
        };
    }

    async getTimeStats(challengeId) {
        const participants = await this.db.collection('challengeParticipants')
                    .find({ 
                        challengeId,
                completed: true
            })
            .toArray();

        const completionTimes = participants.map(p => 
            p.completedAt - p.joinedAt
        );

        return {
            averageCompletionTime: completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length,
            fastestCompletion: Math.min(...completionTimes),
            slowestCompletion: Math.max(...completionTimes)
        };
    }

    async generateChallengeSummary(challengeId) {
        const challenge = await this.db.collection('challenges').findOne({ id: challengeId });
        const stats = await this.calculateChallengeStats(challengeId);
        const topPerformers = await this.getTopPerformers(challengeId, 3);

        return {
            challenge: {
                id: challenge.id,
                name: challenge.name,
                icon: challenge.icon,
                startDate: challenge.startedAt,
                endDate: challenge.endedAt,
                duration: challenge.endedAt - challenge.startedAt
            },
            stats: {
                totalParticipants: stats.totalParticipants,
                totalMatches: stats.totalMatches,
                completionRate: stats.completionRate,
                averageWins: stats.averageWins,
                rankDistribution: stats.rankDistribution
            },
            topPerformers: await Promise.all(topPerformers.map(async (p) => {
                const user = await this.client.users.fetch(p.userId);
                return {
                    username: user.username,
                    completionTime: p.completedAt - p.joinedAt,
                    livesLeft: p.livesLeft,
                    wins: p.wins
                };
            }))
        };
    }

    startChallengeMonitoring() {
        // Check for challenges that need to be ended
        setInterval(async () => {
            try {
                const now = new Date();
                const challenges = await this.db.collection('challenges')
                    .find({
                        status: 'ACTIVE',
                        endTime: { $lt: now }
                    })
                    .toArray();

                for (const challenge of challenges) {
                    await this.endChallenge(challenge.id);
                }
            } catch (error) {
                logger.error('Error in challenge monitoring', { error });
            }
        }, 60000); // Check every minute

        // Update stats and leaderboards periodically
        setInterval(async () => {
            try {
                const activeChallenges = await this.db.collection('challenges')
                    .find({ status: 'ACTIVE' })
                .toArray();

                for (const challenge of activeChallenges) {
                    // Update stats
                    await this.calculateChallengeStats(challenge.id);
                    // Update leaderboard
                    await this.generateLeaderboard(challenge.id, 1);
                }
        } catch (error) {
                logger.error('Error updating challenge data', { error });
        }
        }, 300000); // Update every 5 minutes
    }
}

module.exports = ChallengeManager; 