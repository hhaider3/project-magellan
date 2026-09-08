import * as THREE from 'three';

// Preserve every triangle of the standing tree, then peel the same geometry
// apart. The initial silhouette is identical, rather than a particle substitute.
function splitGeometry(source) {
  const flat = source.index ? source.toNonIndexed() : source;
  const position = flat.getAttribute('position'), normal = flat.getAttribute('normal');
  const buckets = Array.from({ length: 3 }, () => ({ positions: [], normals: [] }));
  for (let i = 0; i < position.count; i += 3) {
    const x = position.getX(i) + position.getX(i + 1) + position.getX(i + 2);
    const z = position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2);
    const bucket = buckets[Math.min(2, Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI * 2) * 3))];
    for (let j = i; j < i + 3; j++) {
      bucket.positions.push(position.getX(j), position.getY(j), position.getZ(j));
      bucket.normals.push(normal.getX(j), normal.getY(j), normal.getZ(j));
    }
  }
  if (flat !== source) flat.dispose();
  return buckets.filter(b => b.positions.length).map(bucket => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    return { geometry, center };
  });
}

export function createTreeBreakage(scene, sources, capacity = 8) {
  const fragments = sources.flatMap(({ geometry, color }) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .9, side: THREE.DoubleSide });
    return splitGeometry(geometry).map(part => {
      const mesh = new THREE.InstancedMesh(part.geometry, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh);
      return { ...part, mesh };
    });
  });
  const trees = [], dummy = new THREE.Object3D(), root = new THREE.Object3D();
  const axis = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fall = new THREE.Quaternion(), turn = new THREE.Quaternion(), spin = new THREE.Quaternion();
  function burst(prop) {
    if (trees.length >= capacity) trees.shift();
    trees.push({ ...prop, age: 0, fresh: true });
  }
  function update(dt, world) {
    for (let i = trees.length - 1; i >= 0; i--) {
      const tree = trees[i];
      if (tree.fresh) tree.fresh = false; else tree.age += dt;
      if (tree.age >= 3.6) trees.splice(i, 1);
    }
    trees.forEach((tree, index) => {
      const t = tree.age, speed = Math.hypot(tree.vx, tree.vz) || 1;
      axis.set(tree.vz / speed, 0, -tree.vx / speed);
      const bend = Math.min(t / .7, 1);
      fall.setFromAxisAngle(axis, 1.35 * bend * bend);
      turn.setFromAxisAngle(up, tree.turn);
      root.position.set(tree.x, tree.y - .08, tree.z); root.quaternion.copy(fall).multiply(turn); root.scale.setScalar(tree.size); root.updateMatrix();
      // Cracking begins after the initial bend; displacement starts at zero.
      const separation = Math.max(0, t - .28), spread = separation * separation;
      fragments.forEach(({ mesh, center }, part) => {
        dummy.position.copy(center).applyMatrix4(root.matrix);
        const direction = part * 2.399 + tree.turn;
        dummy.position.x += (tree.vx * .025 + Math.cos(direction) * 1.4) * spread;
        dummy.position.z += (tree.vz * .025 + Math.sin(direction) * 1.4) * spread;
        dummy.position.y -= 5 * spread;
        dummy.position.y = Math.max(dummy.position.y, world.surface(dummy.position.x, dummy.position.z) + .16 * tree.size);
        spin.setFromAxisAngle(axis, separation * (part % 3 - 1) * .8);
        dummy.quaternion.copy(root.quaternion).multiply(spin);
        dummy.scale.setScalar(tree.size * Math.min(1, (3.6 - t) / .8)); dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
    });
    for (const { mesh } of fragments) { mesh.count = trees.length; mesh.instanceMatrix.needsUpdate = true; }
  }
  return { burst, update, clear() { trees.length = 0; for (const { mesh } of fragments) mesh.count = 0; }, get count() { return trees.length; } };
}
