const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');
const User = require('../models/User');
const Badge = require('../models/Badge');

// Badge categories and their display properties
const BADGE_CATEGORIES = {
    MASTERY: {
        name: 'Team Mastery',
        color: '#FFD700',
        icon: '🏆',
        description: 'Earned by mastering specific teams',
        variants: {
            BRONZE: { name: 'Bronze', color: '#CD7F32', points: 500 },
            SILVER: { name: 'Silver', color: '#C0C0C0', points: 2000 },
            GOLD: { name: 'Gold', color: '#FFD700', points: 3500 }
        }
    },
    WIN_STREAK: {
        name: 'Win Streak',
        color: '#FF69B4',
        icon: '🔥',
        description: 'Earned by maintaining win streaks',
        variants: {
            STREAK_1: { name: '1 Win', color: '#FF69B4', points: 1 },
            STREAK_2: { name: '2 Wins', color: '#FF69B4', points: 2 },
            STREAK_3: { name: '3 Wins', color: '#FF69B4', points: 3 },
            STREAK_4: { name: '4 Wins', color: '#FF69B4', points: 4 },
            STREAK_5: { name: '5 Wins', color: '#FF69B4', points: 5 },
            STREAK_6: { name: '6 Wins', color: '#FF69B4', points: 6 },
            STREAK_7: { name: '7 Wins', color: '#FF69B4', points: 7 },
            STREAK_8: { name: '8 Wins', color: '#FF69B4', points: 8 },
            STREAK_9: { name: '9 Wins', color: '#FF69B4', points: 9 },
            STREAK_10: { name: '10+ Wins', color: '#FF69B4', points: 10 }
        }
    },
    CHALLENGE: {
        name: 'Challenge',
        color: '#4CAF50',
        icon: '🎯',
        description: 'Earned by completing challenges',
        variants: {
            STANDARD: { name: 'Standard', color: '#4CAF50', points: 1 },
            HARD: { name: 'Hard', color: '#FF5722', points: 2 },
            EVENT: { name: 'Event', color: '#9C27B0', points: 3 }
        }
    },
    SPECIAL: {
        name: 'Special',
        color: '#2196F3',
        icon: '🌟',
        description: 'Special achievements and milestones',
        variants: {
            DEFAULT: { name: 'Default', color: '#2196F3', points: 1 }
        }
    }
};

// Team mastery badge IDs
const TEAM_MASTERY_BADGES = {
    MARIO: {
        id: 'mf',
        name: 'Mario',
        emojis: {
            BRONZE: '1336842844719026327',
            SILVER: '1336842873282498560',
            GOLD: '1336842899169607794'
        }
    },
    LUIGI: {
        id: 'lk',
        name: 'Luigi',
        emojis: {
            BRONZE: '1336842919776092160',
            SILVER: '1336842940374454275',
            GOLD: '1336843203923546257'
        }
    },
    PEACH: {
        id: 'pm',
        name: 'Peach',
        emojis: {
            BRONZE: '1336843223842295919',
            SILVER: '1336843289281695745',
            GOLD: '1336843334483710012'
        }
    },
    DAISY: {
        id: 'df',
        name: 'Daisy',
        emojis: {
            BRONZE: '1336843359062458388',
            SILVER: '1336843383989211148',
            GOLD: '1336843412426588161'
        }
    },
    YOSHI: {
        id: 'ye',
        name: 'Yoshi',
        emojis: {
            BRONZE: '1336843434010611723',
            SILVER: '1336843454113779824',
            GOLD: '1336843477589168199'
        }
    },
    BIRDO: {
        id: 'bb',
        name: 'Birdo',
        emojis: {
            BRONZE: '1336843501727518761',
            SILVER: '1336843526301814806',
            GOLD: '1336843548540014654'
        }
    },
    WARIO: {
        id: 'wm',
        name: 'Wario',
        emojis: {
            BRONZE: '1336843568689582091',
            SILVER: '1336843588725637220',
            GOLD: '1336843613921087559'
        }
    },
    WALUIGI: {
        id: 'ws',
        name: 'Waluigi',
        emojis: {
            BRONZE: '1336843640017915935',
            SILVER: '1336843662834929745',
            GOLD: '1336843762248454205'
        }
    },
    DONKEY_KONG: {
        id: 'dw',
        name: 'Donkey Kong',
        emojis: {
            BRONZE: '1336843783572029471',
            SILVER: '1336843802408783965',
            GOLD: '1336843824932323408'
        }
    },
    DIDDY_KONG: {
        id: 'ds',
        name: 'Diddy Kong',
        emojis: {
            BRONZE: '1336843857966403697',
            SILVER: '1336843877448941588',
            GOLD: '1336843895010754713'
        }
    },
    BOWSER: {
        id: 'bm',
        name: 'Bowser',
        emojis: {
            BRONZE: '1336843909384372317',
            SILVER: '1336843925238845460',
            GOLD: '1336843974463459348'
        }
    },
    BOWSER_JR: {
        id: 'br',
        name: 'Bowser Jr.',
        emojis: {
            BRONZE: '1336843945061384233',
            SILVER: '1336843958940205107',
            GOLD: '1336843974463459348'
        }
    }
};

