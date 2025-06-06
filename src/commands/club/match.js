const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ClubLeague = require('../../models/ClubLeague');
const Club = require('../../models/Club');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('match')
                .setDescription('Start a club league match')
                .addUserOption(option =>
                    option
                        .setName('opponent')
                        .setDescription('The opponent to play against')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            const opponent = interaction.options.getUser('opponent');

            // Check if there's an active season
            const season = await ClubLeague.getCurrentSeason();
            if (!season) {
                return interaction.reply({
                    content: 'There is no active club league season at the moment.',
                    ephemeral: true
                });
            }

            // Get both players' clubs
            const [player1Club, player2Club] = await Promise.all([
                Club.findOne({ 'members.userId': interaction.user.id }),
                Club.findOne({ 'members.userId': opponent.id })
            ]);

            // Validate both players are in clubs
            if (!player1Club || !player2Club) {
                return interaction.reply({
                    content: 'Both players must be in a club to play a club league match.',
                    ephemeral: true
                });
            }

            // Prevent matches between same club
            if (player1Club.clubId === player2Club.clubId) {
                return interaction.reply({
                    content: 'You cannot play club league matches against members of your own club.',
                    ephemeral: true
                });
            }

            // Check if both players have tickets
            const [player1Tickets, player2Tickets] = await Promise.all([
                ClubLeague.getMemberTickets(season.season, interaction.user.id),
                ClubLeague.getMemberTickets(season.season, opponent.id)
            ]);

            if (player1Tickets <= 0 || player2Tickets <= 0) {
                return interaction.reply({
                    content: 'Both players must have club league tickets available to play a match.',
                    ephemeral: true
                });
            }

            // Create match confirmation embed
            const embed = new EmbedBuilder()
                .setColor('#80FFFF')
                .setTitle('Club League Match')
                .setDescription('Confirm the match details below:')
                .addFields(
                    {
                        name: 'Match Details',
                        value: [
                            `**Player 1:** ${interaction.user} (${player1Club.name})`,
                            `**Player 2:** ${opponent} (${player2Club.name})`,
                            `**Season:** ${season.season}`,
                            `**Tickets:** Both players will use 1 ticket`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Club Rep',
                        value: [
                            '**Win:** +70 base rep + up to +30 for run differential',
                            '**Loss:** -10 rep',
                            '**Note:** Club rep cannot go below 0'
                        ].join('\n'),
                        inline: false
                    }
                )
                .setFooter({ text: 'Club League runs from the 1st to the 7th of each month' });

            // Create confirmation buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('club_match_confirm')
                        .setLabel('Confirm Match')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('club_match_cancel')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Danger)
                );

            const message = await interaction.reply({
                embeds: [embed],
                components: [row],
                ephemeral: true
            });

            // Create collector for button interactions
            const filter = i => i.user.id === interaction.user.id || i.user.id === opponent.id;
            const collector = message.createMessageComponentCollector({ 
                filter, 
                time: 30000 // 30 seconds
            });

            collector.on('collect', async i => {
                if (i.customId === 'club_match_confirm') {
                    // Check if both players still have tickets
                    const [currentPlayer1Tickets, currentPlayer2Tickets] = await Promise.all([
                        ClubLeague.getMemberTickets(season.season, interaction.user.id),
                        ClubLeague.getMemberTickets(season.season, opponent.id)
                    ]);

                    if (currentPlayer1Tickets <= 0 || currentPlayer2Tickets <= 0) {
                        await i.update({
                            content: 'One or both players no longer have tickets available.',
                            embeds: [],
                            components: []
                        });
                        return;
                    }

                    // Use tickets for both players
                    await Promise.all([
                        ClubLeague.useTicket(season.season, interaction.user.id),
                        ClubLeague.useTicket(season.season, opponent.id)
                    ]);

                    // Create match in database
                    const matchData = {
                        player1: {
                            userId: interaction.user.id,
                            username: interaction.user.username,
                            clubId: player1Club.clubId,
                            clubName: player1Club.name
                        },
                        player2: {
                            userId: opponent.id,
                            username: opponent.username,
                            clubId: player2Club.clubId,
                            clubName: player2Club.name
                        },
                        timestamp: new Date(),
                        status: 'pending'
                    };

                    await ClubLeague.recordMatch(season.season, matchData);

                    // Update message with confirmation
                    await i.update({
                        content: 'Match confirmed! Use `/outcome` after the match to report the results.',
                        embeds: [],
                        components: []
                    });

                    // Notify both players
                    try {
                        await interaction.user.send(`Club League match against ${opponent} has started! Use \`/outcome\` after the match to report the results.`);
                        await opponent.send(`Club League match against ${interaction.user} has started! Use \`/outcome\` after the match to report the results.`);
                    } catch (error) {
                        logger.error('Error sending DM notifications for club match:', error);
                    }

                } else if (i.customId === 'club_match_cancel') {
                    await i.update({
                        content: 'Match cancelled.',
                        embeds: [],
                        components: []
                    });
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        content: 'Match request timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club match command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the club match command.',
                ephemeral: true
            });
        }
    }
}; 