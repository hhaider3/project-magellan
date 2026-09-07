# Endless Drive

An endless driving playground through procedurally generated meadows, pine country, rough ridges, camps, lookout towers, and marked jump ramps. Drive in any direction; a fresh visit creates a fresh world. A `?seed=123456` link recreates the same landscape.

## Run

No build step or package installation required. From this folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [localhost:8000](http://localhost:8000). Use HTTP rather than opening the HTML file directly. Three.js is pinned to 0.160.0 on jsDelivr; Google Fonts is optional and has system font fallbacks. The initial load needs an internet connection for Three.js and a browser with WebGL.

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
- Denser seeded pine clusters, shrubs, small rocks, boulders, roadside markers, cabins and lookout towers give the world more places to explore. Road and ramp approach clearances keep the extra scenery from blocking the route. Small rocks and shrubs are forgiving details; trees collide at the trunk, and larger boulders need to be avoided or jumped.
- Jumping uses a real impulse, gravity, buffered input and a short grace period after leaving a crest. Quick taps are queued before the next physics tick. Holding Jump does not bounce the car repeatedly.
- Fixed 120 Hz physics handles acceleration, hill climbing, drift, airborne motion, landing and collision sliding. Top speed on level asphalt is approximately **242 km/h**, with stronger braking and speed-sensitive steering. Recovery finds clear nearby ground without erasing trip or best-jump distance.
- Steeper rolling hills, gullies and closely spaced off-road ridges demand more care at speed. Roads retain smoother profiles.
- Orange ramps have curved decks, chevrons, flags and approach markers. Drive up one to launch automatically; Space is optional. The first ramp is about **70 m ahead, just right of the starting road**. More ramps regenerate throughout the world. Their dirt embankments use the same heightfield as the visible ground.
- Orange triangles mark ramps on the minimap; pale squares mark camps and lookouts. The HUD points toward the nearest ramp and measures airtime and best jump distance.
- A new procedural expedition wagon includes framed glass, roof luggage, a rack, spare tire, tire tread, steering wheels, suspension response and working lights.
- The compact HUD, compass, terrain map and three camera views keep the road visible. Landmarks are placed as recognizable destinations instead of scattered solid obstacles.
- Eighty-one nearby 96 m chunks stream around the car, with a coarse terrain mesh extending the horizon beyond them. Terrain detail, color and lighting gradually blend into the same coarse horizon over 220–360 m, avoiding a visible swap at chunk boundaries. Trees and landmarks use instanced geometry and a gradual multisample coverage fade (with alpha blending when MSAA is unavailable) over 220–350 m; their bases follow the terrain transition. An extra hidden ring is prepared one chunk per frame before it is needed, and discarded resources are disposed. Bounded height and feature caches reuse terrain samples as the car crosses chunks.

## Files

- `index.html` / `style.css`: menus, HUD and touch controls.
- `game.mjs`: rendering, car model, streaming, audio and input.
- `scenery.mjs`: ramp decks and the instanced cabin/lookout models.
- `world.mjs`: deterministic terrain, road layout, landmark and prop placement, and vehicle simulation. Physics samples the same triangles as the visible ground.

## Verification

```sh
node --test tests/world.test.mjs
```

The tests cover terrain continuity, seeded regeneration, scenery clearances, challenging slopes, jump buffering and landing, 240+ km/h top speed, automatic ramp launches across three seeds, landmark regeneration, acceleration/reverse, drift, collision escape, recovery, frame-rate independence and 24 simulated one-minute drives across eight directions and three seeds.

For live browser integration checks, open [tests/play.html](http://localhost:8000/tests/play.html). **Run driving check** exercises the actual keyboard handlers and HUD while accelerating, jumping, leaving the road, crossing chunk boundaries, reversing, recovering, pausing and resuming. **Run ramp check** starts on a repeatable approach and tests a launch and landing using throttle alone. Keep the page focused during each check (about 23 and 7 seconds respectively). Test runs use isolated in-memory records. The `?test=ramp` launch position is reserved for this harness; ordinary visits always start at the crossroads.
