const logger = require('./logger');
const { recordQueueJoin, recordQueueLeave, recordMatchmakingAttempt } = require('./performanceMonitor');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const User = require('../models/User');
const Match = require('../models/Match');
const PreGameManager = require('./preGameManager');

// Queue optimization constants
const QUEUE_CONFIG = {
    MAX_QUEUE_SIZE: 100,
    MIN_QUEUE_SIZE: 2,
    QUEUE_CLEANUP_INTERVAL: 300000, // 5 minutes
    MAX_QUEUE_TIME: 3600000, // 1 hour
    REGION_WEIGHTS: {
        SAME_COUNTRY: 1.0,
        NEIGHBORING: 0.8,
        SAME_CONTINENT: 0.6,
        DIFFERENT_CONTINENT: 0.4
    },
    RANK_WEIGHTS: {
        SAME_RANK: 1.0,
        ONE_DIFF: 0.9,
        TWO_DIFF: 0.8,
        THREE_DIFF: 0.7
    },
    MATCHMAKING_THRESHOLD: 0.7, // Minimum match quality score
    BATCH_SIZE: 10, // Number of players to process at once
    HYPERCHARGE_CHANCE: 0.1, // 10% chance for hypercharge
    HYPERCHARGE_MULTIPLIER: 0.5, // 50% multiplier
    REGION_DISTANCES: {
        // Define region distances for matchmaking
        'US-East': { 'US-West': 1, 'EU-West': 2, 'Asia': 3 },
        'US-West': { 'US-East': 1, 'EU-West': 2, 'Asia': 2 },
        'EU-West': { 'US-East': 2, 'US-West': 2, 'Asia': 3 },
        'Asia': { 'US-East': 3, 'US-West': 2, 'EU-West': 3 }
    },
    SYNC_INTERVAL: 5000, // 5 seconds
    UPDATE_INTERVAL: 60000, // 1 minute
    CLEANUP_INTERVAL: 300000, // 5 minutes
    MAX_MATCHMAKING_ATTEMPTS: 10,
    MATCHMAKING_BACKOFF: 30000, // 30 seconds
    REGION_PREFERENCE_WEIGHT: 0.6, // Weight for region preference in matchmaking
    RANK_PREFERENCE_WEIGHT: 0.3, // Weight for rank preference in matchmaking
    WAIT_TIME_WEIGHT: 0.1 // Weight for wait time in matchmaking
};

// Queue state with enhanced tracking
const queueState = {
    lastCleanup: Date.now(),
    processingBatch: false,
    matchmakingQuality: {
        totalMatches: 0,
        successfulMatches: 0,
        averageQuality: 0,
        regionDistribution: new Map(),
        rankDistribution: new Map(),
        hyperchargedMatches: 0
    },
    syncStatus: {
        lastSync: Date.now(),
        syncErrors: 0,
        pendingUpdates: new Set()
    }
};

class QueueManager {
    constructor(client) {
        this.client = client;
        this.activeQueues = new Map(); // Map of serverId -> { channel, message, lastUpdate }
        this.queueCache = new Map(); // Map of userId -> { serverId, joinedAt, region, rank, rep, matchmakingAttempts }
        this.matchmakingInProgress = false;
        this.queueUpdateInterval = null;
        this.cleanupInterval = null;
        this.lastGlobalUpdate = Date.now();
        this.preGameManager = new PreGameManager(client);
        this.syncLock = false;
        this.queueUpdateLock = new Map(); // Map of serverId -> boolean
        this.matchmakingTimeout = new Map(); // Map of matchId -> timeout
        this.queueTimeout = new Map(); // Map of userId -> timeout

        // Start intervals
        this.startIntervals();
    }

    startIntervals() {
        // Update queue displays every minute
        this.queueUpdateInterval = setInterval(() => this.updateAllQueues(), QUEUE_CONFIG.UPDATE_INTERVAL);
        
        // Cleanup queue cache every 5 minutes
        this.cleanupInterval = setInterval(() => this.cleanupQueueCache(), QUEUE_CONFIG.CLEANUP_INTERVAL);
        
        // Global queue sync every 5 seconds
        setInterval(() => this.syncGlobalQueue(), QUEUE_CONFIG.SYNC_INTERVAL);
    }

