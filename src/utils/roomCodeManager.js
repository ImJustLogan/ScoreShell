const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const Match = require('../models/Match');
const User = require('../models/User');

class RoomCodeManager {
    constructor(client) {
        this.client = client;
        this.activeRequests = new Map(); // Map of matchId -> { channel, message, timeout, hostId, strikes }
    }

    async requestRoomCode(match, channel) {
        const host = match.players.find(p => p.isHost);
        if (!host) return false;

        // Create room code request embed
        const embed = new EmbedBuilder()
            .setTitle('Room Code Required')
            .setDescription(`<@${host.userId}>, please enter the room code for your match.`)
            .setColor('#00FF00')
            .addFields([
                {
                    name: 'Players',
                    value: match.players.map(p => `<@${p.userId}>`).join(' vs '),
                    inline: false
                },
                {
                    name: 'Stage',
                    value: match.stage,
                    inline: true
                },
                {
                    name: 'Room Code',
                    value: 'Waiting for host...',
                    inline: true
                }
            ]);

        // Create room code submission button
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`roomcode_submit_${match._id}`)
                    .setLabel('Enter Room Code')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`roomcode_invalid_${match._id}`)
                    .setLabel('Code Invalid')
                    .setStyle(ButtonStyle.Danger)
            );

        // Send to match channel
        const message = await channel.send({
            embeds: [embed],
            components: [row]
        });

        // Try to DM the host
        try {
            const user = await this.client.users.fetch(host.userId);
            const dmEmbed = new EmbedBuilder()
                .setTitle('Enter Room Code')
                .setDescription(`Please enter the room code for your match against <@${match.players.find(p => !p.isHost).userId}>`)
                .setColor('#00FF00');

            const dmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`roomcode_submit_${match._id}`)
                        .setLabel('Enter Room Code')
                        .setStyle(ButtonStyle.Primary)
                );

            await user.send({
                embeds: [dmEmbed],
                components: [dmRow]
            });
        } catch (error) {
            // DM failed, send hidden message in channel
            await channel.send({
                content: `<@${host.userId}>`,
                embeds: [
                    new EmbedBuilder()
                        .setTitle('DM Failed')
                        .setDescription('I couldn\'t send you a DM. Please enable DMs or use the button in the match channel to enter the room code.')
                        .setColor('#FF0000')
                ],
                ephemeral: true
            });
        }

        // Set timeout for room code submission (2 minutes)
        const timeout = setTimeout(async () => {
            if (this.activeRequests.has(match._id)) {
                await this.handleTimeout(match, channel);
            }
        }, 120000); // 2 minutes

        this.activeRequests.set(match._id, {
            channel,
            message,
            timeout,
            hostId: host.userId,
            strikes: 0
        });

        return true;
    }

    async handleRoomCodeSubmit(matchId, userId, roomCode) {
        const requestData = this.activeRequests.get(matchId);
        if (!requestData) return false;

        const match = await Match.findById(matchId);
        if (!match) return false;

        // Validate room code format (4-6 alphanumeric characters)
        if (!/^[a-zA-Z0-9]{4,6}$/.test(roomCode)) {
            return false;
        }

        // Update match with room code
        match.roomCode = roomCode;
        match.status = 'IN_PROGRESS';
        match.startTime = new Date();
        match.history.push({
            action: 'STARTED',
            reason: 'Room code provided',
            timestamp: new Date()
        });
        await match.save();

        // Update message
        const embed = requestData.message.embeds[0];
        embed.fields.find(f => f.name === 'Room Code').value = roomCode;
        embed.setColor('#00FF00');

        await requestData.message.edit({
            embeds: [embed],
            components: [] // Remove buttons
        });

        // Notify players
        const notificationEmbed = new EmbedBuilder()
            .setTitle('Match Started')
            .setDescription(`Match has started! Room Code: ${roomCode}`)
            .setColor('#00FF00');

        await requestData.channel.send({
            content: match.players.map(p => `<@${p.userId}>`).join(' '),
            embeds: [notificationEmbed]
        });

        // Clean up
        clearTimeout(requestData.timeout);
        this.activeRequests.delete(matchId);

        return true;
    }

    async handleInvalidCode(matchId, userId) {
        const requestData = this.activeRequests.get(matchId);
        if (!requestData) return false;

        const match = await Match.findById(matchId);
        if (!match) return false;

        // Only the non-host player can report invalid codes
        const nonHost = match.players.find(p => !p.isHost);
        if (nonHost.userId !== userId) return false;

        // Increment strikes
        requestData.strikes++;
        
        // Update message to show strikes
        const embed = requestData.message.embeds[0];
        embed.fields.find(f => f.name === 'Room Code').value = `Invalid code reported (${requestData.strikes}/5 strikes)`;
        embed.setColor('#FF0000');

        await requestData.message.edit({
            embeds: [embed]
        });

        // If 5 strikes reached, cancel match
        if (requestData.strikes >= 5) {
            // Update match status
            match.status = 'COMPLETED';
            match.endTime = new Date();
            match.history.push({
                action: 'COMPLETED',
                reason: 'Host provided invalid room code 5 times',
                timestamp: new Date()
            });

            // Set winner and loser
            const host = match.players.find(p => p.isHost);
            const nonHost = match.players.find(p => !p.isHost);
            host.repChange = -75; // Standard loss
            nonHost.repChange = 75; // Standard win

            // Update player stats
            await Promise.all([
                User.findByIdAndUpdate(nonHost.user, {
                    $inc: {
                        'stats.matchesPlayed': 1,
                        'stats.matchesWon': 1
                    }
                }),
                User.findByIdAndUpdate(host.user, {
                    $inc: {
                        'stats.matchesPlayed': 1,
                        'stats.matchesLost': 1
                    }
                })
            ]);

            await match.save();

            // Notify players
            const cancelEmbed = new EmbedBuilder()
                .setTitle('Match Cancelled')
                .setDescription(`Match cancelled: Host provided invalid room code 5 times.`)
                .setColor('#FF0000')
                .addFields([
                    {
                        name: 'Winner',
                        value: `<@${nonHost.userId}> (+${nonHost.repChange} rep)`,
                        inline: true
                    },
                    {
                        name: 'Loser',
                        value: `<@${host.userId}> (${host.repChange} rep)`,
                        inline: true
                    }
                ]);

            await requestData.channel.send({
                content: match.players.map(p => `<@${p.userId}>`).join(' '),
                embeds: [cancelEmbed]
            });

            // Clean up
            clearTimeout(requestData.timeout);
            this.activeRequests.delete(matchId);

            // Remove buttons from original message
            await requestData.message.edit({
                components: []
            });
        }

        return true;
    }

    async handleTimeout(match, channel) {
        this.activeRequests.delete(match._id);

        // Update match status
        match.status = 'CANCELLED';
        match.endTime = new Date();
        match.history.push({
            action: 'CANCELLED',
            reason: 'No room code provided',
            timestamp: new Date()
        });
        await match.save();

        // Notify players
        const embed = new EmbedBuilder()
            .setTitle('Match Cancelled')
            .setDescription('Match was cancelled due to no room code being provided within the time limit.')
            .setColor('#FF0000');

        await channel.send({ 
            content: match.players.map(p => `<@${p.userId}>`).join(' '),
            embeds: [embed] 
        });

        // Return players to queue if they're still eligible
        for (const player of match.players) {
            const user = await this.client.users.fetch(player.userId);
            if (user) {
                try {
                    await user.send('You have been returned to the queue due to the match being cancelled.');
                } catch (error) {
                    // DM failed, ignore
                }
            }
        }
    }

    async cancelRequest(matchId) {
        const request = this.activeRequests.get(matchId);
        if (request) {
            clearTimeout(request.timeout);
            this.activeRequests.delete(matchId);
        }
    }
}

module.exports = RoomCodeManager; 