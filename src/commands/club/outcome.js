const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const ClubLeague = require('../../models/ClubLeague');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('outcome')
                .setDescription('Report the outcome of a club league match')
                .addIntegerOption(option =>
                    option
                        .setName('your_score')
                        .setDescription('Your final score')
                        .setRequired(true)
                        .setMinValue(0))
                .addIntegerOption(option =>
                    option
                        .setName('opponent_score')
                        .setDescription('Your opponent\'s final score')
                        .setRequired(true)
                        .setMinValue(0))),

    async execute(interaction) {
        try {
            const yourScore = interaction.options.getInteger('your_score');
            const opponentScore = interaction.options.getInteger('opponent_score');

            // Get current season
            const season = await ClubLeague.getCurrentSeason();
            if (!season) {
                return interaction.reply({
                    content: 'There is no active club league season at the moment.',
                    ephemeral: true
                });
            }

            // Find the player's club
            const playerClub = await Club.findOne({
                'members.userId': interaction.user.id
            });

            if (!playerClub) {
                return interaction.reply({
                    content: 'You must be in a club to report club league match outcomes.',
                    ephemeral: true
                });
            }

            // Find the player's pending match
            const clubData = season.clubs.find(c => c.clubId === playerClub.clubId);
            if (!clubData) {
                return interaction.reply({
                    content: 'Your club is not participating in the current season.',
                    ephemeral: true
                });
            }

            const pendingMatch = clubData.matches.find(m => 
                (m.player1.userId === interaction.user.id || m.player2.userId === interaction.user.id) &&
                m.status === 'pending'
            );

            if (!pendingMatch) {
                return interaction.reply({
                    content: 'You do not have any pending club league matches.',
                    ephemeral: true
                });
            }

            // Determine if player is player1 or player2
            const isPlayer1 = pendingMatch.player1.userId === interaction.user.id;
            const opponent = isPlayer1 ? pendingMatch.player2 : pendingMatch.player1;
            const opponentClub = await Club.findOne({ clubId: opponent.clubId });

            // Check if opponent has already reported
            const opponentReport = pendingMatch.reports?.find(r => r.userId === opponent.userId);
            if (opponentReport) {
                // Compare scores
                const opponentYourScore = isPlayer1 ? opponentReport.player2Score : opponentReport.player1Score;
                const opponentOpponentScore = isPlayer1 ? opponentReport.player1Score : opponentReport.player2Score;

                if (opponentYourScore !== yourScore || opponentOpponentScore !== opponentScore) {
                    // Scores don't match - mark as disputed
                    await ClubLeague.updateOne(
                        { 
                            season: season.season,
                            'clubs.clubId': playerClub.clubId,
                            'clubs.matches._id': pendingMatch._id
                        },
                        {
                            $set: {
                                'clubs.$.matches.$.status': 'disputed',
                                'clubs.$.matches.$.disputeDetails': {
                                    player1Report: {
                                        userId: pendingMatch.player1.userId,
                                        score: pendingMatch.player1.userId === interaction.user.id ? yourScore : opponentYourScore,
                                        opponentScore: pendingMatch.player1.userId === interaction.user.id ? opponentScore : opponentOpponentScore,
                                        timestamp: new Date()
                                    },
                                    player2Report: {
                                        userId: pendingMatch.player2.userId,
                                        score: pendingMatch.player2.userId === interaction.user.id ? yourScore : opponentYourScore,
                                        opponentScore: pendingMatch.player2.userId === interaction.user.id ? opponentScore : opponentOpponentScore,
                                        timestamp: new Date()
                                    }
                                }
                            }
                        }
                    );

                    // Notify both players
                    try {
                        await interaction.user.send('Scores don\'t match with your opponent\'s report. A moderator will review the dispute.');
                        await interaction.client.users.fetch(opponent.userId).then(user => 
                            user.send('Scores don\'t match with your opponent\'s report. A moderator will review the dispute.')
                        );
                    } catch (error) {
                        logger.error('Error sending dispute notifications:', error);
                    }

                    return interaction.reply({
                        content: 'Scores don\'t match with your opponent\'s report. A moderator will review the dispute.',
                        ephemeral: true
                    });
                }

                // Scores match - process the match
                const winner = yourScore > opponentScore ? interaction.user.id : opponent.userId;
                const loser = winner === interaction.user.id ? opponent.userId : interaction.user.id;
                const runDifferential = Math.abs(yourScore - opponentScore);

                // Calculate club rep
                const winnerClubRep = Math.min(70 + Math.min(runDifferential * 3, 30), 100);
                const loserClubRep = -10;

                // Update both clubs' rep
                await Promise.all([
                    ClubLeague.updateOne(
                        { 
                            season: season.season,
                            'clubs.clubId': playerClub.clubId
                        },
                        {
                            $inc: { 'clubs.$.rep': winner === interaction.user.id ? winnerClubRep : loserClubRep },
                            $set: {
                                'clubs.$.matches.$[match].status': 'completed',
                                'clubs.$.matches.$[match].winner': winner,
                                'clubs.$.matches.$[match].repGained': winner === interaction.user.id ? winnerClubRep : loserClubRep,
                                'clubs.$.matches.$[match].finalScore': {
                                    player1: pendingMatch.player1.userId === interaction.user.id ? yourScore : opponentScore,
                                    player2: pendingMatch.player2.userId === interaction.user.id ? yourScore : opponentScore
                                }
                            }
                        },
                        { arrayFilters: [{ 'match._id': pendingMatch._id }] }
                    ),
                    ClubLeague.updateOne(
                        { 
                            season: season.season,
                            'clubs.clubId': opponentClub.clubId
                        },
                        {
                            $inc: { 'clubs.$.rep': winner === opponent.userId ? winnerClubRep : loserClubRep },
                            $set: {
                                'clubs.$.matches.$[match].status': 'completed',
                                'clubs.$.matches.$[match].winner': winner,
                                'clubs.$.matches.$[match].repGained': winner === opponent.userId ? winnerClubRep : loserClubRep,
                                'clubs.$.matches.$[match].finalScore': {
                                    player1: pendingMatch.player1.userId === opponent.userId ? opponentScore : yourScore,
                                    player2: pendingMatch.player2.userId === opponent.userId ? opponentScore : yourScore
                                }
                            }
                        },
                        { arrayFilters: [{ 'match._id': pendingMatch._id }] }
                    )
                ]);

                // Create outcome embed
                const embed = new EmbedBuilder()
                    .setColor('#80FFFF')
                    .setTitle('Club League Match Complete')
                    .setDescription(`Match between ${pendingMatch.player1.username} and ${pendingMatch.player2.username} has been completed.`)
                    .addFields(
                        {
                            name: 'Match Results',
                            value: [
                                `**${pendingMatch.player1.username}:** ${pendingMatch.player1.userId === interaction.user.id ? yourScore : opponentScore}`,
                                `**${pendingMatch.player2.username}:** ${pendingMatch.player2.userId === interaction.user.id ? yourScore : opponentScore}`,
                                `**Winner:** ${winner === interaction.user.id ? interaction.user.username : opponent.username}`
                            ].join('\n'),
                            inline: false
                        },
                        {
                            name: 'Club Rep Changes',
                            value: [
                                `**${playerClub.name}:** ${winner === interaction.user.id ? '+' + winnerClubRep : loserClubRep} rep`,
                                `**${opponentClub.name}:** ${winner === opponent.userId ? '+' + winnerClubRep : loserClubRep} rep`
                            ].join('\n'),
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Club League runs from the 1st to the 7th of each month' });

                // Notify both players
                try {
                    await interaction.user.send({ embeds: [embed] });
                    await interaction.client.users.fetch(opponent.userId).then(user => 
                        user.send({ embeds: [embed] })
                    );
                } catch (error) {
                    logger.error('Error sending outcome notifications:', error);
                }

                return interaction.reply({
                    content: 'Match results have been recorded and club rep has been updated.',
                    ephemeral: true
                });
            }

            // First report - store the scores
            await ClubLeague.updateOne(
                { 
                    season: season.season,
                    'clubs.clubId': playerClub.clubId,
                    'clubs.matches._id': pendingMatch._id
                },
                {
                    $push: {
                        'clubs.$.matches.$.reports': {
                            userId: interaction.user.id,
                            player1Score: isPlayer1 ? yourScore : opponentScore,
                            player2Score: isPlayer1 ? opponentScore : yourScore,
                            timestamp: new Date()
                        }
                    }
                }
            );

            return interaction.reply({
                content: 'Your score has been recorded. Waiting for your opponent to report their score.',
                ephemeral: true
            });

        } catch (error) {
            logger.error('Error in club outcome command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the match outcome.',
                ephemeral: true
            });
        }
    }
}; 