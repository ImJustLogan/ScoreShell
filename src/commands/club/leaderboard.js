const { SlashCommandBuilder } = require('@discordjs/builders');
const { ClubManager, CLUB_ICONS } = require('../../../utils/clubManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the club leaderboard')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page number to view')
                .setRequired(false)
                .setMinValue(1)),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const page = interaction.options.getInteger('page') || 1;
            const clubManager = new ClubManager(interaction.client.db);

            // Get leaderboard data
            const { clubs, total, pages, currentPage } = await clubManager.getClubLeaderboard(page);

            if (clubs.length === 0) {
                throw new Error('No clubs found.');
            }

            // Format club entries
            const formatClubEntry = (club, index) => {
                const iconInfo = CLUB_ICONS[club.icon];
                const rank = (currentPage - 1) * 10 + index + 1;
                const rankEmoji = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `${rank}.`;
                return [
                    `${rankEmoji} **${club.name}** [${club.clubId}]`,
                    `└ <:${iconInfo.emoji}> • ${club.trophies} 🏆 • ${club.rep} rep • ${club.members.length}/10 members`
                ].join('\n');
            };

            const embed = {
                title: 'Club Leaderboard',
                description: clubs.map((club, index) => formatClubEntry(club, index)).join('\n\n'),
                color: 0x0099ff,
                footer: {
                    text: `Page ${currentPage}/${pages} • Total Clubs: ${total}`
                },
                timestamp: new Date()
            };

            // Add navigation buttons if there are multiple pages
            const components = [];
            if (pages > 1) {
                components.push({
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: 2,
                            label: 'Previous Page',
                            custom_id: 'prev_page',
                            disabled: currentPage === 1
                        },
                        {
                            type: 2,
                            style: 2,
                            label: 'Next Page',
                            custom_id: 'next_page',
                            disabled: currentPage === pages
                        }
                    ]
                });
            }

            const message = await interaction.editReply({
                embeds: [embed],
                components
            });

            // Handle pagination
            if (pages > 1) {
                const filter = i => i.user.id === interaction.user.id;
                const collector = message.createMessageComponentCollector({
                    filter,
                    time: 300000 // 5 minutes
                });

                collector.on('collect', async i => {
                    const newPage = i.customId === 'prev_page' ? currentPage - 1 : currentPage + 1;
                    const { clubs: newClubs, pages: newPages, currentPage: newCurrentPage } = 
                        await clubManager.getClubLeaderboard(newPage);

                    const newEmbed = {
                        ...embed,
                        description: newClubs.map((club, index) => formatClubEntry(club, index)).join('\n\n'),
                        footer: {
                            text: `Page ${newCurrentPage}/${newPages} • Total Clubs: ${total}`
                        }
                    };

                    const newComponents = [{
                        type: 1,
                        components: [
                            {
                                type: 2,
                                style: 2,
                                label: 'Previous Page',
                                custom_id: 'prev_page',
                                disabled: newCurrentPage === 1
                            },
                            {
                                type: 2,
                                style: 2,
                                label: 'Next Page',
                                custom_id: 'next_page',
                                disabled: newCurrentPage === newPages
                            }
                        ]
                    }];

                    await i.update({
                        embeds: [newEmbed],
                        components: newComponents
                    });
                });

                collector.on('end', async () => {
                    await interaction.editReply({
                        embeds: [embed],
                        components: []
                    });
                });
            }

        } catch (error) {
            await interaction.editReply({
                content: `❌ Error viewing leaderboard: ${error.message}`,
                ephemeral: true
            });
        }
    }
}; 