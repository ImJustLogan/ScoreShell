const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('helpmod')
        .setDescription('Shows a list of moderation commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Moderation Commands')
            .setColor('#ff0000')
            .setDescription('Here are all the available moderation commands:')
            .addFields(
                {
                    name: '📝 Report Management',
                    value: '`/reports` - View and handle pending reports\n`/report` - Report a user for misconduct',
                    inline: false
                },
                {
                    name: '🔨 Ban Management',
                    value: '`/ban` - Ban a user from ranked matches\n`/unban` - Unban a user from ranked matches\n`/banlist` - View all banned users',
                    inline: false
                },
                {
                    name: '⚙️ Settings',
                    value: '`/modsettings` - Configure moderation settings\n`/setup` - Initial server setup (one-time use)',
                    inline: false
                }
            )
            .setFooter({ text: 'These commands are only available to users with the admin role.' });

        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }
}; 