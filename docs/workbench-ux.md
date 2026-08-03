# Diagnostic simulation workbench UX

## Purpose and scope

This document defines the browser prototype as a diagnostics and experiment workbench for saved and
newly calculated simulation runs. FLAME-23 established the replay and inspection surface, FLAME-31
added explicit launch controls, FLAME-37 exposed the complete named single-ball verification
catalogue, and FLAME-49 adds precomputed multi-body experiment replay and inspection without
claiming production multi-body physics support.

The large headline, explanatory essay and decorative `simulation -> completed run -> renderer`
strip in the current route are removed. A compact application bar provides identity and source
controls. The viewport is the largest region, while exact run, event and diagnostic data remain
available around it.

The workbench edits the supported mass, radius, release time, initial position and velocity for one
selected dynamic body at a time. It does not provide arbitrary board construction, peg dragging or
continuous recalculation. Multi-body inputs can be saved and reloaded, but the production Run action
remains disabled for them until a public multi-body solver exists.

## Product principles

- **Tool first:** the viewport and playback controls dominate the initial view.
- **Recorded data is authoritative:** UI and Three.js state never modify the loaded run.
- **Calculation and replay are distinct:** status copy always says whether calculation completed;
  transport state only describes presentation of the recorded result.
- **Exact values beat animation alone:** stored event timestamps and diagnostic values are visible
  and selectable.
- **Failures remain useful:** structurally valid failed runs expose their status, reason,
  diagnostics and any inspectable recorded prefix.
- **Density is progressive:** the persistent summary is compact; event, diagnostic and metric
  detail lives in bounded panels.
- **Measurements are honest:** recorded, derived, live-measured and unavailable values are visibly
  distinguished.
- **Responsive means rearranged, not simplified into a hero:** narrow screens stack the same tool
  regions without restoring introductory marketing content.

## Terminology

Use these terms consistently in component names, labels, tests and accessible descriptions.

| Term                     | Meaning                                                                                                                                                         | UI usage                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Run**                  | A parsed, contract-valid `SimulationRunRecord`, including its input, trajectories, events, terminal status and diagnostics.                                     | “Current run”, “Run status”                                                               |
| **Source**               | Workbench metadata identifying where the run was loaded from. It is not part of contract v6.                                                                    | `Repository fixture · canonical-event-driven-offset-drop.json` or `Local file · run.json` |
| **Simulation time**      | Domain time recorded in trajectory segments, events and diagnostics, measured from run `t = 0`.                                                                 | Event and diagnostic timestamps                                                           |
| **Simulated until**      | `run.diagnostics.simulatedUntilTime`: the end of the calculation’s recorded or validated horizon. It does not imply success.                                    | Run inspector                                                                             |
| **Playable until**       | The greatest simulation time the presentation may seek to for the current inspection mode. For the current complete-run adapter it equals `simulatedUntilTime`. | Playback controls and run inspector                                                       |
| **Replay time**          | The current presentation cursor. Advancing or seeking it evaluates recorded segments; it does not calculate new motion.                                         | `Replay 0.750 s / 2 s`                                                                    |
| **Calculation outcome**  | `run.validity`, stable `run.outcome`, and the detailed `run.terminalReason`.                                                                                    | Persistent outcome badge and run inspector                                                |
| **Transport state**      | Presentation-only state: `playing`, `paused` or `ended`.                                                                                                        | Viewport/controls; never labelled as run status                                           |
| **Recorded prefix**      | Trajectories and events retained up to a failed calculation’s validated horizon.                                                                                | “Recorded prefix inspection” for unresolved or iteration-limited runs                     |
| **Calculation duration** | `run.diagnostics.simulationWallTimeMilliseconds`; wall-clock instrumentation that never participates in physical advancement.                                   | Metrics panel                                                                             |

Prefer **replay** in user-facing transport copy because the workbench presents already calculated
data. Use **playback** for the underlying presentation subsystem where that is already established.
Never call replay progression “simulation progress”.

## Workbench session state

The workbench has independent calculation and presentation state. Components must not collapse
them into one “status”.

