const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const User = require('../models/User');
const Badge = require('../models/Badge');
const logger = require('./logger');

// Region configuration
const REGIONS = {
    'US_EAST': { emoji: '🇺🇸', name: 'US-East' },
    'US_WEST': { emoji: '🇺🇸', name: 'US-West' },
    'EU_WEST': { emoji: '🇪🇺', name: 'EU-West' },
    'EU_EAST': { emoji: '🇪🇺', name: 'EU-East' },
    'ASIA': { emoji: '🌏', name: 'Asia' },
    'OCEANIA': { emoji: '🌏', name: 'Oceania' },
    'SOUTH_AMERICA': { emoji: '🌎', name: 'South America' }
};

// Rank configuration
const RANKS = {
    BRONZE: { emoji: '1348460284951400570', color: '#f59833' },
    SILVER: { emoji: '1348460318753296466', color: '#6774c9' },
    GOLD: { emoji: '1348460332825186326', color: '#ffc11b' },
    DIAMOND: { emoji: '1348460344049401877', color: '#05c2f7' },
    MYTHIC: { emoji: '1348460358951768084', color: '#ce17ef' },
    LEGENDARY: { emoji: '1348460371392073829', color: '#fc3434' },
    MASTERS: { emoji: '1348460383396167681', color: '#741904' }
};

class PlayerCardManager {
    constructor(client) {
        this.client = client;
        this.activeCards = new Map(); // Map of userId -> { message, timeout }
        this.CARD_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
        this.MAX_DISPLAYED_BADGES = 3;
    }

