import * as THREE from './vendor/three.module.js';
// Only batch descendants that are static relative to this animation group.
// Body suspension and each wheel spinner remain separate movable groups.
export function batchStaticMeshes(root) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), groups = new Map(), originals = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material)) return;
    const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, positions: [], normals: [] });
    const group = groups.get(key), geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    group.positions.push(...geometry.attributes.position.array); group.normals.push(...geometry.attributes.normal.array);
    geometry.dispose(); originals.push(mesh);
  });
  for (const mesh of originals) mesh.removeFromParent();
  for (const group of groups.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(group.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(group.normals, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, group.material); mesh.castShadow = group.cast; mesh.receiveShadow = group.receive; root.add(mesh);
  }
  return { before: originals.length, after: groups.size, originalGeometries: new Set(originals.map(mesh => mesh.geometry)) };
}