1. **Draft input:** editable controls that have no effect on the current run.
2. **Submitted input:** an immutable snapshot created only by an explicit Run action.
3. **Load state:** idle, reading, accepted or rejected.
4. **Calculation outcome:** `run.validity`, `run.outcome`, and `run.terminalReason` stored in the current run.
5. **Transport state:** paused, playing or ended for the current replay cursor.

The session retains:

- the last successfully parsed and contract-valid run;
- its source descriptor;
- the current replay cursor and transport state;
- the most recent load attempt feedback; and
- the selected event, if any.

A rejected load attempt changes only load feedback. It does not change the current run, source,
cursor, viewport, event selection or diagnostics.

### Scenario catalogue and launch controls

The catalogue groups canonical launches, named board-state scenarios and curated adversarial
experiments by stable category.
Each descriptor retains its authoritative `SimulationInput` rather than copying scene, body or
settings fields. The browser shows the selected stable ID, purpose, scene ID, complete ball,
environment and run-limit settings, expected or permitted outcomes, relevant event/contact-mode
characteristics, and complete-versus-valid-prefix replay contract before calculation.
Physical-settings and adversarial-contact categories contain the FLAME-39 experiments; the
saved-regression category remains the stable home for a defect promoted to a permanent fixture.

Selecting a preset replaces the draft but does not calculate or replace the current run. Position
uses labelled `x` and `y` metre inputs. Velocity can be entered either as speed plus angle or as
direct `x` and `y` metre-per-second components. The explicit Run action is the only operation that
replaces the accepted run and rendered world.

Angles are measured in degrees from positive `x`, with positive angles rotating toward positive
`y`. The workbench converts speed and angle with `vx = speed × cos(angle)` and
`vy = speed × sin(angle)`, normalising floating-point components smaller than `1e-15` to zero.
Switching velocity entry modes preserves the represented vector.

Run validates field syntax and the supported single-ball scenario policy, creates a deep,
immutable input snapshot, calls `constructSingleBallRun`, and atomically accepts the returned
record. Invalid draft input leaves the current run and transport untouched. A valid but unresolved
calculation is accepted in recorded-prefix mode rather than ordinary playback.

The draft model itself is multi-body: it snapshots every body's stable ID, mass, radius, release
time, initial position and initial velocity through the versioned `simulation-input` serializer.
Loading any accepted saved run also makes its complete input available as a separate editable draft.
For more than one body, Save scenario remains available and Run clearly states that production
multi-body calculation is unavailable; choosing a synthetic run never routes that draft into the
single-body producer.

**Save scenario** and **Export diagnostics** are adjacent but distinct actions. Save scenario
serialises the editable draft input for later loading and rerunning. Export diagnostics snapshots
the currently accepted run, its source provenance, authoritative history, valid-prefix boundary,
contact searches and console diagnostics into one versioned evidence file. Draft edits after Run do
not change the diagnostic export. If no accepted run exists the export action is disabled with an
explanation; serialization or download failure is reported without replacing the current run.

After calculation, the catalogue compares `run.outcome` with the submitted descriptor's permitted
outcomes. A match or mismatch is textual and visible alongside the expected values. Selecting a
different draft, or loading a saved run, clears that association without changing the accepted run;
the renderer never decides whether an outcome is correct.

Scenario input files use a versioned JSON envelope with `contractVersion: 7`,
`documentType: "simulation-input"` and an `input` value conforming to `SimulationInput`. Loading
passes through structural, identity, mass and declared-release validation; invoking the current
single-ball runner then applies its narrower one-body, time-zero-release policy. Saved run files
continue through the separate saved-run boundary. Version 6 scenario envelopes migrate explicitly
to unit mass and release time zero.

### Inspection modes

| Validity / outcome                    | Mode                           | Viewport and transport behaviour                                                                                            | Required status copy                                  |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `valid` / `exited` or `settled`       | **Completed replay**           | Full seek, play, pause and restart are available.                                                                           | “Calculation complete · replaying recorded data”      |
| `valid` / any other supported outcome | **Recorded-prefix inspection** | Play, pause, restart, seek and event selection are limited to committed segments and freeze at the terminating boundary.    | Typed terminal-reason label and detail when available |
| `invalid` / `invalid`                 | **Invalid-prefix inspection**  | Render and play any committed prefix with invalid styling; zero-duration records show the initial state with transport off. | “Invalid committed prefix”                            |

