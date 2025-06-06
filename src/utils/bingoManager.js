const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Match = require('../models/Match');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

// Bingo configuration
const BINGO_CONFIG = {
    GRID_SIZE: 5,
    CELL_SIZE: 100,
    PADDING: 20,
    FONT_SIZE: 14,
    MARK_COLOR: '#FF0000',
    MARK_THICKNESS: 3,
    BACKGROUND_COLOR: '#FFFFFF',
    BORDER_COLOR: '#000000',
    TEXT_COLOR: '#000000',
    HEADER_COLOR: '#4A90E2',
    HEADER_HEIGHT: 40,
    ROWS: ['A', 'B', 'C', 'D', 'E'],
    COLS: ['1', '2', '3', '4', '5']
};

// Bingo quests with their descriptions
const BINGO_QUESTS = [
    // Homeruns
    { id: 'solo_hr', text: 'Solo Homerun', category: 'homerun' },
    { id: 'two_run_hr', text: '2-Run Homerun', category: 'homerun' },
    { id: 'three_run_hr', text: '3-Run Homerun', category: 'homerun' },
    { id: 'grand_slam', text: 'Grand Slam', category: 'homerun' },
    { id: 'inside_park', text: 'Inside the Park', category: 'homerun' },
    { id: 'non_cutscene_hr', text: 'Non-cutscene Homerun', category: 'homerun' },
    { id: 'toad_hr', text: 'Hit a Home Run with a Toad', category: 'homerun' },
    { id: 'shy_guy_hr', text: 'Hit a Home Run with a Shy Guy', category: 'homerun' },
    { id: 'pianta_hr', text: 'Hit a Home Run with a Pianta', category: 'homerun' },
    { id: 'magikoopa_hr', text: 'Hit a Home Run with a Magikoopa', category: 'homerun' },
    { id: 'kritter_hr', text: 'Hit a Home Run with a Kritter', category: 'homerun' },
    { id: 'bro_hr', text: 'Hit a Home Run with a Bro', category: 'homerun' },
    { id: 'dry_bones_hr', text: 'Hit a Home Run with a Dry Bones', category: 'homerun' },

    // Hits
    { id: 'single', text: 'Hit a single', category: 'hit' },
    { id: 'double', text: 'Hit a double', category: 'hit' },
    { id: 'triple', text: 'Hit a triple', category: 'hit' },
    { id: 'double_no_items', text: 'Double no items', category: 'hit' },
    { id: 'double_baby', text: 'Double with a baby', category: 'hit' },
    { id: 'slap_hit', text: 'Slap hit', category: 'hit' },
    { id: 'slap_hit_kong', text: 'Slap hit with a Kong', category: 'hit' },
    { id: 'ground_rule_double', text: 'Ground rule double', category: 'hit' },
    { id: 'bunt_hit', text: 'Pull off a successful bunt', category: 'hit' },
    { id: 'hit_two_outs', text: 'Get a hit with two outs', category: 'hit' },

    // Pitching
    { id: 'pitcher_tired', text: 'Pitcher gets tired', category: 'pitching' },
    { id: 'strikeout', text: 'Pitch a strikeout', category: 'pitching' },
    { id: 'star_pitch_strikeout', text: 'Star pitch strikeout', category: 'pitching' },
    { id: 'no_hit_inning', text: 'Pitch no hit inning', category: 'pitching' },
    { id: 'bean_ball', text: 'Bean ball the opponent', category: 'pitching' },
    { id: 'walk', text: 'Walk the opponent', category: 'pitching' },
    { id: 'use_star_pitches', text: 'Use 5 Star Pitches', category: 'pitching' },

    // Fielding
    { id: 'clamber_catch', text: 'Clamber catch', category: 'fielding' },
    { id: 'diving_catch', text: 'Diving catch no super dive', category: 'fielding' },
    { id: 'jump_catch', text: 'Jump catch', category: 'fielding' },
    { id: 'buddy_jump_catch', text: 'Buddy jump catch', category: 'fielding' },
    { id: 'shy_guy_super_dive', text: 'Shy guy super dive', category: 'fielding' },
    { id: 'super_jump_out', text: 'Get an out with Super Jump', category: 'fielding' },
    { id: 'super_dive_out', text: 'Get an out with Super Dive', category: 'fielding' },
    { id: 'quick_throw_out', text: 'Get an out with Quick Throw', category: 'fielding' },
    { id: 'laser_beam_out', text: 'Get an out with Laser Beam', category: 'fielding' },
    { id: 'ball_dash_out', text: 'Get an out with Ball Dash', category: 'fielding' },
    { id: 'buddy_toss_out', text: 'Get an out with a buddy toss', category: 'fielding' },
    { id: 'triple_play', text: 'Get a triple play', category: 'fielding' },

    // Baserunning
    { id: 'steal_1b_2b', text: 'Successfully steal from 1B to 2B', category: 'baserunning' },
    { id: 'steal_2b_3b', text: 'Successfully steal from 2B to 3B', category: 'baserunning' },
    { id: 'rundown_win', text: 'Win a rundown', category: 'baserunning' },
    { id: 'close_play_win', text: 'Win a close play', category: 'baserunning' },

    // Star Moves
    { id: 'fill_star_meter', text: 'Fill star meter', category: 'star' },
    { id: 'captain_star_swing', text: 'Get captain star swing out', category: 'star' },
    { id: 'use_star_swings', text: 'Use 5 Star Swings', category: 'star' },

    // Items
    { id: 'green_shell_hit', text: 'Hit with a Green Shell', category: 'items' },
    { id: 'bob_omb_hit', text: 'Hit with a Bob-Omb', category: 'items' },
    { id: 'banana_hit', text: 'Hit with a Banana Peel', category: 'items' },
    { id: 'fire_ball_hit', text: 'Hit with a Fire Ball', category: 'items' },
    { id: 'pow_ball_hit', text: 'Hit with a Pow Ball', category: 'items' },
    { id: 'dodge_pow', text: 'Dodge Pow Ball', category: 'items' },

    // Scoring
    { id: 'get_1_run', text: 'Get 1 run', category: 'scoring' },
    { id: 'get_3_runs', text: 'Get 3 runs', category: 'scoring' },
    { id: 'get_5_runs', text: 'Get 5 runs', category: 'scoring' },
    { id: 'rbi_chance', text: 'RBI chance', category: 'scoring' },

    // Misc
    { id: 'fair_text', text: 'Have the FAIR! text display', category: 'misc' },
    { id: 'nice_play', text: 'Have the Nice Play! text display', category: 'misc' },
    { id: 'win_game', text: 'Win a game', category: 'misc' },
    { id: 'bad_chem_throw', text: 'Bad chem throw', category: 'misc' }
];

