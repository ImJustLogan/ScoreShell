const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('modsettings')
        .setDescription('Configure moderation settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const settings = await interaction.client.moderationManager.getServerSettings(interaction.guildId);
        if (!settings) {
            return interaction.reply({
                content: 'Server settings not found. Please run /setup first.',
                ephemeral: true
            });
        }

        const embed = interaction.client.moderationManager.generateSettingsEmbed(settings);
        const menu = interaction.client.moderationManager.generateSettingsMenu();
        const row = new ActionRowBuilder().addComponents(menu);

        // Add buttons for common actions
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('settings_admin_role')
                    .setLabel('Set Admin Role')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('settings_log_channel')
                    .setLabel('Set Log Channel')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('settings_report_channel')
                    .setLabel('Set Report Channel')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('settings_toggle_automod')
                    .setLabel(settings.autoModEnabled ? 'Disable Auto-mod' : 'Enable Auto-mod')
                    .setStyle(settings.autoModEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
            );

        const message = await interaction.reply({
            embeds: [embed],
            components: [row, buttonRow],
            ephemeral: true
        });

        // Create collector for menu interactions
        const collector = message.createMessageComponentCollector({
            time: 300000 // 5 minutes
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({
                    content: 'Only the command user can use these settings.',
                    ephemeral: true
                });
            }

            const setting = i.customId.replace('settings_', '');
            let newValue;

            switch (setting) {
                case 'admin_role':
                    // Show role selection menu
                    const roles = interaction.guild.roles.cache
                        .filter(role => role.name !== '@everyone')
                        .map(role => ({
                            label: role.name,
                            value: role.id,
                            description: `ID: ${role.id}`
                        }));

                    const roleMenu = new StringSelectMenuBuilder()
                        .setCustomId('role_select')
                        .setPlaceholder('Select admin role')
                        .addOptions(roles.slice(0, 25)); // Discord limits to 25 options

                    await i.update({
                        components: [new ActionRowBuilder().addComponents(roleMenu)]
                    });
                    break;

                case 'log_channel':
                case 'report_channel':
                    // Show channel selection menu
                    const channels = interaction.guild.channels.cache
                        .filter(channel => channel.type === 0) // Text channels only
                        .map(channel => ({
                            label: channel.name,
                            value: channel.id,
                            description: `ID: ${channel.id}`
                        }));

                    const channelMenu = new StringSelectMenuBuilder()
                        .setCustomId(`${setting}_select`)
                        .setPlaceholder(`Select ${setting.replace('_', ' ')}`)
                        .addOptions(channels.slice(0, 25));

                    await i.update({
                        components: [new ActionRowBuilder().addComponents(channelMenu)]
                    });
                    break;

                case 'toggle_automod':
                    newValue = !settings.autoModEnabled;
                    await interaction.client.moderationManager.updateServerSettings(interaction.guildId, {
                        autoModEnabled: newValue
                    });
                    break;

                case 'role_select':
                    newValue = i.values[0];
                    await interaction.client.moderationManager.updateServerSettings(interaction.guildId, {
                        adminRoleId: newValue
                    });
                    break;

                case 'log_channel_select':
                case 'report_channel_select':
                    newValue = i.values[0];
                    const settingKey = setting.split('_')[0] + 'ChannelId';
                    await interaction.client.moderationManager.updateServerSettings(interaction.guildId, {
                        [settingKey]: newValue
                    });
                    break;
            }

            // Update the settings display
            const updatedSettings = await interaction.client.moderationManager.getServerSettings(interaction.guildId);
            const updatedEmbed = interaction.client.moderationManager.generateSettingsEmbed(updatedSettings);
            const updatedButtonRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('settings_admin_role')
                        .setLabel('Set Admin Role')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('settings_log_channel')
                        .setLabel('Set Log Channel')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('settings_report_channel')
                        .setLabel('Set Report Channel')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('settings_toggle_automod')
                        .setLabel(updatedSettings.autoModEnabled ? 'Disable Auto-mod' : 'Enable Auto-mod')
                        .setStyle(updatedSettings.autoModEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
                );

            await i.update({
                embeds: [updatedEmbed],
                components: [row, updatedButtonRow]
            });
        });

        collector.on('end', () => {
            // Remove components when collector expires
            interaction.editReply({
                components: []
            }).catch(() => {});
        });
    }
}; 