Prefix inspection is deliberately different from ordinary successful playback. It evaluates only
recorded poses, never a proposed candidate trajectory. The visible upper bound is
`playableUntilTime`; transport freezes there and the unresolved or invalid overlay remains visible.
The failure-boundary report labels candidate contact data as uncommitted diagnostic evidence.

An invalid JSON document or structurally invalid record is not a run with `validity === 'invalid'`.
It is a **rejected load attempt** and never becomes the current run.

## Desktop information architecture

Use a single full-width workbench shell with a practical maximum content width of approximately
`1600px`. At widths of `1100px` and above:

1. The compact application bar spans the page.
2. The primary workspace uses a `minmax(0, 2fr) minmax(18rem, 0.8fr)` grid.
3. The viewport and its controls occupy the larger left column.
4. The persistent run inspector occupies the right column.
5. The evidence area sits below as three bounded panels: physical history, diagnostics console and
   metrics.

The viewport must remain the largest single surface by both area and visual weight. Evidence panels
may scroll internally; they must not force the viewport below the fold merely because a run has many
events or diagnostics.

```text
+--------------------------------------------------------------------------------------+
| Event-Driven Simulation | source: canonical... | [Fixture v] [Load JSON] | feedback |
+--------------------------------------------------------------------------------------+
|                                                                      |               |
|  CALCULATED RUN REPLAY                         [COMPLETE] [PAUSED]     | RUN INSPECTOR |
|                                                                      | status/reason |
|                         THREE.JS VIEWPORT                            | source/version|
|                                                                      | time horizons |
|                                                                      | counts        |
|                                                                      | settings      |
|  [Play] [Restart] [---------------- seek ----------------] 0.750 / 2s |               |
+--------------------------------------------------------------------------------------+
| EVENT TIMELINE (widest)          | DIAGNOSTICS CONSOLE      | METRICS               |
| #  time       type body other    | sev code time body msg   | recorded / derived    |
| 1  1 s        ...                | ...                      | unavailable           |
+--------------------------------------------------------------------------------------+
```

This is a responsibility and hierarchy specification, not a pixel-perfect visual design. FLAME-23
may tune spacing, surfaces and column ratios while preserving the ordering, dominance and component
homes.

## Region specifications

### Compact application bar

The bar is one or two compact rows, not a hero. It contains:

- the short identity **Event-Driven Simulation**;
- the current source label;
- an explicit run/experiment selector grouped by production, synthetic-contract and regression
  provenance;
- a **Load saved run** action backed by a file input accepting `.json` and JSON MIME types; and
- concise load feedback.

The run catalog is a small explicit build-time list. It contains the production-recorded
`canonical-event-driven-offset-drop.json` plus the five FLAME-49 synthetic contract records. Do not
introduce runtime directory discovery, a backend or a fixture database. Synthetic records carry a
persistent warning that they are contract evidence, not production solver output.

The current source label is never replaced by the name of a rejected candidate. During a local file
attempt, feedback may say `Could not load candidate.json`, while the source continues to say
`Repository fixture · canonical-event-driven-offset-drop.json`.

Success feedback is short and non-sticky, for example `Loaded run.json · contract v7`. Rejection
feedback contains the typed error code, message and validation path when present:

```text
UNSUPPORTED_CONTRACT_VERSION · expected version 6 or 7 · $.contractVersion
```

The detailed run diagnostics console contains diagnostics from the current run only. Candidate file
read/parser/validation errors stay in load feedback so they cannot be mistaken for simulation
diagnostics.

Diagnostic export uses its own schema version and discriminator rather than the saved-run contract
version. The action is labelled **Export diagnostics** and does not imply that the resulting file is
loadable as a scenario or saved run.

### Primary replay workspace

The primary workspace contains the viewport, a compact viewport header and playback controls.

The viewport header always shows:

- mode label: **Calculated run replay**, **Recorded-prefix inspection** or **Invalid-prefix inspection**;
- calculation-status badge; and
- transport badge when transport exists.

