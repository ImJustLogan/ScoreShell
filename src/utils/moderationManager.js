const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('./logger');
const User = require('../models/User');
const Report = require('../models/Report');
const Ban = require('../models/Ban');
const ServerSettings = require('../models/ServerSettings');

// Report categories and their properties
const REPORT_CATEGORIES = {
    HARASSMENT: {
        name: 'Harassment and Bullying',
        description: 'User is verbally mistreating other members',
        color: '#FF0000',
        icon: '🚫',
        priority: 3
    },
    LEAVING: {
        name: 'Leaving Prematurely',
        description: 'User left a ranked game in the middle of play',
        color: '#FFA500',
        icon: '🏃',
        priority: 2
    },
    CONNECTION: {
        name: 'Bad Connection',
        description: 'Users\' connection is unstable and causing lag',
        color: '#FFFF00',
        icon: '📡',
        priority: 1
    },
    CHEATING: {
        name: 'Cheating or Entering False Scores',
        description: 'User is using exploits or lying about the game\'s outcome',
        color: '#FF0000',
        icon: '🎲',
        priority: 3
    }
};

// Ban types and their properties
const BAN_TYPES = {
    SERVER: {
        name: 'Server Ban',
        description: 'Banned from using ranked in this server',
        color: '#FF0000',
        icon: '🔒'
    },
    GLOBAL: {
        name: 'Global Ban',
        description: 'Banned from using ranked in all servers',
        color: '#FF0000',
        icon: '🌐'
    }
};

class ModerationManager {
    constructor(client) {
        this.client = client;
        this.activeReports = new Map(); // Cache of active reports
        this.serverSettings = new Map(); // Cache of server settings
        this.initializeSettings();
    }

    async initializeSettings() {
        try {
            // Load all server settings
            const settings = await ServerSettings.find();
            settings.forEach(setting => this.serverSettings.set(setting.guildId, setting));

            // Create default settings for servers that don't have them
            const guilds = this.client.guilds.cache;
            for (const [guildId, guild] of guilds) {
                if (!this.serverSettings.has(guildId)) {
                    const defaultSettings = new ServerSettings({
                        guildId,
                        adminRoleId: null,
                        logChannelId: null,
                        matchLogsEnabled: false,
                        reportChannelId: null,
                        autoModEnabled: false,
                        reportThreshold: 3,
                        banThreshold: 5,
                        reportCooldown: 3600, // 1 hour
                        banDuration: 604800 // 1 week
                    });
                    await defaultSettings.save();
                    this.serverSettings.set(guildId, defaultSettings);
                }
            }

            logger.info('Moderation system initialized successfully');
        } catch (error) {
            logger.error('Error initializing moderation system:', error);
            throw error;
        }
    }

    // Report Handling
    async createReport(guildId, reporterId, targetId, category, reason, evidence = null) {
        try {
            const settings = this.serverSettings.get(guildId);
            if (!settings) {
                throw new Error('Server settings not found');
            }

            // Check report cooldown
            const lastReport = await Report.findOne({
                reporterId,
                createdAt: { $gte: new Date(Date.now() - settings.reportCooldown * 1000) }
            });
            if (lastReport) {
                const timeLeft = Math.ceil((lastReport.createdAt.getTime() + settings.reportCooldown * 1000 - Date.now()) / 1000);
                return { error: `Please wait ${timeLeft} seconds before submitting another report` };
            }

            // Create report
            const report = new Report({
                guildId,
                reporterId,
                targetId,
                category,
                reason,
                evidence,
                status: 'PENDING',
                priority: REPORT_CATEGORIES[category].priority
            });

            await report.save();
            this.activeReports.set(report.id, report);

            // Notify moderators
            await this.notifyModerators(guildId, report);

            // Check for auto-moderation
            if (settings.autoModEnabled) {
                await this.checkAutoModeration(guildId, targetId);
            }

            return { success: true, report };
        } catch (error) {
            logger.error('Error creating report:', error);
            throw error;
        }
    }

    async handleReport(guildId, reportId, moderatorId, action, notes = null) {
        try {
            const report = await Report.findById(reportId);
            if (!report || report.guildId !== guildId) {
                throw new Error('Report not found');
            }

            report.status = action;
            report.moderatorId = moderatorId;
            report.moderatorNotes = notes;
            report.resolvedAt = new Date();

            await report.save();
            this.activeReports.delete(reportId);

            // Notify users
            await this.notifyReportResolution(report);

            // If action is ban, handle ban
            if (action === 'BANNED') {
                const settings = this.serverSettings.get(guildId);
                await this.banUser(guildId, report.targetId, moderatorId, 'Report Resolution', settings.banDuration);
            }

            return { success: true, report };
        } catch (error) {
            logger.error('Error handling report:', error);
            throw error;
        }
    }

    async getActiveReports(guildId, filter = {}) {
        try {
            const query = { guildId, status: 'PENDING', ...filter };
            const reports = await Report.find(query).sort({ priority: -1, createdAt: 1 });
            return reports;
        } catch (error) {
            logger.error('Error getting active reports:', error);
            throw error;
        }
    }

