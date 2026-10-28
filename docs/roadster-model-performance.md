# Roadster revision 3 — visual and performance validation

Measured October 28, 2026 on Apple M2, Chromium through ANGLE Metal.

The Blender model adds cut-out headlight cavities with projector lenses, a recessed grille, curved canopy surfaces, grooved tires, drilled brake rotors, hub fasteners and curved thruster bells. Steering pivots, wheel envelopes, ten plume anchors and the animated air brake retain their game contracts.

## Desktop comparison

Same game build, seed 3, stationary starting position and chase camera, High graphics, 960 × 600 viewport, pixel ratio 1, motion blur off. Only the Roadster GLB was substituted. Run order: old, new, new, old. Each run warmed up for 10 seconds, followed by 12 seconds of measurement (722 frames). No Blender renders or other browser tests ran during measurement.

| Measurement | Previous model | Detailed model |
| --- | ---: | ---: |
| Asset triangles | 24,808 | 79,596 |
| Vehicle draws | 29 | 37 |
| GLB bytes | 720,496 | 2,118,244 |
| Mean frame interval | 16.67 ms | 16.67 ms |
| Frame interval p95, each run | 16.7 ms | 16.7 ms |
| Mean CPU frame work | 3.41 ms | 3.47 ms |
| Mean sampled GPU time | 8.92 ms | 9.03 ms |

GPU figures average the overlay's rolling one-second means sampled once per second. Individual baseline runs averaged 8.53 and 9.32 ms, while detailed runs averaged 9.09 and 8.98 ms. The small aggregate difference is below the observed variation between runs; this does not establish zero GPU cost. Both models sustained the 60 FPS display cadence in this scene.

This measures steady rendering at one desktop configuration, not mobile performance, download time or every driving scene. The larger asset takes more storage and transfer bandwidth. The 80k-triangle / 40-draw / 4 MiB test bounds are regression guards for this asset, not universal hardware limits.

## Functional checks

- 26 targeted unit checks passed: asset structure, dimensions, wheel motion, lamps, thrusters, wing clearance, Roadster physics, presentation and module revision tags.
- Three existing browser scenarios passed: vehicle loading/steering/wheels/lamps; Roadster boost/water skim/hover/air brake/vehicle switching; graphics-context recovery.
- Front/rear Blender renders and the final in-game export were visually inspected.

Local raw samples and comparison script are in `output/playwright/roadster-hd/` (ignored build artifacts).