The calculation badge and transport badge are separate. `Complete · Paused` is valid;
`Run: playing` is not.

The viewport preserves the scene’s presentation mapping and accessible description. A status
overlay must not rely on colour alone. For non-complete runs the overlay remains visible above the
scene and states the restricted mode.

Playback controls provide:

- play/pause;
- restart;
- a range seek control;
- current replay time;
- playable-until time; and
- a concise **Recorded data** label or equivalent.

The range uses the recorded time domain, not frame numbers. Keyboard interaction must support
fine-grained seeking. Displayed event timestamps come directly from stored `event.time` values
without frame-derived rounding, and selecting an event passes the stored numeric timestamp to the
seek operation.

Interaction rules:

- accepting any run resets the cursor to `0`, pauses transport and clears event selection;
- **Play** from the end restarts at `0`, matching `PlaybackClock`;
- **Restart** sets the cursor to `0` and starts replay for any non-zero committed prefix;
- seeking to the end stops transport;
- manual seek pauses first, then updates the viewport;
- selecting an event pauses, seeks to that exact stored timestamp and marks the event selected;
- a zero-duration completed run shows `0 / 0 s` with play and restart disabled; and
- prefix-inspection restrictions follow the inspection-mode table above.

### Persistent run inspector

The inspector answers “what data am I looking at, and how trustworthy/complete is it?” without
requiring another panel to open.

Show these groups in order:

1. **Outcome:** calculation status, reason when present and the complete-run statement
   `Calculation completed before replay began`.
2. **Provenance:** source kind and name, scene ID and contract version.
3. **Time horizon:** simulated-until and playable-until values, labelled separately even when
   equal.
4. **Contents:** dynamic body, static collider, trajectory, segment, physical-event and diagnostic
   counts.
5. **Numerical policy:** gravity, restitution, maximum events, maximum simulation time,
   contact-distance tolerance and event-time tolerance.

Use a compact definition-list or key/value layout. Values may wrap; do not truncate the status
reason or source name without an accessible full value. Numerical-policy values may live in an
expanded-by-default subsection on desktop and a disclosure on narrow screens.

Counts are derived without mutating the run:

```text
bodies       = input.initialDynamicBodies.length
colliders    = input.scene.staticColliders.length
trajectories = trajectories.length
segments     = sum(trajectory.segments.length)
events       = events.length
diagnostics  = diagnostics.entries.length
```

### Physical history

The history surface merges recorded releases, `run.events`, dynamic contacts, component lifecycle
transitions and pair-prediction decisions into one stable time-ordered list. Same-time entries stay
separate and selectable. It is a table-like list with a sticky header on desktop and a stacked
label/value layout on narrow screens.

Each physical event exposes:

- one-based display sequence, while preserving zero-based array index internally;
- stored simulation timestamp with `s` unit;
- type (`contact`) or, for contact-mode transitions, `from → to`;
- `bodyId`;
- `colliderId`;
- contact position `(x, y)`; and
- contact normal `(x, y)` in an optional detail row or disclosure; and
- the transition reason for `contact-mode-transition` entries.

Each selectable entry is one keyboard-operable control, not a clickable collection of table cells.
The selected entry uses `aria-current="true"` or equivalent and a non-colour-only selected
indicator. Selection follows the interaction rules in the primary workspace.

For every accepted run, history entries seek within the committed prefix. Selecting a body filters
the list to evidence that names that body; selecting an item seeks to its exact stored time. Dynamic
contacts show both participants, normal, impulse, incoming/outgoing normal velocity and state.
Component transitions show their prior and resulting component IDs, and prediction decisions show
their body revisions and invalidation reason.

### Body inspector

The body inspector provides an `All bodies` option plus one bounded selector for every dynamic body,
so a roughly twenty-body run does not permanently expand twenty histories. For a selected body it
shows ID, mass, radius, release time, initial state, current recorded position and velocity, current
motion mode, time-relative lifecycle, terminal outcome and exact-time component membership. It also
lists that body's authoritative trajectory segments and marks the segment used at the replay cursor.

