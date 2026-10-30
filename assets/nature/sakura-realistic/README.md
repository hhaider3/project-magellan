# Realistic sakura

Original Blender asset made independently of the earlier tree. The game loads this tree through `sakura-model.mjs` as cherry variant 5.

- Full standalone asset: **9,996 triangles**, including 72 falling petals and 65 ground petals.
- Game tree: **9,174 triangles** (4,766 wood + 4,408 blossom canopy), two instanced material passes. The game's shared GPU petal system supplies the falling petals.
- Game height normalized to **10.2 m** (`SAKURA_HEIGHT` in `world.mjs`, which also sizes its trunk collision and where its petals fall). Editable Blender source retains its native dimensions. In the game the cherries grow only along stretches of lowland shore: lakes, seas and rivers, on banks 0.3–5 m above the water.
- One exact **8-second** looping animation in the standalone GLB: 241 keys, the last the same as the first, so three.js eases frame 240 back into frame 1. The Blender scene plays frames 1–240, so its loop doesn't show that pose twice. The game does not run an animation mixer per tree.
- Textures are packed into the Blender file and GLB. Blossom alpha uses MASK, with double-sided cards.

## Performance

Cut-out foliage is paid for by every pixel of every card, opaque or not, in every layer of the canopy and every shadow map, so the cost is in what the GPU draws and throws away:

- **Cards fitted to the spray.** Only about a sixth of the blossom atlas is opaque. The build fits each card to the spray's outline (an octagon on the 3×3 grid's eight rays, measured from the rendered atlas's alpha), so a card covers 54% of the full square. Still eight triangles a card, the same cards in the same places.
- **Standard materials in the game.** The glTF's `KHR_materials_specular` makes three.js build the blossom as a `MeshPhysicalMaterial`, its costliest shader. `sakura-model.mjs` draws both parts with `MeshStandardMaterial` instead; on these rough petals it looks the same.
- **Single-sided bark.** The branches are closed tubes, so their inside faces (drawn again in each shadow map) are never seen.
- **No first-use stalls.** The textured shaders set up on their first draw, which took 300 ms in the frame the first grove streamed in and up to 370 ms on the first impact. The game now draws every scenery material and every breakage piece once while loading, as invisible zero-size instances.

Measured on an Apple M2 (Chromium, ANGLE Metal, High, 1280 × 720 at 1.7× resolution): driving into the seed-77 grove and through the tree dropped 8–9 frames a run, plus one 367 ms stall; after these changes, none in three runs. A 60-tree grove's GPU time fell by 20–25%, close to the earlier vertex-coloured cherry's.

## Breakage

Car impacts use the existing tree threshold (18 m/s of inward impact speed), sound, debris, lifetime, capacity, and broken-prop persistence. Trunk/root and branch/canopy groups separate into 11 material pieces across six motion groups. Whole closed branch tubes and blossom cards retain their original surfaces and UV coordinates. Wood and blossoms in each branch group rotate about the same pivot. Standing instances and distant stand-ins hide on impact, and the struck tree stops emitting falling petals immediately.

The full game integration is in `sakura-model.mjs`, `nature-models.mjs`, `tree-breakage.mjs`, and `game.mjs`. The previous combined nature asset is retained for the other scenery; its sakura variant is overridden at assembly time.

## Source and preview

- `sakura-tree.blend`: editable scene, packed textures, animation, preview camera and studio in a separate collection.
- `sakura-tree.glb`: portable asset; studio excluded.
- `sakura-petal.glb`: reusable six-triangle petal.
- `sakura-preview.png`: rendered preview.
- `sakura_blossoms.png` / `sakura_bark.png`: original procedural textures.
- `asset-stats.json`: measured geometry budget.

Rebuild from the project root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/build-sakura.py
```

Preview the real-car impact in the running game using `/?seed=77&test=sakura-smash&weather=clear`; select Start exploring and hold W. The test starts 32 m up the bank from the cherry nearest the start, facing it.

Blossom cards become visible at very close range. No additional mesh LODs are supplied; the game retains its distant cherry stand-in.
