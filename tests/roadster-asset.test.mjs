import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/libs/meshopt_decoder.module.js';
import { poseRoadsterWing, thrusterNozzles } from '../vehicle-model.mjs';
const bytes = await readFile(new URL('../assets/vehicles/roadster-rocket.glb', import.meta.url));
const metadata = JSON.parse(await readFile(new URL('../assets/vehicles/roadster-rocket.json', import.meta.url), 'utf8'));
const { scene, animations } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);
const bounds = object => new Box3().setFromObject(object, true);

test('Blender exports a compact, self-contained Roadster with no clips, images or lettering', () => {
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.ok(gltf.asset.generator.includes('Blender'));
  assert.ok(gltf.buffers.every(b => !b.uri)); assert.equal(gltf.images?.length ?? 0, 0);
  assert.equal(animations.length, 0);
  let meshes = 0, triangles = 0;
  scene.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  // A regression guard for this detailed asset, not a hardware performance limit.
  // Actual frame times are compared separately in the same game scene.
  assert.ok(meshes <= 40, `${meshes} draws`); assert.ok(triangles < 80000, `${triangles} triangles`); assert.ok(bytes.length < 4 * 1024 * 1024);
  assert.equal(metadata.triangles, triangles, 'metadata includes evaluated modifiers on fixed parts');
  // Batched by material within the body and each wheel, as the export reports.
  assert.deepEqual(metadata.batching.map(b => b.group), ['Body', 'Spinner_FL', 'Spinner_RL', 'Spinner_FR', 'Spinner_RR', 'Rear_Wing', 'Wing_Carriage', 'Lamp_Shutters']);
  // (The shell keeps its carbon wheel-arch liners as a second primitive.)
  assert.equal(scene.getObjectByName('Body').children.filter(o => !/^(Exhaust_|Wing_Carriage$|Lamp_Shutters$)/.test(o.name)).length, metadata.batching[0].after);
  // An original model: no badges, wordmarks or text anywhere.
  scene.traverse(o => assert.doesNotMatch(o.name, /tesla|spacex|logo|badge|wordmark|text|registration/i));
  assert.ok(!gltf.meshes.some(m => /text|font/i.test(m.name)));
});

test('the replacement body retains the game’s 2.82 m wheelbase, 2 m width and 1.1 m roof', () => {
  const body = bounds(scene.getObjectByName('Body')).getSize(new Vector3());
  assert.ok(Math.abs(body.x - 2.0) < .06, `width ${body.x}`);
  // 4.37 m of bodywork; the rear nozzles stand a little proud of it.
  assert.ok(body.z > 4.35 && body.z < 4.55, `length ${body.z}`);
  // The gold canopy retains the original height; the new air brake sits lower.
  const roof = bounds(scene.getObjectByName('Body__Gold_Glass'));
  assert.ok(Math.abs(roof.max.y - 1.1) < .03, `roof ${roof.max.y}`);
  assert.ok(body.y < 1.35);
  const front = scene.getObjectByName('Wheel_FL').getWorldPosition(new Vector3()), rear = scene.getObjectByName('Wheel_RL').getWorldPosition(new Vector3());
  assert.ok(Math.abs(front.z - rear.z - 2.82) < .01);
  assert.equal(metadata.wheelbase, 2.82); assert.equal(metadata.width, 2.0); assert.equal(metadata.height, 1.1);
});

test('wheel rigs sit on the ground at their tyre radii and turn independently of the body', () => {
  const body = scene.getObjectByName('Body'), before = bounds(body);
  for (const [name, x, radius, z] of [['FL', -.845, .343, 1.41], ['RL', -.83, .367, -1.41], ['FR', .845, .343, 1.41], ['RR', .83, .367, -1.41]]) {
    const pivot = scene.getObjectByName(`Wheel_${name}`), spinner = scene.getObjectByName(`Spinner_${name}`);
    assert.equal(spinner.parent, pivot);
    assert.ok(pivot.getWorldPosition(new Vector3()).distanceTo(new Vector3(x, radius, z)) < 1e-5, `wheel ${name} axle`);
    const tyre = bounds(spinner);
    assert.ok(Math.abs(tyre.min.y) < .01, `wheel ${name} meets the ground: ${tyre.min.y}`);
    assert.ok(Math.abs(tyre.max.y - 2 * radius) < .01);
    spinner.rotation.x = .73; pivot.rotation.y = z > 0 ? .2 : 0;
  }
  scene.updateMatrixWorld(true);
  const after = bounds(body);
  assert.ok(before.min.distanceTo(after.min) < 1e-9 && before.max.distanceTo(after.max) < 1e-9);
  for (const name of ['FL', 'RL', 'FR', 'RR']) { scene.getObjectByName(`Spinner_${name}`).rotation.x = 0; scene.getObjectByName(`Wheel_${name}`).rotation.y = 0; }
  scene.updateMatrixWorld(true);
  const materials = new Map();
  scene.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) materials.set(m.name, m); });
  assert.ok(materials.get('Headlamp').emissive.getHex() > 0);
  assert.ok(materials.get('Brake_Lamp').emissive.getHex() > 0);
  assert.notEqual(materials.get('Headlamp'), materials.get('Brake_Lamp'));
  assert.deepEqual([...materials.keys()].sort(), metadata.materials);
});

