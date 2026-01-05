const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ ignoreHTTPSErrors: true });
  const page = await browser.newPage();

  let operationsCompleted = false;

  // Capture console messages and wait for completion
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('All pending operations completed')) {
      console.log('✓ Found: All pending operations completed');
      operationsCompleted = true;
    }
  });

  try {
    console.log('Loading https://local.metabunk.org/sitrec/ ...');
    await page.goto('https://local.metabunk.org/sitrec/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    console.log('Page loaded, waiting for operations to complete...');

    // Wait for the completion message (up to 30 seconds)
    const startTime = Date.now();
    while (!operationsCompleted && (Date.now() - startTime) < 30000) {
      await page.waitForTimeout(100);
    }

    if (operationsCompleted) {
      console.log('Operations completed! Taking screenshot...');
      await page.screenshot({
        path: '/tmp/sitrec-screenshot.png',
        fullPage: false
      });
      console.log('✓ Screenshot saved to /tmp/sitrec-screenshot.png');
    } else {
      console.log('⚠ Timeout waiting for operations, taking screenshot anyway...');
      await page.screenshot({
        path: '/tmp/sitrec-screenshot.png',
        fullPage: false
      });
      console.log('Screenshot saved to /tmp/sitrec-screenshot.png');
    }

  } catch (error) {
    console.log(`[ERROR] ${error.message}`);
  } finally {
    await browser.close();
  }
})();