    // Ban System
    async banUser(guildId, userId, moderatorId, reason, duration = null, type = 'SERVER') {
        try {
            const settings = this.serverSettings.get(guildId);
            if (!settings) {
                throw new Error('Server settings not found');
            }

            // Check if user is already banned
            const existingBan = await Ban.findOne({
                userId,
                guildId: type === 'SERVER' ? guildId : null,
                expiresAt: { $gt: new Date() }
            });

            if (existingBan) {
                return { error: 'User is already banned' };
            }

            // Create ban
            const ban = new Ban({
                userId,
                guildId: type === 'SERVER' ? guildId : null,
                moderatorId,
                reason,
                type,
                expiresAt: duration ? new Date(Date.now() + duration * 1000) : null
            });

            await ban.save();

            // If global ban, ban in all servers
            if (type === 'GLOBAL') {
                const guilds = this.client.guilds.cache;
                for (const [gid, guild] of guilds) {
                    if (gid !== guildId) {
                        await this.banUser(gid, userId, moderatorId, `Global ban: ${reason}`, duration, 'SERVER');
                    }
                }
            }

            // Notify user
            await this.notifyUserBan(userId, ban);

            return { success: true, ban };
        } catch (error) {
            logger.error('Error banning user:', error);
            throw error;
        }
    }

    async unbanUser(guildId, userId, moderatorId, reason) {
        try {
            const ban = await Ban.findOne({
                userId,
                guildId: guildId || null,
                expiresAt: { $gt: new Date() }
            });

            if (!ban) {
                return { error: 'User is not banned' };
            }

            // If global ban, unban in all servers
            if (ban.type === 'GLOBAL') {
                const guilds = this.client.guilds.cache;
                for (const [gid, guild] of guilds) {
                    await this.unbanUser(gid, userId, moderatorId, `Global unban: ${reason}`);
                }
            }

            ban.expiresAt = new Date();
            ban.unbannedBy = moderatorId;
            ban.unbanReason = reason;
            ban.unbannedAt = new Date();

            await ban.save();

            // Notify user
            await this.notifyUserUnban(userId, ban);

            return { success: true, ban };
        } catch (error) {
            logger.error('Error unbanning user:', error);
            throw error;
        }
    }

    async getActiveBans(guildId = null) {
        try {
            const query = {
                expiresAt: { $gt: new Date() },
                ...(guildId ? { guildId } : { type: 'GLOBAL' })
            };
            const bans = await Ban.find(query).sort({ createdAt: -1 });
            return bans;
        } catch (error) {
            logger.error('Error getting active bans:', error);
            throw error;
        }
    }

    // Server Settings
    async updateServerSettings(guildId, updates) {
        try {
            const settings = this.serverSettings.get(guildId);
            if (!settings) {
                throw new Error('Server settings not found');
            }

            // Update settings
            Object.assign(settings, updates);
            await settings.save();

            // Update cache
            this.serverSettings.set(guildId, settings);

            return { success: true, settings };
        } catch (error) {
            logger.error('Error updating server settings:', error);
            throw error;
        }
    }

    async getServerSettings(guildId) {
        return this.serverSettings.get(guildId);
    }

    // Auto-moderation
    async checkAutoModeration(guildId, userId) {
        try {
            const settings = this.serverSettings.get(guildId);
            if (!settings.autoModEnabled) return;

            // Get recent reports
            const recentReports = await Report.find({
                guildId,
                targetId: userId,
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
            });

            // Check report threshold
            if (recentReports.length >= settings.reportThreshold) {
                // Auto-ban if threshold reached
                await this.banUser(
                    guildId,
                    userId,
                    this.client.user.id,
                    'Automatic ban: Report threshold reached',
                    settings.banDuration
                );

                // Notify moderators
                await this.notifyModerators(guildId, {
                    type: 'AUTO_BAN',
                    userId,
                    reason: 'Report threshold reached',
                    reportCount: recentReports.length
                });
            }
        } catch (error) {
            logger.error('Error checking auto-moderation:', error);
            throw error;
        }
    }

