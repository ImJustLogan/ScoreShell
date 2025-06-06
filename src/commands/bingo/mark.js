const { SlashCommandBuilder } = require('discord.js');
const { markBingoSpace, generateBingoCardImage } = require('../../utils/bingo');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mark')
        .setDescription('Mark a space on your bingo card')
        .addStringOption(option =>
            option.setName('position')
                .setDescription('The position to mark (e.g., A1, B3)')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Get user's bingo card
            const bingoCard = interaction.client.userBingoCards?.get(interaction.user.id);
            if (!bingoCard) {
                return interaction.editReply({
                    content: '❌ You don\'t have a bingo card! Use `/bingo card` to generate one.',
                    ephemeral: true
                });
            }

            // Get position to mark
            const position = interaction.options.getString('position').toUpperCase();

            // Mark the space
            const result = markBingoSpace(bingoCard, position);
            if (!result.success) {
                return interaction.editReply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
            }

            // Generate updated card image
            const cardImage = await generateBingoCardImage(bingoCard);

            // Prepare response
            let response = `✅ Marked space ${position}!`;
            if (result.completedLines?.length > 0) {
                response += `\n🎉 Completed lines: ${result.completedLines.join(', ')}`;
            }
            if (result.hasBingo) {
                response += '\n🎊 BINGO! You\'ve completed 5 lines!';
            }

            // Send updated card
            await interaction.editReply({
                content: response,
                files: [{
                    attachment: cardImage,
                    name: 'bingo-card.png'
                }]
            });

            logger.info(`User ${interaction.user.tag} marked space ${position} on their bingo card`);
        } catch (error) {
            logger.error('Error marking bingo space:', error);
            await interaction.editReply({
                content: '❌ An error occurred while marking your bingo card. Please try again.',
                ephemeral: true
            });
        }
    }
};