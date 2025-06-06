module.exports = {
    category: 'user',
    data: new SlashCommandBuilder()
        .setName('challenge')
        .setDescription('View and participate in challenges'),

    async execute(interaction) {
        try {
            // Get active challenges
            const challenges = await interaction.client.db.collection('challenges').find({
                status: 'ACTIVE',
                $or: [
                    { startTime: { $lte: new Date() } },
                    { startTime: null }
                ],
                $or: [
                    { endTime: { $gt: new Date() } },
                    { endTime: null }
                ]
            }).toArray();

            if (challenges.length === 0) {
                return interaction.reply({
                    content: 'There are no active challenges at the moment.',
                    ephemeral: true
                });
            }

            // Get user's current challenge participation
            const userChallenges = await interaction.client.db.collection('challenges').find({
                'participants.userId': interaction.user.id,
                status: 'ACTIVE'
            }).toArray();

            // Create embeds for each challenge
            const challengeEmbeds = challenges.map(challenge => {
                const userParticipation = challenge.participants.find(p => p.userId === interaction.user.id);
                const isParticipating = !!userParticipation;

                const embed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(challenge.name)
                    .setDescription(challenge.description)
                    .setThumbnail(challenge.icon)
                    .addFields(
                        { name: 'Mode', value: challenge.mode === 'bingo' ? 'Bingo' : 'Standard', inline: true },
                        { name: 'Lives', value: challenge.lives.toString(), inline: true },
                        { name: 'Wins Required', value: challenge.winsRequired.toString(), inline: true }
                    );

                if (isParticipating) {
                    embed.addFields(
                        { name: 'Your Progress', value: `Wins: ${userParticipation.wins}/${challenge.winsRequired}`, inline: true },
                        { name: 'Lives Remaining', value: userParticipation.lives.toString(), inline: true }
                    );
                }

                if (challenge.endTime) {
                    const timeLeft = challenge.endTime - new Date();
                    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    embed.addFields({
                        name: 'Time Remaining',
                        value: `${days}d ${hours}h`,
                        inline: true
                    });
                }

                return embed;
            });

            // Create buttons for each challenge
            const challengeRows = challenges.map(challenge => {
                const userParticipation = challenge.participants.find(p => p.userId === interaction.user.id);
                const isParticipating = !!userParticipation;
                const isInOtherChallenge = userChallenges.length > 0 && !isParticipating;

                const startButton = new ButtonBuilder()
                    .setCustomId(`challenge_start_${challenge.id}`)
                    .setLabel('Start!')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(isInOtherChallenge || (isParticipating && userParticipation.lives <= 0));

                const infoButton = new ButtonBuilder()
                    .setCustomId(`challenge_info_${challenge.id}`)
                    .setLabel('More Info')
                    .setStyle(ButtonStyle.Secondary);

                return new ActionRowBuilder().addComponents(startButton, infoButton);
            });

            // Send challenge embeds
            await interaction.reply({
                embeds: challengeEmbeds,
                components: challengeRows,
                ephemeral: true
            });

            // Create collector for buttons
            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 300000 // 5 minutes
            });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({
                        content: 'You cannot use these buttons.',
                        ephemeral: true
                    });
                }

                const [action, challengeId] = i.customId.split('_').slice(1);
                const challenge = challenges.find(c => c.id === challengeId);

                if (action === 'start') {
                    // Check if user is already in a challenge
                    if (userChallenges.length > 0 && !userChallenges.find(c => c.id === challengeId)) {
                        return i.reply({
                            content: 'You are already participating in another challenge. Complete or forfeit it first.',
                            ephemeral: true
                        });
                    }

                    // Check if user is already in this challenge
                    const existingParticipation = challenge.participants.find(p => p.userId === interaction.user.id);
                    if (existingParticipation) {
                        if (existingParticipation.lives <= 0) {
                            return i.reply({
                                content: 'You have no lives remaining in this challenge.',
                                ephemeral: true
                            });
                        }
                        return i.reply({
                            content: 'You are already participating in this challenge!',
                            ephemeral: true
                        });
                    }

                    // Add user to challenge
                    await interaction.client.db.collection('challenges').updateOne(
                        { id: challengeId },
                        {
                            $push: {
                                participants: {
                                    userId: interaction.user.id,
                                    wins: 0,
                                    lives: challenge.lives,
                                    joinedAt: new Date()
                                }
                            }
                        }
                    );

                    // Send confirmation message
                    const modeSpecificMessage = challenge.mode === 'bingo' ?
                        'Complete bingo challenges to earn wins! Each match requires completing 5 lines on your bingo card.' :
                        'Win matches to progress through the challenge!';

                    await i.reply({
                        content: `You have joined the ${challenge.name} challenge! ${modeSpecificMessage}`,
                        ephemeral: true
                    });

                } else if (action === 'info') {
                    // Show detailed challenge info
                    const infoEmbed = new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle(challenge.name)
                        .setDescription(challenge.description)
                        .setThumbnail(challenge.icon)
                        .addFields(
                            { name: 'Mode', value: challenge.mode === 'bingo' ? 'Bingo' : 'Standard', inline: true },
                            { name: 'Lives', value: challenge.lives.toString(), inline: true },
                            { name: 'Wins Required', value: challenge.winsRequired.toString(), inline: true },
                            { name: 'Total Participants', value: challenge.participants.length.toString(), inline: true }
                        );

                    if (challenge.mode === 'bingo') {
                        infoEmbed.addFields({
                            name: 'How to Play',
                            value: '1. Challenge another player to a bingo match\n2. Complete quests on your bingo card\n3. Mark completed quests with `/bingo mark`\n4. Complete 5 lines to win the match\n5. Win matches to progress in the challenge!'
                        });
                    }

                    await i.reply({
                        embeds: [infoEmbed],
                        ephemeral: true
                    });
                }
            });

            collector.on('end', () => {
                // Disable all buttons
                const disabledRows = challengeRows.map(row => {
                    const disabledComponents = row.components.map(button => 
                        ButtonBuilder.from(button.data).setDisabled(true)
                    );
                    return new ActionRowBuilder().addComponents(disabledComponents);
                });

                interaction.editReply({
                    components: disabledRows
                }).catch(() => {});
            });

        } catch (error) {
            logger.error('Error in challenge command:', error);
            return interaction.reply({
                content: 'An error occurred while processing the challenge command.',
                ephemeral: true
            });
        }
    }
}; 