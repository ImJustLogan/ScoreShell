const RANKS = {
    BRONZE: {
        emoji: '1348460284951400570',
        color: '#f59833',
        tiers: [
            { name: 'Bronze I', points: 0 },
            { name: 'Bronze II', points: 500 },
            { name: 'Bronze III', points: 1000 }
        ]
    },
    SILVER: {
        emoji: '1348460318753296466',
        color: '#6774c9',
        tiers: [
            { name: 'Silver I', points: 1500 },
            { name: 'Silver II', points: 2000 },
            { name: 'Silver III', points: 2500 }
        ]
    },
    GOLD: {
        emoji: '1348460332825186326',
        color: '#ffc11b',
        tiers: [
            { name: 'Gold I', points: 3000 },
            { name: 'Gold II', points: 3500 },
            { name: 'Gold III', points: 4000 }
        ]
    },
    DIAMOND: {
        emoji: '1348460344049401877',
        color: '#05c2f7',
        tiers: [
            { name: 'Diamond I', points: 4500 },
            { name: 'Diamond II', points: 5000 },
            { name: 'Diamond III', points: 5500 }
        ]
    },
    MYTHIC: {
        emoji: '1348460358951768084',
        color: '#ce17ef',
        tiers: [
            { name: 'Mythic I', points: 6000 },
            { name: 'Mythic II', points: 6500 },
            { name: 'Mythic III', points: 7000 }
        ]
    },
    LEGENDARY: {
        emoji: '1348460371392073829',
        color: '#fc3434',
        tiers: [
            { name: 'Legendary I', points: 7500 },
            { name: 'Legendary II', points: 8000 },
            { name: 'Legendary III', points: 8500 }
        ]
    },
    MASTERS: {
        emoji: '1348460383396167681',
        color: '#741904',
        tiers: [
            { name: 'Masters', points: 9000 }
        ]
    }
};

class RankManager {
    constructor(db) {
        this.db = db;
    }

    // Calculate rep change for a match based on the design doc formula
    calculateRepChange(winner, loser, scoreDiff, isHypercharged = false) {
        // Base rep gain/loss (75 base)
        let repChange = winner ? 75 : -75;

        // Rep difference bonus (up to 20)
        // Every 225 rep difference = 1 point
        const repDiff = Math.abs(winner.rep - loser.rep);
        const repDiffBonus = Math.min(Math.floor(repDiff / 225), 20);
        repChange += winner ? repDiffBonus : -repDiffBonus;

        // Run differential bonus (up to 30)
        // Each RD scores 3 rep
        const rdBonus = Math.min(scoreDiff * 3, 30);
        repChange += winner ? rdBonus : -rdBonus;

        // Win streak bonus (up to 20)
        // Each win scores 2 rep
        const winStreakBonus = Math.min(winner.winStreak * 2, 20);
        repChange += winner ? winStreakBonus : 0;

        // Apply hypercharge if active (50% multiplier)
        if (isHypercharged) {
            repChange = Math.floor(repChange * 1.5);
        }

        // Ensure minimum rep gain for wins (95 with win streak)
        if (winner) {
            const minRep = winner.winStreak >= 10 ? 95 : 75;
            repChange = Math.max(repChange, minRep);
        }

        // Ensure maximum rep gain
        // Max of 145 for win with max win streak (10)
        // Max of 125 for win without win streak
        const maxRep = winner ? (winner.winStreak >= 10 ? 145 : 125) : Math.abs(repChange);
        repChange = Math.min(Math.max(repChange, -maxRep), maxRep);

        return Math.round(repChange);
    }

