import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createWorld, CHUNK } from '../world.mjs';
import { createTerrain } from '../terrain.mjs';
import { buildGrass, MAX_GRASS_PER_CHUNK } from '../grass-data.mjs';
import { createGrass } from '../grass.mjs';

test('grass is seeded, bounded and follows terrain triangles while leaving roads, sand and ramps clear', () => {
  let total = 0;
  for (const seed of [3, 77, 100003]) {
    const world = createWorld(seed), terrain = createTerrain(world);
    for (const [cx, cz] of [[0, 0], [-1, -1], [1, 1]]) {
      const ground = terrain.build(cx * CHUNK, cz * CHUNK, CHUNK, 4), data = buildGrass(world, cx, cz, ground);
      assert.deepEqual(data, buildGrass(world, cx, cz, ground));
      assert.ok(data.roots.length / 3 <= MAX_GRASS_PER_CHUNK); total += data.roots.length / 3;
      for (let i = 0; i < data.roots.length; i += 3) {
        const x = data.roots[i] + cx * CHUNK, y = data.roots[i + 1] + .035, z = data.roots[i + 2] + cz * CHUNK;
        assert.ok(data.roots[i] > 0 && data.roots[i] < CHUNK && data.roots[i + 2] > 0 && data.roots[i + 2] < CHUNK);
        assert.ok(Math.abs(y - world.surface(x, z)) < 1e-4);
        assert.ok(world.roadAt(x, z).d >= 7.5 - 1e-5); assert.equal(world.reserved(x, z), false);
        assert.ok(world.desertAt(x, z, y) <= .12001); assert.ok(y < 110);
      }
    }
  }
  assert.ok(total > 1000, 'plains have visible grass, not just an empty valid result');
});

test('grass has no placement in sand, snow or steep terrain', () => {
  const world = createWorld(3), terrain = createTerrain(world), ground = terrain.build(0, 0, CHUNK, 4);
  assert.equal(buildGrass({ ...world, desertAt: () => 1 }, 0, 0, ground).roots.length, 0);
  const snowy = { position: ground.position.slice() }; for (let i = 1; i < snowy.position.length; i += 3) snowy.position[i] = 150;
  assert.equal(buildGrass(world, 0, 0, snowy).roots.length, 0);
  const steep = { position: ground.position.slice() }; for (let i = 0; i < steep.position.length; i += 3) steep.position[i + 1] = steep.position[i] * .6;
  assert.equal(buildGrass(world, 0, 0, steep).roots.length, 0);
});

test('grass render cost, mobile density and buffer ownership remain bounded across streaming', () => {
  const world = createWorld(3), terrain = createTerrain(world), data = buildGrass(world, 0, 0, terrain.build(0, 0, CHUNK, 4));
  const center = { value: new THREE.Vector2() }, desktop = createGrass(false, center), phone = createGrass(true, center);
  const a = desktop.build(data), b = desktop.build(data), mobile = phone.build(data);
  assert.ok(a && b && mobile);
  assert.equal(a.castShadow, false); assert.equal(a.material.transparent, false);
  assert.equal(a.geometry.attributes.position.count, 9);
  assert.equal(mobile.geometry.instanceCount, Math.floor(a.geometry.instanceCount / 2));
  assert.notEqual(a.geometry.attributes.position, b.geometry.attributes.position);
  const firstHalf = Array.from({ length: mobile.geometry.instanceCount }, (_, i) => [data.roots[i * 3], data.roots[i * 3 + 2]]);
  for (const xHalf of [0, 1]) for (const zHalf of [0, 1]) assert.ok(firstHalf.some(([x, z]) => Math.floor(x / 48) === xHalf && Math.floor(z / 48) === zHalf));
  for (const system of [desktop, phone]) for (const [x, z] of [[0, 0], [48, 48], [-.1, 96.1], [31, -37]]) {
    let visible = 0;
    for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
      system.update(a, cx, cz, x, z); visible += Number(a.visible);
    }
    assert.ok(visible <= (system === phone ? 4 : 9));
  }
  a.geometry.dispose(); assert.ok(b.geometry.attributes.position.array.every(Number.isFinite));
});
