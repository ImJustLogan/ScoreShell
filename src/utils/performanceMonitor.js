const logger = require('./logger');

// Performance metrics storage
const metrics = {
    queue: {
        totalJoins: 0,
        totalLeaves: 0,
        averageWaitTime: 0,
        waitTimeSamples: [],
        regionDistribution: new Map(),
        rankDistribution: new Map(),
        matchmakingAttempts: 0,
        successfulMatches: 0,
        failedMatches: 0,
        crossRegionMatches: 0
    },
    matchmaking: {
        averageMatchScore: 0,
        matchScoreSamples: [],
        averageMatchmakingTime: 0,
        matchmakingTimeSamples: [],
        regionMatches: new Map(),
        rankMatches: new Map(),
        hyperchargedMatches: 0
    },
    matches: {
        totalMatches: 0,
        completedMatches: 0,
        cancelledMatches: 0,
        disputedMatches: 0,
        averageMatchDuration: 0,
        matchDurationSamples: [],
        averageRepChange: 0,
        repChangeSamples: []
    },
    errors: {
        queueErrors: 0,
        matchmakingErrors: 0,
        matchErrors: 0,
        networkErrors: 0,
        databaseErrors: 0,
        errorTypes: new Map()
    }
};

// Constants for metrics
const METRICS_CONFIG = {
    MAX_SAMPLES: 1000,
    REPORT_INTERVAL: 300000, // 5 minutes
    CLEANUP_INTERVAL: 3600000, // 1 hour
    ERROR_THRESHOLD: 10, // Number of errors before alert
    PERFORMANCE_THRESHOLD: {
        MAX_AVG_WAIT_TIME: 300000, // 5 minutes
        MAX_AVG_MATCHMAKING_TIME: 30000, // 30 seconds
        MIN_MATCH_SUCCESS_RATE: 0.8 // 80%
    }
};

/**
 * Record a queue join
 * @param {string} userId - User ID
 * @param {string} region - User's region
 * @param {string} rank - User's rank
 */
function recordQueueJoin(userId, region, rank) {
    metrics.queue.totalJoins++;
    metrics.queue.regionDistribution.set(region, (metrics.queue.regionDistribution.get(region) || 0) + 1);
    metrics.queue.rankDistribution.set(rank, (metrics.queue.rankDistribution.get(rank) || 0) + 1);
}

/**
 * Record a queue leave
 * @param {string} userId - User ID
 * @param {number} waitTime - Time spent in queue
 */
function recordQueueLeave(userId, waitTime) {
    metrics.queue.totalLeaves++;
    metrics.queue.waitTimeSamples.push(waitTime);
    if (metrics.queue.waitTimeSamples.length > METRICS_CONFIG.MAX_SAMPLES) {
        metrics.queue.waitTimeSamples.shift();
    }
    metrics.queue.averageWaitTime = calculateAverage(metrics.queue.waitTimeSamples);
}

/**
 * Record a matchmaking attempt
 * @param {Object} match - Match data
 * @param {number} matchScore - Match score
 * @param {number} matchmakingTime - Time taken to find match
 * @param {boolean} isCrossRegion - Whether match is cross-region
 */
function recordMatchmakingAttempt(match, matchScore, matchmakingTime, isCrossRegion) {
    metrics.queue.matchmakingAttempts++;
    metrics.matchmaking.matchScoreSamples.push(matchScore);
    metrics.matchmaking.matchmakingTimeSamples.push(matchmakingTime);
    
    if (isCrossRegion) {
        metrics.queue.crossRegionMatches++;
    }

    // Update averages
    if (metrics.matchmaking.matchScoreSamples.length > METRICS_CONFIG.MAX_SAMPLES) {
        metrics.matchmaking.matchScoreSamples.shift();
    }
    if (metrics.matchmaking.matchmakingTimeSamples.length > METRICS_CONFIG.MAX_SAMPLES) {
        metrics.matchmaking.matchmakingTimeSamples.shift();
    }

    metrics.matchmaking.averageMatchScore = calculateAverage(metrics.matchmaking.matchScoreSamples);
    metrics.matchmaking.averageMatchmakingTime = calculateAverage(metrics.matchmaking.matchmakingTimeSamples);

    // Record region and rank matches
    const regionKey = `${match.player1.region}-${match.player2.region}`;
    const rankKey = `${match.player1.rank}-${match.player2.rank}`;
    
    metrics.matchmaking.regionMatches.set(regionKey, (metrics.matchmaking.regionMatches.get(regionKey) || 0) + 1);
    metrics.matchmaking.rankMatches.set(rankKey, (metrics.matchmaking.rankMatches.get(rankKey) || 0) + 1);
}

/**
 * Record a match completion
 * @param {Object} match - Match data
 * @param {Object} outcome - Match outcome
 */
function recordMatchCompletion(match, outcome) {
    metrics.matches.totalMatches++;
    metrics.matches.completedMatches++;
    
    const matchDuration = match.endTime - match.startTime;
    metrics.matches.matchDurationSamples.push(matchDuration);
    if (metrics.matches.matchDurationSamples.length > METRICS_CONFIG.MAX_SAMPLES) {
        metrics.matches.matchDurationSamples.shift();
    }
    metrics.matches.averageMatchDuration = calculateAverage(metrics.matches.matchDurationSamples);

    // Record rep changes
    const repChanges = [outcome.player1RepChange, outcome.player2RepChange];
    metrics.matches.repChangeSamples.push(...repChanges);
    if (metrics.matches.repChangeSamples.length > METRICS_CONFIG.MAX_SAMPLES) {
        metrics.matches.repChangeSamples = metrics.matches.repChangeSamples.slice(-METRICS_CONFIG.MAX_SAMPLES);
    }
    metrics.matches.averageRepChange = calculateAverage(metrics.matches.repChangeSamples);

    if (match.isHypercharged) {
        metrics.matchmaking.hyperchargedMatches++;
    }
}

