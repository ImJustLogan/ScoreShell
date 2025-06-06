const mongoose = require('mongoose');

const clubSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 32
    },
    clubId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 5,
        uppercase: true,
        match: /^[A-Z0-9]+$/
    },
    icon: {
        type: String,
        required: true,
        enum: ['club_red', 'club_blue', 'club_yellow', 'club_green', 'club_pink', 'club_cyan']
    },
    privacy: {
        type: String,
        required: true,
        enum: ['OPEN', 'APPLICATION', 'INVITE_ONLY'],
        default: 'OPEN'
    },
    description: {
        type: String,
        maxlength: 1000,
        default: ''
    },
    owner: {
        type: String,
        required: true,
        ref: 'User'
    },
    captains: [{
        type: String,
        ref: 'User'
    }],
    members: [{
        userId: {
            type: String,
            required: true,
            ref: 'User'
        },
        joinedAt: {
            type: Date,
            default: Date.now
        }
    }],
    applications: [{
        userId: {
            type: String,
            required: true,
            ref: 'User'
        },
        appliedAt: {
            type: Date,
            default: Date.now
        },
        status: {
            type: String,
            enum: ['PENDING', 'APPROVED', 'DENIED'],
            default: 'PENDING'
        }
    }],
    invites: [{
        userId: {
            type: String,
            required: true,
            ref: 'User'
        },
        invitedAt: {
            type: Date,
            default: Date.now
        },
        invitedBy: {
            type: String,
            required: true,
            ref: 'User'
        }
    }],
    stats: {
        totalRep: {
            type: Number,
            default: 0
        },
        trophies: {
            type: Number,
            default: 0
        },
        currentSeasonRep: {
            type: Number,
            default: 0
        },
        lastSeasonRep: {
            type: Number,
            default: 0
        },
        matchesPlayed: {
            type: Number,
            default: 0
        },
        matchesWon: {
            type: Number,
            default: 0
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
clubSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Ensure members array doesn't exceed 10
clubSchema.pre('save', function(next) {
    if (this.members.length > 10) {
        next(new Error('Club cannot have more than 10 members'));
    }
    next();
});

// Ensure owner is always a member
clubSchema.pre('save', function(next) {
    if (!this.members.some(m => m.userId === this.owner)) {
        this.members.push({
            userId: this.owner,
            joinedAt: this.createdAt
        });
    }
    next();
});

// Ensure captains are always members
clubSchema.pre('save', function(next) {
    this.captains = this.captains.filter(captainId => 
        this.members.some(m => m.userId === captainId)
    );
    next();
});

// Virtual for member count
clubSchema.virtual('memberCount').get(function() {
    return this.members.length;
});

// Method to check if user is a member
clubSchema.methods.isMember = function(userId) {
    return this.members.some(m => m.userId === userId);
};

// Method to check if user is a captain
clubSchema.methods.isCaptain = function(userId) {
    return this.captains.includes(userId);
};

// Method to check if user is owner
clubSchema.methods.isOwner = function(userId) {
    return this.owner === userId;
};

// Method to check if user can manage club
clubSchema.methods.canManage = function(userId) {
    return this.isOwner(userId) || this.isCaptain(userId);
};

// Method to add member
clubSchema.methods.addMember = async function(userId) {
    if (this.memberCount >= 10) {
        throw new Error('Club is full');
    }
    if (this.isMember(userId)) {
        throw new Error('User is already a member');
    }
    this.members.push({
        userId,
        joinedAt: new Date()
    });
    // Remove any pending applications or invites
    this.applications = this.applications.filter(a => a.userId !== userId);
    this.invites = this.invites.filter(i => i.userId !== userId);
    return this.save();
};

// Method to remove member
clubSchema.methods.removeMember = async function(userId) {
    if (this.isOwner(userId)) {
        throw new Error('Cannot remove club owner');
    }
    this.members = this.members.filter(m => m.userId !== userId);
    if (this.isCaptain(userId)) {
        this.captains = this.captains.filter(c => c !== userId);
    }
    return this.save();
};

// Method to promote to captain
clubSchema.methods.promoteToCaptain = async function(userId) {
    if (!this.isMember(userId)) {
        throw new Error('User is not a member');
    }
    if (this.isCaptain(userId)) {
        throw new Error('User is already a captain');
    }
    this.captains.push(userId);
    return this.save();
};

// Method to demote from captain
clubSchema.methods.demoteFromCaptain = async function(userId) {
    if (!this.isCaptain(userId)) {
        throw new Error('User is not a captain');
    }
    this.captains = this.captains.filter(c => c !== userId);
    return this.save();
};

// Method to transfer ownership
clubSchema.methods.transferOwnership = async function(newOwnerId) {
    if (!this.isMember(newOwnerId)) {
        throw new Error('New owner must be a member');
    }
    if (this.isOwner(newOwnerId)) {
        throw new Error('User is already the owner');
    }
    this.owner = newOwnerId;
    if (!this.isCaptain(newOwnerId)) {
        this.captains.push(newOwnerId);
    }
    return this.save();
};

// Method to update club rep
clubSchema.methods.updateRep = async function(repChange) {
    this.stats.totalRep = Math.max(0, this.stats.totalRep + repChange);
    this.stats.currentSeasonRep = Math.max(0, this.stats.currentSeasonRep + repChange);
    return this.save();
};

// Method to end season
clubSchema.methods.endSeason = async function() {
    this.stats.lastSeasonRep = this.stats.currentSeasonRep;
    this.stats.trophies += Math.ceil(this.stats.currentSeasonRep / 10);
    this.stats.currentSeasonRep = 0;
    return this.save();
};

module.exports = mongoose.model('Club', clubSchema); 