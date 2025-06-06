const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hypercharge')
        .setDescription('Apply hypercharge to a challenge')
        .addStringOption(option =>
            option.setName('challenge_id')
                .setDescription('ID of the challenge to hypercharge')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('multiplier')
                .setDescription('Rep multiplier (e.g., 50 for +50%)')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(200))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration of the hypercharge (e.g., "3h" or "1d")')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Check if user has admin permissions
            if (!interaction.member.permissions.has('ADMINISTRATOR')) {
                return interaction.editReply({
                    content: 'You need administrator permissions to apply hypercharge.',
                    ephemeral: true
                });
            }

            const challengeId = interaction.options.getString('challenge_id');
            const multiplier = interaction.options.getInteger('multiplier');
            const duration = interaction.options.getString('duration');

            // Validate duration format
            if (!/^\d+[hd]$/.test(duration)) {
                return interaction.editReply({
                    content: 'Invalid duration format. Use "3h" for hours or "1d" for days.',
                    ephemeral: true
                });
            }

            const result = await interaction.client.challengeManager.applyHypercharge(
                challengeId,
                multiplier,
                duration
            );

            if (!result.success) {
                return interaction.editReply({
                    content: `Failed to apply hypercharge: ${result.error}`,
                    ephemeral: true
                });
            }

            // Get challenge details
            const challenge = await interaction.client.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge) {
                return interaction.editReply({
                    content: 'Challenge not found.',
                    ephemeral: true
                });
            }

            // Create embed for hypercharge details
            const embed = new EmbedBuilder()
                .setTitle('⚡ Challenge Hypercharged!')
                .setDescription(`Challenge "${challenge.name}" has been hypercharged!`)
                .addFields(
                    { name: 'Challenge ID', value: challengeId, inline: true },
                    { name: 'Rep Multiplier', value: `+${multiplier}%`, inline: true },
                    { name: 'Duration', value: duration, inline: true }
                )
                .setColor('#ff00ff')
                .setTimestamp();

            // Send confirmation
            await interaction.editReply({
                content: 'Hypercharge applied successfully!',
                embeds: [embed],
                ephemeral: true
            });

            // Announce in ranked queue channel if available
            const serverConfig = await interaction.client.db.collection('servers').findOne({
                guildId: interaction.guildId
            });

            if (serverConfig?.channels?.rankedQueue) {
                const channel = await interaction.guild.channels.fetch(serverConfig.channels.rankedQueue);
                if (channel) {
                    const announceEmbed = new EmbedBuilder()
                        .setTitle('⚡ Challenge Hypercharged!')
                        .setDescription(`Challenge "${challenge.name}" has been hypercharged!\nGet ${multiplier}% more rep for the next ${duration}!`)
                        .addFields(
                            { name: 'Challenge ID', value: challengeId, inline: true },
                            { name: 'Duration', value: duration, inline: true }
                        )
                        .setColor('#ff00ff')
                        .setTimestamp();

                    await channel.send({ embeds: [announceEmbed] });
                }
            }
        } catch (error) {
            logger.error('Error in challenge hypercharge command:', error);
            await interaction.editReply({
                content: 'An error occurred while applying hypercharge.',
                ephemeral: true
            });
        }
    }
}; 