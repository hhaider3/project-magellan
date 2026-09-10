# Endless Drive

Play it here https://project-magellan.pages.dev/

An endless driving playground through procedurally generated meadows, pine country, rough ridges, camps, lookout towers, and marked jump ramps. Drive in any direction; a fresh visit creates a fresh world. A `?seed=123456` link recreates the same landscape.

## Run

No build step or package installation required. From this folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [localhost:8000](http://localhost:8000). Use HTTP rather than opening the HTML file directly. Three.js 0.160.0 is bundled in `vendor/` with its license. Google Fonts is optional and has system font fallbacks. Gameplay needs a browser with WebGL and module workers, but no external CDN connection. For development, `npm run dev` serves the game on port 8002 with caching disabled.

## Controls

| Input | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| **Space** | **Jump** — works while stopped or moving |
| **Shift** | **Handbrake / drift** |
| R | Recover onto nearby clear ground |
| C | Chase / wide / bonnet camera |
| L | Headlights |
| M | Sound on / off |
| Esc / P | Pause / resume |
| N | Generate a new world |

Touch devices and compact windows show steering, throttle, reverse, **Jump**, and **Drift** buttons. Camera selection and recovery are also available in the pause menu. The game pauses when the window loses focus. Trip records and sound preference are stored locally. Sound begins muted on the first visit.

## Current world and handling

- Mountains are continuous terrain with broad foothills. Random cone mountains, abrupt biome switches, terrain walls, and deep-water barriers are gone.
- Roads are painted directly onto the terrain, so there are no raised road ribbons or mismatched road collision surfaces.
- Denser seeded pine clusters, shrubs, small rocks, boulders, roadside markers, cabins and lookout towers give the world more places to explore. Road and ramp approach clearances keep the extra scenery from blocking the route. Small rocks and shrubs are forgiving details; trees collide at the trunk. Cacti, trees and small rocks break above a direct impact speed of **65 km/h**; boulders require **94 km/h**. The car keeps most of its momentum while fragments scatter, bounce, and shrink away. The Blender trees retain their branch silhouettes and colors at contact, then separate into six authored solid sections with a 20 ms onset. Highway-speed hits separate the sections visibly within 80 ms, with independent tumbling and stronger scatter at higher speeds. Up to eight breaking trees share twelve instanced batches across the two variants; unused batches draw nothing. Broken props stay gone for this world visit, including after chunk reloads; a new world or page reload restores them. Small debris uses one instanced draw call and a 192-piece cap.
- Jumping uses a real impulse, gravity, buffered input and a short grace period after leaving a crest. Quick taps are queued before the next physics tick. Holding Jump does not bounce the car repeatedly.
- Fixed 120 Hz physics handles acceleration, hill climbing, drift, airborne motion, landing and collision sliding. Top speed on level asphalt is approximately **301 km/h**, with stronger braking and speed-sensitive steering. Recovery finds clear nearby ground without erasing trip or best-jump distance.
- Steeper rolling hills, gullies and closely spaced off-road ridges demand more care at speed. Roads retain smoother profiles.
- Orange ramps have curved decks, chevrons, flags and approach markers. Drive up one to launch automatically; Space is optional. The first ramp is about **70 m ahead, just right of the starting road**. More ramps regenerate throughout the world. Their dirt embankments use the same heightfield as the visible ground.
- Purple banked ramps twist progressively and launch left- or right-handed barrel rolls. The first is about **225 m ahead on the opposite side of the road from the first orange ramp**; more are seeded throughout the world. Drive through the lip at speed, or jump from the upper deck, to roll. Landing and recovery restore stable driving.
- Orange and purple triangles distinguish ordinary and rolling ramps on the minimap; pale squares mark camps and lookouts. The HUD points toward the nearest ramp and measures airtime and best jump distance.
- The original **ATLAS Expedition 4×4**, modeled in Blender, has copper bodywork, an ivory roof, open wheel arches, inset glazing, detailed all-terrain tires, roof luggage, a winch, skid plates and a rear spare. Its independent wheels steer and rotate; body suspension, headlights and brake lights follow gameplay.
- Trees, cacti and rocks use an original Blender scenery library: alpine and windswept pines, two ribbed branching cacti, granite and shale rock clusters, and granite and sandstone boulders. Vertex colors add foliage shading, bark, cactus ribs and thorns, and stone mineral variation. Each variant is one instanced mesh per chunk, with deterministic placement and the existing distance fade.
- The compact HUD, compass, terrain map and three camera views keep the road visible. Landmarks are placed as recognizable destinations instead of scattered solid obstacles.
- Eighty-one nearby 96 m chunks stream around the car, with reusable 384 m coarse terrain tiles extending the horizon beyond them. Terrain detail, color and lighting gradually blend into the same coarse horizon over 220–360 m, avoiding a visible swap at chunk boundaries. Trees and landmarks use instanced geometry and a gradual multisample coverage fade (with alpha blending when MSAA is unavailable) over 220–350 m; their bases follow the terrain transition. A module worker prepares terrain, props and an extra hidden ring before they are needed. Results are installed within a 4 ms per-frame budget (one chunk can exceed that budget on a slow device). Far tiles reuse vertex buffers and update only the indices around arriving fine chunks. Initial loads show progress; changing worlds cancels old jobs. Discarded resources are disposed. Bounded height and feature caches reuse terrain samples as the car crosses chunks.

## Files

- `index.html` / `style.css`: menus, HUD and touch controls.
- `game.mjs`: rendering, vehicle animation, streaming, audio and input.
- `vehicle-model.mjs`: loads the bundled Blender/glTF vehicle, validates its animation rig and lights, and supplies paint/glass reflections.
- `assets/vehicles/`: editable Blender source, optimized `.glb`, studio preview and mesh statistics.
- `scripts/build-car.py`: reproducible Blender modeling, studio rendering and game export.
- `nature-models.mjs` / `assets/nature/`: bundled Blender scenery, variant selection and matching tree fragments.
- `scripts/build-nature.py` / `scripts/export_nature.py`: build the editable nature library or export manually edited models.
- `terrain.mjs` / `world-worker.mjs` / `streaming-layout.mjs`: reusable terrain data, background generation and seam-free near/far coverage.
- `batching.mjs`: static mesh batching utility; the Blender car is already batched during export.
- `vehicle-presentation.mjs`: interpolates fixed-step poses for smooth car, wheel, camera and shadow motion across display refresh rates.
- `grass-data.mjs` / `grass.mjs`: background placement and batched near-field plains grass, with reduced mobile density.
- `shadow-fade.mjs`: fades directional shadows inside the moving shadow-map boundary, preserving nearby contrast and existing mobile/desktop map resolutions.
- `camera-motion.mjs`: integrates camera position, aim and field of view against moving targets without changing follow lag when frame intervals change.
- `tree-breakage.mjs`: immediate speed-dependent fracture using authored Blender sections, plus a geometry-cutting path for legacy geometry fixtures.
- `break-audio.mjs`: precomputed wood, cactus and stone effects with capped simultaneous voices.
- `debris.mjs`: bounded instanced breakage particles with terrain bounce and cleanup.
- `profiling.mjs`: opt-in, bounded CPU timing measurements.
- `scenery.mjs`: ramp decks and the instanced cabin/lookout models.
- `world.mjs`: deterministic terrain, road layout, landmark and prop placement, and vehicle simulation. Physics samples the same triangles as the visible ground.

## Verification

```sh
npm ci
npx playwright install chromium
npm test
```

The tests cover terrain continuity, seeded regeneration, scenery clearances, challenging slopes, jump buffering and landing, 300 km/h highway top speed, automatic ramp launches across three seeds, landmark regeneration, acceleration/reverse, drift, collision escape, recovery, frame-rate independence and 24 simulated one-minute drives across eight directions and three seeds.

Vehicle checks also parse the actual exported GLB to verify meter scale, wheel origins, ground contact, lamp materials, self-contained resources and geometry budgets. Browser checks exercise the imported rig's steering, wheel spin and lights, and confirm that an asset-load failure shows an error instead of starting an invisible car.

## Blender car source

Open `assets/vehicles/atlas-expedition.blend` in Blender to edit the 803 named parts, material assignments and bevel modifiers. The studio camera and lights are included for rendering and excluded from the game export. All geometry is original to this project; no downloaded models or texture services are required.

To rebuild the source, preview and game asset with Blender installed:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-car.py
```

On another platform, substitute the path to your Blender executable. The build was verified with Blender 5.2. The playable export uses approximately 50,000 triangles in 26 material batches and is about 1.5 MB. The export reduces small bevels and redundant surface detail while the `.blend` retains the editable geometry. Exact counts are recorded in `assets/vehicles/atlas-expedition.json`.

After manually editing the source in Blender, export your changes without rebuilding the car:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background assets/vehicles/atlas-expedition.blend --python scripts/export_car.py
```

The glTF rig uses X right, Y up and Z forward. `Body` responds to suspension; `Wheel_FL`, `Wheel_RL`, `Wheel_FR` and `Wheel_RR` own the axle pivots, and each contains a separate `Spinner_*`. Wheel radius is 0.57 m, wheelbase 2.74 m and track 2.08 m, matching the existing presentation. The car loads alongside the world before **Start exploring** becomes available. Three.js's pinned GLTF loader and reflection environment are bundled locally; `npm run vendor` refreshes them from the locked dependency.

## Blender scenery source

Open `assets/nature/endless-nature.blend` for the eight editable models and the studio lineup. `endless-nature.glb` bundles their geometry and opaque vertex colors without textures or external downloads. Trees contain about 1,600 triangles each, cacti 970–1,170, rock clusters 258 and boulders 172; exact export statistics are in `assets/nature/endless-nature.json`. Standing trees combine their six sections into one draw per variant, while impacts reuse the same geometry and colors in a shared eight-tree pool.

```sh
# Rebuild all models and the studio preview.
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-nature.py

# Export saved manual edits without rebuilding the models.
/Applications/Blender.app/Contents/MacOS/Blender --background assets/nature/endless-nature.blend --python scripts/export_nature.py
```

Keep the eight named asset roots and their `fragment` assignments when editing. The game removes the studio layout offsets and places every model by its ground origin. Variants are selected from seeded prop positions, so reloads and chunk streaming preserve their appearance. Existing collision rules, terrain clearances, and destruction thresholds still apply. The start button waits for scenery to load and exposes an error if the asset is unavailable.

Scenery tests check dimensions, color-buffer ownership, deterministic variants, triangle budgets, and actual ray intersections before and after tree impacts. `tests/effects.html` previews either imported pine at contact, fracture and settle stages.

For live browser integration checks, open [tests/play.html](http://localhost:8000/tests/play.html). **Run driving check** exercises the actual keyboard handlers and HUD while accelerating, jumping, leaving the road, crossing chunk boundaries, reversing, recovering, pausing and resuming. **Run ramp check** starts on a repeatable approach and tests a launch and landing using throttle alone. Keep the page focused during each check (about 23 and 7 seconds respectively). Test runs use isolated in-memory records. The `?test=ramp` launch position is reserved for this harness; ordinary visits always start at the crossroads.

**Run geometry check** verifies that chunk clones keep independent ownership metadata and instance buffers, and that disposing one chunk cannot dispose another. Asset revision URLs prevent a previously cached module from being mixed into this release.

Sandlands form broad, smoothly blended low-elevation regions alongside grass and snow. They use instanced branching cacti, clear road and ramp approaches, and matching minimap colors. Preview a desert spawn with `?seed=100003`.

The GitHub Actions workflow runs unit tests plus headless Chromium tests on pushes and pull requests. Browser tests block external resources and exercise WebGL output, stationary-frame stability, worker loading, streamed driving, jumping, recovery, camera resets, rapid world changes, compact touch controls, visible scenery destruction, debris cleanup, and airborne barrel rolls. Failure traces and screenshots are saved under `output/playwright/`. `npm run test:unit` runs the simulation/geometry suite alone; an installed Chrome can be used locally with `PW_CHANNEL=chrome npm run test:browser`.

## Performance checks

Run `npm run dev` in one terminal, then `npm run profile` in another (`PW_CHANNEL=chrome npm run profile` also works). The repeatable headless run uses seed 1, a 1280×720 viewport and software rendering. It reports CPU timings for worker generation, chunk installation, rendering submission and the minimap, plus draw counts and scene sizes. Software-renderer FPS is not representative of normal GPU gameplay. `?test=browser` exposes the same read-only diagnostic snapshot and isolates saved records; normal play does not collect profiling samples.

Recovery caches each chunk once per search. The minimap reuses its elevation when choosing the biome and updates less frequently on touch devices. Camera recovery/reset snaps both position and target, and world changes reset physics timing before resuming.

To update the pinned graphics dependency deliberately, run `npm run vendor` and commit the vendor files along with the lockfile. Hosting remains static: Cloudflare Pages can continue serving the repository root without a build step.

Stunt test approaches are available at `?seed=1&test=twist` and `?seed=1&test=smash`; these isolate trip records just like the other browser harness modes.

The rendered car interpolates the two latest physics poses (at most one 120 Hz tick of visual delay). Camera tracking, wheel rotation and shadows use that same pose. Camera position, aim and field of view integrate the target trajectory over each frame; endpoint-only smoothing changed follow distance when the display changed refresh rates. Tests cover 30–240 Hz camera tracking, abrupt 120→30→90 Hz transitions, uneven frame intervals, barrel-roll angle wrapping and teleport resets. These timing tests do not measure physical phone GPU or display performance.

Ramp backs and sides obey normal ballistic separation, so oblique and reverse approaches carry upward momentum into the air instead of sticking to the deck. Tests compare five rear/side directions against identical unmarked terrain, check oblique front approaches and slow traversal, and drive a rear-diagonal approach in Chromium (`?seed=1&test=ramp-side`).

Breaking sounds share the engine’s sound toggle (M or the speaker button); muting silences all game audio. Highway power rises smoothly near the road, with level-road cruising around 301 km/h, off-road cruising around 236 km/h, and a downhill cap of 331 km/h. Preview tree impacts with `?seed=77&test=tree-smash`.

`tests/effects.html` provides a fixed-camera tree breakup preview at highway impact speed with contact, 80 ms fracture, 160 ms split and settle stages for visual regression checks.

Sun shadows fade across the outer 19 m of their moving 96 m map instead of appearing abruptly at its edge. The fade uses light-space coordinates, so it follows all sides of the shadow volume and applies equally to terrain and objects. Rendered-pixel regression tests compare the old hard cutoff with the new transition on all four edges at 1024 and 2048 shadow-map resolutions.

Plains have seeded patches of low grass. Placement reuses terrain triangles in the generation worker and avoids sand, snow, steep slopes, roads and reserved ramp/landmark areas. Three opaque triangles form each tuft; there are no grass colliders, transparent layers or shadow-casting blades. Desktop grass fades from 38–78 m, while touch devices use half the density and a 22–48 m fade. At most nine desktop or four mobile chunk batches are eligible to draw, capped at 43,200 or 9,600 grass triangles before view culling. Chunk buffers are independently owned and disposed during streaming. Preview meadow grass with `?seed=3`.

Run `PW_CHANNEL=chrome node scripts/profile-grass.mjs` for a same-scene grass-on/off render-cost comparison (requires the development server). The seed-3 meadow measured +4 draw calls and +10,326 triangles at 960×600 on desktop, and +4 calls / +5,160 triangles at 390×844 with touch emulation. This isolates geometry/render cost; software-renderer timing and touch emulation do not measure real phone FPS.
