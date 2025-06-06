const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');

// Badge types and their requirements
const BADGE_TYPES = {
    WIN_STREAK: {
        id: 'win_streak',
        variants: {
            0: { emoji: '1316513861351768085', name: 'Win Streak Reset' },
            1: { emoji: '1316513918826319962', name: 'Win Streak I' },
            2: { emoji: '1316513943925161985', name: 'Win Streak II' },
            3: { emoji: '1316513965337219113', name: 'Win Streak III' },
            4: { emoji: '1316513984425230368', name: 'Win Streak IV' },
            5: { emoji: '1316514025970073710', name: 'Win Streak V' },
            6: { emoji: '1316514043220983870', name: 'Win Streak VI' },
            7: { emoji: '1316514068470829076', name: 'Win Streak VII' },
            8: { emoji: '1316514084212047963', name: 'Win Streak VIII' },
            9: { emoji: '1316514100662243498', name: 'Win Streak IX' },
            10: { emoji: '1316514117422551151', name: 'Win Streak X' }
        }
    },
    TEAM_MASTERY: {
        id: 'team_mastery',
        variants: {
            BRONZE: { threshold: 500, emoji: null, name: 'Bronze Mastery' },
            SILVER: { threshold: 2000, emoji: null, name: 'Silver Mastery' },
            GOLD: { threshold: 3500, emoji: null, name: 'Gold Mastery' }
        },
        teams: {
            MARIO: { id: 'mf', name: 'Mario' },
            LUIGI: { id: 'lk', name: 'Luigi' },
            PEACH: { id: 'pm', name: 'Peach' },
            DAISY: { id: 'df', name: 'Daisy' },
            YOSHI: { id: 'ye', name: 'Yoshi' },
            BIRDO: { id: 'bb', name: 'Birdo' },
            WARIO: { id: 'wm', name: 'Wario' },
            WALUIGI: { id: 'ws', name: 'Waluigi' },
            DONKEY_KONG: { id: 'dw', name: 'Donkey Kong' },
            DIDDY_KONG: { id: 'ds', name: 'Diddy Kong' },
            BOWSER: { id: 'bm', name: 'Bowser' },
            BOWSER_JR: { id: 'br', name: 'Bowser Jr.' }
        }
    }
};

// Initialize team mastery emojis
BADGE_TYPES.TEAM_MASTERY.variants.BRONZE.emoji = {
    MARIO: '1336842844719026327',
    LUIGI: '1336842899169607794',
    PEACH: '1336843203923546257',
    DAISY: '1336843334483710012',
    YOSHI: '1336843412426588161',
    BIRDO: '1336843477589168199',
    WARIO: '1336843548540014654',
    WALUIGI: '1336843613921087559',
    DONKEY_KONG: '1336843762248454205',
    DIDDY_KONG: '1336843824932323408',
    BOWSER: '1336843895010754713',
    BOWSER_JR: '1336843945061384233'
};

BADGE_TYPES.TEAM_MASTERY.variants.SILVER.emoji = {
    MARIO: '1336842873282498560',
    LUIGI: '1336842919776092160',
    PEACH: '1336843223842295919',
    DAISY: '1336843359062458388',
    YOSHI: '1336843434010611723',
    BIRDO: '1336843501727518761',
    WARIO: '1336843568689582091',
    WALUIGI: '1336843640017915935',
    DONKEY_KONG: '1336843783572029471',
    DIDDY_KONG: '1336843857966403697',
    BOWSER: '1336843909384372317',
    BOWSER_JR: '1336843958940205107'
};

BADGE_TYPES.TEAM_MASTERY.variants.GOLD.emoji = {
    MARIO: '1336842899169607794',
    LUIGI: '1336842940374454275',
    PEACH: '1336843289281695745',
    DAISY: '1336843383989211148',
    YOSHI: '1336843454113779824',
    BIRDO: '1336843526301814806',
    WARIO: '1336843588725637220',
    WALUIGI: '1336843662834929745',
    DONKEY_KONG: '1336843802408783965',
    DIDDY_KONG: '1336843877448941588',
    BOWSER: '1336843925238845460',
    BOWSER_JR: '1336843974463459348'
};

/**
 * Create a new badge
 */
async function createBadge(client, name, description, emoji, badgeId) {
    try {
        // Check if badge ID already exists
        const existingBadge = await client.db.collection('badges').findOne({ badgeId });
        if (existingBadge) {
            throw new Error('Badge ID already exists');
        }

        // Create badge
        const badge = {
            name,
            description,
            emoji,
            badgeId,
            createdAt: new Date()
        };

        await client.db.collection('badges').insertOne(badge);
        return badge;

    } catch (error) {
        logger.error('Error in createBadge:', error);
        throw error;
    }
}

/**
 * Assign a badge to a user
 */
async function assignBadge(client, userId, badgeId) {
    try {
        // Check if badge exists
        const badge = await client.db.collection('badges').findOne({ badgeId });
        if (!badge) {
            throw new Error('Badge not found');
        }

        // Check if user already has badge
        const user = await client.db.collection('users').findOne({ discordId: userId });
        if (!user) {
            throw new Error('User not found');
        }

        if (user.badges && user.badges.includes(badgeId)) {
            throw new Error('User already has this badge');
        }

        // Add badge to user
        await client.db.collection('users').updateOne(
            { discordId: userId },
            { $push: { badges: badgeId } }
        );

        // Notify user
        const userObj = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('New Badge Earned!')
            .setDescription(`You have earned the ${badge.name} badge!`)
            .addFields(
                { name: 'Description', value: badge.description }
            )
            .setTimestamp();

        await userObj.send({ embeds: [embed] }).catch(() => {});

        return badge;

    } catch (error) {
        logger.error('Error in assignBadge:', error);
        throw error;
    }
}

