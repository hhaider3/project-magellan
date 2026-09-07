import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehiclePresentation } from '../vehicle-presentation.mjs';
import { createVehicle, FIXED_DT } from '../world.mjs';
const flat = { surface: () => 0 };

test('car and wheel motion remain uniform between physics ticks at different refresh rates', () => {
  for (const hz of [60, 90, 144, 165, 240]) {
    const car = createVehicle(flat); car.speed = 60;
    const presentation = createVehiclePresentation(car);
    let elapsed = 0, accumulator = 0, lastZ, lastWheel;
    for (let frame = 0; frame < hz * 2; frame++) {
      const dt = 1 / hz; elapsed += dt; accumulator += dt;
      while (accumulator >= FIXED_DT) {
        car.z += car.speed * FIXED_DT;
        presentation.advance(car, FIXED_DT); accumulator -= FIXED_DT;
      }
      const pose = presentation.sample(accumulator / FIXED_DT);
      if (elapsed > FIXED_DT * 2) {
        assert.ok(Math.abs(pose.z - 60 * (elapsed - FIXED_DT)) < 1e-9, `continuous position at ${hz} Hz`);
        if (lastZ !== undefined) {
          assert.ok(Math.abs(pose.z - lastZ - 60 * dt) < 1e-9, `no repeated or doubled displacement at ${hz} Hz`);
          assert.ok(Math.abs(pose.wheelAngle - lastWheel - 60 * dt / .57) < 1e-9);
        }
        lastZ = pose.z; lastWheel = pose.wheelAngle;
      }
    }
  }
});

test('uneven rendering intervals do not quantize motion or mutate the physics state', () => {
  const car = createVehicle(flat); car.speed = 50;
  const presentation = createVehiclePresentation(car);
  let elapsed = 0, accumulator = 0;
  for (let i = 0; i < 100; i++) {
    const dt = [.004, .013, .008, .025][i % 4]; elapsed += dt; accumulator += dt;
    while (accumulator >= FIXED_DT) { car.z += 50 * FIXED_DT; car.y += 2 * FIXED_DT; presentation.advance(car, FIXED_DT); accumulator -= FIXED_DT; }
    const before = { ...car }, pose = presentation.sample(accumulator / FIXED_DT);
    if (elapsed > FIXED_DT) {
      assert.ok(Math.abs(pose.z - 50 * (elapsed - FIXED_DT)) < 1e-9);
      assert.ok(Math.abs(pose.y - .06 - 2 * (elapsed - FIXED_DT)) < 1e-9);
    }
    assert.deepEqual(car, before);
  }
});

test('landing angle normalization does not reverse the visual barrel roll', () => {
  const car = createVehicle(flat); car.roll = Math.PI * 2 - .04;
  const presentation = createVehiclePresentation(car);
  car.roll = .04; presentation.advance(car, FIXED_DT);
  assert.ok(Math.abs(presentation.sample(.5).roll - Math.PI * 2) < 1e-10);
  car.heading = Math.PI - .02; presentation.reset(car);
  car.heading = -Math.PI + .02; presentation.advance(car, FIXED_DT);
  assert.ok(Math.abs(presentation.sample(.5).heading - Math.PI) < 1e-10);
});

test('recovery and world reset discard the old interpolation path', () => {
  const car = createVehicle(flat), presentation = createVehiclePresentation(car);
  car.z = 100; presentation.advance(car, FIXED_DT);
  const recovered = createVehicle(flat, -1000, 2500);
  presentation.reset(recovered);
  for (const alpha of [0, .5, 1]) {
    const pose = presentation.sample(alpha);
    assert.equal(pose.x, -1000); assert.equal(pose.z, 2500); assert.equal(pose.wheelAngle, 0);
  }
});
