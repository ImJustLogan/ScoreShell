const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create')
        .setDescription('Create a new challenge')
        .addStringOption(option =>
            option.setName('id')
                .setDescription('Unique identifier for the challenge')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Display name of the challenge')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Description of the challenge')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('wins_required')
                .setDescription('Number of wins required to complete the challenge')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .addIntegerOption(option =>
            option.setName('lives')
                .setDescription('Number of lives (losses allowed)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(10))
        .addStringOption(option =>
            option.setName('reward')
                .setDescription('Badge ID to award upon completion'))
        .addStringOption(option =>
            option.setName('start')
                .setDescription('Start date/time (MM/DD/YYYY HH:mm, EST)'))
        .addStringOption(option =>
            option.setName('end')
                .setDescription('End date/time (MM/DD/YYYY HH:mm, EST)'))
        .addBooleanOption(option =>
            option.setName('ranked_only')
                .setDescription('Whether only ranked matches count for this challenge'))
        .addStringOption(option =>
            option.setName('min_rank')
                .setDescription('Minimum rank required to participate')
                .addChoices(
                    { name: 'Bronze', value: 'bronze' },
                    { name: 'Silver', value: 'silver' },
                    { name: 'Gold', value: 'gold' },
                    { name: 'Platinum', value: 'platinum' },
                    { name: 'Diamond', value: 'diamond' }
                ))
        .addStringOption(option =>
            option.setName('max_rank')
                .setDescription('Maximum rank allowed to participate')
                .addChoices(
                    { name: 'Bronze', value: 'bronze' },
                    { name: 'Silver', value: 'silver' },
                    { name: 'Gold', value: 'gold' },
                    { name: 'Platinum', value: 'platinum' },
                    { name: 'Diamond', value: 'diamond' }
                )),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Check if user has admin permissions
            if (!interaction.member.permissions.has('ADMINISTRATOR')) {
                return interaction.editReply({
                    content: 'You need administrator permissions to create challenges.',
                    ephemeral: true
                });
            }

            const challengeData = {
                id: interaction.options.getString('id'),
                name: interaction.options.getString('name'),
                description: interaction.options.getString('description'),
                winsRequired: interaction.options.getInteger('wins_required'),
                lives: interaction.options.getInteger('lives'),
                reward: interaction.options.getString('reward'),
                start: interaction.options.getString('start'),
                end: interaction.options.getString('end'),
                rankedOnly: interaction.options.getBoolean('ranked_only') ?? false,
                minRank: interaction.options.getString('min_rank'),
                maxRank: interaction.options.getString('max_rank'),
                createdBy: interaction.user.id,
                guildId: interaction.guildId
            };

            // Validate rank range if both are specified
            if (challengeData.minRank && challengeData.maxRank) {
                const ranks = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
                const minIndex = ranks.indexOf(challengeData.minRank);
                const maxIndex = ranks.indexOf(challengeData.maxRank);
                if (minIndex > maxIndex) {
                    return interaction.editReply({
                        content: 'Minimum rank cannot be higher than maximum rank.',
                        ephemeral: true
                    });
                }
            }

            const result = await interaction.client.challengeManager.createChallenge(challengeData);
            if (!result.success) {
                return interaction.editReply({
                    content: `Failed to create challenge: ${result.error}`,
                    ephemeral: true
                });
            }

            // Create embed for challenge details
            const embed = new EmbedBuilder()
                .setTitle('New Challenge Created')
                .setDescription(challengeData.description)
                .addFields(
                    { name: 'Challenge ID', value: challengeData.id, inline: true },
                    { name: 'Wins Required', value: challengeData.winsRequired.toString(), inline: true },
                    { name: 'Lives', value: challengeData.lives.toString(), inline: true },
                    { name: 'Ranked Only', value: challengeData.rankedOnly ? 'Yes' : 'No', inline: true }
                )
                .setColor('#00ff00')
                .setTimestamp();

            if (challengeData.reward) {
                embed.addFields({ name: 'Reward', value: `Badge: ${challengeData.reward}`, inline: true });
            }

            if (challengeData.minRank || challengeData.maxRank) {
                const rankRange = [];
                if (challengeData.minRank) rankRange.push(`Min: ${challengeData.minRank}`);
                if (challengeData.maxRank) rankRange.push(`Max: ${challengeData.maxRank}`);
                embed.addFields({ name: 'Rank Requirements', value: rankRange.join(' | '), inline: true });
            }

            if (challengeData.start || challengeData.end) {
                const timeRange = [];
                if (challengeData.start) timeRange.push(`Start: ${challengeData.start}`);
                if (challengeData.end) timeRange.push(`End: ${challengeData.end}`);
                embed.addFields({ name: 'Time Window', value: timeRange.join(' | '), inline: true });
            }

            // Send confirmation
            await interaction.editReply({
                content: 'Challenge created successfully!',
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
                        .setTitle('🎯 New Challenge Available!')
                        .setDescription(challengeData.description)
                        .addFields(
                            { name: 'Challenge ID', value: challengeData.id, inline: true },
                            { name: 'Wins Required', value: challengeData.winsRequired.toString(), inline: true },
                            { name: 'Lives', value: challengeData.lives.toString(), inline: true }
                        )
                        .setColor('#ff9900')
                        .setTimestamp();

                    if (challengeData.reward) {
                        announceEmbed.addFields({ name: 'Reward', value: `Badge: ${challengeData.reward}`, inline: true });
                    }

                    await channel.send({ embeds: [announceEmbed] });
                }
            }
        } catch (error) {
            logger.error('Error in challenge create command:', error);
            await interaction.editReply({
                content: 'An error occurred while creating the challenge.',
                ephemeral: true
            });
        }
    }
}; 