    async syncGlobalQueue() {
        if (this.syncLock) return;
        this.syncLock = true;

        try {
            const now = Date.now();
            if (now - this.lastGlobalUpdate < QUEUE_CONFIG.SYNC_INTERVAL) {
                return;
            }

            // Get all active queue entries from database with timeout
            const queueEntries = await Promise.race([
                this.client.db.collection('queue')
                    .find({ 
                        status: 'ACTIVE',
                        matchmakingAttempts: { $lt: QUEUE_CONFIG.MAX_MATCHMAKING_ATTEMPTS }
                    })
                    .toArray(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Database timeout')), 5000)
                )
            ]);

            // Update local cache with new entries
            const updatedEntries = new Set();
            for (const entry of queueEntries) {
                const existingEntry = this.queueCache.get(entry.userId);
                if (!existingEntry || existingEntry.joinedAt < entry.joinTime) {
                    this.queueCache.set(entry.userId, {
                        serverId: entry.serverId,
                        joinedAt: entry.joinTime,
                        region: entry.region,
                        rank: entry.rank,
                        rep: entry.rep,
                        matchmakingAttempts: entry.matchmakingAttempts || 0
                    });
                    updatedEntries.add(entry.userId);
                }
            }

            // Remove stale entries
            for (const [userId, data] of this.queueCache.entries()) {
                if (now - data.joinedAt > QUEUE_CONFIG.MAX_QUEUE_TIME) {
                    this.queueCache.delete(userId);
                    await this.client.db.collection('queue')
                        .updateOne(
                            { userId },
                            { 
                                $set: { 
                                    status: 'EXPIRED',
                                    leaveTime: new Date()
                                }
                            }
                        );
                    recordQueueLeave(userId, 'timeout');
                }
            }

            // Update queue displays if there were changes
            if (updatedEntries.size > 0) {
                await this.updateAllQueues();
            }

            this.lastGlobalUpdate = now;
            queueState.syncStatus.lastSync = now;
            queueState.syncStatus.syncErrors = 0;

        } catch (error) {
            logger.error('Error syncing global queue:', {
                error,
                syncErrors: ++queueState.syncStatus.syncErrors
            });

            // If too many sync errors, trigger recovery
            if (queueState.syncStatus.syncErrors >= 5) {
                await this.recoverQueueSync();
            }
        } finally {
            this.syncLock = false;
        }
    }

    async recoverQueueSync() {
        logger.warn('Starting queue sync recovery');
        
        try {
            // Clear cache
            this.queueCache.clear();
            
            // Reset sync status
            queueState.syncStatus.syncErrors = 0;
            queueState.syncStatus.pendingUpdates.clear();
            
            // Force a full sync
            await this.syncGlobalQueue();
            
            // Update all queue displays
            await this.updateAllQueues();
            
            logger.info('Queue sync recovery completed');
        } catch (error) {
            logger.error('Queue sync recovery failed:', error);
        }
    }

    async initializeQueue(serverId, channel) {
        const embed = this.createQueueEmbed([]);
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('queue_join')
                    .setLabel('Join Standard')
                    .setStyle(ButtonStyle.Primary)
            );

        const message = await channel.send({
            embeds: [embed],
            components: [row]
        });

        this.activeQueues.set(serverId, {
            channel,
            message,
            lastUpdate: Date.now()
        });

