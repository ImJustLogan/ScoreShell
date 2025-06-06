const { SlashCommandBuilder, EmbedBuilder } = require('@discordjs/builders');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('archive')
        .setDescription('Archive a challenge')
        .addStringOption(option =>
            option.setName('challenge_id')
                .setDescription('ID of the challenge to archive')
                .setRequired(true)),

    async execute(interaction) {
        // Check if user has admin permissions
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            return interaction.reply({
                content: 'You need administrator permissions to archive challenges.',
                ephemeral: true
            });
        }

        const challengeId = interaction.options.getString('challenge_id');

        try {
            await interaction.deferReply({ ephemeral: true });

            const result = await interaction.client.challengeManager.archiveChallenge(challengeId);
            
            if (!result.success) {
                return interaction.reply({
                    content: `Failed to archive challenge: ${result.error}`,
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('Challenge Archived')
                .setDescription(`Challenge ${challengeId} has been archived.`)
                .addFields(
                    { name: 'Total Participants', value: result.summary.totalParticipants.toString(), inline: true },
                    { name: 'Total Matches', value: result.summary.totalMatches.toString(), inline: true },
                    { name: 'Total Rep Earned', value: result.summary.totalRep.toString(), inline: true }
                );

            if (result.summary.topFinishers.length > 0) {
                const topFinishers = await Promise.all(
                    result.summary.topFinishers.map(async (finisher) => {
                        const user = await interaction.client.users.fetch(finisher.userId);
                        return `${user.username} (${new Date(finisher.completedAt).toLocaleDateString()})`;
                    })
                );

                embed.addFields({
                    name: 'Top Finishers',
                    value: topFinishers.join('\n'),
                    inline: false
                });
            }

            await interaction.reply({ embeds: [embed] });

            // Notify in ranked queue channel if configured
            const serverConfig = await interaction.client.db.collection('serverConfigs')
                .findOne({ guildId: interaction.guildId });

            if (serverConfig?.rankedQueueChannelId) {
                const channel = await interaction.guild.channels.fetch(serverConfig.rankedQueueChannelId);
                if (channel) {
                    await channel.send({ embeds: [embed] });
                }
            }
        } catch (error) {
            logger.error('Error in archive command:', error);
            await interaction.editReply({
                content: 'An error occurred while archiving the challenge.',
                ephemeral: true
            });
        }
    }
}; 