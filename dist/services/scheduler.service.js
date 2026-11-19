import { config } from '../config/env.js';
export class SchedulerService {
    /**
     * Generates a randomized schedule for N posts inside a time window
     * with guaranteed minimum gaps and natural human-like jitter.
     */
    generateRandomSchedule(count, options = {}) {
        if (count <= 0)
            return [];
        const minGapSec = (options.minGapMinutes ?? config.scheduler.defaultMinGapMinutes) * 60;
        const jitterSec = (options.jitterMinutes ?? config.scheduler.defaultJitterMinutes) * 60;
        // Parse target date and time window
        const targetDateStr = options.targetDate || new Date().toISOString().split('T')[0];
        const startStr = options.windowStart || config.scheduler.defaultWindowStart;
        const endStr = options.windowEnd || config.scheduler.defaultWindowEnd;
        const startDate = this.parseDateTime(targetDateStr, startStr);
        const endDate = this.parseDateTime(targetDateStr, endStr);
        const totalWindowSec = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
        if (totalWindowSec <= 0) {
            throw new Error(`Window end time (${endStr}) must be after start time (${startStr})`);
        }
        // Step 1: Divide the window into segments and sample random offsets
        const offsets = [];
        const step = totalWindowSec / count;
        for (let i = 0; i < count; i++) {
            const segStart = i * step;
            const segEnd = (i + 1) * step;
            // Pick random point in segment
            const randomOffset = segStart + Math.random() * (segEnd - segStart);
            offsets.push(Math.floor(randomOffset));
        }
        // Step 2: Sort chronological
        offsets.sort((a, b) => a - b);
        // Step 3: Enforce minimum gap between consecutive posts
        for (let i = 1; i < offsets.length; i++) {
            const gap = offsets[i] - offsets[i - 1];
            if (gap < minGapSec) {
                offsets[i] = offsets[i - 1] + minGapSec;
            }
        }
        // Step 4: Apply randomized jitter (e.g. ±1 to 3 minutes) & clamp to window
        const schedule = offsets.map((offset) => {
            const jitter = (Math.random() * 2 - 1) * jitterSec;
            let finalOffset = Math.round(offset + jitter);
            // Ensure it doesn't cross window boundary
            finalOffset = Math.max(0, Math.min(totalWindowSec, finalOffset));
            return new Date(startDate.getTime() + finalOffset * 1000);
        });
        return schedule;
    }
    parseDateTime(dateStr, timeOrIsoStr) {
        // If it's already an ISO string with 'T'
        if (timeOrIsoStr.includes('T')) {
            return new Date(timeOrIsoStr);
        }
        // If it's "HH:MM"
        const [hours, minutes] = timeOrIsoStr.split(':').map((v) => parseInt(v, 10));
        const d = new Date(dateStr);
        d.setHours(hours || 0, minutes || 0, 0, 0);
        return d;
    }
}
export const schedulerService = new SchedulerService();
