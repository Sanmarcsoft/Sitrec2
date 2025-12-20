import {expect} from '@playwright/test';
import {existsSync, mkdirSync} from 'fs';
import {dirname} from 'path';

export async function takeScreenshotOrCompare(page, snapshotName, testInfo, options = {}) {
    const snapshotPath = testInfo.snapshotPath(`${snapshotName}.png`);
    const snapshotExists = existsSync(snapshotPath);
    
    const defaultOptions = {
        fullPage: true,
        threshold: 0.02,
        maxDiffPixels: 20000,
        timeout: 30000,
    };
    
    const mergedOptions = { ...defaultOptions, ...options };
    
    if (!snapshotExists) {
        console.log(`Creating new baseline snapshot: ${snapshotName} at ${snapshotPath}`);
        
        mkdirSync(dirname(snapshotPath), { recursive: true });
        await page.screenshot({ 
            path: snapshotPath,
            fullPage: mergedOptions.fullPage,
            timeout: mergedOptions.timeout
        });
        console.log(`✓ Created baseline snapshot: ${snapshotName}`);
    } else {
        await expect(page).toHaveScreenshot(`${snapshotName}.png`, mergedOptions);
    }
}
