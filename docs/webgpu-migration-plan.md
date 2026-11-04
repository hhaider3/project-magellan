**Endless Drive: WebGPU and Three.js migration plan**

Prepared November 2, 2026, from this repository. This is an implementation plan; the game and its dependencies have not been changed.

Baseline validation during planning: `npm run test:unit` passed all 207 tests in approximately 87 seconds. Browser tests, fresh visual baselines, and hardware WebGPU benchmarks have not been run for this plan; they are implementation milestones below.

The current game pins Three.js **0.160.0 (r160)** in `package.json` and serves a vendored WebGL build. The verified target is **0.187.0 (r187)**, the latest npm release when this plan was written. Pin that exact version during the migration and reassess the latest stable release before the final upgrade PR. [npm package metadata](https://registry.npmjs.org/three/latest), [r187 release](https://github.com/mrdoob/three.js/releases/tag/r187).

Rebuild the rendering around `WebGPURenderer`, node materials, and Three.js Shading Language (TSL), while retaining the world generation, simulation, controls, audio, and Blender assets. Use the same TSL materials with native WebGPU and the renderer's WebGL2 fallback. The existing GLSL materials and `onBeforeCompile` hooks require porting; changing the renderer constructor alone cannot migrate this game. [Three.js renderer migration guidance](https://threejs.org/manual/pages/webgpurenderer).

The intended first release preserves the existing game and appearance. GPU compute and additional visual effects follow measured results after parity.

The repository audit found:

- `game.mjs` combines bootstrap, materials, streaming, rendering, and UI in 2,523 lines.
- There are 16 `ShaderMaterial` construction sites across the game modules. One factory produces six motion-blur passes, so this is a source-site count rather than a material count.
- There are ten `onBeforeCompile` assignments, additional shader callbacks stored in `userData`, global `ShaderChunk` modifications, and overrides of `Mesh.prototype` shadow hooks.
- Two world workers already generate terrain, props, grass, and water payloads with transferred typed arrays and bounded installation work.
- The simulation runs at 120 Hz. Vehicle presentation interpolates between physics steps and corrects grounded poses against the terrain at the rendered position.
- Browser tests and profiling currently assume WebGL, including synchronous pixel reads, a WebGL timer extension, and direct context inspection.

The following systems define the actual porting work:

| System and existing files | Required work | Risk |
| --- | --- | --- |
| Bootstrap and frame loop: `game.mjs` | Extract renderer creation, asynchronous readiness, resize, frame submission, diagnostics, and recovery. Remove direct WebGL context assumptions. | High |
| Terrain and roads: `game.mjs`, `terrain.mjs`, `synthwave.mjs` | Express terrain morphing, normals/colors, road maps, markings, snow, wetness, headlights, caustics, and synthwave grid as shared TSL functions. Keep the existing geometry and collision sampling. | High |
| Grass: `grass.mjs`, `grass-data.mjs` | Port instanced attributes, blade deformation, wind, vehicle interaction, density, and distance fading to node materials. Keep worker-generated roots and bounds. | Medium |
| Scenery: `game.mjs`, `nature-models.mjs`, `sakura-model.mjs`, `scenery.mjs` | Port LOD placement, fades, emissive palms/props, and retroreflectors. Preserve blossom mip coverage, alpha testing, and per-instance destruction. | High |
| Water: `water.mjs`, `water-data.mjs` | Port lake, sea, river, ice, and wake shading. Preserve depth attributes, flow, foam, sky reflections, caustics, fog, and streaming. | High |
| Sky and weather: `sky.mjs`, `clouds.mjs`, `weather-effects.mjs`, `storm.mjs` | Port custom shader effects; retain weather/daylight logic and the existing lightning geometry where compatible. | Medium |
| Particles: `dust.mjs`, `petals.mjs`, `weather-effects.mjs`, `thrusters.mjs` | Replace variable-size point primitives with instanced sprites or camera-facing quads. Preserve particle budgets, lifetimes, and deterministic animation inputs where available. | High |
| Vehicles and showroom: `vehicle-model.mjs`, `garage.mjs` | Preserve glTF hierarchy and animation clips; port showroom and synthwave environment shaders, reflection generation, lights, glass, and shared-resource ownership. | Medium |
| Shadows: `shadow-fade.mjs`, `game.mjs` | Replace global shader/prototype patches with node-based shadow composition and explicit caster selection. Preserve near/far transitions and the crisp vehicle shadow. | Very high |
| Motion blur: `motion-blur.mjs` | Rebuild depth/motion reconstruction, tile reductions, neighbour selection, vehicle/shadow masking, and final resolve in the current render pipeline. | Very high |
| Breakage and debris: `debris.mjs`, `tree-breakage.mjs` | Port the debris fade shader and validate custom shadow materials, instance removal, and resource disposal. | Medium |
| Quality, tests, and profiling: `quality.mjs`, `perf-meter.mjs`, `tests/`, `scripts/` | Add backend-aware capability selection and measurements; preserve quality behavior and meaningful regression coverage. | High |

Preserve these contracts throughout implementation:

- Identical seeded roads, terrain, lakes, collision surfaces, and broken-prop state; no change to vehicle handling or the fixed physics timestep.
- The existing presentation ordering: interpolate pose, update terrain/streaming detail centers and water clocks from that pose, update camera matrices, then render. Rendering must not modify physics state.
- Worker generation IDs, transfer ownership, obsolete-result rejection, bounded queues, terrain coverage masks, and the current frame installation budget.
- Both vehicles; reversible boat/plane animations; Roadster boost, hover, fans, and water skimming; the garage; normal and synthwave themes; all weather and time settings.
- Keyboard/touch/tilt controls, pause/background behavior, saved preferences and records, reduced-motion behavior, and audio activation through the first user gesture.
- Self-contained game assets with no required runtime CDN connection. Existing browser tests deliberately block external requests.

Use a small renderer boundary with `init`, `resize`, `renderFrame`, `setQuality`, `resetHistory`, `getDiagnostics`, and `dispose` responsibilities. Keep renderer internals outside simulation modules. Suggested destinations are `render/runtime.mjs`, `render/frame-state.mjs`, `render/terrain-view.mjs`, `render/materials/`, `render/effects/`, and `render/resources.mjs`; extract incrementally as each subsystem moves.

The renderer consumes an explicit frame state containing the interpolated vehicle pose, camera, time/weather, stream center, and quality settings. Worker payloads remain renderer-independent typed arrays. Resource ownership distinguishes shared model assets from per-chunk geometry/textures and per-renderer targets, so unloading a chunk cannot dispose another chunk's resources.

Implement the migration in the following order. Estimates are engineering days for one developer familiar with this code, including validation. The 30–45 day range, approximately 6–9 full-time weeks, is provisional until the first milestone resolves the shader and device risks.

| Milestone | Work and concrete deliverable | Exit condition | Estimate |
| --- | --- | --- | --- |
| 0. Baseline and feasibility | Record a clean r160 reference and build a small r187 feasibility scene exercising terrain LOD, road textures, water, a large particle sprite, blended shadows, and MSAA/depth post-processing. | Representative material and render-target combinations work on native WebGPU and forced WebGL2; unsupported paths and costs are recorded. | 3–4 days |
| 1. Dependency and build upgrade | Introduce consistent package imports and a production build; upgrade the current WebGL game through r170/r180 compatibility checkpoints to r187. | The upgraded reference game, unit suite, browser smoke checks, and production assets work without mixed Three.js revisions. | 3–5 days |
| 2. Playable WebGPU foundation | Extract the rendering boundary, initialize the renderer asynchronously, load a vehicle, and port near/far/horizon terrain and road materials. | A seeded drive streams continuously with correct road/collision alignment on both backends. | 4–6 days |
| 3. Complete world and vehicle rendering | Port foliage, stand-ins, grass, sky, weather, water/ice/wakes, particles, debris, reflections, and garage materials. | All gameplay modes and both themes are visually represented; streaming, transforms, and controls retain their behavior. | 8–12 days |
| 4. Shadows and motion blur | Replace patched shadows and rebuild post-processing, color output, antialiasing, and history resets. | Shadow transitions, vehicle sharpness, fog, and blur pass the dedicated visual checks on both backends. | 6–9 days |
| 5. Performance, recovery, and release | Tune uploads and quality, validate real devices, test recovery and production builds, then enable WebGPU by default. | Release criteria below pass; a deployable artifact and rollback build are available. | 6–9 days |

For milestone 0, capture fixed seed/time/weather/camera/quality references: seed 3 road and water routes, seed 100003 desert, seed 77 Frostlands, flight over a sea, a night road with headlights, and synthwave. Exercise both vehicles and record cold/warm loading. Existing screenshots are useful references, but capture the current checkout before implementation. Add a reproducible simulation-tick/input replay for comparisons; equal wall-clock key holds can travel different distances on different renderers. Freeze or seed cosmetic randomness for screenshot checks.

Re-use `scripts/profile-frame-timing.mjs`, `scripts/profile-grass.mjs`, `scripts/audit-frame-alignment.mjs`, and the existing vehicle probes. Measure current native rendering before choosing optimization work.

For milestone 1, a small Vite build is the recommended packaging change. It resolves npm imports and bundles the module workers; retain the current JavaScript modules and DOM UI. Replace `scripts/vendor.mjs`, hand-maintained import maps, and manual revision tags only once the build and tests cover their responsibilities. Update the source-scanning assumptions in `tests/module-versions.test.mjs` to check the resulting dependency/build behavior. Preserve GLBs, audio, icons, manifest URLs, and static deployment, and test a built artifact with external networking blocked. [Vite dependency and worker support](https://vite.dev/guide/features.html).

Treat package version, lockfile, Three.js addons, browser entrypoints, Node test imports, and worker imports as one upgrade. Remove direct imports of the old `vendor/three.module.js` from tests and helpers when the package becomes authoritative. Avoid duplicate Three.js installations/build identities. Keep temporary WebGL compatibility repairs small and remove them when the corresponding TSL system lands.

Review every r160→r187 migration entry while using r170/r180 checkpoints to locate failures. Specific changes relevant here include the deprecated `PCFSoftShadowMap`, changed `RoomEnvironment` lighting, r187 PMREM representation, and render-target viewport/scissor behavior. Compare vehicle paint/glass and generated environment lighting after the upgrade. [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide).

For milestone 2, await renderer initialization before any reflection bake, offscreen rendering, or initial frame. Precompile representative materials with the actual lights, environment, and target formats before enabling Start. Include unfolded vehicle parts, both themes, and effects that otherwise appear only later in play. Retain the current pause and fixed-step timing behavior if the animation loop changes. [Renderer initialization and compilation APIs](https://threejs.org/docs/pages/Renderer.html).

Expose a development setting such as `?backend=auto|webgpu|webgl2`. Auto uses normal backend selection; webgl2 forces the fallback. A strict webgpu test must assert the selected backend and fail if it silently falls back. Do not infer successful native WebGPU from the renderer class name alone. Production should show a useful load error if neither backend initializes. The fallback shares the new TSL implementation; retaining the old GLSL renderer is only a temporary development/reference arrangement. [Backend selection](https://threejs.org/docs/pages/WebGPURenderer.html).

Terrain comes first because its geometry is also the driving surface. Port the same `coarseHeight`, `coarseNormal`, `coarseColor`, and `ultraHeight` transitions and the same road-map decoding. Keep texture bindings per tile while sharing shader functions. Check derivatives and thin road markings at distance, negative chunk coordinates, terrain casts in low sun, and transitions to distant stand-ins. Avoid regenerating CPU terrain on the GPU during this milestone.

For milestone 3, share time, fog, sky, sunlight, stream-center, and theme nodes across materials without accidentally sharing per-tile texture bindings. Account for attribute types, uniform-array indexing, shader derivative control flow, transparency ordering, alpha-to-coverage, and MSAA. Keep worker uploads bounded; a new renderer must not restore the chunk-crossing stalls already removed.

Port particles to instanced sprites/quads before attempting a literal GLSL translation: WebGPU point primitives have a fixed one-pixel size, so the current `gl_PointSize` behavior does not carry across. Start with the existing CPU/analytical particle lifecycle. Preserve large storm billows and petal silhouettes without increasing unbounded overdraw. [PointsNodeMaterial limitations and sprite path](https://threejs.org/docs/pages/PointsNodeMaterial.html).

The cherry stand-in currently renders and reads pixels synchronously at startup. Prefer a checked-in baked image with generated coverage-preserving mipmaps; otherwise make the bake asynchronous and include it in asset readiness. Preserve its normalization and alpha coverage. Validate that model loading, environment bakes, and repeated theme/vehicle changes do not leak resources. The renderer exposes asynchronous target readback if a runtime bake remains necessary. [Readback API](https://threejs.org/docs/pages/Renderer.html#readRenderTargetPixelsAsync).

For milestone 4, evaluate `CSMShadowNode` with blended cascades as the starting point for terrain/scenery shadows. Match the current map coverage, texel stability, low-sun behavior, and quality presets. Separately prototype the tight vehicle shadow and its caster selection; ordinary cascades do not establish equivalence to the existing three-map composition. Use explicit shadow filtering/composition rather than modifying `Mesh.prototype` or global shader text. Keep blossom/bark shadow behavior in the comparison. [CSMShadowNode](https://threejs.org/docs/pages/CSMShadowNode.html).

Rebuild motion blur using **`RenderPipeline`**, the current API name. Preserve camera/depth motion, the vehicle and shadow exclusion, the blur toggle, and Auto quality's ability to shed blur. Start with a straightforward TSL port of the existing passes; optimize reductions only after measuring. Explicitly validate depth reconstruction, texture UV orientation, projection conventions, sample counts, and float-target support for each backend. [RenderPipeline](https://threejs.org/docs/pages/RenderPipeline.html).

Establish a documented linear color pipeline with one deliberate output tone-map/color transform. Replace the current `isXRRenderTarget`, hard-coded `RGBA8`, and `Color.getRGB` overrides with explicit pipeline behavior. The sky, fog, water, transparent effects, and deliberately untonemapped synthwave/showroom shaders need visual comparison together. Reset temporal state after resize, recovery/teleport, world/vehicle/camera switches, garage transitions, pause/resume, and graphics recovery. Blur-disabled output must remain antialiased and match the same color policy.

For milestone 5, make profiling backend-aware. Replace `getContext()` assumptions in the overlay and scripts, report the actual backend and optional capabilities, and collect GPU timestamps only when available. Keep CPU submission time, GPU time, animation intervals, and display smoothness distinct. Preserve Low/Medium/High/Auto behavior, then tune MSAA, pixel ratio, shadow size, grass density, and effect budgets against measured device limits.

Handle graphics loss through the renderer's device-loss/error interfaces as well as relevant fallback events. Pause simulation, preserve CPU world/vehicle/settings state, rebuild GPU resources and reflections, clear temporal history, and resume through the existing pause flow. If native recovery fails, attempt the WebGL2 backend with a fresh canvas/renderer and rebased resources. Test repeated background/foreground cycles. Initialization fallback alone is not a recovery implementation. [Renderer lifecycle hooks](https://threejs.org/docs/pages/Renderer.html).

Validate on real Chrome/Edge desktop hardware, macOS Safari, an iPhone/iPad, Android Chrome, and Firefox on the supported platform set. Determine backend availability at runtime rather than promising a browser-wide capability. Keep software rendering for functional CI; native WebGPU coverage requires a hardware lane that asserts its backend. Serve production over HTTPS and local development through localhost. [WebGPU secure-context requirement](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API), [localhost security](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

Release acceptance is explicit:

- The existing unit suite passes, with unchanged physics/seeded-world assertions. Browser checks pass for loading failures, driving, both transformation directions, flight, Roadster controls, impacts, garage, themes, weather, touch, tilt, quality, pause, and reset.
- WebGPU and forced WebGL2 each render real game frames without shader/validation/page errors. Console collection includes WebGPU, WGSL, and asynchronous backend errors in addition to current WebGL messages.
- `tests/shadows.html` and its pixel sampler are adapted to the new shadow implementation and asynchronous readback. The current raw-WebGL baseline test remains a historical comparison, not the new shader contract.
- Deterministic image comparisons cover every representative scene above, with agreed backend tolerances and close inspection of foliage edges, fog, water, headlights, and vehicle paint/glass. Intentional appearance changes are recorded separately from regressions.
- The alignment audit verifies terrain support, rendered pose, camera matrices, streaming center, and water time. Move its source-injection instrumentation to an explicit development probe so bundling cannot silently disable the check.
- On the agreed desktop reference machine, target 60 Hz at a fixed tested resolution/preset; on the agreed mobile reference, target stable 30 Hz at its tested preset. Establish precise p95/p99 and hitch thresholds from milestone 0, and block unexplained regressions exceeding 10% across repeated matched-route samples. These are proposed acceptance budgets, not measurements already achieved.
- A 30-minute mixed drive/boat/flight soak and at least ten world resets and vehicle/theme switches show bounded resource counts, queues, and memory after warm-up. Test graphics recovery and return from mobile backgrounding.
- The production build loads assets without external dependencies, preserves saved settings/records, and has a previous known-good deploy available for rollback. Enable WebGPU by default only after these gates pass.

Keep optional GPU work outside the parity estimate. Candidates are particle simulation, grass/prop visibility, or motion-blur tile reductions, selected from profiling. Every optional compute path needs a measured improvement, bounded memory, and a compatible non-compute path for the fallback. Retain CPU collision and seeded terrain authority until a separate proposal demonstrates how to preserve their current correctness contracts.

The first implementation deliverable should be milestone 0's baseline and r187 feasibility report. Its purpose is to prove terrain, particle, shadow, and post-processing compatibility before the full material port fixes the project's cost and schedule.
