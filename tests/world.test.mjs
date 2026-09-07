import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, recoverVehicle, resolveObstacles, groundAt, featurePoint, featureLocal, FIXED_DT, CHUNK, GRID, SPEED_LIMIT } from '../world.mjs';
const flat = { surface: () => 0, gradient: () => ({ x: 0, z: 0 }), roadAt: (x, z) => ({ d: 0, x, z }), props: () => [] };
function advance(car, input, world, seconds, obstacles = []) { for (let t = 0; t < Math.round(seconds / FIXED_DT); t++) stepVehicle(car, input, world, obstacles); }

test('same seed reproduces terrain, roads and props, independent of visit order', () => {
  const a = createWorld(483921), b = createWorld(483921);
  const coords = [[0, 0], [-500, 690], [1581, -731], [100000, -80000]];
  for (const [x, z] of coords.reverse()) { assert.equal(a.surface(x, z), b.surface(x, z)); assert.deepEqual(a.roadAt(x, z), b.roadAt(x, z)); }
  assert.deepEqual(a.props(-7, 18), b.props(-7, 18));
  assert.notEqual(a.height(850, 300), createWorld(123456).height(850, 300));
});
test('terrain agrees with the rendered triangle grid and has no chunk discontinuities', () => {
  const world = createWorld(483921);
  for (let x = -400; x < 400; x += GRID) for (let z = -400; z < 400; z += 20) {
    assert.equal(world.surface(x, z), world.height(x, z));
    const a = world.height(x, z), b = world.height(x + GRID, z), c = world.height(x, z + GRID);
    assert.ok(Math.abs(world.surface(x + 1, z + 1) - (a + (b - a) / 4 + (c - a) / 4)) < 1e-10);
  }
  for (let c = -25; c <= 25; c++) for (let i = 0; i < 20; i++) {
    const x = c * CHUNK, z = i * 67 - 300;
    assert.ok(Math.abs(world.surface(x - .0001, z) - world.surface(x + .0001, z)) < .001);
  }
});
test('landforms remain traversable across seeds and have no artificial spawn walls', () => {
  let maxSlope = 0;
  for (const seed of [1, 77, 12345, 483921, 999999, 82930]) {
    const world = createWorld(seed);
    for (let x = -2400; x < 2400; x += 73) for (let z = -2400; z < 2400; z += 79) {
      const g = world.gradient(x, z); maxSlope = Math.max(maxSlope, Math.hypot(g.x, g.z));
    }
    const h = world.height(0, 0);
    assert.ok(Math.abs(world.height(1, 0) - h) < 1.1);
  }
  assert.ok(maxSlope > 1 && maxSlope < 2, `challenging but climbable maximum sampled slope ${maxSlope}`);
});
test('richer scenery leaves roads and ramp approaches clear and stays deterministic', () => {
  const world = createWorld(483921); let count = 0;
  for (let cx = -12; cx < 12; cx++) for (let cz = -12; cz < 12; cz++) {
    const props = world.props(cx, cz); count += props.length;
    for (const p of props) {
      assert.ok(world.roadAt(p.x, p.z).d >= 12); assert.ok(Math.hypot(p.x, p.z) >= 24); assert.notEqual(p.type, 'mountain');
      if (!['camp', 'lookout'].includes(p.type)) assert.ok(!world.reserved(p.x, p.z));
    }
  }
  assert.ok(count / 576 > 10 && count / 576 < 25, `average ${count / 576} props per chunk`);
});
test('Space jumps at rest, rises over two meters, and lands without bouncing or repeat jumping', () => {
  const car = createVehicle(flat); let maxY = car.y;
  for (let i = 0; i < 300; i++) { stepVehicle(car, { jump: true }, flat, []); maxY = Math.max(maxY, car.y); }
  assert.equal(car.jumps, 1); assert.ok(maxY > 2.2 && maxY < 2.5); assert.ok(car.grounded); assert.equal(car.y, .06);
  advance(car, {}, flat, .2); advance(car, { jump: true }, flat, .05); assert.equal(car.jumps, 2); assert.ok(!car.grounded);
});
test('jump buffering accepts a press just before touchdown', () => {
  const car = createVehicle(flat); stepVehicle(car, { jump: true }, flat, []);
  advance(car, {}, flat, .79); assert.ok(!car.grounded);
  advance(car, { jump: true }, flat, .4);
  assert.equal(car.jumps, 2); assert.ok(!car.grounded);
});
test('accelerate, brake, reverse, and steer respond with correct direction', () => {
  const car = createVehicle(flat); advance(car, { up: true }, flat, 4); assert.ok(car.speed > 30 && car.z > 75);
  advance(car, { down: true }, flat, 4); assert.ok(car.speed < -5);
  const left = createVehicle(flat), right = createVehicle(flat);
  advance(left, { up: true, left: true }, flat, 2); advance(right, { up: true, right: true }, flat, 2);
  assert.ok(left.x > 0 && right.x < 0); assert.ok(Math.abs(left.x + right.x) < 1e-8);
});
test('a jump preserves forward motion and drift allows more lateral slip', () => {
  const car = createVehicle(flat); advance(car, { up: true }, flat, 2); const before = car.z;
  advance(car, { up: true, jump: true }, flat, .4); assert.ok(car.z > before + 8 && car.y > 2);
  const grip = createVehicle(flat), drift = createVehicle(flat);
  grip.vz = drift.vz = 30;
  advance(grip, { left: true }, flat, .5); advance(drift, { left: true, brake: true }, flat, .5);
  const slip = c => Math.abs(c.vx * Math.cos(c.heading) - c.vz * Math.sin(c.heading));
  assert.ok(slip(drift) > slip(grip) * 1.5);
});
test('collisions resolve exact overlaps, slide along trunks, and respect jump height', () => {
  const o = { x: 0, z: 0, y: 0, h: 1.2, r: .3 };
  const car = createVehicle(flat); resolveObstacles(car, [o]); assert.ok(Math.hypot(car.x, car.z) >= 1.23);
  car.x = .8; car.z = -.4; car.vx = -10; car.vz = 12; resolveObstacles(car, [o]);
  assert.ok(car.vz > 1); assert.ok(Math.hypot(car.x, car.z) >= 1.23);
  car.x = car.z = 0; car.y = 2; resolveObstacles(car, [o]); assert.equal(car.x, 0); assert.equal(car.z, 0);
});
test('recover finds clear ground, stops the car and retains trip records', () => {
  const world = createWorld(483921), car = createVehicle(world, 340, -210);
  car.distance = 800; car.bestAir = 1.2; car.jumps = 4; car.vx = 40; car.y = -100;
  assert.ok(recoverVehicle(car, world)); assert.ok(car.grounded); assert.equal(car.vx, 0); assert.equal(car.distance, 800); assert.equal(car.bestAir, 1.2); assert.equal(car.jumps, 4);
  assert.equal(car.y, groundAt(world, car.x, car.z, car.heading).y);
});
test('top speed reaches 240 km/h and remains bounded downhill', () => {
  const car = createVehicle(flat); advance(car, { up: true }, flat, 20);
  assert.ok(car.speed * 3.6 > 240 && car.speed * 3.6 < 245);
  car.vz = 100; stepVehicle(car, {}, flat, []); assert.ok(Math.hypot(car.vx, car.vz) <= SPEED_LIMIT);
});
test('ramps launch without Jump and land safely across three seeds', () => {
  for (const seed of [1, 483921, 792835]) {
    const world = createWorld(seed), ramp = world.starterRamp, start = featurePoint(ramp, 0, -35), car = createVehicle(world, start.x, start.z, ramp.heading);
    let sawAir = false, landed = false, maxClearance = 0;
    let obstacles = [], lastChunk = '';
    for (let i = 0; i < 900; i++) {
      const cx = Math.floor(car.x / CHUNK), cz = Math.floor(car.z / CHUNK), chunk = `${cx},${cz}`;
      if (chunk !== lastChunk) { obstacles = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) obstacles.push(...world.props(cx + dx, cz + dz)); lastChunk = chunk; }
      stepVehicle(car, { up: true }, world, obstacles);
      const local = featureLocal(ramp, car.x, car.z);
      if (local.along >= ramp.length && !car.grounded) { sawAir = true; maxClearance = Math.max(maxClearance, car.y - car.groundY); }
      if (sawAir && car.grounded) { landed = true; break; }
    }
    assert.equal(car.jumps, 0, 'no button jump or fake jump count');
    assert.ok(sawAir && landed, `launch and landing in seed ${seed}`);
    assert.ok(car.bestJump > 60 && maxClearance > 5, `seed ${seed}: ${car.bestJump} m / ${maxClearance} m clearance`);
    const best = car.bestJump; recoverVehicle(car, world); assert.equal(car.bestJump, best);
  }
});
test('ramps and landmarks regenerate across feature-cache eviction and negative cell seams', () => {
  const world = createWorld(592831), before = world.featuresNear(-210, 350);
  for (let i = 0; i < 300; i++) world.featuresNear(i * 500, -i * 300);
  assert.deepEqual(world.featuresNear(-210, 350), before);
  for (let i = -15; i <= 15; i++) for (const z of [-197, -10, 131]) {
    const x = i * 288;
    assert.ok(Math.abs(world.height(x - .0001, z) - world.height(x + .0001, z)) < .001);
  }
});
test('fixed steps produce the same result at 30, 60 and 144 rendering frames per second', () => {
  const results = [30, 60, 144].map(fps => {
    const car = createVehicle(flat); let acc = 0;
    for (let frame = 0; frame < fps * 5; frame++) { acc += 1 / fps; while (acc + 1e-10 >= FIXED_DT) { stepVehicle(car, { up: true, left: true }, flat, []); acc -= FIXED_DT; } }
    return car;
  });
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
});
test('long drives in all directions across multiple seeds keep progressing and stay above ground', () => {
  for (const seed of [1, 483921, 792835]) for (let direction = 0; direction < 8; direction++) {
    const world = createWorld(seed), car = createVehicle(world, 0, 0, direction * Math.PI / 4);
    for (let i = 0; i < 7200; i++) {
      stepVehicle(car, { up: true, jump: i % 700 < 4 }, world, []);
      assert.ok(Number.isFinite(car.y + car.x + car.z));
      assert.ok(car.y >= car.groundY - 1e-9);
    }
    assert.ok(car.distance > 1700, `seed ${seed}, direction ${direction}: ${car.distance}`);
    assert.ok(Math.hypot(car.x, car.z) > 1500);
  }
});

