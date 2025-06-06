const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');

// Constants for rep calculation
const BASE_WIN_REP = 75;
const BASE_LOSS_REP = -75;
const MAX_REP_DIFFERENCE = 20; // Maximum rep from rank difference
const MAX_RD_REP = 30; // Maximum rep from run differential
const MAX_WINSTREAK_REP = 20; // Maximum rep from win streak
const REP_PER_RANK_DIFF = 225; // Rep points per rank difference
const RD_REP_MULTIPLIER = 3; // Rep points per run differential
const WINSTREAK_REP_MULTIPLIER = 2; // Rep points per win in streak
const MAX_WINSTREAK = 10; // Maximum win streak bonus
const MATCH_TIMEOUT = 5400000; // 1.5 hours in milliseconds

/**
 * Handle match outcome reporting
 */
async function handleOutcome(client, userId, matchId, playerScore, opponentScore) {
    try {
        const match = await client.db.collection('matches').findOne({ _id: matchId });
        if (!match) {
            throw new Error('Match not found');
        }

        // Validate user is in the match
        const player = match.players.find(p => p.userId === userId);
        if (!player) {
            throw new Error('You are not registered in this match');
        }

        // Get opponent
        const opponent = match.players.find(p => p.userId !== userId);

        // Update match with reported scores
        const update = {
            $set: {
                [`players.$[player].reportedScore`]: {
                    score: playerScore,
                    opponentScore: opponentScore,
                    timestamp: new Date()
                }
            }
        };

        await client.db.collection('matches').updateOne(
            { _id: matchId },
            update,
            { arrayFilters: [{ 'player.userId': userId }] }
        );

        // Get updated match data
        const updatedMatch = await client.db.collection('matches').findOne({ _id: matchId });
        const [player1Report, player2Report] = updatedMatch.players.map(p => p.reportedScore);

        // Check if both players have reported
        if (player1Report && player2Report) {
            // Verify scores match
            if (player1Report.score === player2Report.opponentScore && 
                player1Report.opponentScore === player2Report.score) {
                // Scores match, process the match
                await processMatchOutcome(client, updatedMatch);
            } else {
                // Scores don't match, mark as disputed
                await handleDisputedMatch(client, updatedMatch);
            }
        } else {
            // Set timeout for single report
            if (!updatedMatch.outcomeTimeout) {
                await client.db.collection('matches').updateOne(
                    { _id: matchId },
                    {
                        $set: {
                            outcomeTimeout: new Date(Date.now() + MATCH_TIMEOUT)
                        }
                    }
                );

                // Schedule reminder for unreported player
                setTimeout(async () => {
                    const currentMatch = await client.db.collection('matches').findOne({ _id: matchId });
                    if (currentMatch && currentMatch.status === 'IN_PROGRESS') {
                        const unreportedPlayer = currentMatch.players.find(p => !p.reportedScore);
                        if (unreportedPlayer) {
                            const user = await client.users.fetch(unreportedPlayer.userId);
                            await user.send(
                                'Please use /outcome before starting another match, even if the other player already did. ' +
                                'This helps keep players from abusing the system and lying about scores.'
                            ).catch(() => {});
                        }
                    }
                }, MATCH_TIMEOUT);
            }
        }

    } catch (error) {
        logger.error('Error in handleOutcome:', error);
        throw error;
    }
}

/**
 * Process a match outcome when both players have reported matching scores
 */
async function processMatchOutcome(client, match) {
    try {
        const [player1, player2] = match.players;
        const [player1Data, player2Data] = await Promise.all([
            client.db.collection('users').findOne({ discordId: player1.userId }),
            client.db.collection('users').findOne({ discordId: player2.userId })
        ]);

        // Calculate rep changes
        const player1RepChange = calculateRepChange(
            player1Data,
            player2Data,
            player1.reportedScore.score,
            player1.reportedScore.opponentScore,
            player1Data.winStreak || 0
        );

        const player2RepChange = calculateRepChange(
            player2Data,
            player1Data,
            player2.reportedScore.score,
            player2.reportedScore.opponentScore,
            player2Data.winStreak || 0
        );

        // Update player stats
        await Promise.all([
            updatePlayerStats(client, player1.userId, player1RepChange, player1.reportedScore.score > player2.reportedScore.score),
            updatePlayerStats(client, player2.userId, player2RepChange, player2.reportedScore.score > player1.reportedScore.score)
        ]);

        // Update match status
        await client.db.collection('matches').updateOne(
            { _id: match._id },
            {
                $set: {
                    status: 'COMPLETED',
                    endTime: new Date(),
                    'players.0.repChange': player1RepChange,
                    'players.1.repChange': player2RepChange
                }
            }
        );

        // Send outcome messages to players
        await sendOutcomeMessages(client, match, player1RepChange, player2RepChange);

        // Handle club league if applicable
        if (await isClubLeagueActive(client)) {
            await handleClubLeagueMatch(client, match, player1RepChange, player2RepChange);
        }

    } catch (error) {
        logger.error('Error in processMatchOutcome:', error);
        throw error;
    }
}