        return message;
    }

    createQueueEmbed(players) {
        const embed = new EmbedBuilder()
            .setTitle('Standard Queue')
            .setColor('#5865F2')
            .setTimestamp();

        // Group players into rows of 2
        for (let i = 0; i < players.length; i += 2) {
            const row = players.slice(i, i + 2);
            const value = row.map(p => {
                const rankEmoji = this.getRankEmoji(p.rank);
                return `${rankEmoji} <@${p.userId}>`;
            }).join('\n') || 'Empty Slot';
            
            embed.addFields({
                name: `Slot ${i + 1}-${i + 2}`,
                value: value,
                inline: false
            });
        }

        // Add matchmaking status if in progress
        if (this.matchmakingInProgress) {
            embed.setFooter({ text: 'Matchmaking in progress...' });
        }

        return embed;
    }

    getRankEmoji(rank) {
        const rankEmojis = {
            'BRONZE': '<:Icon_ranked_bronze:1348460284951400570>',
            'SILVER': '<:Icon_ranked_silver:1348460318753296466>',
            'GOLD': '<:Icon_ranked_gold:1348460332825186326>',
            'DIAMOND': '<:Icon_ranked_diamond:1348460344049401877>',
            'MYTHIC': '<:Icon_ranked_mythic:1348460358951768084>',
            'LEGENDARY': '<:Icon_ranked_legendary:1348460371392073829>',
            'MASTERS': '<:Icon_ranked_masters:1348460383396167681>'
        };
        return rankEmojis[rank] || rankEmojis['BRONZE'];
    }

    async joinQueue(userId, serverId) {
        try {
            // Check if user is already in queue or in a match
            if (this.queueCache.has(userId)) {
                return { success: false, error: 'You are already in queue' };
            }

            const activeMatch = await Match.findOne({
                'players.userId': userId,
                status: { $in: ['PREGAME', 'IN_PROGRESS'] }
            });

            if (activeMatch) {
                return { success: false, error: 'You are already in a match' };
            }

            // Get user data
            const user = await User.findOne({ userId });
            if (!user) {
                return { success: false, error: 'User not found' };
            }

            // Add to database first
            await this.client.db.collection('queue').insertOne({
                userId,
                serverId,
                joinTime: new Date(),
                region: user.region,
                rank: user.rank,
                rep: user.rep,
                status: 'ACTIVE'
            });

            // Then add to cache
            this.queueCache.set(userId, {
                serverId,
                joinedAt: Date.now(),
                region: user.region,
                rank: user.rank,
                rep: user.rep
            });

            // Record metrics
            recordQueueJoin(userId, user.region, user.rank);

            // Update all queue displays
            await this.updateAllQueues();

            // Check if matchmaking can start
            if (this.queueCache.size >= QUEUE_CONFIG.MIN_QUEUE_SIZE && !this.matchmakingInProgress) {
                this.startMatchmaking();
            }

            return { success: true };
        } catch (error) {
            logger.error('Error joining queue:', error);
            return { success: false, error: 'Failed to join queue' };
        }
    }

    async leaveQueue(userId) {
        if (!this.queueCache.has(userId)) {
            return {
                success: false,
                error: 'You are not in queue'
            };
        }

        this.queueCache.delete(userId);
        await this.updateAllQueues();

        return {
            success: true
        };
    }

    async startMatchmaking() {
        if (this.matchmakingInProgress) return;

        this.matchmakingInProgress = true;
        await this.updateAllQueues();

        // Wait for cooldown
        await new Promise(resolve => setTimeout(resolve, this.MATCHMAKING_COOLDOWN));

        // Check if we still have enough players
        if (this.queueCache.size < 2) {
            this.matchmakingInProgress = false;
            await this.updateAllQueues();
            return;
        }

        // Find best match
        const matchData = await this.findBestMatch();
        if (matchData) {
            await this.createMatch(matchData);
        }

        this.matchmakingInProgress = false;
        await this.updateAllQueues();
    }

    async findBestMatch() {
        const players = Array.from(this.queueCache.entries())
            .map(([userId, data]) => ({
                userId,
                ...data
            }));

        // Group players by region for more efficient matching
        const playersByRegion = new Map();
        for (const player of players) {
            if (!playersByRegion.has(player.region)) {
                playersByRegion.set(player.region, []);
            }
            playersByRegion.get(player.region).push(player);
        }

        let bestMatch = null;
        let bestScore = Infinity;

        // Try to find matches within same region first
        for (const [region, regionPlayers] of playersByRegion) {
            if (regionPlayers.length < 2) continue;

            // Sort players by rep for better matching
            regionPlayers.sort((a, b) => a.rep - b.rep);

            // Try to find best match within region
            for (let i = 0; i < regionPlayers.length - 1; i++) {
                for (let j = i + 1; j < regionPlayers.length; j++) {
                    const player1 = regionPlayers[i];
                    const player2 = regionPlayers[j];

                    // Skip if either player has too many matchmaking attempts
                    if (player1.matchmakingAttempts >= QUEUE_CONFIG.MAX_MATCHMAKING_ATTEMPTS ||
                        player2.matchmakingAttempts >= QUEUE_CONFIG.MAX_MATCHMAKING_ATTEMPTS) {
                        continue;
                    }

                    const score = this.calculateMatchScore(player1, player2);
                    if (score < bestScore) {
                        bestScore = score;
                        bestMatch = [player1, player2];
                    }
                }
            }
        }

        // If no good match found in same region, try cross-region
        if (!bestMatch || bestScore > QUEUE_CONFIG.MATCHMAKING_THRESHOLD) {
            for (const [region1, players1] of playersByRegion) {
                for (const [region2, players2] of playersByRegion) {
                    if (region1 === region2) continue;

                    // Check if regions are too far apart
                    const distance = QUEUE_CONFIG.REGION_DISTANCES[region1]?.[region2];
                    if (!distance || distance > 2) continue; // Skip if regions are too far

                    for (const player1 of players1) {
                        for (const player2 of players2) {
                            // Skip if either player has too many matchmaking attempts
                            if (player1.matchmakingAttempts >= QUEUE_CONFIG.MAX_MATCHMAKING_ATTEMPTS ||
                                player2.matchmakingAttempts >= QUEUE_CONFIG.MAX_MATCHMAKING_ATTEMPTS) {
                                continue;
                            }

                            const score = this.calculateMatchScore(player1, player2);
                            if (score < bestScore) {
                                bestScore = score;
                                bestMatch = [player1, player2];
                            }
                        }
                    }
                }
            }
        }

        // Check if match quality is acceptable
        if (bestMatch && bestScore <= QUEUE_CONFIG.MATCHMAKING_THRESHOLD) {
            // Determine if match is hypercharged
            const isHypercharged = Math.random() < QUEUE_CONFIG.HYPERCHARGE_CHANCE;
            
            // Update matchmaking metrics
            queueState.matchmakingQuality.totalMatches++;
            queueState.matchmakingQuality.successfulMatches++;
            queueState.matchmakingQuality.averageQuality = 
                (queueState.matchmakingQuality.averageQuality * (queueState.matchmakingQuality.totalMatches - 1) + (1 - bestScore)) /
                queueState.matchmakingQuality.totalMatches;

            if (isHypercharged) {
                queueState.matchmakingQuality.hyperchargedMatches++;
            }

            // Update region and rank distribution
            const [player1, player2] = bestMatch;
            const regionKey = `${player1.region}-${player2.region}`;
            queueState.matchmakingQuality.regionDistribution.set(
                regionKey,
                (queueState.matchmakingQuality.regionDistribution.get(regionKey) || 0) + 1
            );

            const rankKey = `${player1.rank}-${player2.rank}`;
            queueState.matchmakingQuality.rankDistribution.set(
                rankKey,
                (queueState.matchmakingQuality.rankDistribution.get(rankKey) || 0) + 1
            );

            return {
                players: bestMatch,
                score: bestScore,
                isHypercharged
            };
        }

        return null;
    }

    calculateMatchScore(player1, player2) {
        // Calculate region distance score
        const regionDistance = QUEUE_CONFIG.REGION_DISTANCES[player1.region]?.[player2.region] || 3;
        const regionScore = 1 - (regionDistance * 0.2); // Convert distance to score (0-1)
        
        // Calculate rank difference score
        const rankDiff = Math.abs(player1.rank - player2.rank);
        const rankScore = QUEUE_CONFIG.RANK_WEIGHTS[`${rankDiff}_DIFF`] || 0.5;
        
        // Calculate rep difference score
        const repDiff = Math.abs(player1.rep - player2.rep);
        const repScore = Math.max(0, 1 - (repDiff / 1000)); // Normalize to 0-1
        
        // Calculate wait time bonus
        const waitTime1 = Date.now() - player1.joinedAt;
        const waitTime2 = Date.now() - player2.joinedAt;
        const waitTimeBonus = Math.min(Math.max(waitTime1, waitTime2) / QUEUE_CONFIG.MAX_QUEUE_TIME, 1);
        
        // Combine scores with weights
        return (
            (1 - regionScore) * QUEUE_CONFIG.REGION_PREFERENCE_WEIGHT +
            (1 - rankScore) * QUEUE_CONFIG.RANK_PREFERENCE_WEIGHT +
            (1 - repScore) * 0.2 +
            (1 - waitTimeBonus) * QUEUE_CONFIG.WAIT_TIME_WEIGHT
        );
    }

    async createMatch(matchData) {
        try {
            const { players, isHypercharged } = matchData;
            const [player1, player2] = players;

            // Remove players from queue
            this.queueCache.delete(player1.userId);
            this.queueCache.delete(player2.userId);
            await this.client.db.collection('queue')
                .deleteMany({ userId: { $in: [player1.userId, player2.userId] } });

            // Create match document
            const match = await Match.create({
                players: [
                    { userId: player1.userId, serverId: player1.serverId },
                    { userId: player2.userId, serverId: player2.serverId }
                ],
                status: 'PREGAME',
                startTime: new Date(),
                isHypercharged,
                hyperchargeMultiplier: isHypercharged ? QUEUE_CONFIG.HYPERCHARGE_MULTIPLIER : 0
            });

            // Notify players
            for (const player of players) {
                const user = await this.client.users.fetch(player.userId);
                if (user) {
                    const embed = new EmbedBuilder()
                        .setTitle('Match Found!')
                        .setColor(isHypercharged ? '#FFD700' : '#00FF00')
                        .setDescription(
                            `You have been matched with ${player === player1 ? player2.userId : player1.userId}\n` +
                            (isHypercharged ? '🎉 This is a Hypercharged match! (+50% rep)' : '')
                        )
                        .addFields(
                            { name: 'Match ID', value: match._id.toString(), inline: true },
                            { name: 'Status', value: 'Waiting for room code...', inline: true }
                        );

                    await user.send({ embeds: [embed] });
                }
            }

            // Update all queue displays
            await this.updateAllQueues();

            return match;
        } catch (error) {
            logger.error('Error creating match:', error);
            throw error;
        }
    }

    async updateQueueDisplay(serverId) {
        if (this.queueUpdateLock.get(serverId)) return;
        this.queueUpdateLock.set(serverId, true);

        try {
            const display = this.activeQueues.get(serverId);
            if (!display) return;

            const { channel, message } = display;
            if (!channel || !message) return;

            // Get active queue entries for this server
            const queueEntries = Array.from(this.queueCache.entries())
                .filter(([_, data]) => data.serverId === serverId)
                .sort((a, b) => a[1].joinedAt - b[1].joinedAt);

            // Create queue embed
            const embed = new EmbedBuilder()
                .setTitle('Standard Queue')
                .setColor('#5865F2')
                .setTimestamp();

            // Add queue slots
            if (queueEntries.length === 0) {
                embed.setDescription('No players in queue');
            } else {
                let description = '';
                for (let i = 0; i < queueEntries.length; i += 2) {
                    const player1 = queueEntries[i];
                    const player2 = queueEntries[i + 1];
                    
                    const slot1 = await this.formatQueueSlot(player1);
                    const slot2 = player2 ? await this.formatQueueSlot(player2) : 'Empty Slot';
                    
                    description += `${slot1} | ${slot2}\n`;
                }
                embed.setDescription(description);

                // Add matchmaking status if active
                if (this.matchmakingInProgress) {
                    embed.addFields({
                        name: 'Status',
                        value: 'Matchmaking in progress...',
                        inline: false
                    });
                }
            }

            // Add queue stats
            const stats = await this.getQueueStats(serverId);
            embed.addFields({
                name: 'Queue Stats',
                value: `Players: ${stats.totalPlayers}\nAverage Wait: ${stats.averageWaitTime}s\nMatch Quality: ${stats.matchQuality}%`,
                inline: false
            });

            // Create or update buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('join_queue')
                        .setLabel('Join Standard')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('⚔️'),
                    new ButtonBuilder()
                        .setCustomId('leave_queue')
                        .setLabel('Leave Queue')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🚫')
                );

            // Update message
            try {
                await message.edit({ embeds: [embed], components: [row] });
                this.activeQueues.set(serverId, { ...display, lastUpdate: Date.now() });
            } catch (error) {
                logger.error('Error updating queue display:', {
                    serverId,
                    error,
                    messageId: message.id
                });
                
                // If message was deleted, try to send a new one
                if (error.code === 10008) {
                    const newMessage = await channel.send({ embeds: [embed], components: [row] });
                    this.activeQueues.set(serverId, {
                        channel,
                        message: newMessage,
                        lastUpdate: Date.now()
                    });
                }
            }
        } catch (error) {
            logger.error('Error in updateQueueDisplay:', {
                serverId,
                error
            });
        } finally {
            this.queueUpdateLock.set(serverId, false);
        }
    }

    async formatQueueSlot([userId, data]) {
        try {
            const user = await this.client.users.fetch(userId);
            const userData = await User.findOne({ userId });
            
            if (!user || !userData) return 'Error loading player';

            const rankEmoji = this.getRankEmoji(userData.rank);
            const waitTime = Math.floor((Date.now() - data.joinedAt) / 1000);
            
            return `${rankEmoji} ${user.username} (${waitTime}s)`;
        } catch (error) {
            logger.error('Error formatting queue slot:', {
                userId,
                error
            });
            return 'Error loading player';
        }
    }

    async getQueueStats(serverId) {
        const serverEntries = Array.from(this.queueCache.entries())
            .filter(([_, data]) => data.serverId === serverId);

        const totalPlayers = serverEntries.length;
        const averageWaitTime = totalPlayers > 0
            ? Math.floor(serverEntries.reduce((sum, [_, data]) => 
                sum + (Date.now() - data.joinedAt) / 1000, 0) / totalPlayers)
            : 0;

        const matchQuality = queueState.matchmakingQuality.totalMatches > 0
            ? Math.round(queueState.matchmakingQuality.averageQuality * 100)
            : 0;

        return {
            totalPlayers,
            averageWaitTime,
            matchQuality
        };
    }

    async updateAllQueues() {
        const updatePromises = Array.from(this.activeQueues.keys())
            .map(serverId => this.updateQueueDisplay(serverId));
        
        await Promise.allSettled(updatePromises);
    }

    async cleanupQueueCache() {
        const now = Date.now();
        for (const [userId, data] of this.queueCache.entries()) {
            if (now - data.joinedAt > this.QUEUE_CACHE_TIMEOUT) {
                this.queueCache.delete(userId);
            }
        }
        await this.updateAllQueues();
    }

    getQueueStatus(userId) {
        return this.queueCache.has(userId);
    }

    getQueueSize() {
        return this.queueCache.size;
    }

    async handleQueueTimeout(userId) {
        const queueEntry = this.queueCache.get(userId);
        if (!queueEntry) return;

        try {
            // Remove from queue
            this.queueCache.delete(userId);
            await this.client.db.collection('queue')
                .updateOne(
                    { userId },
                    { 
                        $set: { 
                            status: 'EXPIRED',
                            leaveTime: new Date(),
                            reason: 'timeout'
                        }
                    }
                );

            // Clear timeout
            const timeout = this.queueTimeout.get(userId);
            if (timeout) {
                clearTimeout(timeout);
                this.queueTimeout.delete(userId);
            }

            // Notify user
            const user = await this.client.users.fetch(userId);
            if (user) {
                await user.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Queue Timeout')
                            .setDescription('You have been removed from the queue due to inactivity.')
                            .setColor('#FF0000')
                    ]
                }).catch(() => {}); // Ignore DM errors
            }

            // Update all queue displays
            await this.updateAllQueues();

            // Record the timeout
            recordQueueLeave(userId, 'timeout');
        } catch (error) {
            logger.error('Error handling queue timeout:', {
                userId,
                error
            });
        }
    }

    async handleMatchmakingTimeout(matchId) {
        const match = this.matchmakingTimeout.get(matchId);
        if (!match) return;

        try {
            const { players, serverId, timeout } = match;
            
            // Clear timeout
            clearTimeout(timeout);
            this.matchmakingTimeout.delete(matchId);

            // Cancel matchmaking
            for (const player of players) {
                this.queueCache.delete(player.userId);
                await this.client.db.collection('queue')
                    .updateOne(
                        { userId: player.userId },
                        { 
                            $set: { 
                                status: 'EXPIRED',
                                leaveTime: new Date(),
                                reason: 'matchmaking_timeout'
                            }
                        }
                    );

                // Clear player's queue timeout
                const playerTimeout = this.queueTimeout.get(player.userId);
                if (playerTimeout) {
                    clearTimeout(playerTimeout);
                    this.queueTimeout.delete(player.userId);
                }
            }

            // Notify players
            for (const player of players) {
                const user = await this.client.users.fetch(player.userId);
                if (user) {
                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('Matchmaking Timeout')
                                .setDescription('The matchmaking process timed out. You have been removed from the queue.')
                                .setColor('#FF0000')
                        ]
                    }).catch(() => {}); // Ignore DM errors
                }
            }

            // Update queue displays
            await this.updateAllQueues();

            // Log the timeout
            logger.info('Matchmaking timeout occurred:', {
                matchId,
                serverId,
                players: players.map(p => p.userId)
            });
        } catch (error) {
            logger.error('Error handling matchmaking timeout:', {
                matchId,
                error
            });
        }
    }

    async startMatchmaking(players) {
        if (this.matchmakingInProgress) return;
        this.matchmakingInProgress = true;

        const matchId = Date.now().toString();
        const serverId = players[0].serverId;

        try {
            // Set matchmaking timeout
            const timeout = setTimeout(() => {
                this.handleMatchmakingTimeout(matchId);
            }, 10000); // 10 seconds

            this.matchmakingTimeout.set(matchId, {
                players,
                serverId,
                timeout
            });

            // Update queue displays to show matchmaking status
            await this.updateAllQueues();

            // Find best match
            const match = await this.findBestMatch();
            if (match) {
                // Clear timeout
                clearTimeout(timeout);
                this.matchmakingTimeout.delete(matchId);

                // Start pre-game
                await this.preGameManager.startPreGame(match.players, match.isHypercharged);
            }
        } catch (error) {
            logger.error('Error in startMatchmaking:', {
                matchId,
                error
            });
        } finally {
            this.matchmakingInProgress = false;
            await this.updateAllQueues();
        }
    }

    async joinQueue(userId, serverId, region, rank, rep) {
        // Check if user is already in queue
        if (this.queueCache.has(userId)) {
            return { success: false, reason: 'already_in_queue' };
        }

        // Check if user is in a match
        const activeMatch = await this.client.db.collection('matches')
            .findOne({
                $or: [
                    { 'players.0.userId': userId },
                    { 'players.1.userId': userId }
                ],
                status: 'ACTIVE'
            });

        if (activeMatch) {
            return { success: false, reason: 'in_active_match' };
        }

        try {
            // Add to queue
            const queueEntry = {
                userId,
                serverId,
                region,
                rank,
                rep,
                joinedAt: Date.now(),
                matchmakingAttempts: 0
            };

            this.queueCache.set(userId, queueEntry);
            await this.client.db.collection('queue')
                .insertOne({
                    ...queueEntry,
                    status: 'ACTIVE',
                    joinTime: new Date()
                });

            // Set queue timeout
            const timeout = setTimeout(() => {
                this.handleQueueTimeout(userId);
            }, QUEUE_CONFIG.MAX_QUEUE_TIME);

            this.queueTimeout.set(userId, timeout);

            // Update queue displays
            await this.updateAllQueues();

            // Record queue join
            recordQueueJoin(userId, serverId);

            return { success: true };
        } catch (error) {
            logger.error('Error joining queue:', {
                userId,
                serverId,
                error
            });
            return { success: false, reason: 'error' };
        }
    }

    async leaveQueue(userId) {
        const queueEntry = this.queueCache.get(userId);
        if (!queueEntry) {
            return { success: false, reason: 'not_in_queue' };
        }

        try {
            // Remove from queue
            this.queueCache.delete(userId);
            await this.client.db.collection('queue')
                .updateOne(
                    { userId },
                    { 
                        $set: { 
                            status: 'LEFT',
                            leaveTime: new Date()
                        }
                    }
                );

            // Clear timeout
            const timeout = this.queueTimeout.get(userId);
            if (timeout) {
                clearTimeout(timeout);
                this.queueTimeout.delete(userId);
            }

            // Update queue displays
            await this.updateAllQueues();

            // Record queue leave
            recordQueueLeave(userId, 'manual');

            return { success: true };
        } catch (error) {
            logger.error('Error leaving queue:', {
                userId,
                error
            });
            return { success: false, reason: 'error' };
        }
    }
}

