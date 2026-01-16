// DebugLog.js - Console capture and export for debugging
// Hooks into console.log, console.error, and console.warn to capture all output
// Provides export functionality to download logs as a text file

const debugLog = {
    buffer: [],
    maxEntries: 10000,  // Prevent memory issues on long sessions
    originalMethods: {},
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // Only intercept console in production builds
        // In development, we want normal console behavior with correct line numbers in devtools
        const isProduction = process.env.NODE_ENV === 'production';
        if (!isProduction) {
            return;
        }

        const self = this;

        // Store original methods
        this.originalMethods.log = console.log;
        this.originalMethods.error = console.error;
        this.originalMethods.warn = console.warn;

        // Use Proxy to intercept calls
        console.log = new Proxy(this.originalMethods.log, {
            apply(target, thisArg, args) {
                self.capture('LOG', args);
                return Reflect.apply(target, thisArg, args);
            }
        });

        console.error = new Proxy(this.originalMethods.error, {
            apply(target, thisArg, args) {
                self.capture('ERROR', args);
                return Reflect.apply(target, thisArg, args);
            }
        });

        console.warn = new Proxy(this.originalMethods.warn, {
            apply(target, thisArg, args) {
                self.capture('WARN', args);
                return Reflect.apply(target, thisArg, args);
            }
        });
    },

    capture(level, args) {
        const timestamp = new Date().toISOString();
        const message = args.map(arg => {
            if (arg instanceof Error) {
                return `${arg.message}\n${arg.stack}`;
            }
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return '[Circular/Unserializable Object]';
                }
            }
            return String(arg);
        }).join(' ');

        this.buffer.push(`[${timestamp}] ${level}: ${message}`);

        // Trim old entries if we exceed max
        if (this.buffer.length > this.maxEntries) {
            this.buffer.shift();
        }
    },

    export() {
        if (this.buffer.length === 0) {
            const isProduction = process.env.NODE_ENV === 'production';
            if (!isProduction) {
                alert('Debug log capture is disabled in development builds.\nUse a production build (npm run deploy) to capture logs.');
            } else {
                alert('Debug log is empty');
            }
            return;
        }

        const content = this.buffer.join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        // Timestamp format: sitrec-debug-2026-01-16T10-30-45.log
        a.download = `sitrec-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
        a.click();

        URL.revokeObjectURL(url);
    },

    clear() {
        this.buffer = [];
    },

    getEntryCount() {
        return this.buffer.length;
    }
};

export { debugLog };
