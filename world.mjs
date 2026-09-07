// Shared, deterministic world and vehicle simulation. No browser or renderer required.
export const CHUNK = 96;
export const GRID = 4;
export const ROAD_SPACING = 420;
export const ROAD_HALF = 4.7;
export const FIXED_DT = 1 / 120;
export const FEATURE_SPACING = CHUNK * 3;
export const SPEED_LIMIT = 78; // Downhill cap; level-road cruising reaches ~240 km/h.
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const mix = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
export function hash(x, z, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function noise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  // Quintic interpolation keeps the first and second derivatives continuous.
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const u = fade(x - ix), v = fade(z - iz);
  return mix(mix(hash(ix, iz, seed), hash(ix + 1, iz, seed), u), mix(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), u), v);
}

export function createWorld(seed) {
  const phase = (seed % 10000) * .0006283185;
  const roadCenter = (s, band, dir) => {
    const p = phase + (dir === 'x' ? 1.8 : 0);
    const a = p + band * 1.71, b = p * .7 + band * 2.13;
    return band * ROAD_SPACING + 35 * (Math.sin(s * .0028 + a) - Math.sin(a)) + 12 * (Math.sin(s * .0065 + b) - Math.sin(b));
  };
  function roadAt(x, z) {
    let result = { d: Infinity, x, z, dir: 'z', band: 0, s: z };
    for (let k = -1; k <= 1; k++) {
      const bz = Math.round(x / ROAD_SPACING) + k, bx = Math.round(z / ROAD_SPACING) + k;
      const cx = roadCenter(z, bz, 'z'), cz = roadCenter(x, bx, 'x');
      if (Math.abs(x - cx) < result.d) result = { d: Math.abs(x - cx), x: cx, z, dir: 'z', band: bz, s: z };
      if (Math.abs(z - cz) < result.d) result = { d: Math.abs(z - cz), x, z: cz, dir: 'x', band: bx, s: x };
    }
    return result;
  }
  function mountainAt(x, z) { return smoothstep(.43, .75, noise(x * .00048 + 8.3, z * .00048 - 9.4, seed + 51)); }
  const featureCache = new Map();
  const starterRamp = { id: 'first-jump', type: 'ramp', x: roadCenter(68, 0, 'z') - 19, z: 68, heading: Math.atan2(roadCenter(69, 0, 'z') - roadCenter(67, 0, 'z'), 2), width: 10, length: 24, rise: 5.2, back: 10 };
  const starterTower = { id: 'first-lookout', type: 'lookout', x: roadCenter(145, 0, 'z') + 37, z: 145, heading: .15 };
  function featureAtCell(cx, cz) {
    const key = `${cx},${cz}`;
    if (featureCache.has(key)) return featureCache.get(key);
    const rng = random((hash(cx, cz, seed + 303) * 4294967296) >>> 0);
    let x = (cx + .5) * FEATURE_SPACING + (rng() - .5) * 60, z = (cz + .5) * FEATURE_SPACING + (rng() - .5) * 60;
    const road = roadAt(x, z);
    if (road.d < 35) { if (road.dir === 'z') x = road.x + Math.sign(x - road.x || 1) * 36; else z = road.z + Math.sign(z - road.z || 1) * 36; }
    x = clamp(x, cx * FEATURE_SPACING + 85, (cx + 1) * FEATURE_SPACING - 85);
    z = clamp(z, cz * FEATURE_SPACING + 85, (cz + 1) * FEATURE_SPACING - 85);
    if (roadAt(x, z).d < 30) {
      let best = { x, z, d: roadAt(x, z).d };
      for (const dx of [-40, 0, 40]) for (const dz of [-40, 0, 40]) {
        const px = clamp(x + dx, cx * FEATURE_SPACING + 85, (cx + 1) * FEATURE_SPACING - 85);
        const pz = clamp(z + dz, cz * FEATURE_SPACING + 85, (cz + 1) * FEATURE_SPACING - 85), d = roadAt(px, pz).d;
        if (d > best.d) best = { x: px, z: pz, d };
      }
      x = best.x; z = best.z;
    }
    const kind = rng(), type = kind < .58 ? 'ramp' : kind < .82 ? 'camp' : 'lookout';
    const heading = (road.dir === 'x' ? Math.PI / 2 : 0) + (rng() - .5) * .6;
    const feature = { id: `site:${cx},${cz}`, type, x, z, heading, width: 9 + rng() * 3, length: 22 + rng() * 8, rise: 4.5 + rng() * 3, back: 12 };
    // A bounded cache speeds up terrain sampling without changing revisits.
    if (featureCache.size >= 256) featureCache.delete(featureCache.keys().next().value);
    featureCache.set(key, feature);
    return feature;
  }
  function featuresNear(x, z, radius = 190) {
    const result = [starterRamp, starterTower];
    for (let cx = Math.floor((x - radius) / FEATURE_SPACING); cx <= Math.floor((x + radius) / FEATURE_SPACING); cx++) {
      for (let cz = Math.floor((z - radius) / FEATURE_SPACING); cz <= Math.floor((z + radius) / FEATURE_SPACING); cz++) result.push(featureAtCell(cx, cz));
    }
    return result.filter(f => Math.hypot(f.x - x, f.z - z) < radius);
  }
  function rampLift(ramp, x, z) {
    if (ramp.type !== 'ramp') return 0;
    const { across, along } = featureLocal(ramp, x, z);
    if (along < 0 || along > ramp.length + ramp.back || Math.abs(across) > ramp.width / 2 + 7) return 0;
    const profile = along <= ramp.length ? Math.pow(along / ramp.length, 1.7) : 1 - smoothstep(0, ramp.back, along - ramp.length);
    // Dirt embankments blend every side into the landscape. The orange deck
    // is rendered on these same triangles, so no invisible ramp collider exists.
    return ramp.rise * profile * (1 - smoothstep(ramp.width / 2, ramp.width / 2 + 7, Math.abs(across)));
  }
  function rampAt(x, z) {
    for (const ramp of [starterRamp, featureAtCell(Math.floor(x / FEATURE_SPACING), Math.floor(z / FEATURE_SPACING))]) {
      if (ramp.type !== 'ramp') continue;
      const p = featureLocal(ramp, x, z);
      if (Math.abs(p.across) < ramp.width / 2 && p.along >= 0 && p.along <= ramp.length + 2) return ramp;
    }
    return null;
  }
  function reserved(x, z) {
    return featuresNear(x, z, 275).some(f => {
      const p = featureLocal(f, x, z);
      return f.type === 'ramp' ? Math.abs(p.across) < f.width / 2 + 9 && p.along > -30 && p.along < f.length + 220 : Math.hypot(p.across, p.along) < 18;
    });
  }
  function computeHeight(x, z) {
    const highland = (noise(x * .0016 + 17.4, z * .0016 - 5.3, seed + 11) - .5) * 30;
    const hills = (noise(x * .0045 - 11.7, z * .0045 + 19.1, seed + 23) - .5) * 24;
    const offroad = smoothstep(9, 34, roadAt(x, z).d);
    const rugged = smoothstep(.25, .65, noise(x * .0028 - 4, z * .0028 + 7, seed + 71));
    const rollers = (noise(x * .019 + 4.1, z * .019 + 3.2, seed + 31) - .5) * (1.2 + offroad * 10);
    const ridgeline = Math.sin(x * .055 + z * .037 + noise(x * .004, z * .004, seed + 72) * 5);
    const gullies = ridgeline * 5.8 * rugged * offroad;
    const m = mountainAt(x, z);
    const ridges = 1 - Math.abs(noise(x * .0018 + 18, z * .0018 - 21, seed + 61) * 2 - 1);
    const relief = 150 * m * m * (.45 + .55 * ridges);
    // Keep the natural height at spawn too. Flattening an arbitrary mountain
    // down to zero creates an artificial bowl with steep walls around the car.
    const feature = featureAtCell(Math.floor(x / FEATURE_SPACING), Math.floor(z / FEATURE_SPACING));
    return 12 + highland + hills + rollers + relief + gullies + rampLift(feature, x, z) + rampLift(starterRamp, x, z);
  }
  // Chunk boundaries revisit most of the same terrain samples. Retain those
  // heights so a faster car doesn't rebuild the whole horizon every 96 m.
  // Eviction is bounded; cache contents never affect procedural generation.
  const heightCache = new Map();
  function height(x, z) {
    if (!Number.isInteger(x) || !Number.isInteger(z)) return computeHeight(x, z);
    const key = `${x},${z}`;
    if (heightCache.has(key)) return heightCache.get(key);
    const h = computeHeight(x, z);
    if (heightCache.size >= 120000) {
      const oldest = heightCache.keys();
      for (let i = 0; i < 16000; i++) heightCache.delete(oldest.next().value);
    }
    heightCache.set(key, h); return h;
  }
  // Exactly the same triangles as the rendered 4 m terrain grid. This avoids
  // invisible bumps, wheel clipping, or a mismatch between visuals and physics.
  function surface(x, z) {
    const ix = Math.floor(x / GRID) * GRID, iz = Math.floor(z / GRID) * GRID;
    const u = (x - ix) / GRID, v = (z - iz) / GRID;
    const a = height(ix, iz), b = height(ix + GRID, iz), c = height(ix, iz + GRID), d = height(ix + GRID, iz + GRID);
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  function gradient(x, z) { return { x: (surface(x + 2, z) - surface(x - 2, z)) / 4, z: (surface(x, z + 2) - surface(x, z - 2)) / 4 }; }
  function woodlandAt(x, z) { return noise(x * .0031 - 13, z * .0031 + 27, seed + 87); }
  // Broad, continuous dry regions; elevation keeps sand out of the snow line.
  function desertAt(x, z) {
    return smoothstep(.46, .67, noise(x * .0009 + 31, z * .0009 - 17, seed + 191))
      * (1 - smoothstep(90, 117, height(x, z)));
  }
  function props(cx, cz) {
    const rng = random((hash(cx, cz, seed + 101) * 4294967296) >>> 0), list = [];
    // Fixed candidates and clearances make revisited chunks identical.
    for (let i = 0; i < 30; i++) {
      const x = cx * CHUNK + 9 + rng() * (CHUNK - 18), z = cz * CHUNK + 9 + rng() * (CHUNK - 18);
      const chance = rng(), size = .8 + rng() * .65, turn = rng() * Math.PI * 2;
      const woodland = woodlandAt(x, z), mountain = mountainAt(x, z), desert = desertAt(x, z);
      if (Math.hypot(x, z) < 24 || roadAt(x, z).d < 12 || reserved(x, z) || Math.hypot(...Object.values(gradient(x, z))) > .9) continue;
      if (list.some(p => Math.hypot(p.x - x, p.z - z) < 7.5)) continue;
      if (chance < .1 && mountain > .25) list.push({ id: `${cx},${cz}:${i}`, type: 'boulder', x, z, y: surface(x, z), size: size * 2.3, turn, r: size * 1.5, h: size * 2.6 });
      else if (chance < .22) list.push({ id: `${cx},${cz}:${i}`, type: 'rock', x, z, y: surface(x, z), size, turn, r: 0, h: .65 * size });
      else if (desert > .55) {
        if (chance < .72) list.push({ id: `${cx},${cz}:${i}`, type: 'cactus', x, z, y: surface(x, z), size, turn, r: .38 * size, h: 4.7 * size });
        else list.push({ id: `${cx},${cz}:${i}`, type: 'rock', x, z, y: surface(x, z), size: size * .7, turn, r: 0, h: .5 * size });
      }
      else if (chance < mix(.46, .95, smoothstep(.3, .75, woodland)) && mountain < .95) {
        list.push({ id: `${cx},${cz}:${i}`, type: 'tree', x, z, y: surface(x, z), size, turn, r: .24 * size, h: 6.8 * size });
      } else list.push({ id: `${cx},${cz}:${i}`, type: 'bush', x, z, y: surface(x, z), size, turn, r: 0, h: size });
    }
    for (const f of featuresNear(cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2, 100)) {
      if (Math.floor(f.x / CHUNK) !== cx || Math.floor(f.z / CHUNK) !== cz || f.type === 'ramp') continue;
      list.push({ ...f, y: surface(f.x, f.z), size: 1, turn: f.heading, r: f.type === 'camp' ? 3.6 : 2.1, h: f.type === 'camp' ? 5 : 11 });
    }
    return list;
  }
  return { seed, phase, height, surface, gradient, mountainAt, woodlandAt, desertAt, roadCenter, roadAt, props, featuresNear, rampLift, rampAt, reserved, starterRamp };
}

export function featureLocal(feature, x, z) {
  const dx = x - feature.x, dz = z - feature.z, s = Math.sin(feature.heading), c = Math.cos(feature.heading);
  return { across: dx * c - dz * s, along: dx * s + dz * c };
}
export function featurePoint(feature, across, along) {
  const s = Math.sin(feature.heading), c = Math.cos(feature.heading);
  return { x: feature.x + across * c + along * s, z: feature.z - across * s + along * c };
}

export function groundAt(world, x, z, heading) {
  const fx = Math.sin(heading), fz = Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
  const f = world.surface(x + fx * 1.36, z + fz * 1.36), b = world.surface(x - fx * 1.36, z - fz * 1.36);
  const l = world.surface(x + rx * .96, z + rz * .96), r = world.surface(x - rx * .96, z - rz * .96);
  return { y: Math.max(world.surface(x, z), (f + b + l + r) / 4) + .06, pitch: -Math.atan((f - b) / 2.72), roll: Math.atan((l - r) / 1.92) };
}
export function createVehicle(world, x = 0, z = 0, heading = 0) {
  const g = groundAt(world, x, z, heading);
  return { x, z, y: g.y, vx: 0, vz: 0, vy: 0, heading, steer: 0, grounded: true, groundY: g.y, pitch: g.pitch, roll: g.roll, distance: 0, airtime: 0, bestAir: 0, airDistance: 0, bestJump: 0, landings: 0, jumps: 0, jumpBuffer: 0, coyote: .1, jumpHeld: false, landLock: 0, impact: 0, speed: 0, onRoad: true };
}
export function resolveObstacles(car, obstacles) {
  for (let pass = 0; pass < 3; pass++) for (const o of obstacles) {
    // Small rocks are forgiving ground detail. Trees collide only with their
    // trunks; airborne cars can clear props, and canopies never form walls.
    if (!o.r || car.y + .2 > o.y + o.h || car.y + 2.3 < o.y) continue;
    const dx = car.x - o.x, dz = car.z - o.z, radius = o.r + .93;
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    const nx = d > 1e-6 ? dx / d : -Math.sin(car.heading), nz = d > 1e-6 ? dz / d : -Math.cos(car.heading);
    car.x += nx * (radius - d + .002); car.z += nz * (radius - d + .002);
    const approach = car.vx * nx + car.vz * nz;
    if (approach < 0) { car.vx -= nx * approach * 1.08; car.vz -= nz * approach * 1.08; car.impact = Math.max(car.impact, -approach * .012); }
  }
}
export function stepVehicle(car, input, world, obstacles, dt = FIXED_DT) {
  const throttle = Number(!!input.up) - Number(!!input.down), brake = !!input.brake;
  const jumpPressed = !!input.jump && !car.jumpHeld;
  car.jumpHeld = !!input.jump;
  car.jumpBuffer = jumpPressed ? .16 : Math.max(0, car.jumpBuffer - dt);
  car.landLock = Math.max(0, car.landLock - dt);
  car.coyote = car.grounded ? .1 : Math.max(0, car.coyote - dt);
  if (car.jumpBuffer > 0 && car.coyote > 0) {
    car.vy = 10 + clamp(car.vy, 0, 2); car.grounded = false; car.coyote = 0;
    car.jumpBuffer = 0; car.landLock = .16; car.airtime = 0; car.airDistance = 0; car.jumps++;
  }
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const forward = car.vx * fx + car.vz * fz, speed = Math.abs(forward);
  car.onRoad = world.roadAt(car.x, car.z).d < ROAD_HALF;
  const authority = car.grounded ? 1 : .16;
  let acceleration = 0;
  if (throttle > 0) acceleration = forward < -.5 ? 45 : 34 * (1 - smoothstep(56, 72, forward));
  if (throttle < 0) acceleration = forward > .5 ? -55 : -18 * (1 - smoothstep(10, 16, -forward));
  car.vx += fx * acceleration * authority * dt; car.vz += fz * acceleration * authority * dt;
  const targetSteer = Number(!!input.left) - Number(!!input.right);
  car.steer = mix(car.steer, targetSteer, 1 - Math.exp(-10 * dt));
  car.heading += car.steer * (brake ? 2.1 : 1.7) * Math.min(speed / 5, 1) / (1 + speed * .032) * Math.sign(forward || 1) * authority * dt;
  const nx = Math.sin(car.heading), nz = Math.cos(car.heading), along = car.vx * nx + car.vz * nz;
  const grip = car.grounded ? (brake ? 1.9 : car.onRoad ? 12 : 8) : .2;
  const decay = Math.exp(-grip * dt);
  car.vx = nx * along + (car.vx - nx * along) * decay; car.vz = nz * along + (car.vz - nz * along) * decay;
  const drag = Math.exp(-(car.grounded ? brake ? 1.6 : car.onRoad ? .11 : .19 : .015) * dt);
  car.vx *= drag; car.vz *= drag;
  if (car.grounded) {
    const g = world.gradient(car.x, car.z);
    // Hill hold at rest; the engine comfortably exceeds downhill gravity.
    if (throttle || speed > .5) { car.vx -= g.x * 8 * dt; car.vz -= g.z * 8 * dt; }
    if (!throttle && Math.hypot(car.vx, car.vz) < .35) { car.vx = 0; car.vz = 0; }
  }
  const horizontal = Math.hypot(car.vx, car.vz);
  if (horizontal > SPEED_LIMIT) { car.vx *= SPEED_LIMIT / horizontal; car.vz *= SPEED_LIMIT / horizontal; }
  const oldX = car.x, oldZ = car.z;
  car.x += car.vx * dt; car.z += car.vz * dt;
  if (!car.grounded) { car.vy -= 22 * dt; car.y += car.vy * dt; car.airtime += dt; car.airDistance += Math.hypot(car.vx, car.vz) * dt; car.bestAir = Math.max(car.bestAir, car.airtime); }
  resolveObstacles(car, obstacles);
  const g = groundAt(world, car.x, car.z, car.heading);
  const ramp = world.rampAt?.(car.x, car.z);
  const rampPosition = ramp && featureLocal(ramp, car.x, car.z);
  const surfaceVy = clamp((g.y - car.groundY) / dt, -32, 32);
  if (car.grounded) {
    const rampSpeed = ramp ? car.vx * Math.sin(ramp.heading) + car.vz * Math.cos(ramp.heading) : 0;
    if (ramp && rampSpeed > 8 && rampPosition.along >= ramp.length - 1.5 && featureLocal(ramp, oldX, oldZ).along < ramp.length - 1.5) {
      car.grounded = false; car.airtime = 0; car.airDistance = 0; car.coyote = 0; car.landLock = .06;
      car.vy = clamp(Math.max(car.vy, rampSpeed * ramp.rise * 1.7 / ramp.length), 6, 28); car.y = Math.max(car.y, g.y) + .03;
    }
    // Ballistic separation at crests; no synthetic boost or per-frame snapback.
    else if (!ramp && !car.landLock && horizontal > 9 && car.y + car.vy * dt - 11 * dt * dt > g.y + .018) {
      car.grounded = false; car.airtime = 0; car.airDistance = 0; car.vy = clamp(car.vy, -3, 28); car.y += car.vy * dt;
    } else { car.y = g.y; car.vy = surfaceVy; }
  } else if (car.y <= g.y && (!car.landLock || car.vy < 0)) {
    car.impact = Math.max(car.impact, clamp(-car.vy * .016, 0, .3));
    car.bestJump = Math.max(car.bestJump, car.airDistance); car.landings++;
    car.y = g.y; car.vy = surfaceVy; car.grounded = true; car.landLock = .1;
  }
  // Rising terrain always supports the car, even during a jump's launch lock.
  car.y = Math.max(car.y, g.y);
  car.groundY = g.y;
  car.pitch = mix(car.pitch, car.grounded ? g.pitch : clamp(-car.vy * .025, -.28, .24), 1 - Math.exp(-(car.grounded ? 14 : 3) * dt));
  car.roll = mix(car.roll, car.grounded ? g.roll : 0, 1 - Math.exp(-12 * dt));
  car.impact *= Math.exp(-8 * dt);
  car.speed = car.vx * nx + car.vz * nz;
  car.distance += Math.hypot(car.x - oldX, car.z - oldZ);
}
export function recoverVehicle(car, world) {
  const road = world.roadAt(car.x, car.z);
  const origin = road.d < 55 ? road : car;
  for (let ring = 0; ring < 14; ring++) for (let i = 0; i < (ring ? 12 : 1); i++) {
    const x = origin.x + Math.cos(i * Math.PI / 6) * ring * 3, z = origin.z + Math.sin(i * Math.PI / 6) * ring * 3;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const nearby = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) nearby.push(...world.props(cx + dx, cz + dz));
    if (nearby.some(o => o.r && Math.hypot(x - o.x, z - o.z) < o.r + 3)) continue;
    if (Math.hypot(...Object.values(world.gradient(x, z))) > .6) continue;
    const { distance, bestAir, jumps, bestJump, landings } = car;
    Object.assign(car, createVehicle(world, x, z, car.heading), { distance, bestAir, jumps, bestJump, landings });
    return true;
  }
  return false;
}
