import * as THREE from 'three';

// The Light Cycle's wall of light: an upright ribbon stretched from the ground
// under the tail up to the emitter, written into the world as the bike rides.
// Each sample keeps the pose the bike had when it passed, so a lean twists the
// ribbon and a jump lifts it off the ground. It leaves hot and pale, cools to
// cyan, and after a few seconds sinks and breaks up from the far end.
//
// There's no bloom in this renderer, so the glow is drawn: one strip of vertices
// is drawn five times (instances, so one draw call and one shader), back to
// front: a pool of light on the ground, a soft halo, the wall, then a bright
// rail along its base and top. The rails and halo turn to face the camera, so
// the ribbon still reads when the chase camera sees the wall edge on.
//
// A sample is written once and the shader ages it, so a frame's only CPU cost is
// the newest sample. Samples are never moved until the buffer's end is reached.
export const TRAIL_LIFE = 6;     // seconds a sample lasts
export const TRAIL_SPACING = 1;  // metres between samples, at least
export const TRAIL_CAPACITY = 1024; // live samples: 6 s at 500 km/h is 834

const SLOTS = TRAIL_CAPACITY * 2; // room to run before compacting
const STRIDE = 15;                // floats per vertex: see the attributes below
const LAYERS = 5;                 // ground, halo, wall, base rail, top rail
const POOL_WIDTH = 1.5;           // metres either side of the ribbon
const PERIOD = 4096;              // metres: the step the distance is wound back by, once it's too big for a float

const vertexShader = /* glsl */ `
  attribute vec3 aBase, aTop, aDir;
  attribute float aGround, aAlong, aBirth, aBoost, aStrength, aSide, aLayer;
  uniform float uTime, uLife, uPixels, uHead, fogNear, fogFar;
  varying vec2 vUv;
  varying float vAlong, vAge, vLife, vBoost, vStrength, vLayer, vFacing, vFade, vLift;
  void main() {
    float age = max(0., uTime - aBirth), life = clamp(age / uLife, 0., 1.), heat = exp(-age * 5.);
    // It rises as the bike gets going, and sinks in the last part of its life.
    float sink = smoothstep(.62, 1., life);
    vec3 top = mix(aBase, aTop, smoothstep(0., .5, aStrength) * (1. - sink * sink));
    vec4 view;
    vFacing = 1.;
    if (aLayer < .5) { // the pool of light, flat on the ground either side
      vec3 flat_ = vec3(aDir.z, 0., -aDir.x);
      float size = length(flat_);
      flat_ = size > 1e-4 ? flat_ / size : vec3(1., 0., 0.);
      view = modelViewMatrix * vec4(aBase.x + flat_.x * aSide * ${POOL_WIDTH.toFixed(1)}, aGround + .07, aBase.z + flat_.z * aSide * ${POOL_WIDTH.toFixed(1)}, 1.);
    } else if (aLayer > 1.5 && aLayer < 2.5) { // the wall itself
      view = modelViewMatrix * vec4(aSide < 0. ? aBase : top, 1.);
      vec3 normal = cross(aDir, top - aBase);
      float size = length(normal);
      vFacing = size > 1e-4 ? abs(dot(normalize(mat3(modelViewMatrix) * normal), normalize(view.xyz))) : 1.;
    } else { // halo and rails: a strip about a line, turned to face the camera
      vec3 line = aLayer < 1.5 ? (aBase + top) * .5 : aLayer < 3.5 ? aBase : top;
      view = modelViewMatrix * vec4(line, 1.);
      vec3 across = cross(mat3(modelViewMatrix) * aDir, normalize(view.xyz));
      float size = length(across);
      across = size > 1e-4 ? across / size : vec3(1., 0., 0.);
      float width = aLayer < 1.5 ? 1.25
        : aLayer < 3.5 ? mix(.022, .05, aBoost)
        : mix(.035, .06, aBoost) * (1. + heat * .8); // a comet's head at the tail light
      // Never thinner than about 2.5 pixels, however far away.
      float pixel = -view.z * 2. / (projectionMatrix[1][1] * uPixels);
      if (aLayer > 1.5) width = max(width, pixel * 1.25);
      view.xyz += across * aSide * width;
    }
    gl_Position = projectionMatrix * view;
    float reach = length(view.xyz);
    // Thin out as it passes the camera (a chase camera rides right above it), and
    // into the distance like everything else: the fog here fades it, not tints it.
    float near = aLayer > 2.5 ? smoothstep(.8, 3., reach) : aLayer > 1.5 ? smoothstep(1., 4., reach) : smoothstep(2., 12., reach);
    // The glow on the ground and in the air opens out from the bike, not all at once.
    float behind = uHead - aAlong;
    if (aLayer < 1.5) near *= smoothstep(0., aLayer < .5 ? 10. : 4., behind);
    vFade = near * (1. - smoothstep(fogNear, fogFar, -view.z));
    vUv = vec2(aSide, aSide * .5 + .5);
    vAlong = aAlong; vAge = age; vLife = life; vBoost = aBoost; vStrength = aStrength; vLayer = aLayer;
    vLift = 1. - smoothstep(.4, 3.5, aBase.y - aGround); // the pool goes as the ribbon leaves the ground
  }`;

