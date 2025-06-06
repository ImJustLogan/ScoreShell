const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { getRankEmoji } = require('../utils/helpers');
const { CLUB_ICONS } = require('../utils/clubManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the leaderboard')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of leaderboard to view')
                .setRequired(false)
                .addChoices(
                    { name: 'Ranked', value: 'ranked' },
                    { name: 'Club League', value: 'club' }
                ))
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page number to view')
                .setRequired(false)
                .setMinValue(1)),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const type = interaction.options.getString('type') || 'ranked';
            const page = interaction.options.getInteger('page') || 1;
            const limit = 10;

            let embed;
            let totalPages;

            if (type === 'ranked') {
                // Get ranked leaderboard
                const users = await interaction.client.db.collection('users')
                    .find()
                    .sort({ rep: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                const total = await interaction.client.db.collection('users').countDocuments();
                totalPages = Math.ceil(total / limit);

                // Format entries
                const entries = users.map((user, index) => {
                    const rank = (page - 1) * limit + index + 1;
                    return `${rank}. ${getRankEmoji(user.rep)} ${user.username} — ${user.rep} Rep`;
                });

                embed = new EmbedBuilder()
                    .setTitle(`Ranked Leaderboard — Page ${page}`)
                    .setDescription(entries.join('\n'))
                    .setColor(15594231) // Bronze color
                    .setFooter({ text: `Page ${page} of ${totalPages}` })
                    .setThumbnail('https://message.style/cdn/images/f056968f01838d4089a8324e857fe1c2065aef93afd2ff9d7a9a4157ae717ec2.png');

            } else {
                // Get club leaderboard
                const clubs = await interaction.client.db.collection('clubs')
                    .find()
                    .sort({ 'clubLeague.trophies': -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                const total = await interaction.client.db.collection('clubs').countDocuments();
                totalPages = Math.ceil(total / limit);

                // Format entries
                const entries = clubs.map((club, index) => {
                    const rank = (page - 1) * limit + index + 1;
                    const iconInfo = CLUB_ICONS[club.icon];
                    return `${rank}. <:${iconInfo.emoji}> ${club.name} [${club.clubId}] — ${club.clubLeague.trophies} Trophies`;
                });

                embed = new EmbedBuilder()
                    .setTitle(`Club Leaderboard — Page ${page}`)
                    .setDescription(entries.join('\n'))
                    .setColor(2583267) // Blue color
                    .setFooter({ text: `Page ${page} of ${totalPages}` })
                    .setThumbnail('https://message.style/cdn/images/07a7ddbbe75fa2ca244263012fcc46d0dc27bfeeadd9b83206cefa61df145f50.png');
            }

            // Create navigation buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev_page')
                        .setLabel('')
                        .setEmoji('⬅️')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === 1),
                    new ButtonBuilder()
                        .setCustomId('find')
                        .setLabel('Find')
                        .setEmoji('🔍')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('next_page')
                        .setLabel('')
                        .setEmoji('➡️')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === totalPages)
                );

            const message = await interaction.editReply({
                embeds: [embed],
                components: [row]
            });

            // Create collector for button interactions
            const collector = message.createMessageComponentCollector({
                time: 300000 // 5 minutes
            });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'This is not your leaderboard!', ephemeral: true });
                    return;
                }

                if (i.customId === 'find') {
                    // Create modal for search
                    const modal = new ModalBuilder()
                        .setCustomId('leaderboard_search')
                        .setTitle('Find Player/Club');

                    const searchInput = new TextInputBuilder()
                        .setCustomId('search')
                        .setLabel('Enter name or ID')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    const firstActionRow = new ActionRowBuilder().addComponents(searchInput);
                    modal.addComponents(firstActionRow);

                    await i.showModal(modal);
                    return;
                }

                // Handle pagination
                const newPage = i.customId === 'prev_page' ? page - 1 : page + 1;
                
                // Update buttons
                row.components[0].setDisabled(newPage === 1);
                row.components[2].setDisabled(newPage === totalPages);

                // Fetch new data
                if (type === 'ranked') {
                    const users = await interaction.client.db.collection('users')
                        .find()
                        .sort({ rep: -1 })
                        .skip((newPage - 1) * limit)
                        .limit(limit)
                        .toArray();

                    const entries = users.map((user, index) => {
                        const rank = (newPage - 1) * limit + index + 1;
                        return `${rank}. ${getRankEmoji(user.rep)} ${user.username} — ${user.rep} Rep`;
                    });

                    embed.setTitle(`Ranked Leaderboard — Page ${newPage}`)
                        .setDescription(entries.join('\n'))
                        .setFooter({ text: `Page ${newPage} of ${totalPages}` });

                } else {
                    const clubs = await interaction.client.db.collection('clubs')
                        .find()
                        .sort({ 'clubLeague.trophies': -1 })
                        .skip((newPage - 1) * limit)
                        .limit(limit)
                        .toArray();

                    const entries = clubs.map((club, index) => {
                        const rank = (newPage - 1) * limit + index + 1;
                        const iconInfo = CLUB_ICONS[club.icon];
                        return `${rank}. <:${iconInfo.emoji}> ${club.name} [${club.clubId}] — ${club.clubLeague.trophies} Trophies`;
                    });

                    embed.setTitle(`Club Leaderboard — Page ${newPage}`)
                        .setDescription(entries.join('\n'))
                        .setFooter({ text: `Page ${newPage} of ${totalPages}` });
                }

                await i.update({
                    embeds: [embed],
                    components: [row]
                });
            });

            collector.on('end', async () => {
                // Remove buttons when collector expires
                await interaction.editReply({
                    embeds: [embed],
                    components: []
                }).catch(() => {});
            });

        } catch (error) {
            logger.error('Error in leaderboard command:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching the leaderboard. Please try again.',
                ephemeral: true
            });
        }
    }
}; 