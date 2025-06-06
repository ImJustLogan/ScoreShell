const moment = require('moment-timezone');
const config = require('../config/config');
const logger = require('./logger');

// Time and Date Helpers
const timeHelpers = {
    // Format a date with timezone
    formatDate: (date, format = 'YYYY-MM-DD HH:mm:ss', timezone = 'UTC') => {
        return moment(date).tz(timezone).format(format);
    },

    // Get relative time (e.g., "2 hours ago")
    getRelativeTime: (date) => {
        return moment(date).fromNow();
    },

    // Check if a date is within a certain duration
    isWithinDuration: (date, duration) => {
        return moment().diff(moment(date)) < duration;
    },

    // Add duration to a date
    addDuration: (date, amount, unit) => {
        return moment(date).add(amount, unit).toDate();
    }
};

// String Helpers
const stringHelpers = {
    // Generate a random string
    generateRandomString: (length = 8) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },

    // Truncate a string with ellipsis
    truncate: (str, length = 100) => {
        if (str.length <= length) return str;
        return str.slice(0, length) + '...';
    },

    // Convert string to title case
    toTitleCase: (str) => {
        return str.replace(
            /\w\S*/g,
            (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        );
    }
};

// Number Helpers
const numberHelpers = {
    // Format a number with commas
    formatNumber: (num) => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    // Clamp a number between min and max
    clamp: (num, min, max) => {
        return Math.min(Math.max(num, min), max);
    },

    // Calculate percentage
    percentage: (value, total) => {
        return Math.round((value / total) * 100);
    }
};

// Array Helpers
const arrayHelpers = {
    // Shuffle an array
    shuffle: (array) => {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    },

    // Get random item from array
    randomItem: (array) => {
        return array[Math.floor(Math.random() * array.length)];
    },

    // Remove duplicates from array
    unique: (array) => {
        return [...new Set(array)];
    }
};

// Discord Helpers
const discordHelpers = {
    // Format a user mention
    formatMention: (userId) => {
        return `<@${userId}>`;
    },

    // Format a role mention
    formatRoleMention: (roleId) => {
        return `<@&${roleId}>`;
    },

    // Format a channel mention
    formatChannelMention: (channelId) => {
        return `<#${channelId}>`;
    },

    // Check if a string is a valid Discord ID
    isValidId: (id) => {
        return /^\d{17,19}$/.test(id);
    }
};

// Game Helpers
const gameHelpers = {
    // Generate a room code
    generateRoomCode: () => {
        return stringHelpers.generateRandomString(6);
    },

    // Calculate rep change based on match outcome
    calculateRepChange: (winnerRep, loserRep, scoreDiff, winStreak) => {
        const config = require('../config/config');
        const { rankedMatch } = config;

        let repChange = rankedMatch.baseRepGain;

        // Rep difference bonus/penalty
        const repDiff = Math.abs(winnerRep - loserRep);
        repChange += Math.min(20, Math.floor(repDiff * rankedMatch.repDifferenceMultiplier));

        // Run differential bonus
        repChange += Math.min(30, scoreDiff * rankedMatch.rdMultiplier);

        // Win streak bonus
        repChange += Math.min(20, winStreak * rankedMatch.winStreakMultiplier);

        // Apply hypercharge if active
        if (Math.random() < rankedMatch.hyperchargeChance) {
            repChange *= (1 + rankedMatch.hyperchargeMultiplier);
        }

        // Ensure within bounds
        return Math.round(numberHelpers.clamp(
            repChange,
            rankedMatch.minRepGain,
            rankedMatch.maxRepGain
        ));
    },

    // Check if a match is eligible for hypercharge
    checkHypercharge: () => {
        return Math.random() < config.rankedMatch.hyperchargeChance;
    }
};

// Error Helpers
const errorHelpers = {
    // Create a custom error with additional data
    createError: (message, code, data = {}) => {
        const error = new Error(message);
        error.code = code;
        error.data = data;
        return error;
    },

    // Handle async errors
    asyncHandler: (fn) => {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    },

    // Log error with context
    logError: (error, context = {}) => {
        logger.error(error.message, {
            error,
            context,
            stack: error.stack
        });
    }
};

/**
 * Validates a community code according to the design doc requirements
 * @param {string} code - The community code to validate
 * @returns {boolean} - Whether the code is valid
 */
function validateCommunityCode(code) {
    // Must be 3-5 characters
    if (code.length < 3 || code.length > 5) return false;
    
    // Must contain only letters and numbers
    return /^[A-Z0-9]+$/.test(code);
}

