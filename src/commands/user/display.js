const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');
const logger = require('../../utils/logger');
const { getRankEmoji, getRankColor } = require('../../utils/helpers');

module.exports = {
    category: 'user',
    data: new SlashCommandBuilder()
        .setName('display')
        .setDescription('Manage your badge display'),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const badgeDisplayManager = new (require('../../utils/badgeDisplayManager'))(interaction.client.db);
            
            // Get user's current display and available badges
            const [displayBadges, badgeData, layouts] = await Promise.all([
                badgeDisplayManager.getFullBadgeDisplay(interaction.user.id),
                badgeDisplayManager.getAvailableBadges(interaction.user.id),
                badgeDisplayManager.getLayouts(interaction.user.id)
            ]);

            const { categories, allBadges } = badgeData;

            // Create initial embed
            const embed = createDisplayEmbed(interaction.user, displayBadges, allBadges.length);

            // Create action buttons
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('view_all')
                        .setLabel('View All Badges')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📋'),
                    new ButtonBuilder()
                        .setCustomId('randomize')
                        .setLabel('Randomize')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🎲'),
                    new ButtonBuilder()
                        .setCustomId('save_layout')
                        .setLabel('Save Layout')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('💾'),
                    new ButtonBuilder()
                        .setCustomId('load_layout')
                        .setLabel('Load Layout')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📂')
                );

            // Create slot selection menu
            const slotMenu = new StringSelectMenuBuilder()
                .setCustomId('slot_select')
                .setPlaceholder('Select a slot to edit')
                .addOptions([
                    {
                        label: 'Slot 1',
                        description: displayBadges[0].badge ? displayBadges[0].badge.name : 'Empty',
                        value: '1',
                        emoji: '1️⃣'
                    },
                    {
                        label: 'Slot 2',
                        description: displayBadges[1].badge ? displayBadges[1].badge.name : 'Empty',
                        value: '2',
                        emoji: '2️⃣'
                    },
                    {
                        label: 'Slot 3',
                        description: displayBadges[2].badge ? displayBadges[2].badge.name : 'Empty',
                        value: '3',
                        emoji: '3️⃣'
                    }
                ]);

            const slotRow = new ActionRowBuilder().addComponents(slotMenu);

            // Send initial message
            const message = await interaction.editReply({
                embeds: [embed],
                components: [buttons, slotRow]
            });

            // Create collectors for all interactive components
            const collector = message.createMessageComponentCollector({
                componentType: [ComponentType.StringSelect, ComponentType.Button],
                time: 300000 // 5 minutes
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'This is not your display menu.', ephemeral: true });
                    return;
                }

                if (i.componentType === ComponentType.Button) {
                    await handleButtonInteraction(i, badgeDisplayManager, message, displayBadges, categories, layouts);
                } else {
                    await handleSlotSelection(i, badgeDisplayManager, message, displayBadges, categories);
                }
            });

            collector.on('end', () => {
                message.edit({
                    components: []
                }).catch(() => {});
            });

        } catch (error) {
            logger.error('Error in display command:', error);
            await interaction.editReply({
                content: 'An error occurred while managing your badge display.',
                embeds: [],
                components: []
            });
        }
    }
};

async function handleButtonInteraction(interaction, badgeDisplayManager, message, displayBadges, categories, layouts) {
    switch (interaction.customId) {
        case 'view_all':
            await showAllBadges(interaction, categories);
            break;
        case 'randomize':
            await randomizeDisplay(interaction, badgeDisplayManager, message);
            break;
        case 'save_layout':
            await saveLayout(interaction, badgeDisplayManager, message);
            break;
        case 'load_layout':
            await loadLayout(interaction, badgeDisplayManager, message, layouts);
            break;
    }
}

