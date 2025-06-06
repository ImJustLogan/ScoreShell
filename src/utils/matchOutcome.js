const logger = require('./logger');
const { EmbedBuilder } = require('discord.js');
const { RANKS } = require('./rankedSystem');
const { createPostMatchEmbed, createRankUpEmbed } = require('./rankMessages');
const RankManager = require('./rankManager');

// Constants for match outcome processing
const MATCH_OUTCOME_CONFIG = {
    MATCH_TIMEOUT: 5400000, // 1.5 hours
    REMINDER_TIMEOUT: 5400000, // 1.5 hours
    DISPUTE_THRESHOLD: 2, // Number of score disagreements before marking as disputed
    DISPUTE_TIMEOUT: 86400000, // 24 hours to resolve dispute
    REMINDER_INTERVAL: 3600000, // 1 hour between reminders
    MAX_REMINDERS: 3 // Maximum number of reminders to send
};

// Win streak badge variants
const WIN_STREAK_BADGES = {
    0: '1316513861351768085',  // Reset
    1: '1316513918826319962',
    2: '1316513943925161985',
    3: '1316513965337219113',
    4: '1316513984425230368',
    5: '1316514025970073710',
    6: '1316514043220983870',
    7: '1316514068470829076',
    8: '1316514084212047963',
    9: '1316514100662243498',
    10: '1316514117422551151'  // Max
};

// Team mastery badges
const TEAM_MASTERY_BADGES = {
    MARIO: { bronze: '1336842844719026327', silver: '1336842873282498560', gold: '1336842899169607794' },
    LUIGI: { bronze: '1336842919776092160', silver: '1336842940374454275', gold: '1336843203923546257' },
    PEACH: { bronze: '1336843223842295919', silver: '1336843289281695745', gold: '1336843334483710012' },
    DAISY: { bronze: '1336843359062458388', silver: '1336843383989211148', gold: '1336843412426588161' },
    YOSHI: { bronze: '1336843434010611723', silver: '1336843454113779824', gold: '1336843477589168199' },
    BIRDO: { bronze: '1336843501727518761', silver: '1336843526301814806', gold: '1336843548540014654' },
    WARIO: { bronze: '1336843568689582091', silver: '1336843588725637220', gold: '1336843613921087559' },
    WALUIGI: { bronze: '1336843640017915935', silver: '1336843662834929745', gold: '1336843762248454205' },
    DONKEY_KONG: { bronze: '1336843783572029471', silver: '1336843802408783965', gold: '1336843824932323408' },
    DIDDY_KONG: { bronze: '1336843857966403697', silver: '1336843877448941588', gold: '1336843895010754713' },
    BOWSER: { bronze: '1336843909384372317', silver: '1336843925238845460', gold: '1336843945061384233' },
    BOWSER_JR: { bronze: '1336843958940205107', silver: '1336843974463459348', gold: '1336843974463459348' }
};

// Team mastery thresholds
const MASTERY_THRESHOLDS = {
    BRONZE: 500,
    SILVER: 2000,
    GOLD: 3500
};

/**
 * Calculate rep change for a match
 */
function calculateRepChange(winner, loser, winnerScore, loserScore, isHypercharged = false) {
    // Base rep gain/loss
    let repChange = 75;

    // Run differential bonus (capped at 30)
    const runDiff = Math.abs(winnerScore - loserScore);
    const rdBonus = Math.min(runDiff * 3, 30);
    repChange += rdBonus;

    // Rep difference bonus/penalty (capped at 20)
    const repDiff = Math.abs(winner.rep - loser.rep);
    const repDiffBonus = Math.min(Math.floor(repDiff / 225), 20);
    
    if (winner.rep < loser.rep) {
        // Underdog bonus
        repChange += repDiffBonus;
    } else {
        // Advantage penalty
        repChange -= repDiffBonus;
    }

    // Win streak bonus (capped at 20)
    const winStreakBonus = Math.min(winner.winStreak * 2, 20);
    repChange += winStreakBonus;

    // Apply hypercharge if active
    if (isHypercharged) {
        repChange = Math.floor(repChange * 1.5);
    }

    // Ensure minimum rep gain of 95 and maximum of 145
    repChange = Math.max(95, Math.min(145, repChange));

    return {
        winner: repChange,
        loser: -Math.floor(repChange * 0.8) // Loser loses 80% of what winner gains
    };
}

/**
 * Calculate club rep for a match
 */
function calculateClubRep(winnerScore, loserScore) {
    // Base club rep gain
    let clubRep = 70;

    // Run differential bonus (capped at 30)
    const runDiff = Math.abs(winnerScore - loserScore);
    const rdBonus = Math.min(runDiff * 3, 30);
    clubRep += rdBonus;

    // Ensure maximum of 100
    clubRep = Math.min(100, clubRep);

    return {
        winner: clubRep,
        loser: -10 // Fixed loss penalty
    };
}

