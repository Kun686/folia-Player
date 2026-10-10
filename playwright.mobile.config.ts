import { defineConfig } from '@playwright/test';

// playwright.mobile.config.ts — fixture transport only; not real-platform acceptance.
export default defineConfig({
  testDir: './test/mobile-ui', timeout: 30000, workers: 1, retries: 0,
  outputDir: '.mobile-test-results/playwright',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4179', locale: 'zh-CN', screenshot: 'only-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --config vite.mobile.config.ts --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179/mobile.html', timeout: 20000, reuseExistingServer: false },
  projects: [
    { name: 'phone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'ipad', use: { browserName: 'webkit', viewport: { width: 1194, height: 834 }, hasTouch: true } },
    { name: 'ipad-narrow', use: { browserName: 'webkit', viewport: { width: 600, height: 834 }, hasTouch: true } },
  ],
});
