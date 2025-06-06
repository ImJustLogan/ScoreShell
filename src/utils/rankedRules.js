const { EmbedBuilder } = require('discord.js');

const RANKED_RULES = {
    title: '🏆 Ranked Rules',
    description: 'Welcome to ScoreShell Ranked! Here are the rules and guidelines for ranked matches.',
    color: '#5865F2',
    fields: [
        {
            name: '🎮 Game Settings',
            value: '• Star Moves: On\n• Innings: 7\n• Items: On\n• Mercy Rule: On',
            inline: false
        },
        {
            name: '📊 Ranked System',
            value: '• 7 ranks: Bronze, Silver, Gold, Diamond, Mythic, Legendary, and Masters\n• Each rank (except Masters) has 3 tiers\n• Earn rep to climb the ranks\n• Masters rank allows unlimited rep gain',
            inline: false
        },
        {
            name: '⚔️ Match Rules',
            value: '• Both players must report scores using `/outcome`\n• Disputed scores will be reviewed by moderators\n• Matches have a 1.5 hour time limit\n• Leaving a match early may result in penalties',
            inline: false
        },
        {
            name: '🎯 Rep System',
            value: '• Base rep gain: 75 for wins\n• Bonus rep for win streaks\n• Bonus rep for beating higher-ranked players\n• Rep loss for defeats\n• 10% chance for "Hypercharged" matches with 50% more rep!',
            inline: false
        },
        {
            name: '⚠️ Important Notes',
            value: '• Be respectful to other players\n• Report any issues using `/report`\n• False score reporting will result in a ban\n• Use `/help` for more commands and information',
            inline: false
        }
    ]
};

function createRankedRulesEmbed() {
    return new EmbedBuilder()
        .setTitle(RANKED_RULES.title)
        .setDescription(RANKED_RULES.description)
        .setColor(RANKED_RULES.color)
        .addFields(RANKED_RULES.fields)
        .setTimestamp();
}

module.exports = {
    createRankedRulesEmbed
}; 