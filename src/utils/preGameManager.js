const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');
const Match = require('../models/Match');
const RoomCodeManager = require('./roomCodeManager');
const User = require('../models/User');

// Available stages for banning
const STAGES = [
    'Mario Stadium',
    'Luigi\'s Mansion',
    'Peach Ice Garden',
    'Daisy Cruiser',
    'Daisy Cruiser (Night)',
    'Yoshi Park',
    'Yoshi Park (Night)',
    'Wario City',
    'Bowser Jr. Playroom',
    'Bowser Castle'
];

// Available captains for selection
const CAPTAINS = [
    'Mario',
    'Luigi',
    'Peach',
    'Daisy',
    'Yoshi',
    'Birdo',
    'Wario',
    'Waluigi',
    'Donkey Kong',
    'Diddy Kong',
    'Bowser',
    'Bowser Jr.'
];

// Pre-game phase states
const PHASE = {
    STAGE_BANNING: 'STAGE_BANNING',
    CAPTAIN_SELECTION: 'CAPTAIN_SELECTION',
    HOST_SELECTION: 'HOST_SELECTION',
    ROOM_CODE: 'ROOM_CODE'
};

// Timeouts for each phase (in milliseconds)
const TIMEOUTS = {
    STAGE_BAN: 60000, // 1 minute
    CAPTAIN_PICK: 60000, // 1 minute
    HOST_SELECTION: 30000, // 30 seconds
    ROOM_CODE: 120000 // 2 minutes
};

class PreGameManager {
    constructor(client) {
        this.client = client;
        this.activeMatches = new Map(); // Map of matchId -> { channel, message, timeout, currentPhase }
        this.roomCodeManager = new RoomCodeManager(client);
        
        // Available stages and captains
        this.stages = [
            'Mario Stadium',
            'Luigi\'s Mansion',
            'Peach Ice Garden',
            'Daisy Cruiser',
            'Daisy Cruiser (Night)',
            'Yoshi Park',
            'Yoshi Park (Night)',
            'Wario City',
            'Bowser Jr. Playroom',
            'Bowser Castle'
        ];
        
        this.captains = [
            'Mario', 'Luigi', 'Peach', 'Daisy', 'Yoshi', 'Birdo',
            'Wario', 'Waluigi', 'Donkey Kong', 'Diddy Kong',
            'Bowser', 'Bowser Jr.'
        ];

        // Rank order for comparison
        this.rankOrder = {
            'BRONZE': 0,
            'SILVER': 1,
            'GOLD': 2,
            'DIAMOND': 3,
            'MYTHIC': 4,
            'LEGENDARY': 5,
            'MASTERS': 6
        };

        this.tierOrder = {
            'I': 0,
            'II': 1,
            'III': 2
        };

        // Add hypercharge configuration
        this.hyperchargeConfig = {
            CHANCE: 0.1, // 10% chance for hypercharge
            MULTIPLIER: 0.5, // 50% multiplier
            ANNOUNCEMENT_COLOR: '#FF0000', // Red color for hypercharge announcements
            ANNOUNCEMENT_DURATION: 5000 // 5 seconds to display announcement
        };

        // Handle server restart
        client.on('ready', async () => {
            // Find all matches in PREGAME status
            const activeMatches = await Match.find({ status: 'PREGAME' });
            for (const match of activeMatches) {
                // Award 50 rep to both players
                for (const player of match.players) {
                    await User.findByIdAndUpdate(player.user, {
                        $inc: { rep: 50 }
                    });
                }
                
                // Update match status
                match.status = 'CANCELLED';
                match.endTime = new Date();
                match.history.push({
                    action: 'CANCELLED',
                    reason: 'Server restart during pre-game',
                    timestamp: new Date()
                });
                await match.save();

                // Notify players if possible
                try {
                    const channel = await client.channels.fetch(match.channelId);
                    if (channel) {
                        const embed = new EmbedBuilder()
                            .setTitle('Match Cancelled')
                            .setDescription('Match was cancelled due to server restart. Both players have been awarded 50 rep.')
                            .setColor('#FF0000');

                        await channel.send({
                            content: match.players.map(p => `<@${p.userId}>`).join(' '),
                            embeds: [embed]
                        });
                    }
                } catch (error) {
                    // Channel not found or other error, ignore
                }
            }
        });
    }

