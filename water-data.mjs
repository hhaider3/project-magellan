// Typed arrays cross the worker boundary by transfer, with no terrain sampling
// or large mesh-generation loops left on the animation thread.
export function buildWaterData(world, lake) {
  const x0 = Math.floor((lake.x - lake.rx * 1.03) / 4) * 4, z0 = Math.floor((lake.z - lake.rz * 1.03) / 4) * 4;
  const nx = Math.ceil(lake.rx * 2.06 / 4) + 1, nz = Math.ceil(lake.rz * 2.06 / 4) + 1;
  const count = (nx + 1) * (nz + 1);
  const position = new Float32Array(count * 3), bedDepth = new Float32Array(count), lakeUV = new Float32Array(count * 2);
  const indices = [];
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    const i = iz * (nx + 1) + ix, x = x0 + ix * 4, z = z0 + iz * 4;
    position.set([x, lake.level + .012, z], i * 3);
    bedDepth[i] = lake.level - world.surface(x, z);
    lakeUV.set([(x - lake.x) / lake.rx, (z - lake.z) / lake.rz], i * 2);
  }
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
    if (Math.max(bedDepth[a], bedDepth[b], bedDepth[c], bedDepth[d]) <= 0) continue;
    indices.push(a, c, b, b, c, d);
  }
  return { position, bedDepth, lakeUV, index: new Uint16Array(indices) };
}
