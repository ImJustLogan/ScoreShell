const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const logger = require('../../utils/logger');
const { getRankEmoji, calculateRepChange } = require('../../utils/helpers');
const { isClubLeagueMatch, updateClubLeagueMatch } = require('../../utils/clubLeague');
const { createPostMatchEmbed, createRankUpEmbed } = require('../../utils/rankMessages');
const { processMatchOutcome, sendPostMatchNotifications } = require('../../utils/matchOutcome');

module.exports = {
    category: 'ranked',
    data: new SlashCommandBuilder()
        .setName('outcome')
        .setDescription('Report the outcome of a ranked match')
        .addIntegerOption(option =>
            option.setName('your_score')
                .setDescription('Your final score')
                .setRequired(true)
                .setMinValue(0))
        .addIntegerOption(option =>
            option.setName('opponent_score')
                .setDescription('Your opponent\'s final score')
                .setRequired(true)
                .setMinValue(0)),

    async execute(interaction) {
        try {
            const yourScore = interaction.options.getInteger('your_score');
            const opponentScore = interaction.options.getInteger('opponent_score');

            // Find active match for user
            const match = await interaction.client.db.collection('matches').findOne({
                'players.userId': interaction.user.id,
                status: 'IN_PROGRESS',
                startTime: { $gte: new Date(Date.now() - 5400000) } // Within last 1.5 hours
            });

            if (!match) {
                return interaction.reply({
                    content: 'You don\'t have any active matches to report.',
                    ephemeral: true
                });
            }

            // Check if opponent has already reported
            const opponent = match.players.find(p => p.userId !== interaction.user.id);
            const opponentReport = await interaction.client.db.collection('reports').findOne({
                matchId: match._id,
                userId: opponent.userId
            });

            if (opponentReport) {
                // Check for dispute
                if (opponentReport.yourScore !== opponentScore || 
                    opponentReport.opponentScore !== yourScore) {
                    
                    // Create dispute
                    await interaction.client.db.collection('matches').updateOne(
                        { _id: match._id },
                        { 
                            $set: { 
                                status: 'DISPUTED',
                                dispute: {
                                    player1: {
                                        userId: interaction.user.id,
                                        yourScore,
                                        opponentScore
                                    },
                                    player2: {
                                        userId: opponent.userId,
                                        yourScore: opponentReport.yourScore,
                                        opponentScore: opponentReport.opponentScore
                                    },
                                    reportedAt: new Date()
                                }
                            }
                        }
                    );

                    // Notify players
                    const [player1User, player2User] = await Promise.all([
                        interaction.client.users.fetch(interaction.user.id),
                        interaction.client.users.fetch(opponent.userId)
                    ]);

                    const disputeEmbed = {
                        color: 0xff0000,
                        title: 'Score Dispute',
                        description: 'The reported scores don\'t match. A moderator will review this match.',
                        fields: [
                            {
                                name: `${player1User.username}'s Report`,
                                value: `Your Score: ${yourScore}\nOpponent's Score: ${opponentScore}`,
                                inline: true
                            },
                            {
                                name: `${player2User.username}'s Report`,
                                value: `Your Score: ${opponentReport.yourScore}\nOpponent's Score: ${opponentReport.opponentScore}`,
                                inline: true
                            }
                        ],
                        timestamp: new Date()
                    };

                    // Send to admin log channel
                    const server = await interaction.client.db.collection('servers').findOne({
                        'channels.adminLog': { $exists: true }
                    });

                    if (server) {
                        const channel = await interaction.client.channels.fetch(server.channels.adminLog);
                        if (channel) {
                            await channel.send({ embeds: [disputeEmbed] });
                        }
                    }

                    // Notify players
                    await Promise.all([
                        player1User.send('Scores don\'t match; a moderator will review.'),
                        player2User.send('Scores don\'t match; a moderator will review.')
                    ]);

                    return interaction.reply({
                        content: 'Scores don\'t match; a moderator will review.',
                        ephemeral: true
                    });
                }

                // Scores match, process outcome
                const winnerId = yourScore > opponentScore ? interaction.user.id : opponent.userId;
                const winnerScore = Math.max(yourScore, opponentScore);
                const loserScore = Math.min(yourScore, opponentScore);

                await processMatchOutcome(
                    interaction.client,
                    match,
                    winnerId,
                    winnerScore,
                    loserScore
                );

                // Delete reports
                await interaction.client.db.collection('reports').deleteMany({
                    matchId: match._id
                });

                return interaction.reply({
                    content: 'Match outcome recorded!',
                    ephemeral: true
                });
            }

            // Store report
            await interaction.client.db.collection('reports').insertOne({
                matchId: match._id,
                userId: interaction.user.id,
                yourScore,
                opponentScore,
                reportedAt: new Date()
            });

            // Set reminder for opponent
            setTimeout(async () => {
                const updatedMatch = await interaction.client.db.collection('matches').findOne({
                    _id: match._id,
                    status: 'IN_PROGRESS'
                });

                if (updatedMatch) {
                    const opponentUser = await interaction.client.users.fetch(opponent.userId);
                    await opponentUser.send(
                        'Please use /outcome to report your match score before starting another match. ' +
                        'This helps keep players from abusing the system and lying about scores.'
                    );
                }
            }, 5400000); // 1.5 hours

            return interaction.reply({
                content: 'Score reported! Waiting for opponent\'s report...',
                ephemeral: true
            });

        } catch (error) {
            logger.error('Error in outcome command:', error);
            return interaction.reply({
                content: 'An error occurred while processing the match outcome.',
                ephemeral: true
            });
        }
    }
}; 