Selecting a body scales its renderer object for presentation emphasis and de-emphasizes the other
bodies. The selection does not alter positions, contacts or motion authority. The same selection
filters physical history and body-specific diagnostics while retaining world-level diagnostics.

### Diagnostics console

The console is a structured list, visually monospaced but semantically readable. It supports all
run statuses and shows each entry’s:

- severity (`info`, `warning` or `error`);
- diagnostic `code`;
- simulation timestamp or `—`;
- `bodyId` or `—`; and
- full message.

Keep the source array order. Use severity text/icons as well as colour. A clear list is the required
Milestone 1 behaviour; severity filters are optional and should be added only if the implementation
remains small. If filters are added, `All` is the default and a zero-result filtered state must not
look like an empty diagnostic record.

Show the typed `run.terminalReason` and its detail, region or limit context in the run inspector.
Do not merge load-attempt errors into this console.

For an empty list, show `No diagnostic entries were recorded`. This is not the same as a successful
run and must not override the calculation-status badge.

### Metrics and profiling

The metrics panel gives measurements a stable home without implying that absent profiler data
exists. Each metric carries one of these provenance labels:

- **Recorded:** stored in the run record.
- **Derived:** counted or calculated losslessly from stored run data.
- **Live presentation:** deliberately measured by the browser presentation layer.
- **Unavailable:** not present or measured in the current milestone.

Milestone 1 shows:

| Metric                        | Provenance  | Current value source                         |
| ----------------------------- | ----------- | -------------------------------------------- |
| Solver iterations             | Recorded    | `diagnostics.iterations`                     |
| Simulated until               | Recorded    | `diagnostics.simulatedUntilTime`             |
| Event count                   | Recorded    | `diagnostics.eventCount`                     |
| Candidate count               | Recorded    | `diagnostics.candidateCount`                 |
| Segment count                 | Recorded    | `diagnostics.segmentCount`                   |
| Diagnostic counts by severity | Derived     | Count of `diagnostics.entries`               |
| Calculation duration          | Recorded    | `diagnostics.simulationWallTimeMilliseconds` |
| Validation duration           | Unavailable | Loader does not record it                    |
| Renderer FPS/frame time       | Unavailable | Not deliberately measured                    |
| Lookahead/horizon performance | Unavailable | Deferred beyond Milestone 1                  |

Do not use a live stopwatch around fixture parsing and label it “calculation duration”. Do not infer
solver performance from simulation time, event count or iterations. Live renderer measurements
remain unavailable until a later issue deliberately defines sampling, aggregation and lifecycle.

The count summary may appear in both the inspector and metrics panel: the inspector establishes run
identity at a glance, while the metrics panel groups measurement provenance. Avoid duplicating
long settings or diagnostic messages.

## Saved-run workflows

### Select a repository fixture

1. The user chooses a fixture from the explicit catalog.
2. The application loads its raw JSON through `parseSimulationRunFixture`.
3. The candidate is accepted atomically only after parse and contract validation succeed.
4. The workbench sets source kind/name, determines inspection mode from validity and terminal reason, resets replay
   state and reports success.
5. An unexpected bundled-fixture failure follows the same rejection rules and retains the previous
   run.

### Load a local saved-run

1. **Load saved run** opens a single-file picker.
2. The selected file is read as text in the browser; no content is uploaded.
3. The text passes through `parseSimulationRunFixture`. Do not call `JSON.parse` or a version
   validator directly from a UI component.
4. `MALFORMED_FIXTURE_JSON`, `UNSUPPORTED_CONTRACT_VERSION` and `INVALID_RUN_RECORD` are shown with
   code, message and path where available.
5. On rejection, retain the previous run and source exactly.
6. On acceptance, set source to `Local file · <browser-provided filename>`, reset replay state and
   enter the mode dictated by the run’s calculation status.
7. Clear the input element’s selected value after the attempt so the same file can be chosen again.

The browser-provided filename is provenance display metadata, not an authoritative filesystem path
and not part of the run record.

### Accept a failed calculation record

