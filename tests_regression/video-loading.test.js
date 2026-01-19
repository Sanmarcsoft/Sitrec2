import {expect, test} from '@playwright/test';

test.describe('Video Loading Manager Tests', () => {
    test('should load custom sitch with multiple video types', async ({ page }, testInfo) => {
        test.setTimeout(180000);

        await page.setViewportSize({ width: 1920, height: 1080 });

        const videoLoadingMessages = [];
        const allMessages = [];
        
        page.on('console', msg => {
            const text = msg.text();
            allMessages.push(text);
            
            if (text.includes('[Video') || text.includes('H.264') || 
                text.includes('VideoLoadingManager') || text.includes('_loadingId') ||
                text.includes('initializeCaching') || text.includes('loadedCallback') ||
                text.includes('completeLoading') || text.includes('registerLoading') ||
                text.includes('WARNING')) {
                videoLoadingMessages.push(text);
                console.log(`VIDEO: ${text}`);
            }
            
            if (text.includes('pending actions') || text.includes('Pending actions')) {
                console.log(`STATUS: ${text}`);
            }
        });

        page.on('pageerror', err => {
            console.log(`PAGE ERROR: ${err}`);
        });

        const url = '?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/with%201/20260119_081547.js&ignoreunload=1&regression=1';
        
        // Set up listener for "No pending actions" BEFORE navigating
        const waitForNoPending = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.log('Timeout - checking final pendingActions value');
                reject(new Error('Timeout waiting for No pending actions'));
            }, 120000);
            const handler = (msg) => {
                if (msg.text().includes('No pending actions')) {
                    clearTimeout(timeout);
                    page.off('console', handler);
                    resolve();
                }
            };
            page.on('console', handler);
        });
        
        console.log('Loading URL...');
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        
        await waitForNoPending;
        console.log('Received "No pending actions"');
        
        // Check loading indicator is hidden
        const loadingIndicator = await page.$('#videoLoadingIndicator');
        if (loadingIndicator) {
            const isVisible = await loadingIndicator.isVisible();
            console.log(`Loading indicator visible after completion: ${isVisible}`);
            expect(isVisible).toBe(false);
        }
        
        // Check Globals.pendingActions is 0
        const pendingActions = await page.evaluate(() => {
            return typeof Globals !== 'undefined' ? Globals.pendingActions : -1;
        });
        console.log(`Globals.pendingActions: ${pendingActions}`);
        expect(pendingActions).toBe(0);
        
        // Print all video loading messages for debugging
        console.log('\n=== VIDEO LOADING MESSAGES ===');
        videoLoadingMessages.forEach(m => console.log(m));
        
        // Check that we saw video loading complete messages
        const completionMessages = videoLoadingMessages.filter(m => m.includes('[VideoLoaded]'));
        console.log(`\nVideo completion messages: ${completionMessages.length}`);
    });
});
