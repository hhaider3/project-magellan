import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { createWorld, createVehicle, stepVehicle, recoverVehicle, FIXED_DT, groundAt } from '../world.mjs';
import { toggleFlight } from '../flight-motion.mjs';
import { vehicleForTheme, vehicleOrder } from '../vehicle-specs.mjs';
import { createCycleTrail, TRAIL_CAPACITY, TRAIL_LIFE, TRAIL_SPACING } from '../cycle-trail.mjs';
import { CYCLE_LEAN } from '../cycle-motion.mjs';

const flat = { surface: () => 0, gradient: () => ({ x: 0, z: 0 }), roadAt: () => ({ d: 0 }) };

test('the light cycle is in both modes, and comes first in Synth; invalid saved choices and URLs fall back', () => {
  assert.deepEqual(vehicleOrder(false), ['atlas', 'roadster', 'lightcycle']);
  assert.deepEqual(vehicleOrder(true), ['lightcycle', 'atlas', 'roadster']);
  assert.equal(vehicleForTheme('lightcycle', false), 'lightcycle');
  assert.equal(vehicleForTheme(undefined, false), 'atlas');
  assert.equal(vehicleForTheme(undefined, true), 'lightcycle');
  assert.equal(vehicleForTheme('roadster', false), 'roadster');
  assert.equal(vehicleForTheme('atlas', true), 'atlas');
  assert.equal(vehicleForTheme('obsolete', false), 'atlas');
});

test('the light cycle drives, turns and jumps without transforming', () => {
  const bike = createVehicle(flat, 0, 0, 0, 'lightcycle');
  assert.equal(toggleFlight(bike), false);
  for (let i = 0; i < 2 / FIXED_DT; i++) stepVehicle(bike, { up: true, left: true }, flat, []);
  assert.ok(bike.distance > 20 && bike.speed > 20 && bike.heading > .5);
  assert.equal(bike.transform, 0);
  assert.equal(bike.flight, 0);
  assert.equal(bike.floating, false);
  assert.equal(bike.wheelRadius, .604);
  stepVehicle(bike, { jump: true }, flat, []);
  assert.equal(bike.grounded, false);
  assert.ok(bike.vy > 0);
  for (let i = 0; i < 180; i++) stepVehicle(bike, {}, flat, [], FIXED_DT);
  assert.equal(bike.grounded, true);
});

test('light cycle support follows its shorter wheelbase and narrow track', () => {
  const hill = { surface: (x, z) => z * z * .1 + x * .2 };
  const bike = groundAt(hill, 0, 0, 0, undefined, 'lightcycle');
  assert.ok(bike.y < groundAt(hill, 0, 0, 0).y);
  assert.ok(Math.abs(bike.roll - Math.atan(.2)) < 1e-12);
});

const lake = { ...flat, surface: () => -4.5, waterAt: () => ({ depth: 5, level: .5 }), gradient: () => ({ x: 0, z: 0 }) };
// Water from z = 100 to 400, flush with the flat land either side.
const shore = { ...flat, surface: (x, z) => z > 100 && z < 400 ? -4.5 : 0, waterAt: (x, z) => z > 100 && z < 400 ? { depth: 5, level: -.08 } : null };

