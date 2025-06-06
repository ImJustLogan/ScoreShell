const logger = require('../utils/logger');
const { InteractionType, InteractionResponseType, Events } = require('discord.js');

// Track command usage and timeouts
const commandTimeouts = new Map();
const COMMAND_TIMEOUT = 300000; // 5 minutes

// Track command usage
async function trackCommandUsage(interaction, success) {
    try {
        const commandName = interaction.commandName;
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const timestamp = new Date();

        await interaction.client.db.collection('commandUsage').insertOne({
            commandName,
            userId,
            guildId,
            timestamp,
            success,
            options: interaction.options.data
        });
    } catch (error) {
        logger.error('Error tracking command usage:', error);
    }
}

// Handle interaction timeout
function handleInteractionTimeout(interaction) {
    const timeoutId = setTimeout(async () => {
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'This command is taking longer than expected. Please try again later.',
                    ephemeral: true
                });
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({
                    content: 'This command is taking longer than expected. Please try again later.'
                });
            }
            commandTimeouts.delete(interaction.id);
            await trackCommandUsage(interaction, false);
        } catch (error) {
            logger.error('Error handling interaction timeout:', error);
        }
    }, COMMAND_TIMEOUT);

    commandTimeouts.set(interaction.id, timeoutId);
}

// Clean up interaction timeout
function cleanupInteractionTimeout(interaction) {
    const timeoutId = commandTimeouts.get(interaction.id);
    if (timeoutId) {
        clearTimeout(timeoutId);
        commandTimeouts.delete(interaction.id);
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing ${interaction.commandName}`);
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            // Handle setup role selection
            if (interaction.customId === 'setup_admin_role') {
                const setupManager = interaction.client.setupManager;
                if (setupManager) {
                    await setupManager.handleRoleSelection(interaction);
                }
            }
        } else if (interaction.isButton()) {
            const setupManager = interaction.client.setupManager;
            if (!setupManager) return;

            switch (interaction.customId) {
                case 'setup_confirm_name':
                    await setupManager.handleCommunityCode(interaction);
                    break;
                case 'setup_edit_name':
                    // TODO: Implement modal for name editing
                    break;
                case 'setup_enable_logging':
                    setupManager.activeSetups.get(interaction.guild.id).data.logMatches = true;
                    await setupManager.completeSetup(interaction);
                    break;
                case 'setup_disable_logging':
                    setupManager.activeSetups.get(interaction.guild.id).data.logMatches = false;
                    await setupManager.completeSetup(interaction);
                    break;
                case 'setup_cancel':
                    await setupManager.cancelSetup(interaction);
                    break;
            }
        } else if (interaction.isModalSubmit()) {
            // Handle community code submission
            if (interaction.customId === 'setup_community_code') {
                const code = interaction.fields.getTextInputValue('community_code');
                const setupManager = interaction.client.setupManager;
                if (setupManager) {
                    await setupManager.validateCommunityCode(interaction, code);
                }
            }
        } else {
            try {
                // Handle different interaction types
                switch (interaction.type) {
                    case InteractionType.ApplicationCommand:
                        await handleSlashCommand(interaction, interaction.client);
                        break;
                    case InteractionType.MessageComponent:
                        await handleComponentInteraction(interaction, interaction.client);
                        break;
                    case InteractionType.ModalSubmit:
                        await handleModalSubmit(interaction, interaction.client);
                        break;
                    default:
                        logger.warn(`Unhandled interaction type: ${interaction.type}`);
                }
            } catch (error) {
                logger.error('Error handling interaction:', error);
                await handleInteractionError(interaction, error);
            }
        }
    }
};

async function handleSlashCommand(interaction, client) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
        logger.warn(`No command matching ${interaction.commandName} was found.`);
        return await interaction.reply({
            content: 'This command is not available.',
            ephemeral: true
        });
    }

    try {
        // Set up timeout
        handleInteractionTimeout(interaction);

        // Check cooldown
        const cooldownTime = client.checkCooldown(command, interaction.user.id, client.cooldowns);
        if (cooldownTime) {
            return await interaction.reply({
                content: `Please wait ${cooldownTime.toFixed(1)} more seconds before using this command again.`,
                ephemeral: true
            });
        }

        // Check permissions
        const hasPermission = await client.checkPermissions(command, interaction);
        if (!hasPermission) return;

        // Defer reply for commands that might take longer
        if (command.deferReply !== false) {
            await interaction.deferReply({ ephemeral: command.ephemeral !== false });
        }

        // Execute the command
        await command.execute(interaction);
        await trackCommandUsage(interaction, true);
    } catch (error) {
        logger.error(`Error executing ${interaction.commandName}:`, error);
        await handleInteractionError(interaction, error);
        await trackCommandUsage(interaction, false);
    } finally {
        cleanupInteractionTimeout(interaction);
    }
}

async function handleComponentInteraction(interaction, client) {
    try {
        // Set up timeout
        handleInteractionTimeout(interaction);

        // Handle different component types
        switch (interaction.componentType) {
            case 'BUTTON':
                await handleButtonInteraction(interaction, client);
                break;
            case 'SELECT_MENU':
                await handleSelectMenuInteraction(interaction, client);
                break;
            default:
                logger.warn(`Unhandled component type: ${interaction.componentType}`);
        }
    } catch (error) {
        logger.error('Error handling component interaction:', error);
        await handleInteractionError(interaction, error);
    } finally {
        cleanupInteractionTimeout(interaction);
    }
}

async function handleModalSubmit(interaction, client) {
    try {
        // Set up timeout
        handleInteractionTimeout(interaction);

        // Handle modal submission
        const modalId = interaction.customId;
        const handler = client.modalHandlers?.get(modalId);
        
        if (handler) {
            await handler(interaction);
        } else {
            logger.warn(`No handler found for modal: ${modalId}`);
            await interaction.reply({
                content: 'This form submission could not be processed.',
                ephemeral: true
            });
        }
    } catch (error) {
        logger.error('Error handling modal submission:', error);
        await handleInteractionError(interaction, error);
    } finally {
        cleanupInteractionTimeout(interaction);
    }
}

async function handleButtonInteraction(interaction, client) {
    const buttonId = interaction.customId;
    const handler = client.buttonHandlers?.get(buttonId);
    
    if (handler) {
        await handler(interaction);
    } else {
        logger.warn(`No handler found for button: ${buttonId}`);
        await interaction.reply({
            content: 'This button interaction could not be processed.',
            ephemeral: true
        });
    }
}

async function handleSelectMenuInteraction(interaction, client) {
    const menuId = interaction.customId;
    const handler = client.selectMenuHandlers?.get(menuId);
    
    if (handler) {
        await handler(interaction);
    } else {
        logger.warn(`No handler found for select menu: ${menuId}`);
        await interaction.reply({
            content: 'This menu selection could not be processed.',
            ephemeral: true
        });
    }
}

async function handleInteractionError(interaction, error) {
    const errorMessage = {
        content: 'There was an error while executing this command!',
        ephemeral: true
    };

    try {
        if (interaction.replied) {
            await interaction.followUp(errorMessage);
        } else if (interaction.deferred) {
            await interaction.editReply(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } catch (replyError) {
        logger.error('Error sending error message:', replyError);
    }
} 