/**
 * Remove a badge from a user
 */
async function removeBadge(client, userId, badgeId) {
    try {
        // Check if badge exists
        const badge = await client.db.collection('badges').findOne({ badgeId });
        if (!badge) {
            throw new Error('Badge not found');
        }

        // Remove badge from user
        const result = await client.db.collection('users').updateOne(
            { discordId: userId },
            { $pull: { badges: badgeId } }
        );

        if (result.modifiedCount === 0) {
            throw new Error('User does not have this badge');
        }

        // Notify user
        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Badge Removed')
            .setDescription(`The ${badge.name} badge has been removed from your profile.`)
            .setTimestamp();

        await user.send({ embeds: [embed] }).catch(() => {});

        return badge;

    } catch (error) {
        logger.error('Error in removeBadge:', error);
        throw error;
    }
}

/**
 * Delete a badge from the system
 */
async function deleteBadge(client, badgeId) {
    try {
        // Check if badge exists
        const badge = await client.db.collection('badges').findOne({ badgeId });
        if (!badge) {
            throw new Error('Badge not found');
        }

        // Remove badge from all users
        await client.db.collection('users').updateMany(
            { badges: badgeId },
            { $pull: { badges: badgeId } }
        );

        // Delete badge
        await client.db.collection('badges').deleteOne({ badgeId });

        return badge;

    } catch (error) {
        logger.error('Error in deleteBadge:', error);
        throw error;
    }
}

/**
 * Update win streak badge
 */
async function updateWinStreakBadge(client, userId, winStreak) {
    try {
        const user = await client.db.collection('users').findOne({ discordId: userId });
        if (!user) {
            throw new Error('User not found');
        }

        // Determine badge variant
        const variant = Math.min(winStreak, 10);
        const badgeInfo = BADGE_TYPES.WIN_STREAK.variants[variant];

        // Remove old win streak badge if exists
        const oldBadge = user.badges?.find(b => b.startsWith('win_streak_'));
        if (oldBadge) {
            await removeBadge(client, userId, oldBadge);
        }

        // Add new win streak badge
        const badgeId = `win_streak_${variant}`;
        await assignBadge(client, userId, badgeId);

        return badgeInfo;

    } catch (error) {
        logger.error('Error in updateWinStreakBadge:', error);
        throw error;
    }
}

/**
 * Update team mastery badge
 */
async function updateTeamMasteryBadge(client, userId, teamId, mastery) {
    try {
        const user = await client.db.collection('users').findOne({ discordId: userId });
        if (!user) {
            throw new Error('User not found');
        }

        // Determine badge variant
        let variant;
        if (mastery >= BADGE_TYPES.TEAM_MASTERY.variants.GOLD.threshold) {
            variant = 'GOLD';
        } else if (mastery >= BADGE_TYPES.TEAM_MASTERY.variants.SILVER.threshold) {
            variant = 'SILVER';
        } else if (mastery >= BADGE_TYPES.TEAM_MASTERY.variants.BRONZE.threshold) {
            variant = 'BRONZE';
        } else {
            return null;
        }

        const team = Object.values(BADGE_TYPES.TEAM_MASTERY.teams).find(t => t.id === teamId);
        if (!team) {
            throw new Error('Invalid team ID');
        }

        // Remove old team mastery badge if exists
        const oldBadge = user.badges?.find(b => b.startsWith(`badge_${teamId}_`));
        if (oldBadge) {
            await removeBadge(client, userId, oldBadge);
        }

        // Add new team mastery badge
        const badgeId = `badge_${teamId}_${variant.toLowerCase()}`;
        await assignBadge(client, userId, badgeId);

        return {
            variant,
            team,
            emoji: BADGE_TYPES.TEAM_MASTERY.variants[variant].emoji[team.name.toUpperCase()]
        };

    } catch (error) {
        logger.error('Error in updateTeamMasteryBadge:', error);
        throw error;
    }
}

/**
 * Get user's badges
 */
async function getUserBadges(client, userId) {
    try {
        const user = await client.db.collection('users').findOne({ discordId: userId });
        if (!user || !user.badges) {
            return [];
        }

        // Get badge details
        const badges = await client.db.collection('badges').find({
            badgeId: { $in: user.badges }
        }).toArray();

        return badges;

    } catch (error) {
        logger.error('Error in getUserBadges:', error);
        throw error;
    }
}

/**
 * Get badge display for user card
 */
async function getBadgeDisplay(client, userId) {
    try {
        const badges = await getUserBadges(client, userId);
        
        // Sort badges by priority (custom badges first, then win streak, then team mastery)
        badges.sort((a, b) => {
            if (a.badgeId.startsWith('win_streak_')) return 1;
            if (b.badgeId.startsWith('win_streak_')) return -1;
            if (a.badgeId.startsWith('badge_')) return 1;
            if (b.badgeId.startsWith('badge_')) return -1;
            return 0;
        });

        // Take top 3 badges
        return badges.slice(0, 3).map(badge => badge.emoji).join(' ');

    } catch (error) {
        logger.error('Error in getBadgeDisplay:', error);
        throw error;
    }
}

module.exports = {
    createBadge,
    assignBadge,
    removeBadge,
    deleteBadge,
    updateWinStreakBadge,
    updateTeamMasteryBadge,
    getUserBadges,
    getBadgeDisplay,
    BADGE_TYPES
}; 