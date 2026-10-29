import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { createTransformation } from '../vehicle-model.mjs';
const bytes = await readFile(new URL('../assets/vehicles/atlas-amphibious.glb', import.meta.url));
const { scene, animations } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const rig = createTransformation(scene, animations), plane = createTransformation(scene, animations, 'Transform_To_Plane');
const size = () => new Box3().setFromObject(scene, true).getSize(new Vector3());

test('Blender exports embedded, bounded car-to-boat and car-to-plane animations', () => {
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.ok(gltf.asset.generator.includes('Blender'));
  assert.ok(gltf.buffers.every(b => !b.uri)); assert.equal(gltf.images?.length ?? 0, 0);
  assert.deepEqual(animations.map(a => a.name).sort(), ['Transform_To_Boat', 'Transform_To_Plane']);
  assert.ok(rig.duration > 2.3 && rig.duration < 2.5); assert.ok(plane.duration > 1.5 && plane.duration < 1.7);
  // The clips never animate the same node, so both forms can blend.
  const nodes = animations.map(a => new Set(a.tracks.map(t => t.name.split('.')[0])));
  assert.equal([...nodes[0]].filter(n => nodes[1].has(n)).length, 0);
  let meshes = 0, triangles = 0;
  scene.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes <= 110); assert.ok(triangles < 75000); assert.ok(bytes.length < 4 * 1024 * 1024);
  // Stowed boat and plane parts are hidden, so car mode keeps its draw budget.
  rig.update(0); plane.update(0);
  let visible = 0; scene.traverseVisible(o => { if (o.isMesh) visible++; });
  assert.ok(visible <= 72, `${visible} car-mode draws`);
  rig.update(1); assert.ok(rig.stowable.every(o => o.visible)); rig.update(0);
});

test('the original body and wheels move continuously and return exactly, with no model swap', () => {
  rig.update(0); const car = size(), initial = [];
  scene.traverse(o => initial.push({ id: o.uuid, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
  assert.ok(car.x < 2.8 && car.z < 4.9);
  for (const part of ['Hull_L', 'Hull_R', 'Bow_Extension', 'Cabin_Slide', 'WheelFold_FL', 'Jet_L', 'Keel_Deploy']) assert.ok(scene.getObjectByName(part));
  rig.update(.5); const halfway = size();
  rig.update(1); const boat = size();
  assert.ok(boat.x > car.x * 1.4 && boat.z > car.z * 1.25);
  // Wheels pass outboard mid-way, then sink into the hull wells.
  assert.ok(halfway.x > car.x);
  for (const name of ['FL', 'RL', 'FR', 'RR']) {
    const fold = scene.getObjectByName('WheelFold_' + name), hull = scene.getObjectByName('Pontoon_' + name[1]).getWorldPosition(new Vector3());
    assert.ok(Math.abs(fold.position.x - hull.x) < .05 && fold.position.y < .55, `wheel ${name} stowed in its hull`);
  }
  assert.ok(Math.abs(scene.getObjectByName('WheelFold_FL').rotation.z - Math.PI / 2) < .001);
  assert.ok(scene.getObjectByName('Hull_L').children.some(c => c.isMesh));
  rig.update(0); let i = 0;
  scene.traverse(o => { const original = initial[i++]; assert.equal(o.uuid, original.id); assert.ok(o.position.distanceTo(original.p) < 1e-6); assert.ok(o.quaternion.clone().normalize().angleTo(original.q.clone().normalize()) < 1e-6); assert.ok(o.scale.distanceTo(original.s) < 1e-6); });
  const pivot = scene.getObjectByName('Wheel_FL'), fold = pivot.parent;
  assert.equal(fold.name, 'WheelFold_FL');
  assert.ok(fold.position.distanceTo(new Vector3(-1.04, .57, 1.37)) < 1e-5);
});

test('wheel rigs retain simulation origins and turn independently of the suspended body', () => {
  rig.update(0);
  scene.updateMatrixWorld(true);
  const body = scene.getObjectByName('Body'), before = new Box3().setFromObject(body);
  for (const [name, x, z] of [['FL', -1.04, 1.37], ['RL', -1.04, -1.37], ['FR', 1.04, 1.37], ['RR', 1.04, -1.37]]) {
    const pivot = scene.getObjectByName(`Wheel_${name}`), spinner = scene.getObjectByName(`Spinner_${name}`);
    assert.equal(spinner.parent, pivot);
    assert.ok(pivot.getWorldPosition(new Vector3()).distanceTo(new Vector3(x, .57, z)) < 1e-5, `wheel ${name} axle`);
    const bounds = new Box3().setFromObject(spinner), center = bounds.getCenter(new Vector3());
    assert.ok(Math.abs(bounds.min.y) < .025, `wheel ${name} meets ground: ${bounds.min.y}`);
    assert.ok(Math.abs(center.y - .57) < .015); assert.ok(Math.abs(center.z - z) < .015);
    spinner.rotation.x = .73; pivot.rotation.y = z > 0 ? .2 : 0;
  }
  scene.updateMatrixWorld(true);
  const after = new Box3().setFromObject(body);
  assert.ok(before.min.distanceTo(after.min) < 1e-9 && before.max.distanceTo(after.max) < 1e-9);
  const materials = new Map();
  scene.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) materials.set(m.name, m); });
  assert.ok(materials.get('Headlamp').emissive.getHex() > 0);
  assert.ok(materials.get('Brake_Lamp').emissive.getHex() > 0);
  assert.notEqual(materials.get('Headlamp'), materials.get('Brake_Lamp'));
  for (const name of ['FL', 'RL', 'FR', 'RR']) { scene.getObjectByName(`Spinner_${name}`).rotation.x = 0; scene.getObjectByName(`Wheel_${name}`).rotation.y = 0; }
});

