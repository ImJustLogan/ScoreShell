const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    // Match Type
    type: {
        type: String,
        enum: ['RANKED', 'DUEL', 'CHALLENGE', 'BINGO'],
        required: true
    },
    status: {
        type: String,
        enum: ['PREGAME', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED'],
        default: 'PREGAME'
    },
    
    // Players
    players: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        score: {
            type: Number,
            default: 0,
            min: 0
        },
        captain: String,
        isHost: {
            type: Boolean,
            default: false
        },
        repChange: {
            type: Number,
            default: 0
        },
        clubRepChange: {
            type: Number,
            default: 0
        },
        reportedScore: {
            type: Number,
            default: null
        },
        reportedAt: Date
    }],
    
    // Match Details
    stage: String,
    roomCode: String,
    startTime: Date,
    endTime: Date,
    
    // Challenge Information
    challenge: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Challenge',
        default: null
    },
    
    // Bingo Information
    mode: {
        type: String,
        enum: ['standard', 'bingo'],
        default: 'standard'
    },
    bingo: {
        cards: [{
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            card: [[String]], // 5x5 grid of quests
            markedSpaces: [[Boolean]], // 5x5 grid of marked spaces
            completedLines: [{
                type: String,
                enum: ['row1', 'row2', 'row3', 'row4', 'row5', 'col1', 'col2', 'col3', 'col4', 'col5', 'diag1', 'diag2']
            }]
        }],
        winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    
    // Match Settings
    settings: {
        starMoves: {
            type: Boolean,
            default: true
        },
        innings: {
            type: Number,
            default: 7
        },
        items: {
            type: Boolean,
            default: true
        },
        mercy: {
            type: Boolean,
            default: true
        }
    },
    
    // Match History
    history: [{
        action: {
            type: String,
            enum: ['STAGE_BAN', 'CAPTAIN_PICK', 'HOST_SELECTION', 'ROOM_CODE', 'SCORE_REPORT', 'DISPUTE', 'RESOLUTION'],
            required: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        details: mongoose.Schema.Types.Mixed,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    
    // Server Information
    server: {
        id: String,
        name: String,
        inviteLink: String
    },
    
    // Moderation
    dispute: {
        isDisputed: {
            type: Boolean,
            default: false
        },
        reason: String,
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        resolution: String,
        resolvedAt: Date
    },
    
    // Hypercharge
    isHypercharged: {
        type: Boolean,
        default: false
    },
    hyperchargeMultiplier: {
        type: Number,
        default: 1
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
matchSchema.index({ 'players.user': 1 });
matchSchema.index({ status: 1 });
matchSchema.index({ type: 1 });
matchSchema.index({ createdAt: -1 });
matchSchema.index({ 'dispute.isDisputed': 1 });

// Methods
matchSchema.methods.addHistory = async function(action, user, details = {}) {
    this.history.push({
        action,
        user,
        details,
        timestamp: new Date()
    });
    this.updatedAt = new Date();
    await this.save();
};

matchSchema.methods.reportScore = async function(userId, score) {
    const player = this.players.find(p => p.user.toString() === userId.toString());
    if (!player) {
        throw new Error('User is not in this match');
    }
    
    player.reportedScore = score;
    player.reportedAt = new Date();
    
    // Check for dispute
    const otherPlayer = this.players.find(p => p.user.toString() !== userId.toString());
    if (otherPlayer.reportedScore !== null) {
        if (otherPlayer.reportedScore !== score) {
            this.status = 'DISPUTED';
            this.dispute.isDisputed = true;
            this.dispute.reason = 'Score mismatch';
        } else {
            // Both players reported same score
            this.status = 'COMPLETED';
            this.endTime = new Date();
            
            // Calculate rep changes
            const winner = score > otherPlayer.reportedScore ? player : otherPlayer;
            const loser = score > otherPlayer.reportedScore ? otherPlayer : player;
            
            // Calculate rep changes based on match type
            if (this.type === 'RANKED') {
                const repChanges = this.calculateRankedRep(winner, loser);
                winner.repChange = repChanges.winner;
                loser.repChange = repChanges.loser;
            } else if (this.type === 'CHALLENGE') {
                // Challenge matches don't affect rep
                winner.repChange = 0;
                loser.repChange = 0;
            }
            
            // Update player stats
            const User = mongoose.model('User');
            await Promise.all([
                User.findByIdAndUpdate(winner.user, {
                    $inc: {
                        'stats.matchesPlayed': 1,
                        'stats.matchesWon': 1
                    }
                }),
                User.findByIdAndUpdate(loser.user, {
                    $inc: {
                        'stats.matchesPlayed': 1,
                        'stats.matchesLost': 1
                    }
                })
            ]);
        }
    }
    
    await this.save();
};

matchSchema.methods.calculateRankedRep = function(winner, loser) {
    const config = require('../config/config');
    const User = mongoose.model('User');
    
    // Base rep gain/loss
    let winnerRep = config.rankedMatch.baseRepGain;
    let loserRep = -config.rankedMatch.baseRepGain;
    
    // Rep difference bonus/penalty
    const repDiff = Math.abs(winner.rep - loser.rep);
    const repDiffPoints = Math.min(20, Math.floor(repDiff * config.rankedMatch.repDifferenceMultiplier));
    
    // Run differential bonus
    const rd = Math.abs(winner.reportedScore - loser.reportedScore);
    const rdPoints = Math.min(30, rd * config.rankedMatch.rdMultiplier);
    
    // Win streak bonus
    const winStreakPoints = Math.min(20, winner.winStreak * config.rankedMatch.winStreakMultiplier);
    
    // Calculate final rep changes
    winnerRep += repDiffPoints + rdPoints + winStreakPoints;
    loserRep -= repDiffPoints + rdPoints;
    
    // Apply hypercharge if active
    if (this.isHypercharged) {
        winnerRep *= (1 + this.hyperchargeMultiplier);
        loserRep *= (1 - this.hyperchargeMultiplier);
    }
    
    // Ensure minimum/maximum rep changes
    winnerRep = Math.max(config.rankedMatch.minRepGain,
        Math.min(config.rankedMatch.maxRepGain, winnerRep));
    loserRep = Math.max(-config.rankedMatch.maxRepGain,
        Math.min(-config.rankedMatch.minRepGain, loserRep));
    
    return {
        winner: Math.round(winnerRep),
        loser: Math.round(loserRep)
    };
};

matchSchema.methods.resolveDispute = async function(resolver, resolution, winner, loser) {
    if (!this.dispute.isDisputed) {
        throw new Error('Match is not disputed');
    }
    
    this.dispute.resolvedBy = resolver;
    this.dispute.resolution = resolution;
    this.dispute.resolvedAt = new Date();
    this.dispute.isDisputed = false;
    this.status = 'COMPLETED';
    this.endTime = new Date();
    
    // Apply rep changes based on resolution
    if (this.type === 'RANKED') {
        const repChanges = this.calculateRankedRep(winner, loser);
        winner.repChange = repChanges.winner;
        loser.repChange = repChanges.loser;
    }
    
    await this.save();
};

// Add method to check if a bingo match is complete
matchSchema.methods.isBingoMatchComplete = function() {
    if (this.mode !== 'bingo') return false;
    
    // Check if any player has completed 5 lines
    return this.bingo.cards.some(card => card.completedLines.length >= 5);
};

// Add method to get the winner of a bingo match
matchSchema.methods.getBingoWinner = function() {
    if (this.mode !== 'bingo' || !this.isBingoMatchComplete()) return null;
    
    // Find the first player who completed 5 lines
    const winningCard = this.bingo.cards.find(card => card.completedLines.length >= 5);
    return winningCard ? winningCard.user : null;
};

// Add method to update bingo match status
matchSchema.methods.updateBingoStatus = async function() {
    if (this.mode !== 'bingo') return;
    
    if (this.isBingoMatchComplete()) {
        const winner = this.getBingoWinner();
        if (winner) {
            this.status = 'COMPLETED';
            this.winner = winner;
            this.bingo.winner = winner;
            this.completedAt = new Date();
            
            // If this is a challenge match, update challenge progress
            if (this.type === 'CHALLENGE' && this.challenge) {
                const challengeManager = require('../utils/challengeManager');
                await challengeManager.updateParticipantProgress(
                    this.challenge._id,
                    winner,
                    {
                        matchId: this._id,
                        won: true,
                        repChange: 0 // Bingo matches don't affect rep
                    }
                );
            }
            
            await this.save();
        }
    }
};

const Match = mongoose.model('Match', matchSchema);

module.exports = Match; 