const fragmentShader = /* glsl */ `
  uniform float uTime, uDay;
  varying vec2 vUv;
  varying float vAlong, vAge, vLife, vBoost, vStrength, vLayer, vFacing, vFade, vLift;
  const vec3 CYAN = vec3(.03, .78, 1.), HOT = vec3(.82, .98, 1.), BLACK = vec3(.002, .004, .012);
  float random(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float heat = exp(-vAge * 5.);
    float strength = vStrength * (1. - smoothstep(.8, 1., vLife)) * vFade;
    // Energy flowing away from the bike: a bright band about every 15 m.
    float flow = pow(.5 + .5 * sin(vAlong * .4189 + uTime * 9.), 18.);
    float u = abs(vUv.x);
    // Written premultiplied: alpha 0 adds light, alpha 1 replaces what's behind.
    vec3 color; float alpha = 0.;
    if (vLayer < .5) {
      float pool = 1. - u * u; pool *= pool;
      color = CYAN * pool * (.11 + heat * .12 + vBoost * .1 + flow * .06) * vLift;
    } else if (vLayer < 1.5) {
      float halo = exp(-u * u * 5.) - exp(-5.);
      color = CYAN * halo * (.07 + heat * .14 + vBoost * .06);
    } else if (vLayer < 2.5) {
      float t = vUv.y;
      // Fine scan lines, gone before they would shimmer, and long filaments.
      float lines = 1. - smoothstep(.04, .14, fwidth(t * 9.));
      float scan = mix(1., .78 + .44 * step(.5, fract(t * 9.)), lines);
      float filament = .86 + .14 * sin(vAlong * 1.9 + 3. * sin(vAlong * .23));
      float body = mix(.05, .3, t * t) * scan * filament + heat * .18 + flow * .22;
      // Looked along, a sheet of light gathers: the same glow through more of it.
      float gather = min(2.2, 1. / (vFacing + .3));
      vec3 lit = mix(CYAN, HOT, clamp(heat * .45 + flow * .4, 0., 1.)) * body * gather;
      // Boosting, the wall is black, with neon along its edges and a faint flow.
      float edge = smoothstep(.9, 1., t) + smoothstep(.1, 0., t);
      vec3 dark = BLACK + CYAN * (edge * 1.1 + flow * .18);
      color = mix(lit, dark, vBoost);
      alpha = mix(body * .3, .94, vBoost);
      // The last third of its life, it breaks up into pieces.
      float piece = random(vec2(floor(mod(vAlong, ${PERIOD.toFixed(1)}) * 1.4), floor(t * 7.)));
      float keep = smoothstep(piece, piece + .16, (1. - vLife) * 3.);
      color *= keep; alpha *= keep;
    } else {
      float core = smoothstep(.6, .12, u), fringe = exp(-u * u * 3.5) - exp(-3.5);
      float level = vLayer < 3.5 ? mix(.42, 1., vBoost) : 1.;
      color = (HOT * core * (.8 + heat * .4) + CYAN * fringe * (.7 + flow * .5)) * level;
    }
    // By day there's light behind it to wash out: its colour covers what it adds to.
    alpha = max(alpha, min(1., max(color.r, max(color.g, color.b))) * uDay);
    gl_FragColor = vec4(color * strength, alpha * strength);
  }`;

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Riding on water: a rooster tail behind the rear tyre, into a particle pool of
// its own (dust.mjs).
export function createWaterSpray(pool) {
  const color = new THREE.Color(.72, .96, 1);
  let carry = 0, seed = 1;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  return function emit(dt, car) {
    if (!car.skimming || !car.grounded) { carry = 0; return; }
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), level = car.waterLevel + .1;
    const puff = (out, up, life, size) => {
      const side = (random() - .5) * out;
      pool.puff(car.x - fx * 1.6 + fz * side * .3, level, car.z - fz * 1.6 - fx * side * .3, car.vx * .86 + fz * side * 2, up * (.5 + random()), car.vz * .86 - fx * side * 2, life + random() * .4, size, color); // it trails the bike, or the camera would never see it
    };
    for (carry += dt * 45; carry >= 1; carry--) puff(2, 3, .4, .5);
  };
}

