import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { assembleNatureLibrary, addPalms, addSynthProps } from '../nature-models.mjs';
import { createDebris } from '../debris.mjs';

const parse = async url => {
  const bytes = await readFile(new URL(url, import.meta.url));
  return { bytes, scene: (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene };
};
const plain = assembleNatureLibrary((await parse('../assets/nature/endless-nature.glb')).scene);
const props = await parse('../assets/nature/synth-props/synth-props.glb');
const library = addSynthProps(addPalms(assembleNatureLibrary((await parse('../assets/nature/endless-nature.glb')).scene), (await parse('../assets/nature/palm-synthwave/palm-trees.glb')).scene), props.scene);
const KINDS = ['cactus', 'rock', 'boulder'];

test('synthwave has a cactus, rock and boulder for each everyday one, the same size, dark with glowing neon', () => {
  const json = JSON.parse(props.bytes.subarray(20, 20 + props.bytes.readUInt32LE(12)).toString());
  assert.ok(json.asset.generator.includes('Blender'));
  assert.equal(json.images?.length ?? 0, 0);
  assert.ok(props.bytes.length < 300 * 1024);
  for (const kind of KINDS) {
    const first = library.synthProps[kind];
    assert.equal(first, plain.variants[kind].length);
    assert.equal(library.variants[kind].length, first * 2);
    library.variants[kind].slice(first).forEach(({ name, geometry, material, bounds, standinColor }, i) => {
      assert.equal(material.name, 'Synth_Glow'); assert.equal(material.vertexColors, true); assert.equal(material.side, THREE.DoubleSide);
      assert.ok(bounds && standinColor, 'far off, a stand-in sized and coloured for it');
      const { position, normal, color } = geometry.attributes;
      assert.equal(position.count, color.count); assert.equal(normal.count, position.count);
      assert.ok(position.count / 3 < 600, `${name}: ${position.count / 3} triangles`);
      assert.ok([...color.array].every(c => c >= 0 && c <= 1));
      // As tall as the everyday model it stands in for, and rooted like it.
      const own = geometry.boundingBox, everyday = plain.variants[kind][i].geometry.boundingBox;
      assert.ok(Math.abs((own.max.y - own.min.y) - (everyday.max.y - everyday.min.y)) < .2, `${name} height`);
      assert.ok(own.min.y > -.2 && own.min.y <= .05, `${name} sits at ground level`);
      let bright = 0, dark = 0;
      for (let k = 0; k < color.count; k++) {
        const peak = Math.max(color.getX(k), color.getY(k), color.getZ(k));
        if (peak > .6) bright++; else if (peak < .1) dark++;
      }
      assert.ok(bright > 60 && dark > 60, `${name}: ${bright} bright, ${dark} dark`);
    });
  }
});

test('only synthwave grows them: everyday choices are unchanged, and each takes its own variant’s place', () => {
  for (let i = -60; i <= 60; i++) for (const type of [...KINDS, 'tree', 'bush']) {
    const prop = { type, x: i * 7.3, z: i * 3.1 }, everyday = plain.variantFor(prop);
    assert.equal(library.variantFor(prop), everyday);
    if (KINDS.includes(type)) assert.equal(library.variantFor(prop, true), library.synthProps[type] + everyday);
  }
});

test('synthwave debris is dark violet with one piece in three neon, which glows', () => {
  const scene = new THREE.Scene(), debris = createDebris(scene), flat = { surface: () => 0 };
  debris.burst({ type: 'rock', x: 0, y: 0, z: 0, size: 1, h: .6, vx: 0, vz: 20 }, true);
  debris.update(0, flat);
  const mesh = scene.children.find(o => o.isInstancedMesh), colorAt = i => { const c = new THREE.Color(); mesh.getColorAt(i, c); return c; };
  const colors = Array.from({ length: mesh.count }, (_, i) => colorAt(i));
  const bright = colors.filter(c => Math.max(c.r, c.g, c.b) > .6).length;
  assert.equal(colors.length, 12); assert.equal(bright, 4);
  assert.ok(colors.every(c => Math.max(c.r, c.g, c.b) > .6 || Math.max(c.r, c.g, c.b) < .05));
  // Everyday debris stays too dark to glow.
  debris.clear(); debris.burst({ type: 'cactus', x: 0, y: 0, z: 0, size: 1, h: 4, vx: 0, vz: 20 }); debris.update(0, flat);
  for (let i = 0; i < mesh.count; i++) { const c = colorAt(i); assert.ok(Math.max(c.r, c.g, c.b) < .3); }
});
