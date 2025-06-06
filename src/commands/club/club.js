const { 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    EmbedBuilder
} = require('discord.js');

// Club icons with their emoji IDs and image URLs
const CLUB_ICONS = {
    RED: {
        emoji: '1340463594055139328',
        image: 'https://i.imgur.com/sy8o63Y.png'
    },
    BLUE: {
        emoji: '1340464817428758558',
        image: 'https://i.imgur.com/2jH5dQU.png'
    },
    YELLOW: {
        emoji: '1340464843576049774',
        image: 'https://i.imgur.com/nywWQyZ.png'
    },
    GREEN: {
        emoji: '1340464944126230598',
        image: 'https://i.imgur.com/JnBP5ro.png'
    },
    PINK: {
        emoji: '1340464971741528084',
        image: 'https://i.imgur.com/ToavyvN.png'
    },
    CYAN: {
        emoji: '1340465007598764124',
        image: 'https://i.imgur.com/81HXsR8.png'
    }
};

// Club privacy types
const PRIVACY_TYPES = {
    OPEN: 'Open',
    APPLICATION: 'Application Needed',
    INVITE: 'Invite Only'
};

module.exports = {
    category: 'club',
    CLUB_ICONS,
    PRIVACY_TYPES,
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('Club management commands')
        // Create subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new club')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of your club')
                        .setRequired(true)
                        .setMaxLength(32))
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('A unique identifier for your club (3-5 characters, letters and numbers only)')
                        .setRequired(true)
                        .setMinLength(3)
                        .setMaxLength(5)))
        // Info subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('View detailed information about a club')
                .addStringOption(option =>
                    option
                        .setName('club_id')
                        .setDescription('The ID of the club to view')
                        .setRequired(false))
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('View the club of a specific user')
                        .setRequired(false)))
        // Settings subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('settings')
                .setDescription('Manage your club settings (Club Owner only)'))
        // Invite subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('invite')
                .setDescription('Invite a player to join your club')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to invite')
                        .setRequired(true)))
        // Accept subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('accept')
                .setDescription('Accept a pending club invitation'))
        // Leave subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('leave')
                .setDescription('Leave your current club'))
        // Kick subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('kick')
                .setDescription('Remove a member from your club (Club Owner or Captain only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The member to remove from the club')
                        .setRequired(true)))
        // Apply subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('apply')
                .setDescription('Apply to join a club that requires approval')
                .addStringOption(option =>
                    option
                        .setName('club_id')
                        .setDescription('The ID of the club you want to join')
                        .setRequired(true)))
        // Approve subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('approve')
                .setDescription('Approve a pending application (Club Owner or Captain only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user to approve')
                        .setRequired(true)))
        // Deny subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('deny')
                .setDescription('Deny a pending application (Club Owner or Captain only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user to deny')
                        .setRequired(true)))
        // Promote subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('promote')
                .setDescription('Promote a member to Club Captain (Club Owner only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The member to promote')
                        .setRequired(true)))
        // Demote subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('demote')
                .setDescription('Remove Club Captain status from a member (Club Owner only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The member to demote')
                        .setRequired(true)))
        // Disband subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('disband')
                .setDescription('Disband your club (Club Owner only)')),

    async execute(interaction) {
        // This is handled by the index.js file which loads subcommands
        await interaction.reply({
            content: 'This command is handled by subcommands.',
            ephemeral: true
        });
    }
}; 