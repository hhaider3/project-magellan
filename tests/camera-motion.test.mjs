import test from 'node:test';
import assert from 'node:assert/strict';
import { followTarget, followValue } from '../camera-motion.mjs';

test('camera position and aim retain the same moving-target lag across refresh rates and switches', () => {
  const schedules = [30, 60, 90, 120, 144, 165, 240].map(hz => () => 1 / hz);
  schedules.push(i => [1 / 30, 1 / 120][i % 2], i => [.004, .013, .008, .025][i % 4]);
  schedules.push((i, elapsed) => 1 / (elapsed < 2 ? 120 : elapsed < 4 ? 30 : 90));
  for (const interval of schedules) for (const rate of [5, 8]) {
    const position = { x: 0, y: 4, z: -12 }, previous = { ...position };
    const start = { ...position }, velocity = { x: 12, y: 1.5, z: 83.3 };
    let elapsed = 0;
    for (let i = 0; elapsed < 6; i++) {
      const dt = Math.min(interval(i, elapsed), 6 - elapsed); elapsed += dt;
      const target = Object.fromEntries(Object.keys(start).map(k => [k, start[k] + velocity[k] * elapsed]));
      followTarget(position, previous, target, rate, dt);
      for (const key of Object.keys(start)) {
        const expected = target[key] - velocity[key] / rate * (1 - Math.exp(-rate * elapsed));
        assert.ok(Math.abs(position[key] - expected) < 1e-9, `stable ${key} camera lag at ${elapsed}s / ${dt}s frame`);
      }
    }
  }
});

test('stationary camera converges and zero-delta reset discards the old tracking path', () => {
  const position = { x: 10, y: 8, z: 30 }, previous = { x: 0, y: 0, z: 0 }, target = { x: 0, y: 0, z: 0 };
  followTarget(position, previous, target, 5, .2);
  assert.ok(Math.abs(position.x - 10 * Math.exp(-1)) < 1e-12);
  const teleported = { x: -1000, y: 15, z: 2500 };
  followTarget(position, previous, teleported, 5, 0);
  assert.deepEqual(position, teleported); assert.deepEqual(previous, teleported);
  followTarget(position, previous, teleported, 5, 1 / 120);
  for (const key of Object.keys(position)) assert.ok(Math.abs(position[key] - teleported[key]) < 1e-10);
});

test('camera field of view follows a speed ramp independently of frame partitions', () => {
  for (const hz of [30, 60, 120, 165]) {
    let value = 57, previous = 57;
    for (let i = 1; i <= hz * 2; i++) {
      const target = 57 + 5 * i / hz;
      value = followValue(value, previous, target, 2.45, 1 / hz); previous = target;
    }
    assert.ok(Math.abs(value - (67 - 5 / 2.45 * (1 - Math.exp(-2.45 * 2)))) < 1e-10);
  }
});
