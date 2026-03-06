import {test} from '@playwright/test';
import {takeScreenshotOrCompare} from './snapshot-utils.js';

// Array of test cases: each object contains a name and its corresponding URL.
// URLs are relative to baseURL configured in playwright.config.js
// Update TEST_REGISTRY is these are changed
const testDataDefault = [
    { id: "testquick", name: "testquick", url: "?testAll=2", waitFor: "All tests complete"},
    { id: 'default', name: 'default', url: '?frame=10' },
 //   { id: 'wmts', name: 'WMTS', url: '?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Regression%20test%20NRL%20WMTS/20251204_001658.js&mapType=WMTS' },
    { id: 'agua', name: 'agua', url: '?sitch=agua&frame=10' },
    { id: 'ocean', name: 'ocean surface', url: '?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/REGRESSION%20TEST%20_%20Ocean%20Surface/20251114_234141.js&frame=10&mapType=OceanSurface' },
    { id: 'gimbal', name: 'gimbal', url: '?sitch=gimbal&frame=10', timeout: 120000 },
    { id: 'starlink', name: 'starlink', url: '?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Stalink%20Names/20250218_060544.js' },
    { id: "potomac", name: "potomac", url: "?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Potomac/20250204_203812.js&frame=10" },
    { id: "orion", name: "orion", url: "?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Orion%20in%20Both%20views%20for%20Label%20Check/20251127_200130.js&frame=10" },
    { id: "bledsoe", name: "bledsoe", url: "?custom=https://sitrec.s3.us-west-2.amazonaws.com/15857/BledsoeZoom/20250623_153507.js&frame=10" },
    { id: "mosul", name: "mosul", url: "?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Mosul%20Orb/20250707_055311.js&frame=62"},
];


// unit tests for trackfile related rendering
const testDataTrackFiles = [
    { id: "multi-csv", name: "multi-CSV", url: "?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/REGRESSION%20_%20MULTI%20TRACK%20CSV%20AIRCRAFT/20251030_044434.js&frame=620"},
    { id: "mosul", name: "mosul", url: "?custom=https://sitrec.s3.us-west-2.amazonaws.com/99999999/Mosul%20Orb/20250707_055311.js&frame=62"},
]

function buildRegressionUrl(url) {
    const hasParam = (input, key) => new RegExp(`[?&]${key}=`).test(input);
    let fullUrl = url;

    if (!fullUrl.includes("?")) {
        fullUrl += "?";
    }

    const additions = [];
    if (!hasParam(fullUrl, "ignoreunload")) additions.push("ignoreunload=1");
    if (!hasParam(fullUrl, "regression")) additions.push("regression=1");

    if (additions.length > 0) {
        const needsJoin = !fullUrl.endsWith("?") && !fullUrl.endsWith("&");
        fullUrl += `${needsJoin ? "&" : ""}${additions.join("&")}`;
    }

    return fullUrl;
}

async function waitForFrames(page, count = 1, maxWaitMs = 5000) {
    // Avoid page.evaluate here: under heavy GPU/video load, main-thread stalls can make
    // evaluate itself hit the Playwright test timeout.
    const targetMs = Math.max(1, count) * 16;
    await page.waitForTimeout(Math.min(maxWaitMs, targetMs));
}

