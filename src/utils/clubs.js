const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('./logger');

// Club icons and their IDs
const CLUB_ICONS = {
    RED: { emoji: '1340463594055139328', image: 'https://i.imgur.com/sy8o63Y.png' },
    BLUE: { emoji: '1340464817428758558', image: 'https://i.imgur.com/2jH5dQU.png' },
    YELLOW: { emoji: '1340464843576049774', image: 'https://i.imgur.com/nywWQyZ.png' },
    GREEN: { emoji: '1340464944126230598', image: 'https://i.imgur.com/JnBP5ro.png' },
    PINK: { emoji: '1340464971741528084', image: 'https://i.imgur.com/ToavyvN.png' },
    CYAN: { emoji: '1340465007598764124', image: 'https://i.imgur.com/81HXsR4.png' }
};

// Club membership types
const MEMBERSHIP_TYPES = {
    OPEN: 'open',
    APPLICATION: 'application',
    INVITE_ONLY: 'invite_only'
};

// Club roles
const CLUB_ROLES = {
    OWNER: 'owner',
    CAPTAIN: 'captain',
    MEMBER: 'member'
};

/**
 * Create a new club
 */
async function createClub(client, userId, name, clubId, icon, membershipType) {
    try {
        // Validate club ID format (3-5 alphanumeric characters)
        if (!/^[a-zA-Z0-9]{3,5}$/.test(clubId)) {
            throw new Error('Club ID must be 3-5 alphanumeric characters');
        }

        // Check if user is already in a club
        const existingUser = await client.db.collection('users').findOne({
            discordId: userId,
            'club.id': { $exists: true }
        });
        if (existingUser) {
            throw new Error('You are already in a club');
        }

        // Check if club ID is taken
        const existingClub = await client.db.collection('clubs').findOne({ clubId });
        if (existingClub) {
            throw new Error('Club ID already taken');
        }

        // Create club
        const club = {
            name,
            clubId,
            icon,
            membershipType,
            owner: userId,
            captains: [],
            members: [userId],
            createdAt: new Date(),
            rep: 0,
            trophies: 0,
            description: '',
            invites: [],
            applications: []
        };

        await client.db.collection('clubs').insertOne(club);

        // Update user's club info
        await client.db.collection('users').updateOne(
            { discordId: userId },
            {
                $set: {
                    'club.id': clubId,
                    'club.role': CLUB_ROLES.OWNER,
                    'club.joinedAt': new Date()
                }
            }
        );

        return club;

    } catch (error) {
        logger.error('Error in createClub:', error);
        throw error;
    }
}

/**
 * Disband a club
 */
async function disbandClub(client, userId, clubId) {
    try {
        // Verify ownership
        const club = await client.db.collection('clubs').findOne({
            clubId,
            owner: userId
        });
        if (!club) {
            throw new Error('You are not the owner of this club');
        }

        // Get all club members
        const members = await client.db.collection('users').find({
            'club.id': clubId
        }).toArray();

        // Remove club from all members
        await client.db.collection('users').updateMany(
            { 'club.id': clubId },
            { $unset: { club: "" } }
        );

        // Delete club
        await client.db.collection('clubs').deleteOne({ clubId });

        // Notify all members
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Club Disbanded')
            .setDescription(`The club ${club.name} (${clubId}) has been disbanded.`)
            .setTimestamp();

        for (const member of members) {
            const user = await client.users.fetch(member.discordId).catch(() => null);
            if (user) {
                await user.send({ embeds: [embed] }).catch(() => {});
            }
        }

        return club;

    } catch (error) {
        logger.error('Error in disbandClub:', error);
        throw error;
    }
}

/**
 * Invite a user to a club
 */
