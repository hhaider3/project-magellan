import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createTreeBreakage } from '../tree-breakage.mjs';
import { synthesizeBreak } from '../break-audio.mjs';

const makeSources = () => [
  { geometry: new THREE.CylinderGeometry(.15, .27, 3.1, 6).translate(0, 1.55, 0), color: '#645840' },
  { geometry: new THREE.ConeGeometry(1.95, 4.7, 7).translate(0, 3.65, 0), color: '#365e4d' },
  { geometry: new THREE.ConeGeometry(1.35, 3.4, 7).translate(0, 5.2, 0), color: '#527463' },
];
const flat = { surface: () => 0 };
const prop = { x: 4, y: .08, z: -3, size: 1.2, turn: .7, vx: 0, vz: 40 };
function solidVolume(geometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = flat.getAttribute('position'), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  if (flat !== geometry) flat.dispose();
  return volume;
}
function piecePositions(scene) {
  return scene.children.map(mesh => { const m = new THREE.Matrix4(); mesh.getMatrixAt(0, m); return new THREE.Vector3().setFromMatrixPosition(m); });
}
test('solid tree sections preserve the original exterior at contact and close every cut', () => {
  const sources = makeSources(), scene = new THREE.Scene(), effect = createTreeBreakage(scene, sources);
  const original = new THREE.Group(); original.position.set(prop.x, prop.y - .08, prop.z); original.rotation.y = prop.turn; original.scale.setScalar(prop.size);
  for (const { geometry } of sources) original.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  original.updateMatrixWorld(true);
  effect.burst(prop); effect.update(0, flat); scene.updateMatrixWorld(true);
  const before = new THREE.Box3().setFromObject(original), after = new THREE.Box3().setFromObject(scene);
  assert.ok(before.min.distanceTo(after.min) < 1e-5); assert.ok(before.max.distanceTo(after.max) < 1e-5);
  // Ray hits compare the actual outside surface, not triangle counts (the cuts
  // necessarily introduce new triangles). Check every side and height.
  for (let angle = 0; angle < 12; angle++) for (let y = .1; y < 8.2; y += .17) {
    const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const origin = new THREE.Vector3(prop.x, y, prop.z).addScaledVector(direction, 20);
    const ray = new THREE.Raycaster(origin, direction.negate());
    const a = ray.intersectObject(original)[0], b = ray.intersectObject(scene)[0];
    assert.equal(Boolean(a), Boolean(b));
    if (a) assert.ok(Math.abs(a.distance - b.distance) < 1e-5);
  }
  sources.forEach(({ geometry }, source) => {
    const sections = scene.children.slice(source * 3, source * 3 + 3);
    const volumes = sections.map(mesh => solidVolume(mesh.geometry));
    assert.ok(volumes.every(v => v > 0), 'fragments have solid volume and outward winding');
    assert.ok(Math.abs(volumes.reduce((a, b) => a + b, 0) - solidVolume(geometry)) < 1e-5);
    for (const mesh of sections) {
      // From either end, the center ray must hit a cap, not see through a skin.
      for (const sign of [-1, 1]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(0, sign * 20, 0), new THREE.Vector3(0, -sign, 0));
        assert.ok(ray.intersectObject(new THREE.Mesh(mesh.geometry, mesh.material)).length > 0);
      }
    }
  });
});
test('fast tree impacts open visible gaps immediately with continuous onset and bounded lifetime', () => {
  function simulate(speed) {
    const scene = new THREE.Scene(), effect = createTreeBreakage(scene, makeSources());
    effect.burst({ ...prop, vz: speed }); effect.update(0, flat);
    const initial = piecePositions(scene);
    effect.update(.00001, flat);
    assert.ok(piecePositions(scene).every((p, i) => p.distanceTo(initial[i]) < .001), 'continuous at the contact instant');
    effect.update(.08 - .00001, flat);
    const displacements = piecePositions(scene).map((p, i) => p.sub(initial[i]));
    const separation = displacements[0].distanceTo(displacements[1]);
    for (let i = 0; i < 180; i++) effect.update(1 / 60, flat);
    assert.equal(effect.count, 0); assert.ok(scene.children.every(mesh => mesh.count === 0));
    return separation;
  }
  const slow = simulate(20), fast = simulate(83.3);
  assert.ok(fast > 1, 'neighboring trunk sections separate by over a metre within 80 ms at highway speed');
  assert.ok(fast > slow * 1.5, 'impact response scales with speed');
});
test('falling trees have a fixed capacity and reset without modifying source geometry', () => {
  const sources = makeSources(), before = sources.map(s => [...s.geometry.attributes.position.array]);
  const scene = new THREE.Scene(), effect = createTreeBreakage(scene, sources, 3);
  for (let i = 0; i < 20; i++) effect.burst({ ...prop, x: i });
  effect.update(.1, flat); assert.equal(effect.count, 3); assert.equal(scene.children.length, 9);
  assert.ok(scene.children.every(mesh => mesh.count === 3));
  sources.forEach((s, i) => assert.deepEqual([...s.geometry.attributes.position.array], before[i]));
  effect.clear(); assert.equal(effect.count, 0); assert.ok(scene.children.every(mesh => mesh.count === 0));
});
test('wood, cactus and stone effects produce distinct finite signals with clean ends', () => {
  const sounds = ['tree', 'cactus', 'rock', 'boulder'].map(type => synthesizeBreak(type, 22050));
  for (const samples of sounds) {
    assert.equal(Math.abs(samples[0]), 0); assert.ok(Math.abs(samples.at(-1)) < .001);
    assert.ok(samples.every(x => Number.isFinite(x) && Math.abs(x) <= 1));
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    assert.ok(rms > .025 && rms < .4);
  }
  for (let i = 0; i < sounds.length; i++) for (let j = i + 1; j < sounds.length; j++) assert.notDeepEqual(sounds[i].slice(0, 2000), sounds[j].slice(0, 2000));
});
