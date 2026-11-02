import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, FIXED_DT, VARIANT, ICE } from '../world.mjs';
import { weatherAt, regionWeights, WEATHER_AREA, WEATHER_CELL } from '../weather.mjs';
import { lakeRadius } from '../lakes.mjs';

// Seed 77 starts in the Frostlands, with Mirror Lake frozen over.
const SEED = 77;
const flat = { surface: () => 0, gradient: () => ({ x: 0, z: 0 }), roadAt: (x, z) => ({ d: 0, x, z }), props: () => [] };
const ice = { ...flat, iceAt: () => ({ level: 0, depth: 3 }) }, snow = { ...flat, frostAt: () => 1 };
function advance(car, input, world, seconds) { for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) stepVehicle(car, input, world, []); }
// Metres to stop from 25 m/s on the brake, and how far the travel lags the
// nose after a second of full lock at that speed (radians).
function stopping(world, kind) {
  const car = createVehicle(world, 0, 0, 0, kind); car.vz = 25;
  advance(car, { down: true }, world, .01);
  for (let i = 0; i < 120 * 20 && car.vz > .5; i++) stepVehicle(car, { down: true }, world, []);
  return car.z;
}
function slide(world, kind) {
  const car = createVehicle(world, 0, 0, 0, kind); car.vz = 25;
  advance(car, { up: true, right: true }, world, 1);
  return Math.abs(car.heading - Math.atan2(car.vx, car.vz));
}

test('the Frostlands are broad regions of their own, far from the sand', () => {
  const STEP = 200, SPAN = 60, SIZE = 2 * SPAN + 1;
  for (const seed of [3, 77, 12345]) {
    const world = createWorld(seed), frosty = new Uint8Array(SIZE * SIZE);
    let frost = 0;
    for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++) {
      const x = (j - SPAN) * STEP, z = (i - SPAN) * STEP, f = world.frostAt(x, z);
      if (f > .5) { frosty[i * SIZE + j] = 1; frost++; }
      // Temperate land lies between any snow at all and the sand.
      if (f > .05) for (let k = 0; k < 8; k++) assert.ok(world.desertAt(x + Math.cos(k * Math.PI / 4) * 300, z + Math.sin(k * Math.PI / 4) * 300, 0) < .5, `sand beside snow at ${x}, ${z}`);
    }
    // Nearly all of it lies within a block about 600 m across: no thin strips.
    // (Away from the edge of the scan, where a block wouldn't fit.)
    const within = (i, j, test) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (test(i + a, j + b)) return true; return false; };
    const solid = (i, j) => !within(i, j, (a, b) => !frosty[a * SIZE + b]);
    let inside = 0, broad = 0;
    for (let i = 2; i < SIZE - 2; i++) for (let j = 2; j < SIZE - 2; j++) if (frosty[i * SIZE + j]) { inside++; if (within(i, j, solid)) broad++; }
    assert.ok(broad / inside > .95, `seed ${seed}: ${(broad / inside * 100).toFixed(0)}% broad`);
    if (seed === 3) assert.ok(frost / frosty.length > .08 && frost / frosty.length < .4, `${(frost / frosty.length * 100).toFixed(0)}% Frostlands`);
  }
  assert.ok(createWorld(SEED).frostAt(0, 0) > .9);
});

test('snow-covered pines grow there: no cherries, cacti or dead snags', () => {
  const world = createWorld(SEED);
  let pines = 0;
  for (let cx = -3; cx < 3; cx++) for (let cz = -3; cz < 3; cz++) for (const p of world.props(cx, cz)) {
    if (world.frostAt(p.x, p.z) < .7) continue;
    assert.notEqual(p.type, 'cactus');
    if (p.type !== 'tree' || p.y > 160) continue;
    assert.equal(p.variant, VARIANT.tree.snow, `${p.id} is a snowy pine`); pines++;
  }
  assert.ok(pines > 20, `${pines} snowy pines`);
});

test('its lakes freeze over: the ice is ground to drive on, with nothing growing on it', () => {
  const world = createWorld(SEED), lake = world.starterLake;
  assert.ok(world.frozen(lake));
  assert.equal(world.waterAt(lake.x, lake.z), null);
  const frozen = world.iceAt(lake.x, lake.z);
  assert.ok(frozen.depth > 1 && frozen.lake.id === lake.id);
  assert.equal(world.surface(lake.x, lake.z), lake.level);
  for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) for (const p of world.props(cx, cz)) assert.equal(world.iceAt(p.x, p.z), null, p.id);
  // Lakes outside the Frostlands still hold open water.
  const open = createWorld(3);
  assert.ok(!open.frozen(open.starterLake) && open.waterAt(open.starterLake.x, open.starterLake.z));
});

