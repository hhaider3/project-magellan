import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Isolate the render cost in the same seeded scene. The baseline still generates
// placement in its worker, but skips constructing the grass meshes.
const grassSource = await readFile(new URL('../grass.mjs', import.meta.url), 'utf8');
const browser = await chromium.launch({ ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] });
try {
  for (const mobile of [false, true]) for (const enabled of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 960, height: 600 }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await context.newPage();
    await page.route('https://**/*', route => route.abort());
    if (!enabled) await page.route('**/grass.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: grassSource.replace('function build(data) {', 'function build(data) { return null;') }));
    await page.goto('http://127.0.0.1:8002/?seed=3&test=browser');
    await page.getByRole('button', { name: 'Start exploring', exact: true }).click({ timeout: 60000 });
    await page.waitForFunction(() => { const s = window.__driveTest.snapshot(); return s.metrics.frame?.count > 1 && s.cameraError < 1e-7; });
    const sample = await page.evaluate(() => window.__driveTest.snapshot());
    console.log(JSON.stringify({ mobile, grass: enabled, draws: sample.draws, triangles: sample.triangles, grassStats: sample.grass, chunkInstallP95Ms: sample.metrics.chunkBuild.p95Ms, workerP95Ms: sample.metrics.workerBuild.p95Ms }));
    await context.close();
  }
} finally { await browser.close(); }
