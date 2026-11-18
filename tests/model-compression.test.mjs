import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODELS, EXTENSION, STEPS, compress, readGlb } from '../scripts/compress-models.mjs';
import { MeshoptDecoder } from '../vendor/libs/meshopt_decoder.module.js';

const root = new URL('../', import.meta.url);
const models = await Promise.all(MODELS.map(async path => ({ path, bytes: await readFile(new URL(path, root)) })));
await MeshoptDecoder.ready;
// One buffer view's contents, unpacked with the decoder the game uses.
function unpacked({ json, bin }, view) {
  const packed = view.extensions[EXTENSION], data = new Uint8Array(packed.count * packed.byteStride);
  MeshoptDecoder.decodeGltfBuffer(data, packed.count, packed.byteStride, bin.subarray(packed.byteOffset, packed.byteOffset + packed.byteLength), packed.mode, packed.filter ?? 'NONE');
  return data;
}

test('every model the game loads ships compressed (npm run compress-models after a Blender export)', async () => {
  for (const { path, bytes } of models) {
    const { json } = readGlb(bytes);
    assert.ok(json.extensionsRequired?.includes(EXTENSION), `${path} is not compressed`);
    assert.equal(await compress(bytes), null, `${path}: compressing again changes nothing`);
    // Everything but images is packed, and nothing is stored twice.
    const images = new Set((json.images ?? []).map(image => image.bufferView));
    json.bufferViews.forEach((view, i) => assert.equal(Boolean(view.extensions?.[EXTENSION]), !images.has(i), `${path} buffer view ${i}`));
    assert.equal(json.buffers.length, 2); assert.ok(json.buffers[1].extensions[EXTENSION].fallback);
  }
  // The seven models were 10.2 MB as Blender exports them.
  const total = models.reduce((sum, { bytes }) => sum + bytes.length, 0);
  assert.ok(total < 6e6, `${(total / 1e6).toFixed(2)} MB of models`);
});

test('compressed vertices stay 32-bit floats on the rounding grid, with honest bounds', () => {
  for (const { path, bytes } of models) {
    const glb = readGlb(bytes), { json } = glb;
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
      for (const [semantic, index] of Object.entries(primitive.attributes)) {
        const accessor = json.accessors[index], step = STEPS[semantic.replace(/_\d+$/, '')];
        if (!step || accessor.componentType !== 5126) continue;
        const values = new Float32Array(unpacked(glb, json.bufferViews[accessor.bufferView]).buffer);
        assert.ok(values.every(value => Number.isInteger(value / step)), `${path} ${mesh.name} ${semantic}`);
        if (semantic !== 'POSITION') continue;
        // three.js takes a mesh's bounding box from these.
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        values.forEach((value, n) => { min[n % 3] = Math.min(min[n % 3], value); max[n % 3] = Math.max(max[n % 3], value); });
        assert.deepEqual(accessor.min, min); assert.deepEqual(accessor.max, max);
      }
      // A model without textures carries no texture coordinates.
      if (!json.textures?.length) assert.ok(!Object.keys(primitive.attributes).some(key => key.startsWith('TEXCOORD')), `${path} ${mesh.name}`);
    }
  }
});