/**
 * Calculate rep change for a player
 */
function calculateRepChange(playerData, opponentData, playerScore, opponentScore, winStreak) {
    const isWin = playerScore > opponentScore;
    const isTie = playerScore === opponentScore;
    const baseRep = isWin ? BASE_WIN_REP : (isTie ? BASE_WIN_REP / 2 : BASE_LOSS_REP);

    // Calculate rep from rank difference
    const rankDiff = Math.abs(playerData.rep - opponentData.rep);
    const rankDiffRep = Math.min(
        Math.floor(rankDiff / REP_PER_RANK_DIFF),
        MAX_REP_DIFFERENCE
    );

    // Calculate rep from run differential
    const runDiff = Math.abs(playerScore - opponentScore);
    const rdRep = Math.min(runDiff * RD_REP_MULTIPLIER, MAX_RD_REP);

    // Calculate rep from win streak
    const winStreakRep = isWin ? 
        Math.min(winStreak * WINSTREAK_REP_MULTIPLIER, MAX_WINSTREAK_REP) : 0;

    // Calculate total rep change
    let totalRep = baseRep;
    if (isWin) {
        totalRep += rankDiffRep + rdRep + winStreakRep;
    } else if (!isTie) {
        totalRep -= rankDiffRep + rdRep;
    }

    // Apply hypercharge if active
    if (await isHyperchargeActive()) {
        const multiplier = await getHyperchargeMultiplier();
        totalRep = Math.round(totalRep * (1 + multiplier / 100));
    }

    return totalRep;
}

/**
 * Update player stats after a match
 */
async function updatePlayerStats(client, userId, repChange, isWin) {
    const update = {
        $inc: { rep: repChange },
        $set: { lastMatch: new Date() }
    };

    // Update win streak
    if (isWin) {
        update.$inc.winStreak = 1;
    } else {
        update.$set.winStreak = 0;
    }

    // Ensure rep doesn't go below 0
    const player = await client.db.collection('users').findOne({ discordId: userId });
    if (player.rep + repChange < 0) {
        update.$set.rep = 0;
    }

    await client.db.collection('users').updateOne(
        { discordId: userId },
        update
    );
}

/**
 * Send outcome messages to players
 */
async function sendOutcomeMessages(client, match, player1RepChange, player2RepChange) {
    const [player1, player2] = match.players;
    const [player1User, player2User] = await Promise.all([
        client.users.fetch(player1.userId),
        client.users.fetch(player2.userId)
    ]);

    // Get updated player data
    const [player1Data, player2Data] = await Promise.all([
        client.db.collection('users').findOne({ discordId: player1.userId }),
        client.db.collection('users').findOne({ discordId: player2.userId })
    ]);

    // Create outcome embeds
    const player1Embed = createOutcomeEmbed(
        player1User,
        player2User,
        player1.reportedScore.score,
        player2.reportedScore.score,
        player1RepChange,
        player1Data.rep,
        player1Data.rank,
        player1Data.winStreak
    );

    const player2Embed = createOutcomeEmbed(
        player2User,
        player1User,
        player2.reportedScore.score,
        player1.reportedScore.score,
        player2RepChange,
        player2Data.rep,
        player2Data.rank,
        player2Data.winStreak
    );

    // Send outcome messages
    await Promise.all([
        player1User.send({ embeds: [player1Embed] }).catch(() => {}),
        player2User.send({ embeds: [player2Embed] }).catch(() => {})
    ]);
}

/**
 * Create an outcome embed for a player
 */
function createOutcomeEmbed(player, opponent, playerScore, opponentScore, repChange, newRep, rank, winStreak) {
    const isWin = playerScore > opponentScore;
    const isTie = playerScore === opponentScore;
    const color = isWin ? '#00ff00' : (isTie ? '#ffff00' : '#ff0000');
    const result = isWin ? 'Victory' : (isTie ? 'Tie' : 'Defeat');

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`Match ${result}`)
        .setDescription(`${player} vs ${opponent}`)
        .addFields(
            {
                name: 'Score',
                value: `${playerScore} - ${opponentScore}`,
                inline: true
            },
            {
                name: 'Rep Change',
                value: `${repChange > 0 ? '+' : ''}${repChange}`,
                inline: true
            },
            {
                name: 'New Rep',
                value: newRep.toString(),
                inline: true
            },
            {
                name: 'Rank',
                value: rank,
                inline: true
            }
        )
        .setTimestamp();

    if (isWin && winStreak > 0) {
        embed.addFields({
            name: 'Win Streak',
            value: `${winStreak} wins`,
            inline: true
        });
    }

    return embed;
}

