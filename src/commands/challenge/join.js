const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join a challenge')
        .addStringOption(option =>
            option.setName('id')
                .setDescription('Challenge ID')
                .setRequired(true)),

    async execute(interaction) {
        try {
            const challengeId = interaction.options.getString('id');
            const userId = interaction.user.id;

            // Get challenge
            const challenge = await interaction.client.db.collection('challenges').findOne({ id: challengeId });
            if (!challenge) {
                return interaction.reply({
                    content: '❌ Challenge not found.',
                    ephemeral: true
                });
            }

            // Check challenge status
            if (challenge.status !== 'ACTIVE') {
                return interaction.reply({
                    content: `❌ This challenge is not active. Current status: ${challenge.status}`,
                    ephemeral: true
                });
            }

            // Check if user is already participating
            const isParticipating = challenge.participants.some(p => p.userId === userId);
            if (isParticipating) {
                return interaction.reply({
                    content: '❌ You are already participating in this challenge.',
                    ephemeral: true
                });
            }

            // Check if user has required rank (if specified)
            if (challenge.requiredRank) {
                const user = await interaction.client.db.collection('users').findOne({ userId });
                if (!user || !user.rank || user.rank < challenge.requiredRank) {
                    return interaction.reply({
                        content: `❌ You need to be at least rank ${challenge.requiredRank} to join this challenge.`,
                        ephemeral: true
                    });
                }
            }

            // Add participant
            const participant = {
                userId,
                joinedAt: new Date(),
                wins: 0,
                lives: challenge.lives,
                matches: [],
                repEarned: 0
            };

            await interaction.client.db.collection('challenges').updateOne(
                { id: challengeId },
                { 
                    $push: { participants: participant },
                    $inc: { 'stats.totalParticipants': 1 }
                }
            );

            // Record challenge join
            const { recordChallengeJoin } = require('../../utils/performanceMonitor');
            recordChallengeJoin(userId, challengeId);

            // Send confirmation
            const embed = {
                title: '🎯 Challenge Joined!',
                description: `You have joined the ${challenge.name} challenge!`,
                fields: [
                    { name: 'Challenge', value: challenge.name, inline: true },
                    { name: 'Mode', value: challenge.mode === 'bingo' ? 'Bingo' : 'Standard', inline: true },
                    { name: 'Lives', value: challenge.lives.toString(), inline: true },
                    { name: 'Wins Required', value: challenge.winsRequired.toString(), inline: true }
                ],
                color: 0x5865F2,
                timestamp: new Date()
            };

            if (challenge.endTime) {
                const timeLeft = challenge.endTime - new Date();
                const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
                const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                embed.fields.push({
                    name: 'Time Remaining',
                    value: `${days}d ${hours}h`,
                    inline: true
                });
            }

            await interaction.reply({ embeds: [embed] });

            // Announce in ranked queue channel if configured
            const serverConfig = await interaction.client.db.collection('servers').findOne({ guildId: interaction.guildId });
            if (serverConfig?.channels?.rankedQueue) {
                const channel = await interaction.guild.channels.fetch(serverConfig.channels.rankedQueue);
                if (channel) {
                    await channel.send({
                        embeds: [{
                            title: '🎯 New Challenge Participant',
                            description: `${interaction.user} has joined the ${challenge.name} challenge!`,
                            fields: [
                                { name: 'Total Participants', value: (challenge.participants.length + 1).toString(), inline: true }
                            ],
                            color: 0x5865F2,
                            timestamp: new Date()
                        }]
                    });
                }
            }
        } catch (error) {
            logger.error('Error in join challenge command:', error);
            await interaction.reply({
                content: '❌ An error occurred while joining the challenge.',
                ephemeral: true
            });
        }
    }
}; 