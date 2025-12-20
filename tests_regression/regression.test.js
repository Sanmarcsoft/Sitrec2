import {test} from '@playwright/test';
import {takeScreenshotOrCompare} from './snapshot-utils.js';

// Array of test cases: each object contains a name and its corresponding URL.
const testDataDefault = [
    { name: 'default', url: 'https://local.metabunk.org/sitrec/?frame=10' },
    { name: 'WMTS', url: 'https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Regression%20test%20NRL%20WMTS/20251204_001658.js' },
    { name: 'agua', url: 'https://local.metabunk.org/sitrec/?sitch=agua&frame=10' },
    { name: 'ocean surface', url: 'https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/REGRESSION%20TEST%20_%20Ocean%20Surface/20251114_234141.js&frame=10' },
 //   { name: 'pseudo color', url: 'https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/REGRESSION%20TEST%20_%20ELEVATION%20PSEUDOCOLOR/20251115_000233.js&frame=10' },
    { name: 'gimbal', url: 'https://local.metabunk.org/sitrec/?sitch=gimbal&frame=10' },
    { name: 'starlink', url: 'https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Stalink%20Names/20250218_060544.js' },
    { name: "potomac", url: "https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Potomac/20250204_203812.js&frame=10" },
    { name: "orion", url: "https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Orion%20in%20Both%20views%20for%20Label%20Check/20251127_200130.js&frame=10" },
    { name: "bledsoe", url: "https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/15857/BledsoeZoom/20250623_153507.js&frame=10" },
    { name: "mosul", url: "https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Mosul%20Orb/20250707_055311.js&frame=62"},
    // Add more objects as needed.
];


// unit tests for trackfile related rendering
const testDataTrackFiles = [
    { name: "multi-CSV", url: "https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/REGRESSION%20_%20MULTI%20TRACK%20CSV%20AIRCRAFT/20251030_044434.js&frame=620"},

    // we include mosul here as it has some building loaded from a KML file
    // so we need to ensure
    { name: "mosul", url: "https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Mosul%20Orb/20250707_055311.js&frame=62"},
]


async function waitForConsoleText(page, expectedText, timeoutMs = 30000) {
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

let testData;
if (process.env.TEST_TRACKFILES === 'true') {
    testData = testDataTrackFiles;
} else {
    testData = testDataDefault;
}

test.describe('Visual Regression Testing', () => {
    testData.forEach(({ name, url }) => {
        test(`should match the baseline screenshot for ${name}`, async ({ page }, testInfo) => {
            test.setTimeout(60000);

            await page.setViewportSize({ width: 1920, height: 1080 });

            page.on('console', msg => {
                console.log(`PAGE CONSOLE [${msg.type()}]: ${msg.text()}`);
            });

            page.on('pageerror', err => {
                console.log('PAGE ERROR:', err);
            });

            page.on('response', res => {
                if (res.status() >= 400) {
                    console.log(`Failed response: ${res.url()} - Status: ${res.status()}`);
                }
            });

            page.on('requestfailed', req => {
                console.log(`Request failed: ${req.url()}`);
            });

            const fullUrl = url + '&ignoreunload=1&regression=1';

            const consolePromise = waitForConsoleText(page, 'No pending actions');

            const response = await page.goto(fullUrl, {
                waitUntil: 'load',
                timeout: 30000
            });

            if (!response.ok()) {
                console.error(`Page load failed with status: ${response.status()} for URL: ${fullUrl}`);
            }

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

            await takeScreenshotOrCompare(page, `${name}-snapshot`, testInfo);

            await page.evaluate(() => {
                if (window.Globals && window.Globals.renderData) {
                    try {
                        window.Globals.renderData.forEach(rd => {
                            if (rd.renderer) {
                                rd.renderer.dispose();
                            }
                            if (rd._resizeTimeout) {
                                clearTimeout(rd._resizeTimeout);
                                rd._resizeTimeout = null;
                            }
                        });
                    } catch (e) {
                        // ignore errors during cleanup
                    }
                }
            });
        });
    });
});
