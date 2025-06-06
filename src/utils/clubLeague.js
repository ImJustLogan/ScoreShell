const logger = require('./logger');

/**
 * Gets the current club league season number and status
 * @returns {Object} Season info including number, start date, end date, and status
 */
function getCurrentSeasonInfo() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    // Calculate season number (year * 12 + month)
    const seasonNumber = year * 12 + month;
    
    // Calculate season dates (1st-7th of each month)
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month, 7, 23, 59, 59, 999);
    
    // Determine season status
    let status;
    if (now < startDate) {
        status = 'UPCOMING';
    } else if (now > endDate) {
        status = 'ENDED';
    } else {
        status = 'ACTIVE';
    }
    
    return {
        seasonNumber,
        startDate,
        endDate,
        status,
        timeRemaining: status === 'ACTIVE' ? endDate - now : 0
    };
}

/**
 * Checks if club league is currently active
 * @returns {boolean} True if club league is active
 */
function isClubLeagueActive() {
    const seasonInfo = getCurrentSeasonInfo();
    return seasonInfo.status === 'ACTIVE';
}

/**
 * Gets the time until next season starts
 * @returns {Object} Time remaining in days, hours, minutes
 */
function getTimeUntilNextSeason() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    // If we're past the 7th, next season starts 1st of next month
    let nextSeasonStart;
    if (now.getDate() > 7) {
        nextSeasonStart = new Date(year, month + 1, 1);
    } else {
        nextSeasonStart = new Date(year, month, 1);
    }
    
    const timeRemaining = nextSeasonStart - now;
    const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
    
    return { days, hours, minutes };
}

/**
 * Schedules the end of the current season
 * @param {Object} client - Discord client instance
 */
async function scheduleSeasonEnd(client) {
    const seasonInfo = getCurrentSeasonInfo();
    if (seasonInfo.status !== 'ACTIVE') return;
    
    // Schedule season end
    const timeUntilEnd = seasonInfo.timeRemaining;
    setTimeout(async () => {
        try {
            // Get all clubs
            const clubs = await client.db.collection('clubs').find({}).toArray();
            
            // End season for each club
            for (const club of clubs) {
                await client.db.collection('clubs').updateOne(
                    { _id: club._id },
                    { $set: { 'clubLeague.status': 'ENDED' } }
                );
                
                // Reset tickets for all members
                await client.db.collection('users').updateMany(
                    { club: club._id },
                    { $set: { clubTickets: 7 } }
                );
                
                // Notify club members
                const members = await client.db.collection('users')
                    .find({ club: club._id })
                    .toArray();
                
                for (const member of members) {
                    try {
                        const user = await client.users.fetch(member.discordId);
                        await user.send({
                            content: `Club League Season ${seasonInfo.seasonNumber} has ended! ` +
                                   `Your club earned ${club.clubLeague.trophies} trophies. ` +
                                   `New season starts in ${getTimeUntilNextSeason().days} days!`
                        });
                    } catch (error) {
                        logger.error(`Failed to send season end DM to ${member.discordId}:`, error);
                    }
                }
            }
            
            // Schedule next season start
            scheduleNextSeason(client);
        } catch (error) {
            logger.error('Error ending club league season:', error);
        }
    }, timeUntilEnd);
}

/**
 * Schedules the start of the next season
 * @param {Object} client - Discord client instance
 */
