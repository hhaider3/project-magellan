import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// CPU submission and browser-frame measurements. SwiftShader is deliberately
// repeatable, but its total FPS is not a hardware-GPU performance claim.
const mode = process.env.PROFILE_MODE || 'drive';
const seconds = Number(process.env.PROFILE_SECONDS || 20);
const hardware = process.env.PROFILE_GPU === '1';
const width = Number(process.env.PROFILE_WIDTH || 960), height = Number(process.env.PROFILE_HEIGHT || 600);
const deviceScaleFactor = Number(process.env.PROFILE_DPR || 1);
const baselineRef = process.env.PROFILE_BASELINE_REF;
const args = hardware ? [] : ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'];
if (process.env.PROFILE_COLD === '1') args.push('--disable-gpu-shader-disk-cache');
const browser = await chromium.launch({ ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  args });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', route => route.abort());
  // A/B the saved revision without touching the checkout or its served files.
  if (baselineRef) for (const file of ['game.mjs', 'water.mjs', 'world-worker.mjs', 'streaming-layout.mjs']) {
    let source = execFileSync('git', ['show', `${baselineRef}:${file}`], { encoding: 'utf8' });
    if (file === 'game.mjs') {
      const insert = (before, after) => {
        if (!source.includes(before)) throw new Error(`Cannot instrument ${baselineRef}: missing ${before}`);
        source = source.replace(before, after);
      };
      if (!source.includes('resetMetrics:')) insert('window.__driveTest = { snapshot:', 'window.__driveTest = { resetMetrics: () => profiler.reset(), snapshot:');
      if (!source.includes("profiler.record('streamSync'")) {
        insert('lastCX = cx; lastCZ = cz;', 'const syncStarted = performance.now();\n  lastCX = cx; lastCZ = cz;');
        insert('waterSystem.sync(world, vehicle.x, vehicle.z);', "profiler.measure('waterSync', () => waterSystem.sync(world, vehicle.x, vehicle.z));");
        insert('jobs.sort((a, b) => a.priority - b.priority);', "jobs.sort((a, b) => a.priority - b.priority);\n  profiler.record('streamSync', performance.now() - syncStarted);");
      }
      if (!source.includes("profiler.record('frameCPU'")) {
        insert('function frame(now) {', 'function frame(now) {\n  const frameStarted = performance.now();');
        insert('render(running ? dt : 0);', "render(running ? dt : 0);\n  if (running) profiler.record('frameCPU', performance.now() - frameStarted);");
      }
    }
    await page.route(`**/${file}?*`, route => route.fulfill({ contentType: 'text/javascript', body: source }));
  }
  await page.goto(`http://127.0.0.1:8002/?seed=3&test=${mode}`);
  await page.getByRole('button', { name: 'Start exploring', exact: true }).click({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__driveTest.resetMetrics());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(seconds * 1000);
  await page.keyboard.up('KeyW');
  const state = await page.evaluate(() => window.__driveTest.snapshot());
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector('#game canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  const result = { mode, seconds, renderer, width, height, deviceScaleFactor, baselineRef: baselineRef ?? null, metrics: state.metrics, water: state.water,
    distance: state.vehicle.distance, transform: state.vehicle.transform, draws: state.draws, errors };
  await mkdir('output/timing', { recursive: true });
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
