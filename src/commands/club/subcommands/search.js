
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../../../utils/logger');
const Club = require('../../../models/Club');
const User = require('../../../models/User');

const CLUBS_PER_PAGE = 5;

module.exports = {
    async execute(interaction, { CLUB_ICONS, PRIVACY_TYPES }) {
        try {
            const query = interaction.options.getString('query');
            const filter = interaction.options.getString('filter') || 'ALL';

            // Build search query
            const searchQuery = {
                $or: [
                    { name: { $regex: query, $options: 'i' } },
                    { clubId: { $regex: query, $options: 'i' } }
                ]
            };

            // Add privacy filter if specified
            if (filter !== 'ALL') {
                searchQuery.privacy = filter;
            }

            // Search for clubs
            const clubs = await Club.find(searchQuery)
                .sort({ createdAt: -1 })
                .lean();

            if (clubs.length === 0) {
                return interaction.reply({
                    content: `No clubs found matching "${query}"${filter !== 'ALL' ? ` (${filter.toLowerCase()} only)` : ''}!`,
                    ephemeral: true
                });
            }

            // Calculate total pages
            const totalPages = Math.ceil(clubs.length / CLUBS_PER_PAGE);
            let currentPage = 0;

            // Function to generate search results embed
            const generateEmbed = async (page) => {
                const start = page * CLUBS_PER_PAGE;
                const end = start + CLUBS_PER_PAGE;
                const pageClubs = clubs.slice(start, end);

                // Get club owners and member counts
                const clubDetails = await Promise.all(pageClubs.map(async (club) => {
                    const owner = await User.findOne({ discordId: club.owner });
                    const memberCount = await User.countDocuments({ club: club._id });
                    return {
                        ...club,
                        ownerName: owner?.username || 'Unknown',
                        memberCount
                    };
                }));

                const embed = new EmbedBuilder()
                    .setTitle('Club Search Results')
                    .setDescription(`Found ${clubs.length} clubs matching "${query}"${filter !== 'ALL' ? ` (${filter.toLowerCase()} only)` : ''}\nPage ${page + 1}/${totalPages}`)
                    .setColor('#0099ff')
                    .setFooter({ text: `Use /club info <club_id> to view detailed information about a club` });

                // Add club fields
                clubDetails.forEach(club => {
                    const privacyEmoji = club.privacy === 'PUBLIC' ? '🌐' : '🔒';
                    embed.addFields({
                        name: `${club.name} [${club.clubId}] ${privacyEmoji}`,
                        value: 
                            `• Owner: ${club.ownerName}\n` +
                            `• Members: ${club.memberCount}/10\n` +
                            `• Created: <t:${Math.floor(club.createdAt.getTime() / 1000)}:R>`
                    });
                });

                return embed;
            };

            // Create navigation buttons
            const createButtons = (page) => {
                return new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('first')
                            .setLabel('≪')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(page === 0),
                        new ButtonBuilder()
                            .setCustomId('prev')
                            .setLabel('◀')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(page === 0),
                        new ButtonBuilder()
                            .setCustomId('next')
                            .setLabel('▶')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(page === totalPages - 1),
                        new ButtonBuilder()
                            .setCustomId('last')
                            .setLabel('≫')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(page === totalPages - 1)
                    );
            };

            // Send initial message
            const initialEmbed = await generateEmbed(currentPage);
            const response = await interaction.reply({
                embeds: [initialEmbed],
                components: [createButtons(currentPage)]
            });

            // Create button collector
            const collector = response.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300000 // 5 minutes
            });

            collector.on('collect', async (i) => {
                switch (i.customId) {
                    case 'first':
                        currentPage = 0;
                        break;
                    case 'prev':
                        currentPage = Math.max(0, currentPage - 1);
                        break;
                    case 'next':
                        currentPage = Math.min(totalPages - 1, currentPage + 1);
                        break;
                    case 'last':
                        currentPage = totalPages - 1;
                        break;
                }

                const newEmbed = await generateEmbed(currentPage);
                await i.update({
                    embeds: [newEmbed],
                    components: [createButtons(currentPage)]
                });
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        components: []
                    });
                }
            });

        } catch (error) {
            logger.error('Error in club search command:', error);
            await interaction.reply({
                content: 'An error occurred while searching for clubs. Please try again.',
                ephemeral: true
            });
        }
    }
}; 