test('in synthwave every lake is open water, the Frostlands’ too, and they freeze again after', () => {
  const world = createWorld(SEED), lake = world.starterLake;
  world.setSynthwave(true);
  assert.equal(world.frozen(lake), false); assert.equal(world.iceAt(lake.x, lake.z), null);
  assert.ok(world.waterAt(lake.x, lake.z)?.depth > 1);
  assert.ok(world.surface(lake.x, lake.z) < lake.level, 'the bed, under open water');
  const car = createVehicle(world, lake.x, lake.z - lake.rz * 1.12, 0);
  for (let i = 0; i < 120 * 12 && !car.floating; i++) stepVehicle(car, { up: true }, world, []);
  assert.equal(car.floating, true, 'drives in and floats');
  world.setSynthwave(false);
  assert.equal(world.frozen(lake), true); assert.equal(world.waterAt(lake.x, lake.z), null);
});

test('synthwave has no Frostlands: no snow to slip on, and they come back after', () => {
  const world = createWorld(SEED);
  world.setSynthwave(true);
  assert.equal(world.frostAt(0, 0), 0);
  const glass = createVehicle(world, 0, 0, 0), everyday = createVehicle(createWorld(SEED), 0, 0, 0);
  advance(glass, { up: true }, world, 2); advance(everyday, { up: true }, createWorld(SEED), 2);
  assert.ok(glass.speed > everyday.speed, `${glass.speed} m/s on the grid, ${everyday.speed} m/s on packed snow`);
  world.setSynthwave(false);
  assert.ok(world.frostAt(0, 0) > .9);
});

test('the ATLAS drives straight across a frozen lake on its wheels, and the Roadster too', () => {
  for (const kind of ['atlas', 'roadster']) {
    const world = createWorld(SEED), lake = world.starterLake;
    const car = createVehicle(world, lake.x, lake.z - lake.rz * 1.12, 0, kind);
    let onIce = 0;
    for (let i = 0; i < 120 * 30 && car.z < lake.z + lake.rz * 1.1; i++) {
      stepVehicle(car, { up: true }, world, []);
      assert.equal(car.floating ?? false, false); assert.equal(car.transform ?? 0, 0); assert.equal(car.overWater ?? false, false);
      if (car.onIce) { onIce++; assert.ok(Math.abs(car.y - (lake.level + .06)) < .08, `${kind} rides on the ice at ${car.y - lake.level}`); }
    }
    assert.ok(onIce * FIXED_DT > 3, `${kind}: ${onIce * FIXED_DT} s on the ice`);
    assert.ok(lakeRadius(lake, car.x, car.z) > 1, `${kind} reaches the far shore`);
  }
});

test('ice is very slippery: long stops, slow starts and wide slides', () => {
  for (const kind of ['atlas', 'roadster']) {
    const dry = stopping(flat, kind), icy = stopping(ice, kind);
    assert.ok(icy > dry * 2.5, `${kind} stops in ${icy.toFixed(0)} m on ice, ${dry.toFixed(0)} m on tarmac`);
    assert.ok(slide(ice, kind) > slide(flat, kind) * 4 && slide(ice, kind) > .25, `${kind} slides ${slide(ice, kind).toFixed(2)} rad`);
  }
  const launch = world => { const car = createVehicle(world); advance(car, { up: true }, world, 2); return car.speed; };
  assert.ok(launch(ice) < launch(flat) * ICE.traction * 1.2);
});

test('packed snow grips less than tarmac and far more than ice', () => {
  const dry = stopping(flat), packed = stopping(snow), icy = stopping(ice);
  assert.ok(packed > dry * 1.1 && packed < icy * .6, `${dry.toFixed(0)} m, ${packed.toFixed(0)} m, ${icy.toFixed(0)} m`);
  assert.ok(slide(snow) > slide(flat) && slide(snow) < slide(ice));
});

test('the Frostlands snow about half the time, half of that in snowstorms, and never rain', () => {
  const region = { seed: 3, height: () => 40, desertAt: () => 0, woodlandAt: () => 0, frostAt: () => 1 };
  const kinds = { clear: 0, rain: 0, snow: 0, snowstorm: 0, sandstorm: 0 }, samples = 6000;
  for (let i = 0; i < samples; i++) kinds[weatherAt(region, (i % 41) * WEATHER_AREA, Math.floor(i / 41) * WEATHER_AREA, i * WEATHER_CELL).kind]++;
  assert.ok(Math.abs((kinds.snow + kinds.snowstorm) / samples - .5) < .03, `snow ${kinds.snow / samples}`);
  assert.ok(Math.abs(kinds.snowstorm / samples - .25) < .03, `snowstorms ${kinds.snowstorm / samples}`);
  assert.equal(kinds.rain, 0); assert.equal(kinds.sandstorm, 0);
  assert.equal(regionWeights(region, 0, 0).frost, 1);
});