test('water fires the boost even when empty and holds it to the far shore, at full speed on the surface', () => {
  const bike = createVehicle(shore, 0, 0, 0, 'lightcycle');
  bike.neonCharge = 0;
  let peak = 0, lowest = Infinity, wet = 0, skips = 0;
  for (let i = 0; i < 12 / FIXED_DT && bike.z < 395; i++) {
    stepVehicle(bike, { up: bike.z < 50 }, shore, []);
    if (bike.z < 95) assert.equal(bike.neonBoost, false, 'not before the water');
    if (bike.z > 102) { assert.equal(bike.neonBoost, true); assert.equal(bike.overWater, true); peak = Math.max(peak, Math.hypot(bike.vx, bike.vz) * 3.6); lowest = Math.min(lowest, bike.y); wet++; skips = bike.skips; assert.ok(bike.skip >= 0 && bike.skip <= .56); }
  }
  assert.ok(wet > 0 && bike.z >= 395, 'it crossed, with no throttle held');
  assert.ok(peak > 200, `${peak} km/h`);
  assert.ok(lowest >= -.08, 'on the water, never in it');
  assert.ok(skips >= 5, `${skips} skips`);
  assert.equal(bike.kind, 'lightcycle');
  assert.equal(bike.floating, false);
  // Back on land the forced boost lets go and the meter starts to refill.
  for (let i = 0; i < 80; i++) stepVehicle(bike, {}, shore, []);
  assert.ok(bike.z > 400);
  assert.equal(bike.neonBoost, false);
  assert.ok(bike.neonCharge > 0);
  assert.ok(bike.skip < .05);
});

test('the far shore keeps a boost you fired yourself, and water burns the charge', () => {
  const bike = createVehicle(lake, 0, 0, 0, 'lightcycle');
  for (let i = 0; i < 1 / FIXED_DT; i++) stepVehicle(bike, {}, lake, []);
  assert.equal(bike.neonBoost, true);
  assert.ok(Math.abs(bike.neonCharge - .75) < .01);
  const land = createVehicle(shore, 0, 95, 0, 'lightcycle');
  land.neonRequested = true;
  for (let i = 0; i < 420 / FIXED_DT && land.z < 90 + 330; i++) stepVehicle(land, {}, shore, []);
  assert.ok(land.z > 400);
  assert.equal(land.neonBoost, land.neonCharge > 0, 'it runs on until the charge is gone');
});

test('jumping high over water does not fire the boost until it comes down', () => {
  const bike = createVehicle(lake, 0, 0, 0, 'lightcycle');
  bike.grounded = false; bike.y = 30; bike.vy = 0;
  stepVehicle(bike, {}, lake, []);
  assert.equal(bike.overWater, true);
  assert.equal(bike.neonBoost, false);
  for (let i = 0; i < 3 / FIXED_DT && !bike.neonBoost; i++) stepVehicle(bike, {}, lake, []);
  assert.equal(bike.neonBoost, true);
  assert.ok(bike.y < 2.6);
});

test('a frozen lake is ice to the bike, not water to skip', () => {
  const world = createWorld(77), lake = world.starterLake; // the Frostlands: Mirror Lake is frozen
  assert.ok(world.frozen(lake));
  const bike = createVehicle(world, lake.x, lake.z, 0, 'lightcycle');
  for (let i = 0; i < 30; i++) stepVehicle(bike, { up: true }, world, []);
  assert.equal(bike.overWater, false);
  assert.equal(bike.neonBoost, false);
  assert.equal(bike.onIce, true);
});

test('a bridge over water is land to the bike', () => {
  const bridge = { ...flat, surface: (x, z, y) => y !== undefined && y > 3 ? 5 : -4.5, waterAt: () => ({ depth: 5, level: .5 }), gradient: () => ({ x: 0, z: 0 }) };
  const bike = createVehicle(bridge, 0, 0, 0, 'lightcycle');
  bike.y = bike.groundY = 5;
  stepVehicle(bike, {}, bridge, []);
  assert.equal(bike.overWater, false);
  assert.equal(bike.neonBoost, false);
});

test('a recovery does not refill the neon boost', () => {
  const world = createWorld(3);
  world.setSynthwave(true);
  const water = world.starterLake, bike = createVehicle(world, water.x, water.z, 0, 'lightcycle');
  bike.neonCharge = .4; bike.distance = 125;
  assert.equal(recoverVehicle(bike, world), true);
  assert.ok(!world.waterAt(bike.x, bike.z));
  assert.equal(bike.neonCharge, .4);
  assert.equal(bike.distance, 125);
});