async function scheduleNextSeason(client) {
    const { days, hours, minutes } = getTimeUntilNextSeason();
    const timeUntilStart = (days * 24 * 60 + hours * 60 + minutes) * 60 * 1000;
    
    setTimeout(async () => {
        try {
            // Get all clubs
            const clubs = await client.db.collection('clubs').find({}).toArray();
            
            // Start new season for each club
            for (const club of clubs) {
                await client.db.collection('clubs').updateOne(
                    { _id: club._id },
                    { 
                        $set: { 
                            'clubLeague.status': 'ACTIVE',
                            'clubLeague.totalRep': 0,
                            'clubLeague.currentSeason': getCurrentSeasonInfo().seasonNumber
                        }
                    }
                );
                
                // Notify club members
                const members = await client.db.collection('users')
                    .find({ club: club._id })
                    .toArray();
                
                for (const member of members) {
                    try {
                        const user = await client.users.fetch(member.discordId);
                        await user.send({
                            content: `Club League Season ${getCurrentSeasonInfo().seasonNumber} has started! ` +
                                   `You have 7 tickets to use this week. Good luck!`
                        });
                    } catch (error) {
                        logger.error(`Failed to send season start DM to ${member.discordId}:`, error);
                    }
                }
            }
            
            // Schedule season end
            scheduleSeasonEnd(client);
        } catch (error) {
            logger.error('Error starting club league season:', error);
        }
    }, timeUntilStart);
}

/**
 * Initializes club league scheduling
 * @param {Object} client - Discord client instance
 */
function initializeClubLeague(client) {
    const seasonInfo = getCurrentSeasonInfo();
    
    if (seasonInfo.status === 'ACTIVE') {
        // Schedule end of current season
        scheduleSeasonEnd(client);
    } else if (seasonInfo.status === 'ENDED') {
        // Schedule start of next season
        scheduleNextSeason(client);
    } else {
        // Schedule start of upcoming season
        scheduleNextSeason(client);
    }
    
    // Log initialization
    logger.info(`Club League initialized. Current season: ${seasonInfo.seasonNumber} (${seasonInfo.status})`);
}

/**
 * Check if a match qualifies for club league
 * @param {Object} player1Data - First player's user data
 * @param {Object} player2Data - Second player's user data
 * @returns {Object} { isValid: boolean, reason?: string }
 */
function isClubLeagueMatch(player1Data, player2Data) {
    // Validate input data
    if (!player1Data || !player2Data) {
        return { isValid: false, reason: 'Missing player data' };
    }

    // Both players must be in clubs
    if (!player1Data.clubId || !player2Data.clubId) {
        return { isValid: false, reason: 'Both players must be in clubs' };
    }

    // Players must be in different clubs
    if (player1Data.clubId === player2Data.clubId) {
        return { isValid: false, reason: 'Players must be in different clubs' };
    }

    // Both players must have tickets
    if (!player1Data.clubTickets || !player2Data.clubTickets || 
        player1Data.clubTickets <= 0 || player2Data.clubTickets <= 0) {
        return { isValid: false, reason: 'Both players must have tickets' };
    }

    // Check if either player recently joined their club (club hopping prevention)
    const now = new Date();
    const seasonStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    if (player1Data.clubJoinDate && new Date(player1Data.clubJoinDate) > seasonStart) {
        return { isValid: false, reason: 'Player 1 recently joined their club' };
    }
    if (player2Data.clubJoinDate && new Date(player2Data.clubJoinDate) > seasonStart) {
        return { isValid: false, reason: 'Player 2 recently joined their club' };
    }

    // Club league must be active
    if (!isClubLeagueActive()) {
        return { isValid: false, reason: 'Club league is not active' };
    }

    return { isValid: true };
}

/**
 * Calculate club rep for a match
 * @param {number} winnerScore - Winner's score
 * @param {number} loserScore - Loser's score
 * @returns {number} Club rep earned
 */
function calculateClubRep(winnerScore, loserScore) {
    // Validate scores
    if (typeof winnerScore !== 'number' || typeof loserScore !== 'number' ||
        winnerScore < 0 || loserScore < 0) {
        throw new Error('Invalid scores provided');
    }

    // Base rep for win
    let rep = 70;

    // Run differential bonus (capped at +30)
    const runDiff = Math.max(0, winnerScore - loserScore); // Ensure non-negative
    const rdBonus = Math.min(runDiff * 3, 30);
    rep += rdBonus;

    // Cap at 100
    return Math.min(rep, 100);
}

