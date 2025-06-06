const { SlashCommandBuilder } = require('@discordjs/builders');
const { ClubManager } = require('../../../utils/clubManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tickets')
        .setDescription('View your club league tickets'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const clubManager = new ClubManager(interaction.client.db);
            const seasonStatus = await clubManager.getClubLeagueSeasonStatus();
            const tickets = await clubManager.getUserClubLeagueTickets(interaction.user.id);

            const embed = {
                title: 'Club League Tickets',
                color: 0x0099ff,
                fields: [
                    {
                        name: 'Season Status',
                        value: seasonStatus.active 
                            ? `Active (${seasonStatus.daysRemaining} days remaining)`
                            : 'Inactive',
                        inline: true
                    },
                    {
                        name: 'Current Season',
                        value: seasonStatus.season,
                        inline: true
                    },
                    {
                        name: 'Your Tickets',
                        value: `${tickets}/7`,
                        inline: true
                    }
                ],
                footer: {
                    text: seasonStatus.active 
                        ? 'Tickets reset at the start of each month'
                        : 'Club League runs from the 1st to the 7th of each month'
                },
                timestamp: new Date()
            };

            if (seasonStatus.active) {
                embed.description = 'Club League is currently active! Use your tickets to earn club reputation.';
            } else {
                const nextSeason = new Date(seasonStatus.end);
                nextSeason.setMonth(nextSeason.getMonth() + 1);
                embed.description = `Club League is currently inactive. The next season starts <t:${Math.floor(nextSeason.getTime() / 1000)}:R>.`;
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            await interaction.editReply({
                content: `❌ Error viewing tickets: ${error.message}`,
                ephemeral: true
            });
        }
    }
}; 