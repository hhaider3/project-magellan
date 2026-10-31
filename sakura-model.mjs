import * as THREE from 'three';
import { SAKURA_HEIGHT } from './world.mjs?v=open-start-1';

export const SAKURA_URL = new URL('./assets/nature/sakura-realistic/sakura-tree.glb?v=sakura-shore-1', import.meta.url);
const MESH_NAMES = ['Sakura_Trunk_Branches', 'Sakura_Blossom_Canopy'];

// Mipmaps that keep a cut-out texture's coverage. Averaged as usual, alpha
// thins out level by level, more and more of it falls under the cut-off,
// and a blossom crown seen from afar fades to bare branches. Here each
// level's alpha is scaled so as many of its texels pass the cut-off as of
// the full-size texture's (colours averaged by alpha, so empty texels don't
// darken the edges). texture: an image texture, or a data texture with
// RGBA bytes. Without a canvas (in Node) the texture is left as it is.
export function keepCoverage(texture, cutoff) {
  let width = texture.image?.width, height = texture.image?.height, data = texture.image?.data;
  if (!width || !height) return texture;
  if (!data) {
    if (typeof OffscreenCanvas === 'undefined') return texture;
    const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    context.drawImage(texture.image, 0, 0); data = context.getImageData(0, 0, width, height).data;
  }
  const covered = (pixels, scale) => { let n = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] * scale >= cutoff * 255) n++; return n / (pixels.length / 4); };
  const target = covered(data, 1), image = (pixels, w, h) => texture.isDataTexture || typeof ImageData === 'undefined' ? { data: pixels, width: w, height: h } : new ImageData(pixels, w, h);
  const mipmaps = [image(Uint8ClampedArray.from(data), width, height)];
  let level = Float32Array.from(data);
  while (width > 1 || height > 1) {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), next = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, plain = [0, 0, 0];
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = (Math.min(height - 1, y * 2 + dy) * width + Math.min(width - 1, x * 2 + dx)) * 4, alpha = level[i + 3];
        r += level[i] * alpha; g += level[i + 1] * alpha; b += level[i + 2] * alpha; a += alpha;
        plain[0] += level[i]; plain[1] += level[i + 1]; plain[2] += level[i + 2];
      }
      const o = (y * w + x) * 4;
      if (a > 0) { next[o] = r / a; next[o + 1] = g / a; next[o + 2] = b / a; } else { next[o] = plain[0] / 4; next[o + 1] = plain[1] / 4; next[o + 2] = plain[2] / 4; }
      next[o + 3] = a / 4;
    }
    // The alpha scale that restores the coverage (a short bisection).
    let lo = 0, hi = 16;
    for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (covered(next, mid) < target) lo = mid; else hi = mid; }
    const scaled = new Uint8ClampedArray(next.length);
    for (let i = 0; i < next.length; i += 4) { scaled[i] = next[i]; scaled[i + 1] = next[i + 1]; scaled[i + 2] = next[i + 2]; scaled[i + 3] = next[i + 3] * hi; }
    mipmaps.push(image(scaled, w, h));
    level = next; width = w; height = h;
  }
  texture.mipmaps = mipmaps; texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.needsUpdate = true;
  return texture;
}

// Keep each closed branch tube and each complete blossom card intact. glTF
// duplicates vertices at UV/normal seams, so weld only connectivity by position;
// the actual exported vertices, normals and texture coordinates stay unchanged.
function componentGroups(geometry) {
  const position = geometry.getAttribute('position');
  const parents = Array.from({ length: position.count }, (_, i) => i);
  const find = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const join = (a, b) => { parents[find(a)] = find(b); };
  const at = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(n => Math.round(n * 1e6)).join(',');
    if (at.has(key)) join(i, at.get(key)); else at.set(key, i);
  }
  const indices = geometry.index?.array ?? Uint32Array.from({ length: position.count }, (_, i) => i);
  for (let i = 0; i < indices.length; i += 3) { join(indices[i], indices[i + 1]); join(indices[i], indices[i + 2]); }
  const components = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const id = find(indices[i]);
    if (!components.has(id)) components.set(id, []);
    components.get(id).push(indices[i], indices[i + 1], indices[i + 2]);
  }
  const groups = Array.from({ length: 6 }, () => []);
  const point = new THREE.Vector3();
  for (const vertices of components.values()) {
    const box = new THREE.Box3();
    for (const i of vertices) box.expandByPoint(point.fromBufferAttribute(position, i));
    const center = box.getCenter(new THREE.Vector3());
    const group = box.min.y < .35 ? 0 : 1 + Math.min(4, Math.floor((Math.atan2(center.z, center.x) + Math.PI) / (Math.PI * 2) * 5));
    groups[group].push(...vertices);
  }
  return groups.map(indices => {
    if (!indices.length) return null;
    const part = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const values = new Float32Array(indices.length * attribute.itemSize);
      indices.forEach((source, target) => {
        for (let k = 0; k < attribute.itemSize; k++) values[target * attribute.itemSize + k] = attribute.array[source * attribute.itemSize + k];
      });
      part.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    part.computeBoundingBox();
    return part;
  });
}