/**
 * Calculate match quality score between two players
 * @param {Object} player1 - First player
 * @param {Object} player2 - Second player
 * @returns {number} Match quality score (0-1)
 */
function calculateMatchQuality(player1, player2) {
    // Calculate region weight
    const regionWeight = calculateRegionWeight(player1.region, player2.region);
    
    // Calculate rank weight
    const rankDiff = Math.abs(player1.rank - player2.rank);
    const rankWeight = QUEUE_CONFIG.RANK_WEIGHTS[`${rankDiff}_DIFF`] || 0.5;
    
    // Calculate reputation weight (if available)
    const reputationWeight = calculateReputationWeight(player1, player2);
    
    // Calculate final quality score
    return (regionWeight * 0.4 + rankWeight * 0.4 + reputationWeight * 0.2);
}

/**
 * Calculate weight based on region distance
 * @param {string} region1 - First player's region
 * @param {string} region2 - Second player's region
 * @returns {number} Region weight (0-1)
 */
function calculateRegionWeight(region1, region2) {
    if (region1 === region2) return QUEUE_CONFIG.REGION_WEIGHTS.SAME_COUNTRY;
    
    // TODO: Implement region distance calculation based on actual region data
    // For now, return a default weight
    return QUEUE_CONFIG.REGION_WEIGHTS.SAME_CONTINENT;
}