test('sand regions are continuous, repeatable, and absent above the snow line', () => {
  const world = createWorld(100003), repeat = createWorld(100003);
  let desert = 0, grass = 0, snow = 0;
  for (let x = -4000; x <= 4000; x += 160) for (let z = -4000; z <= 4000; z += 160) {
    const amount = world.desertAt(x, z);
    assert.equal(amount, repeat.desertAt(x, z));
    assert.ok(amount >= 0 && amount <= 1);
    assert.ok(Math.abs(amount - world.desertAt(x + .001, z)) < .001);
    if (amount > .9) desert++;
    if (amount < .1) grass++;
    if (world.height(x, z) >= 117) { snow++; assert.equal(amount, 0); }
  }
  assert.ok(desert > 100 && grass > 100 && snow > 0, 'all three regions coexist');
});

test('cacti grow on sand, preserve clear routes, and replace grassland vegetation', () => {
  const world = createWorld(100003); let cacti = 0;
  for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) {
    const props = world.props(cx, cz);
    assert.deepEqual(props, createWorld(100003).props(cx, cz));
    for (const prop of props) {
      if (prop.type === 'cactus') {
        cacti++;
        assert.ok(world.desertAt(prop.x, prop.z) > .55);
        assert.ok(world.roadAt(prop.x, prop.z).d >= 12 && !world.reserved(prop.x, prop.z));
        assert.ok(prop.r > 0 && prop.h > 0);
      }
      if (world.desertAt(prop.x, prop.z) > .55) assert.ok(!['tree', 'bush'].includes(prop.type));
    }
  }
  assert.ok(cacti > 100);
});
