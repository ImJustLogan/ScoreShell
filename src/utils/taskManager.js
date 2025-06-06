const logger = require('./logger');
const { resetClubLeagueSeason } = require('./clubLeague');

class TaskManager {
    constructor(db) {
        this.db = db;
        this.tasks = new Map();
    }

    /**
     * Initialize all scheduled tasks
     */
    initialize() {
        // Schedule club league season reset
        this.scheduleClubLeagueReset();
        
        // Add more scheduled tasks here as needed
    }

    /**
     * Schedule club league season reset
     * Runs at midnight EST on the 8th of each month
     */
    scheduleClubLeagueReset() {
        const task = async () => {
            try {
                const now = new Date();
                const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                
                // Check if it's the 8th of the month and midnight
                if (est.getDate() === 8 && est.getHours() === 0 && est.getMinutes() === 0) {
                    logger.info('Running club league season reset...');
                    await resetClubLeagueSeason(this.db);
                    logger.info('Club league season reset completed');
                }
            } catch (error) {
                logger.error('Error in club league reset task:', error);
            }
        };

        // Run task every minute to check for reset time
        const interval = setInterval(task, 60000);
        this.tasks.set('clubLeagueReset', interval);
        
        // Run initial check
        task();
    }

    /**
     * Clean up all scheduled tasks
     */
    cleanup() {
        for (const [name, interval] of this.tasks) {
            clearInterval(interval);
            logger.info(`Cleaned up task: ${name}`);
        }
        this.tasks.clear();
    }
}

module.exports = TaskManager; 