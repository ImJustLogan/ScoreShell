const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View challenge statistics')
        .addStringOption(option =>
            option.setName('challenge_id')
                .setDescription('ID of the challenge to view stats for')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const challengeId = interaction.options.getString('challenge_id');

            // Get challenge and stats
            const [challenge, statsResult] = await Promise.all([
                interaction.client.db.collection('challenges').findOne({ id: challengeId }),
                interaction.client.challengeManager.getChallengeStats(challengeId)
            ]);

            if (!challenge) {
                return interaction.editReply({
                    content: 'Challenge not found.',
                    ephemeral: true
                });
            }

            if (!statsResult.success) {
                return interaction.editReply({
                    content: `Failed to get challenge stats: ${statsResult.error}`,
                    ephemeral: true
                });
            }

            const stats = statsResult.data;

            // Create embed for challenge stats
            const embed = new EmbedBuilder()
                .setTitle(`📊 Challenge Statistics: ${challenge.name}`)
                .setDescription(challenge.description)
                .addFields(
                    { name: 'Challenge ID', value: challengeId, inline: true },
                    { name: 'Status', value: challenge.status, inline: true },
                    { name: 'Total Participants', value: stats.totalParticipants.toString(), inline: true },
                    { name: 'Completion Rate', value: `${stats.completionRate.toFixed(1)}%`, inline: true },
                    { name: 'Total Matches', value: stats.totalMatches.toString(), inline: true },
                    { name: 'Total Rep Earned', value: stats.totalRep.toString(), inline: true },
                    { name: 'Average Wins', value: stats.averageWins.toFixed(1), inline: true },
                    { name: 'Average Lives Remaining', value: stats.averageLives.toFixed(1), inline: true }
                )
                .setColor('#0099ff')
                .setTimestamp();

            // Add rank distribution if available
            if (Object.keys(stats.rankDistribution).length > 0) {
                const rankDist = Object.entries(stats.rankDistribution)
                    .map(([rank, count]) => `${rank}: ${count}`)
                    .join('\n');
                embed.addFields({ name: 'Rank Distribution', value: rankDist });
            }

            // Add top performers if available
            if (stats.topPerformers.length > 0) {
                const topPerformers = await Promise.all(
                    stats.topPerformers.map(async (performer) => {
                        const user = await interaction.client.users.fetch(performer.userId);
                        return `${user.username} - Completed in ${performer.completedAt.toLocaleString()}`;
                    })
                );
                embed.addFields({ name: 'Top Performers', value: topPerformers.join('\n') });
            }

            // Add challenge requirements
            const requirements = [
                `Wins Required: ${challenge.winsRequired}`,
                `Lives: ${challenge.lives}`,
                `Ranked Only: ${challenge.rankedOnly ? 'Yes' : 'No'}`
            ];

            if (challenge.minRank || challenge.maxRank) {
                const rankRange = [];
                if (challenge.minRank) rankRange.push(`Min: ${challenge.minRank}`);
                if (challenge.maxRank) rankRange.push(`Max: ${challenge.maxRank}`);
                requirements.push(`Rank Range: ${rankRange.join(' | ')}`);
            }

            if (challenge.start || challenge.end) {
                const timeRange = [];
                if (challenge.start) timeRange.push(`Start: ${challenge.start}`);
                if (challenge.end) timeRange.push(`End: ${challenge.end}`);
                requirements.push(`Time Window: ${timeRange.join(' | ')}`);
            }

            if (challenge.reward) {
                requirements.push(`Reward: Badge ${challenge.reward}`);
            }

            embed.addFields({ name: 'Challenge Requirements', value: requirements.join('\n') });

            // Check for active hypercharge
            const hypercharge = interaction.client.challengeManager.activeHypercharges.get(challengeId);
            if (hypercharge && Date.now() < hypercharge.endTime) {
                const timeLeft = Math.ceil((hypercharge.endTime - Date.now()) / (1000 * 60)); // minutes
                embed.addFields({
                    name: '⚡ Active Hypercharge',
                    value: `+${(hypercharge.multiplier * 100).toFixed(0)}% rep for ${timeLeft} more minutes!`
                });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error('Error in challenge stats command:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching challenge statistics.',
                ephemeral: true
            });
        }
    }
}; 