/**
 * Record an error
 * @param {string} type - Error type
 * @param {Error} error - Error object
 */
function recordError(type, error) {
    metrics.errors[`${type}Errors`]++;
    const errorType = error.name || 'Unknown';
    metrics.errors.errorTypes.set(errorType, (metrics.errors.errorTypes.get(errorType) || 0) + 1);

    // Check if we need to alert
    if (metrics.errors[`${type}Errors`] >= METRICS_CONFIG.ERROR_THRESHOLD) {
        logger.warn(`High number of ${type} errors detected: ${metrics.errors[`${type}Errors`]}`);
    }
}

/**
 * Generate performance report
 * @returns {Object} Performance report
 */
function generateReport() {
    const report = {
        timestamp: new Date(),
        queue: {
            totalJoins: metrics.queue.totalJoins,
            totalLeaves: metrics.queue.totalLeaves,
            averageWaitTime: metrics.queue.averageWaitTime,
            matchmakingSuccessRate: metrics.queue.matchmakingAttempts > 0 
                ? metrics.queue.successfulMatches / metrics.queue.matchmakingAttempts 
                : 0,
            regionDistribution: Object.fromEntries(metrics.queue.regionDistribution),
            rankDistribution: Object.fromEntries(metrics.queue.rankDistribution),
            crossRegionMatchRate: metrics.queue.matchmakingAttempts > 0
                ? metrics.queue.crossRegionMatches / metrics.queue.matchmakingAttempts
                : 0
        },
        matchmaking: {
            averageMatchScore: metrics.matchmaking.averageMatchScore,
            averageMatchmakingTime: metrics.matchmaking.averageMatchmakingTime,
            regionMatches: Object.fromEntries(metrics.matchmaking.regionMatches),
            rankMatches: Object.fromEntries(metrics.matchmaking.rankMatches),
            hyperchargedMatchRate: metrics.matches.totalMatches > 0
                ? metrics.matchmaking.hyperchargedMatches / metrics.matches.totalMatches
                : 0
        },
        matches: {
            totalMatches: metrics.matches.totalMatches,
            completedMatches: metrics.matches.completedMatches,
            cancelledMatches: metrics.matches.cancelledMatches,
            disputedMatches: metrics.matches.disputedMatches,
            averageMatchDuration: metrics.matches.averageMatchDuration,
            averageRepChange: metrics.matches.averageRepChange,
            completionRate: metrics.matches.totalMatches > 0
                ? metrics.matches.completedMatches / metrics.matches.totalMatches
                : 0
        },
        errors: {
            totalErrors: Object.values(metrics.errors).reduce((sum, val) => 
                typeof val === 'number' ? sum + val : sum, 0),
            errorTypes: Object.fromEntries(metrics.errors.errorTypes)
        }
    };

    // Check performance thresholds
    const alerts = [];
    if (metrics.queue.averageWaitTime > METRICS_CONFIG.PERFORMANCE_THRESHOLD.MAX_AVG_WAIT_TIME) {
        alerts.push('High average queue wait time');
    }
    if (metrics.matchmaking.averageMatchmakingTime > METRICS_CONFIG.PERFORMANCE_THRESHOLD.MAX_AVG_MATCHMAKING_TIME) {
        alerts.push('High average matchmaking time');
    }
    if (report.queue.matchmakingSuccessRate < METRICS_CONFIG.PERFORMANCE_THRESHOLD.MIN_MATCH_SUCCESS_RATE) {
        alerts.push('Low matchmaking success rate');
    }

    if (alerts.length > 0) {
        report.alerts = alerts;
    }

    return report;
}

/**
 * Calculate average of numbers
 * @param {number[]} numbers - Array of numbers
 * @returns {number} Average
 */
function calculateAverage(numbers) {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
}

/**
 * Start performance monitoring
 */
function startMonitoring() {
    // Generate periodic reports
    setInterval(() => {
        const report = generateReport();
        logger.info('Performance Report:', report);
        
        // Alert on performance issues
        if (report.alerts) {
            logger.warn('Performance Alerts:', report.alerts);
        }
    }, METRICS_CONFIG.REPORT_INTERVAL);

    // Cleanup old metrics
    setInterval(() => {
        // Reset error counts
        Object.keys(metrics.errors).forEach(key => {
            if (typeof metrics.errors[key] === 'number') {
                metrics.errors[key] = 0;
            }
        });
        metrics.errors.errorTypes.clear();

        // Trim samples to max size
        Object.keys(metrics).forEach(category => {
            Object.keys(metrics[category]).forEach(key => {
                if (Array.isArray(metrics[category][key])) {
                    metrics[category][key] = metrics[category][key].slice(-METRICS_CONFIG.MAX_SAMPLES);
                }
            });
        });
    }, METRICS_CONFIG.CLEANUP_INTERVAL);
}

module.exports = {
    recordQueueJoin,
    recordQueueLeave,
    recordMatchmakingAttempt,
    recordMatchCompletion,
    recordError,
    generateReport,
    startMonitoring
}; 