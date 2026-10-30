// Diagnostic code appended to game.mjs by the audit runner, never shipped.
const audit = { active: false, rows: [], gpu: [], events: [], longTasks: [], longFrames: [], steps: 0, correction: 0 };
const auditVec = new THREE.Vector3(), auditCam = new THREE.Vector3();
const auditRay = new THREE.Raycaster(), auditDown = new THREE.Vector3(0, -1, 0), auditInverse = new THREE.Matrix4();
const auditTerrain = new WeakMap();
function auditAlignment(p) {
  const a = audit.alignment;
  a.samples++;
  auditVec.set(0, 1, 0).applyMatrix4(car.matrixWorld);
  a.carHorizontalError = Math.max(a.carHorizontalError, Math.hypot(auditVec.x - p.x, auditVec.z - p.z));
  auditInverse.copy(camera.matrixWorld).invert();
  a.cameraMatrixError = Math.max(a.cameraMatrixError, ...auditInverse.elements.map((v, i) => Math.abs(v - camera.matrixWorldInverse.elements[i])));
  a.streamCenterError = Math.max(a.streamCenterError, Math.hypot(streamUniforms.uStreamCenter.value.x - p.x, streamUniforms.uStreamCenter.value.y - p.z));
  a.waterClockError = Math.max(a.waterClockError, Math.abs(waterSystem.causticUniforms.uTime.value - p.time));
  if (p.time < (audit.lastPoseTime ?? -Infinity)) a.backwardTime++;
  audit.lastPoseTime = p.time;
  const chunk = chunks.get(`${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`);
  if (!chunk?.group.visible) { a.missingGround++; return; }
  const matrix = chunk.ground.matrixWorld.elements, prior = auditTerrain.get(chunk.ground);
  if (prior && matrix.some((v, i) => v !== prior[i])) a.movedTerrain++;
  auditTerrain.set(chunk.ground, [...matrix]);
  auditRay.set(auditVec.set(p.x, 10000, p.z), auditDown);
  const hit = auditRay.intersectObject(chunk.ground, false)[0];
  if (!hit) { a.missingGround++; return; }
  a.terrainHeightError = Math.max(a.terrainHeightError, Math.abs(hit.point.y - world.surface(p.x, p.z)));
  if (vehicle.grounded && p.transform === 0 && Math.abs(p.y - p.groundY) < 1e-9) a.supportError = Math.max(a.supportError, Math.abs(p.y - groundAt(supportWorld(), p.x, p.z, p.heading).y));
}
const auditRecord = profiler.record.bind(profiler);
profiler.record = (name, ms, detail) => {
  if (audit.active && audit.costs) audit.costs[name] = (audit.costs[name] || 0) + ms;
  auditRecord(name, ms, detail);
};
const auditKeepCamera = keepCameraInView;
keepCameraInView = (...args) => {
  auditCam.copy(cameraPosition); auditKeepCamera(...args);
  audit.correction = auditCam.distanceTo(cameraPosition);
};
if (gpuTimer) {
  const drain = gpuTimer.drain.bind(gpuTimer);
  gpuTimer.drain = () => { const values = drain(); if (audit.active) audit.gpu.push(...values); return values; };
}
for (const [type, key] of [['longtask', 'longTasks'], ['long-animation-frame', 'longFrames']]) {
  try { new PerformanceObserver(list => {
    if (audit.active) for (const e of list.getEntries()) audit[key].push({ at: e.startTime - audit.startAt, duration: e.duration, blocking: e.blockingDuration });
  }).observe({ type }); } catch {}
}
for (const type of ['keydown', 'keyup']) addEventListener(type, e => {
  if (!audit.active || e.repeat || !['KeyA', 'KeyD', 'KeyW', 'KeyE'].includes(e.code)) return;
  audit.events.push({ type, code: e.code, at: performance.now() - audit.startAt, browserDelay: performance.now() - e.timeStamp,
    steer: vehiclePresentation.pose.steer, target: type === 'keyup' ? 0 : e.code === 'KeyA' ? 1 : -1 });
});
function auditFrameStart(now) {
  audit.interval = now - (audit.previous ?? now); audit.previous = now;
  audit.beforeTime = vehicle.time; audit.steps = 0; audit.correction = 0; audit.costs = {};
}
function auditReplay() {
  // Same path/speed for rendering + streaming isolation; not a physics test.
  const speed = audit.replaySpeed, heading = audit.heading;
  const vx = Math.sin(heading) * speed, vz = Math.cos(heading) * speed;
  vehicle.x += vx * FIXED_DT; vehicle.z += vz * FIXED_DT;
  const g = groundAt(world, vehicle.x, vehicle.z, heading);
  Object.assign(vehicle, { heading, y: g.y, groundY: g.y, pitch: g.pitch, roll: g.roll, speed, vx, vz, vy: 0,
    grounded: true, floating: false, flying: false, overWater: false, transform: 0, flight: 0, boatMode: false,
    onRoad: true, onDirt: false, steer: 0, boost: 0, lift: 0, yaw: 0 });
  vehicle.time += FIXED_DT; vehicle.distance += speed * FIXED_DT;
}
function auditFrameEnd(now, cpu) {
  if (!audit.active || !running) return;
  const p = vehiclePresentation.pose, fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  const dx = p.x - cameraPosition.x, dz = p.z - cameraPosition.z;
  auditVec.set(p.x, p.y + 1, p.z).project(camera);
  const row = { at: now - audit.startAt, dt: audit.interval, cpu, simDelta: (vehicle.time - audit.beforeTime) * 1000,
    steps: audit.steps, blocked: !drivable(), clipped: Math.max(0, audit.interval - 100), speed: vehicle.speed * 3.6,
    x: p.x, y: p.y, z: p.z, heading: p.heading, grounded: vehicle.grounded, floating: vehicle.floating, water: Boolean(vehicle.overWater),
    poseLag: (vehicle.time - p.time) * 1000, poseGap: Math.hypot(vehicle.x - p.x, vehicle.z - p.z), steer: p.steer,
    cameraCorrection: audit.correction, cameraBehind: dx * fx + dz * fz, cameraDistance: Math.hypot(dx, dz), screenX: auditVec.x, screenY: auditVec.y,
    missingGround: !chunks.has(`${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`),
    missingAhead1s: !chunks.has(`${Math.floor((p.x + fx * Math.abs(p.speed)) / CHUNK)},${Math.floor((p.z + fz * Math.abs(p.speed)) / CHUNK)}`),
    pending: pending.size, queued: jobs.length, completed: completed.length, chunks: chunks.size,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    draws: drawStats.calls, triangles: drawStats.triangles, heap: performance.memory?.usedJSHeapSize ?? null,
    stages: { ...audit.costs }, programs: renderer.info.programs?.length, boost: vehicle.boost || 0, lift: vehicle.lift || 0,
    plumes: plumes?.visible ?? 0, vapour: vapour.count, debris: debris.count, fallingTrees: treeBreakage.count,
    impact: vehicle.impact, smashed: vehicle.smashed, landings: vehicle.landings };
  audit.rows.push(row);
  if (audit.alignmentEnabled && audit.rows.length % 6 === 0) auditAlignment(p);
  for (const e of audit.events) if (['KeyA', 'KeyD'].includes(e.code) && e.type === 'keydown' && row.at - e.at < 700) {
    if (e.firstResponse === undefined && Math.abs(p.steer - e.steer) > .005) e.firstResponse = performance.now() - audit.startAt - e.at;
    if (e.ninetyPercent === undefined && Math.abs(p.steer - e.target) < Math.abs(e.steer - e.target) * .1) e.ninetyPercent = performance.now() - audit.startAt - e.at;
  }
}
function auditStats(values) {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!a.length) return null;
  return { n: a.length, mean: a.reduce((s,v) => s + v, 0) / a.length, p50: a[Math.floor((a.length - 1) * .5)],
    p95: a[Math.floor((a.length - 1) * .95)], p99: a[Math.floor((a.length - 1) * .99)], max: a.at(-1), min: a[0] };
}
window.__vehicleAudit = {
  start({ replay = 0, alignment = false } = {}) {
    audit.rows = []; audit.gpu = []; audit.events = []; audit.longTasks = []; audit.longFrames = [];
    audit.startAt = performance.now(); audit.startTime = vehicle.time; audit.startDistance = vehicle.distance;
    audit.heading = vehicle.heading; audit.replaySpeed = replay; audit.active = true; profiler.reset();
    audit.alignmentEnabled = alignment; audit.lastPoseTime = undefined;
    audit.alignment = { samples: 0, carHorizontalError: 0, cameraMatrixError: 0, streamCenterError: 0, waterClockError: 0, backwardTime: 0, missingGround: 0, movedTerrain: 0, terrainHeightError: 0, supportError: 0 };
  },
  finish() {
    audit.active = false;
    const rows = audit.rows, gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    const summary = Object.fromEntries(['dt', 'cpu', 'speed', 'poseLag', 'poseGap', 'cameraCorrection', 'cameraBehind', 'cameraDistance', 'screenX', 'screenY', 'pending', 'queued', 'completed', 'chunks', 'geometries', 'textures', 'draws', 'triangles', 'heap'].map(key => [key, auditStats(rows.map(r => r[key]))]));
    summary.gpu = auditStats(audit.gpu);
    Object.assign(summary, { frames: rows.length, stalls25: rows.filter(r => r.dt > 25).length, stalls50: rows.filter(r => r.dt > 50).length,
      blockedFrames: rows.filter(r => r.blocked).length, frozenFrames: rows.filter(r => !r.steps && r.dt >= 10).length,
      missingGround: rows.filter(r => r.missingGround).length, missingAhead1s: rows.filter(r => r.missingAhead1s).length,
      clippedMs: rows.reduce((s,r) => s+r.clipped, 0), distance: vehicle.distance - audit.startDistance,
      simMs: (vehicle.time - audit.startTime) * 1000, wallMs: performance.now() - audit.startAt });
    return { probeVersion: 2, startAt: audit.startAt, summary, rows, alignment: audit.alignmentEnabled ? audit.alignment : null, gpu: audit.gpu, events: audit.events, longTasks: audit.longTasks, longFrames: audit.longFrames,
      metrics: profiler.snapshot(), renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
      state: window.__driveTest.snapshot(), environment: { userAgent: navigator.userAgent, concurrency: navigator.hardwareConcurrency, devicePixelRatio, width: innerWidth, height: innerHeight },
      audioLatency: audio ? { base: audio.context.baseLatency, output: audio.context.outputLatency, state: audio.context.state } : null,
      resources: performance.getEntriesByType('resource').filter(r => r.name.includes('.glb')).map(r => ({name: r.name, startAt: r.startTime - audit.startAt, endAt: r.responseEnd - audit.startAt, duration: r.duration, transferSize: r.transferSize, decodedBodySize: r.decodedBodySize})) };
  }
};
