import {isServerless, SITREC_SERVER} from "./configUtils";

const SERVICE_PATTERNS = {
    mapbox: /api\.mapbox\.com/i,
    maptiler: /maptiler/i,
    aws: /s3\.amazonaws\.com|elevation-tiles-prod/i,
    osm: /openstreetmap\.org|tile\.osm/i,
    eox: /tiles\.maps\.eox\.at/i,
};

class TileUsageTrackerClass {
    constructor() {
        this.usage = {};
        this.limits = null;
        this.remaining = null;
        this.pendingReport = {};
        this.reportInterval = null;
        this.reportBatchSize = 50;
        this.reportIntervalMs = 30000;
        this.initialized = false;
        this.disabled = false;
        this.blocked = {};
        this.warnings = {};
    }

    async init() {
        if (this.initialized || isServerless) return;
        if (process.env.SITREC_TRACK_STATS !== 'true') return;
        
        try {
            await this.fetchLimits();
            if (this.disabled) return;
            this.startReportingInterval();
            this.setupUnloadHandler();
            this.initialized = true;
        } catch (e) {
            console.warn('TileUsageTracker: Failed to initialize', e);
        }
    }

    async fetchLimits() {
        try {
            const response = await fetch(SITREC_SERVER + 'tile_usage.php', {
                credentials: 'include',
            });
            if (!response.ok) return;
            
            const data = await response.json();
            if (data.disabled) {
                this.disabled = true;
                return;
            }
            this.limits = data.limits;
            this.remaining = data.remaining;
            this.usage = data.usage || {};
        } catch (e) {
            console.warn('TileUsageTracker: Failed to fetch limits', e);
        }
    }

    identifyService(url) {
        if (!url) return 'other';
        
        for (const [service, pattern] of Object.entries(SERVICE_PATTERNS)) {
            if (pattern.test(url)) {
                return service;
            }
        }
        return 'other';
    }

    trackTile(url) {
        if (isServerless) return;
        
        const service = this.identifyService(url);
        
        this.pendingReport[service] = (this.pendingReport[service] || 0) + 1;
        this.usage[service] = (this.usage[service] || 0) + 1;
        
        if (this.remaining) {
            this.remaining[service] = Math.max(0, (this.remaining[service] || 0) - 1);
        }
        
        const totalPending = Object.values(this.pendingReport).reduce((a, b) => a + b, 0);
        if (totalPending >= this.reportBatchSize) {
            this.reportUsage();
        }
    }

    isBlocked(service) {
        if (!this.limits || !this.remaining) return false;
        return (this.remaining[service] || 0) <= 0;
    }

    getRemaining(service) {
        if (!this.remaining) return Infinity;
        return this.remaining[service] ?? this.remaining.other ?? Infinity;
    }

    async reportUsage() {
        if (isServerless) return;
        
        const toReport = {...this.pendingReport};
        this.pendingReport = {};
        
        const totalToReport = Object.values(toReport).reduce((a, b) => a + b, 0);
        if (totalToReport === 0) return;
        
        try {
            const response = await fetch(SITREC_SERVER + 'tile_usage.php', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({usage: toReport}),
                credentials: 'include',
            });
            
            if (!response.ok) return;
            
            const data = await response.json();
            this.remaining = data.remaining;
            this.blocked = data.blocked || {};
            this.warnings = data.warnings || {};
            
            if (Object.keys(this.warnings).length > 0) {
                for (const [service, info] of Object.entries(this.warnings)) {
                    console.warn(`TileUsageTracker: ${service} usage warning - ${info.used}/${info.limit} (${info.remaining} remaining)`);
                }
            }
            
            if (Object.keys(this.blocked).length > 0) {
                for (const [service, info] of Object.entries(this.blocked)) {
                    console.error(`TileUsageTracker: ${service} BLOCKED - ${info.used}/${info.limit} exceeded`);
                }
            }
        } catch (e) {
            Object.entries(toReport).forEach(([service, count]) => {
                this.pendingReport[service] = (this.pendingReport[service] || 0) + count;
            });
        }
    }

    startReportingInterval() {
        if (this.reportInterval) return;
        
        this.reportInterval = setInterval(() => {
            this.reportUsage();
        }, this.reportIntervalMs);
    }

    stopReportingInterval() {
        if (this.reportInterval) {
            clearInterval(this.reportInterval);
            this.reportInterval = null;
        }
    }

    setupUnloadHandler() {
        window.addEventListener('beforeunload', () => {
            this.reportUsage();
        });
        
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.reportUsage();
            }
        });
    }

    getUsageSummary() {
        return {
            usage: this.usage,
            limits: this.limits,
            remaining: this.remaining,
            blocked: this.blocked,
            warnings: this.warnings,
        };
    }
}

export const TileUsageTracker = new TileUsageTrackerClass();
