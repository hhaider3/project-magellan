// Shrinks the game's exported GLBs for the download, in place:
//
//   npm run compress-models                    (every model the game loads)
//   node scripts/compress-models.mjs a.glb …   (just these)
//
// Run it after any Blender export. tests/model-compression.test.mjs fails
// while a shipped model is still uncompressed; a model already compressed is
// left as it is.
//
// The scene itself doesn't change: its nodes, names, extras, materials,
// textures, animation, vertex order and triangle order stay as Blender wrote
// them (a triangle may be listed from a different corner), and every
// attribute stays 32-bit float, so the game's own geometry code (merging,
// baking transforms, breaking trees) reads the models as before.
//
// 1. Texture coordinates are dropped from a model that has no textures:
//    nothing reads them.
// 2. Vertex data is rounded to a fixed grid: positions to 1/8192 m (0.12 mm,
//    so nothing moves more than 0.06 mm), normals, tangents and colours to
//    1/4096, texture coordinates to 1/16384. That clears the low bits of each
//    float, which carry nothing visible and don't pack.
// 3. Each buffer is packed with EXT_meshopt_compression, which is lossless
//    (indices and animation are packed exactly as they were). The game
//    unpacks them with vendor/libs/meshopt_decoder.module.js, and this script
//    checks every buffer by unpacking it with that same decoder.
import { readFile, writeFile } from 'node:fs/promises';
import { MeshoptEncoder } from 'meshoptimizer';
import { MeshoptDecoder } from '../vendor/libs/meshopt_decoder.module.js';

export const MODELS = [
  'assets/vehicles/atlas-amphibious.glb', 'assets/vehicles/roadster-rocket.glb', 'assets/vehicles/light-cycle-rider.glb',
  'assets/nature/endless-nature.glb', 'assets/nature/sakura-realistic/sakura-tree.glb',
  'assets/nature/palm-synthwave/palm-trees.glb', 'assets/nature/synth-props/synth-props.glb',
];
export const EXTENSION = 'EXT_meshopt_compression';
// Grid steps, as powers of two so the rounded values are exact floats.
export const STEPS = { POSITION: 2 ** -13, NORMAL: 2 ** -12, TANGENT: 2 ** -12, COLOR: 2 ** -12, TEXCOORD: 2 ** -14 };
const kindOf = semantic => semantic.replace(/_\d+$/, '');
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }, WIDTH = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, FLOAT = 5126;
const pad = n => n + 3 & ~3;
const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
// The index packing may start a triangle at a different corner (same
// triangle, same facing), so triangles are compared corner-rotated.
function sameTriangles(a, b, width) {
  const read = bytes => width === 2 ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2) : new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const p = read(a), q = read(b);
  if (p.length !== q.length) return false;
  for (let t = 0; t < p.length; t += 3) {
    if (![0, 1, 2].some(r => p[t] === q[t + r] && p[t + 1] === q[t + (r + 1) % 3] && p[t + 2] === q[t + (r + 2) % 3])) return false;
  }
  return true;
}

export function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binAt = 20 + jsonLength, bin = binAt < bytes.length ? bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt)) : Buffer.alloc(0);
  return { json, bin };
}
function writeGlb(json, bin) {
  const text = Buffer.from(JSON.stringify(json)), jsonLength = pad(text.length), binLength = pad(bin.length);
  const out = Buffer.alloc(28 + jsonLength + binLength);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonLength, 12); out.writeUInt32LE(0x4e4f534a, 16); out.fill(0x20, 20, 20 + jsonLength); text.copy(out, 20);
  out.writeUInt32LE(binLength, 20 + jsonLength); out.writeUInt32LE(0x004e4942, 24 + jsonLength); bin.copy(out, 28 + jsonLength);
  return out;
}

// Every place a glTF refers to an accessor, as [holder, key] pairs.
function* accessorRefs(json) {
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    if (primitive.indices !== undefined) yield [primitive, 'indices'];
    for (const set of [primitive.attributes, ...(primitive.targets ?? [])]) for (const key of Object.keys(set)) yield [set, key];
  }
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers) { yield [sampler, 'input']; yield [sampler, 'output']; }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) yield [skin, 'inverseBindMatrices'];
}
// Drops accessors and buffer views nothing refers to any more, renumbering the rest.
function prune(json) {
  const keep = (list, used) => { const index = new Map(); return [list.filter((_, i) => used.has(i) && index.set(i, index.size)), index]; };
  const [accessors, accessorAt] = keep(json.accessors, new Set([...accessorRefs(json)].map(([holder, key]) => holder[key])));
  for (const [holder, key] of [...accessorRefs(json)]) holder[key] = accessorAt.get(holder[key]);
  json.accessors = accessors;
  const [views, viewAt] = keep(json.bufferViews, new Set([...accessors.map(a => a.bufferView), ...(json.images ?? []).map(i => i.bufferView)]));
  for (const holder of [...accessors, ...(json.images ?? [])]) if (holder.bufferView !== undefined) holder.bufferView = viewAt.get(holder.bufferView);
  json.bufferViews = views;
}

