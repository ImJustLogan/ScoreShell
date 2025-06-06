const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');

// Rate limiting configuration
const RATE_LIMITS = {
    COMMAND: { window: 60000, max: 30 }, // 30 commands per minute
    CHALLENGE: { window: 300000, max: 5 }, // 5 challenges per 5 minutes
    REPORT: { window: 3600000, max: 3 }, // 3 reports per hour
    MATCH: { window: 3600000, max: 10 }, // 10 matches per hour
    QUEUE: { window: 60000, max: 20 } // 20 queue joins per minute
};

// Abuse detection thresholds
const ABUSE_THRESHOLDS = {
    DISPUTE_RATIO: 0.3, // 30% of matches disputed
    REPORT_RATIO: 0.2, // 20% of matches reported
    LEAVE_RATIO: 0.15, // 15% of matches left
    SCORE_MISMATCH_RATIO: 0.25 // 25% of matches with score mismatches
};

// Performance monitoring thresholds (in milliseconds)
const PERFORMANCE_THRESHOLDS = {
    COMMAND_EXECUTION: 1000,
    DATABASE_QUERY: 500,
    API_CALL: 2000,
    MATCH_CREATION: 3000
};

class ErrorManager {
    constructor(client) {
        this.client = client;
        this.rateLimits = new Map(); // Map of userId -> { command: { count: number, reset: timestamp } }
        this.performanceMetrics = new Map(); // Map of operation -> { count: number, totalTime: number, maxTime: number }
        this.abuseMetrics = new Map(); // Map of userId -> { disputes: number, reports: number, leaves: number, scoreMismatches: number, totalMatches: number }
        this.errorCounts = new Map(); // Map of errorType -> count
        this.lastCleanup = Date.now();
        this.CLEANUP_INTERVAL = 3600000; // 1 hour
    }

    // Rate limiting
    async checkRateLimit(userId, type) {
        const now = Date.now();
        const limit = RATE_LIMITS[type];
        
        if (!this.rateLimits.has(userId)) {
            this.rateLimits.set(userId, new Map());
        }

        const userLimits = this.rateLimits.get(userId);
        if (!userLimits.has(type)) {
            userLimits.set(type, { count: 0, reset: now + limit.window });
        }

        const userLimit = userLimits.get(type);
        if (now > userLimit.reset) {
            userLimit.count = 0;
            userLimit.reset = now + limit.window;
        }

        userLimit.count++;
        return userLimit.count <= limit.max;
    }

    // Performance monitoring
    async trackPerformance(operation, startTime) {
        const duration = Date.now() - startTime;
        const threshold = PERFORMANCE_THRESHOLDS[operation];

        if (!this.performanceMetrics.has(operation)) {
            this.performanceMetrics.set(operation, { count: 0, totalTime: 0, maxTime: 0 });
        }

        const metric = this.performanceMetrics.get(operation);
        metric.count++;
        metric.totalTime += duration;
        metric.maxTime = Math.max(metric.maxTime, duration);

        if (duration > threshold) {
            logger.warn(`Performance warning: ${operation} took ${duration}ms (threshold: ${threshold}ms)`);
            await this.notifyPerformanceIssue(operation, duration);
        }

        return duration;
    }

    // Abuse detection
    async trackUserAction(userId, action) {
        if (!this.abuseMetrics.has(userId)) {
            this.abuseMetrics.set(userId, {
                disputes: 0,
                reports: 0,
                leaves: 0,
                scoreMismatches: 0,
                totalMatches: 0
            });
        }

        const metrics = this.abuseMetrics.get(userId);
        metrics[action]++;
        metrics.totalMatches++;

        // Check for abuse patterns
        const ratios = {
            dispute: metrics.disputes / metrics.totalMatches,
            report: metrics.reports / metrics.totalMatches,
            leave: metrics.leaves / metrics.totalMatches,
            scoreMismatch: metrics.scoreMismatches / metrics.totalMatches
        };

        for (const [type, ratio] of Object.entries(ratios)) {
            if (ratio > ABUSE_THRESHOLDS[`${type.toUpperCase()}_RATIO`]) {
                await this.handleAbuseDetection(userId, type, ratio);
            }
        }
    }

    // Error tracking
    async trackError(error, context = {}) {
        const errorType = error.name || 'UnknownError';
        this.errorCounts.set(errorType, (this.errorCounts.get(errorType) || 0) + 1);

        // Log error with context
        logger.error('Error occurred:', {
            error: error.message,
            stack: error.stack,
            type: errorType,
            context
        });

        // Check if cleanup is needed
        if (Date.now() - this.lastCleanup > this.CLEANUP_INTERVAL) {
            await this.cleanup();
        }

        // Notify if critical error
        if (this.isCriticalError(error)) {
            await this.notifyCriticalError(error, context);
        }
    }

