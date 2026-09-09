import { CHUNK } from './world.mjs?v=grass-1';
export const FAR_SIZE = CHUNK * 4;
export const NEAR_VIEW = 4;
export const FAR_VIEW = 4;
// A tile keeps its vertex data; only its tiny index list changes as fine
// chunks arrive or leave. No overlapping near/far triangles or terrain cracks.
export function farIndices(tx, tz, hasFine) {
  const indices = [], n = FAR_SIZE / 24;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const cx = tx * 4 + Math.floor(x / 4), cz = tz * 4 + Math.floor(z / 4);
    if (hasFine(cx, cz)) continue;
    const a = z * (n + 1) + x, b = a + 1, c = a + n + 1;
    indices.push(a, c, b, b, c, c + 1);
  }
  return indices;
}