export function assembleSakura(scene, height = SAKURA_HEIGHT) {
  scene.updateMatrixWorld(true);
  const parts = MESH_NAMES.map(name => {
    const node = scene.getObjectByName(name);
    if (!node?.isMesh) throw new Error(`Sakura asset is missing ${name}`);
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    // Runtime scenery shader mutates these materials, while debris keeps clean
    // copies with the same maps, UVs, alpha cutoff and double-sided blossoms.
    // The blossom asks for KHR_materials_specular, which three.js builds as a
    // MeshPhysicalMaterial: its costliest shader, run on every layer of the
    // cut-out canopy. A standard material looks the same on these rough
    // petals. The bark is closed tubes, so its inside faces are never seen.
    const source = node.material, wood = name === 'Sakura_Trunk_Branches';
    // Far off the crown keeps its blossom (keepCoverage), as its stand-in does.
    if (!wood && source.map && source.alphaTest > 0) keepCoverage(source.map, source.alphaTest);
    const material = new THREE.MeshStandardMaterial({ name: source.name, map: source.map, color: source.color, roughness: source.roughness, metalness: 0,
      alphaTest: source.alphaTest, side: wood ? THREE.FrontSide : source.side });
    material.alphaToCoverage = material.alphaTest > 0;
    // The bark's shadow gets a depth material of its own. Left to three.js,
    // it shares one with every other untextured caster and lends it its
    // texture, and that material's shader is rebuilt only when some other
    // setting changes: whether the textured version gets built while loading
    // depends on the order things happen to be drawn in, and when it doesn't,
    // it's built in the frame the first cherry comes into the sun's shadow
    // range (a 50 ms stall). Used only by bark, this one never varies, so it
    // is built once, at load, with the rest.
    const depthMaterial = wood ? new THREE.MeshDepthMaterial({ name: `${source.name} shadow`, depthPacking: THREE.RGBADepthPacking }) : undefined;
    geometry.computeBoundingBox();
    return { name, geometry, material, depthMaterial };
  });
  const bounds = new THREE.Box3();
  for (const part of parts) bounds.union(part.geometry.boundingBox);
  const scale = height / (bounds.max.y - bounds.min.y), bottom = bounds.min.y;
  bounds.makeEmpty();
  for (const part of parts) {
    part.geometry.translate(0, -bottom, 0).scale(scale, scale, scale);
    part.geometry.computeBoundingBox(); part.geometry.computeBoundingSphere(); bounds.union(part.geometry.boundingBox);
  }
  const groups = parts.map(part => componentGroups(part.geometry));
  const fragments = [];
  for (let group = 0; group < 6; group++) {
    const box = new THREE.Box3();
    for (const set of groups) if (set[group]) box.union(set[group].boundingBox);
    if (box.isEmpty()) continue;
    const center = box.getCenter(new THREE.Vector3());
    for (let i = 0; i < parts.length; i++) {
      const geometry = groups[i][group];
      if (!geometry) continue;
      geometry.translate(-center.x, -center.y, -center.z); geometry.computeBoundingBox();
      // Both surfaces rotate about the same branch-group pivot. A conservative
      // half-extent about that pivot keeps offset pieces above the terrain.
      const b = geometry.boundingBox;
      const half = new THREE.Vector3(Math.max(Math.abs(b.min.x), Math.abs(b.max.x)), Math.max(Math.abs(b.min.y), Math.abs(b.max.y)), Math.max(Math.abs(b.min.z), Math.abs(b.max.z)));
      fragments.push({ geometry, center: center.clone(), half, material: parts[i].material.clone(), depthMaterial: parts[i].depthMaterial, motionGroup: group });
    }
  }
  const triangles = parts.reduce((n, p) => n + (p.geometry.index?.count ?? p.geometry.attributes.position.count) / 3, 0);
  // Only the static tree is instanced in the game. Its existing GPU petal
  // effect handles nearby trees and stops emitting for broken props.
  scene.traverse(node => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
  return { name: 'Sakura_Realistic', parts, bounds, standinColor: new THREE.Color('#e9c9cf'), triangles, treeSource: { fragments, variant: 5 } };
}
