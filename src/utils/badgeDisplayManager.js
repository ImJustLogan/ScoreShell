const logger = require('./logger');

class BadgeDisplayManager {
    constructor(db) {
        this.db = db;
        this.RATE_LIMIT = {
            windowMs: 60000, // 1 minute
            maxUpdates: 10   // max updates per minute
        };
        this.userUpdateCounts = new Map();
    }

    /**
     * Check if user is rate limited
     * @private
     */
    _checkRateLimit(userId) {
        const now = Date.now();
        const userUpdates = this.userUpdateCounts.get(userId) || [];
        
        // Remove old updates outside the window
        const recentUpdates = userUpdates.filter(time => now - time < this.RATE_LIMIT.windowMs);
        
        if (recentUpdates.length >= this.RATE_LIMIT.maxUpdates) {
            return false;
        }
        
        recentUpdates.push(now);
        this.userUpdateCounts.set(userId, recentUpdates);
        return true;
    }

    /**
     * Get badge categories and sort badges
     * @private
     */
    _categorizeBadges(badges) {
        const categories = {
            achievement: [],
            mastery: [],
            challenge: [],
            special: []
        };

        badges.forEach(badge => {
            if (badge.type.toLowerCase().includes('mastery')) {
                categories.mastery.push(badge);
            } else if (badge.type.toLowerCase().includes('challenge')) {
                categories.challenge.push(badge);
            } else if (badge.type.toLowerCase().includes('special')) {
                categories.special.push(badge);
            } else {
                categories.achievement.push(badge);
            }
        });

        // Sort badges within categories by rarity and name
        Object.keys(categories).forEach(category => {
            categories[category].sort((a, b) => {
                if (a.rarity !== b.rarity) {
                    return (b.rarity || 0) - (a.rarity || 0);
                }
                return a.name.localeCompare(b.name);
            });
        });

        return categories;
    }

    /**
     * Get a user's badge display configuration
     * @param {string} userId - Discord user ID
     * @returns {Promise<{displayBadges: Array<{slot: number, badgeId: string}>}>}
     */
    async getBadgeDisplay(userId) {
        const user = await this.db.collection('users').findOne(
            { discordId: userId },
            { projection: { displayBadges: 1 } }
        );

        return {
            displayBadges: user?.displayBadges || [
                { slot: 1, badgeId: null },
                { slot: 2, badgeId: null },
                { slot: 3, badgeId: null }
            ]
        };
    }

    /**
     * Update a user's badge display
     * @param {string} userId - Discord user ID
     * @param {number} slot - Slot number (1-3)
     * @param {string} badgeId - Badge ID to display (null to clear)
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async updateBadgeDisplay(userId, slot, badgeId) {
        if (slot < 1 || slot > 3) {
            return { success: false, error: 'Invalid slot number' };
        }

        // Get user's badges
        const user = await this.db.collection('users').findOne(
            { discordId: userId },
            { projection: { badges: 1, displayBadges: 1 } }
        );

        if (!user) {
            return { success: false, error: 'User not found' };
        }

        // If setting a badge, verify user owns it
        if (badgeId && !user.badges.includes(badgeId)) {
            return { success: false, error: 'User does not own this badge' };
        }

        // Check if badge is already displayed in another slot
        if (badgeId) {
            const existingSlot = user.displayBadges?.find(d => d.badgeId === badgeId);
            if (existingSlot && existingSlot.slot !== slot) {
                return { success: false, error: 'Badge is already displayed in another slot' };
            }
        }

        // Update display
        const displayBadges = user.displayBadges || [
            { slot: 1, badgeId: null },
            { slot: 2, badgeId: null },
            { slot: 3, badgeId: null }
        ];

        const slotIndex = displayBadges.findIndex(d => d.slot === slot);
        if (slotIndex === -1) {
            displayBadges.push({ slot, badgeId });
        } else {
            displayBadges[slotIndex].badgeId = badgeId;
        }

        // Sort by slot number
        displayBadges.sort((a, b) => a.slot - b.slot);

        // Update database
        await this.db.collection('users').updateOne(
            { discordId: userId },
            { $set: { displayBadges } }
        );

        return { success: true };
    }

    /**
     * Get a user's available badges with enhanced details
     * @param {string} userId - Discord user ID
     * @returns {Promise<{categories: Object, allBadges: Array}>}
     */
    async getAvailableBadges(userId) {
        const user = await this.db.collection('users').findOne(
            { discordId: userId },
            { projection: { badges: 1, badgeUnlockDates: 1 } }
        );

        if (!user || !user.badges || user.badges.length === 0) {
            return { categories: {}, allBadges: [] };
        }

        // Get badge details with unlock dates
        const badges = await this.db.collection('badges')
            .find({ badgeId: { $in: user.badges } })
            .project({ 
                badgeId: 1, 
                name: 1, 
                emoji: 1, 
                type: 1,
                description: 1,
                rarity: 1,
                variant: 1
            })
            .toArray();

        // Add unlock dates
        badges.forEach(badge => {
            badge.unlockDate = user.badgeUnlockDates?.[badge.badgeId] || null;
        });

        const categories = this._categorizeBadges(badges);
        return { categories, allBadges: badges };
    }

