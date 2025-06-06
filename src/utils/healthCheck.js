const logger = require('./logger');

class HealthCheck {
    constructor(client) {
        this.client = client;
        this.db = client.db;
        this.lastCheck = null;
        this.isHealthy = true;
        this.checkInterval = 30000; // 30 seconds
        this.retryAttempts = 3;
        this.retryDelay = 5000; // 5 seconds
    }

    async start() {
        logger.info('Starting health check service...');
        this.interval = setInterval(() => this.check(), this.checkInterval);
        await this.check(); // Initial check
    }

    async stop() {
        if (this.interval) {
            clearInterval(this.interval);
            logger.info('Health check service stopped');
        }
    }

    async check() {
        try {
            const startTime = Date.now();
            const result = await this.db.command({ ping: 1 });
            const latency = Date.now() - startTime;

            this.lastCheck = {
                timestamp: new Date(),
                latency,
                status: 'healthy',
                details: {
                    serverStatus: result.ok === 1 ? 'ok' : 'error',
                    latency: `${latency}ms`
                }
            };

            // Update health status
            this.isHealthy = true;

            // Log if latency is high
            if (latency > 1000) {
                logger.warn(`High database latency: ${latency}ms`);
            }

            // Store health check result
            await this.storeHealthCheckResult();

            return this.lastCheck;
        } catch (error) {
            this.isHealthy = false;
            this.lastCheck = {
                timestamp: new Date(),
                status: 'unhealthy',
                error: error.message
            };

            logger.error('Database health check failed:', error);
            await this.handleHealthCheckFailure();
            await this.storeHealthCheckResult();

            return this.lastCheck;
        }
    }

    async storeHealthCheckResult() {
        try {
            await this.db.collection('healthChecks').insertOne({
                ...this.lastCheck,
                botId: this.client.user.id
            });

            // Clean up old health check records (keep last 24 hours)
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
            await this.db.collection('healthChecks').deleteMany({
                timestamp: { $lt: cutoff }
            });
        } catch (error) {
            logger.error('Error storing health check result:', error);
        }
    }

    async handleHealthCheckFailure() {
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                logger.info(`Attempting to reconnect to database (attempt ${attempt}/${this.retryAttempts})...`);
                await this.client.connectWithRetry();
                
                // Verify connection
                await this.db.command({ ping: 1 });
                logger.info('Successfully reconnected to database');
                this.isHealthy = true;
                return;
            } catch (error) {
                logger.error(`Reconnection attempt ${attempt} failed:`, error);
                if (attempt < this.retryAttempts) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }

        // If all retry attempts failed, notify administrators
        await this.notifyAdministrators();
    }

    async notifyAdministrators() {
        try {
            const adminChannel = this.client.channels.cache.get(process.env.ADMIN_CHANNEL_ID);
            if (adminChannel) {
                await adminChannel.send({
                    content: '⚠️ **Database Connection Alert**\n' +
                        'The bot has lost connection to the database and all retry attempts have failed.\n' +
                        'Please check the database server status and bot logs for more information.'
                });
            }
        } catch (error) {
            logger.error('Error notifying administrators:', error);
        }
    }

    getStatus() {
        return {
            isHealthy: this.isHealthy,
            lastCheck: this.lastCheck,
            uptime: this.client.uptime,
            memoryUsage: process.memoryUsage(),
            commandStats: this.getCommandStats()
        };
    }

    async getCommandStats() {
        try {
            const stats = await this.db.collection('commandUsage').aggregate([
                {
                    $group: {
                        _id: '$commandName',
                        totalUses: { $sum: 1 },
                        successfulUses: {
                            $sum: { $cond: ['$success', 1, 0] }
                        },
                        failedUses: {
                            $sum: { $cond: ['$success', 0, 1] }
                        },
                        lastUsed: { $max: '$timestamp' }
                    }
                },
                {
                    $project: {
                        commandName: '$_id',
                        totalUses: 1,
                        successfulUses: 1,
                        failedUses: 1,
                        successRate: {
                            $multiply: [
                                { $divide: ['$successfulUses', '$totalUses'] },
                                100
                            ]
                        },
                        lastUsed: 1,
                        _id: 0
                    }
                }
            ]).toArray();

            return stats;
        } catch (error) {
            logger.error('Error getting command stats:', error);
            return [];
        }
    }
}

module.exports = HealthCheck; 