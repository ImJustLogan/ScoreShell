const mongoose = require('mongoose');

const clubLeagueSchema = new mongoose.Schema({
    season: {
        type: Number,
        required: true,
        unique: true
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    clubs: [{
        clubId: {
            type: String,
            required: true
        },
        clubName: {
            type: String,
            required: true
        },
        rep: {
            type: Number,
            default: 0
        },
        trophies: {
            type: Number,
            default: 0
        },
        members: [{
            userId: {
                type: String,
                required: true
            },
            username: {
                type: String,
                required: true
            },
            tickets: {
                type: Number,
                default: 7
            },
            lastTicketReset: {
                type: Date,
                default: Date.now
            }
        }],
        matches: [{
            matchId: {
                type: String,
                required: true
            },
            opponentClubId: {
                type: String,
                required: true
            },
            opponentClubName: {
                type: String,
                required: true
            },
            player1: {
                userId: String,
                username: String,
                score: Number
            },
            player2: {
                userId: String,
                username: String,
                score: Number
            },
            repGained: Number,
            repLost: Number,
            timestamp: {
                type: Date,
                default: Date.now
            }
        }]
    }]
}, {
    timestamps: true
});

// Indexes for efficient querying
clubLeagueSchema.index({ season: 1 });
clubLeagueSchema.index({ 'clubs.clubId': 1 });
clubLeagueSchema.index({ 'clubs.members.userId': 1 });
clubLeagueSchema.index({ startDate: 1, endDate: 1 });

// Static method to get current active season
clubLeagueSchema.statics.getCurrentSeason = async function() {
    const now = new Date();
    return this.findOne({
        startDate: { $lte: now },
        endDate: { $gte: now },
        isActive: true
    });
};

// Static method to get club's current season data
clubLeagueSchema.statics.getClubSeasonData = async function(clubId) {
    const season = await this.getCurrentSeason();
    if (!season) return null;
    
    return season.clubs.find(club => club.clubId === clubId);
};

// Static method to get member's ticket count
clubLeagueSchema.statics.getMemberTickets = async function(userId) {
    const season = await this.getCurrentSeason();
    if (!season) return null;

    for (const club of season.clubs) {
        const member = club.members.find(m => m.userId === userId);
        if (member) {
            // Check if tickets need to be reset (new month)
            const now = new Date();
            const lastReset = new Date(member.lastTicketReset);
            if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
                member.tickets = 7;
                member.lastTicketReset = now;
                await season.save();
            }
            return member.tickets;
        }
    }
    return null;
};

// Static method to use a ticket
clubLeagueSchema.statics.useTicket = async function(userId) {
    const season = await this.getCurrentSeason();
    if (!season) return false;

    for (const club of season.clubs) {
        const member = club.members.find(m => m.userId === userId);
        if (member && member.tickets > 0) {
            member.tickets--;
            await season.save();
            return true;
        }
    }
    return false;
};

// Static method to record a match
clubLeagueSchema.statics.recordMatch = async function(matchData) {
    const season = await this.getCurrentSeason();
    if (!season) return false;

    const { club1Id, club2Id, player1, player2, scores } = matchData;
    
    // Find both clubs
    const club1 = season.clubs.find(c => c.clubId === club1Id);
    const club2 = season.clubs.find(c => c.clubId === club2Id);
    
    if (!club1 || !club2) return false;

    // Calculate rep based on the formula
    const baseRep = 70;
    const runDiff = Math.abs(scores.player1 - scores.player2);
    const runDiffBonus = Math.min(runDiff * 3, 30); // Cap at 30
    const totalRep = Math.min(baseRep + runDiffBonus, 100); // Cap at 100

    // Record match for both clubs
    const matchId = new mongoose.Types.ObjectId().toString();
    
    club1.matches.push({
        matchId,
        opponentClubId: club2Id,
        opponentClubName: club2.clubName,
        player1: {
            userId: player1.userId,
            username: player1.username,
            score: scores.player1
        },
        player2: {
            userId: player2.userId,
            username: player2.username,
            score: scores.player2
        },
        repGained: scores.player1 > scores.player2 ? totalRep : -10,
        repLost: scores.player1 < scores.player2 ? totalRep : -10
    });

    club2.matches.push({
        matchId,
        opponentClubId: club1Id,
        opponentClubName: club1.clubName,
        player1: {
            userId: player2.userId,
            username: player2.username,
            score: scores.player2
        },
        player2: {
            userId: player1.userId,
            username: player1.username,
            score: scores.player1
        },
        repGained: scores.player2 > scores.player1 ? totalRep : -10,
        repLost: scores.player2 < scores.player1 ? totalRep : -10
    });

    // Update club rep
    if (scores.player1 > scores.player2) {
        club1.rep += totalRep;
        club2.rep = Math.max(0, club2.rep - 10);
    } else {
        club2.rep += totalRep;
        club1.rep = Math.max(0, club1.rep - 10);
    }

    // Update trophies (rep / 10, rounded up)
    club1.trophies = Math.ceil(club1.rep / 10);
    club2.trophies = Math.ceil(club2.rep / 10);

    await season.save();
    return true;
};

// Static method to end season and calculate final standings
clubLeagueSchema.statics.endSeason = async function() {
    const season = await this.getCurrentSeason();
    if (!season) return null;

    season.isActive = false;
    season.endDate = new Date();

    // Sort clubs by trophies for final standings
    const standings = season.clubs
        .map(club => ({
            clubId: club.clubId,
            clubName: club.clubName,
            rep: club.rep,
            trophies: club.trophies,
            matches: club.matches.length
        }))
        .sort((a, b) => b.trophies - a.trophies);

    await season.save();
    return standings;
};

// Static method to start new season
clubLeagueSchema.statics.startNewSeason = async function() {
    const lastSeason = await this.findOne().sort({ season: -1 });
    const newSeasonNumber = lastSeason ? lastSeason.season + 1 : 1;

    // Set start date to first day of current month
    const startDate = new Date();
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    // Set end date to 7 days from start
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);

    const newSeason = new this({
        season: newSeasonNumber,
        startDate,
        endDate,
        isActive: true,
        clubs: [] // Clubs will be added as they participate
    });

    await newSeason.save();
    return newSeason;
};

module.exports = mongoose.model('ClubLeague', clubLeagueSchema); 