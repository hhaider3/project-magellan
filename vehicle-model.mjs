import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/environments/RoomEnvironment.js';
import { SYNTHWAVE } from './synthwave.mjs?v=synth-1';

export const VEHICLE_URLS = {
  atlas: new URL('./assets/vehicles/atlas-amphibious.glb?v=tail-1', import.meta.url),
  roadster: new URL('./assets/vehicles/roadster-rocket.glb?v=roadster-5', import.meta.url),
};
export const VEHICLE_URL = VEHICLE_URLS.atlas;
export const VEHICLE_NAMES = { atlas: 'ATLAS', roadster: 'Roadster' };

// Parts that exist only in one form. While that form is fully stowed they sit
// inside the body, so they are hidden to keep car-mode draw calls unchanged.
const FORM_ONLY = {
  Transform_To_Boat: /^(Pontoon_|Keel_Deploy|Bridge_Deck|Jet_)/,
  Transform_To_Plane: /^(WingSeg1_|TailBoom1_|Prop_Hub)/,
};
// Scrub one of Blender's authored clips in either direction without replacing
// meshes. The boat and plane clips animate separate nodes, so both can apply.
export function createTransformation(model, clips, name = 'Transform_To_Boat') {
  const clip = clips.find(c => c.name === name);
  if (!clip) throw new Error(`Vehicle asset is missing its ${name} animation`);
  const mixer = new THREE.AnimationMixer(model), action = mixer.clipAction(clip);
  action.play(); action.paused = true;
  const stowable = [];
  model.traverse(node => { if (FORM_ONLY[name]?.test(node.name)) stowable.push(node); });
  return { duration: clip.duration, stowable, update(progress) {
    progress = THREE.MathUtils.clamp(progress, 0, 1);
    action.time = progress * clip.duration;
    mixer.update(0);
    for (const node of stowable) node.visible = progress > 0;
  } };
}

// The Roadster's nozzle mouths: Blender empties whose 'thrust' extra is the
// gas direction in model axes. Grouped as the game fires them.
export function thrusterNozzles(model) {
  const nozzles = { rear: [], lift: [], yawL: [], yawR: [] };
  model.traverse(node => {
    const match = /^Exhaust_(Rear|Lift|Yaw)_(\w+)$/.exec(node.name);
    if (!match) return;
    const group = match[1] === 'Yaw' ? (match[2] === 'L' ? 'yawL' : 'yawR') : match[1].toLowerCase();
    nozzles[group].push({ node, thrust: new THREE.Vector3().fromArray(node.userData.thrust), radius: node.userData.exitRadius });
  });
  return nozzles;
}

// Synthwave's sky for the paint and glass to reflect, alike all round:
// indigo overhead to hot pink at the horizon, and the dark land below
// glowing magenta toward it, as its far grid does.
function synthwaveRoom() {
  const room = new THREE.Scene(), color = name => ({ value: new THREE.Color(SYNTHWAVE[name]) });
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uHorizon: color('horizon'), uLow: color('low'), uMid: color('mid'), uHigh: color('high'), uZenith: color('zenith'), uFloor: color('floor'), uGrid: color('gridLow') },
    vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uHorizon, uLow, uMid, uHigh, uZenith, uFloor, uGrid; varying vec3 vDir;
      void main(){ float y=normalize(vDir).y, up=max(y,0.0);
        vec3 sky=mix(mix(mix(mix(uHorizon,uLow,smoothstep(0.0,.12,up)),uMid,smoothstep(.08,.34,up)),uHigh,smoothstep(.26,.6,up)),uZenith,smoothstep(.5,1.0,up));
        vec3 land=mix(uGrid*.35,uFloor*.15,smoothstep(0.0,-.2,y));
        gl_FragColor=vec4(y>0.0?sky:land,1.0); }`,
  });
  room.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), material));
  room.dispose = () => { material.dispose(); room.children[0].geometry.dispose(); };
  return room;
}
// What the paint and glass reflect: a soft studio room ('studio'), or the
// synthwave sky ('synthwave').
function bakeReflections(renderer, look) {
  const pmrem = new THREE.PMREMGenerator(renderer), room = look === 'synthwave' ? synthwaveRoom() : new RoomEnvironment();
  const reflections = pmrem.fromScene(room, .04);
  room.dispose(); pmrem.dispose();
  return reflections;
}

// Blender owns the geometry, materials, wheel origins and static draw batching.
// The simulation continues to own the pose and collision dimensions in metres.
// kind: 'atlas' (with its boat and plane clips and propeller) or 'roadster'
// (with thruster nozzles instead); look: what it reflects (see bakeReflections).
export async function loadVehicleModel(renderer, kind = 'atlas', look = 'studio') {
  const gltf = await new GLTFLoader().loadAsync(VEHICLE_URLS[kind].href);
  const model = gltf.scene;
  const required = name => {
    const node = model.getObjectByName(name);
    if (!node) throw new Error(`Vehicle asset is missing ${name}`);
    return node;
  };
  const body = required('Body');
  const wheelPivots = ['FL', 'RL', 'FR', 'RR'].map(name => required(`Wheel_${name}`));
  const wheelSpinners = ['FL', 'RL', 'FR', 'RR'].map(name => required(`Spinner_${name}`));
  const atlas = kind === 'atlas';
  const transformation = atlas ? createTransformation(model, gltf.animations) : null;
  const flight = atlas ? createTransformation(model, gltf.animations, 'Transform_To_Plane') : null;
  transformation?.update(0); flight?.update(0);
  // Not animated by the clip: the game spins it about the shaft (model +Z).
  const propeller = atlas ? required('Propeller') : null;
  const nozzles = atlas ? null : thrusterNozzles(model);
  if (nozzles && !nozzles.rear.length) throw new Error('Vehicle asset is missing its thruster nozzles');
  // The Roadster's rear wing tilts on its pivot to brake (about model +X).
  const wing = atlas ? null : required('Rear_Wing');
  const materials = new Map();
  let triangles = 0, meshes = 0;
  let reflections = bakeReflections(renderer, look);
  model.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    node.castShadow = true; node.receiveShadow = true;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      material.envMap = reflections.texture;
      material.envMapIntensity = /Glass/.test(material.name) ? .9 : .45;
      materials.set(material.name, material);
    }
  });
  const headMat = materials.get('Headlamp'), brakeMat = materials.get('Brake_Lamp');
  if (!headMat || !brakeMat) throw new Error('Vehicle asset is missing its working lamp materials');
  // After a lost graphics context the baked reflections are gone (a render
  // target's pixels don't survive): bake them again. With a look, reflect
  // that instead (if it isn't already).
  function relight(next = null) {
    if (next === look) return;
    look = next ?? look;
    reflections.dispose(); reflections = bakeReflections(renderer, look);
    for (const material of materials.values()) { material.envMap = reflections.texture; material.needsUpdate = true; }
  }
  return { kind, model, clips: gltf.animations, body, relight, wheelPivots, wheelSpinners, headMat, brakeMat, meshes, triangles, transformation, flight, propeller, nozzles, wing,
    batching: [body, ...wheelSpinners, ...(wing ? [wing] : [])].map(group => ({ before: group.userData.sourceParts, after: group.children.filter(o => o.isMesh).length })) };
}