test('the bundled bike includes its rider, separate wheel spinners and working lamp materials', async () => {
  const bytes = await readFile(new URL('../assets/vehicles/light-cycle-rider.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const rider = scene.getObjectByName('Rider');
  assert.equal(rider.parent.name, 'Body');
  assert.equal(rider.getObjectByName('Identity_Disc').parent, rider);
  assert.ok(scene.getObjectByName('Trail_Emitter'));
  for (const end of ['Front', 'Rear']) {
    assert.equal(scene.getObjectByName('Spinner_' + end).parent, scene.getObjectByName('Wheel_' + end));
  }
  const materials = new Set();
  scene.traverse(o => {
    assert.ok(!o.isCamera && !o.isLight);
    if (o.isMesh) materials.add(o.material.name);
  });
  assert.ok(materials.has('Ice white headlamp') && materials.has('Brake lamp') && materials.has('Rider blue circuitry'));
});

test('neon boost reaches 500 km/h, expires, and needs a fresh press to activate again', () => {
  const bike = createVehicle(flat, 0, 0, 0, 'lightcycle');
  let peak = 0;
  for (let i = 0; i < 4 / FIXED_DT; i++) {
    stepVehicle(bike, { up: true, boost: true }, flat, []);
    peak = Math.max(peak, Math.hypot(bike.vx, bike.vz) * 3.6);
    assert.ok(Math.hypot(bike.vx, bike.vz) * 3.6 <= 500.00001);
  }
  assert.ok(peak > 499);
  assert.equal(bike.neonBoost, false);
  assert.ok(bike.neonCharge < .01);
  for (let i = 0; i < 9 / FIXED_DT; i++) stepVehicle(bike, { boost: true }, flat, []);
  assert.equal(bike.neonBoost, false);
  assert.equal(bike.neonCharge, 1);
  stepVehicle(bike, {}, flat, []);
  stepVehicle(bike, { boost: true }, flat, []);
  assert.equal(bike.neonBoost, true);
});

test('front-wheel lift rises smoothly and down returns the bike to two wheels', () => {
  const bike = createVehicle(flat, 0, 0, 0, 'lightcycle');
  for (let i=0;i<120;i++) stepVehicle(bike,{wheelieUp:true},flat,[]);
  assert.ok(bike.wheelie > .6 && bike.wheelie < .69);
  assert.equal(bike.speed, 0);
  for (let i=0;i<120;i++) stepVehicle(bike,{wheelieDown:true},flat,[]);
  assert.ok(bike.wheelie < .001);
});

test('A and D lean as they turn, Q and E lean without turning, and leaning into a turn tightens it', () => {
  const ride = input => {
    const bike = createVehicle(flat, 0, 0, 0, 'lightcycle');
    for (let i = 0; i < 3 / FIXED_DT; i++) stepVehicle(bike, { up: bike.speed < 28 }, flat, []);
    bike.heading = 0;
    for (let i = 0; i < 1 / FIXED_DT; i++) stepVehicle(bike, { up: bike.speed < 28, ...input }, flat, []);
    return bike;
  };
  const left = ride({ leanLeft: true }), right = ride({ leanRight: true });
  assert.ok(Math.abs(left.lean - CYCLE_LEAN) < .01 && Math.abs(right.lean + CYCLE_LEAN) < .01);
  assert.equal(left.heading, 0);
  assert.equal(right.heading, 0);
  const plain = ride({ left: true }), into = ride({ left: true, leanLeft: true }), against = ride({ left: true, leanRight: true });
  assert.equal(plain.lean, 0);
  assert.ok(plain.turnLean > .4, 'A and D lean it too');
  assert.equal(left.turnLean, 0, 'Q and E alone add no steering');
  assert.ok(into.heading > plain.heading * 1.2 && against.heading < plain.heading * .8);
});

test('the bike straightens up in the air', () => {
  const bike = createVehicle(flat, 0, 0, 0, 'lightcycle');
  for (let i = 0; i < 120; i++) stepVehicle(bike, { up: true, leanLeft: true, left: true }, flat, []);
  assert.ok(bike.lean > .1 && bike.turnLean > .1);
  stepVehicle(bike, { jump: true, up: true, leanLeft: true, left: true }, flat, []);
  for (let i = 0; i < 40; i++) stepVehicle(bike, { up: true, leanLeft: true, left: true }, flat, []);
  assert.equal(bike.grounded, false);
  assert.ok(bike.lean < .05 && bike.turnLean < .05);
});

// Rides a trail along +z at a steady speed; returns where the bike got to.
function rideTrail(trail, seconds, speed, { z = 0, boost = false, dt = 1 / 60, ground = () => 0, baseY = .03 } = {}) {
  for (let i = 0; i < seconds / dt; i++) {
    z += speed * dt;
    trail.update(dt, { top: new THREE.Vector3(0, 1.23, z), base: new THREE.Vector3(0, baseY, z), heading: 0, speed, boost, pixels: 720, groundAt: ground });
  }
  return z;
}

test('the wall of light reaches back its whole life, even at full boost and past the buffer\'s end', () => {
  const trail = createCycleTrail(new THREE.Scene());
  const speed = 500 / 3.6, z = rideTrail(trail, 40, speed, { dt: 1 / 240 });
  const samples = trail.samples();
  assert.ok(samples.length <= TRAIL_CAPACITY);
  assert.ok(Math.abs(z - samples.at(-1).z) < 1e-2, 'the head is on the emitter');
  assert.ok(Math.abs(z - samples[0].z - speed * TRAIL_LIFE) < speed * .1, `${z - samples[0].z} m long`);
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].z >= samples[i - 1].z, 'in order');
    assert.ok(samples[i].along >= samples[i - 1].along, 'its distance only grows');
    assert.ok(samples[i].z - samples[i - 1].z < TRAIL_SPACING * 2, 'evenly sampled');
  }
});

