const { EmbedBuilder } = require('discord.js');
const Report = require('../models/Report');
const User = require('../models/User');
const logger = require('./logger');

class ReportManager {
    constructor(client) {
        this.client = client;
        this.activeReports = new Map(); // Map of reportId -> { report, status, timestamp }
        this.REPORT_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 days
        this.MAX_REPORTS_PER_USER = 5; // Maximum reports per user per week
        this.REPORT_WEIGHTS = {
            HARASSMENT: 2.0,
            LEAVING: 1.5,
            BAD_CONNECTION: 1.0,
            CHEATING: 2.5
        };
    }

    async validateReport(reporterId, reportedId, reason, explanation, matchId = null) {
        try {
            // Check if reporter has exceeded report limit
            const recentReports = await Report.countDocuments({
                reporter: reporterId,
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            });

            if (recentReports >= this.MAX_REPORTS_PER_USER) {
                return {
                    valid: false,
                    error: 'You have exceeded the maximum number of reports allowed per week.'
                };
            }

            // Check for duplicate reports
            const existingReport = await Report.findOne({
                reporter: reporterId,
                reportedUser: reportedId,
                match: matchId,
                createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            });

            if (existingReport) {
                return {
                    valid: false,
                    error: 'You have already reported this user for this match in the last 24 hours.'
                };
            }

            // Get user history
            const [reporter, reported] = await Promise.all([
                User.findById(reporterId),
                User.findById(reportedId)
            ]);

            if (!reporter || !reported) {
                return {
                    valid: false,
                    error: 'One or both users not found.'
                };
            }

            // Calculate report weight
            const weight = this.calculateReportWeight(reason, reporter, reported);

            // Create report
            const report = new Report({
                reporter: reporterId,
                reportedUser: reportedId,
                reason,
                explanation,
                match: matchId,
                weight,
                status: 'PENDING',
                createdAt: new Date()
            });

            await report.save();

            // Add to active reports
            const reportId = report._id.toString();
            this.activeReports.set(reportId, {
                report,
                status: 'PENDING',
                timestamp: new Date()
            });

            // Set timeout for report resolution
            const timeout = setTimeout(async () => {
                await this.handleReportTimeout(reportId);
            }, this.REPORT_TIMEOUT);

            // Store timeout
            this.activeReports.get(reportId).timeout = timeout;

            // Notify moderators
            await this.notifyModerators(report);

            return {
                valid: true,
                reportId,
                weight
            };
        } catch (error) {
            logger.error('Error validating report:', error);
            return {
                valid: false,
                error: error.message
            };
        }
    }

    calculateReportWeight(reason, reporter, reported) {
        let weight = this.REPORT_WEIGHTS[reason] || 1.0;

        // Adjust weight based on reporter's history
        if (reporter.stats.reportsSubmitted > 0) {
            const accuracy = reporter.stats.reportsAccepted / reporter.stats.reportsSubmitted;
            weight *= (0.5 + accuracy); // Weight reports from accurate reporters higher
        }

        // Adjust weight based on reported user's history
        if (reported.stats.reportsReceived > 0) {
            const reportRatio = reported.stats.reportsAccepted / reported.stats.reportsReceived;
            weight *= (1 + reportRatio); // Weight reports against frequently reported users higher
        }

        return weight;
    }

