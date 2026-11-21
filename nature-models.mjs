import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/libs/meshopt_decoder.module.js';
import { assembleSakura, SAKURA_URL } from './sakura-model.mjs?v=flight-2';

export const NATURE_URL = new URL('./assets/nature/endless-nature.glb?v=packed-1', import.meta.url);
export const PALM_URL = new URL('./assets/nature/palm-synthwave/palm-trees.glb?v=packed-1', import.meta.url);
export const SYNTH_PROPS_URL = new URL('./assets/nature/synth-props/synth-props.glb?v=packed-1', import.meta.url);
const names = {
  tree: ['Pine_Alpine', 'Pine_Windswept', 'Pine_Snow', 'Pine_Stunted', 'Tree_Dead', 'Sakura_Blossom'],
  cactus: ['Cactus_Saguaro', 'Cactus_Forked'],
  rock: ['Rock_Granite', 'Rock_Shale'],
  boulder: ['Boulder_Granite', 'Boulder_Sandstone'],
  bush: ['Bush_Meadow', 'Bush_Desert', 'Bush_Juniper'],
  outcrop: ['Outcrop_Granite', 'Outcrop_Sandstone', 'Outcrop_Slab'],
  scree: ['Scree_Field'],
};
// The world picks the special trees, bushes and outcrops by place
// (prop.variant, numbered as in world.mjs VARIANT and in the order above).
// Without one, a prop's position picks among the everyday variants.
const everyday = { tree: 2, bush: 1 };

function mergeParts(parts) {
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const result = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const data = new Float32Array(count * 3); let at = 0;
    for (const part of parts) {
      const attribute = part.getAttribute(name);
      for (let i = 0; i < attribute.count; i++) {
        data[at++] = attribute.getX(i); data[at++] = attribute.getY(i); data[at++] = attribute.getZ(i);
      }
    }
    result.setAttribute(name, new THREE.BufferAttribute(data, 3));
  }
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