class BingoManager {
    constructor(client) {
        this.client = client;
        this.activeCards = new Map(); // Map of userId -> { card: BingoCard, matchId: string }
        this.cardHistory = new Map(); // Map of userId -> [BingoCard]
        this.activeBingos = new Map(); // Map of matchId -> { channel, message, timeout }
        
        // Define bingo categories and their possible tasks
        this.categories = {
            'KILLS': [
                'Get 5 kills in one match',
                'Get 10 kills in one match',
                'Get a triple kill',
                'Get a quad kill',
                'Get a penta kill',
                'Kill an enemy with super',
                'Kill an enemy with gadget',
                'Kill an enemy with star power',
                'Kill an enemy while at low health',
                'Kill an enemy from long range'
            ],
            'OBJECTIVES': [
                'Capture the gem grab',
                'Score 2 goals in brawl ball',
                'Control the center in hot zone',
                'Collect 10 gems',
                'Score a goal from midfield',
                'Control 2 zones simultaneously',
                'Defend the safe for 30 seconds',
                'Break the safe in under 30 seconds',
                'Collect the most power cubes',
                'Win without dying'
            ],
            'TEAMPLAY': [
                'Heal a teammate for 2000 health',
                'Save a teammate from death',
                'Assist in 3 kills',
                'Share power cubes with teammate',
                'Win with both teammates alive',
                'Revive a teammate',
                'Protect a teammate from death',
                'Help teammate score a goal',
                'Control zone with teammate',
                'Win with perfect team coordination'
            ],
            'SURVIVAL': [
                'Survive for 2 minutes',
                'End match with full health',
                'Dodge 5 attacks',
                'Escape when surrounded',
                'Survive with 1 HP',
                'Win without taking damage',
                'Survive a 1v2 situation',
                'Escape using a wall',
                'Win without using super',
                'Survive in the gas'
            ],
            'SKILL': [
                'Hit 3 enemies with one attack',
                'Land 5 consecutive shots',
                'Dodge a super attack',
                'Win a 1v1 duel',
                'Hit a moving target',
                'Use super at perfect timing',
                'Chain 3 kills together',
                'Win without using gadget',
                'Win without using star power',
                'Win with a comeback'
            ]
        };
    }

