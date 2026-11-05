import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleAudio, cycleDrive, CYCLE_WHEEL, synthesizeEffect } from '../vehicle-audio.mjs';

// Enough of an AudioContext to run the voices' logic, not their sound.
function fakeContext() {
  const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ gain: param(), frequency: param(), Q: param(), playbackRate: param(), delayTime: param(), pan: param(), connect: next => next, disconnect() {}, start() {}, stop() {} });
  const context = { currentTime: 0, sampleRate: 8000, createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length), copyToChannel() {} }) };
  for (const name of ['Gain', 'BiquadFilter', 'Oscillator', 'WaveShaper', 'Convolver', 'Delay', 'StereoPanner', 'BufferSource']) context[`create${name}`] = node;
  return context;
}
const bike = (state = {}) => ({ speed: 50, throttle: 1, grounded: true, surface: 'road', transform: 0, flight: 0, waterDepth: 0, slip: 0, cycle: true, neon: false, jumps: 0, ...state });

test('the Light Cycle glides up in pitch with no gears, and its pulse turns with the wheels', () => {
  let last = 0;
  for (let v = 0; v <= 139; v++) {
    const { pitch } = cycleDrive(v, 1);
    assert.ok(pitch > last, `pitch never drops: ${v} m/s`);
    last = pitch;
  }
  assert.ok(Math.abs(cycleDrive(80, 1).pulse - 80 / (2 * Math.PI * CYCLE_WHEEL)) < 1e-9);
  assert.ok(cycleDrive(0, 0).pulse > 0, 'parked, it still breathes');
});

test('the Light Cycle opens up with power, boost and lean, and rises off the ground', () => {
  const cruise = cycleDrive(50, 0);
  assert.ok(cycleDrive(50, 1).tone > cruise.tone && cycleDrive(50, 1).level > cruise.level);
  assert.ok(cycleDrive(50, 0, { neon: true }).tone > cruise.tone && cycleDrive(50, 0, { neon: true }).pitch > cruise.pitch);
  assert.ok(cycleDrive(50, 0, { lean: 1 }).tone > cruise.tone);
  assert.ok(cycleDrive(50, 1, { grounded: false }).pitch > cycleDrive(50, 1).pitch);
  assert.ok(cycleDrive(50, 0, { wheelie: 1 }).pitch > cruise.pitch);
});

test('the hubs’ pulse never takes the Light Cycle’s level past zero', () => {
  for (let v = 0; v <= 139; v += 3) {
    const { pulseDepth } = cycleDrive(v, .5);
    assert.ok(pulseDepth > 0 && pulseDepth < 1, `${v} m/s: ${pulseDepth}`);
  }
});

test('the Light Cycle’s one-shots sound, stay in range and end silently', () => {
  for (const type of ['neonOn', 'neonOff', 'hop']) {
    const samples = synthesizeEffect(type);
    let peak = 0;
    for (const x of samples) { assert.ok(Number.isFinite(x), type); peak = Math.max(peak, Math.abs(x)); }
    assert.ok(peak > .3 && peak <= 1, `${type} peak ${peak}`);
    assert.ok(Math.abs(samples.at(-1)) < .02, `${type} ends at ${samples.at(-1)}`);
  }
});

test('the boost and a jump each sound once, when they happen', () => {
  const context = fakeContext(), sounds = createVehicleAudio(context, context.createGain());
  sounds.update(bike(), 1 / 60);
  assert.deepEqual(sounds.playedBy, {});
  for (let i = 0; i < 3; i++) sounds.update(bike({ neon: true, jumps: 1 }), 1 / 60);
  assert.deepEqual(sounds.playedBy, { neonOn: 1, hop: 1 });
  sounds.update(bike({ jumps: 1 }), 1 / 60);
  assert.equal(sounds.playedBy.neonOff, 1);
});

test('what the bike did before the sound started, or before a recovery, makes no sound', () => {
  const context = fakeContext(), sounds = createVehicleAudio(context, context.createGain());
  sounds.update(bike({ jumps: 4 }), 1 / 60);
  assert.deepEqual(sounds.playedBy, {});
  sounds.clear();
  sounds.update(bike({ jumps: 4 }), 1 / 60);
  assert.deepEqual(sounds.playedBy, {});
  sounds.update(bike({ jumps: 5 }), 1 / 60);
  assert.deepEqual(sounds.playedBy, { hop: 1 });
});

test('the other vehicles don’t make the bike’s sounds, and it doesn’t pop like the V8', () => {
  const context = fakeContext(), sounds = createVehicleAudio(context, context.createGain());
  sounds.update(bike({ cycle: false, electric: true }), 1 / 60);
  sounds.update(bike({ cycle: false, electric: true, neon: true, jumps: 3 }), 1 / 60);
  assert.deepEqual(sounds.playedBy, {});
  const random = Math.random;
  Math.random = () => 0; // the pop fires whenever it can
  try {
    for (let i = 0; i < 120; i++) sounds.update(bike({ speed: 90, throttle: 1 }), 1 / 30);
    for (let i = 0; i < 30; i++) sounds.update(bike({ speed: 90, throttle: 0 }), 1 / 30);
  } finally { Math.random = random; }
  assert.equal(sounds.playedBy.pop, undefined);
});
