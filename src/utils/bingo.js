const { createCanvas, loadImage } = require('canvas');
const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');

// Bingo card dimensions
const CARD_SIZE = 500;
const CELL_SIZE = 80;
const CELL_PADDING = 10;
const GRID_START_X = 50;
const GRID_START_Y = 50;

// Bingo quests
const BINGO_QUESTS = [
    'Solo Homerun',
    '2-Run Homerun',
    '3-Run Homerun',
    'Grand Slam',
    'Inside the Park',
    'Pitcher gets tired',
    'Triple',
    'Clamber catch',
    'Close play win',
    'Pitch a strikeout',
    'RBI chance',
    'Bunt for a hit',
    'Steal a base',
    'Ground rule double',
    'Fill star meter',
    'Get 1 run',
    'Get 3 runs',
    'Get 5 runs',
    'Non-cutscene home run',
    'Get walked/beaned',
    'Double play',
    'Win a rundown',
    'Get captain star swing out',
    'Slap hit',
    'Buddy jump catch',
    'Homerun',
    'Slap hit with a Kong',
    'Double with a baby',
    'Win a game',
    'Diving catch no super dive',
    'Double no items',
    'Bad chem throw',
    'Get a strikeout',
    'Pitch no hit inning',
    'Jump catch',
    'Shy guy super dive',
    'Star pitch strikeout',
    'Hit a fielder with fireball',
    'Hit a Home Run with a Toad',
    'Hit a Home Run with a Shy Guy',
    'Hit a Home Run with a Pianta',
    'Hit a Home Run with a Magikoopa',
    'Hit a Home Run with a Kritter',
    'Hit a Home Run with a Bro',
    'Hit a Home Run with a Dry Bones',
    'Hit a Home Run without a cutscene',
    'Win a close play',
    'Pull off a successful bunt',
    'Use 5 Star Swings',
    'Hit a single',
    'Hit a double',
    'Hit a triple',
    'Get an inside-in-the-park home run',
    'Get a hit with two outs',
    'Hit a grand slam',
    'Hit a ground rule double',
    'Successfully steal from 1B to 2B',
    'Successfully steal from 2B to 3B',
    'Have the FAIR! text display',
    'Get an out with Super Jump',
    'Get an out with Super Dive',
    'Get an out with Quick Throw',
    'Get an out with Laser Beam',
    'Get an out with Ball Dash',
    'Get a triple play',
    'Get an out with a buddy toss',
    'Have the Nice Play! text display',
    'Use 5 Star Pitches',
    'Bean ball the opponent',
    'Walk the opponent',
    'Hit with a Green Shell',
    'Hit with a Bob-Omb',
    'Hit with a Banana Peel',
    'Hit with a Fire Ball',
    'Hit with a Pow Ball',
    'Dodge Pow Ball'
];

/**
 * Generate a bingo card for a player
 */
