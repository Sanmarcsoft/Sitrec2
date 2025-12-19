import puppeteer from 'puppeteer';
import {toMatchImageSnapshot} from 'jest-image-snapshot';
import path from 'path';
import fs from 'fs';

expect.extend({ toMatchImageSnapshot });

// Array of test cases: each object contains a name and its corresponding URL.
const testDataDefault = [
    { name: 'default', url: 'https://local.metabunk.org/sitrec/?frame=10' },
    { name: 'WMTS', url: 'https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Regression%20test%20NRL%20WMTS/20251204_001658.js' },
    { name: 'agua', url: 'https://local.metabunk.org/sitrec/?sitch=agua&frame=10' },
    { name: 'ocean surface', url: 'https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/REGRESSION%20TEST%20_%20Ocean%20Surface/20251114_234141.js&frame=10' },
    { name: 'pseudo color', url: 'https://local.metabunk.org/sitrec/?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/REGRESSION%20TEST%20_%20ELEVATION%20PSEUDOCOLOR/20251115_000233.js&frame=10' },
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


/**
 * Wait for a specific text to appear in console messages.
 * @param {import('puppeteer').Page} page - Puppeteer page instance.
 * @param {string} expectedText - Text to wait for.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @returns {Promise<void>}
 */
function waitForConsoleText(page, expectedText, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            page.off('console', onConsole);
            reject(new Error(`Timed out waiting for console text: "${expectedText}"`));
        }, timeoutMs);

        function onConsole(msg) {
            if (msg.text().includes(expectedText)) {
                clearTimeout(timeout);
                page.off('console', onConsole);
                resolve();
            }
        }

        page.on('console', onConsole);
    });
}

describe('Visual Regression Testing', () => {
    let browser;
    let page;

    // Increase the timeout for the entire test suite.
    jest.setTimeout(60000);

    beforeAll(async () => {
        browser = await puppeteer.launch({
            headless: true,
            defaultViewport: {
                width: 1920,
                height: 1080,
            },
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    });
    
    beforeEach(async () => {
        // Create a fresh page for each test to avoid state bleed
        page = await browser.newPage();

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
            console.log(`Request failed: ${req.url()} - Error: ${req.failure().errorText}`);
        });

    });

    afterEach(async () => {
        // Clear renderer and WebGL state between tests
        try {
            await page.evaluate(() => {
                // Dispose of Three.js renderer to clean up WebGL context
                if (window.Globals && window.Globals.renderData) {
                    try {
                        window.Globals.renderData.forEach(rd => {
                            if (rd.renderer) {
                                rd.renderer.dispose();
                            }
                        });
                    } catch (e) {
                        // ignore errors during cleanup
                    }
                }
                // Cancel resize debounce timeout if it exists
                if (window.Globals && window.Globals.renderData) {
                    try {
                        window.Globals.renderData.forEach(rd => {
                            if (rd._resizeTimeout) {
                                clearTimeout(rd._resizeTimeout);
                                rd._resizeTimeout = null;
                            }
                        });
                    } catch (e) {
                        // ignore
                    }
                }
            });
        } catch (e) {
            // ignore if page is already closed
        }
        // Close the page to release all resources
        await page.close();
    });

    afterAll(async () => {
        await browser.close();
    });

    let testData;
    // based a command line argument, choose which set of tests to run
    if (process.env.TEST_TRACKFILES === 'true') {
        testData = testDataTrackFiles;
    } else {
        testData = testDataDefault;
    }

    // Iterate through each test data object.
    testData.forEach(({ name, url }) => {
        it(`should match the baseline screenshot for ${name}`, async () => {
            try {
                // Set a consistent viewport size.
                await page.setViewport({ width: 1920, height: 1080 });

                // Remove all existing 'console' listeners from previous test runs
                page.removeAllListeners('console');

                url = url+'&ignoreunload=1&regression=1';

                const consolePromise = waitForConsoleText(page, 'No pending actions', 35000);


                // Navigate to the URL with detailed error logging.
                // Wait for the network to be idle.
                const response = await page.goto(url, {
                    waitUntil: ['networkidle0', 'domcontentloaded'],
                    timeout: 30000
                });


                if (!response.ok()) {
                    console.error(`Page load failed with status: ${response.status()} for URL: ${url}`);
                }

                // wait a second to ensure the page is fully loaded.
                //await new Promise(resolve => setTimeout(resolve, 3000));

                await consolePromise;

                // Wait for any deferred resize timeouts to complete (100ms debounce)
                // Use a longer timeout to ensure all animations and loading settle
                await new Promise(resolve => setTimeout(resolve, 500));

                // Ensure the page is fully rendered after resize completes
                await page.evaluate(() => {
                    return new Promise((resolve) => {
                        // Wait multiple frames to ensure renderer has processed resize and rendered
                        let frameCount = 0;
                        function waitForFrames() {
                            frameCount++;
                            if (frameCount < 10) {
                                requestAnimationFrame(waitForFrames);
                            } else {
                                resolve();
                            }
                        }
                        requestAnimationFrame(waitForFrames);
                    });
                });



                // Take the screenshot with explicit encoding.
                const screenshot = await page.screenshot({
                    fullPage: true,
                    type: 'png',
                    encoding: 'binary'
                });

                // Ensure snapshot directory exists.
                const snapshotDir = path.join(process.cwd(), '__image_snapshots__');
                if (!fs.existsSync(snapshotDir)) {
                    fs.mkdirSync(snapshotDir, { recursive: true });
                }

                // Ensure the custom diff directory exists.
                const customDiffDir = path.join(snapshotDir, '__diff_output__');
                if (!fs.existsSync(customDiffDir)) {
                    fs.mkdirSync(customDiffDir, { recursive: true });
                }

                // Use the provided name as part of the snapshot identifier.
                const customConfig = {
                    customSnapshotIdentifier: () => `${name}-snapshot`,
                    customDiffConfig: {
                        threshold: 0.01, // 1% threshold for pixel color difference.
                    },
                    failureThreshold: 0.01, // 1% threshold for image diff percentage.
                    failureThresholdType: 'percent',
                    customSnapshotsDir: snapshotDir,
                    customDiffDir: customDiffDir,
                    // updateSnapshot: process.env.UPDATE_SNAPSHOT === 'true'
                };

                const screenshotBuffer = Buffer.from(screenshot);

                expect(screenshotBuffer).toMatchImageSnapshot(customConfig);
            } catch (error) {
                console.error(`Test for ${name} failed with error:`, error);
                console.error('Stack trace:', error.stack);
                throw error;
            }
        });
    });
});
