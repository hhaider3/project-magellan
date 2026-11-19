import { PNG } from 'pngjs';
import { test, expect } from '@playwright/test';
// CI has no GPU and renders on the CPU: about a second a frame at the game's
// usual settings, and half a minute to load a world. So there the game opens on
// Low graphics unless a test asks for a preset, and pictures for the report are
// left out (each takes seconds to capture). Two tests whose steps are shorter
// than a slow frame (the Roadster's air brake, the plane's control inputs) are
// skipped there and run on a real GPU; their physics is covered by the unit
// tests either way.
const softwareRendering = () => (test.info().project.use.launchOptions?.args ?? []).some(arg => arg.includes('swiftshader'));
// Time limits are written for a GPU; on the CPU the same steps get three times as long.
const within = ms => softwareRendering() ? ms * 3 : ms;
// Gameplay must remain functional without external fonts/CDNs.
const offline = page => page.route('https://**/*', route => route.abort());
async function openGame(page, seed = 1, mode = 'browser', vehicle = 'atlas', quality = softwareRendering() ? 'low' : null) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /WebGL|shader|buffer|drawElements|worker/i.test(message.text())) errors.push(message.text()); });
  await offline(page);
  await page.goto(`/?seed=${seed}&test=${mode}${vehicle === 'atlas' ? '' : `&vehicle=${vehicle}`}${quality ? `&quality=${quality}` : ''}`);
  await expect(page.getByRole('button', { name: 'Start exploring', exact: true })).toBeEnabled({ timeout: within(60000) });
  return errors;
}
const snapshot = page => page.evaluate(() => window.__driveTest.snapshot());
const picture = async (page, testInfo, name) => { if (!softwareRendering()) await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' }); };
test('deep water transforms the Blender car, floats with a wake, and reverses on shore', async ({ page }, testInfo) => {
  test.setTimeout(within(180000));
  const errors = await openGame(page, 3, 'water');
  const initial = await snapshot(page);
  expect(initial.vehicle.transform).toBe(0); expect(initial.water.lakes).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).vehicle.transform, { timeout: within(45000), intervals: [100] }).toBeGreaterThan(.15);
  const unfolding = await snapshot(page);
  expect(unfolding.vehicle.transform).toBeLessThan(1);
  expect(unfolding.carAsset.hullSpan).toBeGreaterThan(initial.carAsset.hullSpan);
  await picture(page, testInfo, 'blender-transforming');
  await expect.poll(async () => (await snapshot(page)).vehicle.transform, { timeout: within(30000) }).toBe(1);
  const boat = await snapshot(page);
  expect(boat.vehicle.floating).toBe(true); expect(boat.vehicle.airtime).toBe(0);
  expect(boat.water.wakes).toBeGreaterThan(0); expect(boat.water.wakes).toBeLessThanOrEqual(220);
  expect(boat.carAsset.hullSpan).toBeGreaterThan(initial.carAsset.hullSpan * 1.5);
  expect(boat.vehicle.y).toBeGreaterThan(boat.vehicle.waterLevel - .85);
  await expect(page.locator('#surfaceState')).toHaveText('BOAT MODE');
  await picture(page, testInfo, 'blender-boat-on-lake');
  await expect.poll(async () => (await snapshot(page)).vehicle.transform, { timeout: within(90000) }).toBe(0);
  await page.keyboard.up('KeyW');
  const shore = await snapshot(page);
  expect(shore.vehicle.boatMode).toBe(false); expect(shore.vehicle.boatDistance).toBeGreaterThan(100); // gently shelving shores
  expect(shore.carAsset.hullSpan).toBeCloseTo(initial.carAsset.hullSpan, 4);
  await picture(page, testInfo, 'returned-to-car');
  expect(errors).toEqual([]);
});

test('missing scenery keeps the start button disabled and displays a load error', async ({ page }) => {
  await offline(page);
  await page.route('**/endless-nature.glb*', route => route.abort());
  await page.goto('/?seed=3&test=browser');
  await expect(page.locator('#loadError')).toBeVisible({ timeout: within(15000) });
  await expect(page.getByRole('button', { name: 'Unable to load scenery', exact: true })).toBeDisabled();
});