    // Get rank info based on rep
    getRankInfo(rep) {
        const ranks = {
            BRONZE: { min: 0, max: 1499, tiers: ['I', 'II', 'III'] },
            SILVER: { min: 1500, max: 2999, tiers: ['I', 'II', 'III'] },
            GOLD: { min: 3000, max: 4499, tiers: ['I', 'II', 'III'] },
            DIAMOND: { min: 4500, max: 5999, tiers: ['I', 'II', 'III'] },
            MYTHIC: { min: 6000, max: 7499, tiers: ['I', 'II', 'III'] },
            LEGENDARY: { min: 7500, max: 8999, tiers: ['I', 'II', 'III'] },
            MASTERS: { min: 9000, max: Infinity, tiers: [''] }
        };

        for (const [rank, info] of Object.entries(ranks)) {
            if (rep >= info.min && rep <= info.max) {
                const tierIndex = Math.floor((rep - info.min) / 500);
                const tier = info.tiers[Math.min(tierIndex, info.tiers.length - 1)];
                return { rank, tier, points: rep };
            }
        }

        return { rank: 'BRONZE', tier: 'I', points: 0 };
    }

    // Update player's rep and win streak
    async updatePlayerStats(userId, repChange, isWin) {
        const session = this.db.startSession();
        try {
            await session.withTransaction(async () => {
                const user = await this.db.collection('users').findOne({ userId });
                if (!user) throw new Error('User not found');

                const newRep = Math.max(0, user.rep + repChange);
                const newWinStreak = isWin ? (user.winStreak || 0) + 1 : 0;

                await this.db.collection('users').updateOne(
                    { userId },
                    { 
                        $set: { 
                            rep: newRep,
                            winStreak: newWinStreak,
                            lastMatchTime: new Date()
                        }
                    },
                    { session }
                );
            });
            return true;
        } catch (error) {
            logger.error('Error updating player stats:', error);
            return false;
        } finally {
            await session.endSession();
        }
    }

    // Get rank info for a given rep amount
    getRankInfoForRep(rep) {
        for (const [rankName, rank] of Object.entries(RANKS)) {
            for (let i = rank.tiers.length - 1; i >= 0; i--) {
                if (rep >= rank.tiers[i].points) {
                    return {
                        rank: rankName,
                        tier: rank.tiers[i].name,
                        emoji: rank.emoji,
                        color: rank.color,
                        points: rep,
                        nextRank: this.getNextRank(rep)
                    };
                }
            }
        }
        return null;
    }

    // Get next rank info
    getNextRank(currentRep) {
        for (const [rankName, rank] of Object.entries(RANKS)) {
            for (const tier of rank.tiers) {
                if (tier.points > currentRep) {
                    return {
                        rank: rankName,
                        tier: tier.name,
                        points: tier.points,
                        pointsNeeded: tier.points - currentRep
                    };
                }
            }
        }
        return null; // Already at max rank
    }

    // Check if a rank up occurred
    async checkRankUp(userId, oldRep, newRep) {
        const oldRank = this.getRankInfoForRep(oldRep);
        const newRank = this.getRankInfoForRep(newRep);

        if (!oldRank || !newRank) return null;

        if (oldRank.rank !== newRank.rank || oldRank.tier !== newRank.tier) {
            // Rank up occurred
            const rankUp = {
                oldRank: oldRank,
                newRank: newRank,
                timestamp: new Date()
            };

            // Store rank up in database
            await this.db.collection('rankUps').insertOne({
                userId,
                ...rankUp
            });

            return rankUp;
        }

        return null;
    }

    // Get rank up embed
    getRankUpEmbed(rankUp) {
        const { oldRank, newRank } = rankUp;
        return {
            title: '🎉 Rank Up! 🎉',
            description: `Congratulations! You've advanced to ${newRank.tier}!`,
            color: parseInt(newRank.color.replace('#', ''), 16),
            fields: [
                {
                    name: 'Previous Rank',
                    value: `${oldRank.tier}`,
                    inline: true
                },
                {
                    name: 'New Rank',
                    value: `${newRank.tier}`,
                    inline: true
                },
                {
                    name: 'Current Points',
                    value: `${newRank.points}`,
                    inline: false
                }
            ],
            thumbnail: {
                url: `https://i.imgur.com/${newRank.emoji}.png`
            }
        };
    }

    // Check for hypercharge (10% chance)
    checkHypercharge() {
        return Math.random() < 0.1;
    }
}

module.exports = RankManager; 