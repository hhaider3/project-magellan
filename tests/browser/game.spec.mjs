import { PNG } from 'pngjs';
import { test, expect } from '@playwright/test';
async function openGame(page, seed = 1, mode = 'browser') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /WebGL|shader|buffer|drawElements|worker/i.test(message.text())) errors.push(message.text()); });
  // Gameplay must remain functional without external fonts/CDNs.
  await page.route('https://**/*', route => route.abort());
  await page.goto(`/?seed=${seed}&test=${mode}`);
  await expect(page.getByRole('button', { name: 'Start exploring', exact: true })).toBeEnabled({ timeout: 60000 });
  return errors;
}
const snapshot = page => page.evaluate(() => window.__driveTest.snapshot());
test('worker loading, actual WebGL rendering, and stationary scenery stay stable', async ({ page }, testInfo) => {
  const errors = await openGame(page, 100003);
  const state = await snapshot(page);
  expect(state.loading).toBe(false); expect(state.carMeshes).toBeLessThan(40); expect(state.farTiles).toBe(81);
  expect(state.metrics.workerBuild.count).toBeGreaterThanOrEqual(162);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  // The menu camera is already settled. Wait for gameplay to render before
  // checking convergence, otherwise a slow GPU can pass on that stale state.
  await expect.poll(async () => (await snapshot(page)).metrics.frame?.count ?? 0, { timeout: 20000 }).toBeGreaterThan(1);
  await expect.poll(async () => (await snapshot(page)).cameraError, { timeout: 20000 }).toBeLessThan(1e-7);
  // The exact pixels may differ across GPUs; within one settled session they must not flicker.
  const first = await page.locator('#game canvas').screenshot();
  await page.waitForTimeout(500);
  const second = await page.locator('#game canvas').screenshot();
  await testInfo.attach('stationary-before', { body: first, contentType: 'image/png' });
  await testInfo.attach('stationary-after', { body: second, contentType: 'image/png' });
  const a = PNG.sync.read(first), b = PNG.sync.read(second);
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) if (Math.max(...[0, 1, 2].map(channel => Math.abs(a.data[i + channel] - b.data[i + channel]))) > 8) changed++;
  expect(changed / (a.width * a.height), 'stationary scenery should not disappear between frames').toBeLessThan(.0005);
  expect((await snapshot(page)).draws).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('high-speed scenery impact hides every instance and releases bounded debris', async ({ page }, testInfo) => {
  const errors = await openGame(page, 1, 'smash');
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).vehicle.smashed, { timeout: 30000, intervals: [100] }).toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  const hit = await snapshot(page);
  expect(hit.brokenProps).toBeGreaterThan(0); expect(hit.hiddenProps).toBeGreaterThan(0);
  expect(hit.debris).toBeGreaterThan(0); expect(hit.debris).toBeLessThanOrEqual(192);
  await testInfo.attach('impact', { body: await page.screenshot(), contentType: 'image/png' });
  await expect.poll(async () => (await snapshot(page)).debris, { timeout: 30000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('a purple ramp launches the car into a barrel roll and lands driveable', async ({ page }, testInfo) => {
  const errors = await openGame(page, 1, 'twist');
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await testInfo.attach('twisted-ramp', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.down('KeyW');
  await expect.poll(async () => Math.abs((await snapshot(page)).vehicle.rollVelocity), { timeout: 30000, intervals: [100] }).toBeGreaterThan(1);
  await expect.poll(async () => (await snapshot(page)).vehicle.airRoll, { timeout: 15000, intervals: [100] }).toBeGreaterThan(Math.PI);
  await testInfo.attach('airborne-roll', { body: await page.screenshot(), contentType: 'image/png' });
  // A ramp's uneven deck can produce a small hop before the main launch.
  // Wait for the completed jump to land, not merely any earlier contact.
  await expect.poll(async () => {
    const { vehicle } = await snapshot(page);
    return vehicle.grounded && vehicle.bestJump > 25 && vehicle.rollVelocity === 0;
  }, { timeout: 30000 }).toBe(true);
  await page.keyboard.up('KeyW');
  expect((await snapshot(page)).vehicle.rollVelocity).toBe(0);
  expect(errors).toEqual([]);
});

test('an approach from behind at an angle launches and lands without pressing Jump', async ({ page }) => {
  const errors = await openGame(page, 1, 'ramp-side');
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => {
    const { vehicle } = await snapshot(page); return vehicle.y - vehicle.groundY;
  }, { timeout: 20000, intervals: [100] }).toBeGreaterThan(2);
  await expect.poll(async () => (await snapshot(page)).vehicle.bestJump, { timeout: 30000 }).toBeGreaterThan(10);
  await page.keyboard.up('KeyW');
  expect((await snapshot(page)).vehicle.jumps).toBe(0);
  expect(errors).toEqual([]);
});
test('keyboard jump, driving across chunks, recovery, and new-world reset', async ({ page }) => {
  const errors = await openGame(page);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page)).vehicle.jumps).toBe(1);
  await expect.poll(async () => (await snapshot(page)).vehicle.grounded, { timeout: 10000 }).toBe(true);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).vehicle.distance, { timeout: 45000 }).toBeGreaterThan(430);
  const moving = await snapshot(page);
  const renderLag = Math.hypot(moving.vehicle.x - moving.renderPose.x, moving.vehicle.z - moving.renderPose.z);
  expect(renderLag).toBeGreaterThan(0); expect(renderLag).toBeLessThan(1);
  await page.keyboard.up('KeyW'); await page.keyboard.press('KeyR');
  const recovered = await snapshot(page);
  expect(Math.abs(recovered.vehicle.speed)).toBeLessThan(.01);
  expect(Math.hypot(recovered.target[0] - recovered.vehicle.x, recovered.target[2] - recovered.vehicle.z)).toBeLessThan(8);
  await page.keyboard.press('KeyN');
  await expect.poll(async () => (await snapshot(page)).generation).toBe(2);
  await expect.poll(async () => (await snapshot(page)).loading, { timeout: 60000 }).toBe(false);
  const fresh = await snapshot(page);
  expect(fresh.vehicle.distance).toBe(0); expect(fresh.accumulator).toBeLessThan(1 / 120);
  expect(Math.hypot(fresh.target[0], fresh.target[2])).toBeLessThan(8);
  expect(fresh.chunks).toBeLessThanOrEqual(121); expect(fresh.pending).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('a second world request cancels old work and touch controls still jump', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openGame(page, 100003);
  // These menu buttons remain available while background generation is active.
  await page.getByRole('button', { name: '↻ New world', exact: true }).click();
  await page.getByRole('button', { name: '↻ New world', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).generation).toBe(3);
  await expect(page.getByRole('button', { name: 'Start exploring', exact: true })).toBeEnabled({ timeout: 60000 });
  const state = await snapshot(page);
  expect(state.streamError).toBe(null); expect(state.loading).toBe(false); expect(state.vehicle.distance).toBe(0);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  const jump = page.getByRole('button', { name: 'Jump', exact: true });
  await expect(jump).toBeVisible(); await jump.click();
  await expect.poll(async () => (await snapshot(page)).vehicle.jumps).toBe(1);
  expect(errors).toEqual([]);
});