/**
 * Handle a disputed match
 */
async function handleDisputedMatch(client, match) {
    try {
        // Update match status
        await client.db.collection('matches').updateOne(
            { _id: match._id },
            {
                $set: {
                    status: 'DISPUTED',
                    disputedAt: new Date()
                }
            }
        );

        // Get player data
        const [player1, player2] = match.players;
        const [player1User, player2User] = await Promise.all([
            client.users.fetch(player1.userId),
            client.users.fetch(player2.userId)
        ]);

        // Create dispute embed
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Match Disputed')
            .setDescription('Scores reported by players do not match.')
            .addFields(
                {
                    name: `${player1User}'s Report`,
                    value: `${player1.reportedScore.score} - ${player1.reportedScore.opponentScore}`,
                    inline: true
                },
                {
                    name: `${player2User}'s Report`,
                    value: `${player2.reportedScore.score} - ${player2.reportedScore.opponentScore}`,
                    inline: true
                }
            )
            .setTimestamp();

        // Send dispute notification to players
        await Promise.all([
            player1User.send({ 
                content: 'Scores don\'t match; a moderator will review.',
                embeds: [embed]
            }).catch(() => {}),
            player2User.send({ 
                content: 'Scores don\'t match; a moderator will review.',
                embeds: [embed]
            }).catch(() => {})
        ]);

        // Add to moderator queue
        await client.db.collection('modQueue').insertOne({
            type: 'SCORE_DISPUTE',
            matchId: match._id,
            player1: {
                userId: player1.userId,
                score: player1.reportedScore.score,
                opponentScore: player1.reportedScore.opponentScore,
                timestamp: player1.reportedScore.timestamp
            },
            player2: {
                userId: player2.userId,
                score: player2.reportedScore.score,
                opponentScore: player2.reportedScore.opponentScore,
                timestamp: player2.reportedScore.timestamp
            },
            createdAt: new Date()
        });

    } catch (error) {
        logger.error('Error in handleDisputedMatch:', error);
        throw error;
    }
}

/**
 * Check if club league is active
 */
async function isClubLeagueActive(client) {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfWeek = new Date(firstDayOfMonth);
    lastDayOfWeek.setDate(firstDayOfMonth.getDate() + 6);

    return now >= firstDayOfMonth && now <= lastDayOfWeek;
}

/**
 * Handle club league match
 */
async function handleClubLeagueMatch(client, match, player1RepChange, player2RepChange) {
    try {
        const [player1, player2] = match.players;
        const [player1Data, player2Data] = await Promise.all([
            client.db.collection('users').findOne({ discordId: player1.userId }),
            client.db.collection('users').findOne({ discordId: player2.userId })
        ]);

        // Check if both players are in clubs
        if (!player1Data.clubId || !player2Data.clubId) return;

        // Calculate club rep changes
        const player1ClubRep = calculateClubRep(
            player1.reportedScore.score,
            player2.reportedScore.score
        );
        const player2ClubRep = calculateClubRep(
            player2.reportedScore.score,
            player1.reportedScore.score
        );

        // Update club rep
        await Promise.all([
            updateClubRep(client, player1Data.clubId, player1ClubRep),
            updateClubRep(client, player2Data.clubId, player2ClubRep)
        ]);

    } catch (error) {
        logger.error('Error in handleClubLeagueMatch:', error);
    }
}

/**
 * Calculate club rep for a match
 */
function calculateClubRep(playerScore, opponentScore) {
    const isWin = playerScore > opponentScore;
    const baseRep = isWin ? 70 : -10;
    const runDiff = Math.abs(playerScore - opponentScore);
    const rdBonus = Math.min(runDiff * 3, 30);

    return isWin ? baseRep + rdBonus : baseRep;
}

/**
 * Update club rep
 */
async function updateClubRep(client, clubId, repChange) {
    const club = await client.db.collection('clubs').findOne({ _id: clubId });
    if (!club) return;

    const newRep = Math.max(0, (club.currentRep || 0) + repChange);
    await client.db.collection('clubs').updateOne(
        { _id: clubId },
        { $inc: { currentRep: repChange } }
    );
}

/**
 * Check if hypercharge is active
 */
async function isHyperchargeActive() {
    // TODO: Implement hypercharge check
    return false;
}

/**
 * Get current hypercharge multiplier
 */
async function getHyperchargeMultiplier() {
    // TODO: Implement hypercharge multiplier
    return 0;
}

module.exports = {
    handleOutcome,
    processMatchOutcome,
    handleDisputedMatch
}; 