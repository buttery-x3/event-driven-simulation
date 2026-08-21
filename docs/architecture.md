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

Simulation modules belong to the `contracts`, `math`, `motion`, `collision`, `world`, `run`,
`serialization`, or `verification` subsystem documented in
[`source-structure.md`](source-structure.md). Each
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

The named `simulation/world/scenarios` subdomain owns human-readable canonical, board-state,
adversarial, dynamic-pair, simultaneous-impact, dormant-component, sustained-path-interruption,
dynamic-support and settling-frontier experiment definitions. Each scenario family that has its own
descriptor vocabulary lives in a named local folder. The shared descriptor declares category,
purpose, complete
`SimulationInput`, permitted outcomes, relevant event/contact expectations, replay expectation,
coverage and regression provenance. It may describe invalid or unresolved experiments, but it does
not invoke simulation or select solver behaviour; consumers receive it through `world/index.ts`.

## Contract responsibilities

- `SimulationInput` groups the scene's `staticColliders`, scheduled `initialDynamicBodies` and all
  current behavioural settings and numerical tolerances. Every body has a stable ID, positive
  finite mass and non-negative release time; an unreleased body is not physically present.
- `MotionSegment`, `BodyTrajectory` and `PhysicalEvent` describe the calculated history without
  requiring frame-by-frame simulation during playback. Segment discriminants distinguish
  `free-flight`, `linear-contact`, `circular-contact` and explicit `stationary` coverage;
  contact-mode transition events make entry to and exit from resting or sliding states explicit.
- `SimulationRunRecord` preserves the input, prefix validity, typed terminal reason, physical
  events, per-body lifecycle, release history, dynamic contacts, contact components, trajectory
  prefix and diagnostics needed for saved runs and regression fixtures.
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

`contractVersion` is `7` after FLAME-48 separated per-body lifecycle from the world outcome and
added scheduled releases, mass, stationary intervals, dynamic contacts/components and prediction
validity evidence. Version 6 single-body inputs and saved runs are validated and migrated with
`mass: 1`, `releaseTime: 0` and empty multi-body evidence; other versions fail explicitly. The
contracts intentionally use
ordinary objects, arrays, strings, numbers and `null`. This keeps them JSON-serialisable and leaves
the calculation implementation replaceable by a future worker or Rust/Wasm module without adding
either transport today.

Migrated version 6 run records may carry additive coupled-contact evidence on contact events, transitions,
resting terminal reasons and contact-search diagnostics. Each member records geometry, incoming and
outgoing normal velocity, and its non-negative impulse; resting manifolds additionally record the
certified support reactions. Legacy version 6 fixtures without these optional forensic fields remain
valid.

## Saved run boundary

Saved run fixtures live under the repository-level `fixtures/` directory so headless tests and the
browser renderer consume the same files. `src/lib/simulation/serialization/run-record/index.ts` is
the narrow runtime entry point from unknown JSON data to `SimulationRunRecord`. JSON parsing, typed
fixture errors and contract-version recognition live behind that entry point. Legacy version 6
validation remains explicit; the named `run-record/v7` subdomain owns current shape, multi-body
consistency and migration assembly. Version dispatch is intentionally explicit rather than a
general schema registry.

## Independent run verification boundary

`src/lib/simulation/verification/index.ts` exposes the reusable headless
`validateSimulationRun(input, run)` capability. It compares an immutable submitted input with a
public run record and returns stable failure categories, codes and record references. The private
`history` subdomain owns record references, multi-body structure, finiteness and temporal continuity. The private
`physics` subdomain owns submitted geometry, bounded collision-free samples, impact and support
necessary conditions, and terminal semantics. The parent owns result collection, orchestration and
JSON round-trip preservation.

Verification is a leaf consumer of the public `contracts`, `math` and `motion` entry points.
Simulation, world and serialization modules never import it. It evaluates declared trajectories
only at recorded boundaries and a bounded set of challenge samples; it does not search for or repair
events, classify roots, solve constrained continuation, or reproduce the manifold solver. Focused
solver tests remain authoritative for those algorithms, while verification establishes that their
composed public history is internally consistent and physically plausible at observable boundaries.