async function getSceneSettleState(page) {
    return page.evaluate(() => {
        const globals = window.Globals;
        const nodeMan = window.NodeMan;
        const loadingDiv = document.getElementById("loadingIndicator");
        const terrainUI = nodeMan?.get ? nodeMan.get("terrainUI") : null;

        const state = {
            ready: !!globals && !!nodeMan && !!nodeMan.list,
            pendingActions: 0,
            deserializing: false,
            parsing: 0,
            loadingVisible: false,
            texturePendingLoads: 0,
            textureLoading: 0,
            textureRecalc: 0,
            textureNeedsHighRes: 0,
            texturePendingAncestor: 0,
            elevationLoading: 0,
            elevationRecalc: 0,
            elevationPendingAncestor: 0,
            pending3DTiles: 0,
            activeVisibleTextureTiles: 0,
            mapType: terrainUI?.mapType || "",
            elevationType: terrainUI?.elevationType || "",
            sitName: window.Sit?.name || "",
            visibleTileHash: 0,
        };

        if (!state.ready) {
            return state;
        }

        state.pendingActions = globals.pendingActions ?? 0;
        state.deserializing = !!globals.deserializing;
        state.parsing = globals.parsing ?? 0;
        state.loadingVisible = !!loadingDiv
            && loadingDiv.style.display !== "none"
            && (loadingDiv.textContent || "").includes("Loading");

        const hashString = (input) => {
            let hash = 2166136261;
            for (let i = 0; i < input.length; i++) {
                hash ^= input.charCodeAt(i);
                hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
            }
            return hash >>> 0;
        };

        for (const entry of Object.values(nodeMan.list)) {
            const node = entry?.data;
            if (!node) continue;

            if (node.elevationMap && node.elevationMap.forEachTile) {
                node.elevationMap.forEachTile((tile) => {
                    const active = (tile.tileLayers ?? 0) !== 0;
                    if (!active) return;
                    if (tile.isLoadingElevation) state.elevationLoading++;
                    if (tile.isRecalculatingCurve) state.elevationRecalc++;
                    if (tile.pendingAncestorLoad) state.elevationPendingAncestor++;
                });
            }

            if (node.maps) {
                for (const mapID in node.maps) {
                    const map = node.maps[mapID]?.map;
                    if (!map || !map.forEachTile) continue;

                    if (map.pendingTileLoads && typeof map.pendingTileLoads.size === "number") {
                        state.texturePendingLoads += map.pendingTileLoads.size;
                    }

                    map.forEachTile((tile) => {
                        const active = (tile.tileLayers ?? 0) !== 0;
                        const visible = !!tile.mesh?.visible;
                        if (!active || !visible) return;

                        state.activeVisibleTextureTiles++;
                        if (tile.isLoading) state.textureLoading++;
                        if (tile.isRecalculatingCurve) state.textureRecalc++;
                        if (tile.needsHighResLoad) state.textureNeedsHighRes++;
                        if (tile.pendingAncestorLoad) state.texturePendingAncestor++;

                        const sig = `${mapID}:${tile.z}/${tile.x}/${tile.y}:${tile.usingParentData ? 1 : 0}:${tile.needsHighResLoad ? 1 : 0}`;
                        state.visibleTileHash = (state.visibleTileHash ^ hashString(sig)) >>> 0;
                    });
                }
            }

            if (typeof node.getPendingLoadState === "function") {
                const pending = node.getPendingLoadState();
                if (pending?.hasPending) {
                    state.pending3DTiles++;
                }
            }
        }

        return state;
    });
}

function isScenePending(state) {
    if (!state.ready) return true;
    return state.pendingActions > 0
        || state.deserializing
        || state.parsing > 0
        || state.loadingVisible
        || state.texturePendingLoads > 0
        || state.textureLoading > 0
        || state.textureRecalc > 0
        || state.texturePendingAncestor > 0
        || state.elevationLoading > 0
        || state.elevationRecalc > 0
        || state.elevationPendingAncestor > 0
        || state.pending3DTiles > 0;
}

function formatSceneSettleState(state) {
    return [
        `sit=${state.sitName || "?"}`,
        `map=${state.mapType || "?"}`,
        `elev=${state.elevationType || "?"}`,
        `pendingActions=${state.pendingActions}`,
        `deserializing=${state.deserializing ? 1 : 0}`,
        `parsing=${state.parsing}`,
        `loadingUI=${state.loadingVisible ? 1 : 0}`,
        `texPendingSet=${state.texturePendingLoads}`,
        `texLoading=${state.textureLoading}`,
        `texRecalc=${state.textureRecalc}`,
        `texNeedsHighRes=${state.textureNeedsHighRes}`,
        `texPendingAncestor=${state.texturePendingAncestor}`,
        `elevLoading=${state.elevationLoading}`,
        `elevRecalc=${state.elevationRecalc}`,
        `elevPendingAncestor=${state.elevationPendingAncestor}`,
        `pending3DTiles=${state.pending3DTiles}`,
        `activeTexVisible=${state.activeVisibleTextureTiles}`,
        `tileHash=${state.visibleTileHash}`,
    ].join(", ");
}

