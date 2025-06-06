const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('./logger');

// Club configuration
const CLUB_CONFIG = {
    MAX_MEMBERS: 10,
    ICONS: {
        RED: { emoji: '1340463594055139328', url: 'https://i.imgur.com/sy8o63Y.png' },
        BLUE: { emoji: '1340464817428758558', url: 'https://i.imgur.com/2jH5dQU.png' },
        YELLOW: { emoji: '1340464843576049774', url: 'https://i.imgur.com/nywWQyZ.png' },
        GREEN: { emoji: '1340464944126230598', url: 'https://i.imgur.com/JnBP5ro.png' },
        PINK: { emoji: '1340464971741528084', url: 'https://i.imgur.com/ToavyvN.png' },
        CYAN: { emoji: '1340465007598764124', url: 'https://i.imgur.com/81HXsR8.png' }
    },
    PRIVACY_TYPES: ['OPEN', 'APPLICATION', 'INVITE_ONLY'],
    ROLES: {
        OWNER: 'owner',
        CAPTAIN: 'captain',
        MEMBER: 'member'
    }
};

// League configuration
const LEAGUE_CONFIG = {
    SEASON_DURATION: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    TICKETS_PER_SEASON: 7,
    REP_GAIN: {
        BASE_WIN: 70,
        RD_MULTIPLIER: 3,
        MAX_RD_BONUS: 30,
        MAX_PER_MATCH: 100,
        LOSS_PENALTY: -10
    },
    TROPHY_CONVERSION: 10 // rep per trophy
};

class ClubManager {
    constructor(client) {
        this.client = client;
        this.activeSeasons = new Map(); // Map of clubId -> season data
        this.memberTickets = new Map(); // Map of userId -> { tickets: number, lastReset: timestamp }
        this.lastSeasonReset = null;
        this.checkSeasonReset();
    }

    // Club Creation and Management
    async createClub(name, id, icon, privacyType, ownerId) {
        try {
            // Validate inputs
            if (!Object.values(CLUB_CONFIG.ICONS).some(i => i.emoji === icon)) {
                throw new Error('Invalid club icon');
            }
            if (!CLUB_CONFIG.PRIVACY_TYPES.includes(privacyType)) {
                throw new Error('Invalid privacy type');
            }

            // Check if club ID is unique
            const existingClub = await this.client.db.collection('clubs').findOne({ id });
            if (existingClub) {
                throw new Error('Club ID already exists');
            }

            // Create club document
            const club = await this.client.db.collection('clubs').insertOne({
                name,
                id,
                icon,
                privacyType,
                owner: ownerId,
                captains: [],
                members: [ownerId],
                createdAt: new Date(),
                trophies: 0,
                totalRep: 0,
                currentSeasonRep: 0,
                applications: [],
                invites: []
            });

            // Initialize season data
            await this.initializeSeason(club.insertedId);

            return club.insertedId;
        } catch (error) {
            logger.error('Error creating club:', error);
            throw error;
        }
    }

    // League System
    async initializeSeason(clubId) {
        const seasonData = {
            startDate: new Date(),
            endDate: new Date(Date.now() + LEAGUE_CONFIG.SEASON_DURATION),
            rep: 0,
            matches: [],
            participants: new Set()
        };
        this.activeSeasons.set(clubId, seasonData);
    }

    async checkSeasonReset() {
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        if (!this.lastSeasonReset || this.lastSeasonReset < firstDayOfMonth) {
            await this.resetAllSeasons();
            this.lastSeasonReset = now;
        }

        // Schedule next check
        setTimeout(() => this.checkSeasonReset(), 3600000); // Check every hour
    }

