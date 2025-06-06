const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Match = require('../models/Match');
const User = require('../models/User');
const DisputeManager = require('./disputeManager');

class MatchOutcomeManager {
    constructor(client) {
        this.client = client;
        this.activeReports = new Map(); // Map of matchId -> { channel, message, timeout, reports }
        this.disputeManager = new DisputeManager(client);
        this.MATCH_TIMEOUT = 90 * 60 * 1000; // 1.5 hours in milliseconds
    }

    async requestScoreReport(match, channel) {
        // Create score report embed
        const embed = new EmbedBuilder()
            .setTitle('Report Match Score')
            .setDescription('Please report the final score of your match.')
            .setColor('#00FF00')
            .addFields([
                {
                    name: 'Players',
                    value: match.players.map(p => `<@${p.userId}>`).join(' vs '),
                    inline: false
                },
                {
                    name: 'Stage',
                    value: match.stage,
                    inline: true
                },
                {
                    name: 'Room Code',
                    value: match.roomCode,
                    inline: true
                },
                {
                    name: 'Time Remaining',
                    value: '1.5 hours',
                    inline: true
                }
            ]);

        // Create score report buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`score_report_${match._id}`)
                    .setLabel('Report Score')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`score_dispute_${match._id}`)
                    .setLabel('Dispute Score')
                    .setStyle(ButtonStyle.Danger)
            );

        // Send to match channel
        const message = await channel.send({
            embeds: [embed],
            components: [row]
        });

        // Set timeout for score reporting (1.5 hours)
        const timeout = setTimeout(async () => {
            if (this.activeReports.has(match._id)) {
                await this.handleScoreReportTimeout(match, channel);
            }
        }, this.MATCH_TIMEOUT);

        this.activeReports.set(match._id, {
            channel,
            message,
            timeout,
            reports: new Map(), // Map of userId -> { score, timestamp }
            disputeRequested: false
        });

        // Notify players
        const notificationEmbed = new EmbedBuilder()
            .setTitle('Score Report Required')
            .setDescription('Please report your match score within 1.5 hours. After this time, the match will be cancelled.')
            .setColor('#FFA500');

        await channel.send({
            content: match.players.map(p => `<@${p.userId}>`).join(' '),
            embeds: [notificationEmbed]
        });

        return true;
    }

    async handleScoreReport(matchId, userId, score) {
        const reportData = this.activeReports.get(matchId);
        if (!reportData) return false;

        const match = await Match.findById(matchId);
        if (!match) return false;

        // Check if match has exceeded time limit
        const matchDuration = Date.now() - match.startTime;
        if (matchDuration > this.MATCH_TIMEOUT) {
            await this.handleScoreReportTimeout(match, reportData.channel);
            return false;
        }

        // Record score report
        reportData.reports.set(userId, {
            score,
            timestamp: new Date()
        });

        // Update message to show reported scores
        const embed = reportData.message.embeds[0];
        const timeRemaining = Math.max(0, this.MATCH_TIMEOUT - matchDuration);
        const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));
        
        embed.fields.find(f => f.name === 'Time Remaining').value = `${minutesRemaining} minutes`;
        
        // Add reported scores
        const scoresField = embed.fields.find(f => f.name === 'Reported Scores') || {
            name: 'Reported Scores',
            value: '',
            inline: false
        };
        
        scoresField.value = Array.from(reportData.reports.entries())
            .map(([uid, data]) => `<@${uid}>: ${data.score}`)
            .join('\n') || 'No scores reported yet';
        
        if (!embed.fields.find(f => f.name === 'Reported Scores')) {
            embed.fields.push(scoresField);
        }

        await reportData.message.edit({
            embeds: [embed]
        });

        // If both players have reported, process the outcome
        if (reportData.reports.size === 2) {
            await this.processScoreReports(match, reportData);
        }

        return true;
    }

    async handleDispute(matchId, userId) {
        const reportData = this.activeReports.get(matchId);
        if (!reportData) return false;

        const match = await Match.findById(matchId);
        if (!match) return false;

        // Check if match has exceeded time limit
        const matchDuration = Date.now() - match.startTime;
        if (matchDuration > this.MATCH_TIMEOUT) {
            await this.handleScoreReportTimeout(match, reportData.channel);
            return false;
        }

        // Mark dispute as requested
        reportData.disputeRequested = true;

        // Update match status
        match.status = 'DISPUTED';
        match.history.push({
            action: 'DISPUTED',
            reason: 'Score dispute requested',
            timestamp: new Date()
        });
        await match.save();

        // Cancel score report timeout
        clearTimeout(reportData.timeout);
        this.activeReports.delete(matchId);

        // Update message
        const embed = reportData.message.embeds[0];
        embed.setColor('#FF0000');
        embed.setDescription('Match disputed. Waiting for moderator review.');
        await reportData.message.edit({
            embeds: [embed],
            components: [] // Remove buttons
        });

        // Notify players
        const disputeEmbed = new EmbedBuilder()
            .setTitle('Match Disputed')
            .setDescription('A dispute has been raised for this match. The match will be reviewed by a moderator.')
            .setColor('#FF0000');

        await reportData.channel.send({
            content: match.players.map(p => `<@${p.userId}>`).join(' '),
            embeds: [disputeEmbed]
        });

        // Check moderator availability
        const moderatorAvailable = await this.disputeManager.checkModeratorAvailability();
        if (!moderatorAvailable) {
            // If no moderator is available, cancel the match
            match.status = 'CANCELLED';
            match.history.push({
                action: 'CANCELLED',
                reason: 'No moderator available for dispute',
                timestamp: new Date()
            });
            await match.save();

            // Notify players
            const cancelEmbed = new EmbedBuilder()
                .setTitle('Match Cancelled')
                .setDescription('No moderator is currently available to handle this dispute. The match has been cancelled.')
                .setColor('#FF0000');

            await reportData.channel.send({
                content: match.players.map(p => `<@${p.userId}>`).join(' '),
                embeds: [cancelEmbed]
            });

            // Return players to queue if eligible
            // TODO: Implement queue return logic
        } else {
            // Handle dispute with available moderator
            await this.disputeManager.handleDispute(match, reportData.channel);
        }

        return true;
    }

    async handleScoreReportTimeout(match, channel) {
        const reportData = this.activeReports.get(match._id);
        if (!reportData) return;

        // Update match status
        match.status = 'CANCELLED';
        match.history.push({
            action: 'CANCELLED',
            reason: 'Score report timeout (1.5 hours)',
            timestamp: new Date()
        });
        await match.save();

        // Notify players
        const timeoutEmbed = new EmbedBuilder()
            .setTitle('Match Cancelled')
            .setDescription('Match cancelled: Score report timeout (1.5 hours exceeded)')
            .setColor('#FF0000');

        await channel.send({
            content: match.players.map(p => `<@${p.userId}>`).join(' '),
            embeds: [timeoutEmbed]
        });

        // Update original message
        if (reportData.message) {
            const embed = reportData.message.embeds[0];
            embed.setColor('#FF0000');
            embed.setDescription('Match cancelled: Score report timeout');
            embed.fields.find(f => f.name === 'Time Remaining').value = 'Expired';
            await reportData.message.edit({
                embeds: [embed],
                components: [] // Remove buttons
            });
        }

        // Clean up
        clearTimeout(reportData.timeout);
        this.activeReports.delete(match._id);

        // Return players to queue if eligible
        // TODO: Implement queue return logic
    }

    async processScoreReports(match, reportData) {
        const reports = Array.from(reportData.reports.entries());
        const [player1Report, player2Report] = reports;

        // Check for score mismatch
        if (player1Report[1].score === player2Report[1].score) {
            // Scores match, process outcome
            const winner = match.players.find(p => p.userId === player1Report[0]);
            const loser = match.players.find(p => p.userId === player2Report[0]);

            if (winner && loser) {
                // Calculate rep changes
                const repChanges = match.calculateRankedRep(winner, loser);
                winner.repChange = repChanges.winner;
                loser.repChange = repChanges.loser;

                // Update match status
                match.status = 'COMPLETED';
                match.endTime = new Date();
                match.history.push({
                    action: 'COMPLETED',
                    reason: 'Score reported and verified',
                    timestamp: new Date()
                });

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

                await match.save();

                // Notify players
                const embed = new EmbedBuilder()
                    .setTitle('Match Completed')
                    .setDescription('Match has been completed and scores verified.')
                    .setColor('#00FF00')
                    .addFields([
                        {
                            name: 'Winner',
                            value: `<@${winner.userId}> (+${winner.repChange} rep)`,
                            inline: true
                        },
                        {
                            name: 'Loser',
                            value: `<@${loser.userId}> (${loser.repChange} rep)`,
                            inline: true
                        }
                    ]);

                await reportData.channel.send({
                    content: match.players.map(p => `<@${p.userId}>`).join(' '),
                    embeds: [embed]
                });
            }
        } else {
            // Scores don't match, handle dispute
            await this.handleDispute(match._id, player1Report[0]);
        }

        // Clean up
        clearTimeout(reportData.timeout);
        this.activeReports.delete(match._id);

        // Remove score report buttons
        await reportData.message.edit({
            components: []
        });
    }
}

module.exports = MatchOutcomeManager; 