import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Inspect the transforms submitted to the real renderer. Instrument only the
// test response; production gameplay and timing remain untouched.
const probe = `
const audit = { frames: 0, missingGround: 0, movedTerrain: 0, backwardTime: 0,
  carPoseError: 0, cameraMatrixError: 0, cameraTargetError: 0, streamCenterError: 0,
  waterClockError: 0, terrainHeightError: 0, groundedHeightError: 0,
  minPoseLag: Infinity, maxPoseLag: 0, chunkCrossings: 0, transformedFrames: 0 };
const auditRay = new THREE.Raycaster(), auditPoint = new THREE.Vector3();
const auditInverse = new THREE.Matrix4(), auditCamera = new THREE.PerspectiveCamera();
const auditTerrain = new WeakMap();
let auditLastTime = -Infinity, auditChunk;
const auditRender = renderer.render.bind(renderer);
renderer.render = (renderScene, renderCamera) => {
  auditRender(renderScene, renderCamera);
  if (!running || renderScene !== scene || renderCamera !== camera) return;
  const p = vehiclePresentation.pose;
  audit.frames++;
  if (p.transform > 0) audit.transformedFrames++;
  if (p.time < auditLastTime - 1e-9) audit.backwardTime++;
  auditLastTime = p.time;
  const lag = vehicle.time - p.time;
  audit.minPoseLag = Math.min(audit.minPoseLag, lag);
  audit.maxPoseLag = Math.max(audit.maxPoseLag, lag);
  auditPoint.set(0, 1, 0).applyMatrix4(car.matrixWorld);
  audit.carPoseError = Math.max(audit.carPoseError, Math.hypot(auditPoint.x - p.x, auditPoint.y - p.y - 1, auditPoint.z - p.z));
  auditInverse.copy(camera.matrixWorld).invert();
  for (let i = 0; i < 16; i++) audit.cameraMatrixError = Math.max(audit.cameraMatrixError, Math.abs(auditInverse.elements[i] - camera.matrixWorldInverse.elements[i]));
  auditCamera.position.copy(cameraPosition); auditCamera.lookAt(cameraTarget);
  audit.cameraTargetError = Math.max(audit.cameraTargetError, auditCamera.quaternion.angleTo(camera.quaternion));
  audit.streamCenterError = Math.max(audit.streamCenterError, Math.hypot(streamUniforms.uStreamCenter.value.x - p.x, streamUniforms.uStreamCenter.value.y - p.z));
  for (const mesh of scene.children) if (mesh.material?.uniforms?.uTime) {
    audit.waterClockError = Math.max(audit.waterClockError, Math.abs(mesh.material.uniforms.uTime.value - p.time));
  }
  const key = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
  if (auditChunk !== undefined && key !== auditChunk) audit.chunkCrossings++;
  auditChunk = key;
  const chunk = chunks.get(key);
  if (!chunk?.group.visible) { audit.missingGround++; return; }
  const matrix = chunk.ground.matrixWorld.elements;
  const prior = auditTerrain.get(chunk.ground);
  if (prior && matrix.some((value, i) => value !== prior[i])) audit.movedTerrain++;
  auditTerrain.set(chunk.ground, [...matrix]);
  auditRay.set(auditPoint.set(p.x, 10000, p.z), new THREE.Vector3(0, -1, 0));
  const hit = auditRay.intersectObject(chunk.ground, false)[0];
  if (!hit) { audit.missingGround++; return; }
  audit.terrainHeightError = Math.max(audit.terrainHeightError, Math.abs(hit.point.y - world.surface(p.x, p.z)));
  if (vehicle.grounded && p.transform === 0 && Math.abs(p.y - p.groundY) < 1e-9) {
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading), rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
    const samples = [[fx * 1.36, fz * 1.36], [-fx * 1.36, -fz * 1.36], [rx * .96, rz * .96], [-rx * .96, -rz * .96]];
    const support = Math.max(world.surface(p.x, p.z), samples.reduce((total, [x,z]) => total + world.surface(p.x + x, p.z + z), 0) / 4) + .06;
    audit.groundedHeightError = Math.max(audit.groundedHeightError, Math.abs(p.y - support));
  }
};
window.__frameAlignmentAudit = () => ({ ...audit, distance: vehicle.distance });
`;

const source = await readFile(new URL('../game.mjs', import.meta.url), 'utf8');
const seconds = Number(process.env.AUDIT_SECONDS || 20);
const hardware = process.env.PROFILE_GPU === '1';
const browser = await chromium.launch({ ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  args: hardware ? [] : ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const scenario of [{ name: 'road', seed: 3, mode: 'drive' }, { name: 'desert-turn', seed: 100003, mode: 'drive', turn: true }, { name: 'water', seed: 3, mode: 'water' }]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.route('**/game.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: source + '\n' + probe }));
    await page.goto(`http://127.0.0.1:8002/?seed=${scenario.seed}&test=${scenario.mode}`);
    await page.getByRole('button', { name: 'Start exploring', exact: true }).click({ timeout: 60000 });
    await page.keyboard.down('KeyW');
    if (scenario.turn) {
      await page.waitForTimeout(3000);
      await page.keyboard.down('KeyA'); await page.waitForTimeout(1100); await page.keyboard.up('KeyA');
      await page.waitForTimeout(Math.max(0, seconds * 1000 - 4100));
    } else await page.waitForTimeout(seconds * 1000);
    await page.keyboard.up('KeyW');
    const data = await page.evaluate(() => window.__frameAlignmentAudit());
    const renderer = await page.evaluate(() => {
      const gl = document.querySelector('#game canvas').getContext('webgl2'), info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    });
    const result = { scenario: scenario.name, renderer, seconds, ...data, errors };
    results.push(result); console.log(JSON.stringify(result));
    assert.deepEqual(errors, []);
    assert.ok(data.frames > 30 && data.distance > 96 && data.chunkCrossings > 0, 'exercise moving, streamed scenes');
    for (const key of ['missingGround', 'movedTerrain', 'backwardTime']) assert.equal(data[key], 0, key);
    for (const key of ['carPoseError', 'cameraMatrixError', 'streamCenterError', 'waterClockError']) assert.ok(data[key] < 1e-9, key);
    assert.ok(data.cameraTargetError < 1e-7, 'camera aims using this frame target');
    assert.ok(data.minPoseLag >= -1e-9 && data.maxPoseLag <= 1 / 120 + 1e-9, 'bounded single-physics-tick interpolation delay');
    assert.ok(data.terrainHeightError < 2e-5, 'rendered triangles match collision height');
    assert.ok(data.groundedHeightError < 2e-5, 'grounded render height follows terrain between physics ticks');
    if (scenario.mode === 'water') assert.ok(data.transformedFrames > 0, 'exercise animation and water clocks');
    await page.close();
  }
} finally {
  await mkdir('output/timing', { recursive: true });
  await writeFile('output/timing/frame-alignment.json', JSON.stringify(results, null, 2) + '\n');
  await browser.close();
}
