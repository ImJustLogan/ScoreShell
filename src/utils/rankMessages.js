const { EmbedBuilder } = require('discord.js');
const { ranks } = require('../config/config');
const logger = require('./logger');

/**
 * Creates a progress bar for rank progression
 * @param {number} currentPoints - Current points
 * @param {number} nextTierPoints - Points needed for next tier
 * @param {number} currentTierPoints - Points needed for current tier
 * @returns {string} Progress bar string
 */
function createProgressBar(currentPoints, nextTierPoints, currentTierPoints) {
    const totalBlocks = 10;
    const progress = (currentPoints - currentTierPoints) / (nextTierPoints - currentTierPoints);
    const filledBlocks = Math.floor(progress * totalBlocks);
    
    return '▰'.repeat(filledBlocks) + '▱'.repeat(totalBlocks - filledBlocks);
}

/**
 * Gets the next tier information for a rank
 * @param {string} rank - Current rank
 * @param {string} tier - Current tier
 * @param {number} points - Current points
 * @returns {Object} Next tier information
 */
function getNextTierInfo(rank, tier, points) {
    const rankConfig = ranks[rank];
    
    // If in Masters, there is no next tier
    if (rank === 'MASTERS') {
        return { nextTier: null, nextTierPoints: null, currentTierPoints: rankConfig.points };
    }

    const tiers = Object.entries(rankConfig.tiers);
    const currentTierIndex = tiers.findIndex(([t]) => t === tier);
    
    // If in highest tier of current rank
    if (currentTierIndex === tiers.length - 1) {
        const nextRank = Object.keys(ranks)[Object.keys(ranks).indexOf(rank) + 1];
        return {
            nextTier: `${nextRank} I`,
            nextTierPoints: ranks[nextRank].tiers.I.points,
            currentTierPoints: rankConfig.tiers[tier].points
        };
    }

    // If in a tier within current rank
    const nextTier = tiers[currentTierIndex + 1];
    return {
        nextTier: `${rank} ${nextTier[0]}`,
        nextTierPoints: nextTier[1].points,
        currentTierPoints: rankConfig.tiers[tier].points
    };
}

/**
 * Creates a post-match embed
 * @param {Object} user - User object
 * @param {Object} opponent - Opponent object
 * @param {number} repChange - Reputation change
 * @param {boolean} isWin - Whether the user won
 * @returns {EmbedBuilder} Post-match embed
 */
function createPostMatchEmbed(user, opponent, repChange, isWin) {
    const { rank, tier, points } = user;
    const rankConfig = ranks[rank];
    const { nextTier, nextTierPoints, currentTierPoints } = getNextTierInfo(rank, tier, points);
    
    const progressBar = nextTier ? 
        createProgressBar(points, nextTierPoints, currentTierPoints) :
        '▰'.repeat(10); // Masters rank is always full

    const embed = new EmbedBuilder()
        .setColor(rankConfig.color)
        .setThumbnail(rankConfig.image)
        .setTitle(isWin ? 'Victory!' : 'Defeat')
        .setDescription(
            `You ${isWin ? 'won' : 'lost'} your match against **${opponent.username}** and ${isWin ? 'earned' : 'lost'} ${Math.abs(repChange)} rep!\n\n` +
            `${rankConfig.emoji} ${progressBar} ${nextTier || ''}`
        );

    return embed;
}

/**
 * Creates a rank-up embed
 * @param {Object} user - User object
 * @param {string} oldRank - Previous rank
 * @param {string} oldTier - Previous tier
 * @returns {EmbedBuilder} Rank-up embed
 */
function createRankUpEmbed(user, oldRank, oldTier) {
    const { rank, tier } = user;
    const rankConfig = ranks[rank];
    const oldRankConfig = ranks[oldRank];

    const embed = new EmbedBuilder()
        .setColor(rankConfig.color)
        .setThumbnail(oldRankConfig.image)
        .setTitle('Rank Up!')
        .setDescription(
            `Congratulations! You've advanced to ${rankConfig.emoji} **${rank} ${tier}**!\n\n` +
            `You've proven your skills and climbed from ${oldRankConfig.emoji} **${oldRank} ${oldTier}**.\n` +
            `Keep up the great work and aim for even greater heights!`
        );

    return embed;
}

module.exports = {
    createPostMatchEmbed,
    createRankUpEmbed
}; 