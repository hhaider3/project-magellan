import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../world.mjs';
import { lakeExtent } from '../lakes.mjs';

// Seeds where a camp, lookout or ramp once stood on a road: the first lookout
// on a highway (880447, 575140, 1644205), the first roll and jump on a road
// (670168, 1066118), and sites on a lake's slipway or a mountain track.
const SEEDS = [880447, 575140, 1644205, 670168, 1066118, 187109, 345489, 606816, 868143, 3];
const worlds = SEEDS.map(seed => { const world = createWorld(seed); world.prepareRoads(0, 0, 1600, 1e9); return { seed, world }; });

test('camps, lookouts and ramps never stand on a road of any kind, nor in the water', () => {
  for (const { seed, world } of worlds) for (const f of world.featuresNear(0, 0, 1400)) {
    if (f.type === 'none') continue;
    const road = world.roadAt(f.x, f.z);
    // Its own lane ends 10 m short of a camp or lookout.
    if (road.id !== `spur:${f.id}`) assert.ok(road.d > (f.type === 'camp' ? 9 : f.type === 'lookout' ? 5 : 3), `seed ${seed}: ${f.id} (${f.type}) ${road.d.toFixed(1)} m from ${road.id}`);
    assert.equal(world.waterAt(f.x, f.z), null, `seed ${seed}: ${f.id} in the water`);
  }
});

test('the start is open: the first ramps a way up the road, the first lake and every other site further out', () => {
  for (const { seed, world } of worlds) {
    const from = f => Math.hypot(f.x, f.z);
    assert.ok(from(world.starterRamp) > 120 && from(world.starterRamp) < 200, `seed ${seed}: first jump ${from(world.starterRamp)} m out`);
    assert.ok(from(world.twistRamp) > 400 && from(world.twistRamp) < 520, `seed ${seed}: first roll ${from(world.twistRamp)} m out`);
    const lake = world.starterLake;
    assert.ok(from(lake) - lakeExtent(lake) > 350, `seed ${seed}: Mirror Lake's shore ${from(lake) - lakeExtent(lake)} m out`);
    const sites = world.featuresNear(0, 0, 600).filter(f => f.type !== 'none' && !f.id.startsWith('first'));
    for (const f of sites) assert.ok(from(f) >= 320, `seed ${seed}: ${f.id} only ${from(f)} m out`);
    assert.ok(!world.featuresNear(0, 0, 900).some(f => f.id === 'first-lookout'));
  }
});
