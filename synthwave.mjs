// Synthwave: another look for the whole drive, an endless 1980s sunset. A
// huge striped sun sits on the horizon straight down the starting road, the
// sky runs from deep indigo overhead to hot pink at the horizon, and the land
// turns to dark glass ruled by a glowing grid: magenta on the low ground,
// cyan up the mountains, like a wireframe. Roads are black and glossy, with
// neon edges. The weather stays clear and the clock no longer moves the sun.
// Pure numbers and GLSL; game.mjs switches it on and off (for now with
// ?theme=synthwave).

// Colours as linear RGB triples, from sRGB hex.
const hex = h => [0, 2, 4].map(i => { const c = parseInt(h.slice(1 + i, 3 + i), 16) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
const normalize = v => { const n = Math.hypot(...v); return v.map(c => c / n); };

// sRGB hex, for THREE.Color.
export const SYNTHWAVE = {
  // The sky, from the horizon up.
  horizon: '#ff4f8b', low: '#d8227a', mid: '#7a1a86', high: '#2c0c55', zenith: '#0c0322',
  // The orange glow along the horizon under the sun.
  glow: '#ff7a3c',
  // The sun's disc, top to bottom.
  sunTop: '#ffe85a', sunMid: '#ff9038', sunLow: '#ff2a8c',
  // Fog: the far land melts into the horizon's own pink.
  fog: '#ff4f8b',
  // The ground, the roads, and their neon.
  floor: '#1a0b38', road: '#07030f', gridLow: '#ff2bd6', gridHigh: '#28e2ff', roadEdge: '#28e2ff', roadCentre: '#ffd23c',
  // The water's own colour, shallows to depths.
  shallow: '#3a1466', deep: '#12052a',
};
// The sun's disc: its angular radius, and how high its centre stands (both
// radians), so its lower part is hidden below the horizon.
export const SUN_RADIUS = .2, SUN_ELEVATION = .085;
// The ground's grid: a line every CELL metres, LINE metres wide.
export const GRID_CELL = 16, GRID_LINE = .11;

// The scene's light in place of daylight() (the same fields): the low sun
// ahead along `heading` (the starting road's), lighting the land warm orange
// from a little above its disc (so its glint on the cars sits where the sun
// would put it), under a violet sky.
export function synthwaveLight(heading) {
  const c = Math.cos(SUN_ELEVATION), sun = [Math.sin(heading) * c, Math.sin(SUN_ELEVATION), Math.cos(heading) * c];
  const zenith = hex(SYNTHWAVE.zenith), horizon = hex(SYNTHWAVE.horizon);
  return {
    sun, moon: sun.map(v => -v), keyDirection: normalize([Math.sin(heading), .2, Math.cos(heading)]),
    keyColor: hex('#ff7a52'), keyIntensity: 1.3, sunColor: hex(SYNTHWAVE.sunMid),
    // Light enough to leave the headlights off (L turns them on), dark
    // enough for the night music.
    day: .5, dusk: 1, night: .6, golden: 0,
    zenith, horizon, cloudLit: horizon, cloudShade: zenith,
    hemiSky: hex('#7b3cff'), hemiGround: hex('#3a0d40'), hemiIntensity: 1.25,
    exposure: 1,
    surfaceLight: hex('#d9a6ff'),
    stars: 1,
  };
}

// GLSL: how much of a pixel the grid's lines cover (x) and the glow around
// them (y), for g in cells and lines `width` cells wide. Lines never draw
// thinner than about a pixel; past that they dim instead. Where cells shrink
// to a few pixels both fade to their average, so the far grid melts into an
// even glow rather than shimmering.
export const SYNTH_GRID_GLSL = `
  vec2 synthGrid(vec2 g, float width){
    vec2 du=max(fwidth(g),vec2(1e-5)), d=abs(fract(g+.5)-.5), w=max(vec2(width),du*1.2);
    vec2 dim=clamp(width/w,.3,1.0);
    vec2 line=(1.0-smoothstep(w*.5-du*.5,w*.5+du*.5,d))*dim;
    vec2 halo=exp(-d/du/3.0)*(1.0-smoothstep(.04,.16,du));
    float blend=smoothstep(.18,.5,max(du.x,du.y));
    float average=min(1.0,w.x*dim.x+w.y*dim.y);
    return vec2(mix(max(line.x,line.y),average,blend),max(halo.x,halo.y));
  }`;
