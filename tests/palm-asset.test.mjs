import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { assembleNatureLibrary, addPalms } from '../nature-models.mjs';
import { createTreeBreakage } from '../tree-breakage.mjs';

const parse = async url => {
  const bytes = await readFile(new URL(url, import.meta.url));
  return { bytes, scene: (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene };
};
const nature = await parse('../assets/nature/endless-nature.glb'), palms = await parse('../assets/nature/palm-synthwave/palm-trees.glb');
const library = addPalms(assembleNatureLibrary(nature.scene), palms.scene);

test('the synthwave palms are three coloured, rooted trees after the others, with neon frond tips', () => {
  const json = JSON.parse(palms.bytes.subarray(20, 20 + palms.bytes.readUInt32LE(12)).toString());
  assert.ok(json.asset.generator.includes('Blender'));
  assert.equal(json.images?.length ?? 0, 0);
  assert.ok(palms.bytes.length < 700 * 1024);
  assert.deepEqual(library.palms, { first: 6, count: 3 });
  assert.equal(library.variants.tree.length, 9);
  // Tall, leaning and young: heights in metres before the world's own scale.
  const heights = [[8.6, 9.8], [7.6, 8.7], [3.9, 4.8]];
  library.variants.tree.slice(6).forEach(({ name, geometry, material }, i) => {
    assert.ok(name.startsWith('Palm_'));
    assert.equal(material.vertexColors, true); assert.equal(material.transparent, false);
    assert.equal(material.side, THREE.DoubleSide, 'each leaflet is one triangle, seen from both sides');
    const { position, normal, color } = geometry.attributes;
    assert.equal(position.count, color.count); assert.equal(normal.count, position.count);
    // Drawn by the thousand, and their GPU cost follows their triangle count.
    assert.ok(position.count / 3 < 900, `${name}: ${position.count / 3} triangles`);
    assert.ok([...color.array].every(c => c >= 0 && c <= 1));
    assert.ok(geometry.boundingBox.min.y > -.05 && geometry.boundingBox.min.y <= .05, 'origin sits at ground level');
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(size.y > heights[i][0] && size.y < heights[i][1], `${name} height ${size.y}`);
    // Mostly near-black, with bright (glowing) frond tips.
    let bright = 0, dark = 0;
    for (let k = 0; k < color.count; k++) {
      const peak = Math.max(color.getX(k), color.getY(k), color.getZ(k));
      if (peak > .6) bright++; else if (peak < .1) dark++;
    }
    assert.ok(bright > 100 && dark > bright * 2, `${name}: ${bright} bright, ${dark} dark`);
  });
});

test('each palm has a far model of about fifty triangles in its own shape and height', () => {
  for (const { name, geometry, standin } of library.variants.tree.slice(6)) {
    assert.ok(standin.attributes.position.count / 3 <= 60, `${name}: ${standin.attributes.position.count / 3} far triangles`);
    assert.ok(standin.hasAttribute('color'));
    const near = geometry.boundingBox, far = standin.boundingBox;
    assert.ok(far.min.y > -.05 && far.min.y <= .05, 'its origin sits at ground level');
    // As tall as the palm, and its crown nearly as wide (the blades reach
    // less far than the leaflets, which have gaps between them).
    assert.ok(Math.abs(far.max.y - near.max.y) < .6, `${name}: ${far.max.y} vs ${near.max.y}`);
    const width = box => Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    assert.ok(width(far) > width(near) * .75 && width(far) <= width(near) * 1.02, `${name}: ${width(far)} vs ${width(near)}`);
  }
});

test('with synthwave on, each pine grows its palm and nothing else changes', () => {
  // Alpine and snow-dusted: tall; windswept: leaning; stunted: young.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(variant => library.variantFor({ type: 'tree', x: 0, z: 0, variant }, true)), [6, 7, 6, 8, 4, 5]);
  for (let i = -30; i <= 30; i++) {
    const prop = { type: 'tree', x: i * 7.123, z: i * 2.819 }, pine = library.variantFor(prop);
    assert.ok(pine < 2); assert.equal(library.variantFor(prop, true), pine === 0 ? 6 : 7);
    assert.equal(library.variantFor({ type: 'bush', x: prop.x, z: prop.z }, true), library.variantFor({ type: 'bush', x: prop.x, z: prop.z }));
  }
});

test('a palm breaks into its six coloured, glowing sections, filling its own outline', () => {
  for (let variant = 6; variant < 9; variant++) {
    const scene = new THREE.Scene(), effect = createTreeBreakage(scene, library.treeSources);
    effect.burst({ x: 0, y: .08, z: 0, turn: 0, size: 1, vx: 0, vz: 83.3, variant });
    effect.update(0, { surface: () => 0 }); scene.updateMatrixWorld(true);
    const active = scene.children.filter(mesh => mesh.count);
    assert.equal(active.length, 6);
    assert.ok(active.every(mesh => mesh.material.vertexColors && mesh.material.name === 'Palm_Glow' && mesh.geometry.hasAttribute('color')));
    const original = new THREE.Mesh(library.variants.tree[variant].geometry);
    const a = new THREE.Box3().setFromObject(original, true), b = new THREE.Box3().setFromObject(scene);
    assert.ok(a.min.distanceTo(b.min) < 1e-5); assert.ok(a.max.distanceTo(b.max) < 1e-5);
  }
});
