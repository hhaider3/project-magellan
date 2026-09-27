# Performance verification

## Map-wide streaming after the amphibious update

The lake update generated water meshes on the animation thread whenever new lakes entered the 1 km streaming radius, including during dry road driving with those lakes off-screen. Each chunk crossing also rebuilt the index buffers of every retained coarse terrain tile. Lake generation now runs in the existing world worker and transfers its typed arrays directly into the render geometry. Coarse tiles cache their 16-bit fine-chunk coverage and only replace indices when that coverage changes. Empty wake buffers no longer upload every dry frame.

On an Apple M2, installed Chrome using ANGLE Metal, seed 3, 960×600 at DPR 1, a 20-second W-key road drive crossed 13 chunk boundaries and covered 1,264.55 m in both runs. Baseline: `949e599`, with diagnostic timing scopes added but no behavior changes. Values below are main-thread CPU measurements; `frameCPU` includes simulation and rendering submission, not GPU execution or browser compositing.

| Work | Before | After |
| --- | ---: | ---: |
| Lake synchronization, maximum | 12.9 ms | 0.6 ms |
| Chunk-crossing synchronization, maximum | 16.0 ms | 3.0 ms |
| Whole animation callback, maximum | 19.6 ms | 9.5 ms |
| Whole animation callback, p99 | 6.5 ms | 4.9 ms |
| Whole animation callback, mean | 2.41 ms | 2.45 ms |
| Installing a transferred lake, maximum | — | 0.2 ms |

This establishes smaller CPU spikes, not higher average FPS. Both road runs reported 16.67 ms mean animation intervals and a 16.8 ms maximum. A separate 1280×720, DPR 2 road comparison also reported those intervals in both builds; the game retains its existing 1.7 desktop render-scale cap. A water-entry run completed without dropped animation intervals after the change, but an isolated baseline entry stall was not consistently reproducible and is not claimed as fixed. Headless animation timestamps do not prove that every frame reaches a physical display smoothly, and these samples do not cover every device or route.

Repeat with the development server running:

```sh
PROFILE_GPU=1 PW_CHANNEL=chrome node scripts/profile-frame-timing.mjs output/timing/drive.json
PROFILE_GPU=1 PW_CHANNEL=chrome PROFILE_BASELINE_REF=949e599 node scripts/profile-frame-timing.mjs output/timing/baseline.json
PROFILE_GPU=1 PW_CHANNEL=chrome PROFILE_WIDTH=1280 PROFILE_HEIGHT=720 PROFILE_DPR=2 node scripts/profile-frame-timing.mjs output/timing/retina.json
PROFILE_GPU=1 PW_CHANNEL=chrome PROFILE_MODE=water node scripts/profile-frame-timing.mjs output/timing/water.json
```

The harness defaults to 20 seconds after a 1.5-second warm-up and records the actual renderer. Without `PROFILE_GPU=1`, it uses SwiftShader. The baseline option intercepts the saved revision's game, water, streaming-layout and worker modules without changing the checkout; it inserts missing timing scopes into that response and uses the current profiler. `PROFILE_SECONDS` controls the drive duration. Results are diagnostic samples rather than pass/fail FPS thresholds.

Regression checks require zero terrain sampling during lake requests/installation, transferred-buffer ownership, rejection of obsolete lake results, correct disposal, unchanged water geometry and coarse coverage, and no empty wake-buffer updates. All 60 unit tests and 15 browser checks passed, including ordinary land streaming, parked scenery, collisions, mobile controls, world resets and reversible boat transformation. A direct comparison of all six initial lake meshes also found identical vertex, depth, UV and index bytes before and after extraction into the worker.

## Earlier terrain and scenery optimizations

Measurements taken on the development Mac with Playwright 1.58.2 and installed Chrome, a 1280×720 viewport, seed 1, and SwiftShader software rendering. Run `npm run dev`, then `PW_CHANNEL=chrome npm run profile` to repeat. Timings are CPU timings, not GPU timings.

| Work | Before | After |
| --- | ---: | ---: |
| Car mesh count | 137 | 31 |
| Worst-case recovery prop-generation calls | 1,413 | 16 |
| Minimap height requests per update | 960 | 480 |
| Main-thread chunk construction, mean | 2.76 ms | 0.93 ms |
| Main-thread chunk construction, sampled maximum | 8.1 ms | 3.8 ms |
| Whole-horizon rebuild on a chunk crossing | 21.87 ms average, 55.3 ms maximum | Removed; reusable worker-generated tiles |
| Worker job construction, mean | — | 4.45 ms |
| Main-thread streamed result installation, p95 | — | 2.8 ms |

The old initial terrain/prop generation also measured 262 ms on Node, plus 91 ms for the initial horizon, excluding graphics and DOM work. Those synchronous generation operations now run in a module worker.

The browser drive uses wall-clock key holds, so a slower renderer advances the simulation a different distance. The final total-scene draw counts and FPS therefore are not an apples-to-apples benchmark. The sampled minimap time was 1.11 ms before and 1.62 ms afterward; the redundant work was removed, but this run does not establish a timing win for it. Software rasterization dominated full-frame times and did not show an overall FPS gain. No GPU FPS improvement is claimed from this run.

The regression suite asserts the structural improvements independently of timing: car batching preserves geometry bounds/materials; recovery generates each chunk only once; worker-generated terrain keeps exact collision triangles and matching boundaries; far tiles exclude only installed near chunks; resources remain bounded; parked scenery stays stable; keyboard/touch controls, recovery, and repeated world resets work. Main-thread installation uses a 4 ms budget checked between jobs, so an individual job can exceed it on a slow device.
