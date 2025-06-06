const mongoose = require('mongoose');

const serverSettingsSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    adminRoleId: {
        type: String,
        default: null
    },
    logChannelId: {
        type: String,
        default: null
    },
    reportChannelId: {
        type: String,
        default: null
    },
    matchLogsEnabled: {
        type: Boolean,
        default: false
    },
    autoModEnabled: {
        type: Boolean,
        default: false
    },
    reportThreshold: {
        type: Number,
        default: 3,
        min: 1,
        max: 10
    },
    banThreshold: {
        type: Number,
        default: 5,
        min: 1,
        max: 20
    },
    reportCooldown: {
        type: Number,
        default: 3600, // 1 hour in seconds
        min: 300, // 5 minutes
        max: 86400 // 24 hours
    },
    banDuration: {
        type: Number,
        default: 604800, // 1 week in seconds
        min: 3600, // 1 hour
        max: 31536000 // 1 year
    }
}, {
    timestamps: true
});

// Index for efficient querying
serverSettingsSchema.index({ guildId: 1 });

module.exports = mongoose.model('ServerSettings', serverSettingsSchema); 