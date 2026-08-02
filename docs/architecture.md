# Architecture

## Simulation and rendering boundary

The browser application uses plain TypeScript data as the boundary between scene configuration,
headless simulation, saved run records and renderer playback. The public contracts live in the
`src/lib/simulation/contracts` subsystem and do not import Svelte, Three.js or browser APIs.

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

Simulation modules belong to the `contracts`, `math`, `motion`, `collision`, `world`, `run`, or
`serialization` subsystem documented in [`source-structure.md`](source-structure.md). Each
subsystem exposes supported capabilities through an explicit `index.ts`; implementation modules
remain private to their subsystem. The architecture checker enforces this topology and the
dependency graph, while ESLint enforces production file and function growth limits.

## Physical scene semantics

Physical shape, motion authority and renderer representation are separate concepts:

- **Physical shape** is the two-dimensional geometry used by simulation. `CirclePhysicalShape`
  contains a radius; a static circle supplies its centre and a dynamic body supplies its initial
  position separately. `LineSegmentPhysicalShape` contains its two endpoints and represents the
  zero-thickness walls, guides and exit floors.
- **Motion authority** identifies who determines an entity's pose. `static` entities remain at
  their configured pose, `dynamic` entities are solved and recorded by simulation, and `prescribed`
  is reserved for future mechanically controlled motion such as roulette. Milestone 1 implements
  only static colliders and dynamic bodies; it does not add prescribed-motion trajectories.
- **Renderer representation** is a renderer-owned view model. It chooses Three.js geometry,
  material, depth and visual orientation without changing collision data.

`StaticCircleCollider`, `StaticLineSegmentCollider` and `InitialDynamicCircleBodyState` are explicit
physical records. Each carries a stable entity ID, motion authority and shape discriminant, so its
meaning does not depend only on which array contains it. Axis-aligned termination regions provide a
physical completion or escape condition without pretending to be colliders. The same entity IDs
continue through contact events, body trajectories, playback poses and renderer mesh registration.

The canonical board coordinate system, construction and named launch catalogue are documented in
[`simulation.md`](simulation.md). Scene validation is headless and returns typed, path-specific
diagnostics for unsupported geometry, duplicate IDs, malformed coordinates and invalid dimensions.

## Contract responsibilities

- `SimulationInput` groups the scene's `staticColliders`, `initialDynamicBodies` and all current
  behavioural settings and numerical tolerances.
- `MotionSegment`, `BodyTrajectory` and `PhysicalEvent` describe the calculated history without
  requiring frame-by-frame simulation during playback. Segment discriminants distinguish
  `free-flight`, `linear-contact` and `circular-contact`; contact-mode transition events make entry
  to and exit from resting or sliding states explicit.
- `SimulationRunRecord` preserves the input, prefix validity, typed terminal reason, physical
  events, trajectory prefix and diagnostics needed for saved runs and regression fixtures.
- `RendererPlaybackInput` contains only plain data needed to present a run. It carries the same
  scene and initial body definitions as simulation input, so physical dimensions have one source
  of truth, and it retains validity and the terminal reason so incomplete output cannot silently
  masquerade as a normal exit.

The renderer derives dynamic-body and fixed-collider radii and positions from these contracts.
Cylinder depth and orientation, camera values and decorative backdrop dimensions remain
presentation settings because they cannot affect physical results. If the backdrop later becomes
collision geometry, its dimensions must move into `SceneDefinition` rather than remaining
renderer-owned.

Run validity is `valid` or `invalid` and is deliberately separate from the stable terminal
`outcome` and detailed terminal reason. The eight outcomes are `exited`, `escaped`, `settled`,
`no-future-event`, `time-limit`, `event-limit`, `unresolved`, and `invalid`. Detailed reasons retain
the specific region, bounds edge, support collider, collision-search failure or explicit limit.

`contractVersion` is `6` after FLAME-36 added first-class sustained-contact motion and transition
events. Earlier fixtures are rejected rather than silently interpreted as version 6; the prototype
has no external compatibility requirement. The contracts intentionally use
ordinary objects, arrays, strings, numbers and `null`. This keeps them JSON-serialisable and leaves
the calculation implementation replaceable by a future worker or Rust/Wasm module without adding
either transport today.