export function createCycleTrail(scene) {
  const data = new Float32Array(SLOTS * 2 * STRIDE);
  const buffer = new THREE.InterleavedBuffer(data, STRIDE).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.InstancedBufferGeometry();
  for (const [name, size, offset] of [['aBase', 3, 0], ['aTop', 3, 3], ['aDir', 3, 6], ['aGround', 1, 9], ['aAlong', 1, 10], ['aBirth', 1, 11], ['aBoost', 1, 12], ['aStrength', 1, 13], ['aSide', 1, 14]]) {
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
  }
  geometry.setAttribute('aLayer', new THREE.InstancedBufferAttribute(Float32Array.from({ length: LAYERS }, (_, i) => i), 1));
  geometry.instanceCount = LAYERS;
  const indices = new Uint16Array((SLOTS - 1) * 6);
  for (let i = 0; i < SLOTS - 1; i++) indices.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3], i * 6);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLife: { value: TRAIL_LIFE }, uPixels: { value: 720 }, uHead: { value: 0 }, uDay: { value: 0 } }]);
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Light Cycle wall of light'; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 2;
  scene.add(mesh);

  // Live samples are start..end-1. The last is the head, which follows the
  // emitter; the one before it (the "anchor") is the last to stay put.
  let start = 0, end = 0, clock = 0, along = 0, boost = 0, dark = false, warming = false;
  let dirX = 0, dirY = 0, dirZ = 1, lastX = 0, lastZ = 0;
  const offset = sample => sample * 2 * STRIDE;
  function write(sample, s, baseY, leftY, rightY, strength) {
    for (let side = 0; side < 2; side++) {
      const at = offset(sample) + side * STRIDE;
      data[at] = s.base.x; data[at + 1] = baseY; data[at + 2] = s.base.z;
      data[at + 3] = s.top.x; data[at + 4] = s.top.y; data[at + 5] = s.top.z;
      data[at + 6] = dirX; data[at + 7] = dirY; data[at + 8] = dirZ;
      data[at + 9] = side ? rightY : leftY;
      data[at + 10] = along; data[at + 11] = clock; data[at + 12] = boost; data[at + 13] = strength;
      data[at + 14] = side ? 1 : -1;
    }
  }
  // Back to the buffer's start; the whole buffer then goes up once.
  function compact() {
    data.copyWithin(0, offset(start), offset(end));
    end -= start; start = 0;
  }
  const birthAt = sample => data[offset(sample) + 11];
  function clear() {
    start = end = 0; along = 0; boost = 0; dark = false;
    geometry.setDrawRange(0, 0);
    mesh.visible = warming;
  }
  // s: the emitter (top) and the point below it (base) in the world, the bike's
  // heading and forward speed, whether it's boosting, the canvas height in
  // pixels, the ground's height: groundAt(x, z), and how much daylight (0 to 1).
  function update(dt, s) {
    clock += dt;
    let dirty = end - 1, whole = false; // the head changes, at least
    if (along > 1 << 20) { // about 1000 km: keep the shader's float precise
      const shift = Math.floor(along / PERIOD) * PERIOD;
      for (let i = start; i < end; i++) for (let side = 0; side < 2; side++) data[offset(i) + side * STRIDE + 10] -= shift;
      along -= shift; whole = true;
    }
    boost += ((s.boost ? 1 : 0) - boost) * (1 - Math.exp(-dt * 14));
    const strength = smoothstep(2, 14, s.speed);
    const sideX = Math.cos(s.heading) * POOL_WIDTH, sideZ = -Math.sin(s.heading) * POOL_WIDTH;
    const leftY = s.groundAt(s.base.x - sideX, s.base.z - sideZ), rightY = s.groundAt(s.base.x + sideX, s.base.z + sideZ);
    // A wheelie or a lean can swing the point under the tail into the ground.
    const baseY = Math.max(s.base.y, (leftY + rightY) / 2 + .03);
    // Moved further than it could have ridden: a recovery.
    const jump = end > 0 && Math.hypot(s.top.x - lastX, s.top.z - lastZ) > 3 + 3 * Math.abs(s.speed) * dt;
    lastX = s.top.x; lastZ = s.top.z;
    if (end === 0) {
      dirX = Math.sin(s.heading); dirY = 0; dirZ = Math.cos(s.heading);
      write(0, s, baseY, leftY, rightY, 0); write(1, s, baseY, leftY, rightY, 0);
      start = 0; end = 2; dirty = 0; dark = true;
    } else if (jump || (strength === 0 && !dark)) {
      // A break: nothing joins the last lit sample to what comes next, however
      // far apart they are. A dark copy of the old head where it stood, then a
      // dark anchor and head here: the quad between those two dark ones is the join.
      if (end + 3 > SLOTS) { compact(); whole = true; }
      const from = offset(end - 1);
      data.copyWithin(offset(end), from, from + 2 * STRIDE);
      data[offset(end) + 13] = data[offset(end) + STRIDE + 13] = 0;
      end++;
      write(end, s, baseY, leftY, rightY, 0); write(end + 1, s, baseY, leftY, rightY, 0);
      end += 2; dark = true;
    } else if (dark && strength === 0) {
      // Standing or reversing: the dark anchor and head just follow it.
      write(end - 2, s, baseY, leftY, rightY, 0); write(end - 1, s, baseY, leftY, rightY, 0);
      dirty = end - 2;
    } else {
      const anchor = offset(end - 2);
      const dx = s.top.x - data[anchor + 3], dy = s.top.y - data[anchor + 4], dz = s.top.z - data[anchor + 5], moved = Math.hypot(dx, dy, dz);
      if (moved > 1e-3) { dirX = dx / moved; dirY = dy / moved; dirZ = dz / moved; }
      along = data[anchor + 10] + moved;
      dark = false;
      write(end - 1, s, baseY, leftY, rightY, strength);
      if (moved >= TRAIL_SPACING) {
        if (end >= SLOTS) { compact(); whole = true; }
        write(end, s, baseY, leftY, rightY, strength); end++;
      }
    }
    while (end - start > 3 && (end - start > TRAIL_CAPACITY || birthAt(start) + TRAIL_LIFE < clock)) start++;
    if (whole) buffer.clearUpdateRanges();
    else buffer.addUpdateRange(offset(dirty), offset(end) - offset(dirty));
    buffer.needsUpdate = true;
    geometry.setDrawRange(start * 6, (end - start - 1) * 6);
    uniforms.uTime.value = clock; uniforms.uPixels.value = s.pixels; uniforms.uHead.value = along; uniforms.uDay.value = s.daylight ?? 0;
    mesh.visible = true;
  }
  // Drawn once during the load's warm-up, so its shader doesn't stall the first ride.
  function warm(on) {
    warming = on;
    if (on) { mesh.visible = true; if (end === 0) geometry.setDrawRange(0, 6); } else if (end === 0) clear();
  }
  return {
    update, clear, warm, mesh,
    get count() { return end - start; },
    get length() { return end > start ? along - data[offset(start) + 10] : 0; },
    // The ribbon's samples as they stand, oldest first: what the tests look at.
    samples() {
      const list = [];
      for (let i = start; i < end; i++) { const at = offset(i); list.push({ x: data[at + 3], y: data[at + 4], z: data[at + 5], baseY: data[at + 1], along: data[at + 10], boost: data[at + 12], strength: data[at + 13], birth: birthAt(i) }); }
      return list;
    },
  };
}