    /**
     * Start the pre-game phase for a match
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel to send messages in
     * @param {boolean} isHypercharged - Whether this match is hypercharged
     */
    async startPreGame(match, channel, isHypercharged = false) {
        try {
            // Initialize pre-game state
            const preGameState = {
                phase: PHASE.STAGE_BANNING,
                currentPlayerIndex: 0,
                bannedStages: [],
                availableStages: [...STAGES],
                selectedCaptains: [],
                hostSelected: false,
                roomCode: null,
                message: null,
                collector: null,
                isHypercharged: isHypercharged || Math.random() < this.hyperchargeConfig.CHANCE
            };

            // Store hypercharge status in match
            if (preGameState.isHypercharged) {
                await this.client.db.collection('matches').updateOne(
                    { _id: match._id },
                    { 
                        $set: { 
                            isHypercharged: true,
                            hyperchargeMultiplier: this.hyperchargeConfig.MULTIPLIER
                        }
                    }
                );
            }

            this.activeMatches.set(match._id.toString(), preGameState);

            // Announce hypercharge if active
            if (preGameState.isHypercharged) {
                await this.announceHypercharge(match, channel);
            }

            // Start stage banning phase
            await this.startStageBanning(match, channel, preGameState);
        } catch (error) {
            logger.error('Error starting pre-game:', error);
            await this.handlePreGameError(match, channel, error);
            throw error;
        }
    }

