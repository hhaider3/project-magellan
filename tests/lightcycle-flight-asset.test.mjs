import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/libs/meshopt_decoder.module.js';
import { createTransformation } from '../vehicle-model.mjs';

test('the shipped Light Cycle unfolds into a plane and retraces the same poses back to the bike', async () => {
  const bytes = await readFile(new URL('../assets/vehicles/light-cycle-rider.glb', import.meta.url));
  const { scene, animations } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const rig = createTransformation(scene, animations, 'Transform_To_Plane');
  assert.ok(Math.abs(rig.duration - 1.6) < 1e-5);
  const size = () => new Box3().setFromObject(scene, true).getSize(new Vector3());
  const pose = () => {
    scene.updateMatrixWorld(true);
    const matrices = [];
    scene.traverse(node => matrices.push(...node.matrixWorld.elements));
    return matrices;
  };
  const bikePose = pose(), bike = size();
  assert.ok(bike.x < .83 && bike.z < 3.47);

  rig.update(.5);
  const halfwayPose = pose(), halfway = size();
  rig.update(1);
  const plane = size();
  assert.ok(plane.x > 4.5 && plane.z > bike.z + .8);
  assert.ok(halfway.x > bike.x && halfway.x < plane.x);
  // The same two axles now point through the horizontal intake and aft exhaust.
  const axle = name => new Vector3(1, 0, 0).transformDirection(scene.getObjectByName(name).matrixWorld);
  assert.ok(Math.abs(axle('Wheel_Front').y) > .999);
  assert.ok(Math.abs(axle('Wheel_Rear').z) > .999);
  const clip = animations.find(clip => clip.name === 'Transform_To_Plane');
  assert.ok(clip.tracks.every(track => !/^(Wheel_|Spinner_|Body\.|Rider\.)/.test(track.name)));

  rig.update(.5);
  assert.deepEqual(pose(), halfwayPose);
  rig.update(0);
  const restored = pose();
  assert.equal(restored.length, bikePose.length);
  assert.ok(restored.every((value, i) => Math.abs(value - bikePose[i]) < 1e-6));
});