// Returns the compressed file and what changed, or null if it already is.
export async function compress(bytes) {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const { json, bin } = readGlb(bytes);
  if (json.extensionsUsed?.includes(EXTENSION)) return null;
  if (json.buffers?.length !== 1 || json.buffers[0].uri) throw new Error('Expected a self-contained GLB with one buffer');
  if (json.accessors.some(a => a.sparse || a.bufferView === undefined)) throw new Error('Sparse accessors are not supported');
  const report = { before: bytes.length, moved: {}, droppedTexcoords: 0 };

  if (!json.textures?.length) {
    for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) for (const set of [primitive.attributes, ...(primitive.targets ?? [])]) {
      for (const key of Object.keys(set)) if (kindOf(key) === 'TEXCOORD') { delete set[key]; report.droppedTexcoords++; }
    }
    prune(json);
  }

  // What each buffer view holds, from the accessors that read it.
  const uses = json.bufferViews.map(() => ({ accessors: [], kinds: new Set(), indices: false, triangles: true }));
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    if (primitive.indices !== undefined) { const use = uses[json.accessors[primitive.indices].bufferView]; use.indices = true; use.triangles &&= (primitive.mode ?? 4) === 4; }
    for (const set of [primitive.attributes, ...(primitive.targets ?? [])]) for (const [key, accessor] of Object.entries(set)) uses[json.accessors[accessor].bufferView].kinds.add(kindOf(key));
  }
  json.accessors.forEach(accessor => uses[accessor.bufferView].accessors.push(accessor));

  const chunks = []; let packedLength = 0, plainLength = 0;
  const place = chunk => { const at = packedLength; chunks.push([at, chunk]); packedLength = pad(at + chunk.length); return at; };
  json.bufferViews = json.bufferViews.map((view, i) => {
    const { accessors, kinds, indices, triangles } = uses[i], first = accessors[0];
    const data = Uint8Array.from(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
    const stride = first ? COMPONENTS[first.type] * WIDTH[first.componentType] : 0, count = first?.count;
    // Packable when the view is one whole, tightly packed array (as Blender
    // writes them). Anything else (images, odd layouts) is copied as it is.
    const whole = first && accessors.every(a => !a.byteOffset && a.type === first.type && a.componentType === first.componentType && a.count === count)
      && stride * count === view.byteLength && (view.byteStride ?? stride) === stride && (indices ? kinds.size === 0 && stride > 1 : stride % 4 === 0 && stride <= 256);
    if (!whole) return { ...view, buffer: 0, byteOffset: place(data) };

    let source = data, filter;
    const step = kinds.size === 1 && first.componentType === FLOAT ? STEPS[[...kinds][0]] : undefined;
    if (step) {
      const values = new Float32Array(data.buffer), size = COMPONENTS[first.type], kind = [...kinds][0];
      const min = Array(size).fill(Infinity), max = Array(size).fill(-Infinity);
      for (let n = 0; n < values.length; n++) {
        const value = Math.round(values[n] / step) * step;
        report.moved[kind] = Math.max(report.moved[kind] ?? 0, Math.abs(value - values[n]));
        values[n] = value; min[n % size] = Math.min(min[n % size], value); max[n % size] = Math.max(max[n % size], value);
      }
      for (const accessor of accessors) if (accessor.min) { accessor.min = min; accessor.max = max; }
      // Stored as whole numbers of grid steps with one exponent per axis:
      // these pack far better than raw floats and unpack to the same floats.
      const stepped = MeshoptEncoder.encodeFilterExp(values, count, stride, 24, 'SharedComponent');
      const check = new Uint8Array(data.length);
      MeshoptDecoder.decodeGltfBuffer(check, count, stride, MeshoptEncoder.encodeGltfBuffer(stepped, count, stride, 'ATTRIBUTES', 0), 'ATTRIBUTES', 'EXPONENTIAL');
      if (same(check, data)) { source = stepped; filter = 'EXPONENTIAL'; }
    }
    const mode = !indices ? 'ATTRIBUTES' : triangles && count % 3 === 0 ? 'TRIANGLES' : 'INDICES';
    const packed = MeshoptEncoder.encodeGltfBuffer(source, count, stride, mode, 0);
    const check = new Uint8Array(data.length);
    MeshoptDecoder.decodeGltfBuffer(check, count, stride, packed, mode, filter ?? 'NONE');
    if (!(mode === 'TRIANGLES' ? sameTriangles(check, data, stride) : same(check, data))) throw new Error(`Buffer view ${i} did not unpack to what was packed`);
    const plainAt = plainLength; plainLength = pad(plainAt + data.length);
    return { ...view, buffer: 1, byteOffset: plainAt, extensions: { ...view.extensions, [EXTENSION]: { buffer: 0, byteOffset: place(packed), byteLength: packed.length, byteStride: stride, count, mode, ...(filter && { filter }) } } };
  });

  const packed = Buffer.alloc(packedLength);
  for (const [at, chunk] of chunks) packed.set(chunk, at);
  // The second buffer is the standard's placeholder for the unpacked data: it has no bytes in the file.
  json.buffers = [{ byteLength: packedLength }, { byteLength: plainLength, extensions: { [EXTENSION]: { fallback: true } } }];
  for (const list of ['extensionsUsed', 'extensionsRequired']) json[list] = [...new Set([...(json[list] ?? []), EXTENSION])];
  const out = writeGlb(json, packed);
  return { bytes: out, ...report, after: out.length };
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  let was = 0, now = 0;
  for (const path of process.argv.length > 2 ? process.argv.slice(2) : MODELS) {
    const original = await readFile(path), result = await compress(original);
    was += result?.before ?? original.length; now += result?.after ?? original.length;
    if (!result) { console.log(`${path}: already compressed (${(original.length / 1e6).toFixed(2)} MB)`); continue; }
    await writeFile(path, result.bytes);
    console.log(`${path}: ${(result.before / 1e6).toFixed(2)} → ${(result.after / 1e6).toFixed(2)} MB (${Math.round(100 - result.after / result.before * 100)}% smaller), vertices moved up to ${((result.moved.POSITION ?? 0) * 1000).toFixed(3)} mm${result.droppedTexcoords ? `, ${result.droppedTexcoords} unused texture-coordinate sets dropped` : ''}`);
  }
  console.log(`Total: ${(was / 1e6).toFixed(2)} → ${(now / 1e6).toFixed(2)} MB`);
}
