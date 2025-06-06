const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    challengeId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    description: {
        type: String,
        default: '',
        maxlength: 1000
    },
    icon: {
        type: String,
        required: true
    },
    
    // Challenge Settings
    settings: {
        lives: {
            type: Number,
            required: true,
            min: 1
        },
        winsRequired: {
            type: Number,
            required: true,
            min: 1
        },
        reward: {
            type: String,
            ref: 'Badge',
            required: true
        }
    },
    
    // Challenge Status
    status: {
        type: String,
        enum: ['SCHEDULED', 'ACTIVE', 'PAUSED', 'ARCHIVED'],
        default: 'SCHEDULED'
    },
    startTime: Date,
    endTime: Date,
    
    // Challenge Stats
    stats: {
        totalParticipants: { type: Number, default: 0 },
        completedParticipants: { type: Number, default: 0 },
        totalMatches: { type: Number, default: 0 },
        totalRepAwarded: { type: Number, default: 0 }
    },
    
    // Participants
    participants: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        wins: {
            type: Number,
            default: 0
        },
        lives: {
            type: Number,
            required: true
        },
        status: {
            type: String,
            enum: ['IN_PROGRESS', 'COMPLETED', 'FAILED', 'DNF'],
            default: 'IN_PROGRESS'
        },
        startTime: {
            type: Date,
            default: Date.now
        },
        endTime: Date,
        matches: [{
            match: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Match'
            },
            result: {
                type: String,
                enum: ['WIN', 'LOSS']
            },
            timestamp: Date
        }]
    }],
    
    // Hypercharge
    hypercharge: {
        isActive: {
            type: Boolean,
            default: false
        },
        multiplier: {
            type: Number,
            default: 1
        },
        endTime: Date
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
challengeSchema.index({ challengeId: 1 });
challengeSchema.index({ status: 1 });
challengeSchema.index({ startTime: 1 });
challengeSchema.index({ endTime: 1 });
challengeSchema.index({ 'participants.user': 1 });

// Methods
challengeSchema.methods.addParticipant = async function(userId) {
    if (this.status !== 'ACTIVE') {
        throw new Error('Challenge is not active');
    }
    
    if (this.participants.some(p => p.user.toString() === userId.toString())) {
        throw new Error('User is already participating');
    }
    
    this.participants.push({
        user: userId,
        lives: this.settings.lives,
        startTime: new Date()
    });
    
    this.stats.totalParticipants++;
    await this.save();
};

challengeSchema.methods.removeParticipant = async function(userId) {
    const participantIndex = this.participants.findIndex(
        p => p.user.toString() === userId.toString()
    );
    
    if (participantIndex === -1) {
        throw new Error('User is not participating');
    }
    
    const participant = this.participants[participantIndex];
    if (participant.status === 'IN_PROGRESS') {
        participant.status = 'DNF';
        participant.endTime = new Date();
    }
    
    this.participants.splice(participantIndex, 1);
    await this.save();
};

challengeSchema.methods.recordMatch = async function(userId, matchId, result) {
    const participant = this.participants.find(
        p => p.user.toString() === userId.toString()
    );
    
    if (!participant) {
        throw new Error('User is not participating');
    }
    
    if (participant.status !== 'IN_PROGRESS') {
        throw new Error('User is not in progress');
    }
    
    participant.matches.push({
        match: matchId,
        result,
        timestamp: new Date()
    });
    
    if (result === 'WIN') {
        participant.wins++;
        if (participant.wins >= this.settings.winsRequired) {
            participant.status = 'COMPLETED';
            participant.endTime = new Date();
            this.stats.completedParticipants++;
            
            // Award badge
            const User = mongoose.model('User');
            await User.findByIdAndUpdate(userId, {
                $addToSet: { badges: this.settings.reward }
            });
        }
    } else {
        participant.lives--;
        if (participant.lives <= 0) {
            participant.status = 'FAILED';
            participant.endTime = new Date();
        }
    }
    
    this.stats.totalMatches++;
    await this.save();
};

challengeSchema.methods.start = async function() {
    if (this.status !== 'SCHEDULED') {
        throw new Error('Challenge is not scheduled');
    }
    
    this.status = 'ACTIVE';
    this.startTime = new Date();
    await this.save();
};

challengeSchema.methods.end = async function() {
    if (this.status !== 'ACTIVE' && this.status !== 'PAUSED') {
        throw new Error('Challenge is not active or paused');
    }
    
    this.status = 'ARCHIVED';
    this.endTime = new Date();
    
    // Mark all in-progress participants as DNF
    for (const participant of this.participants) {
        if (participant.status === 'IN_PROGRESS') {
            participant.status = 'DNF';
            participant.endTime = new Date();
        }
    }
    
    await this.save();
};

challengeSchema.methods.pause = async function() {
    if (this.status !== 'ACTIVE') {
        throw new Error('Challenge is not active');
    }
    
    this.status = 'PAUSED';
    await this.save();
};

challengeSchema.methods.resume = async function() {
    if (this.status !== 'PAUSED') {
        throw new Error('Challenge is not paused');
    }
    
    this.status = 'ACTIVE';
    await this.save();
};

challengeSchema.methods.setHypercharge = async function(multiplier, duration) {
    this.hypercharge.isActive = true;
    this.hypercharge.multiplier = multiplier;
    this.hypercharge.endTime = new Date(Date.now() + duration);
    await this.save();
};

const Challenge = mongoose.model('Challenge', challengeSchema);

module.exports = Challenge; 