test('Blender vehicle loads, steers, spins its wheels and switches its lamps', async ({ page }, testInfo) => {
  const errors = await openGame(page, 3);
  const initial = await snapshot(page);
  expect(initial.carAsset.ready).toBe(true); expect(initial.carAsset.error).toBeNull();
  expect(initial.carAsset.triangles).toBeLessThan(90000); expect(initial.carMeshes).toBeLessThanOrEqual(110);
  // Stowed boat and plane parts are hidden, so driving keeps the car's draw budget.
  expect(initial.carDraws).toBeLessThanOrEqual(72);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.press('KeyL');
  await expect.poll(async () => (await snapshot(page)).carAsset.headlights).toBe(2);
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA');
  await expect.poll(async () => Math.abs((await snapshot(page)).carAsset.wheelSpin[0])).toBeGreaterThan(.2);
  const turning = (await snapshot(page)).carAsset;
  expect(Math.abs(turning.wheelSteer[0])).toBeGreaterThan(.01);
  expect(turning.wheelSteer[1]).toBe(0); expect(turning.wheelSteer[3]).toBe(0);
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  await expect.poll(async () => (await snapshot(page)).carAsset.brakes).toBe(2);
  await page.keyboard.up('KeyS'); await page.keyboard.press('KeyR');
  await picture(page, testInfo, 'blender-car-in-game');
  expect(errors).toEqual([]);
});

test('a missing car asset gives a visible error and prevents starting without a vehicle', async ({ page }) => {
  await offline(page);
  await page.route('**/atlas-amphibious.glb*', route => route.abort());
  await page.goto('/?seed=3&test=browser');
  await expect(page.locator('#loadError')).toBeVisible({ timeout: within(15000) });
  await expect(page.getByRole('button', { name: 'Unable to load the car', exact: true })).toBeDisabled();
});

test('worker loading, actual WebGL rendering, and stationary scenery stay stable', async ({ page }, testInfo) => {
  const errors = await openGame(page, 3);
  const state = await snapshot(page);
  expect(state.grass.tufts).toBeGreaterThan(0); expect(state.grass.meshes).toBeLessThanOrEqual(9);
  expect(state.grass.triangles).toBeLessThanOrEqual(175000); // High: 15-triangle tufts within 78 m
  expect(state.loading).toBe(false); expect(state.carDraws).toBeLessThanOrEqual(72); expect(state.farTiles).toBe(81);
  expect(state.natureAsset.ready).toBe(true); expect(state.natureAsset.error).toBeNull();
  expect(state.natureAsset.assets).toHaveLength(28); // every model in the nature library, mountain and desert variants included
  expect(state.natureAsset.instances.tree).toBeGreaterThan(10); expect(state.natureAsset.instances.rock).toBeGreaterThan(0);
  expect(state.metrics.workerBuild.count).toBeGreaterThanOrEqual(162);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  // The menu camera is already settled. Wait for gameplay to render before
  // checking convergence, otherwise a slow GPU can pass on that stale state.
  await expect.poll(async () => (await snapshot(page)).metrics.frame?.count ?? 0, { timeout: within(20000) }).toBeGreaterThan(1);
  await expect.poll(async () => (await snapshot(page)).cameraError, { timeout: within(20000) }).toBeLessThan(1e-7);
  // Pause the simulation clock so the new water ripples are stationary too.
  await page.keyboard.press('Escape');
  // Wait for the pause menu's fade to finish: only the scene should differ.
  // A fixed delay passed on slow SwiftShader captures but not on a real GPU.
  await page.waitForFunction(() => document.querySelector('#menu').getAnimations().length === 0);
  await page.waitForTimeout(300);
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

test('trees fracture into visible sections, release bounded debris, and breaking audio respects mute', async ({ page }, testInfo) => {
  const errors = await openGame(page, 77, 'tree-smash');
  // The speaker button opens the sound panel; mute is in it.
  await page.getByRole('button', { name: 'Sound settings', exact: true }).click();
  await page.getByRole('button', { name: 'Unmute sound', exact: true }).click();
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).fallingTrees, { timeout: within(30000), intervals: [100] }).toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  const impact = await snapshot(page);
  expect(impact.fallingTrees).toBeLessThanOrEqual(8); expect(impact.hiddenProps).toBeGreaterThan(0);
  expect(impact.brokenProps).toBeGreaterThan(0);
  expect(impact.debris).toBeGreaterThan(0); expect(impact.debris).toBeLessThanOrEqual(192);
  expect(impact.sound.played).toBeGreaterThan(0); expect(impact.sound.masterGain).toBe(1);
  // The music started with the unmute, and the effects bus is at full volume while driving.
  expect(impact.sound.music.started).toBeGreaterThan(0); expect(impact.sound.music.track).toBeTruthy();
  await expect.poll(async () => (await snapshot(page)).sound.sfxGain, { timeout: within(2000) }).toBeCloseTo(1, 2);
  await picture(page, testInfo, 'fractured-tree');
  await page.waitForTimeout(600);
  await picture(page, testInfo, 'tree-separating');
  await page.getByRole('button', { name: 'Sound settings', exact: true }).click();
  await page.getByRole('button', { name: 'Mute sound', exact: true }).click();
  // AudioParam.value updates on the next audio render quantum, not at once.
  await expect.poll(async () => (await snapshot(page)).sound.masterGain, { timeout: within(2000) }).toBe(0);
  await expect.poll(async () => (await snapshot(page)).fallingTrees, { timeout: within(30000) }).toBe(0);
  await expect.poll(async () => (await snapshot(page)).debris, { timeout: within(30000) }).toBe(0);
  await expect.poll(async () => (await snapshot(page)).sound.active, { timeout: within(5000) }).toBe(0);
  expect(errors).toEqual([]);
});