Loading a fixture establishes only that it matches the saved-run contract. It does not promote the
terminal reason or make an incomplete run eligible for ordinary playback. The renderer still
converts the record through `toRendererPlaybackInput`. `assertPlaybackEligible` admits only valid
`exited` and narrowly supported `settled` results, while `assertRecordedInspectionEligible` admits
complete, unresolved and invalid records with a finite non-negative recorded horizon. Inspection
never evaluates motion beyond the committed segment boundary.

## Diagnostic export boundary

Diagnostic export is a separate versioned external representation under
`simulation/serialization/diagnostic-export`. Version 2 uses the stable
`simulation-diagnostic-export` discriminator and snapshots explicit provenance, the submitted
`SimulationInput`, a derived run summary, authoritative trajectories and events, contact-search
evidence, structured diagnostic entries and the workbench's independent run-validation result. It
preserves the solver's validity and terminal result as authoritative evidence while presenting a
failed independent validation as invalid for ordinary playback/export status; it does not rewrite
the run, scrape presentation text or add a solver-iteration trace.

The serialization capability depends only on plain simulation contracts. Workbench code invokes
the public verification entry point and supplies its structured result alongside source metadata;
serialization records that evidence without importing verification or making it motion authority.
The workbench owns `Blob`, object-URL and browser download lifecycle. Diagnostic exports are not
accepted by the scenario-input or saved-run loaders, and neither existing format changes as a
result of this boundary.

## Headless event-driven run

`src/lib/simulation/run/scheduler` is the authoritative producer of world run records.
`constructSimulationRun` orders scheduled releases and per-body local predictions in one monotonic
event history. `constructSingleBallRun` remains a compatibility export of that same authority, so
one-body behaviour cannot drift onto a separate production path. The scheduler performs a simple
deterministic scan, commits only the selected body's certified prefix, retains unrelated continuous
predictions without segmentation, and processes exact-time independent events in body-ID order.
It rejects overlapping release batches and fails the world conservatively when a released body
becomes invalid or unresolved. Its `release.ts` owns fixed/body overlap admission, `assembly.ts`
owns world outcome and per-body lifecycle construction, `predictions.ts` owns local-future evidence,
the private `pairs` subdomain separates continuous pair selection from exact event commitment, and
`construct.ts` owns global selection. The sibling `contact-resolution` subdomain owns immutable
exact-event contact state, phase-relative response classification, supplied-motion and
represented-rest qualification for event-time impact/dormancy admission to the existing resting
mode, general support certification and generic represented-mode selection. Scheduler prefix
segments remain pair-adapter state used only by pair commitment. The
sibling `dynamic-impact` subdomain owns the
mass-aware closed-form response for one certified isolated frictionless contact.

An incoming pair event now seeds an exact-time contact component. The scheduler evaluates every
released body at that common time, admits geometrically touching body-body and body-fixed contacts,
expands connectivity only through dynamic bodies, and records rejected separated candidates. The
private `scheduler/pairs/component.ts` module owns the pair-seeded scheduler adapter while the
physical body/contact vocabulary belongs to `run/contact-resolution`;
`coupled-commit.ts` owns prefix commitment, future invalidation, contact/component records and
post-impact runtime state. Fixed-world impact builds the same vocabulary through its narrow
fixed-event adapter before common post-contact selection. Disconnected simultaneous components are
committed independently, while nearby positive-time events remain ordered.

Certified stationary components with fixed support become persistent dormant components. During
the event-time impact/dormancy admissions changed by FLAME-94 and FLAME-101, the common mode policy
may also admit a current-contact subset whose admissible residual motion under the current
exact-time contact constraints is within the represented-rest threshold and whose zero-motion
support is certified. Raw world-space speed is not by itself a gate against rest: blocked
post-impact velocity that has no physically admissible continuation may be discarded when support
equilibrium succeeds. The private `scheduler/dormancy` subdomain owns their
admission, post-impact retirement/rebuilding, split/merge lifecycle evidence, retained contact
records and commitment of already-selected certified resting components. It consumes the general
support-equilibrium certificate and common resting-mode decision rather than owning either policy.
Dormant bodies have stationary authoritative coverage and no local prediction until an exact-time
component impact reactivates them; the global scheduler remains responsible only for sequencing
that transition with releases and other selected events. Every dormancy admission path, including
single-body rest promotion, writes the resting boundary time, position and zero velocity into
scheduler runtime state so later pair prediction uses the same current state as exact-time
evaluation.