// Win streak badge IDs
const WIN_STREAK_BADGES = {
    STREAK_0: '1316513861351768085',
    STREAK_1: '1316513918826319962',
    STREAK_2: '1316513943925161985',
    STREAK_3: '1316513965337219113',
    STREAK_4: '1316513984425230368',
    STREAK_5: '1316514025970073710',
    STREAK_6: '1316514043220983870',
    STREAK_7: '1316514068470829076',
    STREAK_8: '1316514084212047963',
    STREAK_9: '1316514100662243498',
    STREAK_10: '1316514117422551151'
};

class BadgeManager {
    constructor(client) {
        this.client = client;
        this.badges = new Map(); // Cache of all badges
        this.userBadges = new Map(); // Cache of user badges
        this.initializeBadges();
    }

    async initializeBadges() {
        try {
            // Load all badges from database
            const badges = await Badge.find();
            badges.forEach(badge => this.badges.set(badge.id, badge));

            // Initialize team mastery badges if they don't exist
            await this.initializeTeamMasteryBadges();
            
            // Initialize win streak badges if they don't exist
            await this.initializeWinStreakBadges();

            logger.info('Badge system initialized successfully');
        } catch (error) {
            logger.error('Error initializing badge system:', error);
            throw error;
        }
    }

    async initializeTeamMasteryBadges() {
        for (const [teamId, team] of Object.entries(TEAM_MASTERY_BADGES)) {
            for (const [tier, emojiId] of Object.entries(team.emojis)) {
                const badgeId = `badge_${team.id}_${tier.toLowerCase()}`;
                if (!this.badges.has(badgeId)) {
                    const badge = new Badge({
                        id: badgeId,
                        name: `${team.name} ${tier} Mastery`,
                        description: `Achieve ${tier.toLowerCase()} mastery with ${team.name}`,
                        category: 'MASTERY',
                        variant: tier,
                        emoji: emojiId,
                        points: BADGE_CATEGORIES.MASTERY.variants[tier].points,
                        teamId: team.id
                    });
                    await badge.save();
                    this.badges.set(badgeId, badge);
                }
            }
        }
    }

    async initializeWinStreakBadges() {
        for (const [streak, emojiId] of Object.entries(WIN_STREAK_BADGES)) {
            const badgeId = `badge_${streak.toLowerCase()}`;
            if (!this.badges.has(badgeId)) {
                const points = parseInt(streak.split('_')[1]) || 0;
                const badge = new Badge({
                    id: badgeId,
                    name: `${points} Win Streak`,
                    description: `Achieve a ${points} win streak`,
                    category: 'WIN_STREAK',
                    variant: streak,
                    emoji: emojiId,
                    points: points
                });
                await badge.save();
                this.badges.set(badgeId, badge);
            }
        }
    }

    // Badge Management
    async createBadge(data) {
        try {
            const badge = new Badge({
                id: data.id,
                name: data.name,
                description: data.description,
                category: data.category,
                variant: data.variant || 'DEFAULT',
                emoji: data.emoji,
                points: data.points || 1,
                teamId: data.teamId,
                challengeId: data.challengeId
            });

            await badge.save();
            this.badges.set(badge.id, badge);
            return badge;
        } catch (error) {
            logger.error('Error creating badge:', error);
            throw error;
        }
    }

    async deleteBadge(badgeId) {
        try {
            const badge = await Badge.findOneAndDelete({ id: badgeId });
            if (badge) {
                this.badges.delete(badgeId);
                // Remove badge from all users
                await User.updateMany(
                    { badges: badgeId },
                    { $pull: { badges: badgeId } }
                );
            }
            return badge;
        } catch (error) {
            logger.error('Error deleting badge:', error);
            throw error;
        }
    }

    async updateBadge(badgeId, data) {
        try {
            const badge = await Badge.findOneAndUpdate(
                { id: badgeId },
                { $set: data },
                { new: true }
            );
            if (badge) {
                this.badges.set(badgeId, badge);
            }
            return badge;
        } catch (error) {
            logger.error('Error updating badge:', error);
            throw error;
        }
    }

    // User Badge Management
    async awardBadge(userId, badgeId) {
        try {
            const badge = this.badges.get(badgeId);
            if (!badge) {
                throw new Error('Badge not found');
            }

            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Check if user already has this badge
            if (user.badges.includes(badgeId)) {
                return { alreadyOwned: true, badge };
            }

            // Handle variant badges (e.g., team mastery, win streaks)
            if (badge.category === 'MASTERY') {
                await this.handleMasteryBadgeUpgrade(user, badge);
            } else if (badge.category === 'WIN_STREAK') {
                await this.handleWinStreakBadgeUpgrade(user, badge);
            } else {
                // Regular badge award
                user.badges.push(badgeId);
                await user.save();
            }

            // Update cache
            this.userBadges.set(userId, user.badges);

            return { awarded: true, badge };
        } catch (error) {
            logger.error('Error awarding badge:', error);
            throw error;
        }
    }