    async resetAllSeasons() {
        try {
            // Process all active seasons
            for (const [clubId, seasonData] of this.activeSeasons) {
                // Calculate trophies
                const trophies = Math.ceil(seasonData.rep / LEAGUE_CONFIG.TROPHY_CONVERSION);
                
                // Update club document
                await this.client.db.collection('clubs').updateOne(
                    { _id: clubId },
                    {
                        $inc: { trophies },
                        $set: { currentSeasonRep: 0 },
                        $push: {
                            seasonHistory: {
                                startDate: seasonData.startDate,
                                endDate: seasonData.endDate,
                                rep: seasonData.rep,
                                trophies,
                                participants: Array.from(seasonData.participants)
                            }
                        }
                    }
                );

                // Reset member tickets
                for (const userId of seasonData.participants) {
                    this.memberTickets.set(userId, {
                        tickets: LEAGUE_CONFIG.TICKETS_PER_SEASON,
                        lastReset: new Date()
                    });
                }

                // Initialize new season
                await this.initializeSeason(clubId);
            }

            logger.info('All club seasons reset successfully');
        } catch (error) {
            logger.error('Error resetting seasons:', error);
            throw error;
        }
    }

    // Ticket Management
    async checkAndUseTicket(userId) {
        const userTickets = this.memberTickets.get(userId);
        if (!userTickets || userTickets.tickets <= 0) {
            return false;
        }

        userTickets.tickets--;
        this.memberTickets.set(userId, userTickets);
        return true;
    }

    async getRemainingTickets(userId) {
        const userTickets = this.memberTickets.get(userId);
        return userTickets ? userTickets.tickets : 0;
    }

    // Match Processing
    async processClubMatch(clubId, userId, opponentId, score, isWin) {
        try {
            const seasonData = this.activeSeasons.get(clubId);
            if (!seasonData) return;

            // Calculate rep gain/loss
            const repChange = this.calculateRepChange(score, isWin);
            
            // Update season data
            seasonData.rep += repChange;
            seasonData.matches.push({
                userId,
                opponentId,
                score,
                repChange,
                timestamp: new Date()
            });
            seasonData.participants.add(userId);
            seasonData.participants.add(opponentId);

            // Update club document
            await this.client.db.collection('clubs').updateOne(
                { _id: clubId },
                { $inc: { currentSeasonRep: repChange } }
            );

            return repChange;
        } catch (error) {
            logger.error('Error processing club match:', error);
            throw error;
        }
    }

    calculateRepChange(score, isWin) {
        if (isWin) {
            const runDiff = Math.abs(score[0] - score[1]);
            const rdBonus = Math.min(runDiff * LEAGUE_CONFIG.REP_GAIN.RD_MULTIPLIER, LEAGUE_CONFIG.REP_GAIN.MAX_RD_BONUS);
            return Math.min(LEAGUE_CONFIG.REP_GAIN.BASE_WIN + rdBonus, LEAGUE_CONFIG.REP_GAIN.MAX_PER_MATCH);
        } else {
            return LEAGUE_CONFIG.REP_GAIN.LOSS_PENALTY;
        }
    }

    // Club Member Management
    async addMember(clubId, userId, role = CLUB_CONFIG.ROLES.MEMBER) {
        try {
            const club = await this.client.db.collection('clubs').findOne({ _id: clubId });
            if (!club) throw new Error('Club not found');
            if (club.members.length >= CLUB_CONFIG.MAX_MEMBERS) {
                throw new Error('Club is full');
            }

            const update = { $addToSet: { members: userId } };
            if (role === CLUB_CONFIG.ROLES.CAPTAIN) {
                update.$addToSet = { ...update.$addToSet, captains: userId };
            }

            await this.client.db.collection('clubs').updateOne(
                { _id: clubId },
                update
            );

            // Initialize tickets for new member
            this.memberTickets.set(userId, {
                tickets: LEAGUE_CONFIG.TICKETS_PER_SEASON,
                lastReset: new Date()
            });

            return true;
        } catch (error) {
            logger.error('Error adding club member:', error);
            throw error;
        }
    }

    async removeMember(clubId, userId) {
        try {
            await this.client.db.collection('clubs').updateOne(
                { _id: clubId },
                {
                    $pull: {
                        members: userId,
                        captains: userId
                    }
                }
            );

            // Remove tickets
            this.memberTickets.delete(userId);

            return true;
        } catch (error) {
            logger.error('Error removing club member:', error);
            throw error;
        }
    }

