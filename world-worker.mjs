import { createWorld, CHUNK, GRID, ROAD_SPACING } from './world.mjs?v=ramp-exits-1';
import { createTerrain } from './terrain.mjs?v=ramp-exits-1';
let world, terrain;
self.onmessage = ({ data: job }) => {
  try {
    if (!world || world.seed !== job.seed) { world = createWorld(job.seed); terrain = createTerrain(world); }
    const start = performance.now();
    const size = job.kind === 'near' ? CHUNK : CHUNK * 4;
    const wx = job.cx * size, wz = job.cz * size;
    const ground = terrain.build(wx, wz, size, job.kind === 'near' ? GRID : 24);
    const result = { ...job, ground };
    if (job.kind === 'near') {
      result.props = world.props(job.cx, job.cz);
      result.features = world.featuresNear(wx + CHUNK / 2, wz + CHUNK / 2, 100).filter(f => Math.floor(f.x / CHUNK) === job.cx && Math.floor(f.z / CHUNK) === job.cz);
      result.roadside = [];
      for (const dir of ['x', 'z']) {
        const origin = dir === 'x' ? wx : wz, centerBand = Math.round((dir === 'x' ? wz : wx) / ROAD_SPACING);
        for (let band = centerBand - 1; band <= centerBand + 1; band++) for (let s = Math.ceil(origin / 42) * 42; s < origin + CHUNK; s += 42) for (const side of [-1, 1]) {
          const center = world.roadCenter(s, band, dir), x = dir === 'x' ? s : center + side * 6.4, z = dir === 'x' ? center + side * 6.4 : s;
          if (Math.floor(x / CHUNK) !== job.cx || Math.floor(z / CHUNK) !== job.cz || world.roadAt(x, z).d < 5.8) continue;
          result.roadside.push({ type: 'post', x, z, y: world.surface(x, z), size: 1, turn: 0 });
        }
      }
    }
    result.workMs = performance.now() - start;
    self.postMessage(result, Object.values(ground).map(array => array.buffer));
  } catch (error) { self.postMessage({ id: job.id, generation: job.generation, error: error.message }); }
};
