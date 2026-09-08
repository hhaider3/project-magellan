import { createTerrain } from './terrain.mjs?v=impact-motion-3';
import { FAR_SIZE, FAR_VIEW, NEAR_VIEW, farIndices } from './streaming-layout.mjs?v=impact-motion-3';
import { batchStaticMeshes } from './batching.mjs?v=impact-motion-3';
import { createProfiler } from './profiling.mjs?v=impact-motion-3';
import { createDebris } from './debris.mjs?v=impact-motion-3';
import { createVehiclePresentation } from './vehicle-presentation.mjs?v=impact-motion-3';
import { followTarget, followValue } from './camera-motion.mjs?v=impact-motion-3';
import { createTreeBreakage } from './tree-breakage.mjs?v=impact-motion-3';
import { createBreakAudio } from './break-audio.mjs?v=impact-motion-3';
import * as THREE from 'three';
import { CHUNK, GRID, ROAD_SPACING, ROAD_HALF, FIXED_DT, featurePoint, clamp, mix, smoothstep, hash, createWorld, createVehicle, stepVehicle, recoverVehicle } from './world.mjs?v=impact-motion-3';
import { buildLandmark, cloneOwnedGeometry, createCactusGeometry } from './scenery.mjs?v=impact-motion-3';

const $ = id => document.getElementById(id);
const coarse = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const testMode = ['drive', 'ramp', 'ramp-side', 'twist', 'smash', 'tree-smash', 'browser'].includes(new URLSearchParams(location.search).get('test'));
const profiler = createProfiler(testMode);
const bootStarted = performance.now();
if (coarse) document.body.classList.add('touch');
const seedFromUrl = Number(new URLSearchParams(location.search).get('seed'));
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000;
let seed = Number.isSafeInteger(seedFromUrl) && seedFromUrl > 0 ? seedFromUrl % 2147483647 || 1 : freshSeed();
let world = createWorld(seed), vehicle = createVehicle(world);
// Reproducible launch position used by the browser integration harness.
if (new URLSearchParams(location.search).get('test') === 'ramp') {
  const p = featurePoint(world.starterRamp, 0, -35);
  vehicle = createVehicle(world, p.x, p.z, world.starterRamp.heading);
}
if (new URLSearchParams(location.search).get('test') === 'ramp-side') {
  const ramp = world.starterRamp, target = featurePoint(ramp, 0, ramp.length * .85), heading = ramp.heading + Math.PI * .75;
  vehicle = createVehicle(world, target.x - Math.sin(heading) * 18, target.z - Math.cos(heading) * 18, heading);
  vehicle.vx = Math.sin(heading) * 40; vehicle.vz = Math.cos(heading) * 40; vehicle.speed = 40;
}
if (new URLSearchParams(location.search).get('test') === 'twist') {
  const p = featurePoint(world.twistRamp, 0, -35);
  vehicle = createVehicle(world, p.x, p.z, world.twistRamp.heading);
}
if (new URLSearchParams(location.search).get('test') === 'smash') {
  const prop = world.props(0, 0).find(p => ['cactus', 'tree', 'boulder'].includes(p.type));
  if (prop) vehicle = createVehicle(world, prop.x, prop.z - 32, 0);
}
if (new URLSearchParams(location.search).get('test') === 'tree-smash') {
  const prop = world.props(-1, -1).find(p => p.type === 'tree');
  if (prop) vehicle = createVehicle(world, prop.x, prop.z - 32, 0);
}
let running = false, started = false, cameraMode = 0, muted = true, lightsOn = false, bestDistance = 0;
if (!testMode) try { muted = localStorage.getItem('endless-drive-muted') !== '0'; bestDistance = Number(JSON.parse(localStorage.getItem('endless-drive-records') || '{}').distance) || 0; } catch {}
const input = {}, keyStates = new Set(), touchStates = new Map();
const keyMap = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'jump', ShiftLeft: 'brake', ShiftRight: 'brake' };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.35 : 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Driving world. WASD to drive, Space to jump, Shift to drift, R to recover, Escape to pause.');
$('game').append(renderer.domElement);
const scene = new THREE.Scene();
const skyColor = new THREE.Color('#b9cdd0');
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, 350, 1450);
const camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, .1, 2600);
scene.add(new THREE.HemisphereLight('#e4efed', '#787257', 1.6));
const sun = new THREE.DirectionalLight('#fff0d2', 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 230 });
sun.shadow.bias = -.00015; sun.shadow.normalBias = .04;
scene.add(sun, sun.target);
// A softly graded sky travels with the camera; the horizon never runs out.
const sky = new THREE.Mesh(new THREE.SphereGeometry(2300, 24, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { top: { value: new THREE.Color('#729eaf') }, bottom: { value: skyColor } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `varying vec3 vDir; uniform vec3 top; uniform vec3 bottom;
    float hashSky(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noiseSky(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hashSky(i),hashSky(i+vec2(1,0)),f.x),mix(hashSky(i+vec2(0,1)),hashSky(i+vec2(1,1)),f.x),f.y);}
    void main(){
      vec3 ray=normalize(vDir);float t=pow(max(ray.y,0.0),.65);
      vec2 p=ray.xz/max(ray.y,.05)*1.3;
      float n=noiseSky(p)*.5+noiseSky(p*2.1)*.25+noiseSky(p*4.2)*.125;
      float cloud=smoothstep(.48,.68,n)*smoothstep(.025,.14,ray.y)*(1.0-smoothstep(.7,.95,ray.y))*.62;
      gl_FragColor=vec4(mix(mix(bottom,top,t),vec3(.87,.90,.87),cloud),1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
// Shader chunks must start on their own line.
sky.material.fragmentShader = sky.material.fragmentShader.replace(';#include', ';\n#include');
scene.add(sky);

// Paint roads directly onto the terrain surface. Geometry, collision height and
// asphalt now share one surface: no raised ribbons, cuttings, seams or walls.
const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
const streamUniforms = { uStreamCenter: { value: new THREE.Vector2() } };
const roadUniforms = { uRoadPhase: { value: world.phase } };
// Geometry is already coarse at the streaming boundary. Moving the boundary
// therefore changes tessellation only, never the silhouette or lighting.
const lodDeclaration = `uniform vec2 uStreamCenter;
attribute float coarseHeight;
attribute vec3 coarseNormal;
attribute vec3 coarseColor;
float terrainBlend(){return smoothstep(220.0,360.0,distance((modelMatrix*vec4(position,1.0)).xz,uStreamCenter));}
`;

terrainMaterial.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, roadUniforms, streamUniforms);
  shader.vertexShader = lodDeclaration + 'varying vec2 vGroundXZ;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal=mix(objectNormal,coarseNormal,terrainBlend());');
  shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvColor=mix(vColor,coarseColor,terrainBlend());');
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y=mix(position.y,coarseHeight,terrainBlend());\nvGroundXZ=(modelMatrix*vec4(position,1.0)).xz;');
  shader.fragmentShader = `varying vec2 vGroundXZ;
    uniform float uRoadPhase;
    float centerAt(float s,float band,float axis){
      float p=uRoadPhase+axis*1.8; float a=p+band*1.71;float b=p*.7+band*2.13;
      return band*420.0+35.0*(sin(s*.0028+a)-sin(a))+12.0*(sin(s*.0065+b)-sin(b));
    }
    float grain(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  ` + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    vec2 p=vGroundXZ; float dx=10000.0;float dz=10000.0;
    for(int k=-1;k<=1;k++){
      dx=min(dx,abs(p.x-centerAt(p.y,floor(p.x/420.0+.5)+float(k),0.0)));
      dz=min(dz,abs(p.y-centerAt(p.x,floor(p.y/420.0+.5)+float(k),1.0)));
    }
    float d=min(dx,dz);float aa=max(fwidth(d),.04);
    float shoulder=1.0-smoothstep(5.0,6.6,d);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.34,.31,.235),shoulder*.68);
    float asphalt=1.0-smoothstep(4.65-aa,4.65+aa,d);
    float speckle=grain(floor(p*9.0));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.105,.124,.12)+speckle*.018,asphalt);
    float edge=(1.0-smoothstep(.065,.065+aa,abs(d-4.13)))*step(5.0,max(dx,dz));
    float along=dx<dz?p.y:p.x;
    float dash=(1.0-smoothstep(.065,.065+aa,d))*step(7.0,mod(along,14.0))*smoothstep(6.0,8.0,max(dx,dz));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.77,.72,.56),max(edge*.7,dash*.88));
  `);
};
let terrain = createTerrain(world);
function geometryFromData(data) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(data)) {
    if (name === 'index') geometry.setIndex(new THREE.BufferAttribute(array, 1));
    else geometry.setAttribute(name, new THREE.BufferAttribute(array, name === 'coarseHeight' ? 1 : 3));
  }
  geometry.computeBoundingSphere();
  return geometry;
}
const material = (color, roughness = .85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const trunkMaterial = material('#645840'), treeMaterial = material('#365e4d'), tipMaterial = material('#527463'), rockMaterial = material('#969c88');
const bushMaterial = material('#728450'), postMaterial = material('#ded7b4');
const cactusMaterial = material('#63834b');
const cactusGeo = createCactusGeometry();
const trunkGeo = new THREE.CylinderGeometry(.15, .27, 3.1, 6).translate(0, 1.55, 0);
const treeGeo = new THREE.ConeGeometry(1.95, 4.7, 7).translate(0, 3.65, 0);
const tipGeo = new THREE.ConeGeometry(1.35, 3.4, 7).translate(0, 5.2, 0);
const rockGeo = new THREE.DodecahedronGeometry(1, 0).scale(1.2, .55, .85).translate(0, .15, 0);
const boulderGeo = new THREE.DodecahedronGeometry(1, 0).scale(1.2, 1.1, .85).translate(0, .65, 0);
const bushGeo = new THREE.IcosahedronGeometry(1, 0).scale(1.1, .7, .9).translate(0, .45, 0);
const postGeo = new THREE.BoxGeometry(.18, .95, .18).translate(0, .48, 0);
const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), upAxis = new THREE.Vector3(0, 1, 0), scaleVec = new THREE.Vector3(), pointVec = new THREE.Vector3();
const fadingMaterials = new WeakSet();
function softenScenery(mat) {
  if (fadingMaterials.has(mat)) return;
  fadingMaterials.add(mat);
  // Use stable multisample coverage instead of screen-space noise, which
  // sparkles during motion and on browsers with different pixel ratios.
  // Keep alpha in the output (transparent), but retain opaque depth and
  // blending when MSAA is available. Fall back to ordinary alpha blending.
  const multisampled = renderer.getContext().getContextAttributes().antialias;
  mat.transparent = true;
  mat.alphaToCoverage = multisampled;
  mat.blending = multisampled ? THREE.NoBlending : THREE.NormalBlending;
  mat.depthWrite = multisampled;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, streamUniforms);
    shader.vertexShader = 'attribute float groundDelta; uniform vec2 uStreamCenter; varying vec2 vSceneryXZ;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 sceneryPosition=vec4(transformed,1.0);
      #ifdef USE_INSTANCING
        sceneryPosition=instanceMatrix*sceneryPosition;
      #endif
      vSceneryXZ=(modelMatrix*sceneryPosition).xz;
      float groundBlend=smoothstep(220.0,360.0,distance(vSceneryXZ,uStreamCenter));
      // Group transforms preserve the vertical axis and have unit scale.
      sceneryPosition.y+=groundDelta*groundBlend;
      vec4 mvPosition=modelViewMatrix*sceneryPosition;
      gl_Position=projectionMatrix*mvPosition;`);
    shader.fragmentShader = 'uniform vec2 uStreamCenter; varying vec2 vSceneryXZ;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      float coverage=1.0-smoothstep(220.0,350.0,distance(vSceneryXZ,uStreamCenter));
      if(coverage<=0.001) discard;
      diffuseColor.a*=coverage;`);
  };
  mat.customProgramCacheKey = () => 'scenery-distance-fade-v2';
  mat.needsUpdate = true;
}
const chunks = new Map();
const view = NEAR_VIEW, farTiles = new Map();
let lastCX = Infinity, lastCZ = Infinity;
let worker, generation = 0, jobId = 0, jobs = [], pending = new Map(), completed = [];
let loading = true, resumeAfterLoad = false, loadingStarted = bootStarted, streamError = null;
function buildChunk({ cx, cz, ground: groundData, props, features, roadside }) {
  const buildStart = performance.now();
  const group = new THREE.Group(); group.position.set(cx * CHUNK, 0, cz * CHUNK);
  props = props.filter(p => !world.brokenProps.has(p.id));
  const propInstances = new Map();
  const ground = new THREE.Mesh(geometryFromData(groundData), terrainMaterial);
  ground.geometry.userData.owned = true;
  ground.receiveShadow = true; group.add(ground);
  function instances(type, geometry, mat) {
    const list = (type === 'post' ? roadside : props).filter(p => p.type === type); if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, mat, list.length);
    list.forEach((p, i) => {
      pointVec.set(p.x - cx * CHUNK, p.y - .08, p.z - cz * CHUNK); quaternion.setFromAxisAngle(upAxis, p.turn); scaleVec.setScalar(p.size); matrix.compose(pointVec, quaternion, scaleVec); mesh.setMatrixAt(i, matrix);
      if (p.id) { if (!propInstances.has(p.id)) propInstances.set(p.id, []); propInstances.get(p.id).push({ mesh, index: i }); }
    });
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  instances('cactus', cactusGeo, cactusMaterial);
  instances('tree', trunkGeo, trunkMaterial); instances('tree', treeGeo, treeMaterial); instances('tree', tipGeo, tipMaterial); instances('rock', rockGeo, rockMaterial);
  instances('boulder', boulderGeo, rockMaterial); instances('bush', bushGeo, bushMaterial); instances('post', postGeo, postMaterial);
  for (const feature of features) {
    const landmark = buildLandmark(feature, world);
    landmark.position.x -= cx * CHUNK; landmark.position.z -= cz * CHUNK; group.add(landmark);
  }
  group.updateMatrixWorld(true);
  group.traverse(o => {
    if (!o.isMesh || o === ground) return;
    // Match the terrain's gradual height change so distant trees stay rooted.
    if (!o.geometry.userData.owned) o.geometry = cloneOwnedGeometry(o.geometry);
    const deltas = [], position = o.geometry.getAttribute('position');
    for (let i = 0; i < (o.isInstancedMesh ? o.count : position.count); i++) {
      if (o.isInstancedMesh) { o.getMatrixAt(i, matrix); pointVec.setFromMatrixPosition(matrix); }
      else pointVec.fromBufferAttribute(position, i);
      pointVec.applyMatrix4(o.matrixWorld);
      deltas.push(terrain.coarseSample(pointVec.x, pointVec.z).height - world.surface(pointVec.x, pointVec.z));
    }
    o.geometry.setAttribute('groundDelta', o.isInstancedMesh ? new THREE.InstancedBufferAttribute(new Float32Array(deltas), 1) : new THREE.Float32BufferAttribute(deltas, 1));
    softenScenery(o.material);
  });
  profiler.record('chunkBuild', performance.now() - buildStart);
  scene.add(group); chunks.set(`${cx},${cz}`, { cx, cz, group, ground, props, features, propInstances });
}
function processBreakage() {
  for (const prop of world.drainBreakEvents()) {
    const chunk = chunks.get(`${Math.floor(prop.x / CHUNK)},${Math.floor(prop.z / CHUNK)}`);
    for (const { mesh, index } of chunk?.propInstances.get(prop.id) || []) {
      mesh.getMatrixAt(index, matrix); matrix.scale(scaleVec.set(0, 0, 0)); mesh.setMatrixAt(index, matrix); mesh.instanceMatrix.needsUpdate = true;
    }
    debris.burst(prop);
    if (prop.type === 'tree') treeBreakage.burst(prop);
    if (!muted && audio) audio.breaks.play(prop.type, Math.hypot(prop.vx, prop.vz));
  }
}
function disposeChunk(chunk) {
  scene.remove(chunk.group);
  chunk.group.traverse(o => { if (o.geometry?.userData.owned) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
}
function refreshFarTile(tx, tz) {
  const tile = farTiles.get(`${tx},${tz}`);
  if (tile) tile.geometry.setIndex(farIndices(tx, tz, (cx, cz) => chunks.get(`${cx},${cz}`)?.group.visible));
}
function desired(job) {
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK);
  return job.kind === 'near' ? Math.max(Math.abs(job.cx - cx), Math.abs(job.cz - cz)) <= view + 1
    : Math.max(Math.abs(job.cx - Math.floor(vehicle.x / FAR_SIZE)), Math.abs(job.cz - Math.floor(vehicle.z / FAR_SIZE))) <= FAR_VIEW;
}
function streamWorld(force = false) {
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK);
  if (!force && cx === lastCX && cz === lastCZ) return;
  lastCX = cx; lastCZ = cz;
  const fx = Math.floor(vehicle.x / FAR_SIZE), fz = Math.floor(vehicle.z / FAR_SIZE);
  for (const [key, chunk] of chunks) {
    const ring = Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz));
    chunk.group.visible = ring <= view;
    if (ring > view + 1) { disposeChunk(chunk); chunks.delete(key); }
  }
  for (const [key, tile] of farTiles) {
    if (Math.max(Math.abs(tile.userData.cx - fx), Math.abs(tile.userData.cz - fz)) > FAR_VIEW) {
      scene.remove(tile); tile.geometry.dispose(); farTiles.delete(key);
    } else refreshFarTile(tile.userData.cx, tile.userData.cz);
  }
  const existing = new Set([...pending.values()].map(job => `${job.kind}:${job.cx},${job.cz}`));
  jobs = [];
  function enqueue(kind, x, z, priority) {
    if ((kind === 'near' ? chunks : farTiles).has(`${x},${z}`) || existing.has(`${kind}:${x},${z}`)) return;
    jobs.push({ kind, cx: x, cz: z, seed, generation, id: ++jobId, priority });
  }
  for (let dx = -view - 1; dx <= view + 1; dx++) for (let dz = -view - 1; dz <= view + 1; dz++) {
    const ring = Math.max(Math.abs(dx), Math.abs(dz));
    // Visible chunks first; ahead-of-car ordering helps sharp turns too.
    enqueue('near', cx + dx, cz + dz, (ring > view ? 100 : 0) + Math.hypot(dx, dz) - (dx * vehicle.vx + dz * vehicle.vz) / 1000);
  }
  for (let dx = -FAR_VIEW; dx <= FAR_VIEW; dx++) for (let dz = -FAR_VIEW; dz <= FAR_VIEW; dz++) enqueue('far', fx + dx, fz + dz, 3 + Math.hypot(dx, dz) * 2);
  jobs.sort((a, b) => a.priority - b.priority);
}
function worldReady() {
  for (let dx = -view; dx <= view; dx++) for (let dz = -view; dz <= view; dz++) if (!chunks.has(`${lastCX + dx},${lastCZ + dz}`)) return false;
  return farTiles.size === (FAR_VIEW * 2 + 1) ** 2;
}
function drivable() {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (!chunks.has(`${lastCX + dx},${lastCZ + dz}`)) return false;
  return true;
}
function processStreaming() {
  if (!worker || streamError) return;
  const budgetStart = performance.now();
  // Worker messages are installed within a frame budget, rather than all at
  // once. At most two jobs are in flight, keeping memory and upload work bounded.
  while (completed.length && performance.now() - budgetStart < 4) {
    const job = completed.shift(); pending.delete(job.id);
    if (job.generation !== generation || !desired(job)) continue;
    if (job.kind === 'near') {
      buildChunk(job);
      chunks.get(`${job.cx},${job.cz}`).group.visible = Math.max(Math.abs(job.cx - lastCX), Math.abs(job.cz - lastCZ)) <= view;
      refreshFarTile(Math.floor(job.cx / 4), Math.floor(job.cz / 4));
    } else {
      const tile = new THREE.Mesh(geometryFromData(job.ground), terrainMaterial);
      tile.position.set(job.cx * FAR_SIZE, 0, job.cz * FAR_SIZE);
      tile.userData = { cx: job.cx, cz: job.cz }; tile.receiveShadow = true;
      farTiles.set(`${job.cx},${job.cz}`, tile); refreshFarTile(job.cx, job.cz); scene.add(tile);
    }
  }
  profiler.record('streamInstall', performance.now() - budgetStart);
  while (pending.size < 2 && jobs.length) {
    const job = jobs.shift(); if (!desired(job)) continue;
    pending.set(job.id, job); worker.postMessage(job);
  }
  if (loading) {
    const total = (view * 2 + 1) ** 2 + (FAR_VIEW * 2 + 1) ** 2;
    const count = [...chunks.values()].filter(chunk => chunk.group.visible).length + farTiles.size;
    $('startBtn').firstElementChild.textContent = `Preparing the world · ${Math.min(99, Math.floor(count / total * 100))}%`;
    if (worldReady()) {
      loading = false; $('startBtn').disabled = false; $('startBtn').firstElementChild.textContent = started ? 'Keep exploring' : 'Start exploring';
      resetTiming(); resetCamera(); updateHUD(); drawMap();
      profiler.record('worldLoad', performance.now() - loadingStarted);
      document.dispatchEvent(new Event('worldready'));
      if (resumeAfterLoad) resume();
      resumeAfterLoad = false;
    }
  }
}
function beginWorldLoad(continueDriving = false) {
  if (running) pause();
  worker?.terminate(); generation++; pending.clear(); completed = []; jobs = [];
  loading = true; resumeAfterLoad = continueDriving; running = false; streamError = null; loadingStarted = performance.now();
  $('startBtn').disabled = true; resetTiming();
  for (const chunk of chunks.values()) disposeChunk(chunk); chunks.clear();
  for (const tile of farTiles.values()) { scene.remove(tile); tile.geometry.dispose(); } farTiles.clear();
  terrain = createTerrain(world);
  worker = new Worker(new URL('./world-worker.mjs?v=impact-motion-3', import.meta.url), { type: 'module' });
  const failed = message => { streamError = message; running = false; $('loadError').hidden = false; $('startBtn').firstElementChild.textContent = 'Unable to prepare the world'; };
  worker.onerror = error => failed(error.message);
  worker.onmessage = ({ data }) => {
    if (data.generation !== generation) return;
    if (data.error) { failed(data.error); return; }
    profiler.record('workerBuild', data.workMs); completed.push(data);
  };
  lastCX = lastCZ = Infinity; streamWorld(true);
}
function nearbyObstacles() {
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK), result = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) result.push(...(chunks.get(`${cx + dx},${cz + dz}`)?.props || []));
  return result;
}