    // Club Information
    async getClubInfo(clubId) {
        try {
            const club = await this.client.db.collection('clubs').findOne({ _id: clubId });
            if (!club) throw new Error('Club not found');

            const seasonData = this.activeSeasons.get(clubId);
            const leaderboardRank = await this.getClubRank(clubId);

            return {
                ...club,
                currentSeason: {
                    rep: seasonData?.rep || 0,
                    participants: seasonData?.participants.size || 0,
                    matches: seasonData?.matches.length || 0
                },
                leaderboardRank
            };
        } catch (error) {
            logger.error('Error getting club info:', error);
            throw error;
        }
    }

    async getClubRank(clubId) {
        try {
            const clubs = await this.client.db.collection('clubs')
                .find()
                .sort({ trophies: -1 })
                .toArray();

            return clubs.findIndex(c => c._id.toString() === clubId.toString()) + 1;
        } catch (error) {
            logger.error('Error getting club rank:', error);
            throw error;
        }
    }

    // Leaderboard
    async getClubLeaderboard(page = 1, perPage = 10) {
        try {
            const skip = (page - 1) * perPage;
            const clubs = await this.client.db.collection('clubs')
                .find()
                .sort({ trophies: -1 })
                .skip(skip)
                .limit(perPage)
                .toArray();

            const total = await this.client.db.collection('clubs').countDocuments();

            return {
                clubs,
                total,
                pages: Math.ceil(total / perPage),
                currentPage: page
            };
        } catch (error) {
            logger.error('Error getting club leaderboard:', error);
            throw error;
        }
    }

    // Club Settings
    async updateClubSettings(clubId, settings) {
        try {
            const allowedUpdates = ['name', 'icon', 'privacyType', 'description'];
            const updates = {};

            for (const [key, value] of Object.entries(settings)) {
                if (allowedUpdates.includes(key)) {
                    if (key === 'icon' && !Object.values(CLUB_CONFIG.ICONS).some(i => i.emoji === value)) {
                        throw new Error('Invalid club icon');
                    }
                    if (key === 'privacyType' && !CLUB_CONFIG.PRIVACY_TYPES.includes(value)) {
                        throw new Error('Invalid privacy type');
                    }
                    updates[key] = value;
                }
            }

            if (Object.keys(updates).length === 0) {
                throw new Error('No valid updates provided');
            }

            await this.client.db.collection('clubs').updateOne(
                { _id: clubId },
                { $set: updates }
            );

            return true;
        } catch (error) {
            logger.error('Error updating club settings:', error);
            throw error;
        }
    }

    // Club Applications and Invites
    async handleApplication(clubId, userId, action) {
        try {
            const club = await this.client.db.collection('clubs').findOne({ _id: clubId });
            if (!club) throw new Error('Club not found');
            if (club.privacyType !== 'APPLICATION') {
                throw new Error('Club is not accepting applications');
            }

            if (action === 'apply') {
                await this.client.db.collection('clubs').updateOne(
                    { _id: clubId },
                    { $addToSet: { applications: userId } }
                );
            } else if (action === 'approve' || action === 'deny') {
                await this.client.db.collection('clubs').updateOne(
                    { _id: clubId },
                    { $pull: { applications: userId } }
                );

                if (action === 'approve') {
                    await this.addMember(clubId, userId);
                }
            }

            return true;
        } catch (error) {
            logger.error('Error handling club application:', error);
            throw error;
        }
    }

    async handleInvite(clubId, userId, action) {
        try {
            const club = await this.client.db.collection('clubs').findOne({ _id: clubId });
            if (!club) throw new Error('Club not found');
            if (club.privacyType !== 'INVITE_ONLY') {
                throw new Error('Club is not invite-only');
            }

            if (action === 'invite') {
                await this.client.db.collection('clubs').updateOne(
                    { _id: clubId },
                    { $addToSet: { invites: userId } }
                );
            } else if (action === 'accept' || action === 'decline') {
                await this.client.db.collection('clubs').updateOne(
                    { _id: clubId },
                    { $pull: { invites: userId } }
                );

                if (action === 'accept') {
                    await this.addMember(clubId, userId);
                }
            }

            return true;
        } catch (error) {
            logger.error('Error handling club invite:', error);
            throw error;
        }
    }
}

module.exports = ClubManager; 