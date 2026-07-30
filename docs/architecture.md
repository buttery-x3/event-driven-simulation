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
- `RendererPlaybackInput` contains only plain data needed to present a run. It retains the run
  status so incomplete output cannot silently masquerade as a complete result.

Run statuses are discriminated values: `complete`, `unresolved`, `iteration-limited` and `invalid`.
Expected calculation failures therefore remain data, with a reason and diagnostics, rather than
being represented by missing fields, booleans or exceptions.

`contractVersion` starts at `1` so persisted records can be identified if the public schema changes.
The contracts intentionally use ordinary objects, arrays, strings, numbers and `null`. This keeps
them JSON-serialisable and leaves the calculation implementation replaceable by a future worker or
Rust/Wasm module without adding either transport today.
