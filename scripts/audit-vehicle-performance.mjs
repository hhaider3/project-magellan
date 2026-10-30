// Repeatable diagnostic runs via Playwright CLI. No production files modified.
// PWCLI may point to an installed playwright-cli.js (or executable wrapper).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const run = promisify(execFile);
const out = resolve(process.env.AUDIT_OUT || 'output/playwright/vehicle-performance');
await mkdir(out, { recursive: true });
const cli = process.env.PWCLI || `${process.env.HOME}/.codex/skills/playwright/scripts/playwright_cli.sh`;
async function command(args) {
  const result = await run(cli.endsWith('.js') ? process.execPath : cli, [...(cli.endsWith('.js') ? [cli] : []), '-s=vehicle-audit', ...args], { maxBuffer: 30e6, timeout: 180000 });
  if (result.stdout.includes('### Error')) throw new Error(result.stdout);
  return result.stdout;
}
let source = await readFile('game.mjs', 'utf8');
for (const [before, after] of [
  ['// Reproducible launch position', "{ const spawn = new URLSearchParams(location.search).get('auditSpawn')?.split(',').map(Number); if (spawn) vehicle = createVehicle(world, spawn[0], spawn[1], spawn[2], vehicleKind); }\n// Reproducible launch position"],
  ['function frame(now) {', 'function frame(now) {\n  auditFrameStart(now);'],
  ['testMode ? .5 : .1', '.1'], // Match real gameplay's catch-up cap.
  ['stepVehicle(vehicle, input, world, obstacles);', 'audit.steps++; if (audit.active && audit.replaySpeed) auditReplay(); else stepVehicle(vehicle, input, world, obstacles);'],
  ["if (running) profiler.record('frameCPU', frameCPU);", "if (running) profiler.record('frameCPU', frameCPU);\n  auditFrameEnd(now, frameCPU);"]
]) { if (!source.includes(before)) throw new Error(`Missing instrumentation anchor: ${before}`); source = source.replace(before, after); }
source += '\n' + await readFile('scripts/vehicle-performance-probe.js', 'utf8');
await writeFile(`${out}/instrumented-game.mjs`, source);
const cases = [
  { name: 'matched-216', replay: 60, seconds: 25, blur: false },
  { name: 'matched-360-retina', replay: 100, seconds: 30, blur: true, retina: true },
  { name: 'natural-fast-retina', seconds: 30, blur: true, retina: true, steer: true, audio: true },
  { name: 'desert-turn', seed: 100003, seconds: 25, blur: true, steer: true, audio: true },
  { name: 'water-transition', mode: 'water', seconds: 22, blur: true },
  { name: 'rain-night', seconds: 25, blur: true, retina: true, weather: 'rain', time: 22, audio: true },
  { name: 'sustained-streaming', replay: 100, seconds: 70, blur: true },
  { name: 'natural-fast-retina-no-blur', seconds: 30, blur: false, retina: true, steer: true, audio: true },
  { name: 'matched-360-retina-no-blur', replay: 100, seconds: 30, blur: false, retina: true },
  { name: 'ramp-landing', mode: 'ramp', seconds: 22, blur: true, audio: true },
  { name: 'hill-crest', spawn: [-1068.644157, 5289.112189, -.1993621268], seconds: 12, blur: true, audio: true },
  { name: 'water-clock', mode: 'water', seconds: 8, blur: true },
  { name: 'air-modes', airModes: true, seconds: 12, blur: true, retina: true, audio: true },
  { name: 'matched-360-large-retina', replay: 100, seconds: 25, blur: true, retina: true, width: 1440, height: 900 },
  { name: 'matched-360-large-retina-no-blur', replay: 100, seconds: 25, blur: false, retina: true, width: 1440, height: 900 },
];
const selected = cases.filter(c => !process.env.AUDIT_CASES || process.env.AUDIT_CASES.split(',').includes(c.name));
for (const scenario of selected) {
  const width = scenario.width || (scenario.retina ? 1280 : 960), height = scenario.height || (scenario.retina ? 720 : 600);
  await writeFile(`${out}/cli.config.json`, JSON.stringify({ browser: { launchOptions: { headless: process.env.AUDIT_HEADED !== '1', args: ['--use-angle=metal', '--enable-gpu'] }, contextOptions: { viewport: { width, height }, deviceScaleFactor: scenario.retina ? 2 : 1 } } }));
  await command(['open', 'about:blank', `--config=${out}/cli.config.json`]);
  try {
    for (const kind of (process.env.AUDIT_KINDS || 'atlas,roadster').split(',')) {
      const name = `${scenario.name}-${kind}${process.env.AUDIT_SUFFIX || ''}`;
      const mode = scenario.airModes && kind === 'atlas' ? 'fly' : scenario.mode || 'drive';
      const thrustKey = scenario.airModes ? 'KeyF' : 'KeyE';
      const url = `http://127.0.0.1:8002/?seed=${scenario.seed || 3}&test=${mode}&vehicle=${kind}&quality=high&blur=${scenario.blur ? 1 : 0}&weather=${scenario.weather || 'clear'}&time=${scenario.time || 10}${scenario.spawn ? `&auditSpawn=${scenario.spawn.join(',')}` : ''}`;
      const snippet = `async (page) => {
        await page.unroute('**/game.mjs?*');
        await page.route('**/game.mjs?*', route => route.fulfill({ path: ${JSON.stringify(`${out}/instrumented-game.mjs`)}, contentType: 'text/javascript' }));
        const errors = [], warnings = []; const onError = e => errors.push(e.message); page.on('pageerror', onError);
        const onConsole = e => { if (['warning', 'error'].includes(e.type())) warnings.push(e.text()); }; page.on('console', onConsole);
        const boot = Date.now(); await page.goto(${JSON.stringify(url)});
        await page.getByRole('button', { name: 'Start exploring', exact: true }).waitFor({ state: 'visible', timeout: 60000 });
        const readyMs = Date.now() - boot;
        await page.locator('#perfBtn').click();
        await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
        ${scenario.audio ? "await page.keyboard.press('KeyM');" : ''}
        await page.waitForTimeout(2000);
        ${process.env.AUDIT_PROFILE === '1' ? "const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable'); const browserBefore = (await cdp.send('Performance.getMetrics')).metrics; await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');" : ''}
        await page.evaluate(options => window.__vehicleAudit.start(options), { replay: ${scenario.replay || 0}, alignment: ${process.env.AUDIT_ALIGNMENT === '1'} });
        await page.keyboard.down('KeyW');
        ${kind === 'roadster' && !scenario.replay ? `await page.keyboard.down('${thrustKey}');` : ''}
        await page.waitForTimeout(5000);
        ${kind === 'roadster' && !scenario.replay ? `await page.keyboard.up('${thrustKey}');` : ''}
        ${scenario.steer ? `await page.waitForTimeout(5000); await page.keyboard.down('KeyA'); await page.waitForTimeout(450); await page.keyboard.up('KeyA');
          await page.waitForTimeout(4550); await page.keyboard.down('KeyD'); await page.waitForTimeout(450); await page.keyboard.up('KeyD');
          await page.waitForTimeout(${scenario.seconds * 1000 - 15450});` : `await page.waitForTimeout(${scenario.seconds * 1000 - 5000});`}
        await page.keyboard.up('KeyW');
        const result = await page.evaluate(() => window.__vehicleAudit.finish());
        ${process.env.AUDIT_PROFILE === '1' ? "const cpuProfile = (await cdp.send('Profiler.stop')).profile; const browserAfter = (await cdp.send('Performance.getMetrics')).metrics; await cdp.detach();" : ''}
        await page.screenshot({ path: ${JSON.stringify(`${out}/${name}.png`)} });
        page.off('pageerror', onError); page.off('console', onConsole);
        return { scenario: ${JSON.stringify(scenario)}, kind: ${JSON.stringify(kind)}, readyMs, errors, warnings, ${process.env.AUDIT_PROFILE === '1' ? 'cpuProfile, browserBefore, browserAfter,' : ''} ...result };
      }`;
      await writeFile(`${out}/run.js`, snippet);
      console.log(`Starting ${name}`);
      const raw = await command(['run-code', `--filename=${out}/run.js`]);
      await writeFile(`${out}/${name}.txt`, raw);
      const start = raw.indexOf('### Result\n') + '### Result\n'.length;
      const end = raw.indexOf('\n### ', start);
      const result = JSON.parse(raw.slice(start, end < 0 ? undefined : end));
      await writeFile(`${out}/${name}.json`, JSON.stringify(result));
      console.log(JSON.stringify({ name, readyMs: result.readyMs, errors: result.errors, summary: result.summary, events: result.events }));
    }
  } finally { await command(['close']); }
}
