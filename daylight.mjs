// Time of day: the clock, the sun and moon paths, and the light and sky
// colours from sunrise through sunset, night and back. Pure logic (numbers in,
// numbers out, no renderer), so the cycle is unit-tested.
//
// A day lasts DAY_SECONDS of play (06:00–18:00) and a night NIGHT_SECONDS
// (18:00–06:00): nights run faster, so most of the time is daylight.
export const DAY_SECONDS = 720, NIGHT_SECONDS = 240;
export const SUNRISE = 6, SUNSET = 18;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// A world's starting hour from a number u in [0, 1) (its seeded roll). It is
// spread evenly over the cycle's play time, not its 24 hours, so worlds start
// in the night about as often as you would meet night while playing (4 of
// every 16 minutes).
export function startHour(u) {
  const t = (((u % 1) + 1) % 1) * (DAY_SECONDS + NIGHT_SECONDS);
  return t < DAY_SECONDS ? SUNRISE + t / DAY_SECONDS * 12 : (SUNSET + (t - DAY_SECONDS) / NIGHT_SECONDS * 12) % 24;
}

// Advance the clock (hours, 0–24) by dt seconds of play.
export function advanceClock(hours, dt) {
  const day = hours >= SUNRISE && hours < SUNSET;
  return (hours + dt * 12 / (day ? DAY_SECONDS : NIGHT_SECONDS)) % 24;
}

// The sun climbs from the east-north-east, peaks at about 55° at noon toward
// the south-west of the map (where the old fixed sun sat) and sets opposite
// where it rose; past sunset the same circle carries it below the horizon.
// The moon rides opposite the sun.
const NOON = normalize([-.5, .82, .28]);
const HORIZONTAL = normalize([NOON[0], 0, NOON[2]]);
const EAST = [HORIZONTAL[2], 0, -HORIZONTAL[0]];
function normalize(v) { const n = Math.hypot(...v); return v.map(c => c / n); }
export function sunDirection(hours) {
  const angle = (hours - SUNRISE) / 12 * Math.PI, c = Math.cos(angle), s = Math.sin(angle);
  return normalize([EAST[0] * c + NOON[0] * s, EAST[1] * c + NOON[1] * s, EAST[2] * c + NOON[2] * s]);
}
export const moonDirection = hours => sunDirection(hours).map(c => -c);

// Colours as linear RGB triples.
const hex = h => [0, 2, 4].map(i => { const c = parseInt(h.slice(1 + i, 3 + i), 16) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
const lerp3 = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
const PALETTE = {
  // [zenith, horizon, clouds lit, clouds shaded, hemisphere sky, hemisphere ground]
  // The hemisphere's sky is the fill in the shadows: the blue of the open sky
  // by day (shadows a little blue), a cool grey-blue against the low sun.
  day: [hex('#5d93b3'), hex('#b9cdd0'), hex('#f4f6f2'), hex('#a9b3b8'), hex('#b4cbe0'), hex('#787257')],
  golden: [hex('#5a7ea6'), hex('#e8b48a'), hex('#ffd2a6'), hex('#9a8a96'), hex('#b8bccc'), hex('#6e5c48')],
  dusk: [hex('#2c3c66'), hex('#d47a5a'), hex('#f59a72'), hex('#5d5068'), hex('#b49aa8'), hex('#3c3434')],
  night: [hex('#04070f'), hex('#0e1626'), hex('#1b2232'), hex('#080b12'), hex('#5a6c96'), hex('#16181d')],
};

// Everything the scene needs at a given hour.
export function daylight(hours) {
  const sun = sunDirection(hours), moon = moonDirection(hours), height = sun[1];
  // 1 in full day, 0 at night; golden and dusk weigh the palette near the horizon.
  const day = smoothstep(-.1, .2, height);
  // Golden hour: the sun low above the horizon. Dusk: just below it, the
  // afterglow. Night: well below.
  const golden = smoothstep(.36, .06, height) * smoothstep(-.05, .03, height);
  const dusk = smoothstep(.05, -.03, height) * smoothstep(-.26, -.1, height);
  const night = smoothstep(-.08, -.24, height);
  let colors = PALETTE.day.map((c, i) => lerp3(c, PALETTE.golden[i], golden));
  colors = colors.map((c, i) => lerp3(c, PALETTE.dusk[i], dusk));
  colors = colors.map((c, i) => lerp3(c, PALETTE.night[i], night));
  // As the sun drops, the ground it lights gets a smaller share of it (on
  // level ground about a tenth at 6°), and so does the fill, or shadows fade
  // away. Eyes adapt: exposure lifts, up to double around sunset, and the sky's
  // own colours (and the light on self-coloured surfaces) come down by as much,
  // so the sky, the fog and the water look just as they did.
  const lift = 1 + smoothstep(.32, .08, height) * smoothstep(-.1, 0, height);
  const [zenith, horizon, cloudLit, cloudShade] = colors.slice(0, 4).map(c => c.map(v => v / lift)), [hemiSky, hemiGround] = colors.slice(4);
  // The key light is the sun by day and the moon by night. Both are almost
  // dark where they hand over (just below the horizon), so the swap is unseen.
  const sunUp = height > -.02;
  const keyDirection = sunUp ? normalize([sun[0], Math.max(sun[1], .05), sun[2]]) : normalize([moon[0], Math.max(moon[1], .12), moon[2]]);
  const sunWarmth = smoothstep(.0, .4, height);
  const sunColor = lerp3(hex('#ff8a4a'), hex('#fff0d2'), sunWarmth);
  // The sunlight is a little brighter than the sun's colour (which the sky
  // shows): with the weaker, bluer fill, sunlit ground stays as bright as it
  // was. Its deep orange near the horizon is darker, so it gets a little more.
  const keyColor = sunUp ? sunColor.map(c => c * 1.22 * (1 + .3 * (1 - sunWarmth))) : hex('#9fb2ff');
  const keyIntensity = sunUp ? 2.5 * smoothstep(-.02, .14, height) : .42 * smoothstep(-.02, -.18, height);
  return {
    // sunColor: the sun as the sky shows it (its disc and glow).
    hours, sun, moon, keyDirection, keyColor, keyIntensity, sunColor: sunColor.map(c => c / lift), lift,
    day, dusk, night, golden,
    zenith, horizon, cloudLit, cloudShade, hemiSky, hemiGround,
    // The fill falls with the sun, from 1.65 at noon to .7 at sunrise and
    // sunset: sunlit to shaded level ground is about 3.3:1 at noon, 1.8:1 at
    // 07:00 and 1.4:1 at 17:30 (it was 2.3, 1.3 and 1.1).
    hemiIntensity: mix(.55, mix(.7, 1.65, smoothstep(-.05, .5, height)), day) * (1 - .15 * dusk),
    // A little brighter exposure at night, as eyes adapt, and around sunset (lift).
    exposure: mix(1.05, 1.45, night) * lift,
    // Light on self-coloured surfaces (water, rain, foam): 1 by day.
    surfaceLight: lerp3(lerp3([1, 1, 1], hex('#ffc9a0'), Math.max(golden * .4, dusk * .8)), hex('#5a6a90'), night).map(c => c * mix(.6, 1, day) / lift),
    stars: night,
  };
}

export function clockLabel(hours) {
  const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
