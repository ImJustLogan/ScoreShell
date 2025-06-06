const { SlashCommandBuilder } = require('@discordjs/builders');
const { ClubManager, CLUB_PRIVACY } = require('../../../utils/clubManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join a club')
        .addStringOption(option =>
            option.setName('id')
                .setDescription('The ID of the club to join')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const clubId = interaction.options.getString('id').toUpperCase();
            const clubManager = new ClubManager(interaction.client.db);

            // Get club info
            const club = await clubManager.getClubInfo(clubId);

            // Check if user is already in a club
            const userClub = await interaction.client.db.collection('clubMembers')
                .findOne({ userId: interaction.user.id });
            if (userClub) {
                throw new Error('You are already in a club. Leave your current club first using `/club leave`.');
            }

            // Handle different privacy settings
            switch (club.privacy) {
                case CLUB_PRIVACY.OPEN:
                    // Direct join for open clubs
                    await clubManager.acceptInvite(interaction.user.id, clubId);
                    await interaction.editReply(`✅ Successfully joined ${club.name}!`);
                    break;

                case CLUB_PRIVACY.APPLICATION:
                    // Submit application for clubs requiring applications
                    await clubManager.applyToClub(clubId, interaction.user.id);
                    await interaction.editReply({
                        content: `✅ Application submitted to ${club.name}! The club leaders will review your application.`,
                        ephemeral: true
                    });
                    break;

                case CLUB_PRIVACY.INVITE:
                    // Check for pending invitation
                    const invite = await interaction.client.db.collection('clubInvites')
                        .findOne({
                            clubId,
                            inviteeId: interaction.user.id,
                            status: 'pending'
                        });

                    if (!invite) {
                        throw new Error('This club is invite-only and you do not have a pending invitation.');
                    }

                    // Accept invitation
                    await clubManager.acceptInvite(interaction.user.id, clubId);
                    await interaction.editReply(`✅ Successfully joined ${club.name}!`);
                    break;

                default:
                    throw new Error('Invalid club privacy setting.');
            }

        } catch (error) {
            await interaction.editReply({
                content: `❌ Error joining club: ${error.message}`,
                ephemeral: true
            });
        }
    }
}; 