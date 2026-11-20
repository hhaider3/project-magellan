import test from 'node:test';
import assert from 'node:assert/strict';
import { daylight, advanceClock, sunDirection, moonDirection, clockLabel, startHour, DAY_SECONDS, NIGHT_SECONDS } from '../daylight.mjs';
import { hash } from '../world.mjs';

const elevation = hours => Math.asin(sunDirection(hours)[1]) * 180 / Math.PI;

test('the sun rises at 06:00, peaks at noon and sets at 18:00; the moon rides opposite', () => {
  assert.ok(Math.abs(elevation(6)) < .01 && Math.abs(elevation(18)) < .01);
  assert.ok(elevation(12) > 50 && elevation(12) < 60, `noon: ${elevation(12)}`);
  for (const h of [7, 9, 12, 15, 17]) assert.ok(elevation(h) > 0, `up at ${h}`);
  for (const h of [19, 22, 0, 3, 5]) assert.ok(elevation(h) < 0, `down at ${h}`);
  assert.ok(Math.abs(elevation(9) - elevation(15)) < 1e-9, 'symmetric about noon');
  const sun = sunDirection(22), moon = moonDirection(22);
  assert.ok(moon[1] > 0 && sun.every((c, i) => Math.abs(c + moon[i]) < 1e-12));
  // It rises and sets on opposite sides.
  const rise = sunDirection(6), set = sunDirection(18);
  assert.ok(rise[0] * set[0] + rise[2] * set[2] < -.99);
});

test('a full day takes DAY_SECONDS of daylight and NIGHT_SECONDS of night', () => {
  let hours = 6, seconds = 0;
  while (hours < 18 && seconds < 5000) { hours = advanceClock(hours, .5); seconds += .5; }
  assert.ok(Math.abs(seconds - DAY_SECONDS) <= .5, `day: ${seconds}`);
  seconds = 0;
  while ((hours >= 18 || hours < 6) && seconds < 5000) { hours = advanceClock(hours, .5); seconds += .5; }
  assert.ok(Math.abs(seconds - NIGHT_SECONDS) <= .5, `night: ${seconds}`);
  assert.ok(advanceClock(23.99, 10) < 1, 'wraps past midnight');
});

test('light follows the sun: bright day, warm golden hour and dusk, a dim moonlit night, with no jumps', () => {
  const noon = daylight(12), golden = daylight(17.5), dusk = daylight(18.4), night = daylight(23);
  assert.equal(noon.day, 1); assert.equal(noon.night, 0); assert.equal(noon.keyIntensity, 2.5);
  assert.ok(golden.golden > .8 && golden.keyColor[0] > golden.keyColor[2] * 1.3, 'golden hour is warm');
  assert.ok(dusk.dusk > .5 && dusk.horizon[0] > dusk.horizon[2], 'the afterglow is warm on the horizon');
  assert.equal(night.night, 1); assert.ok(night.keyIntensity > .2 && night.keyIntensity < .6);
  assert.ok(night.keyColor[2] > night.keyColor[0], 'moonlight is blue');
  assert.ok(night.keyDirection[1] > 0, 'the key light is always above the horizon');
  assert.ok(night.zenith.every(c => c < .01), 'a dark night sky');
  // Small steps of the clock never jump the light or the sky colours.
  let previous = daylight(0);
  for (let h = .01; h < 24; h += .01) {
    const d = daylight(h);
    assert.ok(Math.abs(d.keyIntensity - previous.keyIntensity) < .06, `key light jumps at ${h.toFixed(2)}`);
    for (const k of ['zenith', 'horizon', 'cloudLit', 'hemiSky']) for (let i = 0; i < 3; i++) assert.ok(Math.abs(d[k][i] - previous[k][i]) < .03, `${k} jumps at ${h.toFixed(2)}`);
    previous = d;
  }
});

test('sunlit ground stands clear of the shade, from noon to the low sun, and the lift keeps the sky as it was', () => {
  const lum = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  // Level ground: the sun's share (its height) plus the sky's fill, against the fill alone.
  const ratio = d => (lum(d.keyColor) * d.keyIntensity * d.keyDirection[1] + lum(d.hemiSky) * d.hemiIntensity) / (lum(d.hemiSky) * d.hemiIntensity);
  assert.ok(ratio(daylight(12)) > 3, `noon ${ratio(daylight(12))}`);
  assert.ok(ratio(daylight(7)) > 1.6, `07:00 ${ratio(daylight(7))}`);
  assert.ok(ratio(daylight(17.5)) > 1.3, `17:30 ${ratio(daylight(17.5))}`);
  // Shadows by day are filled by the blue sky.
  const fill = daylight(12).hemiSky; assert.ok(fill[2] > fill[0] * 1.4, 'a blue fill');
  // Exposure lifts around sunset, and the sky's colours come down to match.
  for (const h of [12, 17.5, 18.2, 22]) {
    const d = daylight(h);
    assert.ok(Math.abs(d.exposure / d.lift - (1.05 + .4 * d.night)) < 1e-9 && d.lift >= 1 && d.lift <= 2);
  }
  assert.equal(daylight(12).lift, 1); assert.equal(daylight(23).lift, 1); assert.ok(daylight(17.9).lift > 1.8);
});

test('the clock label reads hours and minutes', () => {
  assert.equal(clockLabel(6.5), '06:30'); assert.equal(clockLabel(18.25), '18:15'); assert.equal(clockLabel(0), '00:00');
});

test('each world starts at its own time, spread over the cycle as you would meet it while playing', () => {
  const hours = Array.from({ length: 4000 }, (_, i) => startHour(hash(17, 29, i + 1 + 5501)));
  for (const h of hours) assert.ok(h >= 0 && h < 24);
  const night = hours.filter(h => h >= 18 || h < 6).length / hours.length;
  assert.ok(Math.abs(night - NIGHT_SECONDS / (DAY_SECONDS + NIGHT_SECONDS)) < .03, `night share ${night}`);
  assert.ok(new Set(hours.map(h => Math.floor(h))).size === 24, 'every hour occurs');
  assert.equal(startHour(0), 6); assert.ok(Math.abs(startHour(DAY_SECONDS / (DAY_SECONDS + NIGHT_SECONDS)) - 18) < 1e-9);
});