test('the wall of light keeps its boost look where it was written', () => {
  const trail = createCycleTrail(new THREE.Scene());
  let z = rideTrail(trail, 1, 80);
  z = rideTrail(trail, 1, 130, { z, boost: true });
  rideTrail(trail, 1, 80, { z });
  const boosted = trail.samples().filter(s => s.boost > .9), plain = trail.samples().filter(s => s.boost < .01);
  assert.ok(boosted.length > 40 && plain.length > 40);
  assert.ok(boosted[0].z > plain[0].z && boosted.at(-1).z < plain.at(-1).z);
});

test('a recovery breaks the wall of light: nothing lit joins the old place to the new', () => {
  const trail = createCycleTrail(new THREE.Scene());
  let z = rideTrail(trail, 1, 40);
  z = rideTrail(trail, 1, 40, { z: z + 25 });
  const samples = trail.samples();
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].z - samples[i - 1].z > 2) assert.equal(Math.max(samples[i].strength, samples[i - 1].strength), 0);
  }
  assert.ok(samples.at(-1).strength > .9);
});

test('standing still lets the wall of light run out, and riding on starts it again from the ground', () => {
  const trail = createCycleTrail(new THREE.Scene());
  const z = rideTrail(trail, 2, 40);
  rideTrail(trail, TRAIL_LIFE + 1, 0, { z });
  assert.ok(trail.count <= 3);
  assert.ok(trail.samples().every(s => s.strength === 0));
  rideTrail(trail, 1, 2, { z });
  assert.equal(trail.samples().at(-1).strength, 0);
  rideTrail(trail, 1, 8, { z });
  assert.ok(trail.samples().at(-1).strength > 0 && trail.samples().at(-1).strength < 1, 'it rises with speed');
  trail.clear();
  assert.equal(trail.count, 0);
  assert.equal(trail.mesh.visible, false);
});

test('a wheelie swinging the base into the ground leaves the wall standing on it', () => {
  const trail = createCycleTrail(new THREE.Scene());
  rideTrail(trail, .5, 40, { ground: () => 3, baseY: 2.5 });
  assert.ok(Math.abs(trail.samples().at(-1).baseY - 3.03) < 1e-5);
});