// Light that never reaches in, baked into the vertex colours at load (so the
// breakable sections, made from the same parts, match): each prop darkens
// toward where it meets the ground, and a tree's crown toward its trunk, the
// low inner needles most. Crown normals also lean out and up from the trunk,
// so a pine shades as one rounded mass rather than as separate flat fans
// (trunks, stone and cacti stay faceted). Ground level is y = 0 (outcrops run
// a metre or two below it). Returns the colour the prop shows from afar: its
// plain average, as the far stand-ins have always had it, times how much the
// visible surface darkened (the crown's outside counts, its hidden inside
// hardly at all).
const BASE_SHADE = { tree: [.62, 1.2], cactus: [.7, .8], rock: [.6, .35], boulder: [.58, .9], bush: [.62, .45], outcrop: [.62, 1.2], scree: [.85, .18] };
const shadeStep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function bakeShade(parts, kind) {
  const [darkest, reach] = BASE_SHADE[kind];
  const tree = kind === 'tree', foliage = parts.map(part => {
    const c = part.getAttribute('color'); let r = 0, g = 0;
    for (let i = 0; i < c.count; i++) { r += c.getX(i); g += c.getY(i); }
    return tree && g > r; // green needles; the trunk and a snag's bare limbs are brown
  });
  let top = 0, low = Infinity, high = -Infinity;
  parts.forEach((part, k) => {
    const p = part.getAttribute('position');
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); top = Math.max(top, y); if (foliage[k]) { low = Math.min(low, y); high = Math.max(high, y); } }
  });
  // The trunk's line (pines lean) and the crown's reach, per height band.
  const BANDS = 24, band = y => Math.min(BANDS - 1, Math.max(0, Math.floor(y / top * BANDS)));
  const axis = Array.from({ length: BANDS }, () => [0, 0, 0]), spread = new Float32Array(BANDS);
  const crowned = foliage.some(Boolean);
  if (crowned) {
    parts.forEach((part, k) => {
      if (foliage[k]) return;
      const p = part.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const a = axis[band(p.getY(i))]; a[0] += p.getX(i); a[1] += p.getZ(i); a[2]++; }
    });
    let last = null;
    for (const a of axis) if (a[2]) { a[0] /= a[2]; a[1] /= a[2]; last = a; } else if (last) { a[0] = last[0]; a[1] = last[1]; }
    const first = axis.find(a => a[2]);
    for (const a of axis) { if (a[2]) break; a[0] = first[0]; a[1] = first[1]; }
    parts.forEach((part, k) => {
      if (!foliage[k]) return;
      const p = part.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const b = band(p.getY(i)), a = axis[b]; spread[b] = Math.max(spread[b], Math.hypot(p.getX(i) - a[0], p.getZ(i) - a[1])); }
    });
  }
  const reachAt = b => Math.max(spread[b], spread[Math.max(0, b - 1)] * .85, spread[Math.min(BANDS - 1, b + 1)] * .85);
  const floor = tree ? top * .3 : -Infinity, plain = [0, 0, 0];
  let seen = 0, shadeSeen = 0, counted = 0;
  parts.forEach((part, k) => {
    const p = part.getAttribute('position'), n = part.getAttribute('normal'), c = part.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y >= floor) { plain[0] += c.getX(i); plain[1] += c.getY(i); plain[2] += c.getZ(i); counted++; }
      let shade = darkest + (1 - darkest) * shadeStep(0, reach, y), open = 1;
      if (crowned) {
        const b = band(y), a = axis[b], dx = x - a[0], dz = z - a[1], r = Math.hypot(dx, dz), out = reachAt(b);
        if (y >= low && out > .05) {
          // Inside the crown: dark by the trunk, open at the tips, and more
          // open toward the top, which sees more of the sky.
          open = Math.min(1, r / out);
          const t = Math.min(1, Math.max(0, (y - low) / (high - low)));
          shade *= 1 - (1 - (.5 + .5 * shadeStep(.1, .95, open))) * (1 - .45 * t);
        } else if (y < low) shade *= .85; // the trunk beneath the canopy
        if (foliage[k] && r > 1e-4) {
          let nx = dx / r, ny = .55, nz = dz / r; const l = Math.hypot(nx, ny, nz);
          nx = n.getX(i) * .4 + nx / l * .6; ny = n.getY(i) * .4 + ny / l * .6; nz = n.getZ(i) * .4 + nz / l * .6;
          const m = Math.hypot(nx, ny, nz) || 1; n.setXYZ(i, nx / m, ny / m, nz / m);
        }
      }
      c.setXYZ(i, c.getX(i) * shade, c.getY(i) * shade, c.getZ(i) * shade);
      // Seen from afar: a crown's outside, and mostly the tops of stones and
      // bushes (whose shaded feet are a thin line at that distance).
      if (y >= floor && y > 0) { const up = (.5 + .5 * n.getY(i)) ** (crowned ? 2 : 4), w = open * open * up * (crowned ? 1 : (y / top) ** 2); seen += w; shadeSeen += shade * w; }
    }
  });
  const dim = seen > 0 ? shadeSeen / seen : 1;
  return new THREE.Color(plain[0] / counted * dim, plain[1] / counted * dim, plain[2] / counted * dim);
}

// One Blender asset from its root (at its ground contact): its meshes merged
// into one geometry, and for a tree, each mesh as a breakable section. With
// shade, the everyday models get their baked shading (bakeShade) and a far colour.
function assembleRoot(scene, name, kind, shade = false) {
  const root = scene.getObjectByName(name);
  if (!root) throw new Error(`Scenery asset is missing ${name}`);
  const inverse = root.matrixWorld.clone().invert(), parts = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    if (!geometry.hasAttribute('color')) throw new Error(`${name} is missing its vertex colors`);
    parts.push(geometry);
  });
  if (!parts.length) throw new Error(`${name} contains no geometry`);
  const farColor = shade ? bakeShade(parts, kind) : null;
  const geometry = mergeParts(parts);
  const fragments = kind === 'tree' ? parts.map(part => {
    const geometry = mergeParts([part]); geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const half = geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
    geometry.translate(-center.x, -center.y, -center.z);
    return { geometry, center, half };
  }) : null;
  for (const part of parts) part.dispose();
  return { geometry, fragments, sections: parts.length, farColor };
}
const disposeScene = scene => scene.traverse(node => {
  if (!node.isMesh) return;
  node.geometry.dispose();
  for (const mat of Array.isArray(node.material) ? node.material : [node.material]) mat.dispose();
});

