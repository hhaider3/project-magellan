import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { assembleSakura, SAKURA_URL } from './sakura-model.mjs?v=open-start-1';

export const NATURE_URL = new URL('./assets/nature/endless-nature.glb?v=sakura-push-1', import.meta.url);
export const PALM_URL = new URL('./assets/nature/palm-synthwave/palm-trees.glb?v=palm-lean-1', import.meta.url);
export const SYNTH_PROPS_URL = new URL('./assets/nature/synth-props/synth-props.glb?v=synth-props-1', import.meta.url);
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

// One Blender asset from its root (at its ground contact): its meshes merged
// into one geometry, and for a tree, each mesh as a breakable section.
function assembleRoot(scene, name, kind) {
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
  const geometry = mergeParts(parts);
  const fragments = kind === 'tree' ? parts.map(part => {
    const geometry = mergeParts([part]); geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const half = geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
    geometry.translate(-center.x, -center.y, -center.z);
    return { geometry, center, half };
  }) : null;
  for (const part of parts) part.dispose();
  return { geometry, fragments, sections: parts.length };
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
      const { geometry, fragments, sections } = assembleRoot(scene, name, kind);
      if (fragments) treeSources.push({ fragments, color: '#ffffff', vertexColors: true, variant });
      stats.push({ name, kind, triangles: geometry.attributes.position.count / 3, fragments: fragments ? sections : 0 });
      return { name, geometry, material };
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
export function palmMaterial(name = 'Palm_Glow') {
  const material = new THREE.MeshStandardMaterial({ name, color: '#ffffff', vertexColors: true, roughness: .9, side: THREE.DoubleSide });
  const glow = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * smoothstep(.3, .6, max(vColor.r, max(vColor.g, vColor.b))) * 1.6;`);
  };
  material.onBeforeCompile = glow; material.customProgramCacheKey = () => 'palm-glow-1';
  Object.assign(material.userData, { compile: glow, compileKey: 'palm-glow-1' });
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

// Synthwave's cacti, rocks and boulders (scripts/build-synth-props.py), in
// the same glowing material as the palms: each joins its kind after the
// everyday ones, and variantFor(prop, true) gives it in their place. Far off
// they are the everyday stand-ins' shapes in a dark violet.
const SYNTH_PROPS = { cactus: ['Cactus_Synth_Saguaro', 'Cactus_Synth_Forked'], rock: ['Rock_Synth_A', 'Rock_Synth_B'], boulder: ['Boulder_Synth_A', 'Boulder_Synth_B'] };
export function addSynthProps(library, scene) {
  scene.updateMatrixWorld(true);
  const material = palmMaterial('Synth_Glow'), first = {}, standinColor = new THREE.Color('#2a1a48');
  for (const [kind, names] of Object.entries(SYNTH_PROPS)) {
    first[kind] = library.variants[kind].length;
    for (const name of names) {
      const { geometry } = assembleRoot(scene, name, kind);
      library.variants[kind].push({ name, geometry, material, bounds: geometry.boundingBox.clone(), standinColor });
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
  const loader = new GLTFLoader();
  const [nature, sakura, palms, props] = await Promise.all([NATURE_URL, SAKURA_URL, PALM_URL, SYNTH_PROPS_URL].map(url => loader.loadAsync(url.href)));
  return addSynthProps(addPalms(assembleNatureLibrary(nature.scene, new Map([['Sakura_Blossom', assembleSakura(sakura.scene)]])), palms.scene), props.scene);
}