async function handleSlotSelection(interaction, badgeDisplayManager, message, displayBadges, categories) {
    const slot = parseInt(interaction.values[0]);

    // Create badge selection menu with categories
    const badgeOptions = [
        {
            label: 'Remove Badge',
            description: 'Clear this slot',
            value: 'remove',
            emoji: '❌'
        }
    ];

    // Add badges by category
    Object.entries(categories).forEach(([category, badges]) => {
        if (badges.length > 0) {
            badgeOptions.push({
                label: `${category.charAt(0).toUpperCase() + category.slice(1)} Badges`,
                value: `category_${category}`,
                emoji: getCategoryEmoji(category),
                description: `${badges.length} badges available`
            });
        }
    });

    const categoryMenu = new StringSelectMenuBuilder()
        .setCustomId('category_select')
        .setPlaceholder('Select a badge category')
        .addOptions(badgeOptions);

    const categoryRow = new ActionRowBuilder().addComponents(categoryMenu);

    await interaction.update({
        components: [categoryRow]
    });

    // Create collector for category selection
    const categoryCollector = message.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 300000
    });

    categoryCollector.on('collect', async (categoryInteraction) => {
        if (categoryInteraction.user.id !== interaction.user.id) {
            await categoryInteraction.reply({ content: 'This is not your display menu.', ephemeral: true });
            return;
        }

        const selectedValue = categoryInteraction.values[0];
        
        if (selectedValue === 'remove') {
            await updateBadgeDisplay(categoryInteraction, badgeDisplayManager, slot, null, message);
            categoryCollector.stop();
            return;
        }

        if (selectedValue.startsWith('category_')) {
            const category = selectedValue.replace('category_', '');
            const badges = categories[category];

            const badgeOptions = badges.map(badge => ({
                label: badge.name,
                description: `${badge.type}${badge.rarity ? ` • ${badge.rarity}` : ''}`,
                value: badge.badgeId,
                emoji: badge.emoji
            }));

            const badgeMenu = new StringSelectMenuBuilder()
                .setCustomId('badge_select')
                .setPlaceholder('Select a badge')
                .addOptions(badgeOptions);

            const badgeRow = new ActionRowBuilder().addComponents(badgeMenu);

            await categoryInteraction.update({
                components: [badgeRow]
            });

            // Create collector for badge selection
            const badgeCollector = message.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 300000
            });

            badgeCollector.on('collect', async (badgeInteraction) => {
                if (badgeInteraction.user.id !== interaction.user.id) {
                    await badgeInteraction.reply({ content: 'This is not your display menu.', ephemeral: true });
                    return;
                }

                await updateBadgeDisplay(badgeInteraction, badgeDisplayManager, slot, badgeInteraction.values[0], message);
                badgeCollector.stop();
            });

            badgeCollector.on('end', () => {
                if (message.components[0].components[0].customId === 'badge_select') {
                    message.edit({
                        components: [categoryRow]
                    }).catch(() => {});
                }
            });
        }
    });

    categoryCollector.on('end', () => {
        if (message.components[0].components[0].customId === 'category_select') {
            message.edit({
                components: [message.components[1]]
            }).catch(() => {});
        }
    });
}

async function updateBadgeDisplay(interaction, badgeDisplayManager, slot, badgeId, message) {
    const result = await badgeDisplayManager.updateBadgeDisplay(
        interaction.user.id,
        slot,
        badgeId
    );

    if (!result.success) {
        await interaction.reply({ 
            content: result.error, 
            ephemeral: true 
        });
        return;
    }

    const updatedDisplay = await badgeDisplayManager.getFullBadgeDisplay(interaction.user.id);
    const updatedEmbed = createDisplayEmbed(interaction.user, updatedDisplay);

    // Reset to slot selection menu
    const slotMenu = new StringSelectMenuBuilder()
        .setCustomId('slot_select')
        .setPlaceholder('Select a slot to edit')
        .addOptions([
            {
                label: 'Slot 1',
                description: updatedDisplay[0].badge ? updatedDisplay[0].badge.name : 'Empty',
                value: '1',
                emoji: '1️⃣'
            },
            {
                label: 'Slot 2',
                description: updatedDisplay[1].badge ? updatedDisplay[1].badge.name : 'Empty',
                value: '2',
                emoji: '2️⃣'
            },
            {
                label: 'Slot 3',
                description: updatedDisplay[2].badge ? updatedDisplay[2].badge.name : 'Empty',
                value: '3',
                emoji: '3️⃣'
            }
        ]);

    const slotRow = new ActionRowBuilder().addComponents(slotMenu);

    await interaction.update({
        embeds: [updatedEmbed],
        components: [message.components[0], slotRow]
    });
}

