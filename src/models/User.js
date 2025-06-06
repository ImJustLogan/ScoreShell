const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    discordId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true
    },
    discriminator: {
        type: String,
        required: true
    },
    avatar: String,
    
    // Rank Information
    rank: {
        type: String,
        enum: ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND', 'MYTHIC', 'LEGENDARY', 'MASTERS'],
        default: 'BRONZE'
    },
    tier: {
        type: String,
        enum: ['I', 'II', 'III'],
        default: 'I'
    },
    rep: {
        type: Number,
        default: 0,
        min: 0
    },
    winStreak: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Club Information
    club: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Club',
        default: null
    },
    clubRole: {
        type: String,
        enum: ['MEMBER', 'CAPTAIN', 'OWNER'],
        default: 'MEMBER'
    },
    clubTickets: {
        type: Number,
        default: 7,
        min: 0,
        max: 7
    },
    
    // Settings
    settings: {
        allowDuelRequests: {
            type: Boolean,
            default: true
        },
        mainCommunity: {
            type: String,
            default: null
        },
        region: {
            type: String,
            default: 'US-East'
        }
    },
    
    // Badges
    badges: [{
        type: String,
        ref: 'Badge'
    }],
    
    // Team Mastery
    teamMastery: {
        Mario: { type: Number, default: 0 },
        Luigi: { type: Number, default: 0 },
        Peach: { type: Number, default: 0 },
        Daisy: { type: Number, default: 0 },
        Yoshi: { type: Number, default: 0 },
        Birdo: { type: Number, default: 0 },
        Wario: { type: Number, default: 0 },
        Waluigi: { type: Number, default: 0 },
        'Donkey Kong': { type: Number, default: 0 },
        'Diddy Kong': { type: Number, default: 0 },
        Bowser: { type: Number, default: 0 },
        'Bowser Jr.': { type: Number, default: 0 }
    },
    
    // Active Challenge
    activeChallenge: {
        challengeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Challenge',
            default: null
        },
        wins: {
            type: Number,
            default: 0
        },
        lives: {
            type: Number,
            default: 3
        },
        startTime: Date
    },
    
    // Active Match
    activeMatch: {
        matchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Match',
            default: null
        },
        isHost: {
            type: Boolean,
            default: false
        },
        captain: String,
        stage: String,
        startTime: Date
    },
    
    // Queue Status
    inQueue: {
        type: Boolean,
        default: false
    },
    queueStartTime: Date,
    
    // Statistics
    stats: {
        matchesPlayed: { type: Number, default: 0 },
        matchesWon: { type: Number, default: 0 },
        matchesLost: { type: Number, default: 0 },
        totalRepEarned: { type: Number, default: 0 },
        highestRank: { type: String, default: 'BRONZE' },
        highestTier: { type: String, default: 'I' },
        longestWinStreak: { type: Number, default: 0 },
        clubTrophies: { type: Number, default: 0 }
    },
    
    // Moderation
    isBanned: {
        type: Boolean,
        default: false
    },
    banReason: String,
    banExpires: Date,
    isSuperBanned: {
        type: Boolean,
        default: false
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastActive: {
        type: Date,
        default: Date.now
    }
});

// Indexes
userSchema.index({ discordId: 1 });
userSchema.index({ rep: -1 });
userSchema.index({ 'stats.matchesPlayed': -1 });
userSchema.index({ 'stats.matchesWon': -1 });

// Methods
userSchema.methods.getRankDisplay = function() {
    if (this.rank === 'MASTERS') {
        return `${this.rank} (${this.rep} rep)`;
    }
    return `${this.rank} ${this.tier} (${this.rep} rep)`;
};

userSchema.methods.getRankEmoji = function() {
    const config = require('../config/config');
    return config.ranks[this.rank].emoji;
};

userSchema.methods.getRankColor = function() {
    const config = require('../config/config');
    return config.ranks[this.rank].color;
};

userSchema.methods.updateRank = function() {
    const config = require('../config/config');
    const ranks = Object.entries(config.ranks);
    
    for (let i = ranks.length - 1; i >= 0; i--) {
        const [rankName, rankData] = ranks[i];
        
        if (rankName === 'MASTERS') {
            if (this.rep >= rankData.points) {
                this.rank = rankName;
                this.tier = null;
                return;
            }
        } else {
            const tiers = Object.entries(rankData.tiers);
            for (let j = tiers.length - 1; j >= 0; j--) {
                const [tierName, tierData] = tiers[j];
                if (this.rep >= tierData.points) {
                    this.rank = rankName;
                    this.tier = tierName;
                    return;
                }
            }
        }
    }
};

userSchema.methods.addRep = async function(amount) {
    this.rep += amount;
    if (this.rep < 0) this.rep = 0;
    
    const oldRank = this.rank;
    const oldTier = this.tier;
    
    this.updateRank();
    
    // Update highest rank if needed
    if (this.rank !== oldRank || this.tier !== oldTier) {
        const rankOrder = ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND', 'MYTHIC', 'LEGENDARY', 'MASTERS'];
        const tierOrder = ['I', 'II', 'III'];
        
        const currentRankIndex = rankOrder.indexOf(this.rank);
        const highestRankIndex = rankOrder.indexOf(this.stats.highestRank);
        
        if (currentRankIndex > highestRankIndex || 
            (currentRankIndex === highestRankIndex && 
             tierOrder.indexOf(this.tier) > tierOrder.indexOf(this.stats.highestTier))) {
            this.stats.highestRank = this.rank;
            this.stats.highestTier = this.tier;
        }
    }
    
    this.stats.totalRepEarned += amount;
    await this.save();
};

userSchema.methods.updateWinStreak = async function(won) {
    if (won) {
        this.winStreak++;
        if (this.winStreak > this.stats.longestWinStreak) {
            this.stats.longestWinStreak = this.winStreak;
        }
    } else {
        this.winStreak = 0;
    }
    await this.save();
};

const User = mongoose.model('User', userSchema);

module.exports = User; 