    // Card Generation
    async generateCard(userId, matchId) {
        try {
            // Check if user already has an active card
            if (this.activeCards.has(userId)) {
                throw new Error('User already has an active bingo card');
            }

            // Generate random quests for the card
            const quests = this.generateRandomQuests();
            
            // Create card object
            const card = {
                userId,
                matchId,
                quests,
                marked: new Set(),
                createdAt: new Date(),
                lastMarked: null
            };

            // Generate card image
            const imagePath = await this.generateCardImage(card);

            // Store card
            this.activeCards.set(userId, card);
            this.cardHistory.get(userId)?.push(card) || this.cardHistory.set(userId, [card]);

            return {
                card,
                imagePath
            };
        } catch (error) {
            logger.error('Error generating bingo card:', error);
            throw error;
        }
    }

    generateRandomQuests() {
        const quests = [...BINGO_QUESTS];
        const grid = [];

        // Shuffle quests
        for (let i = quests.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [quests[i], quests[j]] = [quests[j], quests[i]];
        }

        // Create 5x5 grid
        for (let i = 0; i < BINGO_CONFIG.GRID_SIZE; i++) {
            const row = [];
            for (let j = 0; j < BINGO_CONFIG.GRID_SIZE; j++) {
                const quest = quests[i * BINGO_CONFIG.GRID_SIZE + j];
                row.push({
                    id: quest.id,
                    text: quest.text,
                    category: quest.category,
                    position: `${BINGO_CONFIG.ROWS[i]}${BINGO_CONFIG.COLS[j]}`
                });
            }
            grid.push(row);
        }

        return grid;
    }