test('break sound playback produces audio and a muted output is silent', async ({ page }) => {
  // An empty page from the game's server is enough to load the module.
  await page.route('**/blank', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Break sounds</title>' }));
  await page.goto('/blank');
  const result = await page.evaluate(async () => {
    const { createBreakAudio } = await import('/break-audio.mjs?v=grass-1');
    async function render(muted) {
      const context = new OfflineAudioContext(1, 44100, 44100), master = context.createGain();
      master.gain.value = muted ? 0 : 1; master.connect(context.destination);
      const effects = createBreakAudio(context, master, 2);
      for (const type of ['tree', 'rock', 'cactus', 'boulder']) effects.play(type, 40);
      const active = effects.active, rendered = await context.startRendering(), samples = rendered.getChannelData(0);
      return { active, rms: Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length), ended: effects.active };
    }
    return { audible: await render(false), muted: await render(true) };
  });
  expect(result.audible.active).toBe(2); expect(result.audible.rms).toBeGreaterThan(.01);
  expect(result.audible.ended).toBe(0); expect(result.muted.rms).toBe(0);
});

test('keyboard jump, recovery, and new-world reset', async ({ page }) => {
  const errors = await openGame(page, 3);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page)).vehicle.jumps).toBe(1);
  await expect.poll(async () => (await snapshot(page)).vehicle.grounded, { timeout: within(10000) }).toBe(true);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).vehicle.distance, { timeout: within(30000) }).toBeGreaterThan(20);
  await page.keyboard.up('KeyW'); await page.keyboard.press('KeyR');
  const recovered = await snapshot(page);
  expect(Math.abs(recovered.vehicle.speed)).toBeLessThan(.01);
  expect(Math.hypot(recovered.target[0] - recovered.vehicle.x, recovered.target[2] - recovered.vehicle.z)).toBeLessThan(8);
  await page.keyboard.press('KeyN');
  await expect.poll(async () => (await snapshot(page)).generation).toBe(2);
  await expect.poll(async () => (await snapshot(page)).loading, { timeout: within(60000) }).toBe(false);
  const fresh = await snapshot(page);
  expect(fresh.vehicle.distance).toBe(0); expect(fresh.accumulator).toBeLessThan(1 / 120);
  expect(Math.hypot(fresh.target[0], fresh.target[2])).toBeLessThan(8);
  // The old world's work is cancelled; the new one may keep its usual three jobs in flight.
  expect(fresh.chunks).toBeLessThanOrEqual(121); expect(fresh.stalePending).toBe(0); expect(fresh.pending).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('driving across chunks streams the world ahead and keeps the render pose close', async ({ page }) => {
  const errors = await openGame(page, 3);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).vehicle.distance, { timeout: within(45000) }).toBeGreaterThan(430);
  const moving = await snapshot(page);
  expect(moving.grass.meshes).toBeLessThanOrEqual(9);
  const renderLag = Math.hypot(moving.vehicle.x - moving.renderPose.x, moving.vehicle.z - moving.renderPose.z);
  expect(renderLag).toBeGreaterThan(0); expect(renderLag).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('F unfolds the wings and folds them away again', async ({ page }) => {
  const errors = await openGame(page, 3);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await snapshot(page)).flight.wingsVisible).toBe(true);
  await expect(page.locator('#flyAction')).toHaveText('land');
  expect((await snapshot(page)).flight.mode).toBe(true);
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await snapshot(page)).flight.wingsVisible, { timeout: within(10000) }).toBe(false);
  await expect(page.locator('#flyAction')).toHaveText('fly');
  expect((await snapshot(page)).flight.mode).toBe(false);
  expect(errors).toEqual([]);
});

