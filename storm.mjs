import * as THREE from 'three';

// Thunderstorms, in heavy rain only. Lightning strikes at random around the
// camera, from close by to 4 km off, more often the heavier the rain. Each
// strike flickers in two to four pulses (the scene's sky, fog and light flash
// with it, in game.mjs) while a jagged, branching bolt runs from the cloud
// base to the ground: a camera-facing ribbon with a soft glow, built once per
// strike and never fogged out. Its thunder arrives later by the distance at
// the speed of sound: a crack and a long roll close by, a low rumble far off.

const SOUND = 343; // m/s
const SEGMENTS = 22, BRANCHES = 3, BRANCH_SEGMENTS = 8;
const QUADS = SEGMENTS + BRANCHES * BRANCH_SEGMENTS; // segments, each a quad either side of its centre line

export function createLightning(scene) {
  // Two ribbons over the same path: a bright core and a soft glow. Each runs
  // along a centre line and fades out to its edges (vertex alpha), so where
  // segments overlap at a kink there's no hard-edged block.
  const ribbon = (edge, opacity, color) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(QUADS * 12 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(QUADS * 12 * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 3; scene.add(mesh);
    return { mesh, edge, opacity };
  };
  // Widths in screen pixels either side of the centre line.
  const core = { ...ribbon(.35, 1, new THREE.Color(1.6, 1.5, 2)), pixels: 1.6 }, glow = { ...ribbon(0, .35, new THREE.Color(.7, .65, 1)), pixels: 7 };
  let wait = 4, age = Infinity, pulses = [], strength = 0, distance = 0, strikes = 0;
  const strike = { x: 0, z: 0 }, point = new THREE.Vector3(), toCamera = new THREE.Vector3(), side = new THREE.Vector3(), along = new THREE.Vector3();

  // A jagged path: each step goes down and swerves at most about 35° off
  // vertical (kink), a random walk pinned at both ends so it still comes
  // down where it struck.
  function path(from, to, count, kink) {
    const drop = (from.y - to.y) / count, walk = [new THREE.Vector3()];
    for (let i = 1; i <= count; i++) walk.push(walk[i - 1].clone().add(new THREE.Vector3((Math.random() - .5) * 2 * kink * drop, 0, (Math.random() - .5) * 2 * kink * drop)));
    return walk.map((w, i) => {
      const t = i / count;
      return from.clone().lerp(to, t).add(w.sub(walk[count].clone().multiplyScalar(t))).add(new THREE.Vector3(0, i && i < count ? (Math.random() - .5) * drop * .4 : 0, 0));
    });
  }
  function build(paths, camera, metresPerPixel) {
    for (const { mesh, edge, pixels } of [core, glow]) {
      const position = mesh.geometry.attributes.position.array, color = mesh.geometry.attributes.color.array;
      position.fill(0); color.fill(0); let at = 0;
      const half = Math.max(pixels * metresPerPixel, pixels * .15);
      for (const { points, thin } of paths) for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        along.subVectors(b, a); toCamera.subVectors(camera.position, a);
        side.crossVectors(along, toCamera).normalize().multiplyScalar(half * (thin ? .6 : 1));
        // Four triangles per segment: each side, from the centre line out.
        for (const sign of [-1, 1]) for (const [p, out] of [[a, 0], [a, sign], [b, sign], [a, 0], [b, sign], [b, 0]]) {
          point.copy(p).addScaledVector(side, out);
          position.set([point.x, point.y, point.z], at * 3);
          const alpha = out ? edge : 1;
          color.set([alpha, alpha, alpha, alpha], at * 4); at++;
        }
      }
      mesh.geometry.attributes.position.needsUpdate = mesh.geometry.attributes.color.needsUpdate = true;
      mesh.geometry.setDrawRange(0, at);
    }
  }

  return {
    // storm: 0–1, how stormy it is here. ground(x, z): the land's height.
    // pixels: the drawing buffer's height, to size the bolt on screen.
    // Returns a new strike as { x, z, distance, close } when one happens.
    update(dt, storm, camera, ground, pixels = 1000) {
      age += dt;
      let struck = null;
      if (storm > .02) {
        wait -= dt;
        if (wait <= 0) {
          // About every 6 s in the heaviest rain, every 20 s or so at its edge.
          wait = (5 + 16 * (1 - storm)) * (.35 + Math.random() * 1.3);
          // Mostly ahead of the camera, where they can be seen.
          const yaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]);
          const angle = Math.random() < .65 ? yaw + (Math.random() - .5) * 2.2 : Math.random() * Math.PI * 2;
          distance = 250 + Math.pow(Math.random(), .8) * 3750;
          strike.x = camera.position.x + Math.sin(angle) * distance; strike.z = camera.position.z + Math.cos(angle) * distance;
          const floor = ground(strike.x, strike.z), top = Math.max(floor + 260, 380) + Math.random() * 80;
          const from = new THREE.Vector3(strike.x + (Math.random() - .5) * 120, top, strike.z + (Math.random() - .5) * 120);
          const to = new THREE.Vector3(strike.x, floor, strike.z);
          const main = path(from, to, SEGMENTS, .7), paths = [{ points: main }];
          for (let b = 0; b < BRANCHES; b++) {
            const start = main[2 + Math.floor(Math.random() * (SEGMENTS * .55))], drop = (top - floor) * (.15 + Math.random() * .25);
            const end = start.clone().add(new THREE.Vector3((Math.random() - .5) * drop * 1.4, -drop, (Math.random() - .5) * drop * 1.4));
            paths.push({ points: path(start, end, BRANCH_SEGMENTS, .9), thin: true });
          }
          // A few pixels across at any distance.
          build(paths, camera, 2 * distance * Math.tan(camera.fov * Math.PI / 360) / pixels);
          // Two to four flickers over about half a second, the first the brightest.
          pulses = [0]; for (let n = 1 + Math.floor(Math.random() * 3); n > 0; n--) pulses.push(pulses.at(-1) + .06 + Math.random() * .14);
          age = 0; strength = (.55 + .45 * storm) * (1 - .6 * Math.min(1, distance / 4000));
          struck = { x: strike.x, z: strike.z, distance, close: distance < 1100 }; strikes++;
        }
      }
      const flash = pulses.reduce((sum, at, i) => sum + (age >= at ? Math.exp(-(age - at) * 22) * (i ? .7 : 1) : 0), 0);
      const shown = age < (pulses.at(-1) ?? 0) + .25;
      for (const { mesh, opacity } of [core, glow]) { mesh.visible = shown && flash > .02; mesh.material.opacity = Math.min(1, flash * 1.3) * opacity; }
      this.flash = Math.min(1, flash) * strength;
      return struck;
    },
    flash: 0,
    get strikes() { return strikes; },
    // Where the latest bolt came down, and how far off.
    get last() { return { x: strike.x, z: strike.z, distance }; },
    // Drawn (as nothing) in the load-time warm-up frame, so the first bolt
    // doesn't stall while its shader sets up.
    warm(on) { core.mesh.visible = glow.mesh.visible = on; },
    clear() { age = Infinity; pulses = []; this.flash = 0; core.mesh.visible = glow.mesh.visible = false; },
  };
}

