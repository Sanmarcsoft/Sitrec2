import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './tests_regression',
  testMatch: ['**/ui-playwright.test.js', '**/regression.test.js'],
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  maxFailures: 1,
  reporter: 'list',
  
  use: {
    baseURL: 'https://local.metabunk.org/sitrec',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'allow',
  },

  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=swiftshader',
            '--ignore-gpu-blocklist',
            '--enable-webgl',
            '--disk-cache-dir=./playwright-cache',
            '--disk-cache-size=1073741824',
          ],
        },
      },
    },
  ],
});