    async generateCardImage(card) {
        try {
            const canvas = createCanvas(
                BINGO_CONFIG.CELL_SIZE * BINGO_CONFIG.GRID_SIZE + BINGO_CONFIG.PADDING * 2,
                BINGO_CONFIG.CELL_SIZE * BINGO_CONFIG.GRID_SIZE + BINGO_CONFIG.PADDING * 2 + BINGO_CONFIG.HEADER_HEIGHT
            );
            const ctx = canvas.getContext('2d');

            // Draw background
            ctx.fillStyle = BINGO_CONFIG.BACKGROUND_COLOR;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw header
            ctx.fillStyle = BINGO_CONFIG.HEADER_COLOR;
            ctx.fillRect(0, 0, canvas.width, BINGO_CONFIG.HEADER_HEIGHT);
            ctx.fillStyle = BINGO_CONFIG.TEXT_COLOR;
            ctx.font = `bold ${BINGO_CONFIG.FONT_SIZE * 1.5}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText('BINGO CARD', canvas.width / 2, BINGO_CONFIG.HEADER_HEIGHT / 2 + 5);

            // Draw grid
            ctx.strokeStyle = BINGO_CONFIG.BORDER_COLOR;
            ctx.lineWidth = 2;
            ctx.font = `${BINGO_CONFIG.FONT_SIZE}px Arial`;

            for (let i = 0; i < BINGO_CONFIG.GRID_SIZE; i++) {
                for (let j = 0; j < BINGO_CONFIG.GRID_SIZE; j++) {
                    const x = BINGO_CONFIG.PADDING + j * BINGO_CONFIG.CELL_SIZE;
                    const y = BINGO_CONFIG.PADDING + BINGO_CONFIG.HEADER_HEIGHT + i * BINGO_CONFIG.CELL_SIZE;

                    // Draw cell border
                    ctx.strokeRect(x, y, BINGO_CONFIG.CELL_SIZE, BINGO_CONFIG.CELL_SIZE);

                    // Draw position label
                    ctx.fillStyle = BINGO_CONFIG.TEXT_COLOR;
                    ctx.textAlign = 'left';
                    ctx.fillText(
                        `${BINGO_CONFIG.ROWS[i]}${BINGO_CONFIG.COLS[j]}`,
                        x + 5,
                        y + 15
                    );

                    // Draw quest text
                    const quest = card.quests[i][j];
                    ctx.fillStyle = card.marked.has(quest.position) ? BINGO_CONFIG.MARK_COLOR : BINGO_CONFIG.TEXT_COLOR;
                    
                    // Word wrap text
                    const words = quest.text.split(' ');
                    let line = '';
                    let lineY = y + 35;
                    
                    for (const word of words) {
                        const testLine = line + word + ' ';
                        const metrics = ctx.measureText(testLine);
                        if (metrics.width > BINGO_CONFIG.CELL_SIZE - 10) {
                            ctx.fillText(line, x + 5, lineY);
                            line = word + ' ';
                            lineY += 20;
                        } else {
                            line = testLine;
                        }
                    }
                    ctx.fillText(line, x + 5, lineY);

                    // Draw mark if marked
                    if (card.marked.has(quest.position)) {
                        ctx.strokeStyle = BINGO_CONFIG.MARK_COLOR;
                        ctx.lineWidth = BINGO_CONFIG.MARK_THICKNESS;
                        ctx.beginPath();
                        ctx.moveTo(x + 5, y + 5);
                        ctx.lineTo(x + BINGO_CONFIG.CELL_SIZE - 5, y + BINGO_CONFIG.CELL_SIZE - 5);
                        ctx.moveTo(x + BINGO_CONFIG.CELL_SIZE - 5, y + 5);
                        ctx.lineTo(x + 5, y + BINGO_CONFIG.CELL_SIZE - 5);
                        ctx.stroke();
                    }
                }
            }

            // Save image
            const imagePath = path.join(__dirname, '..', 'temp', `bingo_${card.userId}_${Date.now()}.png`);
            await fs.mkdir(path.dirname(imagePath), { recursive: true });
            const buffer = canvas.toBuffer('image/png');
            await fs.writeFile(imagePath, buffer);

            return imagePath;
        } catch (error) {
            logger.error('Error generating bingo card image:', error);
            throw error;
        }
    }

    // Card Marking
    async markSpace(userId, position) {
        try {
            const card = this.activeCards.get(userId);
            if (!card) {
                throw new Error('No active bingo card found');
            }

            // Validate position format
            if (!this.validatePosition(position)) {
                throw new Error('Invalid position format. Use format like "A1", "B2", etc.');
            }

            // Check if already marked
            if (card.marked.has(position)) {
                throw new Error('This space is already marked');
            }

            // Mark the space
            card.marked.add(position);
            card.lastMarked = new Date();

            // Check for bingo
            const hasBingo = this.checkForBingo(card);
            
            // Update card image
            const imagePath = await this.generateCardImage(card);

            return {
                hasBingo,
                imagePath,
                markedCount: card.marked.size
            };
        } catch (error) {
            logger.error('Error marking bingo space:', error);
            throw error;
        }
    }

    async undoLastMark(userId) {
        try {
            const card = this.activeCards.get(userId);
            if (!card) {
                throw new Error('No active bingo card found');
            }

            if (card.marked.size === 0) {
                throw new Error('No marks to undo');
            }

            // Remove last marked position
            const lastMarked = Array.from(card.marked).pop();
            card.marked.delete(lastMarked);
            card.lastMarked = new Date();

            // Update card image
            const imagePath = await this.generateCardImage(card);

            return {
                imagePath,
                markedCount: card.marked.size,
                undonePosition: lastMarked
            };
        } catch (error) {
            logger.error('Error undoing bingo mark:', error);
            throw error;
        }
    }

    // Validation
    validatePosition(position) {
        if (typeof position !== 'string' || position.length !== 2) {
            return false;
        }

        const row = position[0].toUpperCase();
        const col = position[1];

        return BINGO_CONFIG.ROWS.includes(row) && BINGO_CONFIG.COLS.includes(col);
    }

    checkForBingo(card) {
        const marked = card.marked;
        
        // Check rows
        for (let i = 0; i < BINGO_CONFIG.GRID_SIZE; i++) {
            const row = BINGO_CONFIG.ROWS[i];
            if (BINGO_CONFIG.COLS.every(col => marked.has(`${row}${col}`))) {
                return true;
            }
        }

        // Check columns
        for (let j = 0; j < BINGO_CONFIG.GRID_SIZE; j++) {
            const col = BINGO_CONFIG.COLS[j];
            if (BINGO_CONFIG.ROWS.every(row => marked.has(`${row}${col}`))) {
                return true;
            }
        }

        // Check diagonals
        const diagonal1 = BINGO_CONFIG.ROWS.every((row, i) => 
            marked.has(`${row}${BINGO_CONFIG.COLS[i]}`)
        );
        if (diagonal1) return true;

        const diagonal2 = BINGO_CONFIG.ROWS.every((row, i) => 
            marked.has(`${row}${BINGO_CONFIG.COLS[BINGO_CONFIG.GRID_SIZE - 1 - i]}`)
        );
        if (diagonal2) return true;

        return false;
    }

    // Card Management
    async endCard(userId) {
        try {
            const card = this.activeCards.get(userId);
            if (!card) {
                throw new Error('No active bingo card found');
            }

            // Store final state
            card.endedAt = new Date();
            card.finalState = {
                marked: Array.from(card.marked),
                hasBingo: this.checkForBingo(card)
            };

            // Remove from active cards
            this.activeCards.delete(userId);

            return card;
        } catch (error) {
            logger.error('Error ending bingo card:', error);
            throw error;
        }
    }

    // Utility Methods
    getCardStatus(userId) {
        const card = this.activeCards.get(userId);
        if (!card) return null;

        return {
            matchId: card.matchId,
            markedCount: card.marked.size,
            hasBingo: this.checkForBingo(card),
            lastMarked: card.lastMarked,
            createdAt: card.createdAt
        };
    }

    getCardHistory(userId) {
        return this.cardHistory.get(userId) || [];
    }

    cleanupOldCards() {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;

        for (const [userId, card] of this.activeCards) {
            if (now - card.createdAt > oneDay) {
                this.endCard(userId);
            }
        }
    }

    async generateBingoCard(match, channel) {
        // Generate a 5x5 bingo card
        const card = [];
        const usedTasks = new Set();

        // Fill each row with tasks from a specific category
        for (const category of Object.keys(this.categories)) {
            const tasks = this.categories[category];
            const row = [];
            
            // Get 5 unique tasks from this category
            while (row.length < 5) {
                const task = tasks[Math.floor(Math.random() * tasks.length)];
                if (!usedTasks.has(task)) {
                    row.push({
                        task,
                        category,
                        completed: false,
                        completedBy: null,
                        completedAt: null
                    });
                    usedTasks.add(task);
                }
            }
            
            card.push(row);
        }

        // Create bingo card embed
        const embed = new EmbedBuilder()
            .setTitle('Bingo Card')
            .setDescription('Complete tasks to mark them off your bingo card!')
            .setColor('#FFD700')
            .addFields([
                {
                    name: 'Players',
                    value: match.players.map(p => `<@${p.userId}>`).join(' vs '),
                    inline: false
                },
                {
                    name: 'How to Play',
                    value: 'Complete tasks during the match to mark them off. First to complete a row, column, or diagonal wins!',
                    inline: false
                }
            ]);

        // Create bingo card display
        for (let i = 0; i < 5; i++) {
            let rowText = '';
            for (let j = 0; j < 5; j++) {
                const task = card[i][j];
                rowText += `${task.completed ? '✅' : '⬜'} ${task.task}\n`;
            }
            embed.addFields({
                name: `Row ${i + 1}`,
                value: rowText,
                inline: false
            });
        }

        // Create task completion buttons
        const rows = [];
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 5; j++) {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bingo_complete_${match._id}_${i}_${j}`)
                            .setLabel(`Complete ${i + 1}-${j + 1}`)
                            .setStyle(ButtonStyle.Primary)
                    );
                rows.push(row);
            }
        }

        // Send to match channel
        const message = await channel.send({
            embeds: [embed],
            components: rows
        });

        // Set timeout for bingo completion (10 minutes)
        const timeout = setTimeout(async () => {
            if (this.activeBingos.has(match._id)) {
                await this.handleBingoTimeout(match, channel);
            }
        }, 600000); // 10 minutes

        this.activeBingos.set(match._id, {
            channel,
            message,
            timeout,
            card,
            lastUpdate: new Date()
        });

        // Update match document
        match.bingo = {
            card,
            winner: null,
            completedAt: null
        };
        await match.save();

        return true;
    }

    async handleTaskCompletion(matchId, userId, row, col) {
        const bingoData = this.activeBingos.get(matchId);
        if (!bingoData) return false;

        const match = await Match.findById(matchId);
        if (!match) return false;

        // Update task completion
        const task = bingoData.card[row][col];
        if (task.completed) return false;

        task.completed = true;
        task.completedBy = userId;
        task.completedAt = new Date();

        // Update bingo card display
        const embed = bingoData.message.embeds[0];
        const rowField = embed.fields[row + 2]; // +2 for title and how to play fields
        let rowText = '';
        for (let j = 0; j < 5; j++) {
            const task = bingoData.card[row][j];
            rowText += `${task.completed ? '✅' : '⬜'} ${task.task}\n`;
        }
        rowField.value = rowText;

        // Check for bingo
        const hasBingo = this.checkForBingo(bingoData.card);
        if (hasBingo) {
            // Update match status
            match.status = 'COMPLETED';
            match.endTime = new Date();
            match.bingo.winner = userId;
            match.bingo.completedAt = new Date();
            match.history.push({
                action: 'COMPLETED',
                reason: 'Bingo completed',
                timestamp: new Date()
            });
            await match.save();

            // Notify players
            const winEmbed = new EmbedBuilder()
                .setTitle('Bingo Completed!')
                .setDescription(`<@${userId}> has completed a bingo and won the match!`)
                .setColor('#FFD700');

            await bingoData.channel.send({
                content: match.players.map(p => `<@${p.userId}>`).join(' '),
                embeds: [winEmbed]
            });

            // Clean up
            clearTimeout(bingoData.timeout);
            this.activeBingos.delete(matchId);

            // Remove completion buttons
            await bingoData.message.edit({
                components: []
            });
        } else {
            // Update the message
            await bingoData.message.edit({
                embeds: [embed]
            });
        }

        return true;
    }

    async handleBingoTimeout(match, channel) {
        const bingoData = this.activeBingos.get(match._id);
        if (!bingoData) return;

        clearTimeout(bingoData.timeout);
        this.activeBingos.delete(match._id);

        // Update match status
        match.status = 'CANCELLED';
        match.endTime = new Date();
        match.history.push({
            action: 'CANCELLED',
            reason: 'Bingo timeout',
            timestamp: new Date()
        });
        await match.save();

        // Notify players
        const embed = new EmbedBuilder()
            .setTitle('Bingo Cancelled')
            .setDescription('Bingo match was cancelled due to timeout. No winner declared.')
            .setColor('#FF0000');

        await channel.send({
            content: match.players.map(p => `<@${p.userId}>`).join(' '),
            embeds: [embed]
        });

        // Remove completion buttons
        await bingoData.message.edit({
            components: []
        });
    }

    async cancelBingo(matchId) {
        const bingoData = this.activeBingos.get(matchId);
        if (bingoData) {
            clearTimeout(bingoData.timeout);
            this.activeBingos.delete(matchId);
        }
    }
}

module.exports = BingoManager; 