test('ten thruster nozzles in the reported Rocket layout, each with an exhaust mouth', () => {
  const nozzles = thrusterNozzles(scene);
  assert.equal(nozzles.rear.length, 4); assert.equal(nozzles.lift.length, 4);
  assert.equal(nozzles.yawL.length, 1); assert.equal(nozzles.yawR.length, 1);
  const body = bounds(scene.getObjectByName('Body')), at = n => n.node.getWorldPosition(new Vector3());
  // Four in the rear diffuser blowing backward, across the tail.
  for (const n of nozzles.rear) { assert.deepEqual(n.thrust.toArray(), [0, 0, -1]); assert.ok(at(n).z < -2.1 && at(n).y < .5); }
  // The reveal car's four bells share the narrow central diffuser.
  const x = nozzles.rear.map(n => at(n).x).sort((a, b) => a - b);
  for (const [i, centre] of [-.399, -.133, .133, .399].entries()) assert.ok(Math.abs(x[i] - centre) < .01);
  // Four at the corners blowing down, under the body, two at each end.
  for (const n of nozzles.lift) { assert.deepEqual(n.thrust.toArray(), [0, -1, 0]); assert.ok(at(n).y < .12 && Math.abs(at(n).z) > 1.8 && Math.abs(at(n).x) > .7); }
  assert.equal(nozzles.lift.filter(n => at(n).z > 0).length, 2);
  // Two on the flanks, ahead of centre, blowing out to either side to yaw.
  assert.deepEqual(nozzles.yawL[0].thrust.toArray(), [-1, 0, 0]); assert.deepEqual(nozzles.yawR[0].thrust.toArray(), [1, 0, 0]);
  for (const n of [...nozzles.yawL, ...nozzles.yawR]) assert.ok(at(n).z > .5 && Math.abs(Math.abs(at(n).x) - 1) < .02);
  // Every mouth sits at the car's skin, with a visible titanium bell behind it.
  for (const n of Object.values(nozzles).flat()) { assert.ok(body.distanceToPoint(at(n)) < .02); assert.ok(n.radius > .04 && n.radius < .09); }
  assert.equal(metadata.thrusters.length, 10);
  for (const t of metadata.thrusters) assert.ok(at({ node: scene.getObjectByName(t.name) }).distanceTo(new Vector3(...t.position)) < 1e-3);
});

test('the parked deck lifts on its posts and then pitches into an air brake', () => {
  const body = scene.getObjectByName('Body'), wing = scene.getObjectByName('Rear_Wing');
  const carriage = scene.getObjectByName('Wing_Carriage');
  assert.equal(wing.parent, carriage);
  assert.equal(carriage.parent, body);
  const posts = carriage.getObjectByName('Wing_Carriage__Carbon');
  const rest = bounds(wing), retractedPosts = bounds(posts);
  assert.ok(rest.max.y < .90, 'the stowed airfoil follows the deck');
  assert.ok(wing.getObjectByName('Rear_Wing__Brake_Lamp') && wing.getObjectByName('Rear_Wing__Ano_White'));
  const shell = scene.getObjectByName('Body__Ano_White'), parked = bounds(shell);
  poseRoadsterWing(wing, .25);
  scene.updateMatrixWorld(true);
  assert.equal(wing.rotation.x, 0, 'the blade lifts before it pitches');
  assert.ok(bounds(wing).min.y > rest.min.y + .10);
  poseRoadsterWing(wing, 1);
  scene.updateMatrixWorld(true);
  assert.ok(Math.abs(wing.rotation.x - .95) < .001);
  assert.ok(bounds(posts).min.y > retractedPosts.min.y + .19);
  assert.ok(bounds(wing).min.y > .88);
  assert.ok(bounds(shell).equals(parked));
  poseRoadsterWing(wing, 0);
  scene.updateMatrixWorld(true);
  assert.ok(bounds(wing).equals(rest) && bounds(posts).equals(retractedPosts));
});

test('the headlamp covers drop into the nose, leaving the optical cells in place', () => {
  const shutters = scene.getObjectByName('Lamp_Shutters');
  const lamps = scene.getObjectByName('Body__Headlamp');
  const top = bounds(shutters), fixed = bounds(lamps);
  assert.ok(top.min.z > 1.80 && top.max.z < 2.25);
  shutters.rotation.x = shutters.userData.openAngle;
  scene.updateMatrixWorld(true);
  assert.ok(bounds(shutters).max.y < top.max.y - .025);
  assert.ok(bounds(lamps).equals(fixed));
  shutters.rotation.x = 0;
  scene.updateMatrixWorld(true);
  assert.ok(bounds(shutters).equals(top));
});
