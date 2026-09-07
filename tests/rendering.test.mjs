import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { cloneOwnedGeometry, createCactusGeometry } from '../scenery.mjs';
import { batchStaticMeshes } from '../batching.mjs';
import { createTerrain } from '../terrain.mjs';
import { farIndices } from '../streaming-layout.mjs';
import { createWorld } from '../world.mjs';

test('chunk geometry owns its metadata and instance attributes independently', () => {
  const template = new THREE.BoxGeometry(), a = cloneOwnedGeometry(template), b = cloneOwnedGeometry(template);
  a.setAttribute('groundDelta', new THREE.InstancedBufferAttribute(new Float32Array([1, 2]), 1));
  b.setAttribute('groundDelta', new THREE.InstancedBufferAttribute(new Float32Array([3, 4, 5]), 1));
  assert.equal(template.userData.owned, undefined); assert.notEqual(a.userData, b.userData);
  assert.equal(template.hasAttribute('groundDelta'), false);
  let disposed = 0; b.addEventListener('dispose', () => disposed++); template.addEventListener('dispose', () => disposed++);
  a.dispose(); assert.equal(disposed, 0); assert.equal(b.getAttribute('groundDelta').count, 3);
  b.dispose(); template.dispose();
});
test('batching preserves world bounds and material references inside moving groups', () => {
  const root = new THREE.Group(); root.position.set(5, 2, -8); root.rotation.y = .4;
  const subgroup = new THREE.Group(); subgroup.rotation.z = .3; root.add(subgroup);
  const material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 8; i++) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), material); mesh.position.x = i; subgroup.add(mesh); }
  const before = new THREE.Box3().setFromObject(root, true), result = batchStaticMeshes(root), after = new THREE.Box3().setFromObject(root, true);
  assert.equal(result.before, 8); assert.equal(result.after, 1);
  assert.ok(before.min.distanceTo(after.min) < 1e-5 && before.max.distanceTo(after.max) < 1e-5);
  let meshes = 0; root.traverse(mesh => { if (mesh.isMesh) { meshes++; assert.equal(mesh.material, material); } }); assert.equal(meshes, 1);
});
test('coarse tiles cut out only loaded fine chunks, including negative coordinates', () => {
  assert.equal(farIndices(0, 0, () => false).length, 16 * 16 * 6);
  assert.equal(farIndices(0, 0, () => true).length, 0);
  for (const tile of [-2, -1, 0, 1]) {
    const indices = farIndices(tile, tile, (cx, cz) => cx === tile * 4 && cz === tile * 4);
    assert.equal(indices.length, (256 - 16) * 6);
    assert.ok(indices.every(index => index >= 0 && index < 289));
  }
});
test('worker terrain retains exact fine triangles and matching coarse boundaries', () => {
  const world = createWorld(100003), terrain = createTerrain(world);
  const a = terrain.build(-96, 0, 96, 4), b = terrain.build(0, 0, 96, 4);
  for (let z = 0; z <= 24; z++) {
    const i = (z * 25 + 24) * 3, j = z * 25 * 3;
    assert.equal(a.position[i + 1], b.position[j + 1]);
    assert.equal(a.position[i + 1], Math.fround(world.height(0, z * 4)));
    assert.equal(a.coarseHeight[z * 25 + 24], b.coarseHeight[z * 25]);
    assert.deepEqual([...a.coarseColor.slice(i, i + 3)], [...b.coarseColor.slice(j, j + 3)]);
  }
  const cactus = createCactusGeometry();
  assert.ok([...cactus.attributes.position.array].every(Number.isFinite));
  assert.ok(cactus.boundingSphere.radius > 2); cactus.dispose();
});