// Rank and Rep Helpers
const RANKS = {
    BRONZE: {
        emoji: '1348460284951400570',
        color: '#f59833',
        tiers: [
            { name: 'Bronze I', points: 0 },
            { name: 'Bronze II', points: 500 },
            { name: 'Bronze III', points: 1000 }
        ]
    },
    SILVER: {
        emoji: '1348460318753296466',
        color: '#6774c9',
        tiers: [
            { name: 'Silver I', points: 1500 },
            { name: 'Silver II', points: 2000 },
            { name: 'Silver III', points: 2500 }
        ]
    },
    GOLD: {
        emoji: '1348460332825186326',
        color: '#ffc11b',
        tiers: [
            { name: 'Gold I', points: 3000 },
            { name: 'Gold II', points: 3500 },
            { name: 'Gold III', points: 4000 }
        ]
    },
    DIAMOND: {
        emoji: '1348460344049401877',
        color: '#05c2f7',
        tiers: [
            { name: 'Diamond I', points: 4500 },
            { name: 'Diamond II', points: 5000 },
            { name: 'Diamond III', points: 5500 }
        ]
    },
    MYTHIC: {
        emoji: '1348460358951768084',
        color: '#ce17ef',
        tiers: [
            { name: 'Mythic I', points: 6000 },
            { name: 'Mythic II', points: 6500 },
            { name: 'Mythic III', points: 7000 }
        ]
    },
    LEGENDARY: {
        emoji: '1348460371392073829',
        color: '#fc3434',
        tiers: [
            { name: 'Legendary I', points: 7500 },
            { name: 'Legendary II', points: 8000 },
            { name: 'Legendary III', points: 8500 }
        ]
    },
    MASTERS: {
        emoji: '1348460383396167681',
        color: '#741904',
        tiers: [
            { name: 'Masters', points: 9000 }
        ]
    }
};

/**
 * Gets the rank emoji for a given rep amount
 * @param {number} rep - The player's rep amount
 * @returns {string} The rank emoji
 */
function getRankEmoji(rep) {
    const rank = getRankFromRep(rep);
    return `<:rank_${rank.toLowerCase()}:${RANKS[rank].emoji}>`;
}

/**
 * Gets the rank name for a given rep amount
 * @param {number} rep - The player's rep amount
 * @returns {string} The rank name (e.g., "Bronze I", "Masters")
 */
function getRankFromRep(rep) {
    // Check each rank in order
    for (const [rank, data] of Object.entries(RANKS)) {
        // For all ranks except Masters, check tiers
        if (rank !== 'MASTERS') {
            for (let i = data.tiers.length - 1; i >= 0; i--) {
                if (rep >= data.tiers[i].points) {
                    return data.tiers[i].name;
                }
            }
        } else {
            // Masters rank
            if (rep >= data.tiers[0].points) {
                return 'Masters';
            }
        }
    }
    // Default to Bronze I if somehow below 0
    return 'Bronze I';
}

/**
 * Gets the rank color for a given rep amount
 * @param {number} rep - The player's rep amount
 * @returns {string} The rank color hex code
 */
function getRankColor(rep) {
    for (const [rank, data] of Object.entries(RANKS)) {
        if (rank === 'MASTERS') {
            if (rep >= data.tiers[0].points) return data.color;
        } else {
            for (let i = data.tiers.length - 1; i >= 0; i--) {
                if (rep >= data.tiers[i].points) return data.color;
            }
        }
    }
    return RANKS.BRONZE.color;
}

/**
 * Calculates rep change based on the ranked formula from the design doc
 * @param {number} winnerRep - Winner's current rep
 * @param {number} loserRep - Loser's current rep
 * @param {number} scoreDiff - Score difference (winner - loser)
 * @param {number} winStreak - Winner's current win streak
 * @returns {number} The rep change amount
 */
function calculateRepChange(winnerRep, loserRep, scoreDiff, winStreak) {
    // Base rep for winning
    let rep = 75;

    // Rep difference bonus (up to 20)
    const repDiff = Math.abs(winnerRep - loserRep);
    const repDiffBonus = Math.min(Math.floor(repDiff / 225), 20);
    rep += repDiffBonus;

    // Run differential bonus (up to 30)
    // Each RD scores 3 REP, capped at 30
    const rdBonus = Math.min(scoreDiff * 3, 30);
    rep += rdBonus;

    // Win streak bonus (up to 20)
    // Each win scores 2 REP, capped at 10 wins (20 rep)
    const streakBonus = Math.min(winStreak * 2, 20);
    rep += streakBonus;

    // Ensure minimum of 95 and maximum of 145 for wins
    // With max win streak (10), max is 145
    // Without win streak, max is 125
    const maxRep = winStreak >= 10 ? 145 : 125;
    rep = Math.max(Math.min(rep, maxRep), 95);

    return rep;
}

// Export all helpers
module.exports = {
    time: timeHelpers,
    string: stringHelpers,
    number: numberHelpers,
    array: arrayHelpers,
    discord: discordHelpers,
    game: gameHelpers,
    error: errorHelpers,
    validateCommunityCode,
    getRankEmoji,
    getRankFromRep,
    getRankColor,
    calculateRepChange
}; 