test('the Roadster boosts, skims a lake and hovers on its thrusters, and swaps with the ATLAS', async ({ page }, testInfo) => {
  test.skip(softwareRendering(), 'the air brake rises over a short stop, which a frame or two a second can miss');
  test.setTimeout(within(120000));
  const errors = await openGame(page, 3, 'water', 'roadster');
  const initial = await snapshot(page);
  expect(initial.carAsset).toMatchObject({ ready: true, error: null, kind: 'roadster', name: 'Roadster Rocket', plumes: 0 });
  expect(initial.vehicle).toMatchObject({ kind: 'roadster', gas: 1, transform: 0 });
  await expect(page.locator('#vehicleRoadster')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await expect(page.locator('#gasRow')).toBeVisible();
  await expect(page.locator('#flyAction')).toHaveText('hover');
  // E fires the four rear nozzles: plumes, a draining tank and the BOOST readout.
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyE');
  await expect.poll(async () => (await snapshot(page)).carAsset.plumes, { timeout: within(10000) }).toBeGreaterThanOrEqual(4);
  await expect(page.locator('#surfaceState')).toHaveText('BOOST');
  await picture(page, testInfo, 'roadster-boost');
  await page.keyboard.up('KeyE');
  expect((await snapshot(page)).vehicle.gas).toBeLessThan(1);
  // Deep water: no boat, it rides on the thrusters just above the surface
  // (once down from any hop off the shore).
  await expect.poll(async () => { const v = (await snapshot(page)).vehicle; return v.overWater && v.grounded; }, { timeout: within(30000) }).toBe(true);
  const skimming = await snapshot(page);
  expect(skimming.vehicle).toMatchObject({ floating: false, boatMode: false, transform: 0 });
  expect(skimming.vehicle.y - skimming.vehicle.waterLevel).toBeCloseTo(.41, 1);
  expect(skimming.renderPose.y).toBeGreaterThan(skimming.vehicle.waterLevel);
  await expect.poll(async () => (await snapshot(page)).water.wakes, { timeout: within(10000) }).toBeGreaterThan(0);
  await expect(page.locator('#surfaceState')).toHaveText('SKIMMING THE WATER');
  await picture(page, testInfo, 'roadster-skimming-lake');
  // Held F lifts it into a hover.
  await page.keyboard.down('KeyF');
  await expect.poll(async () => { const v = (await snapshot(page)).vehicle; return !v.grounded && v.lift > 0 ? v.y - v.groundY : 0; }, { timeout: within(10000) }).toBeGreaterThan(2);
  await expect(page.locator('#surfaceState')).toHaveText('HOVERING ON THRUSTERS');
  await picture(page, testInfo, 'roadster-hovering');
  await page.keyboard.up('KeyF'); await page.keyboard.up('KeyW');
  // Settings → Vehicle swaps in the ATLAS where it is: a boat, on the lake.
  await expect.poll(async () => (await snapshot(page)).vehicle.grounded, { timeout: within(10000) }).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'ATLAS', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).carAsset.kind, { timeout: within(30000) }).toBe('atlas');
  const atlas = await snapshot(page);
  expect(atlas.vehicle).toMatchObject({ kind: 'atlas', floating: true });
  expect(atlas.vehicle.distance).toBeGreaterThan(50);
  await expect(page.locator('#vehicleAtlas')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#gasRow')).toBeHidden();
  // V switches back mid-drive, to the Roadster's red telemetry HUD.
  await page.getByRole('button', { name: 'Keep exploring', exact: true }).click();
  await expect(page.locator('#telemetry')).toBeHidden();
  await page.keyboard.press('KeyV');
  await expect.poll(async () => (await snapshot(page)).carAsset.kind, { timeout: within(10000) }).toBe('roadster');
  await expect(page.locator('#telemetry')).toBeVisible();
  await expect(page.locator('#tmFan')).toHaveText('THRUSTER LIFT'); // still on the lake
  // Braking at speed stands the rear wing up as an air brake.
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyE');
  await expect.poll(async () => (await snapshot(page)).vehicle.speed, { timeout: within(10000) }).toBeGreaterThan(20);
  await page.keyboard.up('KeyE'); await page.keyboard.up('KeyW'); await page.keyboard.down('KeyS');
  await expect.poll(async () => (await snapshot(page)).carAsset.wingAngle, { timeout: within(5000) }).toBeGreaterThan(.5);
  await expect(page.locator('#tmWing')).toHaveText('AIR BRAKE');
  await page.keyboard.up('KeyS');
  // G switches the suction fans off and on.
  await page.keyboard.press('KeyG');
  await expect.poll(async () => (await snapshot(page)).vehicle.fans).toBe(false);
  await expect(page.locator('#tmFan')).toHaveText(/OFF|THRUSTER LIFT/);
  await page.keyboard.press('KeyG');
  await expect.poll(async () => (await snapshot(page)).vehicle.fans).toBe(true);
  expect(errors).toEqual([]);
});