/**
 * Calculate weight based on player reputation
 * @param {Object} player1 - First player
 * @param {Object} player2 - Second player
 * @returns {number} Reputation weight (0-1)
 */
function calculateReputationWeight(player1, player2) {
    // Default to 1.0 if reputation data is not available
    if (!player1.reputation || !player2.reputation) return 1.0;
    
    // Calculate reputation difference
    const repDiff = Math.abs(player1.reputation - player2.reputation);
    return Math.max(0.5, 1 - (repDiff / 100)); // Scale down as reputation difference increases
}

/**
 * Process queue batch for matchmaking
 * @param {Object} client - Discord client
 * @param {Array} queue - Current queue
 * @returns {Array} Array of potential matches
 */
async function processQueueBatch(client, queue) {
    if (queueState.processingBatch) return [];
    queueState.processingBatch = true;
    
    try {
        const potentialMatches = [];
        const processedPlayers = new Set();
        
        // Process players in batches
        for (let i = 0; i < queue.length; i += QUEUE_CONFIG.BATCH_SIZE) {
            const batch = queue.slice(i, i + QUEUE_CONFIG.BATCH_SIZE);
            
            // Find best matches within the batch
            for (const player1 of batch) {
                if (processedPlayers.has(player1.userId)) continue;
                
                let bestMatch = null;
                let bestQuality = QUEUE_CONFIG.MATCHMAKING_THRESHOLD;
                
                // Look for matches in the entire queue
                for (const player2 of queue) {
                    if (player1.userId === player2.userId || processedPlayers.has(player2.userId)) continue;
                    
                    const quality = calculateMatchQuality(player1, player2);
                    if (quality > bestQuality) {
                        bestMatch = player2;
                        bestQuality = quality;
                    }
                }
                
                if (bestMatch) {
                    potentialMatches.push({
                        player1,
                        player2: bestMatch,
                        quality: bestQuality
                    });
                    
                    processedPlayers.add(player1.userId);
                    processedPlayers.add(bestMatch.userId);
                }
            }
        }
        
        // Update matchmaking quality metrics
        if (potentialMatches.length > 0) {
            const totalQuality = potentialMatches.reduce((sum, match) => sum + match.quality, 0);
            queueState.matchmakingQuality.averageQuality = 
                (queueState.matchmakingQuality.averageQuality * queueState.matchmakingQuality.totalMatches + totalQuality) /
                (queueState.matchmakingQuality.totalMatches + potentialMatches.length);
            
            queueState.matchmakingQuality.totalMatches += potentialMatches.length;
            queueState.matchmakingQuality.successfulMatches += potentialMatches.length;
        }
        
        return potentialMatches;
        
    } finally {
        queueState.processingBatch = false;
    }
}

