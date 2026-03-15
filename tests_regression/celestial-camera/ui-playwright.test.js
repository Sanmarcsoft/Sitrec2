import {expect, test} from '@playwright/test';

test('shared celestial bodies sync to the rendering view camera', async ({page}) => {
    await page.goto('?custom=99999999/Moon%20Eclipse%20Test/20260314_190525.js&ignoreunload=1&regression=1', {
        waitUntil: 'load',
        timeout: 120000,
    });

    await page.waitForFunction(() => {
        return !!window.NodeMan && !!window.NodeMan.list && !!window.NodeMan.get("NightSkyNode");
    }, null, {timeout: 30000});

    // This sitch restores several camera/controller states after load.
    await page.waitForTimeout(8000);

    const result = await page.evaluate(() => {
        const mainView = window.NodeMan.get("mainView");
        const lookView = window.NodeMan.get("lookView");
        const nightSkyNode = window.NodeMan.get("NightSkyNode");
        const moonSprite = nightSkyNode.planets.planetSprites.Moon.sprite;

        const vec = (v) => ({x: v.x, y: v.y, z: v.z});
        const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

        const calls = [];
        const originalSync = nightSkyNode.syncPlanetSpritesToObserver.bind(nightSkyNode);
        nightSkyNode.syncPlanetSpritesToObserver = function (cameraPos, date, options) {
            calls.push({
                cameraPos: vec(cameraPos),
                storeState: options?.storeState ?? true,
            });
            return originalSync(cameraPos, date, options);
        };

        mainView.renderSky();
        const moonAfterMain = vec(moonSprite.position);
        const mainCall = calls.at(-1);

        lookView.renderSky();
        const moonAfterLook = vec(moonSprite.position);
        const lookCall = calls.at(-1);

        nightSkyNode.syncPlanetSpritesToObserver = originalSync;

        return {
            mainCall,
            lookCall,
            moonDelta: distance(moonAfterMain, moonAfterLook),
            mainCallError: distance(mainCall.cameraPos, vec(mainView.camera.position)),
            lookCallError: distance(lookCall.cameraPos, vec(lookView.camera.position)),
        };
    });

    expect(result.mainCall.storeState).toBe(false);
    expect(result.lookCall.storeState).toBe(false);
    expect(result.mainCallError).toBeLessThan(1e-6);
    expect(result.lookCallError).toBeLessThan(1e-6);
    expect(result.moonDelta).toBeGreaterThan(0.01);

    await page.screenshot({
        path: '/Users/mick/Dropbox/sitrec-dev/sitrec/test-results/celestial-camera-main-vs-look.png',
        fullPage: true,
    });
});