FLAME-95 extends represented rest to existing sustained-motion boundaries without creating a rest
threshold event. Linear and circular fixed-contact continuations submit their current velocity
vectors and support evidence to the common mode authority before continuing. At a retained dynamic
support boundary, the resolution adapter submits the complete anchored contact group; when common
represented-rest candidacy and the general zero-motion support certificate both succeed,
dynamic-support retires its runtime and dormancy commits the group through the existing
`resting-anchored` representation.

A retained dynamic body contact may become a sustained circular support only when the supporting
body belongs to a fixed-anchored dormant component that remains support-feasible under the moving
body's transmitted equal-and-opposite load. The private `scheduler/dynamic-support` subdomain owns
admission, constrained prediction, exact reaction-loss boundaries, commitment, interruption and
contract record construction for that state machine. It reuses the general support-equilibrium
certificate with the transmitted external load and the existing circular angular event search;
its nested `resolution` adapter sends reaction-boundary roles and complete current contact evidence
to the common mode authority. It does not convert the support body to static geometry. A third-body impact interrupts the complete
anchored component at the exact impact time before the component is rebuilt and re-certified.

The sibling `dynamic-impact` subdomain owns the generalized-coordinate simultaneous-impact law
and the solver-neutral finite-contact capture policy shared by fixed-world and coupled adapters.
`generalised-reflections.ts` composes physical problem preparation, a maximum-dissipation inelastic
endpoint, energetic-restitution interpolation, physical impulse certification and diagnostics.
Its private solver-neutral `terminating-elastic-reflections.ts` kernel owns implicit-equality
anti-locking projection and scale-aware terminating elastic reflections with energy
renormalisation. `lineality.ts` owns positive-cone lineality certification and equality projection;
`nonnegative-qp.ts` owns deterministic bounded non-negative quadratic and least-squares selection;
`linear-algebra.ts` owns the small dense eigensolve and metric operations.
The nested `contact-capture` subdomain consumes completed ordinary and zero-restitution endpoints,
local geometry and free acceleration; it owns meaningful-rebound veto, support active-set reduction
and the common diagnostic schema, but does not own collision discovery or either impact solver.
The existing isolated response remains the closed-form reduction oracle. Solver diagnostics retain
the complete contact gradients, projected/removed constraints, lineality basis, reflection subsets
and invariant checks, endpoint energies, impulses and completion reason. A persistent moving pair
without a fixed-anchored support certificate remains an explicit `unsupported-body-body-response`
boundary after the instantaneous response succeeds.

FLAME-96 exposes distinct support-preserving and anchored-component fallback operations in
the private `dynamic-impact/low-speed-elastic` subdomain. It derives explicit bilateral support and
coordinate-lock equalities from physical inputs, verifies that the incoming velocity already lies
in their common admissible space apart from numerical drift, and mass-normalises that space. Real
unilateral impact gradients are projected into the support-compatible space and passed directly to
`terminating-elastic-reflections.ts`; no mirrored or synthetic physical contacts are constructed.
The shared kernel remains the sole owner of implicit impact lineality, anti-locking, active-set
reflection, energy renormalisation and reflection-cap termination.

The low-speed adapter maps the shared endpoint back to physical coordinates and independently
certifies support closure, impact feasibility, kinetic energy and a concrete momentum decomposition
through non-negative physical impact impulses plus signed support/lock reactions. Anchored fallback
adds coordinate equalities for every member of each complete declared resting component; it is not
an arbitrary body-lock operation. The earlier bespoke reflection implementation and the
comparison-only mirrored-contact adapter remain historical evidence but are absent from the
production path.