test('a lost graphics context pauses the drive, and it carries on once restored', async ({ page }, testInfo) => {
  const errors = await openGame(page, 3, 'browser', 'roadster');
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).vehicle.distance, { timeout: within(10000) }).toBeGreaterThan(30);
  const lose = () => page.evaluate(() => { window.__lost = document.querySelector('#game canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lost.loseContext(); });
  await lose();
  await expect(page.locator('#menu')).not.toHaveClass(/closed/); // paused, as on any interruption
  await expect(page.locator('#toast')).toHaveText(/restoring/);
  await page.keyboard.up('KeyW');
  const stopped = (await snapshot(page)).vehicle;
  await page.getByRole('button', { name: 'Keep exploring', exact: true }).click(); // can't resume yet
  await expect(page.locator('#menu')).not.toHaveClass(/closed/);
  await page.evaluate(() => window.__lost.restoreContext());
  await expect(page.locator('#toast')).toHaveText(/restored/);
  // Same world, same place: the drive carries on, and the scene draws again.
  const restored = await snapshot(page);
  expect(restored.vehicle.distance).toBeCloseTo(stopped.distance, 6); expect(restored.vehicle.kind).toBe('roadster');
  await page.getByRole('button', { name: 'Keep exploring', exact: true }).click();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).vehicle.distance, { timeout: within(10000) }).toBeGreaterThan(stopped.distance + 20);
  await expect.poll(async () => (await snapshot(page)).draws, { timeout: within(5000) }).toBeGreaterThan(50);
  const shot = PNG.sync.read(await page.screenshot());
  let lit = 0; for (let i = 0; i < shot.data.length; i += 4 * 97) lit += shot.data[i] + shot.data[i + 1] + shot.data[i + 2] > 60 ? 1 : 0;
  expect(lit).toBeGreaterThan(shot.data.length / (4 * 97) * .8); // not a black screen
  await picture(page, testInfo, 'after-context-restore');
  await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});

