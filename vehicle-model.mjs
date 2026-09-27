import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/environments/RoomEnvironment.js';

export const VEHICLE_URL = new URL('./assets/vehicles/atlas-amphibious.glb?v=amphibious-1', import.meta.url);

// Scrub Blender's authored clip in either direction without replacing meshes.
export function createTransformation(model, clips) {
  const clip = clips.find(c => c.name === 'Transform_To_Boat') ?? clips[0];
  if (!clip) throw new Error('Vehicle asset is missing its transformation animation');
  const mixer = new THREE.AnimationMixer(model), action = mixer.clipAction(clip);
  action.play(); action.paused = true;
  return { duration: clip.duration, update(progress) {
    action.time = THREE.MathUtils.clamp(progress, 0, 1) * clip.duration;
    mixer.update(0);
  } };
}

// Blender owns the geometry, materials, wheel origins and static draw batching.
// The simulation continues to own the pose and collision dimensions in metres.
export async function loadVehicleModel(renderer) {
  const gltf = await new GLTFLoader().loadAsync(VEHICLE_URL.href);
  const model = gltf.scene;
  const required = name => {
    const node = model.getObjectByName(name);
    if (!node) throw new Error(`Vehicle asset is missing ${name}`);
    return node;
  };
  const body = required('Body');
  const wheelPivots = ['FL', 'RL', 'FR', 'RR'].map(name => required(`Wheel_${name}`));
  const wheelSpinners = ['FL', 'RL', 'FR', 'RR'].map(name => required(`Spinner_${name}`));
  const transformation = createTransformation(model, gltf.animations);
  transformation.update(0);
  const materials = new Map();
  let triangles = 0, meshes = 0;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const reflections = pmrem.fromScene(room, .04);
  room.dispose(); pmrem.dispose();
  model.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    node.castShadow = true; node.receiveShadow = true;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      material.envMap = reflections.texture;
      material.envMapIntensity = material.name === 'Smoked_Glass' ? .9 : .45;
      materials.set(material.name, material);
    }
  });
  const headMat = materials.get('Headlamp'), brakeMat = materials.get('Brake_Lamp');
  if (!headMat || !brakeMat) throw new Error('Vehicle asset is missing its working lamp materials');
  return { model, body, wheelPivots, wheelSpinners, headMat, brakeMat, meshes, triangles, transformation,
    batching: [body, ...wheelSpinners].map(group => ({ before: group.userData.sourceParts, after: group.children.filter(o => o.isMesh).length })) };
}
