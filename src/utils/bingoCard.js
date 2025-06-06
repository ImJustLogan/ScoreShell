const { createCanvas, loadImage } = require('canvas');
const logger = require('./logger');

// All possible bingo quests from design doc
const BINGO_QUESTS = [
    // Homeruns
    'Solo Homerun',
    '2-Run Homerun',
    '3-Run Homerun',
    'Grand Slam',
    'Inside the Park',
    'Non-cutscene home run',
    'Hit a Home Run with a Toad',
    'Hit a Home Run with a Shy Guy',
    'Hit a Home Run with a Pianta',
    'Hit a Home Run with a Magikoopa',
    'Hit a Home Run with a Kritter',
    'Hit a Home Run with a Bro',
    'Hit a Home Run with a Dry Bones',
    'Hit a Home Run without a cutscene',

    // Hits
    'Triple',
    'Double',
    'Single',
    'Ground rule double',
    'Double with a baby',
    'Double no items',
    'Hit a single',
    'Hit a double',
    'Hit a triple',
    'Get a hit with two outs',

    // Pitching
    'Pitcher gets tired',
    'Pitch a strikeout',
    'Get a strikeout',
    'Pitch no hit inning',
    'Star pitch strikeout',
    'Use 5 Star Pitches',

    // Fielding
    'Clamber catch',
    'Diving catch no super dive',
    'Jump catch',
    'Buddy jump catch',
    'Shy guy super dive',
    'Get an out with Super Jump',
    'Get an out with Super Dive',
    'Get an out with Quick Throw',
    'Get an out with Laser Beam',
    'Get an out with Ball Dash',
    'Get an out with a buddy toss',

    // Special Plays
    'Close play win',
    'RBI chance',
    'Bunt for a hit',
    'Steal a base',
    'Fill star meter',
    'Get 1 run',
    'Get 3 runs',
    'Get 5 runs',
    'Get walked/beaned',
    'Double play',
    'Win a rundown',
    'Get captain star swing out',
    'Slap hit',
    'Slap hit with a Kong',
    'Win a game',
    'Bad chem throw',
    'Hit a fielder with fireball',
    'Win a close play',
    'Pull off a successful bunt',
    'Use 5 Star Swings',
    'Get an inside-in-the-park home run',
    'Successfully steal from 1B to 2B',
    'Successfully steal from 2B to 3B',
    'Have the FAIR! text display',
    'Get a triple play',
    'Have the Nice Play! text display',

    // Items
    'Hit with a Green Shell',
    'Hit with a Bob-Omb',
    'Hit with a Banana Peel',
    'Hit with a Fire Ball',
    'Hit with a Pow Ball',
    'Dodge Pow Ball',
    'Bean ball the opponent',
    'Walk the opponent'
];

// Card dimensions and styling
const CARD_CONFIG = {
    width: 800,
    height: 800,
    cellSize: 150,
    padding: 25,
    fontSize: 16,
    lineHeight: 20,
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
    textColor: '#000000',
    headerColor: '#4A90E2',
    headerTextColor: '#FFFFFF',
    markedColor: '#FF0000',
    markedOpacity: 0.3
};

/**
 * Generates a random bingo card with 25 unique quests
 * @returns {string[]} Array of 25 quests in order (A1-E5)
 */
function generateBingoCard() {
    // Shuffle and take first 25 quests
    const shuffled = [...BINGO_QUESTS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 25);
}

/**
 * Creates a bingo card image with the given quests
 * @param {string[]} quests - Array of 25 quests
 * @param {Set<string>} markedSpaces - Set of marked spaces (e.g., 'A1', 'B3')
 * @returns {Promise<Buffer>} Image buffer of the bingo card
 */