The private `scheduler/pairs/low-speed-escape` adapter owns exact-event activation and authoritative
support extraction after configured response and finite capture. It returns the selected endpoint
to existing mode and lifecycle owners; it introduces no persistent constraint mode. Anchored
fallback preserves each selected resting component record and runtime unchanged while committing
only the escaping bodies. A separate optional constrained-impact diagnostic and verifier record the
signed equality reactions without changing FLAME-53 diagnostic meaning or ordinary contact-impulse
semantics.

The dynamic-impact root has seven implementation files and one file of headroom. Finite capture is
a separately changing represented-physics policy with two production consumers, so it lives in its
named nested subdomain instead of enlarging the numerical solver root. A future addition of
rotational coordinates, sparse numerical backends or another independently changing solver policy
would justify a distinct nested generalized-impact numerical subdomain.

`src/lib/simulation/run/single-ball/local-events` exposes the fixed-world local prediction and
commit boundary used by the scheduler. It sequences free flight, impact and sustained contact,
including prepared constrained-motion horizons that remain interruptible until selected. The
private `impact` subdomain owns contact-event
commitment and fixed-source adaptation: `response.ts` adapts fixed-world manifold solver endpoints to the
shared finite-capture policy, `evidence.ts` owns impact, capture and accumulation diagnostics,
`alternating-limit.ts` owns the acquired-manifold release transition, and `resolution.ts` owns
specialised path/result construction after consuming the common contact roles and mode. The private `manifold` subdomain
owns deterministic active-set normal-impulse solving, geometry/history-based acquisition of a
fixed-circle accumulation manifold. The named `sustained-contact` subdomain owns
support-shape dispatch, line continuation, shared contact-mode result construction and
constrained-path geometry. Its `mode.ts` adapter sends exact boundary evidence to the common mode
authority. Its private `circular` subdomain owns changing-normal continuation,
turning-point reversal and independently testable angular motion/scene-event ordering.
Validation, termination search and diagnostic construction remain separate modules in the parent
single-ball subdomain. The `run` entry point exposes `constructSimulationRun` and preserves both
`constructSingleBallRun` and the old `generateSyntheticRun` names as compatibility aliases.

Canonical recorded-segment position and velocity evaluation lives in the `simulation/motion`
subsystem. Constant-acceleration segments use their immutable initial conditions. Circular-contact
segments use the conserved-energy relation on the expanded peg boundary and endpoint-regularised
adaptive quadrature to invert angular travel time, including segments that start or end at exact
rest; they are not renderer samples or fixed timesteps. Run construction and renderer playback
both consume this framework-independent evaluator, so rendering cannot acquire a
duplicate motion equation. Low-level vector and
polynomial operations live in `simulation/math`. These modules import only allowed lower-level
simulation entry points and are exercised in Vitest's Node environment, so they do not depend on
Svelte, Three.js, a renderer or browser globals.

Continuous fixed-world collision discovery is owned by `simulation/collision`.
The named `circle-circle` subdomain solves dynamic-circle versus static-circle roots:
`contact-polynomial.ts` owns ballistic geometry and polynomial construction, `query.ts` owns root
selection and result construction, `query-validation.ts` validates query invariants, and
`root-topology.ts` owns entering, exiting, grazing, initial/release-owned and indeterminate policy.
An accumulation-manifold release may explicitly ask `query.ts` to certify a release-owned passage
whose maximum penetration is no greater than `contactDistance`; polynomial critical points prove
the bound, and a deeper or uncertifiable passage still fails closed.
`types.ts` declares the local public query and result contracts.
`boundary-contact.ts` orchestrates finite-segment root selection, `boundary-query-validation.ts`
validates its query contract, and `boundary-candidate.ts` classifies face and endpoint evidence.
The named `fixed-world` subdomain evaluates every collider, compares their common typed candidates,
and certifies exact-time touching contacts at the common earliest state. Tolerance-near candidates
whose ordering cannot be distinguished from simultaneity fail closed.
The named `dynamic-pair` subdomain synchronizes two motion paths over their shared local horizon and
returns typed contact/no-contact/invalid/unresolved results. Free-flight, linear-contact and
stationary pairs use one swap-invariant relative contact polynomial and the shared normalized root
isolation and circle topology policy. A pair containing a changing-normal circular path uses a
deterministically bounded interval isolator: conservative relative-speed bounds exclude separated
intervals, entering brackets are refined to the configured time/geometry tolerances, and an
uncertifiable interval fails closed rather than advancing through samples.
`simulation/math/polynomial-roots.ts` contains the shared interval root isolation and exposes
geometry-neutral isolating intervals and neighbouring polynomial samples to both geometry solvers.
None of these modules advances state through fixed timesteps or imports rendering code. Renderer
line thickness remains presentation-only; collision offsets use the dynamic ball radius and the
zero-thickness physical segment contract.

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