A structurally valid record with a non-completion terminal reason or invalid validity loads
successfully. It replaces the prior current run because its outcome is domain data worth
inspecting, not a loader failure. The workbench then applies the restricted inspection mode and
never silently promotes its terminal reason to `completion-region`.

### Load feedback lifecycle

- `Reading <name>…` is a polite live status.
- Success is announced after the run and source are committed together.
- Rejection is an alert and explicitly says that the current run was retained.
- Starting another attempt replaces prior attempt feedback.
- Load feedback is separate from the run’s diagnostic-entry count.

## Responsive behaviour

### Compact layout: `720px` to `1099px`

- The application bar may wrap source controls onto a second row.
- The primary workspace becomes one column: viewport, controls, then run inspector.
- The inspector uses a multi-column key/value grid where space permits.
- The evidence area uses two columns: physical history and diagnostics; metrics spans both below.
- The viewport remains at least `50vh` where viewport height permits and stays more prominent than
  any one evidence panel.

### Narrow layout: below `720px`

Stack regions in this exact order:

1. compact application bar;
2. viewport header and viewport;
3. playback controls;
4. run inspector;
5. physical history;
6. diagnostics console;
7. metrics.

The application bar identity, source and load action wrap; none becomes a large headline. Playback
buttons share one row, while seek and time output occupy full-width rows. The viewport uses the
available width with a practical minimum height of `320px`; avoid a fixed desktop aspect ratio that
pushes controls off-screen on short devices.

The run inspector remains expanded so status and source are always visible. Its numerical-policy
subsection may use a native disclosure. Event and diagnostic panels have bounded heights of roughly
`40vh` with internal scrolling, so one long list does not make the rest of the workbench
unreachable. Metrics remain a separate region and do not become a carousel.

Touch targets are at least `44px` in their smallest interactive dimension. Horizontal scrolling is
not required for primary controls. Timeline entries reflow to stacked rows instead of forcing a
wide table.

## Component and state responsibilities for FLAME-23

Names may vary, but ownership must match these boundaries.

| Component or module          | Owns                                                                                                                | Must not own                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `+page.svelte`               | Route composition and the explicit production/synthetic run catalog                                                 | Three.js lifecycle, animation frame loop, file parsing details or full workbench CSS |
| `SimulationWorkbench`        | Current accepted run/source, load-attempt state, inspection mode, selected body/history item and panel coordination | Physical calculations or mutation of run records                                     |
| `scenario-catalogue.ts`      | Workbench descriptors, stable categories and authoritative outcome comparison                                       | Copied simulation inputs or renderer-derived correctness                             |
| `ScenarioCatalogue`          | Grouped selection and read-only selected-scenario/outcome presentation                                              | Draft mutation beyond emitting a selected ID or simulation execution                 |
| `SimulationInputControls`    | Scenario-input load/save/run actions and draft-submission feedback                                                  | Field parsing, scenario grouping or renderer state                                   |
| `BallControls`               | One-at-a-time body ID, mass, radius, release, position and velocity presentation                                    | Environment policy, run execution or accepted-run mutation                           |
| `SimulationSettingsControls` | Visually separate Environment and Run limits fields                                                                 | Solver tolerances or physical calculation                                            |
| `simulation-input-draft.ts`  | Generic draft prepopulation, field validation and immutable input submission                                        | Scenario-specific branches or simulation execution                                   |
| `velocity-entry.ts`          | Speed/angle and component velocity conversion                                                                       | Input fixture parsing or run state                                                   |
| `ApplicationBar`             | Source display, fixture selection, local-file interaction and load feedback presentation                            | Direct parser/version implementation or playback state                               |
| `SimulationViewport`         | Three.js mount/update/destroy lifecycle and rendering the supplied recorded frame                                   | Run loading, authoritative time, run mutation or status promotion                    |
| `PlaybackControls`           | Accessible transport/seek presentation through typed values and callbacks                                           | Direct access to Three.js objects or the run loader                                  |
| `RunInspector`               | Read-only status, provenance, horizon, count and submitted-settings presentation                                    | Transport or file-input state                                                        |
| `inspection/BodyInspector`   | Selected-body identity, current recorded state, component membership and trajectory segment presentation            | Motion evaluation, run mutation or mesh positioning                                  |
| `inspection/PhysicalHistory` | Read-only merged release/event/contact/component/prediction list and exact-time seek callback                       | Clock mutation beyond emitting the selected stored timestamp                         |
| `DiagnosticsConsole`         | Read-only diagnostic-entry presentation and optional local severity filter                                          | Load errors or synthetic diagnostics                                                 |
| `MetricsPanel`               | Recorded/derived/unavailable metric presentation                                                                    | Speculative profiling collection                                                     |

