const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
    category: 'user',
    data: new SlashCommandBuilder()
        .setName('bingo')
        .setDescription('Bingo card management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('mark')
                .setDescription('Mark a space on your bingo card as complete')
                .addStringOption(option =>
                    option.setName('position')
                        .setDescription('The position to mark (e.g. A1, B2, etc.)')
                        .setRequired(true)
                        .addChoices(
                            { name: 'A1', value: 'A1' }, { name: 'A2', value: 'A2' }, { name: 'A3', value: 'A3' }, { name: 'A4', value: 'A4' }, { name: 'A5', value: 'A5' },
                            { name: 'B1', value: 'B1' }, { name: 'B2', value: 'B2' }, { name: 'B3', value: 'B3' }, { name: 'B4', value: 'B4' }, { name: 'B5', value: 'B5' },
                            { name: 'C1', value: 'C1' }, { name: 'C2', value: 'C2' }, { name: 'C3', value: 'C3' }, { name: 'C4', value: 'C4' }, { name: 'C5', value: 'C5' },
                            { name: 'D1', value: 'D1' }, { name: 'D2', value: 'D2' }, { name: 'D3', value: 'D3' }, { name: 'D4', value: 'D4' }, { name: 'D5', value: 'D5' },
                            { name: 'E1', value: 'E1' }, { name: 'E2', value: 'E2' }, { name: 'E3', value: 'E3' }, { name: 'E4', value: 'E4' }, { name: 'E5', value: 'E5' }
                        ))),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Get the active match for this user
            const match = await interaction.client.db.collection('matches').findOne({
                'players.userId': interaction.user.id,
                'type': { $in: ['BINGO', 'DUEL'] },
                'status': 'IN_PROGRESS',
                'bingo.cards': { $exists: true }
            });

            if (!match) {
                return interaction.editReply({
                    content: 'You are not currently in an active bingo match.',
                    ephemeral: true
                });
            }

            // Find the player's bingo card
            const playerCard = match.bingo.cards.find(card => card.user.toString() === interaction.user.id);
            if (!playerCard) {
                return interaction.editReply({
                    content: 'Could not find your bingo card.',
                    ephemeral: true
                });
            }

            // Parse position (e.g. 'A1' -> row 0, col 0)
            const position = interaction.options.getString('position');
            const row = position.charCodeAt(0) - 'A'.charCodeAt(0);
            const col = parseInt(position[1]) - 1;

            // Check if position is already marked
            if (playerCard.markedSpaces[row][col]) {
                return interaction.editReply({
                    content: 'This space is already marked.',
                    ephemeral: true
                });
            }

            // Mark the space
            playerCard.markedSpaces[row][col] = true;

            // Check for completed lines
            const completedLines = checkCompletedLines(playerCard.markedSpaces);
            const newLines = completedLines.filter(line => !playerCard.completedLines.includes(line));
            playerCard.completedLines.push(...newLines);

            // Update the match in the database
            await interaction.client.db.collection('matches').updateOne(
                { _id: match._id },
                { 
                    $set: { 
                        'bingo.cards': match.bingo.cards
                    }
                }
            );

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('Bingo Space Marked')
                .setDescription(`Marked space ${position}: ${playerCard.card[row][col]}`)
                .addFields(
                    { name: 'Completed Lines', value: playerCard.completedLines.length.toString(), inline: true }
                );

            // If new lines were completed, add them to the embed
            if (newLines.length > 0) {
                embed.addFields({
                    name: 'New Lines Completed',
                    value: newLines.join('\n'),
                    inline: false
                });

                // Check for bingo win
                if (playerCard.completedLines.length >= 5) {
                    // Update match status
                    await interaction.client.db.collection('matches').updateOne(
                        { _id: match._id },
                        { 
                            $set: { 
                                status: 'COMPLETED',
                                winner: interaction.user.id,
                                endTime: new Date()
                            }
                        }
                    );

                    // Get opponent
                    const opponent = match.players.find(p => p.userId !== interaction.user.id);
                    const opponentUser = await interaction.client.users.fetch(opponent.userId);

                    // Create win announcement
                    const winEmbed = new EmbedBuilder()
                        .setColor('#ffd700')
                        .setTitle('🎉 BINGO!')
                        .setDescription(`${interaction.user} has won the bingo match against ${opponentUser}!`)
                        .addFields(
                            { name: 'Completed Lines', value: playerCard.completedLines.join('\n'), inline: false }
                        )
                        .setTimestamp();

                    // Send win announcement to the match channel
                    const channel = interaction.channel;
                    if (channel) {
                        await channel.send({ embeds: [winEmbed] });
                    }

                    // Also DM both players
                    await interaction.user.send({ embeds: [winEmbed] });
                    await opponentUser.send({ embeds: [winEmbed] });
                }
            }

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in bingo mark command:', error);
            return interaction.editReply({
                content: 'An error occurred while marking the bingo space.',
                ephemeral: true
            });
        }
    }
};

// Helper function to check for completed lines
function checkCompletedLines(markedSpaces) {
    const completedLines = [];
    const size = markedSpaces.length;

    // Check rows
    for (let row = 0; row < size; row++) {
        if (markedSpaces[row].every(marked => marked)) {
            completedLines.push(`${String.fromCharCode('A'.charCodeAt(0) + row)}1-${String.fromCharCode('A'.charCodeAt(0) + row)}${size}`);
        }
    }

    // Check columns
    for (let col = 0; col < size; col++) {
        if (markedSpaces.every(row => row[col])) {
            completedLines.push(`A${col + 1}-${String.fromCharCode('A'.charCodeAt(0) + size - 1)}${col + 1}`);
        }
    }

    // Check diagonals
    if (markedSpaces.every((row, i) => row[i])) {
        completedLines.push('A1-E5');
    }
    if (markedSpaces.every((row, i) => row[size - 1 - i])) {
        completedLines.push('A5-E1');
    }

    return completedLines;
} 