async function inviteToClub(client, inviterId, inviteeId, clubId) {
    try {
        // Check if inviter has permission
        const club = await client.db.collection('clubs').findOne({ clubId });
        if (!club) {
            throw new Error('Club not found');
        }

        if (![club.owner, ...club.captains].includes(inviterId)) {
            throw new Error('You do not have permission to invite members');
        }

        // Check if club is full
        if (club.members.length >= 10) {
            throw new Error('Club is full (maximum 10 members)');
        }

        // Check if user is already in a club
        const invitee = await client.db.collection('users').findOne({
            discordId: inviteeId,
            'club.id': { $exists: true }
        });
        if (invitee) {
            throw new Error('User is already in a club');
        }

        // Check if user already has an invite
        if (club.invites.includes(inviteeId)) {
            throw new Error('User already has an invite');
        }

        // Add invite
        await client.db.collection('clubs').updateOne(
            { clubId },
            { $push: { invites: inviteeId } }
        );

        // Notify user
        const inviter = await client.users.fetch(inviterId);
        const inviteeUser = await client.users.fetch(inviteeId);
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Club Invitation')
            .setDescription(`${inviter.username} has invited you to join ${club.name} (${clubId})!`)
            .addFields(
                { name: 'Club Type', value: club.membershipType },
                { name: 'Members', value: `${club.members.length}/10` }
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`club_accept_${clubId}`)
                    .setLabel('Accept')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`club_decline_${clubId}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Danger)
            );

        await inviteeUser.send({ embeds: [embed], components: [row] }).catch(() => {
            throw new Error('Could not send invite to user (DMs may be disabled)');
        });

        return club;

    } catch (error) {
        logger.error('Error in inviteToClub:', error);
        throw error;
    }
}

/**
 * Accept a club invitation
 */
async function acceptClubInvite(client, userId, clubId) {
    try {
        // Check if user is already in a club
        const user = await client.db.collection('users').findOne({
            discordId: userId,
            'club.id': { $exists: true }
        });
        if (user) {
            throw new Error('You are already in a club');
        }

        // Get club and verify invite
        const club = await client.db.collection('clubs').findOne({
            clubId,
            invites: userId
        });
        if (!club) {
            throw new Error('No pending invite found');
        }

        // Check if club is full
        if (club.members.length >= 10) {
            throw new Error('Club is full');
        }

        // Remove invite and add member
        await client.db.collection('clubs').updateOne(
            { clubId },
            {
                $pull: { invites: userId },
                $push: { members: userId }
            }
        );

        // Update user's club info
        await client.db.collection('users').updateOne(
            { discordId: userId },
            {
                $set: {
                    'club.id': clubId,
                    'club.role': CLUB_ROLES.MEMBER,
                    'club.joinedAt': new Date()
                }
            }
        );

        // Notify club members
        const newMember = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('New Club Member')
            .setDescription(`${newMember.username} has joined the club!`)
            .setTimestamp();

        for (const memberId of club.members) {
            const member = await client.users.fetch(memberId).catch(() => null);
            if (member) {
                await member.send({ embeds: [embed] }).catch(() => {});
            }
        }

        return club;

    } catch (error) {
        logger.error('Error in acceptClubInvite:', error);
        throw error;
    }
}

/**
 * Apply to join a club
 */
async function applyToClub(client, userId, clubId) {
    try {
        // Check if user is already in a club
        const user = await client.db.collection('users').findOne({
            discordId: userId,
            'club.id': { $exists: true }
        });
        if (user) {
            throw new Error('You are already in a club');
        }

        // Get club and verify it accepts applications
        const club = await client.db.collection('clubs').findOne({
            clubId,
            membershipType: MEMBERSHIP_TYPES.APPLICATION
        });
        if (!club) {
            throw new Error('Club not found or does not accept applications');
        }

        // Check if club is full
        if (club.members.length >= 10) {
            throw new Error('Club is full');
        }

        // Check if user already has a pending application
        if (club.applications.includes(userId)) {
            throw new Error('You already have a pending application');
        }

        // Add application
        await client.db.collection('clubs').updateOne(
            { clubId },
            { $push: { applications: userId } }
        );

        // Notify club leaders
        const applicant = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('New Club Application')
            .setDescription(`${applicant.username} has applied to join the club!`)
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`club_approve_${clubId}_${userId}`)
                    .setLabel('Approve')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`club_deny_${clubId}_${userId}`)
                    .setLabel('Deny')
                    .setStyle(ButtonStyle.Danger)
            );

        for (const leaderId of [club.owner, ...club.captains]) {
            const leader = await client.users.fetch(leaderId).catch(() => null);
            if (leader) {
                await leader.send({ embeds: [embed], components: [row] }).catch(() => {});
            }
        }

        return club;

    } catch (error) {
        logger.error('Error in applyToClub:', error);
        throw error;
    }
}

/**
 * Approve a club application
 */
async function approveClubApplication(client, approverId, clubId, applicantId) {
    try {
        // Check if approver has permission
        const club = await client.db.collection('clubs').findOne({
            clubId,
            $or: [
                { owner: approverId },
                { captains: approverId }
            ]
        });
        if (!club) {
            throw new Error('You do not have permission to approve applications');
        }

        // Verify application exists
        if (!club.applications.includes(applicantId)) {
            throw new Error('No pending application found');
        }

        // Check if club is full
        if (club.members.length >= 10) {
            throw new Error('Club is full');
        }

        // Remove application and add member
        await client.db.collection('clubs').updateOne(
            { clubId },
            {
                $pull: { applications: applicantId },
                $push: { members: applicantId }
            }
        );

        // Update user's club info
        await client.db.collection('users').updateOne(
            { discordId: applicantId },
            {
                $set: {
                    'club.id': clubId,
                    'club.role': CLUB_ROLES.MEMBER,
                    'club.joinedAt': new Date()
                }
            }
        );

        // Notify applicant
        const approver = await client.users.fetch(approverId);
        const applicant = await client.users.fetch(applicantId);
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Application Approved')
            .setDescription(`Your application to join ${club.name} has been approved by ${approver.username}!`)
            .setTimestamp();

        await applicant.send({ embeds: [embed] }).catch(() => {});

        return club;

    } catch (error) {
        logger.error('Error in approveClubApplication:', error);
        throw error;
    }
}

/**
 * Deny a club application
 */
async function denyClubApplication(client, denierId, clubId, applicantId) {
    try {
        // Check if denier has permission
        const club = await client.db.collection('clubs').findOne({
            clubId,
            $or: [
                { owner: denierId },
                { captains: denierId }
            ]
        });
        if (!club) {
            throw new Error('You do not have permission to deny applications');
        }

        // Verify application exists
        if (!club.applications.includes(applicantId)) {
            throw new Error('No pending application found');
        }

        // Remove application
        await client.db.collection('clubs').updateOne(
            { clubId },
            { $pull: { applications: applicantId } }
        );

        // Notify applicant
        const denier = await client.users.fetch(denierId);
        const applicant = await client.users.fetch(applicantId);
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Application Denied')
            .setDescription(`Your application to join ${club.name} has been denied by ${denier.username}.`)
            .setTimestamp();

        await applicant.send({ embeds: [embed] }).catch(() => {});

        return club;

    } catch (error) {
        logger.error('Error in denyClubApplication:', error);
        throw error;
    }
}

/**
 * Kick a member from a club
 */
async function kickFromClub(client, kickerId, clubId, memberId) {
    try {
        // Check if kicker has permission
        const club = await client.db.collection('clubs').findOne({ clubId });
        if (!club) {
            throw new Error('Club not found');
        }

        if (![club.owner, ...club.captains].includes(kickerId)) {
            throw new Error('You do not have permission to kick members');
        }

        // Prevent kicking owner or other captains
        if (memberId === club.owner || club.captains.includes(memberId)) {
            throw new Error('Cannot kick club owner or captains');
        }

        // Verify member is in club
        if (!club.members.includes(memberId)) {
            throw new Error('User is not a member of this club');
        }

        // Remove member
        await client.db.collection('clubs').updateOne(
            { clubId },
            { $pull: { members: memberId } }
        );

        // Update user's club info
        await client.db.collection('users').updateOne(
            { discordId: memberId },
            { $unset: { club: "" } }
        );

        // Notify kicked member
        const kicker = await client.users.fetch(kickerId);
        const kicked = await client.users.fetch(memberId);
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Kicked from Club')
            .setDescription(`You have been kicked from ${club.name} by ${kicker.username}.`)
            .setTimestamp();

        await kicked.send({ embeds: [embed] }).catch(() => {});

        return club;

    } catch (error) {
        logger.error('Error in kickFromClub:', error);
        throw error;
    }
}

/**
 * Promote a member to captain
 */
async function promoteToCaptain(client, promoterId, clubId, memberId) {
    try {
        // Check if promoter is owner
        const club = await client.db.collection('clubs').findOne({
            clubId,
            owner: promoterId
        });
        if (!club) {
            throw new Error('Only the club owner can promote members');
        }

        // Verify member is in club
        if (!club.members.includes(memberId)) {
            throw new Error('User is not a member of this club');
        }

        // Prevent promoting owner
        if (memberId === club.owner) {
            throw new Error('Cannot promote the club owner');
        }

        // Add captain
        await client.db.collection('clubs').updateOne(
            { clubId },
            { $push: { captains: memberId } }
        );

        // Update user's role
        await client.db.collection('users').updateOne(
            { discordId: memberId },
            { $set: { 'club.role': CLUB_ROLES.CAPTAIN } }
        );

        // Notify promoted member
        const promoter = await client.users.fetch(promoterId);
        const promoted = await client.users.fetch(memberId);
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Promoted to Captain')
            .setDescription(`You have been promoted to captain in ${club.name} by ${promoter.username}!`)
            .setTimestamp();

        await promoted.send({ embeds: [embed] }).catch(() => {});

        return club;

    } catch (error) {
        logger.error('Error in promoteToCaptain:', error);
        throw error;
    }
}

/**
 * Demote a captain
 */
async function demoteCaptain(client, demoterId, clubId, captainId) {
    try {
        // Check if demoter is owner
        const club = await client.db.collection('clubs').findOne({
            clubId,
            owner: demoterId
        });
        if (!club) {
            throw new Error('Only the club owner can demote captains');
        }

        // Verify captain is in club
        if (!club.captains.includes(captainId)) {
            throw new Error('User is not a captain of this club');
        }

        // Remove captain
        await client.db.collection('clubs').updateOne(
            { clubId },
            { $pull: { captains: captainId } }
        );

        // Update user's role
        await client.db.collection('users').updateOne(
            { discordId: captainId },
            { $set: { 'club.role': CLUB_ROLES.MEMBER } }
        );

        // Notify demoted captain
        const demoter = await client.users.fetch(demoterId);
        const demoted = await client.users.fetch(captainId);
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Demoted from Captain')
            .setDescription(`You have been demoted from captain in ${club.name} by ${demoter.username}.`)
            .setTimestamp();

        await demoted.send({ embeds: [embed] }).catch(() => {});

        return club;

    } catch (error) {
        logger.error('Error in demoteCaptain:', error);
        throw error;
    }
}

/**
 * Leave a club
 */
async function leaveClub(client, userId, clubId) {
    try {
        // Get club and verify membership
        const club = await client.db.collection('clubs').findOne({
            clubId,
            members: userId
        });
        if (!club) {
            throw new Error('You are not a member of this club');
        }

        // Prevent owner from leaving
        if (userId === club.owner) {
            throw new Error('Club owner cannot leave. Use /club disband to delete the club.');
        }

        // Remove member
        await client.db.collection('clubs').updateOne(
            { clubId },
            { $pull: { members: userId, captains: userId } }
        );

        // Update user's club info
        await client.db.collection('users').updateOne(
            { discordId: userId },
            { $unset: { club: "" } }
        );

        // Notify club members
        const leaver = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Member Left')
            .setDescription(`${leaver.username} has left the club.`)
            .setTimestamp();

        for (const memberId of club.members) {
            const member = await client.users.fetch(memberId).catch(() => null);
            if (member) {
                await member.send({ embeds: [embed] }).catch(() => {});
            }
        }

        return club;

    } catch (error) {
        logger.error('Error in leaveClub:', error);
        throw error;
    }
}

/**
 * Update club settings
 */
async function updateClubSettings(client, userId, clubId, settings) {
    try {
        // Check if user is owner
        const club = await client.db.collection('clubs').findOne({
            clubId,
            owner: userId
        });
        if (!club) {
            throw new Error('Only the club owner can update settings');
        }

        // Validate settings
        const validSettings = {};
        if (settings.name) {
            validSettings.name = settings.name;
        }
        if (settings.icon && Object.values(CLUB_ICONS).some(i => i.emoji === settings.icon)) {
            validSettings.icon = settings.icon;
        }
        if (settings.membershipType && Object.values(MEMBERSHIP_TYPES).includes(settings.membershipType)) {
            validSettings.membershipType = settings.membershipType;
        }
        if (settings.description) {
            validSettings.description = settings.description;
        }

        // Update club
        await client.db.collection('clubs').updateOne(
            { clubId },
            { $set: validSettings }
        );

        return { ...club, ...validSettings };

    } catch (error) {
        logger.error('Error in updateClubSettings:', error);
        throw error;
    }
}

/**
 * Transfer club ownership
 */
async function transferClubOwnership(client, userId, clubId, newOwnerId) {
    try {
        // Check if user is owner
        const club = await client.db.collection('clubs').findOne({
            clubId,
            owner: userId
        });
        if (!club) {
            throw new Error('Only the club owner can transfer ownership');
        }

        // Verify new owner is a member
        if (!club.members.includes(newOwnerId)) {
            throw new Error('New owner must be a club member');
        }

        // Update club
        await client.db.collection('clubs').updateOne(
            { clubId },
            {
                $set: { owner: newOwnerId },
                $pull: { captains: newOwnerId }
            }
        );

        // Update user roles
        await client.db.collection('users').updateOne(
            { discordId: userId },
            { $set: { 'club.role': CLUB_ROLES.MEMBER } }
        );
        await client.db.collection('users').updateOne(
            { discordId: newOwnerId },
            { $set: { 'club.role': CLUB_ROLES.OWNER } }
        );

        // Notify members
        const oldOwner = await client.users.fetch(userId);
        const newOwner = await client.users.fetch(newOwnerId);
        const embed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('Club Ownership Transferred')
            .setDescription(`${oldOwner.username} has transferred ownership of ${club.name} to ${newOwner.username}.`)
            .setTimestamp();

        for (const memberId of club.members) {
            const member = await client.users.fetch(memberId).catch(() => null);
            if (member) {
                await member.send({ embeds: [embed] }).catch(() => {});
            }
        }

        return { ...club, owner: newOwnerId };

    } catch (error) {
        logger.error('Error in transferClubOwnership:', error);
        throw error;
    }
}

/**
 * Get club information
 */
async function getClubInfo(client, clubId) {
    try {
        const club = await client.db.collection('clubs').findOne({ clubId });
        if (!club) {
            throw new Error('Club not found');
        }

        // Get member details
        const members = await client.db.collection('users').find({
            'club.id': clubId
        }).toArray();

        // Format member list
        const memberList = members.map(member => ({
            id: member.discordId,
            role: member.club.role,
            joinedAt: member.club.joinedAt
        }));

        return {
            ...club,
            members: memberList
        };

    } catch (error) {
        logger.error('Error in getClubInfo:', error);
        throw error;
    }
}

/**
 * Update club rep and trophies
 */
async function updateClubRep(client, clubId, repChange) {
    try {
        const club = await client.db.collection('clubs').findOne({ clubId });
        if (!club) {
            throw new Error('Club not found');
        }

        // Calculate new rep (prevent negative)
        const newRep = Math.max(0, club.rep + repChange);
        
        // Calculate new trophies
        const newTrophies = Math.ceil(newRep / 10);

        // Update club
        await client.db.collection('clubs').updateOne(
            { clubId },
            {
                $set: {
                    rep: newRep,
                    trophies: newTrophies
                }
            }
        );

        return {
            ...club,
            rep: newRep,
            trophies: newTrophies
        };

    } catch (error) {
        logger.error('Error in updateClubRep:', error);
        throw error;
    }
}

/**
 * Get club leaderboard
 */
async function getClubLeaderboard(client, page = 1) {
    try {
        const perPage = 10;
        const skip = (page - 1) * perPage;

        // Get clubs sorted by trophies
        const clubs = await client.db.collection('clubs')
            .find()
            .sort({ trophies: -1, rep: -1 })
            .skip(skip)
            .limit(perPage)
            .toArray();

        // Get total count for pagination
        const total = await client.db.collection('clubs').countDocuments();

        return {
            clubs,
            page,
            totalPages: Math.ceil(total / perPage),
            total
        };

    } catch (error) {
        logger.error('Error in getClubLeaderboard:', error);
        throw error;
    }
}

/**
 * Check if club league is active
 */
function isClubLeagueActive() {
    const now = new Date();
    const day = now.getDate();
    return day >= 1 && day <= 7;
}

/**
 * Get club league status
 */
async function getClubLeagueStatus(client) {
    try {
        const now = new Date();
        const day = now.getDate();
        const isActive = day >= 1 && day <= 7;

        // Get end of current season
        const endDate = new Date(now);
        if (day <= 7) {
            endDate.setDate(7);
        } else {
            endDate.setMonth(endDate.getMonth() + 1);
            endDate.setDate(1);
            endDate.setDate(7);
        }
        endDate.setHours(23, 59, 59, 999);

        // Get top clubs for current season
        const topClubs = await client.db.collection('clubs')
            .find()
            .sort({ rep: -1 })
            .limit(3)
            .toArray();

        return {
            isActive,
            endDate,
            topClubs
        };

    } catch (error) {
        logger.error('Error in getClubLeagueStatus:', error);
        throw error;
    }
}

module.exports = {
    CLUB_ICONS,
    MEMBERSHIP_TYPES,
    CLUB_ROLES,
    createClub,
    disbandClub,
    inviteToClub,
    acceptClubInvite,
    applyToClub,
    approveClubApplication,
    denyClubApplication,
    kickFromClub,
    promoteToCaptain,
    demoteCaptain,
    leaveClub,
    updateClubSettings,
    transferClubOwnership,
    getClubInfo,
    updateClubRep,
    getClubLeaderboard,
    isClubLeagueActive,
    getClubLeagueStatus
}; 