async function waitForSceneToSettle(page, {
    maxWaitMs = 90000,
    stableChecks = 20,
    minWaitMs = 3000,
} = {}) {
    const startMs = Date.now();
    let checks = 0;
    let stableCount = 0;
    let lastSignature = "";
    let observedBusy = false;

    while (Date.now() - startMs < maxWaitMs) {
        const state = await getSceneSettleState(page);
        const pending = isScenePending(state);
        const signature = `${state.activeVisibleTextureTiles}:${state.visibleTileHash}`;

        if (pending) {
            observedBusy = true;
            stableCount = 0;
            lastSignature = "";
        } else {
            if (signature === lastSignature) {
                stableCount++;
            } else {
                stableCount = 1;
                lastSignature = signature;
            }

            const elapsedMs = Date.now() - startMs;
            const canFinish = (observedBusy || elapsedMs >= minWaitMs) && stableCount >= stableChecks;
            if (canFinish) {
                return { timedOut: false, state };
            }
        }

        checks++;
        if (checks % 120 === 0) {
            console.log(`[SETTLE] Waiting... ${formatSceneSettleState(state)}`);
        }
        await waitForFrames(page, 2);
    }

    const finalState = await getSceneSettleState(page);
    console.warn(`[SETTLE] Timeout after ${maxWaitMs}ms: ${formatSceneSettleState(finalState)}`);
    return { timedOut: true, state: finalState };
}


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
    testData.forEach(({ id, name, url, waitFor, timeout }) => {
        test(`should match the baseline screenshot for ${name}`, async ({ page }, testInfo) => {
            console.log(`[TEST:${id}:STARTED]`);
            
            try {
                test.setTimeout(waitFor ? 900000 : 300000);

                await page.setViewportSize({ width: 1920, height: 1080 });

                let assertionReject;
                const assertionPromise = new Promise((_, reject) => {
                    assertionReject = reject;
                });

                page.on('console', msg => {
                    const text = msg.text();
                    const type = msg.type();
                    console.log(`[WORKER-${testInfo.workerIndex}] PAGE CONSOLE [${type}]: ${text}`);
                    if (text.includes('ASSERT:')) {
                        console.error(`[WORKER-${testInfo.workerIndex}] ASSERTION FAILURE DETECTED: ${text}`);
                        assertionReject(new Error(`ASSERTION FAILURE: ${text}`));
                    } else if (type === 'error') {
                        console.error(`[WORKER-${testInfo.workerIndex}] CONSOLE ERROR DETECTED: ${text}`);
                        assertionReject(new Error(`CONSOLE ERROR: ${text}`));
                    }
                });

                page.on('pageerror', err => {
                    console.log(`[WORKER-${testInfo.workerIndex}] PAGE ERROR:`, err);
                });

                page.on('response', res => {
                    if (res.status() >= 400) {
                        console.log(`[WORKER-${testInfo.workerIndex}] Failed response: ${res.url()} - Status: ${res.status()}`);
                    }
                });

                page.on('requestfailed', req => {
                    console.log(`[WORKER-${testInfo.workerIndex}] Request failed: ${req.url()}`);
                });

                const fullUrl = buildRegressionUrl(url);

                const runTest = async () => {
                    const expectedText = waitFor || 'No pending actions';
                    const consoleTimeout = waitFor ? 600000 : (timeout || 60000);
                    const consolePromise = waitForConsoleText(page, expectedText, consoleTimeout);
                    console.log(`[WORKER-${testInfo.workerIndex}] Loading URL for ${name}: ${fullUrl}`);

                    const response = await page.goto(fullUrl, {
                        waitUntil: 'load',
                        timeout: 30000
                    });

                    if (!response.ok()) {
                        console.error(`[WORKER-${testInfo.workerIndex}] Page load failed with status: ${response.status()} for URL: ${fullUrl}`);
                    }

                    await consolePromise;

                    const settleMaxWait = waitFor ? 180000 : Math.max(timeout || 60000, 90000);
                    const settleResult = await waitForSceneToSettle(page, {
                        maxWaitMs: settleMaxWait,
                    });
                    console.log(`[SETTLE] Ready (${settleResult.timedOut ? "timed out" : "stable"}): ${formatSceneSettleState(settleResult.state)}`);

                    await waitForFrames(page, 5);

                    // Log resolved terrain settings for debugability across custom sitches.
                    const finalState = await getSceneSettleState(page);
                    console.log(`[SETTLE] Final terrain: map=${finalState.mapType || "?"}, elev=${finalState.elevationType || "?"}`);

                    await page.evaluate(() => {
                        // Ensure any queued render pass executes before screenshot.
                        if (window.setRenderOne) {
                            window.setRenderOne(true);
                        }
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
                            }
                        }
                    });
                };

                await Promise.race([runTest(), assertionPromise]);

                console.log(`[TEST:${id}:PASSED]`);
            } catch (error) {
                console.log(`[TEST:${id}:FAILED]`);
                throw error;
            }
        });
    });
});
