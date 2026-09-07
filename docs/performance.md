# Performance verification

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
