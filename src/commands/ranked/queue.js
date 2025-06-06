const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    PermissionFlagsBits
} = require('discord.js');
const logger = require('../../utils/logger');
const { getRankEmoji } = require('../../utils/helpers');
const QueueManager = require('../../utils/queueManager');

module.exports = {
    category: 'user',
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Refresh the ranked queue display')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),

    async execute(interaction) {
        // Check if command is used in a ranked channel
        const channel = interaction.channel;
        if (!channel.name.includes('1v1-ranked')) {
            return interaction.reply({
                content: 'This command only works in a ranked queue channel.',
                ephemeral: true
            });
        }

        // Get queue manager instance
        const queueManager = interaction.client.queueManager;
        if (!queueManager) {
            return interaction.reply({
                content: 'Error: Queue system is not initialized. Please contact an administrator.',
                ephemeral: true
            });
        }

        try {
            // Initialize or refresh queue
            const message = await queueManager.initializeQueue(interaction.guildId, channel);
            
            // Acknowledge command
            await interaction.reply({
                content: 'Queue display refreshed.',
                ephemeral: true
            });

            // Set up button collector for join/leave
            const collector = message.createMessageComponentCollector({
                filter: i => i.customId === 'queue_join' || i.customId === 'queue_leave',
                time: 0 // No timeout
            });

            collector.on('collect', async (i) => {
                const userId = i.user.id;
                const isInQueue = queueManager.getQueueStatus(userId);

                if (i.customId === 'queue_join') {
                    if (isInQueue) {
                        await i.reply({
                            content: 'You are already in queue.',
                            ephemeral: true
                        });
                        return;
                    }

                    const result = await queueManager.joinQueue(userId, interaction.guildId);
                    if (!result.success) {
                        await i.reply({
                            content: result.error,
                            ephemeral: true
                        });
                        return;
                    }

                    // Update button to "Leave Queue"
                    const row = i.message.components[0];
                    row.components[0].setLabel('Leave Queue')
                        .setStyle('Danger')
                        .setCustomId('queue_leave');

                    await i.message.edit({
                        components: [row]
                    });

                    await i.reply({
                        content: 'You have joined the queue!',
                        ephemeral: true
                    });
                } else if (i.customId === 'queue_leave') {
                    if (!isInQueue) {
                        await i.reply({
                            content: 'You are not in queue.',
                            ephemeral: true
                        });
                        return;
                    }

                    const result = await queueManager.leaveQueue(userId);
                    if (!result.success) {
                        await i.reply({
                            content: result.error,
                            ephemeral: true
                        });
                        return;
                    }

                    // Update button to "Join Standard"
                    const row = i.message.components[0];
                    row.components[0].setLabel('Join Standard')
                        .setStyle('Primary')
                        .setCustomId('queue_join');

                    await i.message.edit({
                        components: [row]
                    });

                    await i.reply({
                        content: 'You have left the queue.',
                        ephemeral: true
                    });
                }
            });

            collector.on('end', () => {
                // Remove buttons when collector ends
                message.edit({
                    components: []
                }).catch(console.error);
            });

        } catch (error) {
            console.error('Error in queue command:', error);
            await interaction.reply({
                content: 'Error: Unable to fetch queue. Please try again later.',
                ephemeral: true
            });
        }
    }
};

async function updateQueueDisplay(client, mode, matchmaking = false) {
    try {
        // Only update standard queue display
        if (mode !== 'standard') return;

        const queue = await client.db.collection('queue').findOne({ mode: 'standard' });
        if (!queue) return;

        // Get all servers with ranked channels
        const servers = await client.db.collection('servers').find({
            'channels.ranked': { $exists: true }
        }).toArray();

        for (const server of servers) {
            try {
                const channel = await client.channels.fetch(server.channels.ranked);
                if (!channel) continue;

                // Get the queue message or create a new one
                let queueMessage = await channel.messages.fetch(server.queueMessageId).catch(() => null);
                
                const embed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('Standard Queue')
                    .setTimestamp();

                // Group players into rows of 2
                const playerRows = [];
                for (let i = 0; i < queue.players.length; i += 2) {
                    const row = queue.players.slice(i, i + 2);
                    playerRows.push(row);
                }

                // Add player slots
                if (playerRows.length > 0) {
                    embed.addFields(
                        playerRows.map((row, index) => ({
                            name: `Slot ${index * 2 + 1}-${index * 2 + row.length}`,
                            value: row.map(p => {
                                const rankEmoji = getRankEmoji(p.rank);
                                return `${rankEmoji} <@${p.userId}>`;
                            }).join('\n'),
                            inline: true
                        }))
                    );
                } else {
                    embed.addFields({
                        name: 'Empty Queue',
                        value: 'No players in queue',
                        inline: false
                    });
                }

                const joinButton = new ButtonBuilder()
                    .setCustomId('queue_join_standard')
                    .setLabel('Join Standard')
                    .setStyle(ButtonStyle.Primary);

                const leaveButton = new ButtonBuilder()
                    .setCustomId('queue_leave_standard')
                    .setLabel('Leave Queue')
                    .setStyle(ButtonStyle.Danger);

                const row = new ActionRowBuilder().addComponents(joinButton, leaveButton);

                if (queueMessage) {
                    await queueMessage.edit({ embeds: [embed], components: [row] });
                } else {
                    const newMessage = await channel.send({ embeds: [embed], components: [row] });
                    await client.db.collection('servers').updateOne(
                        { _id: server._id },
                        { $set: { queueMessageId: newMessage.id } }
                    );
                }
            } catch (error) {
                logger.error(`Error updating queue display in server ${server._id}:`, error);
            }
        }
    } catch (error) {
        logger.error('Error in updateQueueDisplay:', error);
    }
}