/**
 * Get rank info based on rep
 */
function getRankInfo(rep) {
    if (rep >= RANKS.MASTERS.threshold) {
        return {
            rank: 'MASTERS',
            tier: null,
            emoji: RANKS.MASTERS.emoji,
            color: RANKS.MASTERS.color
        };
    }

    for (const [rank, data] of Object.entries(RANKS)) {
        if (rank === 'MASTERS') continue;
        
        for (let i = 0; i < data.thresholds.length; i++) {
            if (rep < data.thresholds[i]) {
                return {
                    rank,
                    tier: i + 1,
                    emoji: data.emoji,
                    color: data.color
                };
            }
        }
    }

    // Fallback to MASTERS if somehow above all thresholds
    return {
        rank: 'MASTERS',
        tier: null,
        emoji: RANKS.MASTERS.emoji,
        color: RANKS.MASTERS.color
    };
}

/**
 * Get team mastery badge for a captain
 */
function getTeamMasteryBadge(captain, mastery) {
    const badges = TEAM_MASTERY_BADGES[captain.toUpperCase()];
    if (!badges) return null;

    if (mastery >= MASTERY_THRESHOLDS.GOLD) {
        return badges.gold;
    } else if (mastery >= MASTERY_THRESHOLDS.SILVER) {
        return badges.silver;
    } else if (mastery >= MASTERY_THRESHOLDS.BRONZE) {
        return badges.bronze;
    }
    return null;
}

/**
 * Create rank up embed
 */
function createRankUpEmbed(user, oldRank, newRank) {
    return new EmbedBuilder()
        .setColor(newRank.color)
        .setTitle('Rank Up!')
        .setDescription(`Congratulations <@${user.discordId}>! You've reached ${newRank.rank} ${newRank.tier ? `Tier ${newRank.tier}` : ''}!`)
            .addFields(
            { name: 'New Rank', value: `<:rank_${newRank.rank.toLowerCase()}:${newRank.emoji}> ${newRank.rank} ${newRank.tier ? `Tier ${newRank.tier}` : ''}`, inline: true },
            { name: 'Rep', value: `${user.rep}`, inline: true }
        )
        .setTimestamp();
}

/**
 * Create match outcome embed
 */
function createMatchOutcomeEmbed(match, winner, loser, winnerScore, loserScore, repChange, isHypercharged = false) {
    const winnerRank = getRankInfo(winner.rep);
    const loserRank = getRankInfo(loser.rep);

    return new EmbedBuilder()
        .setColor(winnerRank.color)
        .setTitle('Match Complete!')
        .setDescription(`<@${winner.discordId}> defeated <@${loser.discordId}>`)
        .addFields(
            { name: 'Score', value: `${winnerScore} - ${loserScore}`, inline: true },
            { name: 'Stage', value: match.stage, inline: true },
            { name: 'Captains', value: `${match.players[0].captain} vs ${match.players[1].captain}`, inline: true },
            { name: 'Rep Change', value: `+${repChange.winner} (${isHypercharged ? 'Hypercharged!' : ''})`, inline: true },
            { name: 'Winner Rank', value: `<:rank_${winnerRank.rank.toLowerCase()}:${winnerRank.emoji}> ${winnerRank.rank} ${winnerRank.tier ? `Tier ${winnerRank.tier}` : ''}`, inline: true },
            { name: 'Loser Rank', value: `<:rank_${loserRank.rank.toLowerCase()}:${loserRank.emoji}> ${loserRank.rank} ${loserRank.tier ? `Tier ${loserRank.tier}` : ''}`, inline: true }
        )
        .setTimestamp();
}

/**
 * Process match outcome
 */
