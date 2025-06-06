const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        index: true
    },
    reporterId: {
        type: String,
        required: true
    },
    targetId: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: ['HARASSMENT', 'LEAVING', 'CONNECTION', 'CHEATING']
    },
    reason: {
        type: String,
        required: true
    },
    evidence: {
        type: String,
        default: null
    },
    status: {
        type: String,
        required: true,
        enum: ['PENDING', 'APPROVED', 'DENIED', 'BANNED'],
        default: 'PENDING'
    },
    priority: {
        type: Number,
        required: true,
        min: 1,
        max: 3
    },
    moderatorId: {
        type: String,
        default: null
    },
    moderatorNotes: {
        type: String,
        default: null
    },
    resolvedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
reportSchema.index({ guildId: 1, status: 1 });
reportSchema.index({ targetId: 1, createdAt: -1 });
reportSchema.index({ reporterId: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema); 