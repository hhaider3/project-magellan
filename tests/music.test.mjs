import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { TRACKS, CROSSFADE, pickTrack, volumeGain } from '../music.mjs';

// A repeatable stand-in for Math.random.
const seeded = (seed = 7) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const share = (mood, samples = 4000) => {
  const random = seeded(), counts = Object.fromEntries(TRACKS.map(t => [t.id, 0]));
  for (let i = 0; i < samples; i++) counts[pickTrack(null, mood, random).id]++;
  for (const id in counts) counts[id] /= samples;
  return counts;
};

test('every track is shipped, levelled and ends after the crossfade begins', async () => {
  assert.equal(TRACKS.length, 4);
  for (const track of TRACKS) {
    const file = await stat(new URL(`../assets/music/${track.id}.m4a`, import.meta.url));
    assert.ok(file.size > 1e6 && file.size < 4e6, `${track.id}: ${file.size} bytes`);
    assert.ok(track.level <= 0 && track.level > -6, `${track.id} is levelled down, not boosted`);
    assert.ok(track.end > CROSSFADE * 10, `${track.id} ends at ${track.end} s`);
  }
});

test('the next track is never the one just played', () => {
  const random = seeded();
  for (const track of TRACKS) for (let i = 0; i < 200; i++) assert.notEqual(pickTrack(track.id, { night: i % 2 }, random).id, track.id);
});

test('night favours Night Drive, the Roadster Redline, and the day the daytime drives', () => {
  const day = share({ night: 0 }), night = share({ night: 1 }), roadster = share({ night: 0, roadster: true });
  assert.ok(night['night-drive'] > .6, `night: ${night['night-drive']}`);
  assert.ok(day['night-drive'] < .1, `day: ${day['night-drive']}`);
  assert.ok(day['golden-hour-highway'] + day['chrome-highway'] > .6);
  assert.ok(roadster.redline > 2 * day.redline, `roadster ${roadster.redline} vs ${day.redline}`);
  for (const id in day) assert.ok(day[id] > 0, `${id} still plays now and then by day`);
});

test('the volume slider maps to a gain that rises smoothly from silence to full', () => {
  assert.equal(volumeGain(0), 0); assert.equal(volumeGain(1), 1);
  assert.equal(volumeGain(-1), 0); assert.equal(volumeGain(2), 1);
  for (let v = .05; v <= 1; v += .05) assert.ok(volumeGain(v) > volumeGain(v - .05));
  assert.ok(Math.abs(20 * Math.log10(volumeGain(.5)) + 12) < .1, 'half the slider is about -12 dB');
});