    async generatePlayerCard(userId, targetUserId = null) {
        try {
            // Get user data
            const user = await User.findById(targetUserId || userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Get user's badges
            const badges = await Badge.find({ userId: user._id })
                .sort({ priority: -1, acquiredAt: -1 })
                .limit(this.MAX_DISPLAYED_BADGES);

            // Get user's rank info
            const rankInfo = this.calculateRankInfo(user.rep);

            // Get user's main community
            const mainCommunity = await this.getMainCommunity(user);

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`${user.username}'s Player Card`)
                .setTimestamp()
                .setColor(rankInfo.color)
                .setFooter({ text: 'Last updated:' })
                .setThumbnail(user.avatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png')
                .addFields([
                    {
                        name: 'Rank:',
                        value: `<:rank_${rankInfo.tier.toLowerCase()}:${rankInfo.emoji}> ${rankInfo.tier} ${rankInfo.division}`,
                        inline: true
                    },
                    {
                        name: 'Region:',
                        value: `${REGIONS[user.region].emoji} ${REGIONS[user.region].name}`,
                        inline: true
                    },
                    {
                        name: 'Main Community:',
                        value: mainCommunity ? `[${mainCommunity.name}](${mainCommunity.inviteLink})` : 'Not set',
                        inline: false
                    },
                    {
                        name: 'Badges:',
                        value: badges.length > 0 ? 
                            badges.map(b => b.emoji).join(' ') : 
                            'No badges yet',
                        inline: false
                    }
                ]);

            // Create buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`challenge_${user._id}`)
                        .setLabel('Challenge!')
                        .setEmoji('⚔️')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`badges_${user._id}`)
                        .setLabel('View Badge Collection')
                        .setStyle(ButtonStyle.Secondary)
                );

            return { embed, row };
        } catch (error) {
            logger.error('Error generating player card:', error);
            throw error;
        }
    }

    calculateRankInfo(rep) {
        const ranks = [
            { tier: 'BRONZE', divisions: ['I', 'II', 'III'], thresholds: [0, 500, 1000] },
            { tier: 'SILVER', divisions: ['I', 'II', 'III'], thresholds: [1500, 2000, 2500] },
            { tier: 'GOLD', divisions: ['I', 'II', 'III'], thresholds: [3000, 3500, 4000] },
            { tier: 'DIAMOND', divisions: ['I', 'II', 'III'], thresholds: [4500, 5000, 5500] },
            { tier: 'MYTHIC', divisions: ['I', 'II', 'III'], thresholds: [6000, 6500, 7000] },
            { tier: 'LEGENDARY', divisions: ['I', 'II', 'III'], thresholds: [7500, 8000, 8500] },
            { tier: 'MASTERS', divisions: [''], thresholds: [9000] }
        ];

        for (const rank of ranks) {
            for (let i = 0; i < rank.thresholds.length; i++) {
                if (rep < rank.thresholds[i]) {
                    return {
                        tier: rank.tier,
                        division: rank.divisions[i - 1] || '',
                        emoji: RANKS[rank.tier].emoji,
                        color: RANKS[rank.tier].color
                    };
                }
            }
        }

        // If rep is above all thresholds, return Masters
        return {
            tier: 'MASTERS',
            division: '',
            emoji: RANKS.MASTERS.emoji,
            color: RANKS.MASTERS.color
        };
    }

    async getMainCommunity(user) {
        if (!user.mainCommunity) return null;

        // Get community data from database
        const community = await this.client.db.collection('communities').findOne({
            _id: user.mainCommunity
        });

        return community;
    }

    async handleRegionSelection(userId, interaction) {
        try {
            // Create region selection menu
            const menu = new StringSelectMenuBuilder()
                .setCustomId('region_select')
                .setPlaceholder('Select your region')
                .addOptions(
                    Object.entries(REGIONS).map(([id, data]) => ({
                        label: data.name,
                        value: id,
                        emoji: data.emoji
                    }))
                );

            const row = new ActionRowBuilder().addComponents(menu);

            // Send selection menu
            const message = await interaction.reply({
                content: 'Please select your region:',
                components: [row],
                ephemeral: true
            });

            // Create collector
            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === userId,
                time: 60000
            });

            collector.on('collect', async (i) => {
                const region = i.values[0];
                
                // Update user's region
                await User.findByIdAndUpdate(userId, { region });

                // Update player card
                const { embed, row } = await this.generatePlayerCard(userId);
                await i.update({ embeds: [embed], components: [row] });

                collector.stop();
            });

            collector.on('end', async (collected) => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        content: 'Region selection timed out.',
                        components: []
                    });
                }
            });
        } catch (error) {
            logger.error('Error handling region selection:', error);
            await interaction.reply({
                content: 'An error occurred while selecting your region.',
                ephemeral: true
            });
        }
    }

    async handleBadgeCollection(userId, interaction) {
        try {
            // Get user's badges
            const badges = await Badge.find({ userId })
                .sort({ priority: -1, acquiredAt: -1 });

            if (badges.length === 0) {
                await interaction.reply({
                    content: 'You have no badges yet.',
                    ephemeral: true
                });
                return;
            }

            // Create badge collection embed
            const embed = new EmbedBuilder()
                .setTitle('Badge Collection')
                .setColor('#00FF00')
                .setDescription('Your acquired badges:')
                .addFields(
                    badges.map(badge => ({
                        name: `${badge.emoji} ${badge.name}`,
                        value: badge.description,
                        inline: false
                    }))
                )
                .setTimestamp();

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        } catch (error) {
            logger.error('Error handling badge collection:', error);
            await interaction.reply({
                content: 'An error occurred while fetching your badges.',
                ephemeral: true
            });
        }
    }

    async handleChallenge(userId, targetUserId, interaction) {
        try {
            // Check if target user is accepting challenges
            const targetUser = await User.findById(targetUserId);
            if (!targetUser.settings.acceptChallenges) {
                await interaction.reply({
                    content: `<@${targetUserId}> is not accepting challenges right now.`,
                    ephemeral: true
                });
                return;
            }

            // Check if either user is in a match
            const [userMatch, targetMatch] = await Promise.all([
                this.client.db.collection('matches').findOne({
                    'players.userId': userId,
                    status: { $in: ['IN_PROGRESS', 'PRE_GAME'] }
                }),
                this.client.db.collection('matches').findOne({
                    'players.userId': targetUserId,
                    status: { $in: ['IN_PROGRESS', 'PRE_GAME'] }
                })
            ]);

            if (userMatch || targetMatch) {
                await interaction.reply({
                    content: 'One or both players are currently in a match.',
                    ephemeral: true
                });
                return;
            }

            // Create challenge request
            const embed = new EmbedBuilder()
                .setTitle('Challenge Request')
                .setDescription(`<@${userId}> has challenged you to a match!`)
                .setColor('#00FF00')
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`challenge_accept_${userId}`)
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`challenge_decline_${userId}`)
                        .setLabel('Decline')
                        .setStyle(ButtonStyle.Danger)
                );

            // Send challenge request
            const message = await interaction.reply({
                content: `<@${targetUserId}>`,
                embeds: [embed],
                components: [row],
                fetchReply: true
            });

            // Create collector
            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === targetUserId,
                time: 300000 // 5 minutes
            });

            collector.on('collect', async (i) => {
                if (i.customId === `challenge_accept_${userId}`) {
                    // Start match
                    await this.startChallengeMatch(userId, targetUserId, i);
                } else {
                    // Decline challenge
                    await i.update({
                        content: `<@${targetUserId}> declined the challenge.`,
                        embeds: [],
                        components: []
                    });
                }
                collector.stop();
            });

            collector.on('end', async (collected) => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        content: 'Challenge request timed out.',
                        embeds: [],
                        components: []
                    });
                }
            });
        } catch (error) {
            logger.error('Error handling challenge:', error);
            await interaction.reply({
                content: 'An error occurred while processing the challenge.',
                ephemeral: true
            });
        }
    }

    async startChallengeMatch(userId, targetUserId, interaction) {
        try {
            // Create match document
            const match = await this.client.db.collection('matches').insertOne({
                players: [
                    { userId, ready: false },
                    { userId: targetUserId, ready: false }
                ],
                type: 'CHALLENGE',
                status: 'PRE_GAME',
                createdAt: new Date()
            });

            // Update message
            await interaction.update({
                content: 'Challenge accepted! Starting match...',
                embeds: [],
                components: []
            });

            // Start pre-game phase
            await this.client.preGameManager.startPreGame(match, interaction.channel);
        } catch (error) {
            logger.error('Error starting challenge match:', error);
            await interaction.reply({
                content: 'An error occurred while starting the match.',
                ephemeral: true
            });
        }
    }
}

module.exports = PlayerCardManager; 