FLAME-49 applies that rule independently to every dynamic body. One renderer object is retained per
stable body ID; a body is hidden before its declared release, becomes visible only where its own
trajectory has authoritative coverage, and exposes recorded velocity, motion mode, lifecycle and
exact-time contact-component membership to the workbench. A body with an explicit terminal outcome
may retain its final recorded pose while the world replay continues, but its velocity is presented
as stopped and its trajectory is never extended. Scheduled bodies, missing intervals and unresolved
history beyond the world prefix remain absent rather than being inferred or overlap-corrected.

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

The route also serializes five declarative `workbench/fixtures` synthetic multi-body records and
immediately routes them through that same public saved-run parser before acceptance. They are
labelled synthetic contract evidence at every selection/source surface. Their trajectories,
contacts, components and failure boundaries are precomputed declarations; neither the route nor the
renderer invokes a multi-body producer or derives missing physics from them.

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
  selected body/history evidence and presentation clock;
- `scenario-catalogue.ts` assembles public world descriptors without copying `SimulationInput`,
  while `ScenarioCatalogue` owns grouped selection, submitted-setting presentation, declared
  event/replay expectations and expected-versus-actual outcome presentation;
- the named `workbench/input` subdomain owns editable simulation inputs: `SimulationInputControls`
  presents the load/save/run workflow, `BallControls` owns the bounded one-at-a-time dynamic-body
  editor, `SimulationSettingsControls` owns Environment and Run limits, `velocity-entry.ts`
  converts velocity representations, and `simulation-input-draft.ts` validates every body and
  creates a deep immutable submitted input;
- the named `workbench/inspection` subdomain owns the selected-body view and the unified physical
  history assembled from releases, fixed-world events, dynamic contacts, component transitions and
  pair-prediction evidence;
- `workbench/layout` composes the replay and evidence regions without owning session state, while
  `simulation-workbench.css` owns their responsive grid;
- `workbench/fixtures` owns explicitly labelled precomputed synthetic contract records used only to
  prove public playback and inspection behavior; it never calls or substitutes for a solver;
- `workbench/io` owns browser download object-URL lifecycle and fixture-error presentation;
- `workbench/session` owns the browser animation-frame lifecycle that advances only the
  presentation clock;
- `SimulationViewport` owns Three.js mount, update and disposal;
- application bar and playback controls expose typed callbacks rather than reaching into renderer
  state; and
- the run inspector, body inspector, physical history, diagnostics console and metrics panel render
  read-only views of the accepted run.

Draft input, submitted input, returned run record and presentation clock are distinct state. Preset
selection and field editing cannot mutate an accepted run. The explicit Run action is the only path
from a simulation-input draft to simulation; renderer playback still receives only the returned run
through `toRendererPlaybackInput`. Every accepted calculated or loaded run is also checked through
`validateSimulationRun`; a failed check switches the workbench to invalid-prefix inspection and
adds structured verification failures to presentation/export evidence without mutating the
authoritative run record.

The workbench catalogue includes canonical launches, every named board-state verification world and
the curated adversarial/physical-settings experiments. Its stable category vocabulary also reserves
a saved-regression home so defect fixtures can join through descriptors rather than scenario-specific
UI. Outcome matching uses the returned run record; rendering remains presentation-only.

`simulation/serialization/simulation-input` provides the versioned JSON boundary for scenario
inputs. It retains the version 6 shape reader for migration and owns current version 7 structural
and release-state validation. Saved run records use the independent `simulation/serialization/run-record` boundary,
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
