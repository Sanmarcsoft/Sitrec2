// DebugLog.js - Console capture and export for debugging
// Hooks into console.log, console.error, and console.warn to capture all output
// Provides export functionality to download logs as a text file

import {Globals} from "./Globals";

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

        // Capture the actual call site from the stack trace
        // Stack format: "Error\n    at capture (DebugLog.js:X)\n    at Proxy.apply (DebugLog.js:Y)\n    at actualCaller (file.js:Z)"
        const stack = new Error().stack;
        const callerLine = this.extractCaller(stack);

        this.buffer.push(`[${timestamp}] ${level}: ${callerLine} ${message}`);

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

        // Build filename with user info if logged in
        // Format: sitrec-debug-[userID-username-]2026-01-16T10-30-45.log
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        let filename = 'sitrec-debug-';

        if (Globals.userID && Globals.userID > 0) {
            // Sanitize username for filename (remove invalid chars)
            const safeUsername = Globals.userName
                ? Globals.userName.replace(/[^a-zA-Z0-9_-]/g, '_')
                : '';
            filename += `${Globals.userID}`;
            if (safeUsername) {
                filename += `-${safeUsername}`;
            }
            filename += '-';
        }
        filename += `${timestamp}.log`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
    },

    clear() {
        this.buffer = [];
    },

    getEntryCount() {
        return this.buffer.length;
    },

    // Extract the actual caller location from a stack trace, skipping DebugLog internals
    extractCaller(stack) {
        if (!stack) return '';

        const lines = stack.split('\n');
        // Find the first line that's NOT from DebugLog.js
        // Stack looks like:
        //   Error
        //   at capture (DebugLog.js:66)
        //   at Proxy.<anonymous> (DebugLog.js:28)
        //   at actualFunction (SomeFile.js:123)  <-- we want this
        for (const line of lines) {
            if (line.includes('DebugLog.js') || line.trim() === 'Error') {
                continue;
            }
            // Extract just the relevant part: "SomeFile.js:123" or "(SomeFile.js:123:45)"
            // Handle both formats: "at func (file:line:col)" and "at file:line:col"
            const match = line.match(/\(([^)]+)\)/) || line.match(/at\s+(\S+:\d+)/);
            if (match) {
                // Return just filename:line (strip full path and column)
                const fullPath = match[1];
                // Get just the filename and line number
                const fileMatch = fullPath.match(/([^/\\]+:\d+)/);
                return fileMatch ? `[${fileMatch[1]}]` : `[${fullPath}]`;
            }
        }
        return '';
    }
};

export { debugLog };
