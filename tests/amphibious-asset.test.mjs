import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { createTransformation } from '../vehicle-model.mjs';
const bytes = await readFile(new URL('../assets/vehicles/atlas-amphibious.glb', import.meta.url));
const { scene, animations } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const rig = createTransformation(scene, animations);
const size = () => new Box3().setFromObject(scene, true).getSize(new Vector3());

test('Blender exports an embedded, bounded car-to-boat animation', () => {
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.ok(gltf.asset.generator.includes('Blender'));
  assert.ok(gltf.buffers.every(b => !b.uri)); assert.equal(gltf.images?.length ?? 0, 0);
  assert.equal(animations.length, 1); assert.ok(rig.duration > 2.3 && rig.duration < 2.5);
  let meshes = 0, triangles = 0;
  scene.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes <= 80); assert.ok(triangles < 70000); assert.ok(bytes.length < 4 * 1024 * 1024);
});

test('the original body and wheels move continuously and return exactly, with no model swap', () => {
  rig.update(0); const car = size(), initial = [];
  scene.traverse(o => initial.push({ id: o.uuid, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
  assert.ok(car.x < 2.8 && car.z < 4.9);
  for (const part of ['Hull_L', 'Hull_R', 'Bow_Extension', 'Cabin_Slide', 'WheelFold_FL', 'Jet_L', 'Keel_Deploy']) assert.ok(scene.getObjectByName(part));
  rig.update(.5); const halfway = size();
  rig.update(1); const boat = size();
  assert.ok(boat.x > car.x * 1.4 && boat.z > car.z * 1.25);
  assert.ok(halfway.x > car.x && halfway.x < boat.x);
  assert.ok(Math.abs(scene.getObjectByName('WheelFold_FL').rotation.z - Math.PI / 2) < .001);
  assert.ok(scene.getObjectByName('Hull_L').children.some(c => c.isMesh));
  rig.update(0); let i = 0;
  scene.traverse(o => { const original = initial[i++]; assert.equal(o.uuid, original.id); assert.ok(o.position.distanceTo(original.p) < 1e-6); assert.ok(o.quaternion.clone().normalize().angleTo(original.q.clone().normalize()) < 1e-6); assert.ok(o.scale.distanceTo(original.s) < 1e-6); });
  const pivot = scene.getObjectByName('Wheel_FL'), fold = pivot.parent;
  assert.equal(fold.name, 'WheelFold_FL');
  assert.ok(fold.position.distanceTo(new Vector3(-1.04, .57, 1.37)) < 1e-5);
});
