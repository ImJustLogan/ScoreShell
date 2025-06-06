const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('progress')
        .setDescription('View your challenge progress')
        .addStringOption(option =>
            option.setName('id')
                .setDescription('Challenge ID (optional, shows all active challenges if not specified)')),

    async execute(interaction) {
        try {
            const userId = interaction.user.id;
            const challengeId = interaction.options.getString('id');

            if (challengeId) {
                // Get specific challenge
                const challenge = await interaction.client.db.collection('challenges').findOne({ id: challengeId });
                if (!challenge) {
                    return interaction.reply({
                        content: '❌ Challenge not found.',
                        ephemeral: true
                    });
                }

                const participant = challenge.participants.find(p => p.userId === userId);
                if (!participant) {
                    return interaction.reply({
                        content: '❌ You are not participating in this challenge.',
                        ephemeral: true
                    });
                }

                // Calculate progress
                const progress = (participant.wins / challenge.winsRequired) * 100;
                const timeLeft = challenge.endTime ? challenge.endTime - new Date() : null;
                const hypercharge = interaction.client.challengeManager.activeHypercharges.get(challengeId);

                const embed = {
                    title: `${challenge.icon} ${challenge.name}`,
                    description: challenge.description,
                    fields: [
                        { name: 'Progress', value: `${participant.wins}/${challenge.winsRequired} wins (${progress.toFixed(1)}%)`, inline: true },
                        { name: 'Lives Remaining', value: participant.lives.toString(), inline: true },
                        { name: 'Rep Earned', value: `${participant.repEarned}${hypercharge ? ` (+${hypercharge.multiplier}%)` : ''}`, inline: true }
                    ],
                    color: 0x5865F2,
                    timestamp: new Date()
                };

                if (timeLeft) {
                    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    embed.fields.push({
                        name: 'Time Remaining',
                        value: `${days}d ${hours}h`,
                        inline: true
                    });
                }

                if (hypercharge) {
                    const hyperchargeTimeLeft = hypercharge.expiresAt - new Date();
                    const hDays = Math.floor(hyperchargeTimeLeft / (1000 * 60 * 60 * 24));
                    const hHours = Math.floor((hyperchargeTimeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    embed.fields.push({
                        name: '⚡ Hypercharge Active',
                        value: `+${hypercharge.multiplier}% rep (${hDays}d ${hHours}h remaining)`,
                        inline: true
                    });
                }

                // Add match history
                if (participant.matches.length > 0) {
                    const recentMatches = participant.matches.slice(-5).reverse();
                    embed.fields.push({
                        name: 'Recent Matches',
                        value: recentMatches.map(match => {
                            const result = match.won ? '✅' : '❌';
                            const rep = match.repEarned > 0 ? ` (+${match.repEarned})` : '';
                            return `${result} ${new Date(match.timestamp).toLocaleString()}${rep}`;
                        }).join('\n'),
                        inline: false
                    });
                }

                await interaction.reply({ embeds: [embed] });
            } else {
                // Get all active challenges
                const challenges = await interaction.client.db.collection('challenges')
                    .find({
                        status: 'ACTIVE',
                        'participants.userId': userId
                    })
                    .toArray();

                if (challenges.length === 0) {
                    return interaction.reply({
                        content: '❌ You are not participating in any active challenges.',
                        ephemeral: true
                    });
                }

                const embed = {
                    title: '🎯 Your Active Challenges',
                    fields: await Promise.all(challenges.map(async challenge => {
                        const participant = challenge.participants.find(p => p.userId === userId);
                        const progress = (participant.wins / challenge.winsRequired) * 100;
                        const hypercharge = interaction.client.challengeManager.activeHypercharges.get(challenge.id);

                        return {
                            name: `${challenge.icon} ${challenge.name}`,
                            value: [
                                `Progress: ${participant.wins}/${challenge.winsRequired} wins (${progress.toFixed(1)}%)`,
                                `Lives: ${participant.lives}`,
                                `Rep: ${participant.repEarned}${hypercharge ? ` (+${hypercharge.multiplier}%)` : ''}`,
                                challenge.endTime ? `Ends: ${new Date(challenge.endTime).toLocaleString()}` : null
                            ].filter(Boolean).join('\n'),
                            inline: true
                        };
                    })),
                    color: 0x5865F2,
                    timestamp: new Date()
                };

                await interaction.reply({ embeds: [embed] });
            }
        } catch (error) {
            logger.error('Error in challenge progress command:', error);
            await interaction.reply({
                content: '❌ An error occurred while fetching challenge progress.',
                ephemeral: true
            });
        }
    }
}; 