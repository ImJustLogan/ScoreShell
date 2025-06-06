const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AuditLogEvent
} = require('discord.js');
const Community = require('../models/Community');
const logger = require('./logger');

// Add new constants at the top of the class
const RESERVED_CODES = [
    'ADMIN', 'MOD', 'BOT', 'OWNER', 'STAFF', 'HELP', 'SUPPORT',
    'RANKED', 'QUEUE', 'MATCH', 'CHALLENGE', 'CLUB', 'LEAGUE',
    'SCORE', 'SHELL', 'SLUGGERS', 'MARIO', 'BASEBALL', 'GAME'
];

const INAPPROPRIATE_WORDS = [
    // Add a list of inappropriate words to filter
    'BAD', 'WORD', 'LIST' // Replace with actual list
];

const CODE_ATTEMPT_LIMIT = 5;
const CODE_ATTEMPT_WINDOW = 3600000; // 1 hour

class SetupManager {
    constructor(client) {
        this.client = client;
        this.activeSetups = new Map(); // Map of guildId to setup state
        this.logger = logger;
        this.codeAttempts = new Map(); // Track code attempt frequency
        this.inviteLinks = new Map(); // Track active invite links
    }

    async startSetup(interaction) {
        const { guild, member } = interaction;

        // Check if setup is already in progress
        if (this.activeSetups.has(guild.id)) {
            return interaction.reply({
                content: 'Setup is already in progress. Please wait for it to complete or cancel it.',
                ephemeral: true
            });
        }

        // Check if community already exists
        const existingCommunity = await Community.findOne({ guildId: guild.id });
        if (existingCommunity?.settings.setupComplete) {
            return interaction.reply({
                content: 'This server has already been set up. Use /mod settings to modify settings.',
                ephemeral: true
            });
        }

        // Check for required permissions
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: 'You need Administrator permissions to run setup.',
                ephemeral: true
            });
        }

        // Initialize setup state
        this.activeSetups.set(guild.id, {
            step: 'PERMISSIONS',
            data: {}
        });

        // Start with permission check
        await this.checkPermissions(interaction);
    }

    async checkPermissions(interaction) {
        const { guild } = interaction;
        const botMember = guild.members.cache.get(this.client.user.id);

        const requiredPermissions = [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ViewChannel
        ];

        const missingPermissions = requiredPermissions.filter(
            perm => !botMember.permissions.has(perm)
        );

        if (missingPermissions.length > 0) {
            this.activeSetups.delete(guild.id);
            return interaction.reply({
                content: `I'm missing the following permissions: ${missingPermissions.join(', ')}. Please grant these permissions and try again.`,
                ephemeral: true
            });
        }

        // Move to role selection
        await this.selectAdminRole(interaction);
    }

    async selectAdminRole(interaction) {
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);
        setupState.step = 'ROLE_SELECTION';

        const roles = guild.roles.cache
            .filter(role => role.id !== guild.id && !role.managed)
            .sort((a, b) => b.position - a.position);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('setup_admin_role')
            .setPlaceholder('Select admin role')
            .addOptions(roles.map(role => ({
                label: role.name,
                value: role.id,
                description: `Members with this role will have admin permissions`
            })));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('Setup: Admin Role Selection')
            .setDescription('Select the role that will have admin permissions for ScoreShell.')
            .setColor('#0099ff');

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    async handleRoleSelection(interaction) {
        const { guild, values } = interaction;
        const setupState = this.activeSetups.get(guild.id);
        setupState.data.adminRoleId = values[0];

        // Create category and channels
        await this.createChannels(interaction);
    }

    async createChannels(interaction) {
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);
        setupState.step = 'CHANNEL_CREATION';

        try {
            // Create category with enhanced permissions
            const category = await guild.channels.create({
                name: 'Sluggers ranked',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: setupState.data.adminRoleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageMessages
                        ]
                    },
                    {
                        id: this.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageMessages
                        ]
                    }
                ]
            });

            // Create channels with specific permissions
            const [rankedRules, rankedQueue, adminLog] = await Promise.all([
                guild.channels.create({
                    name: 'ranked-rules',
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.SendMessages]
                        },
                        {
                            id: setupState.data.adminRoleId,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        }
                    ]
                }),
                guild.channels.create({
                    name: '1v1-ranked',
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        },
                        {
                            id: setupState.data.adminRoleId,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.ManageMessages
                            ]
                        }
                    ]
                }),
                guild.channels.create({
                    name: 'admin-log',
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: setupState.data.adminRoleId,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        },
                        {
                            id: this.client.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.EmbedLinks,
                                PermissionFlagsBits.AttachFiles,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        }
                    ]
                })
            ]);

            // Log channel creation
            this.logger.info('Channels created', {
                guildId: guild.id,
                categoryId: category.id,
                channels: {
                    rankedRules: rankedRules.id,
                    rankedQueue: rankedQueue.id,
                    adminLog: adminLog.id
                }
            });

            setupState.data.channels = {
                rankedRules: rankedRules.id,
                rankedQueue: rankedQueue.id,
                adminLog: adminLog.id
            };
            setupState.data.categories = {
                ranked: category.id
            };

            // Post enhanced rules embed
            const rulesEmbed = new EmbedBuilder()
                .setTitle('ScoreShell Ranked Rules')
                .setDescription('Welcome to ScoreShell Ranked! Here are the rules and guidelines:')
                .addFields(
                    { 
                        name: 'Match Format', 
                        value: '• Standard: Star Moves on, 7 innings, items on, mercy on\n• Bingo: Special format with bingo cards (see /help bingo)' 
                    },
                    { 
                        name: 'Match Conduct', 
                        value: '• Be respectful to your opponents\n• No intentional disconnections\n• Report scores accurately\n• Follow Discord ToS' 
                    },
                    { 
                        name: 'Disconnections', 
                        value: '• Players lose if they disconnect during pre-game\n• If both players disconnect, match is cancelled\n• Server issues result in 50 rep compensation' 
                    },
                    { 
                        name: 'Score Reporting', 
                        value: '• Both players must report scores within 1.5 hours\n• Use /outcome to report scores\n• Disputed scores are reviewed by moderators' 
                    },
                    { 
                        name: 'Ranked Points', 
                        value: '• Win matches to earn reputation points\n• Points gained/lost based on opponent rank\n• Win streaks increase points earned\n• Hypercharge matches give bonus points' 
                    }
                )
                .setColor('#0099ff')
                .setFooter({ text: 'ScoreShell Ranked System' });

            await rankedRules.send({ embeds: [rulesEmbed] });

            // Move to community name confirmation
            await this.confirmCommunityName(interaction);
        } catch (error) {
            this.logger.error('Error creating channels:', {
                error,
                guildId: guild.id,
                setupState: setupState.data
            });
            
            // Attempt to clean up any created channels
            try {
                const category = guild.channels.cache.get(setupState.data.categories?.ranked);
                if (category) {
                    await Promise.all(
                        category.children.cache.map(channel => channel.delete())
                    );
                    await category.delete();
                }
            } catch (cleanupError) {
                this.logger.error('Error cleaning up channels:', {
                    error: cleanupError,
                    guildId: guild.id
                });
            }

            this.activeSetups.delete(guild.id);
            await interaction.reply({
                content: 'An error occurred while creating channels. Please ensure the bot has the necessary permissions and try again.',
                ephemeral: true
            });
        }
    }

    async confirmCommunityName(interaction) {
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);
        setupState.step = 'COMMUNITY_NAME';
        setupState.data.name = guild.name;

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_confirm_name')
                    .setLabel('Confirm')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('setup_edit_name')
                    .setLabel('Edit Name')
                    .setStyle(ButtonStyle.Secondary)
            );

        const embed = new EmbedBuilder()
            .setTitle('Setup: Community Name')
            .setDescription(`Is "${guild.name}" the name you want to use for your community?`)
            .setColor('#0099ff');

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    async handleCommunityCode(interaction) {
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);
        setupState.step = 'COMMUNITY_CODE';

        const modal = new ModalBuilder()
            .setCustomId('setup_community_code')
            .setTitle('Community Code');

        const codeInput = new TextInputBuilder()
            .setCustomId('community_code')
            .setLabel('Enter a 3-5 letter community code')
            .setPlaceholder('e.g., MSL, SSB, etc.')
            .setMinLength(3)
            .setMaxLength(5)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(codeInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
    }

    async validateCommunityCode(interaction, code) {
        const { guild, user } = interaction;
        const setupState = this.activeSetups.get(guild.id);

        // Track code attempts
        const userAttempts = this.codeAttempts.get(user.id) || [];
        const now = Date.now();
        const recentAttempts = userAttempts.filter(time => now - time < CODE_ATTEMPT_WINDOW);
        
        if (recentAttempts.length >= CODE_ATTEMPT_LIMIT) {
            this.logger.warn('Too many code attempts', { 
                userId: user.id,
                guildId: guild.id,
                attempts: recentAttempts.length
            });
            return interaction.reply({
                content: 'Too many code attempts. Please try again later.',
                ephemeral: true
            });
        }

        // Enhanced validation
        if (!/^[a-zA-Z0-9]{3,5}$/.test(code)) {
            this.logCodeAttempt(user.id, false);
            this.logger.warn('Invalid community code format', { 
                code,
                guildId: guild.id,
                userId: user.id
            });
            return interaction.reply({
                content: 'Invalid code format. Please use 3-5 letters and numbers only.',
                ephemeral: true
            });
        }

        const upperCode = code.toUpperCase();

        // Check for reserved codes
        if (RESERVED_CODES.includes(upperCode)) {
            this.logCodeAttempt(user.id, false);
            this.logger.warn('Attempted to use reserved code', { 
                code: upperCode,
                guildId: guild.id,
                userId: user.id
            });
            return interaction.reply({
                content: 'This code is reserved and cannot be used.',
                ephemeral: true
            });
        }

        // Check for inappropriate words
        if (INAPPROPRIATE_WORDS.some(word => upperCode.includes(word))) {
            this.logCodeAttempt(user.id, false);
            this.logger.warn('Attempted to use inappropriate code', { 
                code: upperCode,
                guildId: guild.id,
                userId: user.id
            });
            return interaction.reply({
                content: 'This code contains inappropriate content. Please choose another.',
                ephemeral: true
            });
        }

        // Check for existing code
        const existingCommunity = await Community.findOne({ code: upperCode });
        if (existingCommunity) {
            this.logCodeAttempt(user.id, false);
            this.logger.warn('Duplicate community code attempt', { 
                code: upperCode,
                guildId: guild.id,
                userId: user.id,
                existingGuildId: existingCommunity.guildId
            });
            return interaction.reply({
                content: 'This community code is already taken. Please choose another.',
                ephemeral: true
            });
        }

        this.logCodeAttempt(user.id, true);
        setupState.data.code = upperCode;
        this.logger.info('Community code validated', { 
            code: upperCode,
            guildId: guild.id,
            userId: user.id
        });
        await this.createInviteLink(interaction);
    }

    logCodeAttempt(userId, success) {
        const attempts = this.codeAttempts.get(userId) || [];
        attempts.push(Date.now());
        this.codeAttempts.set(userId, attempts);
        
        this.logger.info('Code attempt logged', {
            userId,
            success,
            totalAttempts: attempts.length
        });
    }

    async createInviteLink(interaction) {
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);
        setupState.step = 'INVITE_LINK';

        try {
            // Create a permanent invite with enhanced settings
            const invite = await guild.channels.cache
                .get(setupState.data.channels.rankedQueue)
                .createInvite({
                    maxAge: 0,
                    maxUses: 0,
                    unique: true,
                    reason: 'ScoreShell community setup',
                    temporary: false
                });

            // Track invite link
            this.inviteLinks.set(guild.id, {
                code: invite.code,
                createdAt: Date.now(),
                createdBy: interaction.user.id,
                uses: 0
            });

            // Log invite creation with enhanced details
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.InviteCreate,
                limit: 1
            });
            const inviteLog = auditLogs.entries.first();
            
            if (inviteLog) {
                this.logger.info('Invite created with enhanced tracking', {
                    guildId: guild.id,
                    inviteCode: invite.code,
                    createdBy: inviteLog.executor.id,
                    channelId: setupState.data.channels.rankedQueue,
                    timestamp: Date.now()
                });
            }

            // Store invite link with metadata
            setupState.data.inviteLink = {
                url: invite.url,
                code: invite.code,
                createdAt: Date.now(),
                createdBy: interaction.user.id
            };

            // Set up invite tracking
            this.client.on('inviteCreate', this.handleInviteCreate.bind(this));
            this.client.on('inviteDelete', this.handleInviteDelete.bind(this));
            this.client.on('guildMemberAdd', this.handleMemberJoin.bind(this));

            await this.confirmMatchLogging(interaction);
        } catch (error) {
            this.logger.error('Error creating invite:', {
                error,
                guildId: guild.id,
                channelId: setupState.data.channels.rankedQueue
            });
            
            // Attempt to recover by creating invite in a different channel
            try {
                const fallbackChannel = guild.channels.cache
                    .find(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me).has(PermissionFlagsBits.CreateInstantInvite));
                
                if (fallbackChannel) {
                    const invite = await fallbackChannel.createInvite({
                        maxAge: 0,
                        maxUses: 0,
                        unique: true,
                        reason: 'ScoreShell community setup (fallback)'
                    });
                    
                    setupState.data.inviteLink = invite.url;
                    this.logger.info('Created fallback invite', {
                        guildId: guild.id,
                        channelId: fallbackChannel.id,
                        inviteCode: invite.code
                    });
                    
                    await this.confirmMatchLogging(interaction);
                    return;
                }
            } catch (fallbackError) {
                this.logger.error('Fallback invite creation failed:', {
                    error: fallbackError,
                    guildId: guild.id
                });
            }

            this.activeSetups.delete(guild.id);
            await interaction.reply({
                content: 'An error occurred while creating the invite link. Please ensure the bot has permission to create invites and try again.',
                ephemeral: true
            });
        }
    }

    async handleInviteCreate(invite) {
        const guildId = invite.guild.id;
        const trackedInvite = this.inviteLinks.get(guildId);
        
        if (trackedInvite && trackedInvite.code === invite.code) {
            this.logger.info('Tracked invite modified', {
                guildId,
                inviteCode: invite.code,
                newUses: invite.uses,
                newMaxUses: invite.maxUses
            });
        }
    }

    async handleInviteDelete(invite) {
        const guildId = invite.guild.id;
        const trackedInvite = this.inviteLinks.get(guildId);
        
        if (trackedInvite && trackedInvite.code === invite.code) {
            this.logger.warn('Tracked invite deleted', {
                guildId,
                inviteCode: invite.code,
                deletedAt: Date.now()
            });
            
            // Create new invite if this was the main community invite
            const community = await Community.findOne({ guildId });
            if (community && community.inviteLink.code === invite.code) {
                await this.rotateInviteLink(guildId);
            }
        }
    }

    async handleMemberJoin(member) {
        const guildId = member.guild.id;
        const trackedInvite = this.inviteLinks.get(guildId);
        
        if (trackedInvite) {
            const invites = await member.guild.invites.fetch();
            const usedInvite = invites.find(inv => 
                inv.uses > (trackedInvite.uses || 0)
            );
            
            if (usedInvite && usedInvite.code === trackedInvite.code) {
                trackedInvite.uses = usedInvite.uses;
                this.logger.info('Tracked invite used', {
                    guildId,
                    inviteCode: usedInvite.code,
                    userId: member.id,
                    totalUses: usedInvite.uses
                });
            }
        }
    }

    async rotateInviteLink(guildId) {
        try {
            const community = await Community.findOne({ guildId });
            if (!community) return;

            const guild = this.client.guilds.cache.get(guildId);
            const channel = guild.channels.cache.get(community.channels.rankedQueue);
            
            // Create new invite
            const newInvite = await channel.createInvite({
                maxAge: 0,
                maxUses: 0,
                unique: true,
                reason: 'ScoreShell invite rotation'
            });

            // Update tracking
            this.inviteLinks.set(guildId, {
                code: newInvite.code,
                createdAt: Date.now(),
                uses: 0
            });

            // Update community
            community.inviteLink = {
                url: newInvite.url,
                code: newInvite.code,
                createdAt: Date.now(),
                rotatedAt: Date.now()
            };
            await community.save();

            this.logger.info('Invite link rotated', {
                guildId,
                oldCode: community.inviteLink.code,
                newCode: newInvite.code
            });
        } catch (error) {
            this.logger.error('Error rotating invite link', {
                error,
                guildId
            });
        }
    }

    async confirmMatchLogging(interaction) {
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);
        setupState.step = 'MATCH_LOGGING';

        const embed = new EmbedBuilder()
            .setTitle('Setup: Match Logging Configuration')
            .setDescription('Configure how matches are logged in your server.')
            .addFields(
                {
                    name: 'Match Logging Options',
                    value: '• **Basic Logging**: Only logs match outcomes and disputes\n• **Detailed Logging**: Includes player stats, stage bans, and captain picks\n• **Full Logging**: Includes all match details and chat logs'
                },
                {
                    name: 'Log Retention',
                    value: '• **30 Days**: Logs are kept for 30 days\n• **90 Days**: Logs are kept for 90 days\n• **Permanent**: Logs are kept indefinitely'
                },
                {
                    name: 'Additional Features',
                    value: '• **Export Logs**: Export match logs as CSV\n• **Auto-Archive**: Automatically archive old logs\n• **Mod Notifications**: Notify mods of disputes'
                }
            )
            .setColor('#0099ff');

        const loggingRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('setup_logging_level')
                    .setPlaceholder('Select logging level')
                    .addOptions([
                        {
                            label: 'Basic Logging',
                            description: 'Only logs match outcomes and disputes',
                            value: 'basic',
                            emoji: '📝'
                        },
                        {
                            label: 'Detailed Logging',
                            description: 'Includes player stats and match details',
                            value: 'detailed',
                            emoji: '📊'
                        },
                        {
                            label: 'Full Logging',
                            description: 'Includes all match details and chat logs',
                            value: 'full',
                            emoji: '📋'
                        }
                    ])
            );

        const retentionRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('setup_log_retention')
                    .setPlaceholder('Select log retention period')
                    .addOptions([
                        {
                            label: '30 Days',
                            description: 'Logs are kept for 30 days',
                            value: '30',
                            emoji: '🗑️'
                        },
                        {
                            label: '90 Days',
                            description: 'Logs are kept for 90 days',
                            value: '90',
                            emoji: '🗑️'
                        },
                        {
                            label: 'Permanent',
                            description: 'Logs are kept indefinitely',
                            value: 'permanent',
                            emoji: '💾'
                        }
                    ])
            );

        const featuresRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_logging_export')
                    .setLabel('Enable Export')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📤'),
                new ButtonBuilder()
                    .setCustomId('setup_logging_archive')
                    .setLabel('Enable Auto-Archive')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📦'),
                new ButtonBuilder()
                    .setCustomId('setup_logging_notify')
                    .setLabel('Enable Mod Notifications')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔔')
            );

        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setup_logging_confirm')
                    .setLabel('Confirm Settings')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('setup_logging_cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.reply({
            embeds: [embed],
            components: [loggingRow, retentionRow, featuresRow, confirmRow],
            ephemeral: true
        });
    }

    async handleLoggingSettings(interaction) {
        const { customId, values } = interaction;
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);

        if (!setupState.data.logging) {
            setupState.data.logging = {
                level: 'basic',
                retention: '30',
                features: {
                    export: false,
                    autoArchive: false,
                    modNotifications: false
                }
            };
        }

        switch (customId) {
            case 'setup_logging_level':
                setupState.data.logging.level = values[0];
                await interaction.reply({
                    content: `Logging level set to: ${values[0]}`,
                    ephemeral: true
                });
                break;

            case 'setup_log_retention':
                setupState.data.logging.retention = values[0];
                await interaction.reply({
                    content: `Log retention set to: ${values[0]} days`,
                    ephemeral: true
                });
                break;

            case 'setup_logging_export':
                setupState.data.logging.features.export = !setupState.data.logging.features.export;
                await interaction.reply({
                    content: `Log export ${setupState.data.logging.features.export ? 'enabled' : 'disabled'}`,
                    ephemeral: true
                });
                break;

            case 'setup_logging_archive':
                setupState.data.logging.features.autoArchive = !setupState.data.logging.features.autoArchive;
                await interaction.reply({
                    content: `Auto-archive ${setupState.data.logging.features.autoArchive ? 'enabled' : 'disabled'}`,
                    ephemeral: true
                });
                break;

            case 'setup_logging_notify':
                setupState.data.logging.features.modNotifications = !setupState.data.logging.features.modNotifications;
                await interaction.reply({
                    content: `Mod notifications ${setupState.data.logging.features.modNotifications ? 'enabled' : 'disabled'}`,
                    ephemeral: true
                });
                break;

            case 'setup_logging_confirm':
                await this.completeSetup(interaction);
                break;

            case 'setup_logging_cancel':
                await this.cancelSetup(interaction);
                break;
        }
    }

    async completeSetup(interaction) {
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);

        try {
            const community = new Community({
                guildId: guild.id,
                name: setupState.data.name,
                code: setupState.data.code,
                inviteLink: setupState.data.inviteLink,
                adminRoleId: setupState.data.adminRoleId,
                channels: setupState.data.channels,
                categories: setupState.data.categories,
                settings: {
                    logMatches: setupState.data.logMatches,
                    setupComplete: true
                }
            });

            await community.save();

            const embed = new EmbedBuilder()
                .setTitle('Setup Complete!')
                .setDescription('Your server has been successfully set up for ScoreShell!')
                .addFields(
                    { name: 'Community Name', value: community.name },
                    { name: 'Community Code', value: community.code },
                    { name: 'Admin Role', value: `<@&${community.adminRoleId}>` },
                    { name: 'Match Logging', value: community.settings.logMatches ? 'Enabled' : 'Disabled' }
                )
                .setColor('#00ff00');

            await interaction.reply({ embeds: [embed] });
            this.activeSetups.delete(guild.id);
        } catch (error) {
            console.error('Error completing setup:', error);
            this.activeSetups.delete(guild.id);
            await interaction.reply({
                content: 'An error occurred while completing setup. Please try again.',
                ephemeral: true
            });
        }
    }

    async cancelSetup(interaction) {
        const { guild } = interaction;
        const setupState = this.activeSetups.get(guild.id);

        if (setupState) {
            // Clean up created channels and roles
            try {
                const category = guild.channels.cache.get(setupState.data.categories?.ranked);
                if (category) {
                    await Promise.all(
                        category.children.cache.map(channel => channel.delete())
                    );
                    await category.delete();
                }
            } catch (error) {
                console.error('Error cleaning up channels:', error);
            }
        }

        this.activeSetups.delete(guild.id);
        await interaction.reply({
            content: 'Setup has been cancelled and all created channels have been removed.',
            ephemeral: true
        });
    }
}

module.exports = SetupManager; 