/**
 * Clean up stale queue entries
 * @param {Object} client - Discord client
 */
async function cleanupQueue(client) {
    const now = Date.now();
    if (now - queueState.lastCleanup < QUEUE_CONFIG.QUEUE_CLEANUP_INTERVAL) return;
    
    try {
        // Find and remove stale queue entries
        const staleEntries = await client.db.collection('queue').find({
            joinTime: { $lt: new Date(now - QUEUE_CONFIG.MAX_QUEUE_TIME) }
        }).toArray();
        
        if (staleEntries.length > 0) {
            await client.db.collection('queue').deleteMany({
                _id: { $in: staleEntries.map(entry => entry._id) }
            });
            
            // Record queue leaves for metrics
            for (const entry of staleEntries) {
                recordQueueLeave(entry.userId, now - entry.joinTime);
            }
            
            logger.info(`Cleaned up ${staleEntries.length} stale queue entries`);
        }
        
        queueState.lastCleanup = now;
        
    } catch (error) {
        logger.error('Error cleaning up queue:', error);
    }
}

/**
 * Add player to queue with optimization
 * @param {Object} client - Discord client
 * @param {Object} player - Player data
 * @returns {boolean} Success status
 */
async function addToQueue(client, player) {
    try {
        // Check if player is already in queue
        const existingEntry = await client.db.collection('queue').findOne({
            userId: player.userId
        });
        
        if (existingEntry) {
            // Update existing entry
            await client.db.collection('queue').updateOne(
                { userId: player.userId },
                { 
                    $set: {
                        ...player,
                        joinTime: new Date(),
                        status: 'ACTIVE',
                        matchmakingAttempts: 0
                    }
                }
            );
        } else {
            // Check queue size limit
            const queueSize = await client.db.collection('queue').countDocuments();
            if (queueSize >= QUEUE_CONFIG.MAX_QUEUE_SIZE) {
                logger.warn(`Queue size limit reached (${queueSize})`);
                return false;
            }
            
            // Add new entry
            await client.db.collection('queue').insertOne({
                ...player,
                joinTime: new Date(),
                status: 'ACTIVE',
                matchmakingAttempts: 0
            });
        }
        
        recordQueueJoin(player.userId, player.region, player.rank);
        return true;
        
    } catch (error) {
        logger.error('Error adding player to queue:', error);
        return false;
    }
}

