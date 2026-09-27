// Seeded basins repeat across the endless landscape. Water and terrain share
// these descriptors, so there is no separate invisible shoreline collider.
const spacing = 840;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash(x, z, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function createLakes(seed, baseHeight, roadAt) {
  const cache = new Map();
  function atCell(cx, cz) {
    const key = `${cx},${cz}`;
    if (cache.has(key)) return cache.get(key);
    const starter = cx === 0 && cz === 0;
    const x = starter ? 180 : cx * spacing + 210 + (hash(cx, cz, seed + 1801) - .5) * 50;
    const z = starter ? 160 : cz * spacing + 210 + (hash(cx, cz, seed + 1802) - .5) * 50;
    const lake = { id: `lake:${key}`, x, z, rx: starter ? 96 : 100 + hash(cx, cz, seed + 1803) * 28,
      rz: starter ? 108 : 104 + hash(cx, cz, seed + 1804) * 30,
      level: baseHeight(x, z) - 1.5, depth: 8 + hash(cx, cz, seed + 1805) * 4,
      name: starter ? 'MIRROR LAKE' : 'THE LAKES' };
    // Keep the water below every natural rim (including nearby roads). A lake
    // on a mountainside must not end in a vertical sheet above the downhill bank.
    for (let i = 0; i < 64; i++) {
      const a = i * Math.PI / 32, px = x + Math.sin(a) * lake.rx * 1.02, pz = z + Math.cos(a) * lake.rz * 1.02;
      lake.level = Math.min(lake.level, baseHeight(px, pz) - 2.5);
      const road = roadAt(px, pz);
      if (Math.hypot((road.x - x) / lake.rx, (road.z - z) / lake.rz) < 1.08) lake.level = Math.min(lake.level, baseHeight(road.x, road.z) - 2.5);
    }
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, lake); return lake;
  }
  function lakeAt(x, z) {
    const lake = atCell(Math.round((x - 210) / spacing), Math.round((z - 210) / spacing));
    return Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz) < 2.1 ? lake : null;
  }
  function carve(x, z, original) {
    const lake = lakeAt(x, z); if (!lake) return original;
    const r = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
    const basin = lake.level - lake.depth * (1 - smooth(.18, .98, r)) + smooth(.88, 1.15, r) * 3 + Math.max(0, r - 1.15) * 10;
    const weight = (1 - smooth(1.05, 2.1, r)) * smooth(12, 110, roadAt(x, z).d);
    return original + (basin - original) * weight;
  }
  function near(x, z, radius = 900) {
    const result = [];
    for (let cx = Math.floor((x - radius - 210) / spacing); cx <= Math.ceil((x + radius - 210) / spacing); cx++) {
      for (let cz = Math.floor((z - radius - 210) / spacing); cz <= Math.ceil((z + radius - 210) / spacing); cz++) {
        const lake = atCell(cx, cz);
        if (Math.hypot(lake.x - x, lake.z - z) < radius + Math.max(lake.rx, lake.rz)) result.push(lake);
      }
    }
    return result;
  }
  return { carve, lakeAt, near, starter: atCell(0, 0) };
}

export function waterWave(x, z, time) {
  return Math.sin(x * .11 + z * .07 + time * 1.6) * .045 + Math.sin(x * -.06 + z * .14 - time * 1.2) * .025;
}
