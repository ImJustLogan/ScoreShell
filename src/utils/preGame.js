const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const logger = require('./logger');
const config = require('../config/config');

// Available stages
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

// Available captains
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

// Timeouts
const STAGE_BAN_TIMEOUT = 60000; // 60 seconds
const CAPTAIN_PICK_TIMEOUT = 30000; // 30 seconds
const HOST_SELECTION_TIMEOUT = 30000; // 30 seconds
const ROOM_CODE_TIMEOUT = 120000; // 2 minutes

/**
 * Start the pre-game phase for a match
 */
async function startPreGamePhase(client, matchId) {
    try {
        const match = await client.db.collection('matches').findOne({ _id: matchId });
        if (!match) {
            logger.error(`Match ${matchId} not found for pre-game phase`);
            return;
        }

        // Get player users
        const [player1User, player2User] = await Promise.all([
            client.users.fetch(match.players[0].userId),
            client.users.fetch(match.players[1].userId)
        ]);

        // Randomly select first player to ban
        const firstPlayerIndex = Math.floor(Math.random() * 2);
        const firstPlayer = match.players[firstPlayerIndex];
        const secondPlayer = match.players[1 - firstPlayerIndex];

        // Start stage banning
        const bannedStages = [];
        const stageEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Stage Banning')
            .setDescription(`${firstPlayerIndex === 0 ? player1User : player2User} bans first!`)
            .addFields(
                { name: 'Available Stages', value: STAGES.join('\n') }
            )
            .setTimestamp();

        const stageButtons = STAGES.map(stage =>
            new ButtonBuilder()
                .setCustomId(`stage_${stage}`)
                .setLabel(stage)
                .setStyle(ButtonStyle.Secondary)
        );

        // Split buttons into rows of 5
        const stageRows = [];
        for (let i = 0; i < stageButtons.length; i += 5) {
            stageRows.push(
                new ActionRowBuilder().addComponents(stageButtons.slice(i, i + 5))
            );
        }

        // Send stage banning message to both players
        const stageMessages = await Promise.all([
            player1User.send({ embeds: [stageEmbed], components: stageRows }),
            player2User.send({ embeds: [stageEmbed], components: stageRows })
        ]);

        // Stage banning phase
        let currentPlayer = firstPlayer;
        let currentPlayerUser = firstPlayerIndex === 0 ? player1User : player2User;
        let nextPlayer = secondPlayer;
        let nextPlayerUser = firstPlayerIndex === 0 ? player2User : player1User;

        for (let i = 0; i < STAGES.length - 1; i++) {
            const stageCollector = stageMessages[0].createMessageComponentCollector({
                filter: i => i.user.id === currentPlayer.userId,
                time: 60000, // 60 seconds
                componentType: ComponentType.Button
            });

            const stageResult = await new Promise((resolve) => {
                stageCollector.on('collect', async (interaction) => {
                    const stage = interaction.customId.replace('stage_', '');
                    bannedStages.push(stage);

                    // Update both messages
                    const updatedEmbed = EmbedBuilder.from(stageEmbed)
                        .setDescription(`${nextPlayerUser} bans next!`)
                        .addFields(
                            { name: 'Available Stages', value: STAGES.filter(s => !bannedStages.includes(s)).join('\n') }
                        );

                    // Disable banned stage button
                    const updatedRows = stageRows.map(row => {
                        const newRow = ActionRowBuilder.from(row);
                        newRow.components.forEach(button => {
                            if (button.data.custom_id === `stage_${stage}`) {
                                button.setDisabled(true);
                            }
                        });
                        return newRow;
                    });

                    await Promise.all([
                        interaction.update({ embeds: [updatedEmbed], components: updatedRows }),
                        stageMessages[1].edit({ embeds: [updatedEmbed], components: updatedRows })
                    ]);

                    resolve(stage);
                });

                stageCollector.on('end', (collected) => {
                    if (collected.size === 0) {
                        // Auto-ban random stage if player didn't ban
                        const availableStages = STAGES.filter(s => !bannedStages.includes(s));
                        const randomStage = availableStages[Math.floor(Math.random() * availableStages.length)];
                        bannedStages.push(randomStage);
                        resolve(randomStage);
                    }
                });
            });

            // Switch players
            [currentPlayer, nextPlayer] = [nextPlayer, currentPlayer];
            [currentPlayerUser, nextPlayerUser] = [nextPlayerUser, currentPlayerUser];
        }

        // Get final stage
        const selectedStage = STAGES.find(s => !bannedStages.includes(s));

        // Update match with selected stage
        await client.db.collection('matches').updateOne(
            { _id: matchId },
            { $set: { stage: selectedStage } }
        );

        // Start captain selection
        const captainEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Captain Selection')
            .setDescription(`${nextPlayerUser} picks first! Please select your captain.`)
            .addFields(
                { name: 'Selected Stage', value: selectedStage }
            )
            .setTimestamp();

        const captainButtons = CAPTAINS.map(captain =>
            new ButtonBuilder()
                .setCustomId(`captain_${captain}`)
                .setLabel(captain)
                .setStyle(ButtonStyle.Secondary)
        );

        // Split captain buttons into rows of 4
        const captainRows = [];
        for (let i = 0; i < captainButtons.length; i += 4) {
            captainRows.push(
                new ActionRowBuilder().addComponents(captainButtons.slice(i, i + 4))
            );
        }

        // Send captain selection message to both players
        const captainMessages = await Promise.all([
            player1User.send({ embeds: [captainEmbed], components: captainRows }),
            player2User.send({ embeds: [captainEmbed], components: captainRows })
        ]);

        // Captain selection phase
        const selectedCaptains = [];
        currentPlayer = nextPlayer;
        currentPlayerUser = nextPlayerUser;
        nextPlayer = firstPlayer;
        nextPlayerUser = firstPlayerUser;

        for (let i = 0; i < 2; i++) {
            const captainCollector = captainMessages[0].createMessageComponentCollector({
                filter: i => i.user.id === currentPlayer.userId,
                time: 60000, // 60 seconds
                componentType: ComponentType.Button
            });

            const captainResult = await new Promise((resolve) => {
                captainCollector.on('collect', async (interaction) => {
                    const captain = interaction.customId.replace('captain_', '');
                    selectedCaptains.push({
                        userId: currentPlayer.userId,
                        captain
                    });

                    // Update both messages
                    const updatedEmbed = EmbedBuilder.from(captainEmbed)
                        .setDescription(i === 0 ? `${nextPlayerUser} picks next!` : 'Captains selected!')
                        .addFields(
                            { name: 'Selected Stage', value: selectedStage },
                            { name: 'Selected Captains', value: selectedCaptains.map(sc => 
                                `<@${sc.userId}>: ${sc.captain}`
                            ).join('\n') }
                        );

                    // Disable selected captain button
                    const updatedRows = captainRows.map(row => {
                        const newRow = ActionRowBuilder.from(row);
                        newRow.components.forEach(button => {
                            if (button.data.custom_id === `captain_${captain}`) {
                                button.setDisabled(true);
                            }
                        });
                        return newRow;
                    });

                    await Promise.all([
                        interaction.update({ embeds: [updatedEmbed], components: updatedRows }),
                        captainMessages[1].edit({ embeds: [updatedEmbed], components: updatedRows })
                    ]);

                    resolve(captain);
                });

                captainCollector.on('end', (collected) => {
                    if (collected.size === 0) {
                        // Auto-select random captain if player didn't pick
                        const availableCaptains = CAPTAINS.filter(c => 
                            !selectedCaptains.some(sc => sc.captain === c)
                        );
                        const randomCaptain = availableCaptains[Math.floor(Math.random() * availableCaptains.length)];
                        selectedCaptains.push({
                            userId: currentPlayer.userId,
                            captain: randomCaptain
                        });
                        resolve(randomCaptain);
                    }
                });
            });

            // Switch players
            [currentPlayer, nextPlayer] = [nextPlayer, currentPlayer];
            [currentPlayerUser, nextPlayerUser] = [nextPlayerUser, currentPlayerUser];
        }

        // Update match with selected captains
        await client.db.collection('matches').updateOne(
            { _id: matchId },
            { 
                $set: { 
                    'players.$[p1].captain': selectedCaptains[0].captain,
                    'players.$[p2].captain': selectedCaptains[1].captain
                }
            },
            {
                arrayFilters: [
                    { 'p1.userId': selectedCaptains[0].userId },
                    { 'p2.userId': selectedCaptains[1].userId }
                ]
            }
        );

        // Start host selection
        const hostEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Host Selection')
            .setDescription('Who will host the match?')
            .addFields(
                { name: 'Stage', value: selectedStage },
                { name: 'Captains', value: `${selectedCaptains[0].captain} vs ${selectedCaptains[1].captain}` }
            )
            .setTimestamp();

        const hostButtons = [
            new ButtonBuilder()
                .setCustomId('host_self')
                .setLabel('I Will Host')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('host_opponent')
                .setLabel('Opponent Should Host')
                .setStyle(ButtonStyle.Secondary)
        ];

        const hostRow = new ActionRowBuilder().addComponents(hostButtons);

        // Send host selection message to both players
        const hostMessages = await Promise.all([
            player1User.send({ embeds: [hostEmbed], components: [hostRow] }),
            player2User.send({ embeds: [hostEmbed], components: [hostRow] })
        ]);

        // Host selection phase
        const hostSelections = [];
        const hostCollector = hostMessages[0].createMessageComponentCollector({
            filter: i => [player1User.id, player2User.id].includes(i.user.id),
            time: 30000, // 30 seconds
            componentType: ComponentType.Button
        });

        await new Promise((resolve) => {
            hostCollector.on('collect', async (interaction) => {
                const selection = interaction.customId === 'host_self' ? 'self' : 'opponent';
                hostSelections.push({
                    userId: interaction.user.id,
                    selection
                });

                // Update both messages
                const updatedEmbed = EmbedBuilder.from(hostEmbed)
                    .setDescription('Host selection in progress...')
                    .addFields(
                        { name: 'Stage', value: selectedStage },
                        { name: 'Captains', value: `${selectedCaptains[0].captain} vs ${selectedCaptains[1].captain}` },
                        { name: 'Host Selections', value: hostSelections.map(hs => 
                            `<@${hs.userId}>: ${hs.selection === 'self' ? 'Will host' : 'Wants opponent to host'}`
                        ).join('\n') }
                    );

                await Promise.all([
                    interaction.update({ embeds: [updatedEmbed], components: [] }),
                    hostMessages[1].edit({ embeds: [updatedEmbed], components: [] })
                ]);

                if (hostSelections.length === 2) {
                    resolve();
                }
            });

            hostCollector.on('end', (collected) => {
                if (collected.size === 0) {
                    // Auto-select higher ranked player as host
                    const player1Rank = getRepFromRank(match.players[0].rank);
                    const player2Rank = getRepFromRank(match.players[1].rank);
                    const hostId = player1Rank >= player2Rank ? player1User.id : player2User.id;
                    hostSelections.push({
                        userId: hostId,
                        selection: 'self'
                    });
                }
                resolve();
            });
        });

        // Determine host
        let hostId;
        if (hostSelections.length === 2) {
            if (hostSelections[0].selection === 'self' && hostSelections[1].selection === 'self') {
                // Both want to host, higher rank gets priority
                const player1Rank = getRepFromRank(match.players[0].rank);
                const player2Rank = getRepFromRank(match.players[1].rank);
                hostId = player1Rank >= player2Rank ? player1User.id : player2User.id;
            } else if (hostSelections[0].selection === 'self') {
                hostId = hostSelections[0].userId;
            } else if (hostSelections[1].selection === 'self') {
                hostId = hostSelections[1].userId;
            } else {
                // Neither wants to host, higher rank gets priority
                const player1Rank = getRepFromRank(match.players[0].rank);
                const player2Rank = getRepFromRank(match.players[1].rank);
                hostId = player1Rank >= player2Rank ? player1User.id : player2User.id;
            }
        } else {
            hostId = hostSelections[0].userId;
        }

        // Update match with host
        await client.db.collection('matches').updateOne(
            { _id: matchId },
            { 
                $set: { 
                    'players.$[p].isHost': true
                }
            },
            {
                arrayFilters: [{ 'p.userId': hostId }]
            }
        );

        // Send final match start message
        const startEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Match Starting!')
            .setDescription(`<@${player1User.id}> and <@${player2User.id}> have started a match!`)
            .addFields(
                { name: 'Stage', value: selectedStage },
                { name: 'Captains', value: `${selectedCaptains[0].captain} vs ${selectedCaptains[1].captain}` },
                { name: 'Host', value: `<@${hostId}>` }
            )
            .setTimestamp();

        // Send room code request to host
        const hostUser = await client.users.fetch(hostId);
        const roomCodeEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Enter Room Code')
            .setDescription(`Please enter the room code for your match against ${hostId === player1User.id ? player2User : player1User} within 2 minutes.`)
            .setTimestamp();

        const roomCodeButton = new ButtonBuilder()
            .setCustomId('enter_room_code')
            .setLabel('Enter Room Code')
            .setStyle(ButtonStyle.Primary);

        const roomCodeRow = new ActionRowBuilder().addComponents(roomCodeButton);

        // Send messages
        const [rankedChannel] = await Promise.all([
            // Find a ranked channel to post the match start message
            client.db.collection('servers').findOne({ 'channels.ranked': { $exists: true } })
                .then(server => server ? client.channels.fetch(server.channels.ranked) : null),
            // Send room code request to host
            hostUser.send({ embeds: [roomCodeEmbed], components: [roomCodeRow] })
        ]);

        if (rankedChannel) {
            await rankedChannel.send({ embeds: [startEmbed] });
        }

        // Set up room code collector
        const roomCodeCollector = hostUser.dmChannel.createMessageComponentCollector({
            filter: i => i.user.id === hostId && i.customId === 'enter_room_code',
            time: 120000, // 2 minutes
            componentType: ComponentType.Button
        });

        roomCodeCollector.on('collect', async (interaction) => {
            // Show modal for room code input
            const modal = {
                title: 'Enter Room Code',
                custom_id: 'room_code_modal',
                components: [{
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: 'room_code',
                        label: 'Room Code',
                        style: 1,
                        min_length: 1,
                        max_length: 10,
                        placeholder: 'Enter the room code',
                        required: true
                    }]
                }]
            };

            await interaction.showModal(modal);
        });

        // Handle modal submit
        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isModalSubmit() || interaction.customId !== 'room_code_modal') return;
            if (interaction.user.id !== hostId) return;

            const roomCode = interaction.fields.getTextInputValue('room_code');

            // Update match with room code
            await client.db.collection('matches').updateOne(
                { _id: matchId },
                { 
                    $set: { 
                        roomCode,
                        status: 'IN_PROGRESS',
                        startTime: new Date()
                    }
                }
            );

            // Send room code to both players
            const roomCodeMessage = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Room Code')
                .setDescription(`Room code for your match: ${roomCode}`)
                .setTimestamp();

            await Promise.all([
                player1User.send({ embeds: [roomCodeMessage] }),
                player2User.send({ embeds: [roomCodeMessage] })
            ]);

            if (rankedChannel) {
                await rankedChannel.send({
                    content: `<@${player1User.id}> and <@${player2User.id}> have started a match at ${selectedStage}. Room Code: ${roomCode}`
                });
            }

            await interaction.reply({ content: 'Room code submitted!', ephemeral: true });
        });

        // Handle timeout
        roomCodeCollector.on('end', async (collected) => {
            if (collected.size === 0) {
                // Cancel match if no room code provided
                await client.db.collection('matches').updateOne(
                    { _id: matchId },
                    { 
                        $set: { 
                            status: 'CANCELLED',
                            endTime: new Date()
                        }
                    }
                );

                // Return players to queue
                await client.db.collection('queue').updateOne(
                    { mode: 'standard' },
                    {
                        $push: {
                            players: {
                                $each: match.players.map(p => ({
                                    userId: p.userId,
                                    rank: p.rank,
                                    region: p.region,
                                    joinedAt: new Date()
                                }))
                            }
                        }
                    }
                );

                // Notify players
                const cancelEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Match Cancelled')
                    .setDescription('Match cancelled: No room code provided')
                    .setTimestamp();

                await Promise.all([
                    player1User.send({ embeds: [cancelEmbed] }),
                    player2User.send({ embeds: [cancelEmbed] })
                ]);

                if (rankedChannel) {
                    await rankedChannel.send({
                        content: `Match between <@${player1User.id}> and <@${player2User.id}> cancelled: No room code provided`
                    });
                }

                // Update queue display
                await updateQueueDisplay(client, 'standard', false);
            }
        });

    } catch (error) {
        logger.error('Error in pre-game phase:', error);
        // Cancel match on error
        await client.db.collection('matches').updateOne(
            { _id: matchId },
            { 
                $set: { 
                    status: 'CANCELLED',
                    endTime: new Date()
                }
            }
        );
    }
}