    /**
     * Get a user's current badge display with full badge details
     * @param {string} userId - Discord user ID
     * @returns {Promise<Array<{slot: number, badge: {badgeId: string, name: string, emoji: string, type: string}}>>}
     */
    async getFullBadgeDisplay(userId) {
        const { displayBadges } = await this.getBadgeDisplay(userId);
        
        if (!displayBadges.some(d => d.badgeId)) {
            return displayBadges.map(d => ({ slot: d.slot, badge: null }));
        }

        // Get badge details for displayed badges
        const badgeIds = displayBadges
            .filter(d => d.badgeId)
            .map(d => d.badgeId);

        const badges = await this.db.collection('badges')
            .find({ badgeId: { $in: badgeIds } })
            .project({ badgeId: 1, name: 1, emoji: 1, type: 1 })
            .toArray();

        const badgeMap = new Map(badges.map(b => [b.badgeId, b]));

        return displayBadges.map(d => ({
            slot: d.slot,
            badge: d.badgeId ? badgeMap.get(d.badgeId) : null
        }));
    }

    /**
     * Save a badge display layout
     * @param {string} userId - Discord user ID
     * @param {string} layoutName - Name for the layout
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async saveLayout(userId, layoutName) {
        if (!this._checkRateLimit(userId)) {
            return { success: false, error: 'Too many updates. Please wait a moment.' };
        }

        const { displayBadges } = await this.getBadgeDisplay(userId);
        
        const layouts = await this.db.collection('users').findOne(
            { discordId: userId },
            { projection: { badgeLayouts: 1 } }
        ) || { badgeLayouts: [] };

        // Check if layout name already exists
        if (layouts.badgeLayouts.some(l => l.name === layoutName)) {
            return { success: false, error: 'Layout name already exists' };
        }

        // Add new layout
        layouts.badgeLayouts.push({
            name: layoutName,
            badges: displayBadges,
            createdAt: new Date()
        });

        await this.db.collection('users').updateOne(
            { discordId: userId },
            { $set: { badgeLayouts: layouts.badgeLayouts } }
        );

        return { success: true };
    }

    /**
     * Load a saved badge display layout
     * @param {string} userId - Discord user ID
     * @param {string} layoutName - Name of the layout to load
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async loadLayout(userId, layoutName) {
        if (!this._checkRateLimit(userId)) {
            return { success: false, error: 'Too many updates. Please wait a moment.' };
        }

        const user = await this.db.collection('users').findOne(
            { discordId: userId },
            { projection: { badgeLayouts: 1, badges: 1 } }
        );

        if (!user?.badgeLayouts) {
            return { success: false, error: 'No saved layouts found' };
        }

        const layout = user.badgeLayouts.find(l => l.name === layoutName);
        if (!layout) {
            return { success: false, error: 'Layout not found' };
        }

        // Verify user still owns all badges in layout
        const validBadges = layout.badges.filter(b => 
            b.badgeId === null || user.badges.includes(b.badgeId)
        );

        if (validBadges.length !== layout.badges.length) {
            return { success: false, error: 'Some badges in this layout are no longer available' };
        }

        // Update display with layout
        await this.db.collection('users').updateOne(
            { discordId: userId },
            { $set: { displayBadges: validBadges } }
        );

        return { success: true };
    }

    /**
     * Get all saved layouts for a user
     * @param {string} userId - Discord user ID
     * @returns {Promise<Array<{name: string, createdAt: Date}>>}
     */
    async getLayouts(userId) {
        const user = await this.db.collection('users').findOne(
            { discordId: userId },
            { projection: { badgeLayouts: 1 } }
        );

        return user?.badgeLayouts || [];
    }

    /**
     * Randomize badge display
     * @param {string} userId - Discord user ID
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async randomizeDisplay(userId) {
        if (!this._checkRateLimit(userId)) {
            return { success: false, error: 'Too many updates. Please wait a moment.' };
        }

        const { allBadges } = await this.getAvailableBadges(userId);
        if (allBadges.length === 0) {
            return { success: false, error: 'No badges available to display' };
        }

        // Shuffle badges and take first 3
        const shuffled = [...allBadges].sort(() => Math.random() - 0.5);
        const selectedBadges = shuffled.slice(0, 3);

        const displayBadges = [
            { slot: 1, badgeId: selectedBadges[0]?.badgeId || null },
            { slot: 2, badgeId: selectedBadges[1]?.badgeId || null },
            { slot: 3, badgeId: selectedBadges[2]?.badgeId || null }
        ];

        await this.db.collection('users').updateOne(
            { discordId: userId },
            { $set: { displayBadges } }
        );

        return { success: true };
    }
}

module.exports = BadgeDisplayManager; 