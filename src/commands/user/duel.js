const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');
const logger = require('../../utils/logger');
const { generateMatchCards, createBingoCardEmbed } = require('../../utils/bingo');
const config = require('../../config');

module.exports = {
    category: 'user',
    data: new SlashCommandBuilder()
        .setName('duel')
        .setDescription('Challenge a player to a friendly battle')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to challenge')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('The game mode')
                .setRequired(false)
                .addChoices(
                    { name: 'Standard', value: 'standard' },
                    { name: 'Bingo', value: 'bingo' }
                )),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');
            const mode = interaction.options.getString('mode') || 'standard';

            // Check if challenging self
            if (targetUser.id === interaction.user.id) {
                return interaction.reply({
                    content: 'You cannot challenge yourself!',
                    ephemeral: true
                });
            }

            // Get target user's settings
            const targetData = await interaction.client.db.collection('users').findOne({
                discordId: targetUser.id
            });

            // Check if target has duel requests disabled
            if (targetData?.settings?.duelRequestsDisabled) {
                return interaction.reply({
                    content: `${targetUser} is not accepting duel requests right now. If you think this is a mistake, tell them to check their settings.`,
                    ephemeral: true
                });
            }

            // Check if either user is in a match
            const [challengerMatch, targetMatch] = await Promise.all([
                interaction.client.db.collection('matches').findOne({
                    'players.userId': interaction.user.id,
                    status: { $in: ['PREGAME', 'IN_PROGRESS'] }
                }),
                interaction.client.db.collection('matches').findOne({
                    'players.userId': targetUser.id,
                    status: { $in: ['PREGAME', 'IN_PROGRESS'] }
                })
            ]);

            if (challengerMatch || targetMatch) {
                return interaction.reply({
                    content: 'One or both players are currently in a match.',
                    ephemeral: true
                });
            }

            // Check if either user is in queue
            const [challengerQueue, targetQueue] = await Promise.all([
                interaction.client.db.collection('queue').findOne({
                    'players.userId': interaction.user.id
                }),
                interaction.client.db.collection('queue').findOne({
                    'players.userId': targetUser.id
                })
            ]);

            if (challengerQueue || targetQueue) {
                return interaction.reply({
                    content: 'One or both players are currently in queue.',
                    ephemeral: true
                });
            }

            // Create challenge request
            const challengeEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Duel Challenge')
                .setDescription(`${interaction.user} has challenged ${targetUser} to a duel!`)
                .addFields(
                    {
                        name: 'Mode',
                        value: mode === 'standard' ? 
                            'Standard (Star Moves on, 7 innings, items on, mercy on)' :
                            'Bingo (Star Moves on, 7 innings, items on, mercy on)',
                        inline: false
                    },
                    {
                        name: 'Note',
                        value: 'No ranked, club, mastery or challenge progress is made by playing in duels.',
                        inline: false
                    }
                )
                .setTimestamp();

            const acceptButton = new ButtonBuilder()
                .setCustomId(`accept_duel_${interaction.user.id}_${mode}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success);

            const declineButton = new ButtonBuilder()
                .setCustomId(`decline_duel_${interaction.user.id}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger);

            const challengeRow = new ActionRowBuilder()
                .addComponents(acceptButton, declineButton);

            // Send challenge request
            const challengeMessage = await interaction.reply({
                content: `${targetUser}`,
                embeds: [challengeEmbed],
                components: [challengeRow],
                fetchReply: true
            });

            // Create collector for accept/decline
            const collector = challengeMessage.createMessageComponentCollector({
                componentType: ButtonType.Button,
                time: 300000 // 5 minutes
            });

            collector.on('collect', async i => {
                if (i.user.id !== targetUser.id) {
                    return i.reply({
                        content: 'Only the challenged player can respond to this challenge.',
                        ephemeral: true
                    });
                }

                if (i.customId.startsWith('accept_duel_')) {
                    // Start duel match
                    await interaction.client.db.collection('matches').insertOne({
                        type: 'DUEL',
                        mode: mode,
                        status: 'PREGAME',
                        players: [
                            {
                                userId: interaction.user.id,
                                rank: (await interaction.client.db.collection('users').findOne({ discordId: interaction.user.id }))?.rank || 'Bronze I',
                                region: (await interaction.client.db.collection('users').findOne({ discordId: interaction.user.id }))?.region || 'US-East',
                                score: null,
                                isCaptain: false,
                                isHost: false,
                                repChange: null,
                                reportedScore: null
                            },
                            {
                                userId: targetUser.id,
                                rank: targetData?.rank || 'Bronze I',
                                region: targetData?.region || 'US-East',
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
                    });

                    await i.update({
                        content: `${interaction.user} ${targetUser} Duel accepted! Starting match...`,
                        embeds: [],
                        components: []
                    });

                    // Start pre-game phase
                    if (mode === 'bingo') {
                        // Start stage banning phase
                        const stages = config.stages;
                        const stageEmbed = new EmbedBuilder()
                            .setColor('#5865F2')
                            .setTitle('Stage Banning Phase')
                            .setDescription(`${interaction.user} goes first! Please ban a stage.`)
                            .setTimestamp();

                        const stageButtons = stages.map(stage => 
                            new ButtonBuilder()
                                .setCustomId(`ban_${stage}`)
                                .setLabel(stage)
                                .setStyle(ButtonStyle.Secondary)
                        );

                        const stageRow = new ActionRowBuilder().addComponents(stageButtons);
                        const stageMessage = await i.update({
                            content: `${interaction.user}`,
                            embeds: [stageEmbed],
                            components: [stageRow],
                            fetchReply: true
                        });

                        // Stage banning collector
                        const stageCollector = stageMessage.createMessageComponentCollector({
                            componentType: ComponentType.Button,
                            time: 60000 // 60 seconds
                        });

                        let bannedStages = [];
                        let currentPlayer = interaction.user;
                        let nextPlayer = targetUser;

                        stageCollector.on('collect', async (interaction) => {
                            if (interaction.user.id !== currentPlayer.id) {
                                return interaction.reply({
                                    content: 'It\'s not your turn to ban!',
                                    ephemeral: true
                                });
                            }

                            const stage = interaction.customId.replace('ban_', '');
                            bannedStages.push(stage);

                            // Disable the banned stage button
                            const updatedButtons = stageButtons.map(button => {
                                if (button.data.custom_id === `ban_${stage}`) {
                                    return ButtonBuilder.from(button.data)
                                        .setDisabled(true)
                                        .setStyle(ButtonStyle.Danger);
                                }
                                return button;
                            });

                            const updatedRow = new ActionRowBuilder().addComponents(updatedButtons);

                            // Update message for next player or move to captain selection
                            if (bannedStages.length < stages.length - 1) {
                                // Switch players
                                [currentPlayer, nextPlayer] = [nextPlayer, currentPlayer];
                                
                                await interaction.update({
                                    content: `${currentPlayer}`,
                                    embeds: [
                                        EmbedBuilder.from(stageEmbed)
                                            .setDescription(`${currentPlayer} please ban a stage.`)
                                    ],
                                    components: [updatedRow]
                                });
                            } else {
                                // Stage banning complete, move to captain selection
                                const selectedStage = stages.find(s => !bannedStages.includes(s));
                                
                                // Update match with selected stage
                                await interaction.client.db.collection('matches').updateOne(
                                    { _id: match._id },
                                    { $set: { stage: selectedStage } }
                                );

                                // Start captain selection
                                const captains = config.captains;
                                const captainEmbed = new EmbedBuilder()
                                    .setColor('#5865F2')
                                    .setTitle('Captain Selection')
                                    .setDescription(`${targetUser} picks first! Please select your captain.`)
                                    .addFields(
                                        { name: 'Selected Stage', value: selectedStage }
                                    )
                                    .setTimestamp();

                                const captainButtons = captains.map(captain =>
                                    new ButtonBuilder()
                                        .setCustomId(`captain_${captain}`)
                                        .setLabel(captain)
                                        .setStyle(ButtonStyle.Secondary)
                                );

                                const captainRow = new ActionRowBuilder().addComponents(captainButtons);
                                await interaction.update({
                                    content: `${targetUser}`,
                                    embeds: [captainEmbed],
                                    components: [captainRow]
                                });

                                // Captain selection collector
                                const captainCollector = stageMessage.createMessageComponentCollector({
                                    componentType: ComponentType.Button,
                                    time: 60000 // 60 seconds
                                });

                                let selectedCaptains = [];
                                currentPlayer = targetUser;
                                nextPlayer = interaction.user;

                                captainCollector.on('collect', async (interaction) => {
                                    if (interaction.user.id !== currentPlayer.id) {
                                        return interaction.reply({
                                            content: 'It\'s not your turn to pick!',
                                            ephemeral: true
                                        });
                                    }

                                    const captain = interaction.customId.replace('captain_', '');
                                    selectedCaptains.push({
                                        userId: currentPlayer.id,
                                        captain: captain
                                    });

                                    // Disable the selected captain button
                                    const updatedButtons = captainButtons.map(button => {
                                        if (button.data.custom_id === `captain_${captain}`) {
                                            return ButtonBuilder.from(button.data)
                                                .setDisabled(true)
                                                .setStyle(ButtonStyle.Success);
                                        }
                                        return button;
                                    });

                                    const updatedRow = new ActionRowBuilder().addComponents(updatedButtons);

                                    if (selectedCaptains.length < 2) {
                                        // Switch players
                                        [currentPlayer, nextPlayer] = [nextPlayer, currentPlayer];
                                        
                                        await interaction.update({
                                            content: `${currentPlayer}`,
                                            embeds: [
                                                EmbedBuilder.from(captainEmbed)
                                                    .setDescription(`${currentPlayer} please select your captain.`)
                                            ],
                                            components: [updatedRow]
                                        });
                                    } else {
                                        // Captain selection complete
                                        // Update match with selected captains
                                        await interaction.client.db.collection('matches').updateOne(
                                            { _id: match._id },
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

                                        // Generate and send bingo cards
                                        const bingoCards = generateMatchCards([interaction.user.id, targetUser.id]);

                                        // Update match with bingo cards
                                        await interaction.client.db.collection('matches').updateOne(
                                            { _id: match._id },
                                            { 
                                                $set: { 
                                                    type: 'BINGO',
                                                    bingo: { cards: bingoCards }
                                                }
                                            }
                                        );

                                        // Send cards to both players via DM
                                        try {
                                            // Send to challenger
                                            const challengerCard = bingoCards.find(card => card.user === interaction.user.id);
                                            await interaction.user.send({
                                                embeds: [createBingoCardEmbed(challengerCard.card, challengerCard.markedSpaces)]
                                            });

                                            // Send to target
                                            const targetCard = bingoCards.find(card => card.user === targetUser.id);
                                            await targetUser.send({
                                                embeds: [createBingoCardEmbed(targetCard.card, targetCard.markedSpaces)]
                                            });

                                            // Send match start message
                                            const startEmbed = new EmbedBuilder()
                                                .setColor('#5865F2')
                                                .setTitle('Bingo Match Started!')
                                                .setDescription('Check your DMs for your bingo cards!')
                                                .addFields(
                                                    { name: 'Stage', value: selectedStage },
                                                    { name: 'Captains', value: `${selectedCaptains[0].captain} vs ${selectedCaptains[1].captain}` },
                                                    { name: 'How to Play', value: 'Use `/bingo mark` to mark completed quests on your card. Complete 5 lines to win!' }
                                                )
                                                .setTimestamp();

                                            await interaction.update({
                                                content: `${interaction.user} ${targetUser} Bingo match started!`,
                                                embeds: [startEmbed],
                                                components: []
                                            });

                                            // Update match status
                                            await interaction.client.db.collection('matches').updateOne(
                                                { _id: match._id },
                                                { 
                                                    $set: { 
                                                        status: 'IN_PROGRESS',
                                                        startTime: new Date()
                                                    }
                                                }
                                            );

                                        } catch (error) {
                                            logger.error('Error sending bingo cards:', error);
                                            await interaction.update({
                                                content: 'Error: Could not send bingo cards. Make sure both players have DMs enabled.',
                                                embeds: [],
                                                components: []
                                            });
                                            // Cancel the match
                                            await interaction.client.db.collection('matches').updateOne(
                                                { _id: match._id },
                                                { $set: { status: 'CANCELLED' } }
                                            );
                                        }
                                    }
                                });

                                captainCollector.on('end', () => {
                                    if (selectedCaptains.length < 2) {
                                        // Auto-select random captain for player who didn't pick
                                        const remainingCaptains = captains.filter(c => 
                                            !selectedCaptains.some(sc => sc.captain === c)
                                        );
                                        const randomCaptain = remainingCaptains[Math.floor(Math.random() * remainingCaptains.length)];
                                        selectedCaptains.push({
                                            userId: nextPlayer.id,
                                            captain: randomCaptain
                                        });
                                    }
                                });
                            }
                        });

                        stageCollector.on('end', () => {
                            if (bannedStages.length < stages.length - 1) {
                                // Auto-ban random stage for player who didn't ban
                                const remainingStages = stages.filter(s => !bannedStages.includes(s));
                                const randomStage = remainingStages[Math.floor(Math.random() * remainingStages.length)];
                                bannedStages.push(randomStage);
                            }
                        });
                    } else {
                        // Standard mode pre-game
                        // TODO: Implement standard mode pre-game
                        // This will be similar to ranked matches but without rep changes
                    }
                } else if (i.customId.startsWith('decline_duel_')) {
                    await i.update({
                        content: `${interaction.user} ${targetUser} Duel declined.`,
                        embeds: [],
                        components: []
                    });
                }
            });

            collector.on('end', () => {
                if (!challengeMessage.deleted) {
                    challengeMessage.edit({
                        components: []
                    }).catch(() => {});
                }
            });

        } catch (error) {
            logger.error('Error in duel command:', error);
            return interaction.reply({
                content: 'An error occurred while processing the duel challenge.',
                ephemeral: true
            });
        }
    }
}; 