async function generateBingoCard(client, userId, matchId) {
    try {
        // Get random quests for the card
        const shuffledQuests = [...BINGO_QUESTS].sort(() => Math.random() - 0.5);
        const cardQuests = shuffledQuests.slice(0, 25);

        // Create canvas
        const canvas = createCanvas(CARD_SIZE, CARD_SIZE);
        const ctx = canvas.getContext('2d');

        // Draw background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);

        // Draw grid
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;

        // Draw horizontal lines
        for (let i = 0; i <= 5; i++) {
            ctx.beginPath();
            ctx.moveTo(GRID_START_X, GRID_START_Y + i * CELL_SIZE);
            ctx.lineTo(GRID_START_X + 5 * CELL_SIZE, GRID_START_Y + i * CELL_SIZE);
            ctx.stroke();
        }

        // Draw vertical lines
        for (let i = 0; i <= 5; i++) {
            ctx.beginPath();
            ctx.moveTo(GRID_START_X + i * CELL_SIZE, GRID_START_Y);
            ctx.lineTo(GRID_START_X + i * CELL_SIZE, GRID_START_Y + 5 * CELL_SIZE);
            ctx.stroke();
        }

        // Draw column labels (1-5)
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        for (let i = 0; i < 5; i++) {
            ctx.fillText((i + 1).toString(), GRID_START_X + i * CELL_SIZE + CELL_SIZE / 2, GRID_START_Y - 10);
        }

        // Draw row labels (A-E)
        ctx.textAlign = 'right';
        for (let i = 0; i < 5; i++) {
            ctx.fillText(String.fromCharCode(65 + i), GRID_START_X - 10, GRID_START_Y + i * CELL_SIZE + CELL_SIZE / 2 + 7);
        }

        // Draw quests
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000000';
        for (let i = 0; i < 25; i++) {
            const row = Math.floor(i / 5);
            const col = i % 5;
            const x = GRID_START_X + col * CELL_SIZE + CELL_SIZE / 2;
            const y = GRID_START_Y + row * CELL_SIZE + CELL_SIZE / 2;

            // Draw quest text with word wrap
            wrapText(ctx, cardQuests[i], x, y - 20, CELL_SIZE - 2 * CELL_PADDING, 15);
        }

        // Save card to database
        const cardData = {
            userId,
            matchId,
            quests: cardQuests,
            markedSpaces: [],
            createdAt: new Date()
        };

        await client.db.collection('bingoCards').insertOne(cardData);

        // Save image to file
        const buffer = canvas.toBuffer('image/png');
        const filename = `bingo_${userId}_${matchId}.png`;
        const filepath = path.join(__dirname, '..', '..', 'temp', filename);
        await fs.writeFile(filepath, buffer);

        return {
            filepath,
            cardId: cardData._id
        };

    } catch (error) {
        logger.error('Error in generateBingoCard:', error);
        throw error;
    }
}

/**
 * Helper function to wrap text in canvas
 */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let lines = [];

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;

        if (testWidth > maxWidth && n > 0) {
            lines.push(line);
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line);

    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + i * lineHeight);
    }
}

/**
 * Mark a space on a bingo card
 */
async function markBingoSpace(client, userId, matchId, space) {
    try {
        // Validate space format (e.g., "A1", "B3", etc.)
        const match = space.match(/^([A-E])([1-5])$/);
        if (!match) {
            throw new Error('Invalid space format. Use format like "A1" or "B3"');
        }

        const row = match[1].charCodeAt(0) - 65; // Convert A-E to 0-4
        const col = parseInt(match[2]) - 1; // Convert 1-5 to 0-4
        const spaceIndex = row * 5 + col;

        // Get card from database
        const card = await client.db.collection('bingoCards').findOne({
            userId,
            matchId
        });

        if (!card) {
            throw new Error('No bingo card found for this match');
        }

        // Check if space is already marked
        if (card.markedSpaces.includes(spaceIndex)) {
            throw new Error('This space is already marked');
        }

        // Update card
        await client.db.collection('bingoCards').updateOne(
            { _id: card._id },
            {
                $push: { markedSpaces: spaceIndex }
            }
        );

        // Check for bingo
        const hasBingo = await checkForBingo(card.markedSpaces, spaceIndex);
        if (hasBingo) {
            await handleBingoWin(client, userId, matchId);
        }

        // Update card image
        await updateBingoCardImage(client, card, spaceIndex);

        return {
            hasBingo,
            markedSpaces: [...card.markedSpaces, spaceIndex]
        };

    } catch (error) {
        logger.error('Error in markBingoSpace:', error);
        throw error;
    }
}

/**
 * Check if a bingo has been achieved
 */
async function checkForBingo(markedSpaces, newSpace) {
    const row = Math.floor(newSpace / 5);
    const col = newSpace % 5;

    // Check row
    const rowSpaces = Array.from({ length: 5 }, (_, i) => row * 5 + i);
    if (rowSpaces.every(space => markedSpaces.includes(space))) {
        return true;
    }

    // Check column
    const colSpaces = Array.from({ length: 5 }, (_, i) => i * 5 + col);
    if (colSpaces.every(space => markedSpaces.includes(space))) {
        return true;
    }

    // Check diagonal (if space is on diagonal)
    if (row === col) {
        const diag1Spaces = Array.from({ length: 5 }, (_, i) => i * 5 + i);
        if (diag1Spaces.every(space => markedSpaces.includes(space))) {
            return true;
        }
    }

    if (row + col === 4) {
        const diag2Spaces = Array.from({ length: 5 }, (_, i) => i * 5 + (4 - i));
        if (diag2Spaces.every(space => markedSpaces.includes(space))) {
            return true;
        }
    }

    return false;
}

