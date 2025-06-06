const mongoose = require('mongoose');

const badgeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    badgeId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    description: {
        type: String,
        required: true,
        maxlength: 1000
    },
    emoji: {
        type: String,
        required: true
    },
    
    // Badge Type
    type: {
        type: String,
        enum: ['ACHIEVEMENT', 'CHALLENGE', 'MASTERY', 'WINSTREAK', 'EVENT'],
        required: true
    },
    
    // Variant Information (for badges that have variants)
    variant: {
        isVariant: {
            type: Boolean,
            default: false
        },
        baseBadge: {
            type: String,
            ref: 'Badge'
        },
        variantLevel: {
            type: Number,
            min: 1
        }
    },
    
    // Mastery Information (for team mastery badges)
    mastery: {
        team: {
            type: String,
            enum: [
                'Mario', 'Luigi', 'Peach', 'Daisy', 'Yoshi', 'Birdo',
                'Wario', 'Waluigi', 'Donkey Kong', 'Diddy Kong',
                'Bowser', 'Bowser Jr.'
            ]
        },
        level: {
            type: String,
            enum: ['BRONZE', 'SILVER', 'GOLD']
        },
        requiredPoints: {
            type: Number,
            required: true
        }
    },
    
    // Win Streak Information (for win streak badges)
    winStreak: {
        requiredStreak: {
            type: Number,
            min: 1
        }
    },
    
    // Statistics
    stats: {
        totalAwarded: {
            type: Number,
            default: 0
        },
        currentHolders: {
            type: Number,
            default: 0
        }
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Indexes
badgeSchema.index({ badgeId: 1 });
badgeSchema.index({ type: 1 });
badgeSchema.index({ 'mastery.team': 1, 'mastery.level': 1 });
badgeSchema.index({ 'winStreak.requiredStreak': 1 });

// Methods
badgeSchema.methods.award = async function(userId) {
    const User = mongoose.model('User');
    
    // Check if user already has this badge
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }
    
    if (user.badges.includes(this.badgeId)) {
        throw new Error('User already has this badge');
    }
    
    // If this is a variant badge, remove the previous variant
    if (this.variant.isVariant) {
        const baseBadge = await this.constructor.findById(this.variant.baseBadge);
        if (!baseBadge) {
            throw new Error('Base badge not found');
        }
        
        // Find and remove any variants of this badge that the user has
        const variants = await this.constructor.find({
            'variant.baseBadge': this.variant.baseBadge,
            'variant.isVariant': true
        });
        
        for (const variant of variants) {
            const variantIndex = user.badges.indexOf(variant.badgeId);
            if (variantIndex !== -1) {
                user.badges.splice(variantIndex, 1);
                variant.stats.currentHolders--;
                await variant.save();
            }
        }
    }
    
    // Add the badge
    user.badges.push(this.badgeId);
    await user.save();
    
    // Update badge stats
    this.stats.totalAwarded++;
    this.stats.currentHolders++;
    this.updatedAt = new Date();
    await this.save();
};

badgeSchema.methods.revoke = async function(userId) {
    const User = mongoose.model('User');
    
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }
    
    const badgeIndex = user.badges.indexOf(this.badgeId);
    if (badgeIndex === -1) {
        throw new Error('User does not have this badge');
    }
    
    user.badges.splice(badgeIndex, 1);
    await user.save();
    
    this.stats.currentHolders--;
    this.updatedAt = new Date();
    await this.save();
};

badgeSchema.methods.checkMasteryEligibility = async function(userId) {
    if (this.type !== 'MASTERY' || !this.mastery.team) {
        throw new Error('Not a mastery badge');
    }
    
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }
    
    return user.teamMastery[this.mastery.team] >= this.mastery.requiredPoints;
};

badgeSchema.methods.checkWinStreakEligibility = async function(userId) {
    if (this.type !== 'WINSTREAK' || !this.winStreak.requiredStreak) {
        throw new Error('Not a win streak badge');
    }
    
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }
    
    return user.winStreak >= this.winStreak.requiredStreak;
};

const Badge = mongoose.model('Badge', badgeSchema);

module.exports = Badge; 