    async notifyModerators(report) {
        const embed = new EmbedBuilder()
            .setTitle('New Report Requires Review')
            .setDescription(`Weight: ${report.weight.toFixed(2)}`)
            .setColor('#FF0000')
            .addFields([
                {
                    name: 'Report Details',
                    value: `Reporter: <@${report.reporter}>\nReported: <@${report.reportedUser}>\nReason: ${report.reason}`,
                    inline: false
                },
                {
                    name: 'Explanation',
                    value: report.explanation || 'No explanation provided',
                    inline: false
                }
            ])
            .setTimestamp();

        // Get available moderators
        const moderators = await User.find({
            'roles.moderator': true,
            'status.online': true
        });

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

    async handleReportTimeout(reportId) {
        const reportData = this.activeReports.get(reportId);
        if (!reportData) return;

        try {
            // Update report status
            const report = await Report.findById(reportId);
            if (report && report.status === 'PENDING') {
                report.status = 'EXPIRED';
                report.resolvedAt = new Date();
                await report.save();

                // Update user stats
                await User.findByIdAndUpdate(report.reporter, {
                    $inc: { 'stats.reportsExpired': 1 }
                });
            }

            // Clean up
            if (reportData.timeout) {
                clearTimeout(reportData.timeout);
            }
            this.activeReports.delete(reportId);

            // Notify reporter
            try {
                const user = await this.client.users.fetch(report.reporter);
                await user.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Report Expired')
                            .setDescription('Your report has expired without resolution.')
                            .setColor('#FFA500')
                            .setTimestamp()
                    ]
                });
            } catch (error) {
                logger.error(`Failed to notify reporter ${report.reporter}:`, error);
            }
        } catch (error) {
            logger.error('Error handling report timeout:', error);
        }
    }

    async resolveReport(reportId, moderatorId, resolution) {
        const reportData = this.activeReports.get(reportId);
        if (!reportData) return false;

        try {
            // Update report status
            const report = await Report.findById(reportId);
            if (!report) return false;

            report.status = resolution.accepted ? 'ACCEPTED' : 'REJECTED';
            report.resolution = resolution.reason;
            report.resolvedBy = moderatorId;
            report.resolvedAt = new Date();
            await report.save();

            // Update user stats
            await Promise.all([
                User.findByIdAndUpdate(report.reporter, {
                    $inc: {
                        'stats.reportsSubmitted': 1,
                        [`stats.reports${resolution.accepted ? 'Accepted' : 'Rejected'}`]: 1
                    }
                }),
                User.findByIdAndUpdate(report.reportedUser, {
                    $inc: {
                        'stats.reportsReceived': 1,
                        [`stats.reports${resolution.accepted ? 'Accepted' : 'Rejected'}`]: 1
                    }
                })
            ]);

            // Apply penalties if report was accepted
            if (resolution.accepted) {
                await this.applyReportPenalties(report, resolution);
            }

            // Clean up
            if (reportData.timeout) {
                clearTimeout(reportData.timeout);
            }
            this.activeReports.delete(reportId);

            // Notify users
            await this.notifyReportResolution(report, resolution);

            return true;
        } catch (error) {
            logger.error('Error resolving report:', error);
            return false;
        }
    }

    async applyReportPenalties(report, resolution) {
        const reportedUser = await User.findById(report.reportedUser);
        if (!reportedUser) return;

        // Apply penalties based on report reason and user history
        switch (report.reason) {
            case 'HARASSMENT':
                // Temporary mute or ban
                await this.client.db.collection('users').updateOne(
                    { _id: reportedUser._id },
                    { $set: { 'penalties.muted': true, 'penalties.mutedUntil': new Date(Date.now() + 24 * 60 * 60 * 1000) } }
                );
                break;
            case 'LEAVING':
                // Queue cooldown
                await this.client.db.collection('users').updateOne(
                    { _id: reportedUser._id },
                    { $set: { 'penalties.queueCooldown': true, 'penalties.cooldownUntil': new Date(Date.now() + 2 * 60 * 60 * 1000) } }
                );
                break;
            case 'CHEATING':
                // Temporary ban from ranked
                await this.client.db.collection('users').updateOne(
                    { _id: reportedUser._id },
                    { $set: { 'penalties.rankedBanned': true, 'penalties.bannedUntil': new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } }
                );
                break;
        }
    }

    async notifyReportResolution(report, resolution) {
        const embed = new EmbedBuilder()
            .setTitle('Report Resolved')
            .setDescription(`Moderator: <@${report.resolvedBy}>`)
            .setColor(resolution.accepted ? '#FF0000' : '#00FF00')
            .addFields([
                {
                    name: 'Resolution',
                    value: resolution.reason,
                    inline: false
                },
                {
                    name: 'Status',
                    value: resolution.accepted ? 'Accepted' : 'Rejected',
                    inline: false
                }
            ])
            .setTimestamp();

        // Notify reporter and reported user
        const [reporter, reported] = await Promise.all([
            this.client.users.fetch(report.reporter),
            this.client.users.fetch(report.reportedUser)
        ]);

        await Promise.all([
            reporter.send({ embeds: [embed] }).catch(() => {}),
            reported.send({ embeds: [embed] }).catch(() => {})
        ]);
    }
}

module.exports = ReportManager; 