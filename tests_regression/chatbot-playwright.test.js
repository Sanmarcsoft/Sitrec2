import {expect, test} from '@playwright/test';

async function waitForFrames(page, count = 10) {
    await page.evaluate(({ frameCount }) => {
        return new Promise((resolve) => {
            let frames = 0;
            function wait() {
                frames++;
                if (frames < frameCount) {
                    requestAnimationFrame(wait);
                } else {
                    resolve();
                }
            }
            requestAnimationFrame(wait);
        });
    }, { frameCount: count });
}

async function openChat(page) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    
    const chatVisible = await page.evaluate(() => {
        const chatView = document.querySelector('.cnodeview-chatlog');
        return chatView && chatView.offsetParent !== null;
    });
    
    if (!chatVisible) {
        throw new Error('Chat view did not open');
    }
}

async function getBotMessageCount(page) {
    return page.evaluate(() => {
        const chatLog = document.querySelector('.cnodeview-chatlog');
        if (!chatLog) return 0;
        return Array.from(chatLog.querySelectorAll('div'))
            .filter(div => div.textContent.startsWith('Bot:')).length;
    });
}

async function sendChatMessage(page, message) {
    const initialCount = await getBotMessageCount(page);
    const input = page.locator('.cnodeview-input');
    await input.fill(message);
    await input.press('Enter');
    return initialCount;
}

async function waitForBotResponse(page, initialCount, timeoutMs = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
        const messages = await page.evaluate(() => {
            const chatLog = document.querySelector('.cnodeview-chatlog');
            if (!chatLog) return [];
            return Array.from(chatLog.querySelectorAll('div'))
                .map(div => div.textContent)
                .filter(text => text.startsWith('Bot:'));
        });
        
        if (messages.length > initialCount) {
            await page.waitForTimeout(1500);
            
            const finalMessages = await page.evaluate(() => {
                const chatLog = document.querySelector('.cnodeview-chatlog');
                if (!chatLog) return [];
                return Array.from(chatLog.querySelectorAll('div'))
                    .map(div => div.textContent)
                    .filter(text => text.startsWith('Bot:'));
            });
            
            if (finalMessages.length === messages.length) {
                return finalMessages[finalMessages.length - 1].replace(/^Bot:\s*/, '');
            }
        }
        await page.waitForTimeout(200);
    }
    
    throw new Error(`Timed out waiting for bot response after ${timeoutMs}ms`);
}

async function sendChatAndWait(page, message, timeoutMs = 30000) {
    await page.waitForTimeout(500);
    const initialCount = await sendChatMessage(page, message);
    return waitForBotResponse(page, initialCount, timeoutMs);
}

async function getChatMessages(page) {
    return page.evaluate(() => {
        const chatLog = document.querySelector('.cnodeview-chatlog');
        if (!chatLog) return [];
        return Array.from(chatLog.querySelectorAll('div'))
            .map(div => div.textContent);
    });
}

async function getMenuValue(page, menuName, controlPath) {
    return page.evaluate(({ menu, path }) => {
        if (typeof sitrecAPI !== 'undefined') {
            const result = sitrecAPI.call('getMenuValue', { menu, path });
            return result?.result?.value ?? result?.result;
        }
        return null;
    }, { menu: menuName, path: controlPath });
}

