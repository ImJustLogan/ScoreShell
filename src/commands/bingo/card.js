const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const logger = require('../../utils/logger');
const User = require('../../models/User');
const { generateBingoCard, generateBingoCardImage } = require('../../utils/bingo');

// List of all possible bingo quests
const BINGO_QUESTS = [
    'Solo Homerun', '2-Run Homerun', '3-Run Homerun', 'Grand Slam', 'Inside the Park',
    'Pitcher gets tired', 'Triple', 'Clamber catch', 'Close play win', 'Pitch a strikeout',
    'RBI chance', 'Bunt for a hit', 'Steal a base', 'Ground rule double', 'Fill star meter',
    'Get 1 run', 'Get 3 runs', 'Get 5 runs', 'Non-cutscene home run', 'Get walked/beaned',
    'Double play', 'Win a rundown', 'Get captain star swing out', 'Slap hit',
    'Buddy jump catch', 'Homerun', 'Slap hit with a Kong', 'Double with a baby',
    'Win a game', 'Diving catch no super dive', 'Double no items', 'Bad chem throw',
    'Get a strikeout', 'Pitch no hit inning', 'Jump catch', 'Shy guy super dive',
    'Star pitch strikeout', 'Hit a fielder with fireball', 'Hit a Home Run with a Toad',
    'Hit a Home Run with a Shy Guy', 'Hit a Home Run with a Pianta',
    'Hit a Home Run with a Magikoopa', 'Hit a Home Run with a Kritter',
    'Hit a Home Run with a Bro', 'Hit a Home Run with a Dry Bones',
    'Hit a Home Run without a cutscene', 'Win a close play', 'Pull off a successful bunt',
    'Use 5 Star Swings', 'Hit a single', 'Hit a double', 'Hit a triple',
    'Get an inside-in-the-park home run', 'Get a hit with two outs',
    'Hit a grand slam', 'Hit a ground rule double', 'Successfully steal from 1B to 2B',
    'Successfully steal from 2B to 3B', 'Have the FAIR! text display',
    'Get an out with Super Jump', 'Get an out with Super Dive',
    'Get an out with Quick Throw', 'Get an out with Laser Beam',
    'Get an out with Ball Dash', 'Get a triple play', 'Get an out with a buddy toss',
    'Have the Nice Play! text display', 'Use 5 Star Pitches', 'Bean ball the opponent',
    'Walk the opponent', 'Hit with a Green Shell', 'Hit with a Bob-Omb',
    'Hit with a Banana Peel', 'Hit with a Fire Ball', 'Hit with a Pow Ball',
    'Dodge Pow Ball'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('card')
        .setDescription('Generate a new bingo card'),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Check if user is in a match
            const user = await User.findOne({ discordId: interaction.user.id });
            if (user?.activeMatch?.matchId) {
                return interaction.reply({
                    content: 'You cannot generate a practice card while in a match!',
                    ephemeral: true
                });
            }

            // Generate new card
            const bingoCard = generateBingoCard();
            
            // Store card in user's data
            if (!interaction.client.userBingoCards) {
                interaction.client.userBingoCards = new Map();
            }
            interaction.client.userBingoCards.set(interaction.user.id, bingoCard);

            // Generate card image
            const cardImage = await generateBingoCardImage(bingoCard);

            // Send card
            await interaction.editReply({
                content: '🎯 Here\'s your bingo card! Use `/bingo mark` to mark completed quests.',
                files: [{
                    attachment: cardImage,
                    name: 'bingo-card.png'
                }]
            });

            logger.info(`Generated new bingo card for user ${interaction.user.tag}`);
        } catch (error) {
            logger.error('Error generating bingo card:', error);
            await interaction.editReply({
                content: '❌ An error occurred while generating your bingo card. Please try again.',
                ephemeral: true
            });
        }
    }
}; 