    // Notification Methods
    async notifyModerators(guildId, report) {
        try {
            const settings = this.serverSettings.get(guildId);
            if (!settings.reportChannelId) return;

            const channel = await this.client.channels.fetch(settings.reportChannelId);
            if (!channel) return;

            const embed = new EmbedBuilder()
                .setTitle(`${REPORT_CATEGORIES[report.category].icon} New Report`)
                .setDescription(`**Category:** ${REPORT_CATEGORIES[report.category].name}\n**Reason:** ${report.reason}`)
                .setColor(REPORT_CATEGORIES[report.category].color)
                .addFields(
                    { name: 'Reporter', value: `<@${report.reporterId}>`, inline: true },
                    { name: 'Target', value: `<@${report.targetId}>`, inline: true },
                    { name: 'Priority', value: '⭐'.repeat(report.priority), inline: true }
                )
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`report_approve_${report.id}`)
                        .setLabel('Approve')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`report_deny_${report.id}`)
                        .setLabel('Deny')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`report_ban_${report.id}`)
                        .setLabel('Ban User')
                        .setStyle(ButtonStyle.Secondary)
                );

            await channel.send({ embeds: [embed], components: [row] });
        } catch (error) {
            logger.error('Error notifying moderators:', error);
        }
    }

    async notifyReportResolution(report) {
        try {
            const reporter = await this.client.users.fetch(report.reporterId);
            const target = await this.client.users.fetch(report.targetId);

            const embed = new EmbedBuilder()
                .setTitle('Report Resolved')
                .setDescription(`Your report against ${target.tag} has been ${report.status.toLowerCase()}`)
                .setColor(report.status === 'APPROVED' ? '#00FF00' : '#FF0000')
                .addFields(
                    { name: 'Category', value: REPORT_CATEGORIES[report.category].name },
                    { name: 'Reason', value: report.reason },
                    { name: 'Moderator Notes', value: report.moderatorNotes || 'No notes provided' }
                )
                .setTimestamp();

            await reporter.send({ embeds: [embed] }).catch(() => {});
            await target.send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error notifying report resolution:', error);
        }
    }

    async notifyUserBan(userId, ban) {
        try {
            const user = await this.client.users.fetch(userId);
            const moderator = await this.client.users.fetch(ban.moderatorId);

            const embed = new EmbedBuilder()
                .setTitle(`${BAN_TYPES[ban.type].icon} You have been banned`)
                .setDescription(`You have been banned from using ranked matches${ban.guildId ? ' in this server' : ' globally'}`)
                .setColor(BAN_TYPES[ban.type].color)
                .addFields(
                    { name: 'Reason', value: ban.reason },
                    { name: 'Moderator', value: moderator.tag },
                    { name: 'Duration', value: ban.expiresAt ? `Until ${ban.expiresAt.toLocaleString()}` : 'Permanent' }
                )
                .setTimestamp();

            await user.send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error notifying user ban:', error);
        }
    }

    async notifyUserUnban(userId, ban) {
        try {
            const user = await this.client.users.fetch(userId);
            const moderator = await this.client.users.fetch(ban.unbannedBy);

            const embed = new EmbedBuilder()
                .setTitle('🔓 Ban Lifted')
                .setDescription(`Your ban has been lifted${ban.guildId ? ' in this server' : ' globally'}`)
                .setColor('#00FF00')
                .addFields(
                    { name: 'Original Reason', value: ban.reason },
                    { name: 'Unbanned By', value: moderator.tag },
                    { name: 'Reason', value: ban.unbanReason }
                )
                .setTimestamp();

            await user.send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error notifying user unban:', error);
        }
    }

    // Utility Methods
    generateSettingsEmbed(settings) {
        return new EmbedBuilder()
            .setTitle('Server Settings')
            .setColor('#0099FF')
            .addFields(
                { name: 'Admin Role', value: settings.adminRoleId ? `<@&${settings.adminRoleId}>` : 'Not set', inline: true },
                { name: 'Log Channel', value: settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not set', inline: true },
                { name: 'Report Channel', value: settings.reportChannelId ? `<#${settings.reportChannelId}>` : 'Not set', inline: true },
                { name: 'Match Logs', value: settings.matchLogsEnabled ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Auto-mod', value: settings.autoModEnabled ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Report Threshold', value: settings.reportThreshold.toString(), inline: true },
                { name: 'Ban Threshold', value: settings.banThreshold.toString(), inline: true },
                { name: 'Report Cooldown', value: `${settings.reportCooldown / 3600} hours`, inline: true },
                { name: 'Ban Duration', value: `${settings.banDuration / 86400} days`, inline: true }
            )
            .setTimestamp();
    }

    generateSettingsMenu() {
        return new StringSelectMenuBuilder()
            .setCustomId('settings_menu')
            .setPlaceholder('Select a setting to modify')
            .addOptions([
                { label: 'Admin Role', value: 'admin_role', description: 'Set the admin role' },
                { label: 'Log Channel', value: 'log_channel', description: 'Set the log channel' },
                { label: 'Report Channel', value: 'report_channel', description: 'Set the report channel' },
                { label: 'Match Logs', value: 'match_logs', description: 'Toggle match logs' },
                { label: 'Auto-mod', value: 'auto_mod', description: 'Toggle auto-moderation' },
                { label: 'Report Threshold', value: 'report_threshold', description: 'Set report threshold' },
                { label: 'Ban Threshold', value: 'ban_threshold', description: 'Set ban threshold' },
                { label: 'Report Cooldown', value: 'report_cooldown', description: 'Set report cooldown' },
                { label: 'Ban Duration', value: 'ban_duration', description: 'Set ban duration' }
            ]);
    }
}

module.exports = ModerationManager; 