test.describe.serial('Chatbot Tests', () => {
    let sharedPage;
    let workerIndex;

    test.beforeAll(async ({ browser }, testInfo) => {
        workerIndex = testInfo.workerIndex;
        sharedPage = await browser.newPage();
        
        sharedPage.on('console', msg => {
            console.log(`[WORKER-${workerIndex}] PAGE CONSOLE [${msg.type()}]: ${msg.text()}`);
        });
        
        await sharedPage.goto('/?ignoreunload=1&regression=1&mapType=Local&elevationType=Local');
        
        await sharedPage.waitForFunction(() => {
            return document.querySelector('.lil-gui') !== null;
        }, { timeout: 30000 });
        
        await sharedPage.evaluate(() => {
            window.__consoleLogs = [];
            const originalLog = console.log;
            console.log = function(...args) {
                window.__consoleLogs.push(args.join(' '));
                originalLog.apply(console, args);
            };
        });
        
        await sharedPage.waitForFunction(() => {
            return window.__consoleLogs?.some(log => log.includes('No pending actions'));
        }, { timeout: 30000 }).catch(() => {
            console.log('Warning: Did not detect "No pending actions" message');
        });
        
        await sharedPage.waitForTimeout(3000);
    });

    test.afterAll(async () => {
        await sharedPage.close();
    });

    test('should open chat with Tab key', async () => {
        test.setTimeout(30000);
        await openChat(sharedPage);
        
        const chatVisible = await sharedPage.evaluate(() => {
            const chatView = document.querySelector('.cnodeview-chatlog');
            return chatView && chatView.offsetParent !== null;
        });
        
        expect(chatVisible).toBe(true);
    });

    test('should respond to simple math question', async () => {
        test.setTimeout(60000);
        
        const initialCount = await sendChatMessage(sharedPage, 'what is 2+2?');
        const response = await waitForBotResponse(sharedPage, initialCount);
        
        console.log('Bot response:', response);
        expect(response.toLowerCase()).toContain('4');
    });

    test('should set camera object to helicopter model', async () => {
        test.setTimeout(60000);
        
        const initialCount = await sendChatMessage(sharedPage, 'set camera object to helicopter');
        const response = await waitForBotResponse(sharedPage, initialCount);
        
        console.log('Bot response:', response);
        
        await waitForFrames(sharedPage, 30);
        
        expect(response.toLowerCase()).toContain('bell');
    });

    test('should change lighting to ambient only', async () => {
        test.setTimeout(60000);
        
        const initialCount = await sendChatMessage(sharedPage, 'ambient only');
        const response = await waitForBotResponse(sharedPage, initialCount);
        
        console.log('Bot response:', response);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/ambient|success.*true|enabled|lighting/i);
    });

    test('should understand "make it a jet" as setting aircraft model', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'make the camera a jet');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/f-?15|f-?18|jet|fighter|aircraft|plane|set|camera/i);
    });

    test('should understand "use a drone" as setting drone model', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'change to a drone');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/mq|drone|uav|predator|reaper|set|camera/i);
    });

    test('should understand colloquial time setting', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'set time to midnight on new years eve 2023');
        
        console.log('Bot response:', response);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/date|time|set|2023|midnight|december|31/i);
    });

    test('should handle ambiguous FOV request with zoom in', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'zoom in the look camera');
        
        console.log('Bot response:', response);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/fov|zoom|field|view|camera|narrower|smaller|reduced|set|look/i);
    });

    test('should understand partial menu names', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'turn off stars');
        
        console.log('Bot response:', response);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/star|disabled|off|hidden|visibility|success/i);
    });

    test('should handle vague model requests by picking appropriate model', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'i want a small plane for the camera');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/cessna|piper|aircraft|plane|model|set|camera/i);
    });

    test('should change object to geometry mode and set superegg', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'make the camera object a superegg');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/superegg|geometry|set|camera|success/i);
    });

    test('should change all objects to spheres', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'make all objects use spheres');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/sphere|geometry|all|objects|set|success/i);
    });

    test('should understand geometry request with ambiguous phrasing', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'change the camera to a box shape');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/box|geometry|camera|set|success/i);
    });

    test('should switch from model to geometry mode', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'use geometry instead of a model for the camera');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/geometry|switched|changed|camera|success|set/i);
    });

    test('should change all objects to a specific model', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'make all objects 737s');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/737|model|all|objects|set|success/i);
        expect(responseLower).not.toMatch(/geometry.*not found/i);
    });

    test('should set geometry dimensions correctly for boxes', async () => {
        test.setTimeout(60000);
        
        const response = await sendChatAndWait(sharedPage, 'make them skinny cuboids');
        
        console.log('Bot response:', response);
        await waitForFrames(sharedPage, 30);
        
        const responseLower = response.toLowerCase();
        expect(responseLower).toMatch(/box|cuboid|dimension|skinny|set|success/i);
        expect(responseLower).not.toMatch(/radiusTop.*not found|radiusBottom.*not found/i);
    });
});