async function showAllBadges(interaction, categories) {
    const embed = new EmbedBuilder()
        .setColor(interaction.user.accentColor || '#00ff00')
        .setTitle(`${interaction.user.username}'s Badge Collection`)
        .setDescription('Your complete badge collection, organized by category:');

    Object.entries(categories).forEach(([category, badges]) => {
        if (badges.length > 0) {
            const badgeList = badges.map(badge => 
                `${badge.emoji} **${badge.name}**${badge.rarity ? ` (${badge.rarity})` : ''}\n` +
                `└ ${badge.description || 'No description'}\n` +
                `└ Unlocked: ${badge.unlockDate ? new Date(badge.unlockDate).toLocaleDateString() : 'Unknown'}`
            ).join('\n\n');

            embed.addFields({
                name: `${getCategoryEmoji(category)} ${category.charAt(0).toUpperCase() + category.slice(1)}`,
                value: badgeList || 'No badges in this category'
            });
        }
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function randomizeDisplay(interaction, badgeDisplayManager, message) {
    const result = await badgeDisplayManager.randomizeDisplay(interaction.user.id);
    
    if (!result.success) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
    }

    const updatedDisplay = await badgeDisplayManager.getFullBadgeDisplay(interaction.user.id);
    const updatedEmbed = createDisplayEmbed(interaction.user, updatedDisplay);

    await interaction.update({
        embeds: [updatedEmbed]
    });
}

async function saveLayout(interaction, badgeDisplayManager, message) {
    const modal = new ModalBuilder()
        .setCustomId('save_layout_modal')
        .setTitle('Save Badge Layout');

    const layoutNameInput = new TextInputBuilder()
        .setCustomId('layout_name')
        .setLabel('Layout Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter a name for this layout')
        .setRequired(true)
        .setMaxLength(32);

    const firstActionRow = new ActionRowBuilder().addComponents(layoutNameInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);

    try {
        const submitted = await interaction.awaitModalSubmit({
            time: 300000,
            filter: i => i.user.id === interaction.user.id
        });

        const layoutName = submitted.fields.getTextInputValue('layout_name');
        const result = await badgeDisplayManager.saveLayout(interaction.user.id, layoutName);

        if (!result.success) {
            await submitted.reply({ content: result.error, ephemeral: true });
            return;
        }

        await submitted.reply({ content: `Layout "${layoutName}" saved successfully!`, ephemeral: true });
    } catch (error) {
        // Modal was not submitted
    }
}

async function loadLayout(interaction, badgeDisplayManager, message, layouts) {
    if (layouts.length === 0) {
        await interaction.reply({ content: 'You have no saved layouts.', ephemeral: true });
        return;
    }

    const layoutOptions = layouts.map(layout => ({
        label: layout.name,
        description: `Created ${new Date(layout.createdAt).toLocaleDateString()}`,
        value: layout.name
    }));

    const layoutMenu = new StringSelectMenuBuilder()
        .setCustomId('layout_select')
        .setPlaceholder('Select a layout to load')
        .addOptions(layoutOptions);

    const layoutRow = new ActionRowBuilder().addComponents(layoutMenu);

    await interaction.update({
        components: [layoutRow]
    });

    const layoutCollector = message.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 300000
    });

    layoutCollector.on('collect', async (layoutInteraction) => {
        if (layoutInteraction.user.id !== interaction.user.id) {
            await layoutInteraction.reply({ content: 'This is not your display menu.', ephemeral: true });
            return;
        }

        const layoutName = layoutInteraction.values[0];
        const result = await badgeDisplayManager.loadLayout(interaction.user.id, layoutName);

        if (!result.success) {
            await layoutInteraction.reply({ content: result.error, ephemeral: true });
            return;
        }

        const updatedDisplay = await badgeDisplayManager.getFullBadgeDisplay(interaction.user.id);
        const updatedEmbed = createDisplayEmbed(interaction.user, updatedDisplay);

        await layoutInteraction.update({
            embeds: [updatedEmbed],
            components: [message.components[0], message.components[1]]
        });

        layoutCollector.stop();
    });

    layoutCollector.on('end', () => {
        if (message.components[0].components[0].customId === 'layout_select') {
            message.edit({
                components: [message.components[0], message.components[1]]
            }).catch(() => {});
        }
    });
}

function getCategoryEmoji(category) {
    const emojis = {
        achievement: '🏆',
        mastery: '⭐',
        challenge: '🎯',
        special: '🌟'
    };
    return emojis[category] || '📌';
}

function createDisplayEmbed(user, displayBadges, totalBadges) {
    const embed = new EmbedBuilder()
        .setColor(getRankColor(user.rep))
        .setTitle(`${user.username}'s Badge Display`)
        .setThumbnail(user.displayAvatarURL({ size: 1024 }))
        .setDescription(`Select a slot to edit your badge display.\nTotal Badges: ${totalBadges}`)
        .addFields({
            name: 'Current Display',
            value: displayBadges.map(d => 
                `${d.slot === 1 ? '1️⃣' : d.slot === 2 ? '2️⃣' : '3️⃣'} ` +
                (d.badge ? 
                    `${d.badge.emoji} **${d.badge.name}**\n` +
                    `└ ${d.badge.type}${d.badge.rarity ? ` • ${d.badge.rarity}` : ''}` : 
                    'Empty')
            ).join('\n\n')
        })
        .setFooter({ text: 'Select a slot to edit your display' })
        .setTimestamp();

    return embed;
} 