/**
 * Handle pre-game errors
 */
async function handlePreGameError(client, matchId, reason) {
    try {
        const match = await client.db.collection('matches').findOne({ _id: matchId });
        if (!match) return;

        // Cancel match
        await client.db.collection('matches').updateOne(
            { _id: matchId },
            {
                $set: {
                    status: 'CANCELLED',
                    endTime: new Date(),
                    cancelReason: reason
                }
            }
        );

        // Notify players
        const [player1, player2] = match.players;
        const [player1User, player2User] = await Promise.all([
            client.users.fetch(player1.userId),
            client.users.fetch(player2.userId)
        ]);

        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Match Cancelled')
            .setDescription(`Match cancelled: ${reason}`)
            .setTimestamp();

        // Send cancellation notification to both players
        await Promise.all([
            player1User.send({ embeds: [embed] }).catch(() => {}),
            player2User.send({ embeds: [embed] }).catch(() => {})
        ]);

        // Send cancellation notification to ranked channel
        const server = await client.db.collection('servers').findOne({
            'channels.ranked': { $exists: true }
        });

        if (server) {
            const channel = await client.channels.fetch(server.channels.ranked);
            if (channel) {
                await channel.send({ embeds: [embed] });
            }
        }

        // Return players to queue if they were in queue
        if (match.type === 'RANKED') {
            const queue = await client.db.collection('queue').findOne({ mode: match.mode });
            if (queue) {
                await client.db.collection('queue').updateOne(
                    { mode: match.mode },
                    {
                        $push: {
                            players: {
                                $each: match.players.map(p => ({
                                    userId: p.userId,
                                    rank: p.rank,
                                    region: p.region,
                                    joinedAt: new Date()
                                }))
                            }
                        }
                    }
                );
            }
        }

    } catch (error) {
        logger.error('Error in handlePreGameError:', error);
    }
}

module.exports = {
    startPreGamePhase,
    getRepFromRank
}; 