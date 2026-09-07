import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 90000, workers: 1, retries: process.env.CI ? 1 : 0,
  outputDir: 'output/playwright/results', reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:8002', viewport: { width: 960, height: 600 }, deviceScaleFactor: 1, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:8002', reuseExistingServer: !process.env.CI, timeout: 10000 },
});
