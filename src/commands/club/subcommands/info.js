const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../../../utils/logger');
const User = require('../../../models/User');
const Club = require('../../../models/Club');

module.exports = {
    async execute(interaction, { CLUB_ICONS, PRIVACY_TYPES }) {
        try {
            const clubId = interaction.options.getString('club_id');

            let club;
            if (clubId) {
                // If club ID is provided, find that club
                club = await Club.findOne({ id: clubId.toUpperCase() });
                if (!club) {
                    return interaction.reply({
                        content: 'Club not found! Please check the club ID and try again.',
                        ephemeral: true
                    });
                }
            } else {
                // If no club ID provided, get user's club
                const user = await User.findOne({ discordId: interaction.user.id });
                if (!user?.club) {
                    return interaction.reply({
                        content: 'You are not in a club! Please provide a club ID to view another club.',
                        ephemeral: true
                    });
                }
                club = await Club.findById(user.club);
                if (!club) {
                    return interaction.reply({
                        content: 'Club not found. Please contact an administrator.',
                        ephemeral: true
                    });
                }
            }

            // Get club owner and captains
            const owner = await User.findOne({ discordId: club.owner });
            const captains = await User.find({ discordId: { $in: club.captains } });
            const members = await User.find({ club: club._id, discordId: { $nin: [club.owner, ...club.captains] } });

            // Create info embed
            const embed = {
                content: "",
                tts: false,
                embeds: [
                    {
                        id: 407940349,
                        title: `${club.name} [${club.id}]`,
                        timestamp: new Date().toISOString(),
                        color: 33023,
                        footer: {
                            text: "Last updated:"
                        },
                        thumbnail: {
                            url: CLUB_ICONS[club.icon].image
                        },
                        fields: [
                            {
                                id: 587495420,
                                name: "Club Details:",
                                value: [
                                    `**Created:** <t:${Math.floor(club.createdAt.getTime() / 1000)}:R>`,
                                    `**Members:** ${members.length + captains.length + 1}/10`,
                                    `**Privacy:** ${club.privacy.charAt(0).toUpperCase() + club.privacy.slice(1)}`
                                ].join("\n"),
                                inline: true
                            },
                            {
                                id: 609205154,
                                name: "Club League:",
                                value: `**Trophies:** ${club.trophies} <:icon_club_trophy_point:1379175523720237258>`,
                                inline: true
                            },
                            {
                                id: 212262776,
                                name: "Owner:",
                                value: owner.username,
                                inline: false
                            },
                            {
                                id: 469089443,
                                name: `Captains: (${captains.length})`,
                                value: captains.map(c => c.username).join("\n") || "None",
                                inline: false
                            },
                            {
                                id: 587495421,
                                name: `Members (${members.length})`,
                                value: members.map(m => m.username).join("\n") || "None",
                                inline: false
                            }
                        ]
                    }
                ],
                components: [
                    {
                        id: 859642,
                        type: 1,
                        components: [
                            {
                                id: 62907252,
                                type: 2,
                                style: 1,
                                label: "Join!",
                                action_set_id: "356253107",
                                disabled: false
                            }
                        ]
                    }
                ],
                actions: {},
                flags: 0,
                username: "ScoreShell",
                avatar_url: "https://cdn.discordapp.com/avatars/1252063867337445377/dc23329556220d13b77e4e32ddd04a7c?size=1024"
            };

            // Only show join button if:
            // 1. User is not in a club
            // 2. Club is not full
            // 3. User is not already in this club
            const userClub = await User.findOne({ discordId: interaction.user.id });
            const canJoin = !userClub?.club && 
                          (members.length + captains.length + 1) < 10 && 
                          (!userClub || userClub.club.toString() !== club._id.toString());

            if (!canJoin) {
                embed.components = [];
            }

            await interaction.reply(embed);

        } catch (error) {
            logger.error('Error in club info command:', error);
            await interaction.reply({
                content: 'An error occurred while fetching club information. Please try again.',
                ephemeral: true
            });
        }
    }
}; 