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
                .setName('league')
                .setDescription('View club league information'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('season')
                .setDescription('View current club league season status')),

    async execute(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'league') {
                await handleLeagueCommand(interaction);
            } else if (subcommand === 'season') {
                await handleSeasonCommand(interaction);
            }
        } catch (error) {
            logger.error('Error in club league command:', error);
            await interaction.reply({
                content: 'An error occurred while processing the club league command.',
                ephemeral: true
            });
        }
    }
};

async function handleLeagueCommand(interaction) {
    // Get current season
    const season = await ClubLeague.getCurrentSeason();
    if (!season) {
        return interaction.reply({
            content: 'There is no active club league season at the moment.',
            ephemeral: true
        });
    }

    // Get user's club
    const userClub = await Club.findOne({
        'members.userId': interaction.user.id
    });

    // Create league embed
    const embed = new EmbedBuilder()
        .setColor('#80FFFF')
        .setTitle('Club League')
        .setDescription(`Season ${season.season} is currently active!`)
        .addFields(
            {
                name: 'Season Information',
                value: [
                    `**Start Date:** <t:${Math.floor(season.startDate.getTime() / 1000)}:R>`,
                    `**End Date:** <t:${Math.floor(season.endDate.getTime() / 1000)}:R>`,
                    `**Active Clubs:** ${season.clubs.length}`,
                    `**Total Matches:** ${season.clubs.reduce((sum, club) => sum + club.matches.length, 0)}`
                ].join('\n'),
                inline: false
            }
        )
        .setFooter({ text: 'Club League runs from the 1st to the 7th of each month' });

    // Add user's club information if they're in a club
    if (userClub) {
        const clubData = season.clubs.find(c => c.clubId === userClub.clubId);
        if (clubData) {
            const memberData = clubData.members.find(m => m.userId === interaction.user.id);
            embed.addFields(
                {
                    name: 'Your Club Status',
                    value: [
                        `**Club:** ${clubData.clubName}`,
                        `**Club Rep:** ${clubData.rep}`,
                        `**Club Trophies:** ${clubData.trophies}`,
                        `**Your Tickets:** ${memberData ? memberData.tickets : 0}/7`,
                        `**Club Matches:** ${clubData.matches.length}`
                    ].join('\n'),
                    inline: false
                }
            );
        }
    }

    // Add top 5 clubs by trophies
    const topClubs = [...season.clubs]
        .sort((a, b) => b.trophies - a.trophies)
        .slice(0, 5);

    if (topClubs.length > 0) {
        embed.addFields({
            name: 'Top Clubs',
            value: topClubs.map((club, index) => 
                `${index + 1}. **${club.clubName}** - ${club.trophies} 🏆 (${club.rep} rep)`
            ).join('\n'),
            inline: false
        });
    }

    // Create buttons for additional actions
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('club_league_leaderboard')
                .setLabel('View Leaderboard')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('club_league_matches')
                .setLabel('Recent Matches')
                .setStyle(ButtonStyle.Secondary)
        );

    const message = await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
    });

    // Create collector for button interactions
    const filter = i => i.user.id === interaction.user.id;
    const collector = message.createMessageComponentCollector({ 
        filter, 
        time: 300000 // 5 minutes
    });

    collector.on('collect', async i => {
        if (i.customId === 'club_league_leaderboard') {
            await handleLeaderboard(i, season);
        } else if (i.customId === 'club_league_matches') {
            await handleRecentMatches(i, season, userClub);
        }
    });

    collector.on('end', async collected => {
        if (collected.size === 0) {
            await interaction.editReply({
                components: []
            });
        }
    });
}

