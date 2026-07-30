# Architecture

## Simulation and rendering boundary

The browser application uses plain TypeScript data as the boundary between scene configuration,
headless simulation, saved run records and renderer playback. The public contracts live in
`src/lib/simulation/contracts.ts` and do not import Svelte, Three.js or browser APIs.

The dependency direction is:

```text
scene + initial body states + settings
    -> headless simulation
    -> serialisable run record
    -> renderer playback input
    -> Three.js presentation
```

Simulation data uses two-dimensional coordinates. Rendering may map that data into a
three-dimensional presentation, but renderer objects never enter the simulation contracts and
rendering is not a source of physical truth.

## Contract responsibilities

- `SimulationInput` groups the fixed scene, initial dynamic body states and all current behavioural
  settings and numerical tolerances.
- `MotionSegment`, `BodyTrajectory` and `PhysicalEvent` describe the calculated history without
  requiring frame-by-frame simulation during playback.
- `SimulationRunRecord` preserves the input, valid trajectory prefix, physical events, terminal
  status and diagnostics needed for saved runs and regression fixtures.
- `RendererPlaybackInput` contains only plain data needed to present a run. It carries the same
  scene and initial body definitions as simulation input, so physical dimensions have one source
  of truth, and it retains the run status so incomplete output cannot silently masquerade as a
  complete result.

The renderer derives dynamic-body and fixed-collider radii and positions from these contracts. Its
camera and decorative backdrop values are grouped separately as presentation settings because they
cannot affect physical results. If the backdrop later becomes collision geometry, its dimensions
must move into `SceneDefinition` rather than remaining renderer-owned.

Run statuses are discriminated values: `complete`, `unresolved`, `iteration-limited` and `invalid`.
Expected calculation failures therefore remain data, with a reason and diagnostics, rather than
being represented by missing fields, booleans or exceptions.

`contractVersion` starts at `1` so persisted records can be identified if the public schema changes.
The contracts intentionally use ordinary objects, arrays, strings, numbers and `null`. This keeps
them JSON-serialisable and leaves the calculation implementation replaceable by a future worker or
Rust/Wasm module without adding either transport today.

## Headless synthetic run

`src/lib/simulation/synthetic-run.ts` is the first producer of a completed run record. It generates
two continuous constant-acceleration segments separated by a representative contact, using only
the supplied scene, body state and simulation settings. The contact time is the midpoint of the
configured maximum simulation time; its position and normal come from the generated path and first
fixed circle, and the outgoing velocity uses the configured restitution.

The same module evaluates individual motion segments and complete body trajectories at requested
simulation times. It imports only the plain simulation contracts and is exercised in Vitest's Node
environment, so it does not depend on Svelte, Three.js, a renderer or browser globals. This
synthetic path proves the precompute-and-replay boundary without claiming to solve real collisions;
physical event search remains a later simulation concern.

## Renderer playback

`src/lib/rendering/playback.ts` converts a completed `SimulationRunRecord` into the narrower
`RendererPlaybackInput` contract and rejects non-complete runs from ordinary playback with the run
status and reason in the diagnostic. Its presentation clock owns only playback time: play, pause,
restart and seek cannot change the run record.

At each presentation time, the playback evaluator clamps to the recorded duration, selects the
motion segment whose recorded interval contains that time and evaluates the segment's declared
position function. When adjacent segments share a boundary, the later segment is selected at the
exact transition time. Missing recorded intervals produce no body pose rather than invented or
integrated renderer motion.

Three.js consumes these evaluated poses and maps simulation `(x, y)` coordinates to presentation
`(x, y, 0)` coordinates. Fixed collider dimensions still come directly from the public scene
contract. The renderer owns only camera, lighting, materials and decorative backdrop resources;
none of them feed back into simulation data.
