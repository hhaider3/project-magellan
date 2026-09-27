import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, recoverVehicle, FIXED_DT } from '../world.mjs';
import { createLakes } from '../lakes.mjs';
const advance = (car, world, seconds, input = {}) => {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) stepVehicle(car, input, world, []);
};

test('lake terrain and water regenerate deterministically after cache eviction', () => {
  const world = createWorld(3), lake = world.starterLake;
  assert.equal(world.waterAt(0, 0), null);
  const water = world.waterAt(lake.x, lake.z);
  assert.ok(water.depth > 8 && water.depth < 12);
  assert.equal(water.depth, water.level - world.surface(lake.x, lake.z));
  const lakes = createLakes(3, () => 10, () => ({ d: 150 }));
  const original = structuredClone(lakes.starter);
  for (let i = 0; i < 150; i++) lakes.near(i * 840, i * 840, 0);
  assert.deepEqual(lakes.lakeAt(180, 160), original);
  assert.deepEqual(world.starterLake, createWorld(3).starterLake);
  for (let cx = 0; cx < 4; cx++) for (let cz = 0; cz < 4; cz++) {
    for (const prop of world.props(cx, cz)) assert.equal(world.waterAt(prop.x, prop.z), null);
  }
});

test('drive through a real lake: unfold continuously, float, cross and return to wheels', () => {
  for (const seed of [1, 3, 77, 100003]) {
    const world = createWorld(seed), lake = world.starterLake;
    const car = createVehicle(world, lake.x, lake.z - lake.rz * 1.12, 0);
    let partial = false, boat = false, returning = false, previous = 0;
    for (let i = 0; i < 120 * 17; i++) {
      stepVehicle(car, { up: true }, world, []);
      assert.ok(Math.abs(car.transform - previous) <= FIXED_DT / 2.4 + 1e-10);
      previous = car.transform;
      partial ||= car.transform > .1 && car.transform < .9;
      boat ||= car.transform === 1;
      returning ||= boat && !car.boatMode && car.transform > 0;
      if (car.floating) {
        assert.ok(car.y >= car.waterLevel - .98, `seed ${seed} floats at ${car.y - car.waterLevel}`);
        assert.equal(car.airtime, 0);
        assert.equal(car.grounded, false);
      }
    }
    assert.ok(partial && boat && returning);
    assert.equal(car.transform, 0); assert.equal(car.boatMode, false);
    assert.equal(car.transformations, 1); assert.ok(car.boatDistance > 150);
    assert.ok(car.z > lake.z + lake.rz); assert.ok(car.speed > 10);
  }
});

test('mountain lakes have closed downhill shores and leave nearby roads dry', () => {
  for (const seed of [12345, 483921, 999999]) {
    const world = createWorld(seed);
    for (const lake of world.lakesNear(0, 0, 2500)) for (let i = 0; i < 64; i++) {
      const a = i * Math.PI / 32, x = lake.x + Math.sin(a) * lake.rx * 1.019, z = lake.z + Math.cos(a) * lake.rz * 1.019;
      assert.ok(world.surface(x, z) > lake.level, `closed rim: ${seed} ${lake.id}`);
      const road = world.roadAt(x, z);
      assert.equal(world.waterAt(road.x, road.z), null, `dry road: ${seed} ${lake.id}`);
    }
  }
});

test('boat depth hysteresis, reverse animation, steering, braking and jump suppression', () => {
  let depth = 2;
  const world = { surface: () => -depth, gradient: () => ({ x: 0, z: 0 }), roadAt: (x, z) => ({ x, z, d: 100 }), props: () => [], waterAt: () => ({ level: 0, depth }) };
  const car = createVehicle(world);
  advance(car, world, 3, { up: true, left: true, jump: true });
  assert.ok(car.heading > .8); assert.ok(car.speed > 5); assert.equal(car.jumps, 0);
  assert.equal(car.landings, 0); assert.equal(car.bestJump, 0);
  depth = .6; advance(car, world, .5); assert.equal(car.transform, 1);
  depth = .35; advance(car, world, 1); assert.ok(car.transform > .5 && car.transform < .7);
  const partial = car.transform;
  depth = 2; car.y = -.52; advance(car, world, .25);
  assert.ok(car.transform > partial && car.transform < 1);
  advance(car, world, 7, { down: true }); assert.ok(car.speed < -2);
});

test('airborne entry does not transform until contact, and recovery restores a dry car', () => {
  const world = createWorld(3), lake = world.starterLake;
  const car = createVehicle(world, lake.x, lake.z);
  car.y = lake.level + 12; car.vy = -25; car.boatMode = car.floating = false; car.transform = 0;
  stepVehicle(car, {}, world, []); assert.equal(car.transform, 0);
  advance(car, world, 4);
  assert.equal(car.transform, 1); assert.ok(Math.abs(car.y - (lake.level - .52)) < .15);
  const distance = car.boatDistance;
  assert.ok(recoverVehicle(car, world));
  assert.equal(world.waterAt(car.x, car.z), null); assert.equal(car.transform, 0);
  assert.equal(car.floating, false); assert.equal(car.boatDistance, distance);
});