test('the plane takes off, climbs, flies on three axes, and lands', async ({ page }, testInfo) => {
  test.skip(softwareRendering(), 'half-second control inputs need GPU frame rates');
  test.setTimeout(within(150000));
  const errors = await openGame(page, 3);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await page.keyboard.down('KeyW'); await page.keyboard.press('KeyF');
  await expect.poll(async () => (await snapshot(page)).flight.wingsVisible).toBe(true);
  await expect(page.locator('#flyAction')).toHaveText('land');
  await expect.poll(async () => (await snapshot(page)).flight.flying, { timeout: within(40000), intervals: [100] }).toBe(true);
  // Pitch up briefly: the nose then holds its climb angle.
  await page.keyboard.down('Space'); await page.waitForTimeout(500); await page.keyboard.up('Space');
  await expect.poll(async () => (await snapshot(page)).flight.altitude, { timeout: within(40000) }).toBeGreaterThan(40);
  const climbing = await snapshot(page);
  expect(climbing.flight.wingspan).toBeGreaterThan(6); expect(climbing.flight.progress).toBe(1);
  // The map is built for the view from the air: a horizon terrain tier,
  // distant forests and water, and fog that recedes as the plane climbs.
  expect(climbing.horizon.ultraTiles).toBe(49); expect(climbing.horizon.impostors).toBeGreaterThan(1000);
  expect(climbing.horizon.distantWater).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot(page)).horizon.fogFar, { timeout: within(40000) }).toBeGreaterThan(3500);
  // Three axes: Q/E yaw, A/D roll, and the arrows pitch.
  const before = await snapshot(page);
  await page.keyboard.down('KeyQ'); await page.waitForTimeout(800); await page.keyboard.up('KeyQ');
  const yawed = await snapshot(page);
  expect(Math.abs(yawed.vehicle.heading - before.vehicle.heading)).toBeGreaterThan(.03);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400);
  expect((await snapshot(page)).vehicle.roll).toBeGreaterThan(.3);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(400); await page.keyboard.up('ArrowUp');
  expect((await snapshot(page)).vehicle.climb).toBeLessThan(yawed.vehicle.climb);
  await expect(page.locator('#gear')).toHaveText('A');
  await expect.poll(async () => (await snapshot(page)).flight.propeller).toBeGreaterThan(climbing.flight.propeller);
  await picture(page, testInfo, 'flying');
  await page.keyboard.up('KeyW'); await page.keyboard.press('KeyF');
  await expect.poll(async () => (await snapshot(page)).flight.flying, { timeout: within(90000) }).toBe(false);
  await expect.poll(async () => (await snapshot(page)).flight.wingsVisible, { timeout: within(10000) }).toBe(false);
  const landed = await snapshot(page);
  expect(landed.flight.mode).toBe(false); expect(landed.vehicle.flights).toBe(1);
  expect(landed.vehicle.flightDistance).toBeGreaterThan(200);
  expect(errors).toEqual([]);
});

