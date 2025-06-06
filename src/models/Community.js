const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: function(v) {
                return /^[a-zA-Z0-9]{3,5}$/.test(v);
            },
            message: 'Community code must be 3-5 alphanumeric characters'
        }
    },
    inviteLink: {
        type: String,
        required: true
    },
    adminRoleId: {
        type: String,
        required: true
    },
    channels: {
        rankedRules: {
            type: String,
            required: true
        },
        rankedQueue: {
            type: String,
            required: true
        },
        adminLog: {
            type: String,
            required: true
        },
        matchLog: {
            type: String,
            required: false
        }
    },
    categories: {
        ranked: {
            type: String,
            required: true
        }
    },
    settings: {
        logMatches: {
            type: Boolean,
            default: false
        },
        setupComplete: {
            type: Boolean,
            default: false
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update the updatedAt timestamp before saving
communitySchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Static method to validate community code
communitySchema.statics.isValidCode = async function(code) {
    if (!/^[a-zA-Z0-9]{3,5}$/.test(code)) {
        return false;
    }
    const existing = await this.findOne({ code });
    return !existing;
};

const Community = mongoose.model('Community', communitySchema);

module.exports = Community; 