async function handleSeasonCommand(interaction) {
    // Get current season
    const season = await ClubLeague.getCurrentSeason();
    if (!season) {
        return interaction.reply({
            content: 'There is no active club league season at the moment.',
            ephemeral: true
        });
    }

    // Get user's club
    const userClub = await Club.findOne({
        'members.userId': interaction.user.id
    });

    if (!userClub) {
        return interaction.reply({
            content: 'You must be in a club to view season status.',
            ephemeral: true
        });
    }

    // Get club's season data
    const clubData = season.clubs.find(c => c.clubId === userClub.clubId);
    if (!clubData) {
        return interaction.reply({
            content: 'Your club is not participating in the current season.',
            ephemeral: true
        });
    }

    const memberData = clubData.members.find(m => m.userId === interaction.user.id);
    if (!memberData) {
        return interaction.reply({
            content: 'You are not registered in your club\'s season roster.',
            ephemeral: true
        });
    }

    // Calculate time remaining
    const now = new Date();
    const timeRemaining = season.endDate - now;
    const daysRemaining = Math.ceil(timeRemaining / (1000 * 60 * 60 * 24));

    // Create season status embed
    const embed = new EmbedBuilder()
        .setColor('#80FFFF')
        .setTitle(`${clubData.clubName} - Season ${season.season} Status`)
        .setDescription(`Season ends in **${daysRemaining} days**`)
        .addFields(
            {
                name: 'Club Progress',
                value: [
                    `**Club Rep:** ${clubData.rep}`,
                    `**Club Trophies:** ${clubData.trophies}`,
                    `**Matches Played:** ${clubData.matches.length}`,
                    `**Win Rate:** ${calculateWinRate(clubData)}%`
                ].join('\n'),
                inline: false
            },
            {
                name: 'Your Status',
                value: [
                    `**Tickets Remaining:** ${memberData.tickets}/7`,
                    `**Next Reset:** <t:${Math.floor(new Date(memberData.lastTicketReset).setMonth(new Date(memberData.lastTicketReset).getMonth() + 1) / 1000)}:R>`
                ].join('\n'),
                inline: false
            }
        )
        .setFooter({ text: 'Tickets reset at the start of each month' });

    // Add recent matches if any
    const recentMatches = clubData.matches.slice(-5).reverse();
    if (recentMatches.length > 0) {
        embed.addFields({
            name: 'Recent Matches',
            value: recentMatches.map(match => {
                const isWin = match.repGained > 0;
                return `${isWin ? '✅' : '❌'} vs **${match.opponentClubName}** - ${match.player1.score}-${match.player2.score} (${isWin ? '+' : '-'}${Math.abs(match.repGained)} rep)`;
            }).join('\n'),
            inline: false
        });
    }

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}

async function handleLeaderboard(interaction, season) {
    // Sort clubs by trophies
    const sortedClubs = [...season.clubs]
        .sort((a, b) => b.trophies - a.trophies)
        .slice(0, 10);

    const embed = new EmbedBuilder()
        .setColor('#80FFFF')
        .setTitle('Club League Leaderboard')
        .setDescription(`Season ${season.season} - Top 10 Clubs`)
        .addFields(
            {
                name: 'Rankings',
                value: sortedClubs.map((club, index) => 
                    `${index + 1}. **${club.clubName}**\n` +
                    `   🏆 ${club.trophies} Trophies | ${club.rep} Rep | ${club.matches.length} Matches`
                ).join('\n\n'),
                inline: false
            }
        )
        .setFooter({ text: 'Club League runs from the 1st to the 7th of each month' });

    await interaction.update({
        embeds: [embed],
        components: interaction.message.components
    });
}

async function handleRecentMatches(interaction, season, userClub) {
    // Get all matches from the season
    const allMatches = season.clubs.flatMap(club => 
        club.matches.map(match => ({
            ...match,
            clubName: club.clubName
        }))
    ).sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);

    const embed = new EmbedBuilder()
        .setColor('#80FFFF')
        .setTitle('Recent Club League Matches')
        .setDescription(`Season ${season.season} - Latest Matches`)
        .addFields(
            {
                name: 'Matches',
                value: allMatches.map(match => {
                    const isClubMatch = userClub && (match.clubName === userClub.name || match.opponentClubName === userClub.name);
                    return `${isClubMatch ? '🔹' : '•'} **${match.clubName}** vs **${match.opponentClubName}**\n` +
                           `   ${match.player1.username} ${match.player1.score}-${match.player2.score} ${match.player2.username}\n` +
                           `   ${match.repGained > 0 ? '+' : ''}${match.repGained} rep | <t:${Math.floor(match.timestamp.getTime() / 1000)}:R>`;
                }).join('\n\n'),
                inline: false
            }
        )
        .setFooter({ text: '🔹 indicates a match involving your club' });

    await interaction.update({
        embeds: [embed],
        components: interaction.message.components
    });
}

function calculateWinRate(clubData) {
    if (clubData.matches.length === 0) return 0;
    const wins = clubData.matches.filter(match => match.repGained > 0).length;
    return Math.round((wins / clubData.matches.length) * 100);
} 