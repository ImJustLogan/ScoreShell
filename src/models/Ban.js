const mongoose = require('mongoose');

const banSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true
    },
    guildId: {
        type: String,
        required: false,
        index: true
    },
    moderatorId: {
        type: String,
        required: true
    },
    reason: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['SERVER', 'GLOBAL']
    },
    expiresAt: {
        type: Date,
        default: null
    },
    unbannedBy: {
        type: String,
        default: null
    },
    unbanReason: {
        type: String,
        default: null
    },
    unbannedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
banSchema.index({ userId: 1, guildId: 1, expiresAt: 1 });
banSchema.index({ type: 1, expiresAt: 1 });

// Virtual for checking if ban is active
banSchema.virtual('isActive').get(function() {
    return !this.unbannedAt && (!this.expiresAt || this.expiresAt > new Date());
});

module.exports = mongoose.model('Ban', banSchema); 