/**
 * Update bingo card image with marked spaces
 */
async function updateBingoCardImage(client, card, newSpace) {
    try {
        const canvas = createCanvas(CARD_SIZE, CARD_SIZE);
        const ctx = canvas.getContext('2d');

        // Load original card image
        const filename = `bingo_${card.userId}_${card.matchId}.png`;
        const filepath = path.join(__dirname, '..', '..', 'temp', filename);
        const image = await loadImage(filepath);
        ctx.drawImage(image, 0, 0);

        // Draw X on marked spaces
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;
        for (const space of [...card.markedSpaces, newSpace]) {
            const row = Math.floor(space / 5);
            const col = space % 5;
            const x = GRID_START_X + col * CELL_SIZE;
            const y = GRID_START_Y + row * CELL_SIZE;

            // Draw X
            ctx.beginPath();
            ctx.moveTo(x + CELL_PADDING, y + CELL_PADDING);
            ctx.lineTo(x + CELL_SIZE - CELL_PADDING, y + CELL_SIZE - CELL_PADDING);
            ctx.moveTo(x + CELL_SIZE - CELL_PADDING, y + CELL_PADDING);
            ctx.lineTo(x + CELL_PADDING, y + CELL_SIZE - CELL_PADDING);
            ctx.stroke();
        }

        // Save updated image
        const buffer = canvas.toBuffer('image/png');
        await fs.writeFile(filepath, buffer);

    } catch (error) {
        logger.error('Error in updateBingoCardImage:', error);
        throw error;
    }
}

/**
 * Handle bingo win
 */
async function handleBingoWin(client, userId, matchId) {
    try {
        // Get match data
        const match = await client.db.collection('matches').findOne({ _id: matchId });
        if (!match) {
            throw new Error('Match not found');
        }

        // Update match status
        await client.db.collection('matches').updateOne(
            { _id: matchId },
            {
                $set: {
                    status: 'COMPLETED',
                    endTime: new Date(),
                    winner: userId,
                    type: 'BINGO'
                }
            }
        );

        // Get player data
        const [player1, player2] = match.players;
        const [player1User, player2User] = await Promise.all([
            client.users.fetch(player1.userId),
            client.users.fetch(player2.userId)
        ]);

        // Create win embed
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Bingo Match Complete!')
            .setDescription(`${player1User.id === userId ? player1User : player2User} has won the bingo match!`)
            .setTimestamp();

        // Send win notification to both players
        await Promise.all([
            player1User.send({ embeds: [embed] }).catch(() => {}),
            player2User.send({ embeds: [embed] }).catch(() => {})
        ]);

        // Send win notification to ranked channel
        const server = await client.db.collection('servers').findOne({
            'channels.ranked': { $exists: true }
        });

        if (server) {
            const channel = await client.channels.fetch(server.channels.ranked);
            if (channel) {
                await channel.send({ embeds: [embed] });
            }
        }

    } catch (error) {
        logger.error('Error in handleBingoWin:', error);
        throw error;
    }
}

/**
 * Undo the last marked space
 */
async function undoLastMark(client, userId, matchId) {
    try {
        const card = await client.db.collection('bingoCards').findOne({
            userId,
            matchId
        });

        if (!card) {
            throw new Error('No bingo card found for this match');
        }

        if (card.markedSpaces.length === 0) {
            throw new Error('No spaces to undo');
        }

        const lastSpace = card.markedSpaces.pop();

        // Update card in database
        await client.db.collection('bingoCards').updateOne(
            { _id: card._id },
            {
                $set: { markedSpaces: card.markedSpaces }
            }
        );

        // Update card image
        await updateBingoCardImage(client, card, null);

        return {
            markedSpaces: card.markedSpaces,
            undoneSpace: lastSpace
        };

    } catch (error) {
        logger.error('Error in undoLastMark:', error);
        throw error;
    }
}

module.exports = {
    generateBingoCard,
    markBingoSpace,
    undoLastMark
}; 