    /**
     * Announce hypercharge status to players
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     */
    async announceHypercharge(match, channel) {
        try {
            const embed = new EmbedBuilder()
                .setColor(this.hyperchargeConfig.ANNOUNCEMENT_COLOR)
                .setTitle('⚡ HYPERCHARGE ACTIVATED ⚡')
                .setDescription(`This match has been hypercharged!\nWinners will earn ${this.hyperchargeConfig.MULTIPLIER * 100}% more rep!\nLosers will lose ${this.hyperchargeConfig.MULTIPLIER * 50}% less rep!`)
                .setTimestamp();

            const message = await channel.send({ embeds: [embed] });

            // Delete announcement after duration
            setTimeout(async () => {
                try {
                    await message.delete();
                } catch (error) {
                    logger.error('Error deleting hypercharge announcement:', error);
                }
            }, this.hyperchargeConfig.ANNOUNCEMENT_DURATION);

            // Notify players via DM
            for (const player of match.players) {
                try {
                    const user = await this.client.users.fetch(player.userId);
                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(this.hyperchargeConfig.ANNOUNCEMENT_COLOR)
                                .setTitle('⚡ Match Hypercharged! ⚡')
                                .setDescription(`Your upcoming match has been hypercharged!\nWin to earn ${this.hyperchargeConfig.MULTIPLIER * 100}% more rep!\nEven if you lose, you'll only lose ${this.hyperchargeConfig.MULTIPLIER * 50}% of the normal amount!`)
                                .setTimestamp()
                        ]
                    });
                } catch (error) {
                    logger.error(`Error sending hypercharge DM to user ${player.userId}:`, error);
                }
            }
        } catch (error) {
            logger.error('Error announcing hypercharge:', error);
        }
    }

    /**
     * Handle pre-game errors gracefully
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {Error} error - The error that occurred
     */
    async handlePreGameError(match, channel, error) {
        try {
            // Update match status
            await this.client.db.collection('matches').updateOne(
                { _id: match._id },
                { 
                    $set: { 
                        status: 'FAILED',
                        error: error.message,
                        endTime: new Date()
                    }
                }
            );

            // Notify players
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Match Setup Failed')
                .setDescription('An error occurred while setting up the match. Please try again.')
                .addFields(
                    { name: 'Error', value: error.message }
                )
                .setTimestamp();

            await channel.send({ embeds: [errorEmbed] });

            // Notify players via DM
            for (const player of match.players) {
                try {
                    const user = await this.client.users.fetch(player.userId);
                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('Match Setup Failed')
                                .setDescription('The match setup failed due to an error. You have been removed from the queue.')
                                .setTimestamp()
                        ]
                    });
                } catch (dmError) {
                    logger.error(`Error sending error DM to user ${player.userId}:`, dmError);
                }
            }

            // Clean up pre-game state
            this.activeMatches.delete(match._id.toString());
        } catch (cleanupError) {
            logger.error('Error handling pre-game error:', cleanupError);
        }
    }

    /**
     * Start the stage banning phase
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {Object} state - The pre-game state
     */
    async startStageBanning(match, channel, state) {
        try {
            const currentPlayer = match.players[state.currentPlayerIndex];
            const user = await this.client.users.fetch(currentPlayer.user);

            // Create stage selection buttons
            const rows = this.createStageSelectionRows(state.availableStages);

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Stage Banning Phase')
                .setDescription(`${user}, please ban a stage by clicking one of the buttons below.`)
                .addFields(
                    { name: 'Banned Stages', value: state.bannedStages.length > 0 ? state.bannedStages.join(', ') : 'None', inline: false },
                    { name: 'Time Remaining', value: '60 seconds', inline: false }
                );

            // Send or update message
            if (state.message) {
                await state.message.edit({ embeds: [embed], components: rows });
            } else {
                state.message = await channel.send({ embeds: [embed], components: rows });
            }

            // Create button collector
            if (state.collector) state.collector.stop();
            state.collector = state.message.createMessageComponentCollector({
                filter: i => i.user.id === user.id,
                time: TIMEOUTS.STAGE_BAN
            });

            // Handle stage selection
            state.collector.on('collect', async interaction => {
                const stage = interaction.customId.replace('stage_', '');
                await this.handleStageBan(match, channel, state, stage, interaction);
            });

            // Handle timeout
            state.collector.on('end', async collected => {
                if (collected.size === 0) {
                    // Auto-ban random stage on timeout
                    const randomStage = state.availableStages[Math.floor(Math.random() * state.availableStages.length)];
                    await this.handleStageBan(match, channel, state, randomStage);
                }
            });
        } catch (error) {
            logger.error('Error in stage banning:', error);
            throw error;
        }
    }

    /**
     * Handle stage ban selection with improved error handling
     */
    async handleStageBan(match, channel, state, stage, interaction) {
        try {
            // Validate stage
            if (!state.availableStages.includes(stage)) {
                throw new Error('Invalid stage selection');
            }

            // Update state
            state.bannedStages.push(stage);
            state.availableStages = state.availableStages.filter(s => s !== stage);

            // Add to match history
            await match.addHistory('STAGE_BAN', match.players[state.currentPlayerIndex].user, { 
                stage,
                timestamp: new Date(),
                isHypercharged: state.isHypercharged
            });

            // Move to next player or phase
            if (state.availableStages.length > 1) {
                state.currentPlayerIndex = (state.currentPlayerIndex + 1) % match.players.length;
                await this.startStageBanning(match, channel, state);
            } else {
                // Stage banning complete, move to captain selection
                state.phase = PHASE.CAPTAIN_SELECTION;
                state.currentPlayerIndex = 1; // Second player picks first
                await this.startCaptainSelection(match, channel, state);
            }

            // Acknowledge interaction
            if (interaction) {
                await interaction.deferUpdate();
            }
        } catch (error) {
            logger.error('Error handling stage ban:', error);
            await this.handlePreGameError(match, channel, error);
            throw error;
        }
    }

    /**
     * Start the captain selection phase
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {Object} state - The pre-game state
     */
    async startCaptainSelection(match, channel, state) {
        try {
            const currentPlayer = match.players[state.currentPlayerIndex];
            const user = await this.client.users.fetch(currentPlayer.user);

            // Create captain selection buttons
            const rows = this.createCaptainSelectionRows(CAPTAINS.filter(c => !state.selectedCaptains.includes(c)));

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Captain Selection Phase')
                .setDescription(`${user}, please select your captain by clicking one of the buttons below.`)
                .addFields(
                    { name: 'Selected Captains', value: state.selectedCaptains.length > 0 ? state.selectedCaptains.join(', ') : 'None', inline: false },
                    { name: 'Time Remaining', value: '60 seconds', inline: false }
                );

            // Update message
            await state.message.edit({ embeds: [embed], components: rows });

            // Create button collector
            if (state.collector) state.collector.stop();
            state.collector = state.message.createMessageComponentCollector({
                filter: i => i.user.id === user.id,
                time: TIMEOUTS.CAPTAIN_PICK
            });

            // Handle captain selection
            state.collector.on('collect', async interaction => {
                const captain = interaction.customId.replace('captain_', '');
                await this.handleCaptainSelection(match, channel, state, captain, interaction);
            });

            // Handle timeout
            state.collector.on('end', async collected => {
                if (collected.size === 0) {
                    // Auto-select random captain on timeout
                    const availableCaptains = CAPTAINS.filter(c => !state.selectedCaptains.includes(c));
                    const randomCaptain = availableCaptains[Math.floor(Math.random() * availableCaptains.length)];
                    await this.handleCaptainSelection(match, channel, state, randomCaptain);
                }
            });
        } catch (error) {
            logger.error('Error in captain selection:', error);
            throw error;
        }
    }

    /**
     * Handle captain selection with improved error handling
     */
    async handleCaptainSelection(match, channel, state, captain, interaction) {
        try {
            // Validate captain
            if (!CAPTAINS.includes(captain) || state.selectedCaptains.includes(captain)) {
                throw new Error('Invalid captain selection');
            }

            // Update state
            state.selectedCaptains.push(captain);
            match.players[state.currentPlayerIndex].captain = captain;

            // Add to match history
            await match.addHistory('CAPTAIN_PICK', match.players[state.currentPlayerIndex].user, { 
                captain,
                timestamp: new Date(),
                isHypercharged: state.isHypercharged
            });

            // Move to next player or phase
            if (state.selectedCaptains.length < match.players.length) {
                state.currentPlayerIndex = (state.currentPlayerIndex + 1) % match.players.length;
                await this.startCaptainSelection(match, channel, state);
            } else {
                // Captain selection complete, move to host selection
                state.phase = PHASE.HOST_SELECTION;
                await this.startHostSelection(match, channel, state);
            }

            // Acknowledge interaction
            if (interaction) {
                await interaction.deferUpdate();
            }
        } catch (error) {
            logger.error('Error handling captain selection:', error);
            await this.handlePreGameError(match, channel, error);
            throw error;
        }
    }

    /**
     * Start the host selection phase
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {Object} state - The pre-game state
     */
    async startHostSelection(match, channel, state) {
        try {
            // Fetch player ranks for display
            const playerRanks = await Promise.all(
                match.players.map(async p => ({
                    userId: p.userId,
                    ...(await this.getPlayerRank(p.userId))
                }))
            );

            const embed = new EmbedBuilder()
                .setTitle('Host Selection')
                .setDescription('Please select who will host the match.')
                .addFields(
                    playerRanks.map(p => ({
                        name: `Player ${match.players.findIndex(pl => pl.userId === p.userId) + 1}`,
                        value: `${p.rank} ${p.tier} (${p.rep} rep)`,
                        inline: true
                    }))
                )
                .setColor('#00FF00');

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`host_self_${match._id}`)
                        .setLabel('I Will Host')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`host_opponent_${match._id}`)
                        .setLabel('Opponent Should Host')
                        .setStyle(ButtonStyle.Secondary)
                );

            const message = await channel.send({
                content: match.players.map(p => `<@${p.userId}>`).join(' '),
                embeds: [embed],
                components: [row]
            });

            // Set timeout for host selection
            const timeout = setTimeout(async () => {
                if (this.activeMatches.has(match._id)) {
                    await this.handleHostTimeout(match, channel, message);
                }
            }, 30000); // 30 seconds

            this.activeMatches.set(match._id, {
                phase: 'HOST_SELECTION',
                message,
                timeout,
                hostVotes: new Map() // Map of userId -> vote (true for self, false for opponent)
            });
        } catch (error) {
            logger.error('Error in host selection:', error);
            throw error;
        }
    }

    /**
     * Handle host selection
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {Object} state - The pre-game state
     * @param {Object} interaction - The button interaction
     */
    async handleHostSelection(match, channel, state, interaction) {
        try {
            const playerIndex = match.players.findIndex(p => p.user.toString() === interaction.user.id);
            if (playerIndex === -1) {
                await interaction.reply({ content: 'You are not a player in this match.', ephemeral: true });
                return;
            }

            if (interaction.customId === 'host_self') {
                await this.finalizeHostSelection(match, channel, state, playerIndex, interaction);
            } else {
                // If both players select "Opponent Should Host", higher ranked player hosts
                const otherPlayerIndex = (playerIndex + 1) % match.players.length;
                const otherPlayer = match.players[otherPlayerIndex];
                
                if (otherPlayer.isHost === false) { // Other player also selected "Opponent Should Host"
                    const higherRankedPlayer = await this.determineHostByRank(match);
                    await this.finalizeHostSelection(match, channel, state, higherRankedPlayer, interaction);
                }
            }

            await interaction.deferUpdate();
        } catch (error) {
            logger.error('Error handling host selection:', error);
            throw error;
        }
    }

    /**
     * Finalize host selection and move to room code phase
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {Object} state - The pre-game state
     * @param {number} hostIndex - The index of the host player
     * @param {Object} interaction - The button interaction
     */
    async finalizeHostSelection(match, channel, state, hostIndex, interaction) {
        try {
            // Update match
            match.players[hostIndex].isHost = true;
            await match.addHistory('HOST_SELECTION', match.players[hostIndex].user);

            // Move to room code phase
            state.phase = PHASE.ROOM_CODE;
            await this.startRoomCodePhase(match, channel, state);
        } catch (error) {
            logger.error('Error finalizing host selection:', error);
            throw error;
        }
    }

    /**
     * Start the room code phase
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {Object} state - The pre-game state
     */
    async startRoomCodePhase(match, channel, state) {
        try {
            const host = match.players.find(p => p.isHost);
            const hostUser = await this.client.users.fetch(host.user);

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Room Code Phase')
                .setDescription(`${hostUser}, please enter the room code for your match.`)
                .addFields(
                    { name: 'Stage', value: state.availableStages[0], inline: true },
                    { name: 'Captains', value: `${match.players[0].captain} vs ${match.players[1].captain}`, inline: true },
                    { name: 'Time Remaining', value: '2 minutes', inline: false }
                );

            // Update message
            await state.message.edit({ embeds: [embed], components: [] });

            // Create modal for room code
            const modal = new ModalBuilder()
                .setCustomId('room_code_modal')
                .setTitle('Enter Room Code');

            const roomCodeInput = new TextInputBuilder()
                .setCustomId('room_code')
                .setLabel('Room Code')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter the room code')
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(8);

            const firstActionRow = new ActionRowBuilder().addComponents(roomCodeInput);
            modal.addComponents(firstActionRow);

            // Show modal to host
            await hostUser.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('enter_room_code')
                    .setLabel('Enter Room Code')
                    .setStyle(ButtonStyle.Primary)
            )] });

            // Create button collector for modal trigger
            const collector = channel.createMessageComponentCollector({
                filter: i => i.user.id === host.user.toString(),
                time: TIMEOUTS.ROOM_CODE
            });

            collector.on('collect', async interaction => {
                if (interaction.customId === 'enter_room_code') {
                    await interaction.showModal(modal);
                }
            });

            // Handle modal submit
            this.client.once('interactionCreate', async interaction => {
                if (!interaction.isModalSubmit()) return;
                if (interaction.customId !== 'room_code_modal') return;
                if (interaction.user.id !== host.user.toString()) return;

                const roomCode = interaction.fields.getTextInputValue('room_code');
                await this.handleRoomCode(match, channel, state, roomCode, interaction);
            });

            // Handle timeout
            collector.on('end', async collected => {
                if (collected.size === 0) {
                    // Cancel match on timeout
                    await this.cancelMatch(match, channel, 'No room code provided');
                }
            });
        } catch (error) {
            logger.error('Error in room code phase:', error);
            throw error;
        }
    }

    /**
     * Handle room code submission
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {Object} state - The pre-game state
     * @param {string} roomCode - The submitted room code
     * @param {Object} interaction - The modal interaction
     */
    async handleRoomCode(match, channel, state, roomCode, interaction) {
        try {
            // Update match
            match.roomCode = roomCode;
            match.status = 'IN_PROGRESS';
            match.startTime = new Date();
            await match.addHistory('ROOM_CODE', match.players.find(p => p.isHost).user, { roomCode });

            // Create match start embed
            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Match Started!')
                .setDescription(`${match.players[0].captain} vs ${match.players[1].captain} at ${state.availableStages[0]}`)
                .addFields(
                    { name: 'Room Code', value: roomCode, inline: true },
                    { name: 'Host', value: `<@${match.players.find(p => p.isHost).user}>`, inline: true }
                )
                .setTimestamp();

            // Update message and send new one
            await state.message.edit({ embeds: [embed], components: [] });
            await channel.send({ embeds: [embed] });

            // Clean up
            this.activeMatches.delete(match._id.toString());
            await interaction.deferUpdate();
        } catch (error) {
            logger.error('Error handling room code:', error);
            throw error;
        }
    }

    /**
     * Cancel a match
     * @param {Object} match - The match document
     * @param {Object} channel - The Discord channel
     * @param {string} reason - The reason for cancellation
     */
    async cancelMatch(match, channel, reason) {
        try {
            match.status = 'CANCELLED';
            await match.save();

            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('Match Cancelled')
                .setDescription(reason)
                .setTimestamp();

            await channel.send({ embeds: [embed] });

            // Clean up
            this.activeMatches.delete(match._id.toString());
        } catch (error) {
            logger.error('Error cancelling match:', error);
            throw error;
        }
    }

    /**
     * Create stage selection button rows
     * @param {string[]} stages - Available stages
     * @returns {ActionRowBuilder[]} Button rows
     */
    createStageSelectionRows(stages) {
        const rows = [];
        for (let i = 0; i < stages.length; i += 5) {
            const row = new ActionRowBuilder();
            const stageChunk = stages.slice(i, i + 5);
            stageChunk.forEach(stage => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`stage_${stage}`)
                        .setLabel(stage)
                        .setStyle(ButtonStyle.Secondary)
                );
            });
            rows.push(row);
        }
        return rows;
    }

    /**
     * Create captain selection button rows
     * @param {string[]} captains - Available captains
     * @returns {ActionRowBuilder[]} Button rows
     */
    createCaptainSelectionRows(captains) {
        const rows = [];
        for (let i = 0; i < captains.length; i += 5) {
            const row = new ActionRowBuilder();
            const captainChunk = captains.slice(i, i + 5);
            captainChunk.forEach(captain => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`captain_${captain}`)
                        .setLabel(captain)
                        .setStyle(ButtonStyle.Secondary)
                );
            });
            rows.push(row);
        }
        return rows;
    }

    async getPlayerRank(userId) {
        const user = await User.findOne({ discordId: userId });
        if (!user) return { rank: 'BRONZE', tier: 'I', rep: 0 };

        return {
            rank: user.rank,
            tier: user.tier,
            rep: user.rep
        };
    }

    async determineHostByRank(match) {
        const playerRanks = await Promise.all(
            match.players.map(async p => ({
                userId: p.userId,
                ...(await this.getPlayerRank(p.userId))
            }))
        );

        // Sort players by rank (higher rank first)
        playerRanks.sort((a, b) => {
            // First compare by rank
            const rankDiff = this.rankOrder[b.rank] - this.rankOrder[a.rank];
            if (rankDiff !== 0) return rankDiff;

            // If same rank, compare by tier
            const tierDiff = this.tierOrder[b.tier] - this.tierOrder[a.tier];
            if (tierDiff !== 0) return tierDiff;

            // If same rank and tier, compare by rep
            return b.rep - a.rep;
        });

        return playerRanks[0].userId;
    }

    async handleHostTimeout(match, channel, message) {
        const matchData = this.activeMatches.get(match._id);
        if (!matchData) return;

        clearTimeout(matchData.timeout);
        this.activeMatches.delete(match._id);

        // Determine host based on votes or rank
        let hostId;
        if (matchData.hostVotes.size === 2) {
            // If both voted, use the higher ranked player
            hostId = await this.determineHostByRank(match);
        } else if (matchData.hostVotes.size === 1) {
            // If only one voted, use their vote
            const [userId, vote] = matchData.hostVotes.entries().next().value;
            hostId = vote ? userId : match.players.find(p => p.userId !== userId).userId;
        } else {
            // If no votes, use higher ranked player
            hostId = await this.determineHostByRank(match);
        }

        // Update match with host
        match.players = match.players.map(p => ({
            ...p,
            isHost: p.userId === hostId
        }));
        await match.save();

        // Notify players
        const host = match.players.find(p => p.isHost);
        const embed = new EmbedBuilder()
            .setTitle('Host Selected')
            .setDescription(`${host ? `<@${host.userId}>` : 'A player'} has been selected as the host.`)
            .setColor('#00FF00');

        await message.edit({ embeds: [embed], components: [] });
        await channel.send({ embeds: [embed] });

        // Start room code phase
        await this.roomCodeManager.requestRoomCode(match, channel);
    }

    async resolveHostSelection(matchId) {
        const match = await Match.findById(matchId);
        const matchData = this.activeMatches.get(matchId);
        if (!match || !matchData) return;

        const votes = Array.from(matchData.hostVotes.entries());
        let hostId;

        if (votes[0][1] === votes[1][1]) {
            // If both voted the same, use higher ranked player
            hostId = await this.determineHostByRank(match);
        } else {
            // If votes differ, use the player who voted to host
            hostId = votes.find(([_, vote]) => vote)[0];
        }

        // Update match with host
        match.players = match.players.map(p => ({
            ...p,
            isHost: p.userId === hostId
        }));
        await match.save();

        // Notify players
        const host = match.players.find(p => p.isHost);
        const embed = new EmbedBuilder()
            .setTitle('Host Selected')
            .setDescription(`${host ? `<@${host.userId}>` : 'A player'} has been selected as the host.`)
            .setColor('#00FF00');

        await matchData.message.edit({ embeds: [embed], components: [] });
        await matchData.message.channel.send({ embeds: [embed] });

        // Start room code phase
        await this.roomCodeManager.requestRoomCode(match, matchData.message.channel);

        this.activeMatches.delete(matchId);
    }

    async handlePlayerDisconnect(matchId, userId) {
        const matchData = this.activeMatches.get(matchId);
        if (!matchData) return;

        const match = await Match.findById(matchId);
        if (!match) return;

        // Find the disconnected player
        const disconnectedPlayer = match.players.find(p => p.userId === userId);
        const otherPlayer = match.players.find(p => p.userId !== userId);

        if (disconnectedPlayer && otherPlayer) {
            // Update match status
            match.status = 'COMPLETED';
            match.endTime = new Date();
            match.history.push({
                action: 'COMPLETED',
                reason: 'Player disconnected during pre-game',
                timestamp: new Date()
            });

            // Set winner and loser
            disconnectedPlayer.repChange = -75; // Standard loss
            otherPlayer.repChange = 75; // Standard win

            // Update player stats
            await Promise.all([
                User.findByIdAndUpdate(otherPlayer.user, {
                    $inc: {
                        'stats.matchesPlayed': 1,
                        'stats.matchesWon': 1
                    }
                }),
                User.findByIdAndUpdate(disconnectedPlayer.user, {
                    $inc: {
                        'stats.matchesPlayed': 1,
                        'stats.matchesLost': 1
                    }
                })
            ]);

            await match.save();

            // Notify players
            const embed = new EmbedBuilder()
                .setTitle('Match Ended')
                .setDescription(`<@${disconnectedPlayer.userId}> disconnected during pre-game. <@${otherPlayer.userId}> wins by default.`)
                .setColor('#FF0000')
                .addFields([
                    {
                        name: 'Winner',
                        value: `<@${otherPlayer.userId}> (+${otherPlayer.repChange} rep)`,
                        inline: true
                    },
                    {
                        name: 'Loser',
                        value: `<@${disconnectedPlayer.userId}> (${disconnectedPlayer.repChange} rep)`,
                        inline: true
                    }
                ]);

            if (matchData.channel) {
                await matchData.channel.send({
                    content: match.players.map(p => `<@${p.userId}>`).join(' '),
                    embeds: [embed]
                });
            }

            // Clean up
            this.cancelPreGame(matchId);
        }
    }
}

module.exports = PreGameManager; 