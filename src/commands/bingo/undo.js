const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { createCanvas } = require('canvas');
const logger = require('../../utils/logger');
const User = require('../../models/User');
const Match = require('../../models/Match');
const { undoBingoMark, generateBingoCardImage } = require('../../utils/bingo');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('undo')
        .setDescription('Undo your last mark on the bingo card'),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Get user's bingo card
            const bingoCard = interaction.client.userBingoCards?.get(interaction.user.id);
            if (!bingoCard) {
                return interaction.editReply({
                    content: '❌ You don\'t have a bingo card! Use `/bingo card` to generate one.',
                    ephemeral: true
                });
            }

            // Undo the last mark
            const result = undoBingoMark(bingoCard);
            if (!result.success) {
                return interaction.editReply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
            }

            // Generate updated card image
            const cardImage = await generateBingoCardImage(bingoCard);

            // Send updated card
            await interaction.editReply({
                content: `✅ ${result.message}`,
                files: [{
                    attachment: cardImage,
                    name: 'bingo-card.png'
                }]
            });

            logger.info(`User ${interaction.user.tag} undid their last mark on their bingo card`);
        } catch (error) {
            logger.error('Error undoing bingo mark:', error);
            await interaction.editReply({
                content: '❌ An error occurred while undoing your mark. Please try again.',
                ephemeral: true
            });
        }
    }
};

// Helper function to generate bingo card image
async function generateBingoCardImage(bingoCard) {
    const canvas = createCanvas(800, 800);
    const ctx = canvas.getContext('2d');

    // Set background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 800, 800);

    // Draw grid
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;

    // Draw vertical lines
    for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 160, 0);
        ctx.lineTo(i * 160, 800);
        ctx.stroke();
    }

    // Draw horizontal lines
    for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * 160);
        ctx.lineTo(800, i * 160);
        ctx.stroke();
    }

    // Draw column labels (1-5)
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    for (let i = 0; i < 5; i++) {
        ctx.fillText((i + 1).toString(), 80 + i * 160, 30);
    }

    // Draw row labels (A-E)
    ctx.textAlign = 'center';
    for (let i = 0; i < 5; i++) {
        ctx.fillText(String.fromCharCode(65 + i), 30, 100 + i * 160);
    }

    // Draw quests and marked spaces
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    for (let i = 0; i < 25; i++) {
        const row = Math.floor(i / 5);
        const col = i % 5;
        const x = 80 + col * 160;
        const y = 100 + row * 160;

        // Draw quest text
        const words = bingoCard.card[row][col].split(' ');
        let line = '';
        let lineY = y - 40;

        for (let word of words) {
            const testLine = line + word + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > 140) {
                ctx.fillText(line, x, lineY);
                line = word + ' ';
                lineY += 20;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, lineY);

        // Draw X for marked spaces
        if (bingoCard.markedSpaces[row][col]) {
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x - 50, y - 60);
            ctx.lineTo(x + 50, y + 60);
            ctx.moveTo(x + 50, y - 60);
            ctx.lineTo(x - 50, y + 60);
            ctx.stroke();
        }
    }

    return canvas.toBuffer('image/png');
} 