// This pure assembly step is shared by the game, visual preview and asset tests.
export function assembleNatureLibrary(scene, treeOverrides = new Map()) {
  scene.updateMatrixWorld(true);
  const variants = {}, treeSources = [], stats = [];
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .94 });
  for (const [kind, list] of Object.entries(names)) {
    variants[kind] = list.map((name, variant) => {
      const replacement = kind === 'tree' ? treeOverrides.get(name) : null;
      if (replacement) {
        treeSources.push({ ...replacement.treeSource, variant });
        stats.push({ name: replacement.name, kind, triangles: replacement.triangles, fragments: replacement.treeSource.fragments.length });
        return replacement;
      }
      const { geometry, fragments, sections, farColor } = assembleRoot(scene, name, kind, true);
      if (fragments) treeSources.push({ fragments, color: '#ffffff', vertexColors: true, variant });
      stats.push({ name, kind, triangles: geometry.attributes.position.count / 3, fragments: fragments ? sections : 0 });
      return { name, geometry, material, farColor };
    });
  }
  // Layout transforms exist only for the Blender studio. Runtime instances use
  // each model's ground origin, and keep the world's existing seeded transforms.
  disposeScene(scene);
  // The models added after this (synthwave's) are never everyday ones.
  const counts = Object.fromEntries(Object.entries(variants).map(([kind, list]) => [kind, list.length]));
  function variantFor(prop) {
    const count = counts[prop.type] ?? 1;
    if (prop.variant !== undefined && prop.variant >= 0) return Math.min(prop.variant, count - 1);
    const pool = Math.min(count, everyday[prop.type] ?? count);
    const seed = Math.imul(Math.round(prop.x * 8), 73856093) ^ Math.imul(Math.round(prop.z * 8), 19349663);
    return (seed >>> 0) % pool;
  }
  return { variants, treeSources, material, stats, variantFor };
}

