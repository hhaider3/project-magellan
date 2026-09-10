import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

const bytes = await readFile(new URL('../assets/vehicles/atlas-expedition.glb', import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const { scene } = await new GLTFLoader().parseAsync(buffer, '');

test('Blender export is self-contained, correctly scaled and inside the game geometry budget', () => {
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  assert.equal(gltf.asset.version, '2.0');
  assert.ok(gltf.asset.generator.includes('Blender'));
  assert.ok(gltf.buffers.every(b => !b.uri));
  assert.equal(gltf.images?.length ?? 0, 0);
  const size = new Box3().setFromObject(scene, true).getSize(new Vector3());
  assert.ok(size.x > 2.3 && size.x < 2.7, `width ${size.x}`);
  assert.ok(size.y > 2.6 && size.y < 2.95, `height ${size.y}`);
  assert.ok(size.z > 4.3 && size.z < 4.8, `length ${size.z}`);
  let meshes = 0, triangles = 0;
  scene.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes <= 30, `${meshes} draws`);
  assert.ok(triangles < 90000, `${triangles} triangles`);
  assert.ok(bytes.length < 3 * 1024 * 1024);
});

test('wheel rigs retain simulation origins and turn independently of the suspended body', () => {
  const body = scene.getObjectByName('Body');
  assert.ok(body);
  const before = new Box3().setFromObject(body);
  for (const [name, x, z] of [['FL', -1.04, 1.37], ['RL', -1.04, -1.37], ['FR', 1.04, 1.37], ['RR', 1.04, -1.37]]) {
    const pivot = scene.getObjectByName(`Wheel_${name}`), spinner = scene.getObjectByName(`Spinner_${name}`);
    assert.equal(spinner.parent, pivot);
    assert.ok(pivot.position.distanceTo(new Vector3(x, .57, z)) < 1e-6);
    assert.ok(spinner.position.length() < 1e-6);
    const bounds = new Box3().setFromObject(spinner);
    assert.ok(Math.abs(bounds.min.y) < .025, `wheel ${name} meets ground: ${bounds.min.y}`);
    const center = bounds.getCenter(new Vector3());
    assert.ok(Math.abs(center.y - .57) < .015);
    assert.ok(Math.abs(center.z - z) < .015);
    spinner.rotation.x = .73; pivot.rotation.y = z > 0 ? .2 : 0;
  }
  const after = new Box3().setFromObject(body);
  assert.ok(before.min.distanceTo(after.min) < 1e-9);
  assert.ok(before.max.distanceTo(after.max) < 1e-9);
  const materials = new Map();
  body.traverse(o => { if (o.isMesh) materials.set(o.material.name, o.material); });
  assert.ok(materials.get('Headlamp').emissive.getHex() > 0);
  assert.ok(materials.get('Brake_Lamp').emissive.getHex() > 0);
  assert.notEqual(materials.get('Headlamp'), materials.get('Brake_Lamp'));
  const windows = body.getObjectByName('Body__Smoked_Glass');
  assert.ok(windows.geometry.index.count >= 36, 'all six window panes survive export reduction');
  assert.ok(new Box3().setFromObject(windows, true).min.z < -1.89, 'rear window survives export');
});
