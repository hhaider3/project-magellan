import * as THREE from 'three';
import { featurePoint } from './world.mjs?v=sandlands-1';

// Three.js BufferGeometry.clone() shares userData with its source. Detach it
// before marking ownership, or the shared template becomes disposable too.
export function cloneOwnedGeometry(source) {
  const geometry = source.clone();
  geometry.userData = { ...source.userData, owned: true };
  return geometry;
}

// A single low-poly mesh per cactus, instanced across each desert chunk.
export function createCactusGeometry() {
  const parts = [];
  const column = (radius, height, x, y, z) => {
    parts.push(new THREE.CylinderGeometry(radius, radius * 1.06, height, 10).translate(x, y + height / 2, z));
    parts.push(new THREE.SphereGeometry(radius, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y + height, z));
  };
  column(.38, 4.3, 0, 0, 0);
  for (const [side, base, rise] of [[-1, 1.65, 1.15], [1, 2.4, 1.3]]) {
    parts.push(new THREE.CylinderGeometry(.24, .24, 1.1, 10).rotateZ(Math.PI / 2).translate(side * .63, base, 0));
    parts.push(new THREE.SphereGeometry(.25, 10, 6).translate(side * 1.15, base, 0));
    column(.24, rise, side * 1.15, base, 0);
  }
  const positions = [], normals = [];
  for (const part of parts) {
    const flat = part.toNonIndexed();
    positions.push(...flat.attributes.position.array); normals.push(...flat.attributes.normal.array);
    flat.dispose(); part.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const materials = {
  timber: new THREE.MeshStandardMaterial({ color: '#806748', roughness: .9 }),
  dark: new THREE.MeshStandardMaterial({ color: '#38433b', roughness: .8 }),
  orange: new THREE.MeshStandardMaterial({ color: '#db853e', roughness: .8 }),
  cream: new THREE.MeshStandardMaterial({ color: '#e9dcaa', roughness: .8 }),
  green: new THREE.MeshStandardMaterial({ color: '#4c7162', roughness: .8 }),
  glass: new THREE.MeshStandardMaterial({ color: '#466b72', metalness: .2, roughness: .35 }),
};
let deckMaterial;
function getDeckMaterial() {
  if (deckMaterial) return deckMaterial;
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = '#bc7542'; g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#553e2c'; for (let y = 0; y < 512; y += 18) g.fillRect(0, y, 256, 2);
  g.fillStyle = '#f1d789'; g.fillRect(6, 0, 10, 512); g.fillRect(240, 0, 10, 512);
  g.strokeStyle = '#f8e5ab'; g.lineWidth = 14;
  for (let y = 125; y < 480; y += 120) { g.beginPath(); g.moveTo(70, y); g.lineTo(128, y - 42); g.lineTo(186, y); g.stroke(); }
  for (let x = 0; x < 256; x += 32) { g.fillStyle = x % 64 ? '#e9c875' : '#343c32'; g.fillRect(x, 0, 32, 22); }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  deckMaterial = new THREE.MeshStandardMaterial({ map, roughness: .9, polygonOffset: true, polygonOffsetFactor: -2 });
  return deckMaterial;
}

export function buildLandmark(feature, world) {
  const group = new THREE.Group(), buckets = new Map();
  const baseY = world.surface(feature.x, feature.z);
  group.position.set(feature.x, baseY, feature.z); group.rotation.y = feature.heading;
  const temp = new THREE.Object3D();
  function box(w, h, d, x, y, z, material = 'timber', rx = 0, ry = 0, rz = 0) {
    temp.position.set(x, y, z); temp.rotation.set(rx, ry, rz); temp.scale.set(w, h, d); temp.updateMatrix();
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(temp.matrix.clone());
  }
  function ground(x, z) { const p = featurePoint(feature, x, z); return world.surface(p.x, p.z) - baseY; }
  function flag(x, z, height = 5.8) {
    const y = ground(x, z);
    box(.13, height, .13, x, y + height / 2, z, 'dark');
    box(1.2, 2.6, .06, x + .6, y + height - 1.4, z, 'orange');
    box(.65, .2, .07, x + .62, y + height - 1, z, 'cream');
    box(.65, .2, .07, x + .62, y + height - 1.65, z, 'cream');
  }
  if (feature.type === 'ramp') {
    const positions = [], uv = [], indices = [], acrossSteps = Math.ceil(feature.width), alongSteps = Math.ceil(feature.length);
    for (let j = 0; j <= alongSteps; j++) for (let i = 0; i <= acrossSteps; i++) {
      const x = (i / acrossSteps - .5) * feature.width, z = j / alongSteps * feature.length;
      positions.push(x, ground(x, z) + .075, z); uv.push(i / acrossSteps, j / alongSteps);
    }
    for (let j = 0; j < alongSteps; j++) for (let i = 0; i < acrossSteps; i++) {
      const a = j * (acrossSteps + 1) + i, b = a + 1, c = a + acrossSteps + 1;
      indices.push(a, c, b, b, c, c + 1);
    }
    const geometry = new THREE.BufferGeometry(); geometry.userData.owned = true;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const deck = new THREE.Mesh(geometry, getDeckMaterial()); deck.receiveShadow = true; group.add(deck);
    for (const side of [-1, 1]) {
      flag(side * (feature.width / 2 + 1), feature.length - .8);
      for (const z of [-20, -10, 0]) {
        const x = side * (feature.width / 2 + 1.5), y = ground(x, z);
        box(.25, 1.2, .25, x, y + .6, z, 'orange');
        box(.29, .25, .29, x, y + .85, z, 'cream');
      }
    }
  } else if (feature.type === 'lookout') {
    const foundation = Math.max(0, ground(-2, -2), ground(2, -2), ground(-2, 2), ground(2, 2));
    for (const x of [-1.7, 1.7]) for (const z of [-1.7, 1.7]) {
      const bottom = ground(x, z), h = foundation + 8 - bottom;
      box(.35, h, .35, x, bottom + h / 2, z);
    }
    for (const x of [-1.7, 1.7]) for (const z of [-.9, .9]) box(.15, 4.3, .15, x, foundation + 3.8, z, 'timber', z > 0 ? -.5 : .5);
    box(4.5, .3, 4.5, 0, foundation + 7.3, 0);
    for (const side of [-1, 1]) {
      box(4.5, .14, .14, 0, foundation + 8.6, side * 2.13, 'cream');
      box(.14, .14, 4.5, side * 2.13, foundation + 8.6, 0, 'cream');
      for (const z of [-2.1, 0, 2.1]) box(.14, 1.2, .14, side * 2.1, foundation + 7.95, z);
    }
    for (const x of [-1.65, 1.65]) for (const z of [-1.65, 1.65]) box(.14, 3, .14, x, foundation + 8.85, z, 'dark');
    for (const side of [-1, 1]) box(2.8, .15, 5.0, side * 1.17, foundation + 10.65, 0, 'orange', 0, 0, side * .3);
    for (const x of [-.5, .5]) box(.11, 8.4, .11, x, foundation + 3.8, -2, 'dark');
    for (let y = .2; y < 7.5; y += .45) box(1.05, .08, .12, 0, foundation + y, -2, 'cream');
    flag(4, 2, 6.2);
  } else {
    const foundation = Math.max(ground(-3, -2), ground(3, -2), ground(-3, 2), ground(3, 2)) + .35;
    box(6.3, .35, 4.7, 0, foundation, 0, 'dark');
    box(5.8, 2.9, 4.2, 0, foundation + 1.55, 0, 'timber');
    for (const side of [-1, 1]) box(3.6, .18, 5.3, side * 1.5, foundation + 3.75, 0, 'green', 0, 0, side * .32);
    box(1.05, 2.05, .1, .9, foundation + 1.2, -2.15, 'dark');
    box(1.5, 1, .11, -1.4, foundation + 1.95, -2.16, 'cream');
    box(1.27, .78, .12, -1.4, foundation + 1.95, -2.17, 'glass');
    box(7.6, .2, 2.4, 0, foundation - .1, -3.1);
    for (const x of [-3.4, 3.4]) box(.15, 3.4, .15, x, foundation + 1.4, -4, 'dark');
    box(7.6, .16, 2.5, 0, foundation + 3, -3.2, 'cream', -.08);
    const tableY = ground(9, -1);
    box(3, .2, 1.4, 9, tableY + 1, -1, 'cream');
    for (const side of [-1, 1]) { box(3.3, .15, .45, 9, tableY + .5, -1 + side * 1.2); box(.17, 1, 2.9, 9 + side, tableY + .48, -1); }
    for (let i = 0; i < 3; i++) box(1.25, 1.25, 1.25, -6.2, ground(-6.2, i * 1.5) + .625, i * 1.5, i === 1 ? 'orange' : 'green');
    flag(-8, -5, 6);
  }
  // Each material is one draw call, regardless of how many beams or boards it uses.
  for (const [name, matrices] of buckets) {
    const mesh = new THREE.InstancedMesh(unitBox, materials[name], matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}
