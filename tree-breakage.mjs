import * as THREE from 'three';

// Cut solid height sections, closing each cut face. Cone skins alone become
// thin sheets when separated; these remain logs and three-dimensional foliage.
function splitGeometry(source) {
  const flat = source.index ? source.toNonIndexed() : source;
  flat.computeBoundingBox();
  const p = flat.getAttribute('position'), n = flat.getAttribute('normal');
  const bottom = flat.boundingBox.min.y, height = flat.boundingBox.max.y - bottom;
  const fragments = [];
  for (let section = 0; section < 3; section++) {
    const lo = bottom + height * section / 3, hi = bottom + height * (section + 1) / 3;
    const positions = [], normals = [], cuts = [new Map(), new Map()];
    const vertex = i => ({ x: p.getX(i), y: p.getY(i), z: p.getZ(i), nx: n.getX(i), ny: n.getY(i), nz: n.getZ(i) });
    const emit = v => { positions.push(v.x, v.y, v.z); const length = Math.hypot(v.nx, v.ny, v.nz) || 1; normals.push(v.nx / length, v.ny / length, v.nz / length); };
    function clip(poly, y, above, boundary) {
      const result = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const insideA = above ? a.y >= y : a.y <= y, insideB = above ? b.y >= y : b.y <= y;
        if (insideA) result.push(a);
        if (insideA !== insideB) {
          const t = (y - a.y) / (b.y - a.y), v = {};
          for (const key of ['x', 'y', 'z', 'nx', 'ny', 'nz']) v[key] = a[key] + (b[key] - a[key]) * t;
          v.y = y; result.push(v); cuts[boundary].set(`${Math.round(v.x * 1e6)},${Math.round(v.z * 1e6)}`, v);
        }
      }
      return result;
    }
    for (let i = 0; i < p.count; i += 3) {
      const poly = clip(clip([vertex(i), vertex(i + 1), vertex(i + 2)], lo, true, 0), hi, false, 1);
      for (let j = 1; j < poly.length - 1; j++) { emit(poly[0]); emit(poly[j]); emit(poly[j + 1]); }
    }
    cuts.forEach((cut, boundary) => {
      if (cut.size < 3) return;
      const ring = [...cut.values()], center = { x: 0, y: boundary ? hi : lo, z: 0, nx: 0, ny: boundary ? 1 : -1, nz: 0 };
      for (const v of ring) { center.x += v.x / ring.length; center.z += v.z / ring.length; }
      ring.sort((a, b) => Math.atan2(a.z - center.z, a.x - center.x) - Math.atan2(b.z - center.z, b.x - center.x));
      for (let i = 0; i < ring.length; i++) {
        const a = { ...ring[i], nx: 0, ny: center.ny, nz: 0 }, b = { ...ring[(i + 1) % ring.length], nx: 0, ny: center.ny, nz: 0 };
        emit(center); emit(boundary ? b : a); emit(boundary ? a : b);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3()), half = geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
    geometry.translate(-center.x, -center.y, -center.z);
    fragments.push({ geometry, center, half });
  }
  if (flat !== source) flat.dispose();
  return fragments;
}

export function createTreeBreakage(scene, sources, capacity = 8) {
  const fragments = sources.flatMap(({ geometry, color, fragments: authored, vertexColors = false, variant }) => {
    const material = new THREE.MeshStandardMaterial({ color, vertexColors, roughness: .94 });
    // Imported Blender trees supply closed sections made from the exact tree
    // geometry. This preserves branch gaps, silhouette and vertex colors.
    return (authored || splitGeometry(geometry)).map(part => {
      const mesh = new THREE.InstancedMesh(part.geometry, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh);
      return { ...part, mesh, variant };
    });
  });
  const trees = [], dummy = new THREE.Object3D(), root = new THREE.Object3D();
  const axis = new THREE.Vector3(), spin = new THREE.Quaternion();
  function burst(prop) {
    if (trees.length >= capacity) trees.shift();
    trees.push({ ...prop, age: 0 });
  }
  function update(dt, world) {
    for (let i = trees.length - 1; i >= 0; i--) { trees[i].age += dt; if (trees[i].age >= 2.8) trees.splice(i, 1); }
    for (const { mesh } of fragments) mesh.count = 0;
    trees.forEach(tree => {
      const t = tree.age, speed = Math.hypot(tree.vx, tree.vz), force = Math.min(1.7, Math.max(.65, speed / 45));
      // A 20 ms onset keeps the source shape at contact while opening visible
      // gaps in the next few frames. Faster impacts separate more forcefully.
      const travel = t - .02 * (1 - Math.exp(-t / .02));
      root.position.set(tree.x, tree.y - .08, tree.z); root.rotation.set(0, tree.turn, 0); root.scale.setScalar(tree.size); root.updateMatrix();
      fragments.forEach(({ mesh, center, half, variant }, part) => {
        if (variant !== undefined && variant !== tree.variant) return;
        const direction = part * 2.399 + tree.turn;
        dummy.position.copy(center).applyMatrix4(root.matrix);
        dummy.position.x += (tree.vx * (.23 + (part % 3) * .07) + Math.cos(direction) * 8 * force) * travel;
        dummy.position.z += (tree.vz * (.23 + (part % 3) * .07) + Math.sin(direction) * 8 * force) * travel;
        dummy.position.y += (3 + part % 3 * 1.8) * force * travel - 9 * t * t;
        axis.set(Math.cos(direction), .35, Math.sin(direction)).normalize();
        spin.setFromAxisAngle(axis, Math.min(travel, 1.1) * (2 + part % 3) * force);
        dummy.quaternion.copy(root.quaternion).multiply(spin);
        dummy.scale.setScalar(tree.size * Math.min(1, (2.8 - t) / .65)); dummy.updateMatrix();
        const e = dummy.matrix.elements, extentY = Math.abs(e[1]) * half.x + Math.abs(e[5]) * half.y + Math.abs(e[9]) * half.z;
        dummy.position.y = Math.max(dummy.position.y, world.surface(dummy.position.x, dummy.position.z) + extentY);
        dummy.updateMatrix(); mesh.setMatrixAt(mesh.count++, dummy.matrix);
      });
    });
    for (const { mesh } of fragments) mesh.instanceMatrix.needsUpdate = true;
  }
  return { burst, update, clear() { trees.length = 0; for (const { mesh } of fragments) mesh.count = 0; }, get count() { return trees.length; } };
}
