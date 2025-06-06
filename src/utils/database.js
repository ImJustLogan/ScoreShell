const mongoose = require('mongoose');
const config = require('../config/config');
const logger = require('./logger');

class Database {
    constructor() {
        this.isConnected = false;
        this.connection = null;
    }

    async connect() {
        if (this.isConnected) {
            logger.info('Using existing database connection');
            return;
        }

        try {
            // Set mongoose options
            mongoose.set('strictQuery', true);
            
            // Connect to MongoDB
            this.connection = await mongoose.connect(config.mongoUri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });

            this.isConnected = true;
            logger.info('Successfully connected to MongoDB');

            // Handle connection events
            mongoose.connection.on('error', (err) => {
                logger.error('MongoDB connection error:', err);
                this.isConnected = false;
            });

            mongoose.connection.on('disconnected', () => {
                logger.warn('MongoDB disconnected');
                this.isConnected = false;
            });

            mongoose.connection.on('reconnected', () => {
                logger.info('MongoDB reconnected');
                this.isConnected = true;
            });

        } catch (error) {
            logger.error('Error connecting to MongoDB:', error);
            throw error;
        }
    }

    async disconnect() {
        if (!this.isConnected) {
            return;
        }

        try {
            await mongoose.disconnect();
            this.isConnected = false;
            logger.info('Successfully disconnected from MongoDB');
        } catch (error) {
            logger.error('Error disconnecting from MongoDB:', error);
            throw error;
        }
    }

    // Utility function to check if database is healthy
    async healthCheck() {
        if (!this.isConnected) {
            return false;
        }

        try {
            await mongoose.connection.db.admin().ping();
            return true;
        } catch (error) {
            logger.error('Database health check failed:', error);
            return false;
        }
    }

    // Utility function to clear all collections (for testing)
    async clearAllCollections() {
        if (process.env.NODE_ENV !== 'test') {
            throw new Error('clearAllCollections can only be used in test environment');
        }

        const collections = mongoose.connection.collections;
        for (const key in collections) {
            await collections[key].deleteMany();
        }
    }

    // Utility function to get collection stats
    async getCollectionStats() {
        const stats = {};
        const collections = mongoose.connection.collections;

        for (const [name, collection] of Object.entries(collections)) {
            stats[name] = await collection.stats();
        }

        return stats;
    }

    // Utility function to create indexes for all models
    async createIndexes() {
        const models = mongoose.models;
        for (const [name, model] of Object.entries(models)) {
            try {
                await model.createIndexes();
                logger.info(`Created indexes for ${name} model`);
            } catch (error) {
                logger.error(`Error creating indexes for ${name} model:`, error);
            }
        }
    }
}

// Create and export a singleton instance
const database = new Database();
module.exports = database; 