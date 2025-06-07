const { logger } = require('./logger');
const mongoose = require('mongoose');

class HealthCheck {
    constructor(client) {
        this.client = client;
        this.isRunning = false;
        this.interval = null;
        this.lastCheck = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.reconnectDelay = 5000; // 5 seconds
    }

    async start() {
        if (this.isRunning) {
            logger.warn('Health check service is already running');
            return;
        }

        logger.info('Starting health check service...');
        this.isRunning = true;
        this.interval = setInterval(() => this.checkHealth(), 30000); // Check every 30 seconds
    }

    async stop() {
        if (!this.isRunning) {
            return;
        }

        logger.info('Stopping health check service...');
        clearInterval(this.interval);
        this.isRunning = false;
        this.interval = null;
    }

    async checkHealth() {
        try {
            this.lastCheck = new Date();
            const results = {
                timestamp: this.lastCheck,
                status: 'healthy',
                checks: {}
            };

            // Check database connection
            try {
                const dbStatus = await this.checkDatabaseHealth();
                results.checks.database = dbStatus;
            } catch (error) {
                logger.error('Database health check failed:', error);
                results.checks.database = {
                    status: 'unhealthy',
                    error: error.message
                };
                results.status = 'degraded';
            }

            // Store health check results
            await this.storeHealthCheckResult(results);

            return results;
        } catch (error) {
            logger.error('Health check failed:', error);
            throw error;
        }
    }

    async checkDatabaseHealth() {
        try {
            // Check if mongoose is connected
            if (mongoose.connection.readyState !== 1) {
                throw new Error('Database not connected');
            }

            // Run a simple query to verify connection
            await mongoose.connection.db.admin().ping();
            
            return {
                status: 'healthy',
                message: 'Database connection is healthy'
            };
        } catch (error) {
            logger.error('Database health check failed:', error);
            
            // Attempt to reconnect
            await this.attemptReconnect();
            
            throw error;
        }
    }

    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        logger.info(`Attempting to reconnect to database (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        try {
            await mongoose.connect(process.env.MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
            
            logger.info('Successfully reconnected to database');
            this.reconnectAttempts = 0;
        } catch (error) {
            logger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
            
            // Schedule next attempt
            setTimeout(() => this.attemptReconnect(), this.reconnectDelay);
        }
    }

    async storeHealthCheckResult(result) {
        try {
            const collection = mongoose.connection.db.collection('health_checks');
            await collection.insertOne(result);
        } catch (error) {
            logger.error('Error storing health check result:', error);
        }
    }

    getLastCheck() {
        return this.lastCheck;
    }

    isServiceRunning() {
        return this.isRunning;
    }
}

module.exports = HealthCheck; 
module.exports = HealthCheck; 