## Saved run boundary

Saved run fixtures live under the repository-level `fixtures/` directory so headless tests and the
browser renderer consume the same files. `src/lib/simulation/serialization/run-record/index.ts` is
the narrow runtime entry point from unknown JSON data to `SimulationRunRecord`. JSON parsing, typed
fixture errors, contract-version recognition and version 6 structural and consistency validation
live in separate implementation modules behind that entry point. Version dispatch is intentionally
explicit rather than a general schema registry.

Loading a fixture establishes only that it matches the saved-run contract. It does not promote the
terminal reason or make an incomplete run eligible for ordinary playback. The renderer still
converts the record through `toRendererPlaybackInput`. `assertPlaybackEligible` admits only valid
`exited` and narrowly supported `settled` results, while `assertRecordedInspectionEligible` admits
complete, unresolved and invalid records with a finite non-negative recorded horizon. Inspection
never evaluates motion beyond the committed segment boundary.

## Headless event-driven run

`src/lib/simulation/run/single-ball/construct.ts` is the authoritative producer of single-ball run
records. It sequences free flight, impact and sustained contact, commits only certified intervals,
and continues from exact physical event times. `impact-response.ts` owns restitution and the
conservative contracting-impact collapse policy. The named `sustained-contact` subdomain owns
support-shape dispatch, line and circular continuation, shared contact-mode result construction,
constrained-path geometry and independently testable detachment/angular scene-event search.
Validation, termination search and diagnostic construction remain separate modules in the parent
single-ball subdomain. The
`run` entry point preserves both `constructSingleBallRun` and the old
`generateSyntheticRun` compatibility name without retaining a forwarding implementation module.

Canonical recorded-segment position and velocity evaluation lives in the `simulation/motion`
subsystem. Constant-acceleration segments use their immutable initial conditions. Circular-contact
segments use the conserved-energy relation on the expanded peg boundary and adaptive quadrature to
invert angular travel time; they are not renderer samples or fixed timesteps. Run construction and
renderer playback both consume this framework-independent evaluator, so rendering cannot acquire a
duplicate motion equation. Low-level vector and
polynomial operations live in `simulation/math`. These modules import only allowed lower-level
simulation entry points and are exercised in Vitest's Node environment, so they do not depend on
Svelte, Three.js, a renderer or browser globals.

Continuous fixed-world collision discovery is owned by `simulation/collision`.
`peg-contact.ts` solves ball-versus-circle contacts, `boundary-contact.ts` orchestrates finite
segment root selection, `boundary-query-validation.ts` validates its query contract,
`boundary-candidate.ts` classifies face and endpoint evidence, and `fixed-world-contact.ts` compares
their common typed candidates. `simulation/math/polynomial-roots.ts` contains the shared interval
root isolation used by both geometry solvers. None of these modules advances state through fixed
timesteps or imports rendering code. Renderer line thickness remains presentation-only; collision
offsets use the dynamic ball radius and the zero-thickness physical segment contract.

## Renderer playback

`src/lib/rendering/playback.ts` is the playback subsystem's narrow public entry point.
Run-to-renderer adaptation and admission, recorded-frame evaluation, and presentation-clock control
live in separate cohesive modules behind it. Admission rejects runs from ordinary playback unless
validity is `valid` and the outcome is `exited` or `settled`. The presentation clock owns only playback
time: play, pause, restart and seek cannot change the run record.

At each presentation time, the playback evaluator clamps to the recorded duration, selects the
motion segment whose recorded interval contains that time and evaluates the segment's declared
position function. When adjacent segments share a boundary, the later segment is selected at the
exact transition time. Missing recorded intervals produce no body pose rather than invented or
integrated renderer motion.