// Thunder, synthesized: brown noise (deep, rumbling) under a rolling envelope
// of overlapping peals, with a bright crack at the front of a close strike.
export function synthesizeThunder(close, seed, sampleRate = 44100) {
  const duration = close ? 6 : 7.5, samples = new Float32Array(Math.ceil(duration * sampleRate));
  let state = seed >>> 0, low = 0, lower = 0, slow = 0, peak = 0;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  // The roll: peals at random times, each a swell and a slow decay.
  const peals = Array.from({ length: close ? 7 : 5 }, (_, i) => ({ at: (close ? .05 : .4) + i * (close ? .45 : .8) + random() * .5, size: (close ? 1 : .8) * (1 - i * .09) * (.6 + random() * .5), decay: 1.4 + random() * 1.8 }));
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, white = random() * 2 - 1;
    low += (white - low) * .035; lower += (low - lower) * .02; slow += (random() * 2 - 1 - slow) * .0004;
    let roll = 0;
    for (const { at, size, decay } of peals) if (t > at) roll += size * Math.min(1, (t - at) / .12) * Math.exp(-(t - at) * decay);
    // The rumble flutters as the sound comes in from different parts of the bolt.
    const rumble = (lower * 7 + low * 1.5) * roll * (.7 + 6 * Math.abs(slow));
    const crack = close ? (white - low) * Math.exp(-t * 18) * Math.min(1, t / .004) * 1.4 : 0;
    const tail = Math.min(1, (duration - t) / .5);
    samples[i] = (rumble + crack) * tail; peak = Math.max(peak, Math.abs(samples[i]));
  }
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i] / peak * 1.4) * .9;
  return samples;
}

export function createThunder(context, output) {
  const make = (close, seed) => {
    const data = synthesizeThunder(close, seed, context.sampleRate), buffer = context.createBuffer(1, data.length, context.sampleRate);
    buffer.copyToChannel(data, 0); return buffer;
  };
  const near = [make(true, 101), make(true, 202)], far = [make(false, 303), make(false, 404)];
  return {
    // Heard distance / 343 m/s after the flash: quieter, and duller (a lower
    // cutoff and a touch slower) the further off it struck. pan: −1 to 1.
    play({ distance, close }, pan = 0) {
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain(), panner = context.createStereoPanner();
      const set = close ? near : far;
      source.buffer = set[Math.floor(Math.random() * set.length)];
      source.playbackRate.value = 1 - Math.min(.25, distance / 16000);
      filter.type = 'lowpass'; filter.frequency.value = 2400 * Math.exp(-distance / 1300) + 160;
      gain.gain.value = .5 * Math.min(1, 500 / distance) ** .8;
      panner.pan.value = Math.max(-1, Math.min(1, pan)) * .7;
      source.connect(filter).connect(gain).connect(panner).connect(output);
      source.start(context.currentTime + distance / SOUND);
      source.onended = () => { source.disconnect(); panner.disconnect(); };
    },
  };
}