// The synthwave palms (scripts/build-palm.py): near-black, with neon frond
// tips. Their material makes those bright vertex colours glow and leaves the
// dark ones be; scenery shaders add their own work to it (userData.compile).
// Double-sided: each leaflet is a single triangle.
const PALMS = ['Palm_Tall', 'Palm_Leaning', 'Palm_Young'];
// The palm in each pine's place: alpine and snow-dusted tall, windswept
// leaning, the stunted treeline pine a young palm.
const PALM_FOR_PINE = [0, 1, 0, 2];
// How brightly a vertex colour glows in that material (and in glowLook).
const GLOW_FROM = .3, GLOW_FULL = .6, GLOW_GAIN = 1.6;
export function palmMaterial(name = 'Palm_Glow') {
  const material = new THREE.MeshStandardMaterial({ name, color: '#ffffff', vertexColors: true, roughness: .9, side: THREE.DoubleSide });
  const glow = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * smoothstep(${GLOW_FROM}, ${GLOW_FULL}, max(vColor.r, max(vColor.g, vColor.b))) * ${GLOW_GAIN};`);
  };
  material.onBeforeCompile = glow; material.customProgramCacheKey = () => 'palm-glow-1';
  Object.assign(material.userData, { compile: glow, compileKey: 'palm-glow-1', glow: true }); // (glow: no per-prop tint)
  return material;
}
// The palms join the trees as the variants after the rest (6–8), each with
// its far model (standin: one geometry, in the palm's own metres). The world
// never picks them; variantFor(prop, true) gives a pine's palm instead, as
// the synthwave look grows them.
export function addPalms(library, scene) {
  scene.updateMatrixWorld(true);
  const first = library.variants.tree.length, material = palmMaterial(), breaking = palmMaterial();
  PALMS.forEach((name, i) => {
    const { geometry, fragments } = assembleRoot(scene, name, 'tree'), standin = assembleRoot(scene, `${name}_Far`, 'standin').geometry;
    library.variants.tree.push({ name, geometry, material, standin });
    library.treeSources.push({ fragments, vertexColors: true, variant: first + i, material: breaking });
    library.stats.push({ name, kind: 'tree', triangles: geometry.attributes.position.count / 3, fragments: fragments.length });
  });
  disposeScene(scene);
  const variantFor = library.variantFor;
  library.variantFor = (prop, synthwave = false) => {
    const variant = variantFor(prop);
    return synthwave && prop.type === 'tree' && variant < PALM_FOR_PINE.length ? first + PALM_FOR_PINE[variant] : variant;
  };
  library.palms = { first, count: PALMS.length };
  return library;
}

// What a glowing model looks like from far enough off that its neon lines
// are thinner than a pixel: its colour and its glow, each averaged over its
// surface (the faces seen from above or the side, not its underside). Far
// stand-ins take these, so a prop neither lights up nor dims as it swaps.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function glowLook(geometry) {
  const position = geometry.getAttribute('position'), color = geometry.getAttribute('color'), index = geometry.index;
  const at = k => index ? index.getX(k) : k, count = index ? index.count : position.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), sum = [0, 0, 0], glow = [0, 0, 0];
  let total = 0;
  for (let t = 0; t < count; t += 3) {
    const [i, j, k] = [at(t), at(t + 1), at(t + 2)];
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, j).sub(a); c.fromBufferAttribute(position, k).sub(a);
    const normal = b.cross(c), area = normal.length() / 2;
    if (area < 1e-9 || normal.y / (2 * area) < -.5) continue;
    total += area;
    for (const v of [i, j, k]) {
      const rgb = [color.getX(v), color.getY(v), color.getZ(v)], lit = smooth(GLOW_FROM, GLOW_FULL, Math.max(...rgb)) * GLOW_GAIN;
      for (let n = 0; n < 3; n++) { sum[n] += rgb[n] * area / 3; glow[n] += rgb[n] * lit * area / 3; }
    }
  }
  return { color: new THREE.Color(...sum.map(v => v / total)), glow: new THREE.Color(...glow.map(v => v / total)) };
}

// Synthwave's cacti, rocks and boulders (scripts/build-synth-props.py), in
// the same glowing material as the palms: each joins its kind after the
// everyday ones, and variantFor(prop, true) gives it in their place. Far off
// they are the everyday stand-ins' shapes, coloured and glowing as the model
// does on average (glowLook).
const SYNTH_PROPS = { cactus: ['Cactus_Synth_Saguaro', 'Cactus_Synth_Forked'], rock: ['Rock_Synth_A', 'Rock_Synth_B'], boulder: ['Boulder_Synth_A', 'Boulder_Synth_B'] };
export function addSynthProps(library, scene) {
  scene.updateMatrixWorld(true);
  const material = palmMaterial('Synth_Glow'), first = {};
  for (const [kind, names] of Object.entries(SYNTH_PROPS)) {
    first[kind] = library.variants[kind].length;
    for (const name of names) {
      const { geometry } = assembleRoot(scene, name, kind), far = glowLook(geometry);
      library.variants[kind].push({ name, geometry, material, bounds: geometry.boundingBox.clone(), standinColor: far.color, standinGlow: far.glow });
      library.stats.push({ name, kind, triangles: geometry.attributes.position.count / 3, fragments: 0 });
    }
  }
  disposeScene(scene);
  const variantFor = library.variantFor;
  library.variantFor = (prop, synthwave = false) => {
    const variant = variantFor(prop, synthwave);
    return synthwave && first[prop.type] !== undefined && variant < first[prop.type] ? first[prop.type] + Math.min(variant, SYNTH_PROPS[prop.type].length - 1) : variant;
  };
  library.synthProps = first;
  return library;
}

export async function loadNatureLibrary() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // the models are packed (scripts/compress-models.mjs)
  const [nature, sakura, palms, props] = await Promise.all([NATURE_URL, SAKURA_URL, PALM_URL, SYNTH_PROPS_URL].map(url => loader.loadAsync(url.href)));
  return addSynthProps(addPalms(assembleNatureLibrary(nature.scene, new Map([['Sakura_Blossom', assembleSakura(sakura.scene)]])), palms.scene), props.scene);
}
