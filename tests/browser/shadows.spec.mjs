import { test, expect } from '@playwright/test';

test('sun shadows fade continuously at all four moving map edges on desktop and mobile resolutions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const coordinates = [-.02, 0, .01, .02, .04, .06, .08, .1, .12, .14, .16, .18, .2, .22, .3, .5];
  // Establish that the original renderer really has an abrupt boundary here.
  await page.goto('/tests/shadows.html?raw');
  await page.waitForFunction(() => typeof window.sampleShadows === 'function');
  const raw = await page.evaluate(coords => window.sampleShadows(coords, 0, 1024), coordinates);
  expect(raw[0] - raw.at(-1)).toBeGreaterThan(35);
  expect(Math.max(...raw.slice(1).map((v, i) => Math.abs(v - raw[i])))).toBeGreaterThan((raw[0] - raw.at(-1)) * .4);
  await page.goto('/tests/shadows.html');
  await page.waitForFunction(() => typeof window.sampleShadows === 'function');
  for (const resolution of [1024, 2048]) for (const edge of [0, 1, 2, 3]) {
    const samples = await page.evaluate(({ coordinates, edge, resolution }) => window.sampleShadows(coordinates, edge, resolution), { coordinates, edge, resolution });
    const lit = samples[0], dark = samples.at(-1), contrast = lit - dark;
    expect(contrast).toBeGreaterThan(35);
    expect(Math.abs(dark - raw.at(-1))).toBeLessThan(2); // Full nearby shadow detail is retained.
    expect(Math.abs(samples[3] - lit)).toBeLessThan(2); // Clipping occurs within a fully lit guard band.
    expect(samples[8]).toBeLessThan(lit - contrast * .25);
    expect(samples[8]).toBeGreaterThan(dark + contrast * .25);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i] - samples[i - 1]).toBeLessThanOrEqual(2);
      expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(contrast * .22);
    }
  }
  expect(errors).toEqual([]);
});