// A purpose-built little expedition wagon: tapered body, framed glass, fenders,
// all-terrain tires, roof rack, luggage, spare wheel and working light clusters.
const car = new THREE.Group(), body = new THREE.Group(); car.add(body); scene.add(car);
car.rotation.order = 'YXZ';
const paint = material('#dbaa60', .48, .16), cream = material('#ede8d4', .5, .1), rubber = material('#262e2a', .95), trim = material('#3f4941', .66, .15), metal = material('#bbc1b3', .4, .65), glass = material('#41666b', .18, .28), luggage = material('#5c7667');
function box(parent, w, h, d, x, y, z, mat, shadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function hull(parent, rings, mat) {
  const vertices = [], indices = [];
  for (const [y, half, back, front] of rings) vertices.push(-half, y, back, half, y, back, half, y, front, -half, y, front);
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < 4; i++) { const a = r * 4 + i, b = r * 4 + (i + 1) % 4, c = a + 4, d = b + 4; indices.push(a, c, b, b, c, d); }
  const t = (rings.length - 1) * 4; indices.push(0, 1, 2, 0, 2, 3, t, t + 2, t + 1, t, t + 3, t + 2);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.setIndex(indices); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
box(body, 1.9, .2, 3.85, 0, .61, 0, rubber);
hull(body, [[.69, .94, -2.04, 2.02], [1.12, 1.04, -2, 2.02], [1.4, .98, -1.98, 1.91]], paint);
hull(body, [[1.39, .9, -1.84, .78], [2.22, .76, -1.61, .29]], glass);
box(body, 1.6, .13, 2.05, 0, 2.26, -.67, cream);
box(body, 1.82, .07, 1.08, 0, 1.43, 1.36, paint);
for (const side of [-1, 1]) {
  // Slim pillars follow the windshield rake.
  const pillar = box(body, .075, .98, .07, side * .825, 1.81, .52, cream); pillar.rotation.x = -.53;
  const rear = box(body, .08, .93, .09, side * .825, 1.81, -1.72, cream); rear.rotation.x = .24;
  box(body, .08, .86, .075, side * .84, 1.82, -.65, cream);
  box(body, .065, .055, 2.58, side * .926, 1.41, -.53, cream);
  box(body, .05, .055, .26, side * 1.015, 1.26, -.29, trim);
  box(body, .05, .055, .24, side * 1.015, 1.26, -1.22, trim);
  box(body, .16, .16, .3, side * 1.1, 1.59, .57, trim);
  box(body, .2, .13, 2.02, side * 1.03, .55, -.1, trim);
  for (const z of [-1.37, 1.37]) box(body, .2, .14, 1.22, side * 1.04, 1.11, z, trim);
  box(body, .08, .17, 2.0, side * .72, 2.51, -.69, trim);
  box(body, .065, .3, .06, side * .72, 2.43, -.1, trim);
  box(body, .065, .3, .06, side * .72, 2.43, -1.3, trim);
}
for (const z of [-1.55, -.8, 0]) box(body, 1.45, .07, .075, 0, 2.4, z, trim);
box(body, .88, .32, .9, .22, 2.57, -.92, luggage);
box(body, .06, .34, .93, .02, 2.58, -.92, trim);
box(body, 2.17, .21, .25, 0, .69, 2.06, trim);
box(body, 2.15, .21, .23, 0, .69, -2.1, trim);
box(body, .93, .3, .045, 0, 1.1, 2.025, trim);
for (let i = -2; i <= 2; i++) box(body, .025, .22, .045, i * .14, 1.1, 2.055, metal);
box(body, .53, .17, .05, 0, .71, -2.24, cream);
const headMat = material('#f9efce', .3); headMat.emissive.set('#ffdfa3'); headMat.emissiveIntensity = .45;
const brakeMat = material('#af3c25', .3); brakeMat.emissive.set('#f55123'); brakeMat.emissiveIntensity = .3;
for (const side of [-1, 1]) {
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .07, 16).rotateX(Math.PI / 2), headMat); head.position.set(side * .74, 1.12, 2.035); body.add(head);
  box(body, .15, .13, .055, side * .89, .85, 2.04, brakeMat);
  box(body, .2, .3, .055, side * .81, 1.17, -2.015, brakeMat);
}
const tireGeo = new THREE.CylinderGeometry(.57, .57, .39, 20).rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(.28, .28, .415, 12).rotateZ(Math.PI / 2);
const wheelPivots = [], wheelSpinners = [];
for (const x of [-1.04, 1.04]) for (const z of [1.37, -1.37]) {
  const pivot = new THREE.Group(); pivot.position.set(x, .57, z); car.add(pivot); wheelPivots.push(pivot);
  const spinner = new THREE.Group(); pivot.add(spinner); wheelSpinners.push(spinner);
  const tire = new THREE.Mesh(tireGeo, rubber); tire.castShadow = true; spinner.add(tire);
  spinner.add(new THREE.Mesh(hubGeo, cream));
  const center = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, .44, 12).rotateZ(Math.PI / 2), metal); spinner.add(center);
  for (let j = 0; j < 12; j++) { const a = j * Math.PI / 6; const tread = box(spinner, .42, .075, .18, 0, Math.cos(a) * .55, Math.sin(a) * .55, trim); tread.rotation.x = a; }
  for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3; const bolt = new THREE.Mesh(new THREE.SphereGeometry(.028, 5, 4), trim); bolt.position.set(Math.sign(x) * .215, Math.cos(a) * .18, Math.sin(a) * .18); spinner.add(bolt); }
}
const spare = new THREE.Group(); spare.position.set(.16, 1.25, -2.2); spare.rotation.y = Math.PI / 2; body.add(spare);
spare.add(new THREE.Mesh(tireGeo, rubber), new THREE.Mesh(hubGeo, cream));
const headlight = new THREE.SpotLight('#ffe4b1', 0, 60, .5, .5, 1.2); headlight.position.set(0, 1.5, 2);
const lightTarget = new THREE.Object3D(); lightTarget.position.set(0, 0, 25); car.add(headlight, lightTarget); headlight.target = lightTarget;
const carBatching = [body, ...wheelSpinners].map(batchStaticMeshes);
const oldCarGeometry = new Set(carBatching.flatMap(result => [...result.originalGeometries]));
for (const geometry of oldCarGeometry) geometry.dispose();
// Soft contact shadow makes the height of jumps easy to judge.
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
const shadowContext = shadowCanvas.getContext('2d'), shadowGradient = shadowContext.createRadialGradient(32, 32, 2, 32, 32, 32);
shadowGradient.addColorStop(0, 'rgba(20,27,20,.36)'); shadowGradient.addColorStop(1, 'rgba(20,27,20,0)');
shadowContext.fillStyle = shadowGradient; shadowContext.fillRect(0, 0, 64, 64);
const contact = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
contact.rotation.x = -Math.PI / 2; scene.add(contact);