    // Anti-abuse measures
    async handleAbuseDetection(userId, type, ratio) {
        const user = await this.client.users.fetch(userId).catch(() => null);
        if (!user) return;

        const embed = new EmbedBuilder()
            .setTitle('Abuse Detection Alert')
            .setColor('#FF0000')
            .setDescription(`User ${user.tag} (${userId}) has shown potential abuse patterns:`)
            .addFields([
                { name: 'Type', value: type, inline: true },
                { name: 'Ratio', value: `${(ratio * 100).toFixed(1)}%`, inline: true },
                { name: 'Threshold', value: `${(ABUSE_THRESHOLDS[`${type.toUpperCase()}_RATIO`] * 100).toFixed(1)}%`, inline: true }
            ])
            .setTimestamp();

        // Notify moderators
        const owner = await this.client.users.fetch('816854656097583135');
        if (owner) {
            await owner.send({ embeds: [embed] }).catch(() => {});
        }

        // Log abuse detection
        logger.warn('Abuse detection:', {
            userId,
            type,
            ratio,
            threshold: ABUSE_THRESHOLDS[`${type.toUpperCase()}_RATIO`]
        });

        // Take action based on severity
        if (ratio > ABUSE_THRESHOLDS[`${type.toUpperCase()}_RATIO`] * 2) {
            await this.applyAbusePenalty(userId, type);
        }
    }

    async applyAbusePenalty(userId, type) {
        const penalties = {
            dispute: { rep: -100, message: 'Excessive disputes' },
            report: { rep: -150, message: 'Excessive reports' },
            leave: { rep: -200, message: 'Excessive match leaving' },
            scoreMismatch: { rep: -250, message: 'Excessive score mismatches' }
        };

        const penalty = penalties[type];
        if (!penalty) return;

        try {
            // Apply penalty
            await this.client.db.collection('users').updateOne(
                { _id: userId },
                { $inc: { rep: penalty.rep } }
            );

            // Log penalty
            logger.info('Applied abuse penalty:', {
                userId,
                type,
                penalty: penalty.rep,
                reason: penalty.message
            });

            // Notify user
            const user = await this.client.users.fetch(userId);
            if (user) {
                await user.send({
                    content: `You have received a penalty of ${penalty.rep} rep for ${penalty.message}.`
                }).catch(() => {});
            }
        } catch (error) {
            logger.error('Error applying abuse penalty:', error);
        }
    }

    // Performance notifications
    async notifyPerformanceIssue(operation, duration) {
        const embed = new EmbedBuilder()
            .setTitle('Performance Warning')
            .setColor('#FFA500')
            .setDescription(`Operation ${operation} is taking longer than expected:`)
            .addFields([
                { name: 'Duration', value: `${duration}ms`, inline: true },
                { name: 'Threshold', value: `${PERFORMANCE_THRESHOLDS[operation]}ms`, inline: true }
            ])
            .setTimestamp();

        // Notify owner
        const owner = await this.client.users.fetch('816854656097583135');
        if (owner) {
            await owner.send({ embeds: [embed] }).catch(() => {});
        }
    }

    // Critical error notifications
    async notifyCriticalError(error, context) {
        const embed = new EmbedBuilder()
            .setTitle('Critical Error Alert')
            .setColor('#FF0000')
            .setDescription('A critical error has occurred:')
            .addFields([
                { name: 'Error', value: error.message, inline: false },
                { name: 'Type', value: error.name || 'Unknown', inline: true },
                { name: 'Context', value: JSON.stringify(context, null, 2), inline: false }
            ])
            .setTimestamp();

        // Notify owner
        const owner = await this.client.users.fetch('816854656097583135');
        if (owner) {
            await owner.send({ embeds: [embed] }).catch(() => {});
        }
    }

    // Cleanup routine
    async cleanup() {
        const now = Date.now();

        // Cleanup rate limits
        for (const [userId, limits] of this.rateLimits) {
            for (const [type, limit] of limits) {
                if (now > limit.reset) {
                    limits.delete(type);
                }
            }
            if (limits.size === 0) {
                this.rateLimits.delete(userId);
            }
        }

        // Reset performance metrics
        this.performanceMetrics.clear();

        // Archive old abuse metrics
        for (const [userId, metrics] of this.abuseMetrics) {
            if (metrics.totalMatches > 100) {
                // Archive metrics older than 30 days
                await this.client.db.collection('abuseMetrics').insertOne({
                    userId,
                    ...metrics,
                    archivedAt: new Date()
                });
                this.abuseMetrics.delete(userId);
            }
        }

        // Reset error counts
        this.errorCounts.clear();

        this.lastCleanup = now;
        logger.info('ErrorManager cleanup completed');
    }

    // Utility methods
    isCriticalError(error) {
        const criticalErrors = [
            'DatabaseError',
            'AuthenticationError',
            'RateLimitError',
            'DiscordAPIError'
        ];
        return criticalErrors.includes(error.name);
    }

    // Get metrics for monitoring
    getMetrics() {
        return {
            rateLimits: Array.from(this.rateLimits.entries()).length,
            performanceMetrics: Object.fromEntries(this.performanceMetrics),
            abuseMetrics: Array.from(this.abuseMetrics.entries()).length,
            errorCounts: Object.fromEntries(this.errorCounts)
        };
    }
}

module.exports = ErrorManager; 