async function processMatchOutcome(client, match, winnerId, winnerScore, loserScore) {
    try {
        // Get player data
        const [winner, loser] = match.players.map(p => 
            p.userId === winnerId ? { ...p, isWinner: true } : { ...p, isWinner: false }
        );

        // Get user data from database
        const [winnerData, loserData] = await Promise.all([
            client.db.collection('users').findOne({ discordId: winner.userId }),
            client.db.collection('users').findOne({ discordId: loser.userId })
        ]);

        if (!winnerData || !loserData) {
            throw new Error('User data not found');
        }

        // Check for hypercharge (10% chance)
        const isHypercharged = Math.random() < 0.1;

        // Calculate rep changes
        const repChange = calculateRepChange(
            winnerData,
            loserData,
            winnerScore,
            loserScore,
            isHypercharged
        );

        // Update user data
        const winnerUpdates = {
            $inc: {
                rep: repChange.winner,
                winStreak: 1,
                [`mastery.${winner.captain}`]: repChange.winner
            }
        };

        const loserUpdates = {
            $inc: {
                rep: repChange.loser,
                [`mastery.${loser.captain}`]: 50 // Fixed mastery gain for losses
            },
            $set: {
                winStreak: 0
            }
        };

        // Get new ranks
        const newWinnerRank = getRankInfo(winnerData.rep + repChange.winner);
        const newLoserRank = getRankInfo(loserData.rep + repChange.loser);

        // Check for rank up
        const oldWinnerRank = getRankInfo(winnerData.rep);
        const rankUp = oldWinnerRank.rank !== newWinnerRank.rank || oldWinnerRank.tier !== newWinnerRank.tier;

        // Check for team mastery badges
        const winnerMastery = (winnerData.mastery?.[winner.captain] || 0) + repChange.winner;
        const loserMastery = (loserData.mastery?.[loser.captain] || 0) + 50;

        const winnerMasteryBadge = getTeamMasteryBadge(winner.captain, winnerMastery);
        const loserMasteryBadge = getTeamMasteryBadge(loser.captain, loserMastery);

        // Update badges if needed
        if (winnerMasteryBadge) {
            winnerUpdates.$addToSet = { badges: winnerMasteryBadge };
        }
        if (loserMasteryBadge) {
            loserUpdates.$addToSet = { badges: loserMasteryBadge };
        }

        // Update win streak badge
        const newWinStreak = winnerData.winStreak + 1;
        const winStreakBadge = WIN_STREAK_BADGES[Math.min(newWinStreak, 10)];
        if (winStreakBadge) {
            winnerUpdates.$addToSet = { badges: winStreakBadge };
        }

        // Update users in database
        await Promise.all([
            client.db.collection('users').updateOne(
                { discordId: winner.userId },
                winnerUpdates
            ),
            client.db.collection('users').updateOne(
                { discordId: loser.userId },
                loserUpdates
            )
        ]);

        // Update match in database
        await client.db.collection('matches').updateOne(
            { _id: match._id },
            {
                $set: {
                    status: 'COMPLETED',
                    endTime: new Date(),
                    winner: winner.userId,
                    scores: {
                        [winner.userId]: winnerScore,
                        [loser.userId]: loserScore
                    },
                    repChange: {
                        [winner.userId]: repChange.winner,
                        [loser.userId]: repChange.loser
                    },
                    isHypercharged
                }
            }
        );

        // Check for club league
        const [winnerClub, loserClub] = await Promise.all([
            client.db.collection('clubs').findOne({ 'members.userId': winner.userId }),
            client.db.collection('clubs').findOne({ 'members.userId': loser.userId })
        ]);

        if (winnerClub && loserClub) {
            const clubRep = calculateClubRep(winnerScore, loserScore);
            
            // Update club rep
            await Promise.all([
                client.db.collection('clubs').updateOne(
                    { _id: winnerClub._id },
                    { $inc: { rep: clubRep.winner } }
                ),
                client.db.collection('clubs').updateOne(
                    { _id: loserClub._id },
                    { $inc: { rep: Math.max(0, clubRep.loser) } } // Prevent negative club rep
                )
            ]);
        }

        // Create embeds
        const outcomeEmbed = createMatchOutcomeEmbed(
            match,
            { ...winnerData, ...winner },
            { ...loserData, ...loser },
            winnerScore,
            loserScore,
            repChange,
            isHypercharged
        );

        const embeds = [outcomeEmbed];
        if (rankUp) {
            embeds.push(createRankUpEmbed(
                { ...winnerData, ...winner },
                oldWinnerRank,
                newWinnerRank
            ));
        }

        // Get ranked channel
        const server = await client.db.collection('servers').findOne({
            'channels.ranked': { $exists: true }
        });

        if (server) {
            const channel = await client.channels.fetch(server.channels.ranked);
            if (channel) {
                await channel.send({ embeds });
            }
        }

        // Send DMs to players
        const [winnerUser, loserUser] = await Promise.all([
            client.users.fetch(winner.userId),
            client.users.fetch(loser.userId)
        ]);

        await Promise.all([
            winnerUser.send({ embeds }),
            loserUser.send({ embeds: [outcomeEmbed] })
        ]);

        return {
            success: true,
            embeds,
            repChange,
            isHypercharged,
            rankUp
        };

    } catch (error) {
        logger.error('Error processing match outcome:', error);
        throw error;
    }
}

module.exports = {
    MATCH_OUTCOME_CONFIG,
    processMatchOutcome,
    calculateRepChange,
    calculateClubRep,
    getRankInfo,
    getTeamMasteryBadge,
    createRankUpEmbed,
    createMatchOutcomeEmbed
}; 