import { CHUNK, GRID, hash, noise, random, smoothstep } from './world.mjs?v=grass-1';

export const GRASS_GRID = 40;
export const MAX_GRASS_PER_CHUNK = GRASS_GRID * GRASS_GRID;

// Worker-only placement. Reuse the built terrain triangles instead of sampling
// procedural height/gradients for thousands of individual blades.
export function buildGrass(world, cx, cz, ground) {
  const roots = [], shapes = [], stride = CHUNK / GRID + 1;
  const step = CHUNK / GRASS_GRID, wx = cx * CHUNK, wz = cz * CHUNK;
  const yAt = (x, z) => ground.position[(z * stride + x) * 3 + 1];
  for (let iz = 0; iz < GRASS_GRID; iz++) for (let ix = 0; ix < GRASS_GRID; ix++) {
    const gx = cx * GRASS_GRID + ix, gz = cz * GRASS_GRID + iz;
    const x = (ix + .15 + hash(gx, gz, world.seed + 901) * .7) * step;
    const z = (iz + .15 + hash(gx, gz, world.seed + 902) * .7) * step;
    const px = wx + x, pz = wz + z, tx = Math.floor(x / GRID), tz = Math.floor(z / GRID);
    const u = x / GRID - tx, v = z / GRID - tz;
    const a = yAt(tx, tz), b = yAt(tx + 1, tz), c = yAt(tx, tz + 1), d = yAt(tx + 1, tz + 1);
    const h = u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    const slope = u + v <= 1 ? Math.hypot(b - a, c - a) / GRID : Math.hypot(d - c, d - b) / GRID;
    const plains = (1 - smoothstep(.25, .55, world.mountainAt(px, pz)))
      * (1 - smoothstep(.55, .75, world.woodlandAt(px, pz)))
      * (1 - smoothstep(.22, .5, slope)) * (1 - smoothstep(90, 110, h));
    const density = plains * (.45 + .5 * noise(px * .045, pz * .045, world.seed + 906));
    if (hash(gx, gz, world.seed + 903) > density || world.desertAt(px, pz, h) > .12) continue;
    if (world.roadAt(px, pz).d < 7.5 || world.reserved(px, pz)) continue;
    roots.push(x, h - .035, z);
    shapes.push(.3 + hash(gx, gz, world.seed + 904) * .4, hash(gx, gz, world.seed + 905) * Math.PI * 2, .85 + hash(gx, gz, world.seed + 907) * .3);
  }
  // Mobile uses a prefix of this shuffled set, distributed across the whole
  // chunk rather than dropping half of its rows. Revisited chunks stay identical.
  const rng = random((hash(cx, cz, world.seed + 908) * 4294967296) >>> 0);
  for (let i = roots.length / 3 - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    for (const data of [roots, shapes]) for (let k = 0; k < 3; k++) {
      const temp = data[i * 3 + k]; data[i * 3 + k] = data[j * 3 + k]; data[j * 3 + k] = temp;
    }
  }
  return { roots: new Float32Array(roots), shapes: new Float32Array(shapes) };
}
