const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const logger = require('../../utils/logger');
const { getRankEmoji, getRankColor } = require('../../utils/helpers');

// Region flags mapping
const REGION_FLAGS = {
    'US-East': '🇺🇸',
    'US-West': '🇺🇸',
    'EU': '🇪🇺',
    'Asia': '🇯🇵',
    'Oceania': '🇦🇺',
    'South America': '🇧🇷'
};

module.exports = {
    category: 'user',
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('View a player\'s rank card')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view (defaults to you)')
                .setRequired(false)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Get target user (default to command user)
            const targetUser = interaction.options.getUser('user') || interaction.user;

            // Get user data from database
            const userData = await interaction.client.db.collection('users').findOne({
                discordId: targetUser.id
            });

            if (!userData) {
                return interaction.editReply({
                    content: 'This user hasn\'t played any ranked matches yet.',
                    ephemeral: true
                });
            }

            // Get main community data
            let mainCommunity = null;
            if (userData.mainCommunity) {
                mainCommunity = await interaction.client.db.collection('servers').findOne({
                    guildId: userData.mainCommunity
                });
            }

            // Get user's badges (up to 3)
            const badges = userData.badges || [];
            const displayBadges = badges.slice(0, 3).map(badge => badge.emoji).join('  ') || 'No badges yet';

            // Create rank card embed
            const embed = new EmbedBuilder()
                .setColor(getRankColor(userData.rep))
                .setTitle(`${targetUser.username}'s Player Card`)
                .setThumbnail(targetUser.displayAvatarURL({ size: 1024 }))
                .addFields(
                    {
                        name: 'Rank:',
                        value: `${getRankEmoji(userData.rep)} ${userData.rank}`,
                        inline: true
                    },
                    {
                        name: 'Region:',
                        value: `${REGION_FLAGS[userData.region] || '🌎'} ${userData.region}`,
                        inline: true
                    }
                )
                .setFooter({ text: 'Last updated:' })
                .setTimestamp();

            // Add main community if exists
            if (mainCommunity) {
                embed.addFields({
                    name: 'Main Community:',
                    value: `[${mainCommunity.name}](${mainCommunity.inviteLink})`,
                    inline: false
                });
            }

            // Add badges
            embed.addFields({
                name: 'Badges:',
                value: displayBadges,
                inline: false
            });

            // Add stats
            embed.addFields(
                {
                    name: 'Stats',
                    value: [
                        `Rep: ${userData.rep.toLocaleString()}`,
                        `Wins: ${userData.wins || 0}`,
                        `Losses: ${userData.losses || 0}`,
                        `Ties: ${userData.ties || 0}`,
                        `Win Streak: ${userData.winStreak || 0}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: 'Club',
                    value: userData.club ? 
                        `${userData.club.name} (${userData.club.role})` : 
                        'Not in a club',
                    inline: true
                }
            );

            // Create challenge buttons
            const challengeButton = new ButtonBuilder()
                .setCustomId(`challenge_${targetUser.id}`)
                .setLabel('Challenge!')
                .setEmoji('<:Icon_duel:1314604168744402954>')
                .setStyle(ButtonStyle.Primary);

            const moreInfoButton = new ButtonBuilder()
                .setCustomId(`challenge_info_${targetUser.id}`)
                .setLabel('More Info')
                .setStyle(ButtonStyle.Secondary);

            // Check if target user has duel requests disabled
            if (userData.settings?.duelRequestsDisabled) {
                challengeButton.setDisabled(true);
                moreInfoButton.setDisabled(true);
                embed.setFooter({ 
                    text: 'This user has duel requests disabled. If you think this is a mistake, tell them to check their settings.'
                });
            }

            const row = new ActionRowBuilder().addComponents(challengeButton, moreInfoButton);

            // Send the rank card
            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });

            // Create button collector for challenge
            const message = await interaction.fetchReply();
            const collector = message.createMessageComponentCollector({
                componentType: ButtonType.Button,
                time: 300000 // 5 minutes
            });

            collector.on('collect', async i => {
                if (i.customId.startsWith('challenge_info_')) {
                    const infoEmbed = new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle('Duel Information')
                        .setDescription('Challenge another player to a friendly battle!')
                        .addFields(
                            {
                                name: 'Standard Mode',
                                value: 'Star Moves on, 7 innings, items on, mercy on. No ranked, club, mastery or challenge progress is made.',
                                inline: false
                            },
                            {
                                name: 'Bingo Mode',
                                value: 'Star Moves on, 7 innings, items on, mercy on. Complete bingo card objectives to win!',
                                inline: false
                            }
                        )
                        .setFooter({ text: 'Use the Challenge button to start a duel!' });

                    return i.reply({
                        embeds: [infoEmbed],
                        ephemeral: true
                    });
                }

                if (i.user.id === targetUser.id) {
                    return i.reply({
                        content: 'You cannot challenge yourself!',
                        ephemeral: true
                    });
                }

                // Check if either user is in a match
                const [challengerMatch, targetMatch] = await Promise.all([
                    interaction.client.db.collection('matches').findOne({
                        'players.userId': i.user.id,
                        status: { $in: ['PREGAME', 'IN_PROGRESS'] }
                    }),
                    interaction.client.db.collection('matches').findOne({
                        'players.userId': targetUser.id,
                        status: { $in: ['PREGAME', 'IN_PROGRESS'] }
                    })
                ]);

                if (challengerMatch || targetMatch) {
                    return i.reply({
                        content: 'One or both players are currently in a match.',
                        ephemeral: true
                    });
                }

                // Check if either user is in queue
                const [challengerQueue, targetQueue] = await Promise.all([
                    interaction.client.db.collection('queue').findOne({
                        'players.userId': i.user.id
                    }),
                    interaction.client.db.collection('queue').findOne({
                        'players.userId': targetUser.id
                    })
                ]);

                if (challengerQueue || targetQueue) {
                    return i.reply({
                        content: 'One or both players are currently in queue.',
                        ephemeral: true
                    });
                }

                // Create challenge request
                const challengeEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('Duel Challenge')
                    .setDescription(`${i.user} has challenged ${targetUser} to a duel!`)
                    .addFields(
                        {
                            name: 'Mode',
                            value: 'Standard (Star Moves on, 7 innings, items on, mercy on)',
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
                    .setCustomId(`accept_duel_${i.user.id}`)
                    .setLabel('Accept')
                    .setStyle(ButtonStyle.Success);

                const declineButton = new ButtonBuilder()
                    .setCustomId(`decline_duel_${i.user.id}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Danger);

                const challengeRow = new ActionRowBuilder()
                    .addComponents(acceptButton, declineButton);

                // Send challenge request
                await i.reply({
                    content: `${targetUser}`,
                    embeds: [challengeEmbed],
                    components: [challengeRow]
                });

                // Create collector for accept/decline
                const challengeMessage = await i.fetchReply();
                const challengeCollector = challengeMessage.createMessageComponentCollector({
                    componentType: ButtonType.Button,
                    time: 300000 // 5 minutes
                });

                challengeCollector.on('collect', async buttonInteraction => {
                    if (buttonInteraction.user.id !== targetUser.id) {
                        return buttonInteraction.reply({
                            content: 'Only the challenged player can respond to this challenge.',
                            ephemeral: true
                        });
                    }

                    if (buttonInteraction.customId.startsWith('accept_duel')) {
                        // Start duel match
                        await interaction.client.db.collection('matches').insertOne({
                            type: 'DUEL',
                            status: 'PREGAME',
                            players: [
                                {
                                    userId: i.user.id,
                                    rank: (await interaction.client.db.collection('users').findOne({ discordId: i.user.id })).rank,
                                    region: (await interaction.client.db.collection('users').findOne({ discordId: i.user.id })).region,
                                    score: null,
                                    isCaptain: false,
                                    isHost: false,
                                    repChange: null,
                                    reportedScore: null
                                },
                                {
                                    userId: targetUser.id,
                                    rank: userData.rank,
                                    region: userData.region,
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

                        await buttonInteraction.update({
                            content: `${i.user} ${targetUser} Duel accepted! Starting match...`,
                            embeds: [],
                            components: []
                        });

                        // Start pre-game phase
                        // TODO: Implement pre-game phase for duels
                        // This will be similar to ranked matches but without rep changes

                    } else if (buttonInteraction.customId.startsWith('decline_duel')) {
                        await buttonInteraction.update({
                            content: `${i.user} ${targetUser} Duel declined.`,
                            embeds: [],
                            components: []
                        });
                    }
                });

                challengeCollector.on('end', () => {
                    if (!challengeMessage.deleted) {
                        challengeMessage.edit({
                            components: []
                        }).catch(() => {});
                    }
                });
            });

            collector.on('end', () => {
                if (!message.deleted) {
                    message.edit({
                        components: []
                    }).catch(() => {});
                }
            });

        } catch (error) {
            logger.error('Error in rank command:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching rank information.',
                ephemeral: true
            });
        }
    }
};