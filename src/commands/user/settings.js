const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const logger = require('../../utils/logger');

// Region flags mapping (same as in rank.js)
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
        .setName('settings')
        .setDescription('Manage your ScoreShell settings'),

    async execute(interaction) {
        try {
            // Get user's current settings
            const userData = await interaction.client.db.collection('users').findOne({
                discordId: interaction.user.id
            }) || { settings: {} };

            // Create duel requests setting embed
            const duelRequestsEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Duel Requests')
                .setDescription('Allow other players to challenge you to duels.')
                .addFields({
                    name: 'Current Setting',
                    value: userData.settings?.duelRequestsDisabled ? 
                        '❌ Duel requests are disabled' : 
                        '✅ Duel requests are enabled',
                    inline: false
                });

            const duelRequestsButton = new ButtonBuilder()
                .setCustomId('toggle_duel_requests')
                .setLabel(userData.settings?.duelRequestsDisabled ? 'Enable Duel Requests' : 'Disable Duel Requests')
                .setStyle(userData.settings?.duelRequestsDisabled ? ButtonStyle.Success : ButtonStyle.Danger);

            const duelRequestsRow = new ActionRowBuilder()
                .addComponents(duelRequestsButton);

            // Create main community setting embed
            const mainCommunityEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Main Community')
                .setDescription('Set your main community for your player card. By default, this is the server you use ScoreShell in the most.');

            // Get all servers user is in with ScoreShell
            const userServers = await interaction.client.db.collection('servers').find({
                guildId: { $in: interaction.client.guilds.cache.map(g => g.id) }
            }).toArray();

            const mainCommunitySelect = new StringSelectMenuBuilder()
                .setCustomId('select_main_community')
                .setPlaceholder('Select your main community')
                .addOptions([
                    {
                        label: 'Default (Most Active)',
                        description: 'Let ScoreShell decide based on your activity',
                        value: 'default',
                        default: !userData.mainCommunity
                    },
                    ...userServers.map(server => ({
                        label: server.name,
                        description: `Community Code: ${server.communityCode}`,
                        value: server.guildId,
                        default: userData.mainCommunity === server.guildId
                    }))
                ]);

            const mainCommunityRow = new ActionRowBuilder()
                .addComponents(mainCommunitySelect);

            // Create region setting embed
            const regionEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Region')
                .setDescription('Set your region for matchmaking and leaderboards.')
                .addFields({
                    name: 'Current Region',
                    value: `${REGION_FLAGS[userData.region] || '🌎'} ${userData.region || 'Not set'}`,
                    inline: false
                });

            const regionSelect = new StringSelectMenuBuilder()
                .setCustomId('select_region')
                .setPlaceholder('Select your region')
                .addOptions(Object.entries(REGION_FLAGS).map(([region, flag]) => ({
                    label: region,
                    description: `Region flag: ${flag}`,
                    value: region,
                    default: userData.region === region
                })));

            const regionRow = new ActionRowBuilder()
                .addComponents(regionSelect);

            // Send all settings embeds
            await interaction.reply({
                embeds: [duelRequestsEmbed, mainCommunityEmbed, regionEmbed],
                components: [duelRequestsRow, mainCommunityRow, regionRow]
            });

            // Create collectors for all interactive components
            const message = await interaction.fetchReply();
            const collector = message.createMessageComponentCollector({
                time: 300000 // 5 minutes
            });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({
                        content: 'Only the command user can use these settings.',
                        ephemeral: true
                    });
                }

                if (i.customId === 'toggle_duel_requests') {
                    // Toggle duel requests setting
                    const newSetting = !userData.settings?.duelRequestsDisabled;
                    await interaction.client.db.collection('users').updateOne(
                        { discordId: interaction.user.id },
                        { 
                            $set: { 
                                'settings.duelRequestsDisabled': newSetting,
                                updatedAt: new Date()
                            },
                            $setOnInsert: { createdAt: new Date() }
                        },
                        { upsert: true }
                    );

                    // Update button and embed
                    duelRequestsButton
                        .setLabel(newSetting ? 'Disable Duel Requests' : 'Enable Duel Requests')
                        .setStyle(newSetting ? ButtonStyle.Danger : ButtonStyle.Success);

                    duelRequestsEmbed.setFields({
                        name: 'Current Setting',
                        value: newSetting ? 
                            '✅ Duel requests are enabled' : 
                            '❌ Duel requests are disabled',
                        inline: false
                    });

                    await i.update({
                        embeds: [duelRequestsEmbed, mainCommunityEmbed, regionEmbed],
                        components: [duelRequestsRow, mainCommunityRow, regionRow]
                    });

                } else if (i.customId === 'select_main_community') {
                    const selectedValue = i.values[0];
                    
                    // Update main community
                    await interaction.client.db.collection('users').updateOne(
                        { discordId: interaction.user.id },
                        { 
                            $set: { 
                                mainCommunity: selectedValue === 'default' ? null : selectedValue,
                                updatedAt: new Date()
                            },
                            $setOnInsert: { createdAt: new Date() }
                        },
                        { upsert: true }
                    );

                    // Update select menu
                    mainCommunitySelect.options.forEach(option => {
                        option.setDefault(option.data.value === selectedValue);
                    });

                    await i.update({
                        embeds: [duelRequestsEmbed, mainCommunityEmbed, regionEmbed],
                        components: [duelRequestsRow, mainCommunityRow, regionRow]
                    });

                } else if (i.customId === 'select_region') {
                    const selectedRegion = i.values[0];
                    
                    // Update region
                    await interaction.client.db.collection('users').updateOne(
                        { discordId: interaction.user.id },
                        { 
                            $set: { 
                                region: selectedRegion,
                                updatedAt: new Date()
                            },
                            $setOnInsert: { createdAt: new Date() }
                        },
                        { upsert: true }
                    );

                    // Update region embed
                    regionEmbed.setFields({
                        name: 'Current Region',
                        value: `${REGION_FLAGS[selectedRegion]} ${selectedRegion}`,
                        inline: false
                    });

                    // Update select menu
                    regionSelect.options.forEach(option => {
                        option.setDefault(option.data.value === selectedRegion);
                    });

                    await i.update({
                        embeds: [duelRequestsEmbed, mainCommunityEmbed, regionEmbed],
                        components: [duelRequestsRow, mainCommunityRow, regionRow]
                    });
                }
            });

            collector.on('end', () => {
                if (!message.deleted) {
                    message.edit({
                        components: []
                    }).catch(() => {});
                }
            });

        } catch (error) {
            logger.error('Error in settings command:', error);
            return interaction.reply({
                content: 'An error occurred while managing your settings.',
                ephemeral: true
            });
        }
    }
}; 