test('the wings, tail and propeller deploy from inside the body and return exactly', () => {
  rig.update(0); plane.update(0); scene.updateMatrixWorld(true);
  const car = size(), initial = [];
  scene.traverse(o => initial.push({ id: o.uuid, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
  for (const part of ['WingSeg3_L', 'WingSeg3_R', 'WingTip_L', 'WingTip_R', 'TailFin_L', 'TailFin_R', 'Tail_Stabilizer_L', 'Tail_Stabilizer_R', 'Propeller', 'BladeFold_1']) assert.ok(scene.getObjectByName(part));
  const wheel = scene.getObjectByName('WheelFold_FL').position.clone();
  plane.update(1); scene.updateMatrixWorld(true);
  const flying = size();
  assert.ok(flying.x > 7 && flying.x > car.x * 2.5, `wingspan ${flying.x}`);
  assert.ok(flying.z > car.z + 2, 'tail booms and propeller extend the length');
  // The wheels stay down as landing gear; the propeller hub sits ahead of the bumper.
  assert.ok(scene.getObjectByName('WheelFold_FL').position.distanceTo(wheel) < 1e-6);
  assert.ok(scene.getObjectByName('Propeller').getWorldPosition(new Vector3()).z > 2.5);
  // The outer panel lies flat (its winglet, a child, stands up).
  const own = name => { const box = new Box3(); for (const o of scene.getObjectByName(name).children) if (o.isMesh) box.expandByObject(o); return box; };
  const tip = own('WingSeg3_L');
  assert.ok(Math.abs(tip.max.y - tip.min.y) < .3, 'wing tip panel lies flat');
  // An H tail: each fin stands on its boom, and the tailplane's halves reach
  // from the booms to meet in the middle, overhanging neither.
  for (const side of ['L', 'R']) {
    const boom = own('TailBoom2_' + side), fin = new Box3().setFromObject(scene.getObjectByName('TailFin_' + side));
    const half = new Box3().setFromObject(scene.getObjectByName('Tail_Stabilizer_' + side)), axis = boom.getCenter(new Vector3()).x;
    assert.ok(fin.min.y > boom.min.y && fin.min.y < boom.max.y, `fin ${side} stands on its boom`);
    assert.ok(Math.abs(Math.max(Math.abs(half.min.x), Math.abs(half.max.x)) - Math.abs(axis)) < .03, `tailplane ${side} ends at its boom`);
    assert.ok(Math.min(Math.abs(half.min.x), Math.abs(half.max.x)) < .02, `tailplane ${side} meets the other half`);
  }
  // The game spins the propeller; the clip must not overwrite its rotation.
  assert.ok(!animations.some(a => a.tracks.some(t => t.name.startsWith('Propeller.'))));
  plane.update(0); let i = 0;
  scene.traverse(o => { const original = initial[i++]; assert.equal(o.uuid, original.id); assert.ok(o.position.distanceTo(original.p) < 1e-6); assert.ok(o.quaternion.clone().normalize().angleTo(original.q.clone().normalize()) < 1e-6); assert.ok(o.scale.distanceTo(original.s) < 1e-6); });
  scene.updateMatrixWorld(true);
  const stowed = size();
  assert.ok(Math.abs(stowed.x - car.x) < 1e-6 && Math.abs(stowed.z - car.z) < 1e-6);
});