async function startMatchmaking(client, mode) {
    try {
        const queue = await client.db.collection('queue').findOne({ mode });
        if (!queue || queue.players.length < 2) return;

        // For bingo mode, check if players are in the same challenge
        if (mode === 'bingo') {
            const player1 = queue.players[0];
            const player2 = queue.players[1];

            // Get both players' active challenges
            const [player1Challenge, player2Challenge] = await Promise.all([
                client.db.collection('challenges').findOne({
                    'participants.userId': player1.userId,
                    status: 'ACTIVE',
                    mode: 'bingo',
                    'participants.lives': { $gt: 0 }
                }),
                client.db.collection('challenges').findOne({
                    'participants.userId': player2.userId,
                    status: 'ACTIVE',
                    mode: 'bingo',
                    'participants.lives': { $gt: 0 }
                })
            ]);

            // Only match players if they're in the same challenge
            if (!player1Challenge || !player2Challenge || player1Challenge._id.toString() !== player2Challenge._id.toString()) {
                return;
            }

            // Remove both players from queue
            await client.db.collection('queue').updateOne(
                { mode },
                {
                    $pull: { players: { userId: { $in: [player1.userId, player2.userId] } } },
                    $set: { lastUpdated: new Date() }
                }
            );

            // Create match
            const match = {
                type: 'CHALLENGE',
                mode: 'bingo',
                challengeId: player1Challenge._id,
                status: 'PREGAME',
                players: [
                    {
                        userId: player1.userId,
                        rank: player1.rank,
                        region: player1.region,
                        score: null,
                        isCaptain: false,
                        isHost: false,
                        repChange: null,
                        reportedScore: null
                    },
                    {
                        userId: player2.userId,
                        rank: player2.rank,
                        region: player2.region,
                        score: null,
                        isCaptain: false,
                        isHost: false,
                        repChange: null,
                        reportedScore: null
                    }
                ],
                stage: null,
                roomCode: null,
                startTime: null,
                endTime: null,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await client.db.collection('matches').insertOne(match);

            // Notify players
            const player1User = await client.users.fetch(player1.userId);
            const player2User = await client.users.fetch(player2.userId);

            const matchEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Bingo Match Found!')
                .setDescription(`${player1User} vs ${player2User}\nChallenge: ${player1Challenge.name}`)
                .setTimestamp();

            // Send match notification to both players
            await Promise.all([
                player1User.send({ embeds: [matchEmbed] }).catch(() => {}),
                player2User.send({ embeds: [matchEmbed] }).catch(() => {})
            ]);

            // Start pre-game phase
            // ... (rest of pre-game phase implementation)

        } else {
            // Standard mode matchmaking
            // Start matchmaking countdown
            await updateQueueDisplay(client, mode, true); // true indicates matchmaking state

            // Wait 10 seconds for matchmaking
            await new Promise(resolve => setTimeout(resolve, 10000));

            // Re-fetch queue after countdown
            const updatedQueue = await client.db.collection('queue').findOne({ mode });
            if (!updatedQueue || updatedQueue.players.length < 2) {
                // Not enough players, revert to normal queue display
                await updateQueueDisplay(client, mode, false);
                return;
            }

            // Find best match based on rep difference and region
            const players = updatedQueue.players;
            let bestMatch = null;
            let smallestRepDiff = Infinity;

            // Get all players' user data for rep calculation
            const playerData = await Promise.all(
                players.map(async p => ({
                    ...p,
                    userData: await client.db.collection('users').findOne({ discordId: p.userId })
                }))
            );

            // Try to find players with similar rep and same region
            for (let i = 0; i < playerData.length; i++) {
                for (let j = i + 1; j < playerData.length; j++) {
                    const p1 = playerData[i];
                    const p2 = playerData[j];
                    
                    // Skip if players are from different regions
                    if (p1.region !== p2.region) continue;

                    // Calculate rep difference
                    const p1Rep = getRepFromRank(p1.userData?.rank || 'Bronze I');
                    const p2Rep = getRepFromRank(p2.userData?.rank || 'Bronze I');
                    const repDiff = Math.abs(p1Rep - p2Rep);

                    // Update best match if this pair has smaller rep difference
                    if (repDiff < smallestRepDiff) {
                        smallestRepDiff = repDiff;
                        bestMatch = [p1, p2];
                    }
                }
            }

            // If no same-region match found, find best match regardless of region
            if (!bestMatch) {
                for (let i = 0; i < playerData.length; i++) {
                    for (let j = i + 1; j < playerData.length; j++) {
                        const p1 = playerData[i];
                        const p2 = playerData[j];
                        
                        const p1Rep = getRepFromRank(p1.userData?.rank || 'Bronze I');
                        const p2Rep = getRepFromRank(p2.userData?.rank || 'Bronze I');
                        const repDiff = Math.abs(p1Rep - p2Rep);

                        if (repDiff < smallestRepDiff) {
                            smallestRepDiff = repDiff;
                            bestMatch = [p1, p2];
                        }
                    }
                }
            }

            if (!bestMatch) return;

            // Remove matched players from queue
            await client.db.collection('queue').updateOne(
                { mode },
                {
                    $pull: { players: { userId: { $in: [bestMatch[0].userId, bestMatch[1].userId] } } },
                    $set: { lastUpdated: new Date() }
                }
            );

            // Create match
            const match = {
                type: 'RANKED',
                mode: 'standard',
                status: 'PREGAME',
                players: [
                    {
                        userId: bestMatch[0].userId,
                        rank: bestMatch[0].userData?.rank || 'Bronze I',
                        region: bestMatch[0].region,
                        score: null,
                        isCaptain: false,
                        isHost: false,
                        repChange: null,
                        reportedScore: null
                    },
                    {
                        userId: bestMatch[1].userId,
                        rank: bestMatch[1].userData?.rank || 'Bronze I',
                        region: bestMatch[1].region,
                        score: null,
                        isCaptain: false,
                        isHost: false,
                        repChange: null,
                        reportedScore: null
                    }
                ],
                stage: null,
                roomCode: null,
                startTime: null,
                endTime: null,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const matchResult = await client.db.collection('matches').insertOne(match);
            const matchId = matchResult.insertedId;

            // Notify players
            const [player1User, player2User] = await Promise.all([
                client.users.fetch(bestMatch[0].userId),
                client.users.fetch(bestMatch[1].userId)
            ]);

            const matchEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Match Found!')
                .setDescription(`${player1User} vs ${player2User}`)
                .addFields(
                    { name: 'Mode', value: 'Standard', inline: true },
                    { name: 'Region', value: bestMatch[0].region, inline: true }
                )
                .setTimestamp();

            // Send match notification to both players
            await Promise.all([
                player1User.send({ embeds: [matchEmbed] }).catch(() => {}),
                player2User.send({ embeds: [matchEmbed] }).catch(() => {})
            ]);

            // Start pre-game phase
            await startPreGamePhase(client, matchId);

            // Update queue display back to normal
            await updateQueueDisplay(client, mode, false);
        }
    } catch (error) {
        logger.error('Error in startMatchmaking:', error);
        // Ensure queue display is reverted to normal state
        await updateQueueDisplay(client, mode, false);
    }
}

// Helper function to get rep value from rank
function getRepFromRank(rank) {
    const rankValues = {
        'Bronze I': 0,
        'Bronze II': 500,
        'Bronze III': 1000,
        'Silver I': 1500,
        'Silver II': 2000,
        'Silver III': 2500,
        'Gold I': 3000,
        'Gold II': 3500,
        'Gold III': 4000,
        'Diamond I': 4500,
        'Diamond II': 5000,
        'Diamond III': 5500,
        'Mythic I': 6000,
        'Mythic II': 6500,
        'Mythic III': 7000,
        'Legendary I': 7500,
        'Legendary II': 8000,
        'Legendary III': 8500,
        'Masters': 9000
    };
    return rankValues[rank] || 0;
}

function getRankEmoji(rank) {
    // ... existing rank emoji function ...
} 