`SimulationWorkbench` may use a focused playback controller/store if that keeps request-animation
frame and transport state cohesive. Do not introduce an application-wide store for this
single-workbench session.

The preferred data flow is:

```text
repository/local JSON
    -> public saved-run parser and validator
    -> immutable current run + source
    -> inspection-mode decision
    -> playback controller -> recorded frame -> viewport
    -> read-only run/body inspectors, physical history, diagnostics and metrics views
```

Event selection sends one stored simulation timestamp to the playback controller. The evaluated
frame then flows to the viewport; the event list never manipulates a mesh.

## Data availability boundary

### Available now

- grouped canonical and board-state scenario selection with precise multi-body mass, radius,
  release-time, initial-position and velocity editing;
- selected scenario purpose, scene, initial-state and permitted-outcome evidence;
- authoritative actual-outcome matching after explicit calculation;
- explicit headless simulation runs from immutable submitted input;
- versioned scenario input load/save;
- contract version;
- scene ID and source name/kind;
- run validity and every typed terminal reason;
- bodies, static colliders and their physical circle data;
- simulation settings and tolerances;
- trajectories and segment counts;
- full fixed-world and body-body contact records with time, participants, position, normal and
  impulse evidence;
- release history, contact-component lifecycle and pair-prediction invalidation evidence;
- solver iteration count;
- solver candidate and segment counts;
- solver calculation duration;
- simulated-until time;
- structured diagnostics; and
- playable-until time derived by the current renderer adapter.

### Derived without loss

- body, collider, trajectory, segment, event and diagnostic counts;
- diagnostic counts by severity;
- selected/current event relative to replay time; and
- transport state.

### Deferred or unavailable

- saved-run validation duration;
- frame time and FPS;
- memory, lookahead or rolling-horizon metrics;
- saved-run export;
- comparison between runs; and
- remote storage or fixture discovery.

Unavailable measurements should be listed as `Unavailable · not recorded` when that context is
useful. Do not render fake zeroes, estimates, progress bars or disabled controls that imply an
implementation already exists.

## Accessibility and formatting requirements

- Use one `main` workbench landmark and labelled regions for replay workspace, run inspector, event
  timeline, diagnostics and metrics.
- The viewport keeps an accessible description; overlays and canvas content are not the only source
  of run information.
- Status differences use text plus colour/icon treatment.
- File-load feedback uses polite status for progress/success and alert semantics for rejection.
- All controls are keyboard reachable with visible focus.
- Event rows are keyboard-operable controls with a programmatically exposed selected state.
- Times always include `s`; vectors use labelled `(x, y)` values; counts use integers.
- Do not truncate exact numeric event values to the current animation frame rate.
- Respect reduced-motion preferences for decorative pulses or transitions. Replay itself remains an
  explicit user-controlled technical function.

## FLAME-23 implementation checklist

- Remove the intro/hero and decorative data-flow strip.
- Build the application bar, dominant viewport workspace and persistent inspector in the specified
  desktop hierarchy.
- Implement the compact and narrow stacking order.
- Keep calculation status, load state and transport state separate.
- Route every repository and local candidate through the public saved-run boundary.
- Preserve the current accepted run on parser or validation rejection.
- Expose all events and diagnostics, including empty states.
- Implement event selection as an exact seek for eligible inspection modes.
- Apply completed-replay, recorded-prefix and invalid-prefix restrictions.
- Show recorded/derived/unavailable metric provenance without adding a profiler.
- Keep route, viewport lifecycle, controls and read-only diagnostic regions in cohesive component
  homes.
- Update browser tests to target stable workbench roles and cover the workflows required by
  FLAME-23.
