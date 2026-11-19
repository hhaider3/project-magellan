import { defineConfig } from '@playwright/test';
// CI runners have no GPU, so they render with SwiftShader on the CPU: about a
// second a frame at the game's usual settings, and half a minute to load a
// world. Local macOS runs use the Apple GPU through ANGLE Metal instead
// (60 fps). PW_RENDERER=swiftshader reproduces CI locally; PW_RENDERER=metal
// forces the GPU.
const renderer = process.env.PW_RENDERER || (process.env.CI || process.platform !== 'darwin' ? 'swiftshader' : 'metal');
const software = renderer !== 'metal';
const rendererArgs = software ? ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu'];
export default defineConfig({
  // On the CPU every step waits on slow frames, so each test and each
  // expectation gets longer; the specs skip the two tests a slow frame can miss.
  testDir: './tests/browser', timeout: software ? 360000 : 90000, expect: { timeout: software ? 20000 : 5000 }, retries: process.env.CI ? 1 : 0,
  // One game at a time. (fullyParallel only lets CI's --shard split the suite by test, not by file.)
  workers: 1, fullyParallel: true,
  outputDir: 'output/playwright/results', reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  // Half-resolution pixels on the CPU: the page lays out the same, with a quarter of the pixels to shade.
  use: { baseURL: 'http://127.0.0.1:8002', viewport: { width: 960, height: 600 }, deviceScaleFactor: software ? .5 : 1, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), args: rendererArgs } },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:8002', reuseExistingServer: !process.env.CI, timeout: 10000 },
});