let audio = null;
function initAudio() {
  if (audio) { audio.context.resume(); return; }
  try {
    const context = new AudioContext(), oscillator = context.createOscillator(), filter = context.createBiquadFilter(), gain = context.createGain(), master = context.createGain(), limiter = context.createDynamicsCompressor();
    oscillator.type = 'sawtooth'; filter.type = 'lowpass'; gain.gain.value = 0;
    master.gain.value = muted ? 0 : 1;
    limiter.threshold.value = -10; limiter.knee.value = 12; limiter.ratio.value = 4;
    master.connect(limiter).connect(context.destination);
    oscillator.connect(filter).connect(gain).connect(master); oscillator.start();
    audio = { context, oscillator, filter, gain, master, breaks: createBreakAudio(context, master) };
  } catch {}
}
function syncSound() {
  $('soundBtn').innerHTML = `<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>${muted ? '<path d="m16 9 5 6m0-6-5 6"/>' : '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;
  $('soundBtn').setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}
function toggleSound() {
  muted = !muted; if (!muted) initAudio();
  if (audio) { audio.master.gain.cancelScheduledValues(audio.context.currentTime); audio.master.gain.setValueAtTime(muted ? 0 : 1, audio.context.currentTime); }
  try { localStorage.setItem('endless-drive-muted', muted ? '1' : '0'); } catch {} syncSound();
}
$('soundBtn').onclick = toggleSound;
function saveRecord() { bestDistance = Math.max(bestDistance, vehicle.distance); if (!testMode) try { localStorage.setItem('endless-drive-records', JSON.stringify({ distance: bestDistance })); } catch {} }
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600); }
function clearInput() { keyStates.clear(); touchStates.clear(); for (const k in input) input[k] = false; document.querySelectorAll('[data-control]').forEach(el => el.classList.remove('active')); }
function syncInput() { for (const k of ['up', 'down', 'left', 'right', 'jump', 'brake']) input[k] = [...keyStates].some(code => keyMap[code] === k) || [...touchStates.values()].includes(k); }
function resume() {
  if ($('startBtn').disabled) return;
  running = true; started = true; resetTiming();
  $('menu').classList.add('closed'); $('menu').inert = true; $('menu').setAttribute('aria-hidden', 'true');
  $('pauseBtn').hidden = false; document.body.classList.add('driving'); renderer.domElement.focus({ preventScroll: true });
  if (!muted) initAudio();
}
function pause() {
  if (!running) return;
  running = false; clearInput(); saveRecord(); document.body.classList.remove('driving');
  if (audio) audio.context.suspend();
  $('menu').classList.remove('closed'); $('menu').inert = false; $('menu').removeAttribute('aria-hidden'); $('pauseBtn').hidden = true;
  $('menuTitle').innerHTML = 'Room to<br><em>breathe.</em>'; $('menuCopy').innerHTML = 'Your road will still be here.<br>Pick up where you left off.';
  $('startBtn').firstElementChild.textContent = 'Keep exploring'; $('menuStats').hidden = false;
  $('pauseTools').hidden = false;
  $('runDistance').textContent = (vehicle.distance / 1000).toFixed(2); $('bestDistance').textContent = (bestDistance / 1000).toFixed(2);
  $('startBtn').focus({ preventScroll: true });
}
function resetTiming() {
  accumulator = 0; previousTime = performance.now(); frame.lastNow = previousTime;
  uiTime = mapTime = 0;
  vehiclePresentation.reset(vehicle);
  updateDesiredCamera();
  previousDesiredCamera.copy(desiredCamera); previousLook.copy(look);
  previousTargetFov = camera.fov;
}
function resetCamera() {
  updateDesiredCamera();
  cameraPosition.copy(desiredCamera); cameraTarget.copy(look);
  previousDesiredCamera.copy(desiredCamera); previousLook.copy(look);
  cameraPosition.y = Math.max(cameraPosition.y, world.surface(cameraPosition.x, cameraPosition.z) + 1.8);
  camera.position.copy(cameraPosition); camera.lookAt(cameraTarget);
}
function newWorld() {
  const continueDriving = running || resumeAfterLoad && loading;
  saveRecord(); clearInput(); seed = freshSeed(); world = createWorld(seed); vehicle = createVehicle(world); roadUniforms.uRoadPhase.value = world.phase;
  debris.clear(); treeBreakage.clear(); audio?.breaks.clear();
  const url = new URL(location.href); url.searchParams.set('seed', seed); history.replaceState(null, '', url);
  beginWorldLoad(continueDriving); resetCamera(); syncSeed(); updateHUD(); drawMap();
  reportedLanding = 0; $('runDistance').textContent = '0.00'; toast('A new road ahead. World ' + seed);
}
function syncSeed() { $('seedTxt').textContent = String(seed).padStart(6, '0'); }
$('startBtn').onclick = resume; $('pauseBtn').onclick = pause; $('newWorld').onclick = newWorld;
function recover() {
  if (profiler.measure('recovery', () => recoverVehicle(vehicle, world))) { streamWorld(); resetTiming(); resetCamera(); updateHUD(); toast('Back on your wheels.'); }
}
function cycleCamera() {
  cameraMode = (cameraMode + 1) % 3; resetCamera();
  $('cameraBtn').textContent = 'Camera: ' + ['Chase', 'Wide', 'Bonnet'][cameraMode];
  toast(['Chase camera', 'Wide camera', 'Bonnet camera'][cameraMode]);
}
$('recoverBtn').onclick = () => { recover(); resume(); };
$('cameraBtn').onclick = cycleCamera;
document.querySelector('.brand').onclick = e => { e.preventDefault(); if (running) pause(); };
$('copySeed').onclick = async () => {
  const url = new URL(location.href); url.searchParams.set('seed', seed);
  try { await navigator.clipboard.writeText(url.href); toast('World link copied. Bring a friend.'); } catch { history.replaceState(null, '', url); toast('Your world link is in the address bar.'); }
};
addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); if (!e.repeat && started) running ? pause() : resume(); return; }
  if (keyMap[e.code]) {
    if (running) {
      e.preventDefault();
      // Queue the edge at event time: a quick tap can begin AND end between
      // physics ticks, especially on a slower display or while streaming.
      if (e.code === 'Space' && !e.repeat) vehicle.jumpBuffer = .16;
      keyStates.add(e.code); syncInput();
    }
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleSound();
  if (!running) return;
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyR') recover();
  if (e.code === 'KeyN') newWorld();
  if (e.code === 'KeyL') { lightsOn = !lightsOn; headlight.intensity = lightsOn ? 75 : 0; headMat.emissiveIntensity = lightsOn ? 2 : .45; toast(lightsOn ? 'Headlights on' : 'Headlights off'); }
});
addEventListener('keyup', e => { keyStates.delete(e.code); syncInput(); });
addEventListener('blur', () => { clearInput(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('beforeunload', saveRecord);
for (const el of document.querySelectorAll('[data-control]')) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); if (!running) return; el.setPointerCapture(e.pointerId); if (el.dataset.control === 'jump') vehicle.jumpBuffer = .16; touchStates.set(e.pointerId, el.dataset.control); el.classList.add('active'); syncInput(); });
  const release = e => { touchStates.delete(e.pointerId); el.classList.remove('active'); syncInput(); };
  el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('lostpointercapture', release);
}
// Keep keyboard focus within the visible menu without trapping gameplay controls.
$('menu').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const buttons = [...$('menu').querySelectorAll('button:not([disabled])')].filter(b => b.offsetParent !== null);
  const first = buttons[0], last = buttons.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

const mapContext = $('minimap').getContext('2d');
function drawMap() {
  const mapStarted = performance.now();
  const ctx = mapContext, w = 288, h = 240, range = 155, scale = w / (2 * range), step = 12;
  ctx.fillStyle = '#32493b'; ctx.fillRect(0, 0, w, h);
  for (let iy = 0; iy < h; iy += step) for (let ix = 0; ix < w; ix += step) {
    const x = vehicle.x - (ix - w / 2) / scale, z = vehicle.z - (iy - h / 2) / scale, elev = world.height(x, z);
    const band = Math.floor(elev / 9), sand = world.desertAt(x, z, elev); ctx.fillStyle = `hsl(${mix(89 - band * 1.5, 40, sand)} ${mix(16, 38, sand)}% ${25 + band * 1.7 + sand * 13}%)`; ctx.fillRect(ix, iy, step + 1, step + 1);
  }
  ctx.strokeStyle = '#d6c99c'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  for (const dir of ['x', 'z']) for (let k = -1; k <= 1; k++) {
    const band = Math.round((dir === 'x' ? vehicle.z : vehicle.x) / ROAD_SPACING) + k;
    ctx.beginPath();
    for (let off = -180; off <= 180; off += 5) {
      const s = (dir === 'x' ? vehicle.x : vehicle.z) + off, c = world.roadCenter(s, band, dir);
      const x = dir === 'x' ? s : c, z = dir === 'x' ? c : s;
      const mx = w / 2 - (x - vehicle.x) * scale, my = h / 2 - (z - vehicle.z) * scale;
      if (off === -180) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#eee7cc18'; ctx.lineWidth = 1;
  for (let i = 24; i < w; i += 48) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
  for (let i = 24; i < h; i += 48) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
  for (const f of world.featuresNear(vehicle.x, vehicle.z, range * 1.4)) {
    const mx = w / 2 - (f.x - vehicle.x) * scale, my = h / 2 - (f.z - vehicle.z) * scale;
    ctx.save(); ctx.translate(mx, my); ctx.fillStyle = f.type === 'ramp' ? f.twist ? '#c69bf0' : '#ffb15e' : '#d8e4ce'; ctx.strokeStyle = '#24382e'; ctx.lineWidth = 2;
    if (f.type === 'ramp') { ctx.rotate(-f.heading); ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); }
    ctx.restore();
  }
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-vehicle.heading);
  ctx.fillStyle = '#f6e3b7'; ctx.shadowBlur = 10; ctx.shadowColor = '#eaca8688';
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 9); ctx.lineTo(0, 5); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill(); ctx.restore();
  profiler.record('minimap', performance.now() - mapStarted);
}
function updateHUD() {
  const speed = Math.abs(vehicle.speed) * 3.6;
  $('speed').textContent = Math.round(speed); $('speedBar').style.width = clamp(speed / 330 * 100, 0, 100) + '%';
  $('gear').textContent = speed < 1 ? 'N' : vehicle.speed < 0 ? 'R' : 'D';
  $('distance').textContent = (vehicle.distance / 1000).toFixed(2);
  $('surfaceState').textContent = !vehicle.grounded ? 'A LITTLE AIR' : input.brake && speed > 10 ? 'TAKE IT SIDEWAYS' : vehicle.onRoad ? 'ON THE ROAD' : 'OFF THE BEATEN PATH';
  $('airtime').textContent = !vehicle.grounded ? `${Math.round(vehicle.airDistance)} M · ${vehicle.airtime.toFixed(1)} S AIR` : vehicle.bestJump > 5 ? 'BEST JUMP ' + Math.round(vehicle.bestJump) + ' M' : vehicle.bestAir > .4 ? 'BEST AIR ' + vehicle.bestAir.toFixed(1) + ' S' : 'READY TO ROAM';
  const ramps = world.featuresNear(vehicle.x, vehicle.z, 450).filter(f => f.type === 'ramp').sort((a, b) => Math.hypot(a.x - vehicle.x, a.z - vehicle.z) - Math.hypot(b.x - vehicle.x, b.z - vehicle.z));
  if (ramps.length) {
    const ramp = ramps[0], angle = Math.atan2(ramp.x - vehicle.x, ramp.z - vehicle.z) - vehicle.heading;
    $('rampHint').textContent = `${Math.sin(angle) > .2 ? '↖' : Math.sin(angle) < -.2 ? '↗' : Math.cos(angle) < 0 ? '↓' : '↑'} ${ramp.twist ? 'ROLL RAMP' : 'RAMP'} ${Math.round(Math.hypot(ramp.x - vehicle.x, ramp.z - vehicle.z))} M`;
  } else $('rampHint').textContent = 'EXPLORE FOR MORE RAMPS';
  const headings = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];
  $('headingTxt').textContent = headings[((Math.round(vehicle.heading / (Math.PI / 4)) % 8) + 8) % 8];
  $('biomeTxt').textContent = world.desertAt(vehicle.x, vehicle.z) > .55 ? 'THE SANDLANDS' : world.mountainAt(vehicle.x, vehicle.z) > .62 ? 'THE HIGHLANDS' : world.woodlandAt(vehicle.x, vehicle.z) > .58 ? 'PINE COUNTRY' : 'OPEN MEADOW';
  $('coordinates').textContent = `${Math.round(Math.abs(vehicle.x))} ${vehicle.x < 0 ? 'E' : 'W'} · ${Math.round(Math.abs(vehicle.z))} ${vehicle.z >= 0 ? 'N' : 'S'}`;
  $('elevation').textContent = Math.round(world.surface(vehicle.x, vehicle.z)) + ' M';
}
const vehiclePosition = new THREE.Vector3(), cameraPosition = new THREE.Vector3(), cameraTarget = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), forward = new THREE.Vector3(), look = new THREE.Vector3();
const previousDesiredCamera = new THREE.Vector3(), previousLook = new THREE.Vector3();
let previousTargetFov = camera.fov;
const debris = createDebris(scene), rollPivot = new THREE.Vector3();
const treeBreakage = createTreeBreakage(scene, [
  { geometry: trunkGeo, color: trunkMaterial.color },
  { geometry: treeGeo, color: treeMaterial.color },
  { geometry: tipGeo, color: tipMaterial.color },
]);
const vehiclePresentation = createVehiclePresentation(vehicle);
let previousTime = performance.now(), accumulator = 0, uiTime = 0, mapTime = 0, idleRenderAt = 0, reportedLanding = 0;
function updateDesiredCamera(pose = vehicle) {
  vehiclePosition.set(pose.x, pose.y, pose.z);
  forward.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));
  if (!started) {
    desiredCamera.set(pose.x - 8.5, pose.y + 4.6, pose.z - 11.8);
    look.set(pose.x + 2.7, pose.y + 1.2, pose.z + 3.5);
  } else if (cameraMode === 2 && running) {
    desiredCamera.copy(vehiclePosition).addScaledVector(forward, .7); desiredCamera.y += 1.91;
    look.copy(vehiclePosition).addScaledVector(forward, 25); look.y += 1.65;
  } else {
    const compact = camera.aspect < .85;
    const distance = (cameraMode === 1 ? 18 : 10.6 + Math.abs(pose.speed) * .027) * (compact ? 1.4 : 1);
    desiredCamera.copy(vehiclePosition).addScaledVector(forward, -distance); desiredCamera.y += cameraMode === 1 ? 10 : compact ? 5.8 : 4.7;
    look.copy(vehiclePosition).addScaledVector(forward, cameraMode === 1 ? 5 : 7); look.y += 1.4;
  }
}
function render(dt) {
  const pose = vehiclePresentation.sample(running ? accumulator / FIXED_DT : 1);
  streamUniforms.uStreamCenter.value.set(pose.x, pose.z);
  car.rotation.set(pose.pitch, pose.heading, pose.roll, 'YXZ');
  rollPivot.set(0, 1, 0).applyEuler(car.rotation);
  car.position.set(pose.x - rollPivot.x, pose.y + 1 - rollPivot.y, pose.z - rollPivot.z);
  body.position.y = -pose.impact * .3;
  body.rotation.z = -pose.steer * Math.min(Math.abs(pose.speed) / 25, 1) * .055;
  body.rotation.x = (input.up ? -.012 : input.down ? .024 : 0);
  wheelSpinners.forEach(w => w.rotation.x = pose.wheelAngle);
  wheelPivots.forEach(p => { if (p.position.z > 0) p.rotation.y = pose.steer * .4; });
  brakeMat.emissiveIntensity = input.down || input.brake ? 2 : .25;
  car.visible = cameraMode !== 2 || !running;
  contact.position.set(pose.x, world.surface(pose.x, pose.z) + .035, pose.z);
  contact.rotation.set(-Math.PI / 2 + pose.pitch, 0, -pose.heading, 'YXZ');
  contact.material.opacity = clamp(1 - (pose.y - pose.groundY) * .13, .25, 1);
  updateDesiredCamera(pose);
  followTarget(cameraPosition, previousDesiredCamera, desiredCamera, 5, !started || cameraMode === 2 && running ? 0 : dt);
  cameraPosition.y = Math.max(cameraPosition.y, world.surface(cameraPosition.x, cameraPosition.z) + 1.8);
  camera.position.copy(cameraPosition);
  followTarget(cameraTarget, previousLook, look, 8, !started ? 0 : dt);
  camera.lookAt(cameraTarget);
  const targetFov = cameraMode === 2 ? 67 : 57 + (reducedMotion ? 0 : Math.min(Math.abs(pose.speed) * .15, 10));
  const nextFov = followValue(camera.fov, previousTargetFov, targetFov, 2.45, dt);
  previousTargetFov = targetFov;
  if (Math.abs(camera.fov - nextFov) > 1e-6) { camera.fov = nextFov; camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
  sun.position.set(pose.x - 65, pose.y + 100, pose.z + 45); sun.target.position.copy(car.position); sun.target.updateMatrixWorld();
  if (audio && running) {
    const t = audio.context.currentTime, speed = Math.abs(vehicle.speed);
    audio.gain.gain.setTargetAtTime(muted ? 0 : .008 + speed * .00045 + (input.up ? .006 : 0), t, .12);
    audio.oscillator.frequency.setTargetAtTime(42 + speed * 3.4 + (input.up ? 14 : 0), t, .1);
    audio.filter.frequency.setTargetAtTime(180 + speed * 12, t, .1);
  }
  profiler.measure('renderCPU', () => renderer.render(scene, camera));
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - previousTime) / 1000, 0, .1); previousTime = now;
  if (document.hidden) return;
  if (running) profiler.record('frame', (now - (frame.lastNow || now)));
  frame.lastNow = now;
  const wasLoading = loading;
  processStreaming();
  // Loading completion resets the clock; do not apply this frame’s old delta.
  if (wasLoading && !loading) { render(0); return; }
  if (!running) { if (now - idleRenderAt < (loading ? 100 : 200)) return; idleRenderAt = now; }
  if (running && drivable()) {
    accumulator += dt;
    const obstacles = nearbyObstacles();
    while (accumulator >= FIXED_DT) {
      stepVehicle(vehicle, input, world, obstacles);
      vehiclePresentation.advance(vehicle, FIXED_DT); accumulator -= FIXED_DT;
    }
    processBreakage(); debris.update(dt, world); treeBreakage.update(dt, world);
    if (vehicle.landings > reportedLanding) {
      reportedLanding = vehicle.landings;
      if (vehicle.airDistance > 25) toast(`${vehicle.airRoll > Math.PI ? 'Barrel roll! · ' : ''}${Math.round(vehicle.airDistance)} m jump · ${vehicle.airtime.toFixed(1)} seconds of air`);
    }
    streamWorld(); uiTime += dt; mapTime += dt;
    if (uiTime > .12) { uiTime = 0; updateHUD(); }
    if (mapTime > (coarse ? .6 : .3)) { mapTime = 0; drawMap(); }
  }
  render(running ? dt : 0);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); toast('Graphics paused. Reload to restore the drive.'); });

syncSeed(); syncSound(); beginWorldLoad(); resetCamera(); updateHUD(); drawMap(); render(0);
requestAnimationFrame(frame);

profiler.record('initialLoad', performance.now() - bootStarted);
if (testMode) window.__driveTest = { snapshot: () => {
  let carMeshes = 0; car.traverse(o => { if (o.isMesh) carMeshes++; });
  let hiddenProps = 0;
  for (const chunk of chunks.values()) for (const [id, refs] of chunk.propInstances) {
    if (!world.brokenProps.has(id)) continue;
    const hidden = refs.every(({ mesh, index }) => { mesh.getMatrixAt(index, matrix); return matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0; });
    if (hidden) hiddenProps++;
  }
  return { metrics: profiler.snapshot(), draws: renderer.info.render.calls, triangles: renderer.info.render.triangles, carMeshes, chunks: chunks.size, farTiles: farTiles.size, loading, generation, streamError, pending: pending.size, queued: jobs.length, carBatching: carBatching.map(({ before, after }) => ({ before, after })), vehicle: { ...vehicle }, renderPose: { ...vehiclePresentation.pose }, debris: debris.count, fallingTrees: treeBreakage.count, sound: audio ? { muted, played: audio.breaks.played, active: audio.breaks.active, masterGain: audio.master.gain.value } : null, brokenProps: world.brokenProps.size, hiddenProps, accumulator, cameraError: cameraPosition.distanceTo(desiredCamera) + cameraTarget.distanceTo(look), camera: cameraPosition.toArray(), target: cameraTarget.toArray() };
} };