test.describe('mobile Chrome controls', () => {
  // (Half-resolution pixels on the CPU, as for the desktop tests.)
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 }, deviceScaleFactor: async ({}, use, testInfo) => use(testInfo.project.use.deviceScaleFactor < 1 ? .5 : 2) });
test('graphics presets cycle, and the steering slider replaces the arrow buttons', async ({ page }, testInfo) => {
  const errors = await openGame(page, 3, 'browser', 'atlas', null); // the phone's own preset, also on the CPU
  await expect(page.locator('#qualityBtn')).toHaveText('Graphics: Medium');
  let state = await snapshot(page);
  const density = await page.evaluate(() => devicePixelRatio); // 2 on a phone's GPU
  expect(state.quality).toMatchObject({ preset: 'medium', pixelRatio: Math.min(density, 1.35), shadow: 1024, grassDensity: .2 });
  // Medium plains grass stays within its smaller range and draw budget.
  expect(state.grass.range).toBe(48); expect(state.grass.meshes).toBeGreaterThan(0);
  expect(state.grass.meshes).toBeLessThanOrEqual(4); expect(state.grass.tufts).toBeGreaterThan(0);
  expect(state.grass.triangles).toBeLessThanOrEqual(12000); // Medium: cheap 5-triangle tufts, near the old 9,600 cap
  await picture(page, testInfo, 'mobile-grass');
  // Graphics is in the Settings sheet.
  await page.locator('#settingsBtn').tap();
  await page.locator('#qualityBtn').tap();
  await expect(page.locator('#qualityBtn')).toHaveText('Graphics: High');
  state = await snapshot(page);
  expect(state.quality).toMatchObject({ preset: 'high', pixelRatio: Math.min(density, 2), shadow: 2048, grassDensity: 1 });
  expect(state.grass.range).toBe(78);
  await page.locator('#qualityBtn').tap();
  await expect(page.locator('#qualityBtn')).toHaveText('Graphics: Auto · Medium');
  await page.getByRole('button', { name: 'Start exploring', exact: true }).tap();
  // Speed arrows on the right with FLY beside the brake; Jump and Drift
  // just above the steering slider, which sits where the ← → buttons were.
  for (const name of ['Accelerate', 'Brake or reverse', 'Jump', 'Drift']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Steer left' })).toHaveCount(0);
  const slider = page.getByRole('slider', { name: 'Steering: slide left or right' });
  await expect(slider).toBeVisible();
  const track = await slider.boundingBox(), pedal = await page.getByRole('button', { name: 'Accelerate', exact: true }).boundingBox();
  expect(track.x).toBeLessThan(40); expect(track.y + track.height).toBeGreaterThan(330);
  const jumpBox = await page.getByRole('button', { name: 'Jump', exact: true }).boundingBox(), flyBox = await page.getByRole('button', { name: 'Fly', exact: true }).boundingBox(), brakeBox = await page.getByRole('button', { name: 'Brake or reverse', exact: true }).boundingBox();
  expect(jumpBox.y + jumpBox.height).toBeLessThanOrEqual(track.y + 1); expect(jumpBox.x).toBeLessThan(track.x + track.width); // above the slider
  expect(flyBox.x + flyBox.width).toBeLessThanOrEqual(brakeBox.x + 1); expect(Math.abs(flyBox.y + flyBox.height - brakeBox.y - brakeBox.height)).toBeLessThan(2); // left of the brake
  const steer = { x: track.x + track.width / 2, y: track.y + track.height / 2 }, gas = { x: pedal.x + pedal.width / 2, y: pedal.y + pedal.height / 2 };
  // Two real touch points: one thumb holds Accelerate, the other slides.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[steer.x, steer.y], [gas.x, gas.y]]);
  await touch('touchMove', [[steer.x - 20, steer.y], [gas.x, gas.y]]);
  await expect.poll(async () => (await snapshot(page)).controls.throttle).toBe(1);
  state = await snapshot(page);
  const partial = state.controls.steer;
  expect(partial).toBeGreaterThan(.4); expect(partial).toBeLessThan(.8);
  // Dragging far past the end gives full lock; returning gives the same
  // partial lock again, because the track never moves with the finger.
  await touch('touchMove', [[steer.x - 260, steer.y - 120], [gas.x, gas.y]]);
  await expect.poll(async () => (await snapshot(page)).controls.steer).toBe(1);
  await touch('touchMove', [[steer.x - 20, steer.y], [gas.x, gas.y]]);
  await expect.poll(async () => (await snapshot(page)).controls.steer).toBeCloseTo(partial, 5);
  await expect.poll(async () => (await snapshot(page)).vehicle.speed, { timeout: within(30000) }).toBeGreaterThan(4);
  await expect.poll(async () => (await snapshot(page)).vehicle.heading, { timeout: within(30000) }).toBeGreaterThan(.05);
  await touch('touchEnd', []);
  await expect.poll(async () => (await snapshot(page)).controls.steer).toBe(null);
  expect((await snapshot(page)).controls.throttle).toBe(0);
  // FLY switches to the plane form: the slider becomes the flight ring, and
  // Jump and Drift give way to it.
  await page.getByRole('button', { name: 'Fly', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).flight.mode).toBe(true);
  await expect(page.getByRole('slider', { name: /Flight control/ })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Steering: slide left or right' })).toBeHidden();
  for (const name of ['Jump', 'Drift']) await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Land', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).flight.mode).toBe(false);
  await expect(page.getByRole('slider', { name: 'Steering: slide left or right' })).toBeVisible();
  await expect(page.getByRole('slider', { name: /Flight control/ })).toBeHidden();
  expect(errors).toEqual([]);
});
test('held upright, a phone asks to be turned sideways and will not drive', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openGame(page, 3);
  const notice = page.getByRole('alert').filter({ hasText: 'Turn your phone sideways' });
  await expect(notice).toBeVisible();
  await page.locator('#startBtn').dispatchEvent('click'); // the notice covers the button
  await expect(page.locator('body')).not.toHaveClass(/driving/);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(notice).toBeHidden();
  // A click, not a tap: a tap goes fullscreen, and the test browser can't
  // resize a fullscreen window.
  await page.getByRole('button', { name: 'Start exploring', exact: true }).dispatchEvent('click');
  await expect(page.locator('body')).toHaveClass(/driving/);
  // Turning it upright again pauses the drive.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(notice).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/driving/);
  expect(errors).toEqual([]);
});
test('tilt steering: turning the phone steers, and the slider steps aside', async ({ page }) => {
  // Chrome asks for motion access too; a phone that allows it grants these.
  await page.context().grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
  const errors = await openGame(page, 3);
  await page.locator('#settingsBtn').tap(); await page.locator('#tiltBtn').tap();
  await expect(page.locator('#tiltBtn')).toHaveText('Tilt steering: On');
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  await expect(page.locator('#steerSlider')).toBeHidden();
  // Feed the phone's orientation as a real one would: turned like a wheel by
  // `wheel` degrees (clockwise positive), tilted back 40°, in the current screen rotation.
  const hold = wheel => page.evaluate(wheel => {
    clearInterval(window.__tilt);
    const send = () => {
      const r = Math.PI / 180, lean = 40 * r, s = (screen.orientation?.angle ?? 0) * r;
      const down = [Math.sin(wheel * r) * Math.cos(lean), -Math.cos(wheel * r) * Math.cos(lean), -Math.sin(lean)];
      const dx = down[0] * Math.cos(s) + down[1] * Math.sin(s), dy = -down[0] * Math.sin(s) + down[1] * Math.cos(s);
      let beta = Math.asin(-dy), gamma = Math.atan2(dx, -down[2]);
      if (gamma >= Math.PI / 2 || gamma < -Math.PI / 2) { beta = Math.PI - beta; gamma += gamma > 0 ? -Math.PI : Math.PI; }
      dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: beta / r, gamma: gamma / r }));
    };
    send(); window.__tilt = setInterval(send, 40);
  }, wheel);
  await hold(0);
  await expect.poll(async () => (await snapshot(page)).controls.tiltActive).toBe(true);
  expect(Math.abs((await snapshot(page)).controls.steer)).toBeLessThan(.05);
  await hold(25);
  await expect.poll(async () => (await snapshot(page)).controls.steer).toBeLessThan(-.5); // turned right: steer right
  await hold(-25);
  await expect.poll(async () => (await snapshot(page)).controls.steer).toBeGreaterThan(.5);
  // Turned off, the slider is back and tilt steers nothing.
  await page.evaluate(() => clearInterval(window.__tilt));
  await page.locator('#pauseBtn').tap(); await page.locator('#settingsBtn').tap(); await page.locator('#tiltBtn').tap();
  await expect(page.locator('#tiltBtn')).toHaveText('Tilt steering: Off');
  await page.getByRole('button', { name: 'Keep exploring', exact: true }).click();
  await expect(page.locator('#steerSlider')).toBeVisible();
  expect((await snapshot(page)).controls).toMatchObject({ tilt: false, tiltActive: false });
  expect(errors).toEqual([]);
});

test('a second world request cancels old work and touch controls still jump', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openGame(page, 100003);
  // A desert world: its cacti are drawn as instances of the Blender models.
  const desert = (await snapshot(page)).natureAsset;
  expect(desert.instances.cactus).toBeGreaterThan(10); expect(desert.instances.rock).toBeGreaterThan(0);
  // These menu buttons remain available while background generation is active.
  await page.getByRole('button', { name: '↻ New world', exact: true }).click();
  await page.getByRole('button', { name: '↻ New world', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).generation).toBe(3);
  await expect(page.getByRole('button', { name: 'Start exploring', exact: true })).toBeEnabled({ timeout: within(60000) });
  const state = await snapshot(page);
  expect(state.streamError).toBe(null); expect(state.loading).toBe(false); expect(state.vehicle.distance).toBe(0);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
  const jump = page.getByRole('button', { name: 'Jump', exact: true });
  await expect(jump).toBeVisible(); await jump.tap();
  await expect.poll(async () => (await snapshot(page)).vehicle.jumps).toBe(1);
  expect(errors).toEqual([]);
});

});
