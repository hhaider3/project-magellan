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
function vertices(geometry, matrix) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry, p = flat.getAttribute('position'), v = new THREE.Vector3(), result = [];
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(matrix); result.push(v.toArray().map(x => Math.round(x * 10000)).join(',')); }
  if (flat !== geometry) flat.dispose();
  return result;
}
test('tree fracture initially preserves the standing silhouette then separates continuously', () => {
  const sources = makeSources(), scene = new THREE.Scene(), effect = createTreeBreakage(scene, sources);
  const root = new THREE.Object3D(); root.position.set(prop.x, prop.y - .08, prop.z); root.rotation.y = prop.turn; root.scale.setScalar(prop.size); root.updateMatrix();
  const before = sources.flatMap(({ geometry }) => vertices(geometry, root.matrix)).sort();
  effect.burst(prop); effect.update(1 / 60, flat);
  const m = new THREE.Matrix4();
  const after = scene.children.flatMap(mesh => { mesh.getMatrixAt(0, m); return vertices(mesh.geometry, m); }).sort();
  assert.deepEqual(after, before, 'replacement retains the exact triangles at impact');
  scene.children[0].getMatrixAt(0, m); const first = m.clone();
  effect.update(1 / 120, flat); scene.children[0].getMatrixAt(0, m);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(new THREE.Vector3().setFromMatrixPosition(first)) < .01, 'no initial jump to flying particles');
  for (let i = 0; i < 90; i++) effect.update(1 / 60, flat);
  scene.children[0].getMatrixAt(0, m); assert.notDeepEqual(m.elements, first.elements);
  assert.ok(m.elements.every(Number.isFinite));
  for (let i = 0; i < 150; i++) effect.update(1 / 60, flat);
  assert.equal(effect.count, 0); assert.ok(scene.children.every(mesh => mesh.count === 0));
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
