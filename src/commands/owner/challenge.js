const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
    category: 'owner',
    data: new SlashCommandBuilder()
        .setName('challenge')
        .setDescription('Manage challenges')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new challenge')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Challenge name')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Unique challenge ID (3-5 alphanumeric characters)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Challenge description')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('icon')
                        .setDescription('Challenge icon emoji')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('lives')
                        .setDescription('Number of lives')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(10))
                .addIntegerOption(option =>
                    option.setName('wins_required')
                        .setDescription('Number of wins required to complete')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(20))
                .addStringOption(option =>
                    option.setName('reward')
                        .setDescription('Badge ID to award upon completion')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('mode')
                        .setDescription('Challenge mode')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Standard', value: 'standard' },
                            { name: 'Bingo', value: 'bingo' }
                        ))
                .addStringOption(option =>
                    option.setName('start_time')
                        .setDescription('Challenge start time (YYYY-MM-DD HH:mm, optional)'))
                .addStringOption(option =>
                    option.setName('end_time')
                        .setDescription('Challenge end time (YYYY-MM-DD HH:mm, optional)')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a challenge')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Challenge ID')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all challenges'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('hypercharge')
                .setDescription('Apply hypercharge to a challenge')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Challenge ID')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('multiplier')
                        .setDescription('Rep multiplier (e.g., 50 for +50%)')
                        .setRequired(true)
                        .setMinValue(10)
                        .setMaxValue(200))
                .addStringOption(option =>
                    option.setName('duration')
                        .setDescription('Duration (e.g., "3h" or "1d")')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            // Check if user is owner
            if (interaction.user.id !== process.env.OWNER_ID) {
                return interaction.reply({
                    content: '❌ This command can only be used by the bot owner.',
                    ephemeral: true
                });
            }

            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'create': {
                    const name = interaction.options.getString('name');
                    const id = interaction.options.getString('id');
                    const description = interaction.options.getString('description');
                    const icon = interaction.options.getString('icon');
                    const lives = interaction.options.getInteger('lives');
                    const winsRequired = interaction.options.getInteger('wins_required');
                    const reward = interaction.options.getString('reward');
                    const mode = interaction.options.getString('mode');
                    const startTime = interaction.options.getString('start_time');
                    const endTime = interaction.options.getString('end_time');

                    // Validate challenge ID format
                    if (!/^[a-zA-Z0-9]{3,5}$/.test(id)) {
                        return interaction.reply({
                            content: '❌ Challenge ID must be 3-5 alphanumeric characters.',
                            ephemeral: true
                        });
                    }

                    // Check if challenge ID already exists
                    const existingChallenge = await interaction.client.db.collection('challenges').findOne({ id });
                    if (existingChallenge) {
                        return interaction.reply({
                            content: '❌ A challenge with this ID already exists.',
                            ephemeral: true
                        });
                    }

                    // Validate badge exists
                    const badge = await interaction.client.db.collection('badges').findOne({ id: reward });
                    if (!badge) {
                        return interaction.reply({
                            content: '❌ Invalid badge ID.',
                            ephemeral: true
                        });
                    }

                    // Parse timestamps if provided
                    let parsedStartTime = null;
                    let parsedEndTime = null;

                    if (startTime) {
                        parsedStartTime = new Date(startTime);
                        if (isNaN(parsedStartTime.getTime())) {
                            return interaction.reply({
                                content: '❌ Invalid start time format. Use YYYY-MM-DD HH:mm',
                                ephemeral: true
                            });
                        }
                    }

                    if (endTime) {
                        parsedEndTime = new Date(endTime);
                        if (isNaN(parsedEndTime.getTime())) {
                            return interaction.reply({
                                content: '❌ Invalid end time format. Use YYYY-MM-DD HH:mm',
                                ephemeral: true
                            });
                        }
                    }

                    if (parsedStartTime && parsedEndTime && parsedStartTime >= parsedEndTime) {
                        return interaction.reply({
                            content: '❌ End time must be after start time.',
                            ephemeral: true
                        });
                    }

                    // Create challenge document
                    const challenge = {
                        id,
                        name,
                        description,
                        icon,
                        lives,
                        winsRequired,
                        reward,
                        mode,
                        status: parsedStartTime ? 'PENDING' : 'ACTIVE',
                        startTime: parsedStartTime,
                        endTime: parsedEndTime,
                        createdAt: new Date(),
                        participants: [],
                        stats: {
                            totalParticipants: 0,
                            completedParticipants: 0,
                            totalMatches: 0,
                            totalRep: 0
                        }
                    };

                    await interaction.client.db.collection('challenges').insertOne(challenge);

                    // If challenge starts immediately, initialize it
                    if (!parsedStartTime) {
                        await interaction.client.challengeManager.startChallenge(id);
                    }

                    const embed = {
                        title: '🎯 Challenge Created',
                        description: `A new challenge has been created!`,
                        fields: [
                            { name: 'Name', value: name, inline: true },
                            { name: 'ID', value: id, inline: true },
                            { name: 'Mode', value: mode === 'bingo' ? 'Bingo' : 'Standard', inline: true },
                            { name: 'Lives', value: lives.toString(), inline: true },
                            { name: 'Wins Required', value: winsRequired.toString(), inline: true },
                            { name: 'Reward', value: badge.emoji, inline: true }
                        ],
                        color: 0x5865F2,
                        timestamp: new Date()
                    };

                    if (parsedStartTime) {
                        embed.fields.push({
                            name: 'Start Time',
                            value: parsedStartTime.toLocaleString(),
                            inline: true
                        });
                    }

                    if (parsedEndTime) {
                        embed.fields.push({
                            name: 'End Time',
                            value: parsedEndTime.toLocaleString(),
                            inline: true
                        });
                    }

                    await interaction.reply({ embeds: [embed] });
                    break;
                }

                case 'delete': {
                    const id = interaction.options.getString('id');
                    const challenge = await interaction.client.db.collection('challenges').findOne({ id });

                    if (!challenge) {
                        return interaction.reply({
                            content: '❌ Challenge not found.',
                            ephemeral: true
                        });
                    }

                    if (challenge.status === 'ACTIVE') {
                        return interaction.reply({
                            content: '❌ Cannot delete an active challenge. End it first.',
                            ephemeral: true
                        });
                    }

                    await interaction.client.db.collection('challenges').deleteOne({ id });
                    await interaction.reply({
                        content: `✅ Challenge "${challenge.name}" has been deleted.`,
                        ephemeral: true
                    });
                    break;
                }

                case 'list': {
                    const challenges = await interaction.client.db.collection('challenges')
                        .find({})
                        .sort({ createdAt: -1 })
                        .toArray();

                    if (challenges.length === 0) {
                        return interaction.reply({
                            content: 'No challenges found.',
                            ephemeral: true
                        });
                    }

                    const embed = {
                        title: '📋 Active Challenges',
                        fields: challenges.map(challenge => ({
                            name: `${challenge.icon} ${challenge.name}`,
                            value: [
                                `ID: \`${challenge.id}\``,
                                `Status: ${challenge.status}`,
                                `Mode: ${challenge.mode === 'bingo' ? 'Bingo' : 'Standard'}`,
                                `Participants: ${challenge.participants?.length || 0}`,
                                challenge.startTime ? `Start: ${new Date(challenge.startTime).toLocaleString()}` : null,
                                challenge.endTime ? `End: ${new Date(challenge.endTime).toLocaleString()}` : null
                            ].filter(Boolean).join('\n'),
                            inline: true
                        })),
                        color: 0x5865F2,
                        timestamp: new Date()
                    };

                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    break;
                }

                case 'hypercharge': {
                    const id = interaction.options.getString('id');
                    const multiplier = interaction.options.getInteger('multiplier');
                    const duration = interaction.options.getString('duration');

                    const result = await interaction.client.challengeManager.applyHypercharge(id, multiplier, duration);
                    
                    if (!result.success) {
                        return interaction.reply({
                            content: `❌ ${result.error}`,
                            ephemeral: true
                        });
                    }

                    await interaction.reply({
                        content: `✅ Hypercharge applied to challenge "${id}"!`,
                        ephemeral: true
                    });
                    break;
                }
            }
        } catch (error) {
            logger.error('Error in challenge command:', error);
            await interaction.reply({
                content: '❌ An error occurred while processing the command.',
                ephemeral: true
            });
        }
    }
}; 