/**
 * Update club rep and tickets after a match
 * @param {Object} db - Database instance
 * @param {Object} winnerData - Winner's user data
 * @param {Object} loserData - Loser's user data
 * @param {number} winnerScore - Winner's score
 * @param {number} loserScore - Loser's score
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function updateClubLeagueMatch(db, winnerData, loserData, winnerScore, loserScore) {
    const session = db.startSession();
    
    try {
        // Validate match eligibility
        const matchCheck = isClubLeagueMatch(winnerData, loserData);
        if (!matchCheck.isValid) {
            return { success: false, error: matchCheck.reason };
        }

        // Verify clubs still exist
        const [winnerClub, loserClub] = await Promise.all([
            db.collection('clubs').findOne({ clubId: winnerData.clubId }),
            db.collection('clubs').findOne({ clubId: loserData.clubId })
        ]);

        if (!winnerClub || !loserClub) {
            return { success: false, error: 'One or both clubs no longer exist' };
        }

        await session.withTransaction(async () => {
            // Calculate rep
            const repEarned = calculateClubRep(winnerScore, loserScore);
            const repLost = Math.min(10, 0); // Cannot go below 0

            // Update winner's club
            await db.collection('clubs').updateOne(
                { clubId: winnerData.clubId },
                { 
                    $inc: { 
                        currentSeasonRep: repEarned,
                        totalRep: repEarned
                    }
                },
                { session }
            );

            // Decrement winner's tickets
            await db.collection('users').updateOne(
                { userId: winnerData.userId },
                { $inc: { clubTickets: -1 } },
                { session }
            );

            // Update loser's club
            await db.collection('clubs').updateOne(
                { clubId: loserData.clubId },
                { 
                    $inc: { 
                        currentSeasonRep: -repLost,
                        totalRep: -repLost
                    }
                },
                { session }
            );

            // Decrement loser's tickets
            await db.collection('users').updateOne(
                { userId: loserData.userId },
                { $inc: { clubTickets: -1 } },
                { session }
            );
        });

        return { success: true };
    } catch (error) {
        logger.error('Error updating club league match:', error);
        return { success: false, error: 'Database error occurred' };
    } finally {
        await session.endSession();
    }
}

/**
 * Reset club league season
 * Called at the end of each season (7th of month)
 * @param {Object} db - Database instance
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function resetClubLeagueSeason(db) {
    const session = db.startSession();
    
    try {
        // Verify it's actually time to reset
        const now = new Date();
        const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        
        if (est.getDate() !== 8 || est.getHours() !== 0) {
            return { success: false, error: 'Not time for season reset' };
        }

        await session.withTransaction(async () => {
            // Get all clubs before reset
            const clubs = await db.collection('clubs').find({}).toArray();
            
            // Reset all users' tickets to 7
            await db.collection('users').updateMany(
                { clubTickets: { $exists: true } },
                { $set: { clubTickets: 7 } },
                { session }
            );

            // Convert current season rep to trophies for each club
            for (const club of clubs) {
                if (club.currentSeasonRep && club.currentSeasonRep > 0) {
                    const trophies = Math.ceil(club.currentSeasonRep / 10);
                    const seasonKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
                    
                    await db.collection('clubs').updateOne(
                        { clubId: club.clubId },
                        { 
                            $inc: { 
                                totalTrophies: trophies,
                                [`trophies.${seasonKey}`]: trophies
                            },
                            $set: { 
                                currentSeasonRep: 0,
                                lastSeasonReset: new Date()
                            }
                        },
                        { session }
                    );
                }
            }

            // Log season reset
            logger.info('Club league season reset completed', {
                timestamp: new Date(),
                clubsProcessed: clubs.length
            });
        });

        return { success: true };
    } catch (error) {
        logger.error('Error resetting club league season:', error);
        return { success: false, error: 'Database error occurred' };
    } finally {
        await session.endSession();
    }
}

module.exports = {
    getCurrentSeasonInfo,
    isClubLeagueActive,
    getTimeUntilNextSeason,
    initializeClubLeague,
    isClubLeagueMatch,
    calculateClubRep,
    updateClubLeagueMatch,
    resetClubLeagueSeason
}; 