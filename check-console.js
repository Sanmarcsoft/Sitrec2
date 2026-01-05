const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ ignoreHTTPSErrors: true });
  const page = await browser.newPage();

  // Capture console messages
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[CONSOLE ${type.toUpperCase()}] ${text}`);
  });

  // Capture page errors
  page.on('pageerror', error => {
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  // Capture failed requests
  page.on('requestfailed', request => {
    console.log(`[REQUEST FAILED] ${request.url()} - ${request.failure().errorText}`);
  });

  try {
    console.log('Loading https://local.metabunk.org/sitrec/ ...');
    await page.goto('https://local.metabunk.org/sitrec/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('Page loaded successfully');

    // Wait a bit for any deferred scripts
    await page.waitForTimeout(3000);

  } catch (error) {
    console.log(`[LOAD ERROR] ${error.message}`);
  } finally {
    await browser.close();
  }
})();