/**
 * Remove player from queue
 * @param {Object} client - Discord client
 * @param {string} userId - Player's user ID
 * @returns {boolean} Success status
 */
async function removeFromQueue(client, userId) {
    try {
        const entry = await client.db.collection('queue').findOne({ userId });
        if (!entry) return false;
        
        await client.db.collection('queue').deleteOne({ userId });
        
        if (entry.joinTime) {
            recordQueueLeave(userId, Date.now() - entry.joinTime);
        }
        
        return true;
        
    } catch (error) {
        logger.error('Error removing player from queue:', error);
        return false;
    }
}

/**
 * Get queue statistics
 * @param {Object} client - Discord client
 * @returns {Object} Queue statistics
 */
async function getQueueStats(client) {
    try {
        const stats = await client.db.collection('queue').aggregate([
            {
                $group: {
                    _id: '$region',
                    count: { $sum: 1 },
                    avgRank: { $avg: '$rank' },
                    avgWaitTime: { $avg: { $subtract: [new Date(), '$joinTime'] } }
                }
            }
        ]).toArray();
        
        return {
            totalPlayers: stats.reduce((sum, stat) => sum + stat.count, 0),
            regionStats: stats.reduce((acc, stat) => ({
                ...acc,
                [stat._id]: {
                    count: stat.count,
                    avgRank: stat.avgRank,
                    avgWaitTime: stat.avgWaitTime
                }
            }), {}),
            matchmakingQuality: queueState.matchmakingQuality
        };
        
    } catch (error) {
        logger.error('Error getting queue stats:', error);
        return null;
    }
}

module.exports = {
    QUEUE_CONFIG,
    processQueueBatch,
    cleanupQueue,
    addToQueue,
    removeFromQueue,
    getQueueStats,
    calculateMatchQuality,
    QueueManager
}; 