async function createBingoCardImage(quests, markedSpaces = new Set()) {
    const canvas = createCanvas(CARD_CONFIG.width, CARD_CONFIG.height);
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = CARD_CONFIG.backgroundColor;
    ctx.fillRect(0, 0, CARD_CONFIG.width, CARD_CONFIG.height);

    // Draw grid
    ctx.strokeStyle = CARD_CONFIG.borderColor;
    ctx.lineWidth = 2;

    // Draw column headers (1-5)
    ctx.fillStyle = CARD_CONFIG.headerColor;
    ctx.fillRect(CARD_CONFIG.padding, CARD_CONFIG.padding, 
        CARD_CONFIG.cellSize * 5, CARD_CONFIG.cellSize);
    ctx.fillStyle = CARD_CONFIG.headerTextColor;
    ctx.font = `bold ${CARD_CONFIG.fontSize}px Arial`;
    ctx.textAlign = 'center';
    for (let i = 1; i <= 5; i++) {
        ctx.fillText(i.toString(), 
            CARD_CONFIG.padding + (i - 0.5) * CARD_CONFIG.cellSize,
            CARD_CONFIG.padding + CARD_CONFIG.cellSize / 2);
    }

    // Draw row headers (A-E)
    ctx.fillStyle = CARD_CONFIG.headerColor;
    ctx.fillRect(CARD_CONFIG.padding, CARD_CONFIG.padding + CARD_CONFIG.cellSize,
        CARD_CONFIG.cellSize, CARD_CONFIG.cellSize * 5);
    ctx.fillStyle = CARD_CONFIG.headerTextColor;
    for (let i = 0; i < 5; i++) {
        ctx.fillText(String.fromCharCode(65 + i),
            CARD_CONFIG.padding + CARD_CONFIG.cellSize / 2,
            CARD_CONFIG.padding + CARD_CONFIG.cellSize * (i + 1.5));
    }

    // Draw quests
    ctx.fillStyle = CARD_CONFIG.textColor;
    ctx.font = `${CARD_CONFIG.fontSize}px Arial`;
    ctx.textAlign = 'center';
    
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            const x = CARD_CONFIG.padding + CARD_CONFIG.cellSize * (col + 1);
            const y = CARD_CONFIG.padding + CARD_CONFIG.cellSize * (row + 1);
            const space = `${String.fromCharCode(65 + row)}${col + 1}`;
            
            // Draw cell border
            ctx.strokeRect(x, y, CARD_CONFIG.cellSize, CARD_CONFIG.cellSize);
            
            // If space is marked, add red overlay
            if (markedSpaces.has(space)) {
                ctx.fillStyle = CARD_CONFIG.markedColor;
                ctx.globalAlpha = CARD_CONFIG.markedOpacity;
                ctx.fillRect(x, y, CARD_CONFIG.cellSize, CARD_CONFIG.cellSize);
                ctx.globalAlpha = 1;
                ctx.fillStyle = CARD_CONFIG.textColor;
            }
            
            // Draw quest text (wrapped)
            const quest = quests[row * 5 + col];
            const words = quest.split(' ');
            let line = '';
            let lineY = y + CARD_CONFIG.padding;
            
            for (const word of words) {
                const testLine = line + word + ' ';
                const metrics = ctx.measureText(testLine);
                
                if (metrics.width > CARD_CONFIG.cellSize - 2 * CARD_CONFIG.padding) {
                    ctx.fillText(line, x + CARD_CONFIG.cellSize / 2, lineY);
                    line = word + ' ';
                    lineY += CARD_CONFIG.lineHeight;
                } else {
                    line = testLine;
                }
            }
            ctx.fillText(line, x + CARD_CONFIG.cellSize / 2, lineY);
        }
    }

    return canvas.toBuffer();
}

/**
 * Checks if a bingo card has a winning pattern
 * @param {Set<string>} markedSpaces - Set of marked spaces
 * @returns {boolean} True if there's a winning pattern
 */
function checkBingo(markedSpaces) {
    // Check rows
    for (let row = 0; row < 5; row++) {
        let rowComplete = true;
        for (let col = 0; col < 5; col++) {
            if (!markedSpaces.has(`${String.fromCharCode(65 + row)}${col + 1}`)) {
                rowComplete = false;
                break;
            }
        }
        if (rowComplete) return true;
    }

    // Check columns
    for (let col = 0; col < 5; col++) {
        let colComplete = true;
        for (let row = 0; row < 5; row++) {
            if (!markedSpaces.has(`${String.fromCharCode(65 + row)}${col + 1}`)) {
                colComplete = false;
                break;
            }
        }
        if (colComplete) return true;
    }

    // Check diagonals
    let diag1Complete = true;
    let diag2Complete = true;
    for (let i = 0; i < 5; i++) {
        if (!markedSpaces.has(`${String.fromCharCode(65 + i)}${i + 1}`)) {
            diag1Complete = false;
        }
        if (!markedSpaces.has(`${String.fromCharCode(65 + i)}${5 - i}`)) {
            diag2Complete = false;
        }
    }
    return diag1Complete || diag2Complete;
}

module.exports = {
    generateBingoCard,
    createBingoCardImage,
    checkBingo
}; 