`toRenderSceneViewModel` adapts physical records to a small renderer-side discriminated union.
Dynamic circular bodies become spheres. Static circular Plinko colliders become cylinders.
Line-segment boundaries become boxes whose visible thickness is presentation-only. Axis-aligned
termination regions become translucent planes, while physical board bounds determine the backdrop
size and camera framing. Adding a renderer representation therefore changes the adapter and
Three.js geometry factory, not the playback clock or canonical trajectory evaluator.

Three.js consumes evaluated poses and maps simulation `(x, y)` coordinates to presentation
`(x, y, 0)` coordinates. `mount-scene.ts` remains the browser lifecycle orchestrator, while scene
object geometry/material creation, dynamic mesh registration and owned-resource disposal live in
`scene-object-resources.ts`. `dynamic-pose.ts` updates registered meshes by stable entity ID and
does not inspect their geometry. Fixed collider radii and centres still come directly from the
public scene contract; renderer-owned values never feed back into simulation data.

The browser prototype loads `fixtures/runs/canonical-event-driven-offset-drop.json` through the
saved-run boundary and replays its 25-contact authoritative run through this same renderer
contract. The fixture is neither regenerated in the route nor duplicated into a
presentation-specific format.

## Enforced dependency direction

ESLint and `scripts/check-architecture.mjs` make the architectural boundary executable. Production files under
`src/lib/simulation/` cannot import Svelte, Three.js or rendering modules and cannot reference
browser, worker or network globals. Production files under `src/lib/rendering/` may import the
plain simulation contracts and the canonical trajectory evaluator, but not simulation producers or
fixture loaders. Application and workbench modules use the `simulation/run`,
`simulation/serialization/run-record`, and `simulation/serialization/simulation-input` entry points
rather than their internal implementation modules. The architecture checker also rejects unknown
subsystems, deep cross-subsystem imports, reversed or circular dependencies, crowded directories,
entry-point logic and catch-all directories. Co-located tests may cross a boundary deliberately to
prove end-to-end fixture replay, while production modules remain independently reusable.

## Workbench UI and CSS

The browser route provides the explicit repository fixture catalog and composes
`SimulationWorkbench`; it does not own Three.js lifecycle, the animation loop, local-file parsing,
diagnostic markup or page styling. Workbench components under `src/lib/workbench/` divide
responsibilities by state ownership and independently evolving regions:

- `SimulationWorkbench` coordinates the last accepted run, source, load feedback, inspection mode,
  event selection and presentation clock;
- `LaunchControls` edits a launch draft, while `launch-controls.ts` converts velocity controls,
  validates the draft and creates a deep immutable submitted input before invoking the headless
  simulator;
- `SimulationViewport` owns Three.js mount, update and disposal;
- application bar and playback controls expose typed callbacks rather than reaching into renderer
  state; and
- the run inspector, event timeline, diagnostics console and metrics panel render read-only views
  of the accepted run.

Draft input, submitted input, returned run record and presentation clock are distinct state. Preset
selection and field editing cannot mutate an accepted run. The explicit Run action is the only path
from a launch draft to simulation; renderer playback still receives only the returned run through
`toRendererPlaybackInput`.

`simulation/serialization/simulation-input` provides the versioned JSON boundary for scenario
inputs. It owns the version 6 structural input validator and then applies the single-ball semantic
validator. Saved run records use the independent `simulation/serialization/run-record` boundary,
where version-specific shape and cross-field consistency validation have separate owners. Shared
unknown-data assertions and typed fixture failures live in the private
`simulation/serialization/structural-validation` subdomain and are consumed through its local entry
point.

The current styling policy is Svelte component-scoped CSS plus global CSS custom properties.
`src/app.css` contains the reset, document defaults and shared tokens for colour, spacing,
typography, radii, shadows and overlay order. Layout and component internals remain in the scoped
`<style>` block of the component that owns them. A shared primitive is justified only after
repeated markup and behaviour establish a real common responsibility; repeated token usage alone
is not a reason to add wrapper components.

Tailwind and other component or CSS frameworks remain deferred. Reconsider them only if the
implemented workbench demonstrates sustained repetition that scoped CSS and the existing token set
cannot address clearly. Any future adoption should solve an observed maintenance problem rather
than replace the current policy speculatively.
