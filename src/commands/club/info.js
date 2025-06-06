const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const Club = require('../../models/Club');
const ClubLeague = require('../../models/ClubLeague');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('View information about a club')
                .addStringOption(option =>
                    option
                        .setName('club_id')
                        .setDescription('The ID of the club to view (leave empty to view your club)')
                        .setRequired(false))
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('View the club of a specific user')
                        .setRequired(false))),

    async execute(interaction) {
        try {
            const clubId = interaction.options.getString('club_id');
            const targetUser = interaction.options.getUser('user');

            // Find the club
            let club;
            if (clubId) {
                club = await Club.findOne({ clubId });
            } else if (targetUser) {
                club = await Club.findOne({ 'members.userId': targetUser.id });
            } else {
                club = await Club.findOne({ 'members.userId': interaction.user.id });
            }

            if (!club) {
                return interaction.reply({
                    content: 'Club not found. Make sure the club ID is correct or the user is in a club.',
                    ephemeral: true
                });
            }

            // Get current season data if available
            const season = await ClubLeague.getCurrentSeason();
            const clubSeasonData = season?.clubs.find(c => c.clubId === club.clubId);

            // Get club icon URL based on icon ID
            const clubIcons = {
                'club_red': 'https://i.imgur.com/sy8o63Y.png',
                'club_blue': 'https://i.imgur.com/2jH5dQU.png',
                'club_yellow': 'https://i.imgur.com/nywWQyZ.png',
                'club_green': 'https://i.imgur.com/JnBP5ro.png',
                'club_pink': 'https://i.imgur.com/ToavyvN.png',
                'club_cyan': 'https://i.imgur.com/81HXsR4.png'
            };

            // Create main info embed
            const embed = new EmbedBuilder()
                .setColor('#80FFFF')
                .setTitle(`${club.name} [${club.clubId}]`)
                .setDescription(club.description || 'No description set')
                .setThumbnail(clubIcons[club.icon] || null)
                .addFields(
                    {
                        name: 'Club Information',
                        value: [
                            `**Owner:** <@${club.owner}>`,
                            `**Created:** <t:${Math.floor(club.createdAt.getTime() / 1000)}:R>`,
                            `**Privacy:** ${club.privacy.charAt(0).toUpperCase() + club.privacy.slice(1)}`,
                            `**Members:** ${club.members.length}/10`
                        ].join('\n'),
                        inline: false
                    }
                );

            // Add season information if available
            if (clubSeasonData) {
                embed.addFields({
                    name: 'Current Season',
                    value: [
                        `**Club Rep:** ${clubSeasonData.rep}`,
                        `**Club Trophies:** ${clubSeasonData.trophies}`,
                        `**Matches Played:** ${clubSeasonData.matches.length}`,
                        `**Win Rate:** ${calculateWinRate(clubSeasonData)}%`
                    ].join('\n'),
                    inline: false
                });
            }

            // Add member list
            const owner = club.members.find(m => m.userId === club.owner);
            const captains = club.members.filter(m => club.captains.includes(m.userId));
            const regularMembers = club.members.filter(m => 
                m.userId !== club.owner && !club.captains.includes(m.userId)
            );

            const memberList = [
                `👑 **Owner**\n<@${owner.userId}> (Joined <t:${Math.floor(owner.joinedAt.getTime() / 1000)}:R>)`,
                captains.length > 0 ? 
                    `⚔️ **Captains**\n${captains.map(c => 
                        `<@${c.userId}> (Joined <t:${Math.floor(c.joinedAt.getTime() / 1000)}:R>)`
                    ).join('\n')}` : null,
                regularMembers.length > 0 ?
                    `👥 **Members**\n${regularMembers.map(m => 
                        `<@${m.userId}> (Joined <t:${Math.floor(m.joinedAt.getTime() / 1000)}:R>)`
                    ).join('\n')}` : null
            ].filter(Boolean).join('\n\n');

            embed.addFields({
                name: 'Members',
                value: memberList || 'No members',
                inline: false
            });

            // Add recent matches if available
            if (clubSeasonData?.matches.length > 0) {
                const recentMatches = clubSeasonData.matches
                    .slice(-5)
                    .reverse()
                    .map(match => {
                        const isWin = match.repGained > 0;
                        return `${isWin ? '✅' : '❌'} vs **${match.opponentClubName}** - ${match.player1.score}-${match.player2.score} (${isWin ? '+' : '-'}${Math.abs(match.repGained)} rep)`;
                    });

                embed.addFields({
                    name: 'Recent Matches',
                    value: recentMatches.join('\n'),
                    inline: false
                });
            }

            // Create buttons for additional actions
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`club_apply_${club.clubId}`)
                        .setLabel('Apply to Join')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(club.privacy === 'open' || club.members.length >= 10),
                    new ButtonBuilder()
                        .setCustomId(`club_invite_${club.clubId}`)
                        .setLabel('Invite Member')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(!club.members.some(m => 
                            m.userId === interaction.user.id && 
                            (m.userId === club.owner || club.captains.includes(m.userId))
                        ))
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
                if (i.customId.startsWith('club_apply_')) {
                    // Handle apply button
                    const userClub = await Club.findOne({ 'members.userId': interaction.user.id });
                    if (userClub) {
                        await i.reply({
                            content: 'You are already in a club. Leave your current club before applying to join another one.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Check if user already has a pending application
                    const pendingApplication = club.applications?.find(a => 
                        a.userId === interaction.user.id && 
                        a.status === 'pending' &&
                        new Date() - new Date(a.timestamp) < 7 * 24 * 60 * 60 * 1000 // 7 days
                    );

                    if (pendingApplication) {
                        await i.reply({
                            content: 'You already have a pending application to this club.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Create application modal
                    const modal = new ModalBuilder()
                        .setCustomId(`club_apply_modal_${club.clubId}`)
                        .setTitle(`Apply to ${club.name}`);

                    const reasonInput = new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Why do you want to join this club?')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMinLength(10)
                        .setMaxLength(1000);

                    const firstActionRow = new ActionRowBuilder().addComponents(reasonInput);
                    modal.addComponents(firstActionRow);

                    await i.showModal(modal);
                } else if (i.customId.startsWith('club_invite_')) {
                    // Handle invite button
                    const modal = new ModalBuilder()
                        .setCustomId(`club_invite_modal_${club.clubId}`)
                        .setTitle(`Invite to ${club.name}`);

                    const userInput = new TextInputBuilder()
                        .setCustomId('user')
                        .setLabel('User ID or @mention')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    const firstActionRow = new ActionRowBuilder().addComponents(userInput);
                    modal.addComponents(firstActionRow);

                    await i.showModal(modal);
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club info command:', error);
            await interaction.reply({
                content: 'An error occurred while fetching club information.',
                ephemeral: true
            });
        }
    }
};

function calculateWinRate(clubData) {
    if (clubData.matches.length === 0) return 0;
    const wins = clubData.matches.filter(match => match.repGained > 0).length;
    return Math.round((wins / clubData.matches.length) * 100);
} 