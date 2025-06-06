const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const logger = require('../../utils/logger');

// Club league icon from design doc
const CLUB_LEAGUE_ICON = {
    emoji: '1340465123126415390',
    image: 'https://i.imgur.com/Kkxa0gq.png'
};

module.exports = {
    category: 'club',
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('season')
                .setDescription('View the current club league season status')),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Get current date in EST
            const now = new Date();
            const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            
            // Calculate season start (1st of current month)
            const seasonStart = new Date(est.getFullYear(), est.getMonth(), 1);
            
            // Calculate season end (7th of current month)
            const seasonEnd = new Date(est.getFullYear(), est.getMonth(), 7, 23, 59, 59);
            
            // Check if we're in a season
            const isActive = est >= seasonStart && est <= seasonEnd;
            
            // Calculate time remaining if active
            let timeRemaining = '';
            if (isActive) {
                const remaining = seasonEnd - est;
                const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
                const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
                
                timeRemaining = `${days}d ${hours}h ${minutes}m`;
            }

            // Get user's club data if they're in a club
            const userData = await interaction.client.db.collection('users').findOne({ 
                userId: interaction.user.id 
            });

            // Create season status embed
            const seasonEmbed = new EmbedBuilder()
                .setTitle('Club League Season')
                .setDescription(isActive ? 
                    'The current club league season is active!' : 
                    'The next club league season will begin on the 1st of next month.')
                .setColor(isActive ? '#00ff00' : '#ff9900')
                .addFields(
                    { 
                        name: 'Season Status', 
                        value: isActive ? '🟢 Active' : '🔴 Inactive', 
                        inline: true 
                    },
                    { 
                        name: 'Season Period', 
                        value: `${seasonStart.toLocaleDateString()} - ${seasonEnd.toLocaleDateString()}`, 
                        inline: true 
                    }
                )
                .setThumbnail(CLUB_LEAGUE_ICON.image);

            // Add time remaining if active
            if (isActive) {
                seasonEmbed.addFields(
                    { name: 'Time Remaining', value: timeRemaining, inline: true }
                );
            }

            // Add user's club status if they're in a club
            if (userData?.clubId) {
                const clubData = await interaction.client.db.collection('clubs').findOne({ 
                    clubId: userData.clubId 
                });

                if (clubData) {
                    // Get user's remaining tickets
                    const tickets = userData.clubTickets || 7;
                    
                    // Get club's current rep
                    const clubRep = clubData.currentSeasonRep || 0;
                    
                    // Calculate estimated trophies
                    const estimatedTrophies = Math.ceil(clubRep / 10);

                    seasonEmbed.addFields(
                        { 
                            name: 'Your Club', 
                            value: clubData.name, 
                            inline: true 
                        },
                        { 
                            name: 'Your Tickets', 
                            value: `${tickets}/7`, 
                            inline: true 
                        },
                        { 
                            name: 'Club Rep', 
                            value: clubRep.toString(), 
                            inline: true 
                        },
                        { 
                            name: 'Estimated Trophies', 
                            value: estimatedTrophies.toString(), 
                            inline: true 
                        }
                    );

                    // Add club rep formula
                    seasonEmbed.addFields({
                        name: 'Club Rep Formula',
                        value: [
                            '• Base: 70 per win',
                            '• Run Differential: +3 per RD (capped at +30)',
                            '• Maximum: 100 per match',
                            '• Loss: -10',
                            '• Cannot go below 0'
                        ].join('\n'),
                        inline: false
                    });
                }
            }

            // Add season rules
            seasonEmbed.addFields({
                name: 'Season Rules',
                value: [
                    '• Season runs from 1st to 7th of each month',
                    '• Each player gets 7 tickets per season',
                    '• Club Rep is converted to trophies at season end',
                    '• Club hopping is disabled during active season',
                    '• Both players must be in clubs to earn Club Rep'
                ].join('\n'),
                inline: false
            });

            await interaction.editReply({ embeds: [seasonEmbed] });

        } catch (error) {
            logger.error('Error in club season command:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching season information.',
                ephemeral: true
            });
        }
    }
}; 