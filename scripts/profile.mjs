import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), args: ['--use-angle=swiftshader', '--enable-webgl'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8002/?seed=1&test=browser');
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click({ timeout: 120000 });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(5000);
  await page.keyboard.down('KeyA'); await page.waitForTimeout(1000); await page.keyboard.up('KeyA');
  await page.waitForTimeout(5000); await page.keyboard.up('KeyW');
  const result = await page.evaluate(() => window.__driveTest.snapshot());
  console.log(JSON.stringify(result, null, 2));
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2));
} finally { await browser.close(); }
