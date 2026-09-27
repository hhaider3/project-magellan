import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { createWorld } from '../world.mjs';
import { createWater } from '../water.mjs';
import { buildWaterData } from '../water-data.mjs';
import { farCoverage, farIndices } from '../streaming-layout.mjs';

test('requesting and installing lakes never samples terrain on the main thread', () => {
  const workerWorld = createWorld(3), lakes = workerWorld.lakesNear(0, 0, 1000);
  const mainWorld = { lakesNear: () => lakes, surface: () => assert.fail('terrain work belongs in the worker') };
  const scene = new Scene(), water = createWater(scene);
  const requests = water.sync(mainWorld, 0, 0);
  assert.equal(requests.length, lakes.length); assert.equal(water.count, 0); assert.equal(water.ready, false);
  for (const lake of requests) {
    const data = buildWaterData(workerWorld, lake);
    const message = structuredClone(data, { transfer: Object.values(data).map(array => array.buffer) });
    assert.equal(data.position.byteLength, 0);
    assert.equal(water.install(lake, message), true);
    const geometry = scene.children.at(-1).geometry;
    assert.equal(geometry.attributes.position.array, message.position, 'install without copying vertex buffers');
    assert.equal(geometry.index.array, message.index);
    assert.equal(water.install(lake, message), false, 'deduplicate results');
  }
  assert.equal(water.ready, true); assert.equal(water.count, lakes.length);
  assert.deepEqual(water.sync(mainWorld, 0, 0), []);
  water.clear();
});

test('late lake results are rejected and discarded lake geometry is disposed', () => {
  const world = createWorld(3), scene = new Scene(), water = createWater(scene);
  const first = water.sync(world, 0, 0)[0], data = buildWaterData(world, first);
  water.install(first, data);
  let disposed = 0; scene.children.at(-1).geometry.addEventListener('dispose', () => disposed++);
  const pending = water.sync(world, 5000, -5000);
  assert.equal(disposed, 1); assert.equal(water.install(first, data), false);
  assert.ok(pending.length > 0 && pending.length < 12);
  const next = pending[0], nextData = buildWaterData(world, next);
  water.clear();
  assert.equal(water.install(next, nextData), false); assert.equal(water.count, 0);
  assert.equal(scene.children.length, 1, 'only the reusable wake pool remains');
});

test('worker water keeps the terrain grid, winding, depth and embedded typed arrays', () => {
  const world = createWorld(3), lake = world.starterLake, data = buildWaterData(world, lake);
  assert.ok(data.position instanceof Float32Array && data.index instanceof Uint16Array);
  assert.ok(data.index.length > 0);
  for (let i = 0; i < data.bedDepth.length; i++) {
    const x = data.position[i * 3], z = data.position[i * 3 + 2];
    assert.equal(x % 4, 0); assert.equal(z % 4, 0);
    assert.equal(data.position[i * 3 + 1], Math.fround(lake.level + .012));
    assert.equal(data.bedDepth[i], Math.fround(lake.level - world.surface(x, z)));
  }
  for (let i = 0; i < data.index.length; i += 3) {
    const [a, b, c] = data.index.slice(i, i + 3);
    const ax = data.position[a * 3], az = data.position[a * 3 + 2];
    const bx = data.position[b * 3], bz = data.position[b * 3 + 2];
    const cx = data.position[c * 3], cz = data.position[c * 3 + 2];
    assert.ok((bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0, 'upward facing');
  }
});

test('dry driving avoids updating unused wake buffers', () => {
  const scene = new Scene(), water = createWater(scene), wakes = scene.children[0];
  const pose = { x: 0, z: 0, y: 0, heading: 0, speed: 30, transform: 0, time: 0 };
  for (let i = 0; i < 120; i++) { pose.time += 1 / 60; water.update({ waterAt: () => null }, pose, 1 / 60); }
  assert.equal(wakes.count, 0); assert.equal(wakes.instanceMatrix.version, 0);
  assert.equal(wakes.geometry.attributes.wakeOpacity.version, 0);
  pose.y = -.52; pose.transform = 1;
  water.update({ waterAt: () => ({ level: 0 }) }, pose, .1);
  assert.ok(wakes.count > 0 && wakes.instanceMatrix.version > 0);
  water.clear();
});

test('coarse coverage masks detect arrivals, removals and negative tiles with just 16 lookups', () => {
  for (const tx of [-2, -1, 0, 3]) for (const tz of [-1, 0, 2]) {
    for (const mask of [0, 1, 0x8000, 0xa55a, 0xffff]) {
      let reads = 0;
      const hasFine = (x, z) => { reads++; return Boolean(mask & 1 << ((z - tz * 4) * 4 + x - tx * 4)); };
      assert.equal(farCoverage(tx, tz, hasFine), mask); assert.equal(reads, 16);
      const absent = 16 - mask.toString(2).replaceAll('0', '').length;
      assert.equal(farIndices(tx, tz, hasFine).length, absent * 16 * 6);
    }
  }
});
