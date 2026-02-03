import {expect, test} from '@playwright/test';

async function waitForConsoleText(page, expectedText, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timed out waiting for console text: "${expectedText}"`));
        }, timeoutMs);

        const handler = (msg) => {
            if (msg.text().includes(expectedText)) {
                clearTimeout(timeout);
                page.off('console', handler);
                resolve();
            }
        };

        page.on('console', handler);
    });
}

test.describe('Mobile Viewport Testing', () => {
    test('should start without errors on iPhone-sized viewport', async ({ page }, testInfo) => {
        const pageErrors = [];

        page.on('console', msg => {
            console.log(`[MOBILE] PAGE CONSOLE [${msg.type()}]: ${msg.text()}`);
        });

        page.on('pageerror', err => {
            console.log(`[MOBILE] PAGE ERROR:`, err.message);
            pageErrors.push(err.message);
        });

        await page.setViewportSize({ width: 390, height: 844 });

        const consolePromise = waitForConsoleText(page, 'No pending actions', 60000);

        await page.goto('?frame=10&ignoreunload=1&regression=1', {
            waitUntil: 'load',
            timeout: 30000
        });

        await consolePromise;

        await page.evaluate(() => {
            return new Promise((resolve) => {
                let frameCount = 0;
                function waitForFrames() {
                    frameCount++;
                    if (frameCount < 3) {
                        requestAnimationFrame(waitForFrames);
                    } else {
                        resolve();
                    }
                }
                requestAnimationFrame(waitForFrames);
            });
        });

        expect(pageErrors, `Page errors occurred: ${pageErrors.join(', ')}`).toHaveLength(0);
    });
});