    async removeBadge(userId, badgeId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const badge = this.badges.get(badgeId);
            if (!badge) {
                throw new Error('Badge not found');
            }

            // Remove badge from user
            user.badges = user.badges.filter(id => id !== badgeId);
            await user.save();

            // Update cache
            this.userBadges.set(userId, user.badges);

            return { removed: true, badge };
        } catch (error) {
            logger.error('Error removing badge:', error);
            throw error;
        }
    }

    // Variant Handling
    async handleMasteryBadgeUpgrade(user, newBadge) {
        const teamId = newBadge.teamId;
        const currentTier = this.getCurrentMasteryTier(user, teamId);
        const newTier = newBadge.variant;

        // Only upgrade if new tier is higher
        if (this.isHigherTier(newTier, currentTier)) {
            // Remove old tier badge if exists
            const oldBadgeId = `badge_${teamId}_${currentTier.toLowerCase()}`;
            if (user.badges.includes(oldBadgeId)) {
                user.badges = user.badges.filter(id => id !== oldBadgeId);
            }

            // Add new badge
            user.badges.push(newBadge.id);
            await user.save();
        }
    }

    async handleWinStreakBadgeUpgrade(user, newBadge) {
        const currentStreak = this.getCurrentWinStreak(user);
        const newStreak = parseInt(newBadge.variant.split('_')[1]) || 0;

        // Only upgrade if new streak is higher
        if (newStreak > currentStreak) {
            // Remove old streak badge if exists
            const oldBadgeId = `badge_streak_${currentStreak}`;
            if (user.badges.includes(oldBadgeId)) {
                user.badges = user.badges.filter(id => id !== oldBadgeId);
            }

            // Add new badge
            user.badges.push(newBadge.id);
            await user.save();
        }
    }

    // Progression Tracking
    async updateTeamMastery(userId, teamId, points) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Update team mastery points
            if (!user.teamMastery) {
                user.teamMastery = new Map();
            }
            const currentPoints = user.teamMastery.get(teamId) || 0;
            const newPoints = currentPoints + points;
            user.teamMastery.set(teamId, newPoints);

            // Check for badge upgrades
            const tiers = ['BRONZE', 'SILVER', 'GOLD'];
            for (const tier of tiers) {
                const requiredPoints = BADGE_CATEGORIES.MASTERY.variants[tier].points;
                if (newPoints >= requiredPoints) {
                    const badgeId = `badge_${teamId}_${tier.toLowerCase()}`;
                    await this.awardBadge(userId, badgeId);
                }
            }

            await user.save();
            return { updated: true, newPoints };
        } catch (error) {
            logger.error('Error updating team mastery:', error);
            throw error;
        }
    }

    async updateWinStreak(userId, newStreak) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Update win streak
            user.winStreak = newStreak;

            // Check for badge upgrades
            if (newStreak > 0) {
                const badgeId = `badge_streak_${Math.min(newStreak, 10)}`;
                await this.awardBadge(userId, badgeId);
            } else {
                // Reset streak badge
                const oldBadgeId = `badge_streak_${user.winStreak}`;
                if (user.badges.includes(oldBadgeId)) {
                    await this.removeBadge(userId, oldBadgeId);
                }
                await this.awardBadge(userId, 'badge_streak_0');
            }

            await user.save();
            return { updated: true, newStreak };
        } catch (error) {
            logger.error('Error updating win streak:', error);
            throw error;
        }
    }

    // Utility Methods
    getCurrentMasteryTier(user, teamId) {
        const points = user.teamMastery?.get(teamId) || 0;
        if (points >= BADGE_CATEGORIES.MASTERY.variants.GOLD.points) return 'GOLD';
        if (points >= BADGE_CATEGORIES.MASTERY.variants.SILVER.points) return 'SILVER';
        if (points >= BADGE_CATEGORIES.MASTERY.variants.BRONZE.points) return 'BRONZE';
        return null;
    }

    getCurrentWinStreak(user) {
        return user.winStreak || 0;
    }

    isHigherTier(newTier, currentTier) {
        const tiers = ['BRONZE', 'SILVER', 'GOLD'];
        return tiers.indexOf(newTier) > tiers.indexOf(currentTier);
    }

    async getUserBadges(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const badges = user.badges.map(id => this.badges.get(id)).filter(Boolean);
            return badges.sort((a, b) => {
                // Sort by category priority
                const categoryOrder = ['MASTERY', 'WIN_STREAK', 'CHALLENGE', 'SPECIAL'];
                const categoryDiff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
                if (categoryDiff !== 0) return categoryDiff;

                // Then by points
                return b.points - a.points;
            });
        } catch (error) {
            logger.error('Error getting user badges:', error);
            throw error;
        }
    }

    generateBadgeEmbed(badge) {
        const category = BADGE_CATEGORIES[badge.category];
        return new EmbedBuilder()
            .setTitle(`${category.icon} ${badge.name}`)
            .setDescription(badge.description)
            .setColor(category.color)
            .addFields(
                { name: 'Category', value: category.name, inline: true },
                { name: 'Points', value: badge.points.toString(), inline: true }
            )
            .setFooter({ text: `Badge ID: ${badge.id}` });
    }
}

module.exports = BadgeManager; 