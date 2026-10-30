import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { assembleSakura } from '../sakura-model.mjs';
import { createTreeBreakage } from '../tree-breakage.mjs';
import { createWorld, createVehicle, resolveObstacles, VARIANT, SAKURA_HEIGHT } from '../world.mjs';

// Decode the new asset's mesh buffers without a browser image decoder. Textures
// get real THREE.Texture placeholders; browser checks cover image loading.
const bytes = await readFile(new URL('../assets/nature/sakura-realistic/sakura-tree.glb', import.meta.url));
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const binary = bytes.subarray(28 + jsonLength);
function attribute(index) {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const types = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array };
  const Type = types[a.componentType], size = sizes[a.type];
  assert.ok(!view.byteStride || view.byteStride === size * Type.BYTES_PER_ELEMENT);
  const start = (view.byteOffset || 0) + (a.byteOffset || 0);
  const data = binary.subarray(start, start + a.count * size * Type.BYTES_PER_ELEMENT);
  return new THREE.BufferAttribute(new Type(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), size);
}
function makeScene() {
  const scene = new THREE.Group();
  for (const node of gltf.nodes.filter(n => n.name === 'Sakura_Trunk_Branches' || n.name === 'Sakura_Blossom_Canopy')) {
    const primitive = gltf.meshes[node.mesh].primitives[0], geometry = new THREE.BufferGeometry();
    for (const [key, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) geometry.setAttribute(name, attribute(primitive.attributes[key]));
    geometry.setIndex(attribute(primitive.indices));
    const m = gltf.materials[primitive.material];
    const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide, alphaTest: m.alphaMode === 'MASK' ? m.alphaCutoff : 0 });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = node.name;
    if (node.translation) mesh.position.fromArray(node.translation);
    if (node.rotation) mesh.quaternion.fromArray(node.rotation);
    if (node.scale) mesh.scale.fromArray(node.scale);
    scene.add(mesh);
  }
  return scene;
}
const model = assembleSakura(makeScene());

test('new sakura exports 9,996 triangles and an exact eight-second animation', () => {
  const triangles = gltf.nodes.filter(n => n.mesh !== undefined).reduce((sum, node) => sum + gltf.meshes[node.mesh].primitives.reduce((n, p) => n + gltf.accessors[p.indices].count / 3, 0), 0);
  assert.equal(triangles, 9996);
  assert.equal(model.triangles, 9174);
  assert.ok(Math.abs(model.bounds.max.y - SAKURA_HEIGHT) < 1e-5);
  assert.ok(Math.abs(model.bounds.min.y) < 1e-5);
  assert.equal(gltf.animations.length, 1);
  for (const s of gltf.animations[0].samplers) {
    const times = attribute(s.input).array;
    assert.equal(times[0], 0); assert.equal(times.at(-1), 8);
    const values = attribute(s.output), n = values.itemSize;
    for (let i = 0; i < n; i++) assert.ok(Math.abs(values.array[i] - values.array[values.array.length - n + i]) < 1e-5, 'loop endpoints match');
  }
});

function surfaces(geometry, offset = new THREE.Vector3()) {
  const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), n = geometry.getAttribute('normal');
  const index = geometry.index?.array ?? Uint32Array.from({ length: p.count }, (_, i) => i);
  return Array.from(index, i => ({ key: [uv.getX(i), uv.getY(i)].join(','), position: new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).add(offset) }));
}
test('breakage preserves every branch/blossom surface and UV and uses independent textured materials', () => {
  for (const part of model.parts) {
    const fragments = model.treeSource.fragments.filter(f => f.material.map === part.material.map);
    assert.ok(fragments.length >= 5);
    const expected = new Map();
    for (const v of surfaces(part.geometry)) { if (!expected.has(v.key)) expected.set(v.key, []); expected.get(v.key).push(v.position); }
    for (const v of fragments.flatMap(f => surfaces(f.geometry, f.center))) {
      const candidates = expected.get(v.key); assert.ok(candidates);
      const i = candidates.findIndex(p => p.distanceTo(v.position) < 1e-5);
      assert.ok(i >= 0, 'fragment vertex and UV/normal match an original vertex'); candidates.splice(i, 1);
    }
    assert.ok([...expected.values()].every(v => v.length === 0), 'every original vertex is present exactly once');
    for (const fragment of fragments) {
      assert.notEqual(fragment.material, part.material);
      assert.equal(fragment.material.alphaTest, part.material.alphaTest);
      assert.equal(fragment.material.side, part.material.side);
    }
  }
  const scene = new THREE.Scene(), effect = createTreeBreakage(scene, [model.treeSource]);
  const prop = { type: 'tree', variant: 5, x: 0, y: .08, z: 0, size: 1, turn: 0, vx: 0, vz: 40 };
  const floor = { surface: () => -100 };
  effect.burst(prop); effect.update(0, floor);
  const matrix = new THREE.Matrix4();
  scene.children.forEach((mesh, i) => {
    assert.equal(mesh.count, 1); mesh.getMatrixAt(0, matrix);
    assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(model.treeSource.fragments[i].center) < 1e-5);
    assert.ok(mesh.material.map); assert.ok(mesh.geometry.hasAttribute('uv'));
  });
  effect.update(.08, floor);
  assert.ok(scene.children.some((mesh, i) => { mesh.getMatrixAt(0, matrix); return new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(model.treeSource.fragments[i].center) > 1; }));
  effect.update(3, floor); assert.equal(effect.count, 0); assert.ok(scene.children.every(m => m.count === 0));
});

test('sakura uses the same car-impact threshold and persistent broken-prop events as other trees', () => {
  for (const speed of [17, 40]) {
    const world = createWorld(1), prop = { id: 'new-sakura', type: 'tree', variant: VARIANT.tree.sakura, x: 0, y: 0, z: 1, size: 1, turn: 0, r: .3, h: 5.1 };
    const car = createVehicle({ surface: () => 0 }); car.vz = speed;
    resolveObstacles(car, [prop], world);
    assert.equal(world.brokenProps.has(prop.id), speed >= 18);
    const events = world.drainBreakEvents(); assert.equal(events.length, speed >= 18 ? 1 : 0);
    if (events.length) {
      assert.equal(events[0].variant, 5);
      resolveObstacles(car, [prop], world); assert.equal(world.drainBreakEvents().length, 0);
      assert.equal(car.smashed, 1);
    }
  }
});
