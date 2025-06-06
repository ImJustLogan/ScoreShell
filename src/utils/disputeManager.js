const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Match = require('../models/Match');
const User = require('../models/User');
const Report = require('../models/Report');
const logger = require('./logger');

class DisputeManager {
    constructor(client) {
        this.client = client;
        this.activeDisputes = new Map(); // Map of matchId -> { channel, message, timeout, reports }
        this.moderatorQueue = new Map(); // Map of disputeId -> { match, channel, message, timestamp }
        this.DISPUTE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
        this.MODERATOR_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
        this.MAX_ACTIVE_DISPUTES = 10; // Maximum number of active disputes per moderator
        this.DISPUTE_PRIORITY_WEIGHTS = {
            SCORE_MISMATCH: 1.0,
            PLAYER_REPORT: 1.5,
            MODERATOR_REPORT: 2.0,
            REPEAT_OFFENDER: 1.2
        };
    }

    async handleDispute(match, channel) {
        // Create dispute embed
        const embed = new EmbedBuilder()
            .setTitle('Match Dispute')
            .setDescription('A dispute has been raised for this match. Moderators will review the case.')
            .setColor('#FF0000')
            .addFields([
                {
                    name: 'Players',
                    value: match.players.map(p => `<@${p.userId}>`).join(' vs '),
                    inline: false
                },
                {
                    name: 'Reported Scores',
                    value: match.players.map(p => 
                        `<@${p.userId}>: ${p.reportedScore !== null ? p.reportedScore : 'Not reported'}`
                    ).join('\n'),
                    inline: false
                },
                {
                    name: 'Match Details',
                    value: `Stage: ${match.stage}\nRoom Code: ${match.roomCode}`,
                    inline: false
                }
            ]);

        // Create resolution buttons (admin only)
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`dispute_resolve_${match._id}`)
                    .setLabel('Resolve Dispute')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`dispute_report_${match._id}`)
                    .setLabel('Create Report')
                    .setStyle(ButtonStyle.Danger)
            );

        // Send to admin channel
        const message = await channel.send({
            embeds: [embed],
            components: [row]
        });

        // Notify players
        const playerEmbed = new EmbedBuilder()
            .setTitle('Match Disputed')
            .setDescription('Your match has been disputed due to score mismatch. A moderator will review the case.')
            .setColor('#FF0000');

        for (const player of match.players) {
            try {
                const user = await this.client.users.fetch(player.userId);
                await user.send({ embeds: [playerEmbed] });
            } catch (error) {
                // DM failed, ignore
            }
        }

        // Set timeout for dispute resolution (24 hours)
        const timeout = setTimeout(async () => {
            if (this.activeDisputes.has(match._id)) {
                await this.handleDisputeTimeout(match, channel);
            }
        }, 86400000); // 24 hours

        this.activeDisputes.set(match._id, {
            channel,
            message,
            timeout
        });
    }

    async handleDisputeTimeout(match, channel) {
        const disputeData = this.activeDisputes.get(match._id);
        if (!disputeData) return;

        clearTimeout(disputeData.timeout);
        this.activeDisputes.delete(match._id);

        // Update match status
        match.status = 'CANCELLED';
        match.endTime = new Date();
        match.history.push({
            action: 'CANCELLED',
            reason: 'Dispute timeout - no resolution',
            timestamp: new Date()
        });
        await match.save();

        // Notify players
        const embed = new EmbedBuilder()
            .setTitle('Match Cancelled')
            .setDescription('Match was cancelled due to dispute timeout. No rep will be awarded.')
            .setColor('#FF0000');

        await channel.send({
            content: match.players.map(p => `<@${p.userId}>`).join(' '),
            embeds: [embed]
        });

        // Remove resolution buttons
        await disputeData.message.edit({
            components: []
        });
    }

    async validateDispute(match, reporterId) {
        try {
            // Get player history
            const [player1, player2] = match.players;
            const [player1History, player2History] = await Promise.all([
                Report.find({ reportedUser: player1.userId }),
                Report.find({ reportedUser: player2.userId })
            ]);

            // Calculate dispute priority
            const priority = this.calculateDisputePriority(match, reporterId, player1History, player2History);

            // Check for repeat disputes
            const recentDisputes = await Match.find({
                $or: [
                    { 'players.userId': player1.userId },
                    { 'players.userId': player2.userId }
                ],
                status: 'DISPUTED',
                disputedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
            });

            // Add dispute to queue with priority
            await this.addToModeratorQueue(match, priority, {
                player1History: player1History.length,
                player2History: player2History.length,
                recentDisputes: recentDisputes.length
            });

            return {
                valid: true,
                priority,
                player1History: player1History.length,
                player2History: player2History.length,
                recentDisputes: recentDisputes.length
            };
        } catch (error) {
            logger.error('Error validating dispute:', error);
            return { valid: false, error: error.message };
        }
    }

    calculateDisputePriority(match, reporterId, player1History, player2History) {
        let priority = 1.0;

        // Base priority on dispute type
        if (match.disputeType === 'SCORE_MISMATCH') {
            priority *= this.DISPUTE_PRIORITY_WEIGHTS.SCORE_MISMATCH;
        } else if (match.disputeType === 'PLAYER_REPORT') {
            priority *= this.DISPUTE_PRIORITY_WEIGHTS.PLAYER_REPORT;
        }

        // Adjust for player history
        const reporterHistory = reporterId === match.players[0].userId ? player1History : player2History;
        if (reporterHistory.length > 0) {
            priority *= Math.pow(this.DISPUTE_PRIORITY_WEIGHTS.REPEAT_OFFENDER, Math.min(reporterHistory.length, 3));
        }

        // Adjust for match importance
        if (match.isHypercharged) {
            priority *= 1.2;
        }

        return priority;
    }

    async addToModeratorQueue(match, priority, metadata) {
        const disputeId = `dispute_${match._id}_${Date.now()}`;
        
        // Create dispute entry
        const disputeEntry = {
            match,
            priority,
            metadata,
            timestamp: new Date(),
            status: 'PENDING',
            assignedModerator: null,
            resolution: null
        };

        // Add to queue
        this.moderatorQueue.set(disputeId, disputeEntry);

        // Notify available moderators
        await this.notifyModerators(disputeId);

        // Set timeout for dispute resolution
        const timeout = setTimeout(async () => {
            await this.handleDisputeTimeout(match, disputeId);
        }, this.DISPUTE_TIMEOUT);

        // Store timeout
        disputeEntry.timeout = timeout;

        return disputeId;
    }

    async notifyModerators(disputeId) {
        const dispute = this.moderatorQueue.get(disputeId);
        if (!dispute) return;

        const embed = new EmbedBuilder()
            .setTitle('New Dispute Requires Attention')
            .setDescription(`Priority: ${dispute.priority.toFixed(2)}`)
            .setColor('#FF0000')
            .addFields([
                {
                    name: 'Match Details',
                    value: `Players: ${dispute.match.players.map(p => `<@${p.userId}>`).join(' vs ')}\nStage: ${dispute.match.stage}`,
                    inline: false
                },
                {
                    name: 'Player History',
                    value: `Player 1 Reports: ${dispute.metadata.player1History}\nPlayer 2 Reports: ${dispute.metadata.player2History}\nRecent Disputes: ${dispute.metadata.recentDisputes}`,
                    inline: false
                }
            ])
            .setTimestamp();

        // Get available moderators
        const moderators = await this.getAvailableModerators();
        
        // Notify each moderator
        for (const moderator of moderators) {
            try {
                const user = await this.client.users.fetch(moderator.userId);
                await user.send({ embeds: [embed] });
            } catch (error) {
                logger.error(`Failed to notify moderator ${moderator.userId}:`, error);
            }
        }
    }

    async getAvailableModerators() {
        // Get moderators with active dispute count below threshold
        const moderators = await User.find({
            'roles.moderator': true,
            'status.online': true
        });

        return moderators.filter(mod => {
            const activeDisputes = Array.from(this.moderatorQueue.values())
                .filter(d => d.assignedModerator === mod.userId).length;
            return activeDisputes < this.MAX_ACTIVE_DISPUTES;
        });
    }

    async resolveDispute(disputeId, moderatorId, resolution) {
        const dispute = this.moderatorQueue.get(disputeId);
        if (!dispute) return false;

        try {
            // Update dispute status
            dispute.status = 'RESOLVED';
            dispute.assignedModerator = moderatorId;
            dispute.resolution = resolution;
            dispute.resolvedAt = new Date();

            // Update match status
            const match = await Match.findById(dispute.match._id);
            if (match) {
                match.status = 'COMPLETED';
                match.endTime = new Date();
                match.history.push({
                    action: 'DISPUTE_RESOLVED',
                    moderator: moderatorId,
                    resolution,
                    timestamp: new Date()
                });

                // Apply resolution
                if (resolution.winner) {
                    const winner = match.players.find(p => p.userId === resolution.winner);
                    const loser = match.players.find(p => p.userId !== resolution.winner);
                    
                    // Calculate rep changes
                    const repChanges = match.calculateRankedRep(winner, loser);
                    winner.repChange = repChanges.winner;
                    loser.repChange = repChanges.loser;

                    // Update player stats
                    await Promise.all([
                        User.findByIdAndUpdate(winner.user, {
                            $inc: {
                                'stats.matchesPlayed': 1,
                                'stats.matchesWon': 1
                            }
                        }),
                        User.findByIdAndUpdate(loser.user, {
                            $inc: {
                                'stats.matchesPlayed': 1,
                                'stats.matchesLost': 1
                            }
                        })
                    ]);
                }

                await match.save();
            }

            // Clear timeout
            if (dispute.timeout) {
                clearTimeout(dispute.timeout);
            }

            // Remove from queue
            this.moderatorQueue.delete(disputeId);

            // Notify players
            await this.notifyDisputeResolution(dispute);

            return true;
        } catch (error) {
            logger.error('Error resolving dispute:', error);
            return false;
        }
    }

    async notifyDisputeResolution(dispute) {
        const embed = new EmbedBuilder()
            .setTitle('Dispute Resolved')
            .setDescription(`Moderator: <@${dispute.assignedModerator}>`)
            .setColor('#00FF00')
            .addFields([
                {
                    name: 'Resolution',
                    value: dispute.resolution.reason,
                    inline: false
                },
                {
                    name: 'Outcome',
                    value: dispute.resolution.winner ? 
                        `Winner: <@${dispute.resolution.winner}>` : 
                        'Match cancelled',
                    inline: false
                }
            ])
            .setTimestamp();

        // Notify players
        for (const player of dispute.match.players) {
            try {
                const user = await this.client.users.fetch(player.userId);
                await user.send({ embeds: [embed] });
            } catch (error) {
                logger.error(`Failed to notify player ${player.userId}:`, error);
            }
        }

        // Update channel message
        if (dispute.channel) {
            await dispute.channel.send({
                content: dispute.match.players.map(p => `<@${p.userId}>`).join(' '),
                embeds: [embed]
            });
        }
    }

    async createReport(matchId, reporterId, reportedId, reason, explanation) {
        const match = await Match.findById(matchId);
        if (!match) return false;

        // Create report
        const report = new Report({
            reporter: reporterId,
            reportedUser: reportedId,
            reason,
            explanation,
            match: matchId,
            serverId: match.server.id
        });

        await report.save();

        // Notify players
        const embed = new EmbedBuilder()
            .setTitle('Report Created')
            .setDescription(`A report has been created for this match.\nReason: ${reason}`)
            .setColor('#FF0000');

        const disputeData = this.activeDisputes.get(matchId);
        if (disputeData) {
            await disputeData.channel.send({
                content: match.players.map(p => `<@${p.userId}>`).join(' '),
                embeds: [embed]
            });
        }

        return true;
    }

    async cancelDispute(matchId) {
        const disputeData = this.activeDisputes.get(matchId);
        if (disputeData) {
            clearTimeout(disputeData.timeout);
            this.activeDisputes.delete(matchId);
        }
    }
}

module.exports = DisputeManager; 