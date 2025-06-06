const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { getRankEmoji } = require('../utils/helpers');
const { CLUB_ICONS } = require('../utils/clubManager');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isModalSubmit()) return;

        try {
            if (interaction.customId === 'leaderboard_search') {
                const searchTerm = interaction.fields.getTextInputValue('search').toLowerCase();
                const type = interaction.message.embeds[0].title.includes('Club') ? 'club' : 'ranked';

                let result;
                let page;

                if (type === 'ranked') {
                    // Search for user
                    const user = await interaction.client.db.collection('users')
                        .findOne({
                            $or: [
                                { username: { $regex: searchTerm, $options: 'i' } },
                                { discordId: searchTerm }
                            ]
                        });

                    if (!user) {
                        await interaction.reply({
                            content: 'No player found with that name or ID.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Find user's rank
                    const higherRankedUsers = await interaction.client.db.collection('users')
                        .countDocuments({ rep: { $gt: user.rep } });

                    page = Math.floor(higherRankedUsers / 10) + 1;
                    result = {
                        type: 'ranked',
                        page,
                        totalPages: Math.ceil(await interaction.client.db.collection('users').countDocuments() / 10)
                    };

                } else {
                    // Search for club
                    const club = await interaction.client.db.collection('clubs')
                        .findOne({
                            $or: [
                                { name: { $regex: searchTerm, $options: 'i' } },
                                { clubId: searchTerm.toUpperCase() }
                            ]
                        });

                    if (!club) {
                        await interaction.reply({
                            content: 'No club found with that name or ID.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Find club's rank
                    const higherRankedClubs = await interaction.client.db.collection('clubs')
                        .countDocuments({ 'clubLeague.trophies': { $gt: club.clubLeague.trophies } });

                    page = Math.floor(higherRankedClubs / 10) + 1;
                    result = {
                        type: 'club',
                        page,
                        totalPages: Math.ceil(await interaction.client.db.collection('clubs').countDocuments() / 10)
                    };
                }

                // Update the leaderboard to show the found page
                const limit = 10;
                let embed;

                if (result.type === 'ranked') {
                    const users = await interaction.client.db.collection('users')
                        .find()
                        .sort({ rep: -1 })
                        .skip((result.page - 1) * limit)
                        .limit(limit)
                        .toArray();

                    const entries = users.map((user, index) => {
                        const rank = (result.page - 1) * limit + index + 1;
                        return `${rank}. ${getRankEmoji(user.rep)} ${user.username} — ${user.rep} Rep`;
                    });

                    embed = {
                        title: `Ranked Leaderboard — Page ${result.page}`,
                        description: entries.join('\n'),
                        color: 15594231,
                        footer: { text: `Page ${result.page} of ${result.totalPages}` },
                        thumbnail: {
                            url: 'https://message.style/cdn/images/f056968f01838d4089a8324e857fe1c2065aef93afd2ff9d7a9a4157ae717ec2.png'
                        }
                    };

                } else {
                    const clubs = await interaction.client.db.collection('clubs')
                        .find()
                        .sort({ 'clubLeague.trophies': -1 })
                        .skip((result.page - 1) * limit)
                        .limit(limit)
                        .toArray();

                    const entries = clubs.map((club, index) => {
                        const rank = (result.page - 1) * limit + index + 1;
                        const iconInfo = CLUB_ICONS[club.icon];
                        return `${rank}. <:${iconInfo.emoji}> ${club.name} [${club.clubId}] — ${club.clubLeague.trophies} Trophies`;
                    });

                    embed = {
                        title: `Club Leaderboard — Page ${result.page}`,
                        description: entries.join('\n'),
                        color: 2583267,
                        footer: { text: `Page ${result.page} of ${result.totalPages}` },
                        thumbnail: {
                            url: 'https://message.style/cdn/images/07a7ddbbe75fa2ca244263012fcc46d0dc27bfeeadd9b83206cefa61df145f50.png'
                        }
                    };
                }

                // Create navigation buttons
                const row = {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: 1,
                            label: '',
                            emoji: '⬅️',
                            custom_id: 'prev_page',
                            disabled: result.page === 1
                        },
                        {
                            type: 2,
                            style: 2,
                            label: 'Find',
                            emoji: '🔍',
                            custom_id: 'find'
                        },
                        {
                            type: 2,
                            style: 1,
                            label: '',
                            emoji: '➡️',
                            custom_id: 'next_page',
                            disabled: result.page === result.totalPages
                        }
                    ]
                };

                await interaction.update({
                    embeds: [embed],
                    components: [row]
                });
            }
        } catch (error) {
            logger.error('Error handling modal submit:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}; 