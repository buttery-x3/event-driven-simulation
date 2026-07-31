# Diagnostic simulation workbench UX

## Purpose and scope

This document defines the browser prototype as a diagnostics workbench for saved simulation runs.
It is the implementation specification for FLAME-23. The workbench loads, validates, replays and
inspects calculated trajectory data; it is not a project landing page and does not run or edit a
simulation scenario.

The large headline, explanatory essay and decorative `simulation -> completed run -> renderer`
strip in the current route are removed. A compact application bar provides identity and source
controls. The viewport is the largest region, while exact run, event and diagnostic data remain
available around it.

Scenario authoring, invoking the real solver and exporting scenarios or runs belong to FLAME-24.
FLAME-23 must not add placeholder controls for those capabilities.

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

| Term                     | Meaning                                                                                                                                                         | UI usage                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Run**                  | A parsed, contract-valid `SimulationRunRecord`, including its input, trajectories, events, terminal status and diagnostics.                                     | “Current run”, “Run status”                                                        |
| **Source**               | Workbench metadata identifying where the run was loaded from. It is not part of contract v3.                                                                    | `Repository fixture · canonical-synthetic-contact.json` or `Local file · run.json` |
| **Simulation time**      | Domain time recorded in trajectory segments, events and diagnostics, measured from run `t = 0`.                                                                 | Event and diagnostic timestamps                                                    |
| **Simulated until**      | `run.diagnostics.simulatedUntilTime`: the end of the calculation’s recorded or validated horizon. It does not imply success.                                    | Run inspector                                                                      |
| **Playable until**       | The greatest simulation time the presentation may seek to for the current inspection mode. For the current complete-run adapter it equals `simulatedUntilTime`. | Playback controls and run inspector                                                |
| **Replay time**          | The current presentation cursor. Advancing or seeking it evaluates recorded segments; it does not calculate new motion.                                         | `Replay 0.750 s / 2 s`                                                             |
| **Calculation status**   | `run.status`: `complete`, `unresolved`, `iteration-limited` or `invalid`.                                                                                       | Persistent status badge and run inspector                                          |
| **Transport state**      | Presentation-only state: `playing`, `paused` or `ended`.                                                                                                        | Viewport/controls; never labelled as run status                                    |
| **Recorded prefix**      | Trajectories and events retained up to a failed calculation’s validated horizon.                                                                                | “Recorded prefix inspection” for unresolved or iteration-limited runs              |
| **Calculation duration** | Wall-clock time spent calculating a run. This is not simulation time and is not present in contract v3.                                                         | Metrics panel only when a future schema records it                                 |

Prefer **replay** in user-facing transport copy because the workbench presents already calculated
data. Use **playback** for the underlying presentation subsystem where that is already established.
Never call replay progression “simulation progress”.

## Workbench session state

The workbench has three independent state axes. Components must not collapse them into one
“status”.

1. **Load state:** idle, reading, accepted or rejected.
2. **Calculation status:** the terminal `run.status` stored in the current run.
3. **Transport state:** paused, playing or ended for the current replay cursor.

The session retains:

- the last successfully parsed and contract-valid run;
- its source descriptor;
- the current replay cursor and transport state;
- the most recent load attempt feedback; and
- the selected event, if any.

A rejected load attempt changes only load feedback. It does not change the current run, source,
cursor, viewport, event selection or diagnostics.

### Inspection modes

| Run status          | Mode                           | Viewport and transport behaviour                                                                                               | Required status copy                                                        |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `complete`          | **Completed replay**           | Full seek, play, pause and restart are available.                                                                              | “Calculation complete · replaying recorded data”                            |
| `unresolved`        | **Recorded-prefix inspection** | Do not autoplay or offer ordinary continuous playback. Allow explicit seek and event selection within the recorded prefix.     | “Unresolved · inspecting recorded prefix” plus `status.reason`              |
| `iteration-limited` | **Recorded-prefix inspection** | Same as `unresolved`.                                                                                                          | “Iteration limit reached · inspecting recorded prefix” plus `status.reason` |
| `invalid`           | **Diagnostics only**           | Disable replay and event-seek actions. Keep the viewport in a clearly unavailable state; show record metadata and diagnostics. | “Invalid run · replay unavailable” plus `status.reason`                     |

Prefix inspection is deliberately different from ordinary playback. It may evaluate already
recorded poses at a user-selected time, but it must not imply that calculation completed or that
unrecorded motion is safe. The visible upper bound is `playableUntilTime`, and the unresolved
overlay remains present while inspecting it.

An invalid JSON document or structurally invalid record is not a run with `status.type ===
'invalid'`. It is a **rejected load attempt** and never becomes the current run.

## Desktop information architecture

Use a single full-width workbench shell with a practical maximum content width of approximately
`1600px`. At widths of `1100px` and above:

1. The compact application bar spans the page.
2. The primary workspace uses a `minmax(0, 2fr) minmax(18rem, 0.8fr)` grid.
3. The viewport and its controls occupy the larger left column.
4. The persistent run inspector occupies the right column.
5. The evidence area sits below as three bounded panels: event timeline, diagnostics console and
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
- an explicit repository fixture selector;
- a **Load saved run** action backed by a file input accepting `.json` and JSON MIME types; and
- concise load feedback.

The repository fixture catalog is a small explicit build-time list. Initially it contains
`canonical-synthetic-contact.json`. Do not introduce runtime directory discovery, a backend or a
fixture database.

The current source label is never replaced by the name of a rejected candidate. During a local file
attempt, feedback may say `Could not load candidate.json`, while the source continues to say
`Repository fixture · canonical-synthetic-contact.json`.

Success feedback is short and non-sticky, for example `Loaded run.json · contract v3`. Rejection
feedback contains the typed error code, message and validation path when present:

```text
UNSUPPORTED_CONTRACT_VERSION · expected version 3 · $.contractVersion
```

The detailed run diagnostics console contains diagnostics from the current run only. Candidate file
read/parser/validation errors stay in load feedback so they cannot be mistaken for simulation
diagnostics.

Contract v2 has no export operation. FLAME-23 therefore renders no export button, including no
disabled placeholder. FLAME-24 may add export beside the load action when the operation exists.

### Primary replay workspace

The primary workspace contains the viewport, a compact viewport header and playback controls.

The viewport header always shows:

- mode label: **Calculated run replay**, **Recorded-prefix inspection** or **Diagnostics only**;
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
- **Restart** sets the cursor to `0` and starts replay for a complete non-zero-duration run,
  matching current behaviour;
- seeking to the end stops transport;
- manual seek pauses first, then updates the viewport;
- selecting an event pauses, seeks to that exact stored timestamp and marks the event selected;
- a zero-duration completed run shows `0 / 0 s` with play and restart disabled; and
- prefix-inspection and diagnostics-only restrictions follow the inspection-mode table above.

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

### Event timeline

The timeline displays every `run.events` entry in source order. It is a table-like list with a
sticky header on desktop and a stacked label/value layout on narrow screens.

Each current contact event exposes:

- one-based display sequence, while preserving zero-based array index internally;
- stored simulation timestamp with `s` unit;
- type (`contact`);
- `bodyId`;
- `colliderId`;
- contact position `(x, y)`; and
- contact normal `(x, y)` in an optional detail row or disclosure.

Each selectable entry is one keyboard-operable control, not a clickable collection of table cells.
The selected entry uses `aria-current="true"` or equivalent and a non-colour-only selected
indicator. Selection follows the interaction rules in the primary workspace.

For diagnostics-only runs, timeline entries remain readable but are not seek actions. For an empty
event list, show `No physical events were recorded`; do not hide the panel.

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

Show the terminal `run.status.reason` in the run inspector, not duplicated as a synthetic diagnostic
entry. Do not merge load-attempt errors into this console.

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

| Metric                        | Provenance  | Current value source             |
| ----------------------------- | ----------- | -------------------------------- |
| Solver iterations             | Recorded    | `diagnostics.iterations`         |
| Simulated until               | Recorded    | `diagnostics.simulatedUntilTime` |
| Event count                   | Derived     | `events.length`                  |
| Segment count                 | Derived     | Sum of trajectory segment counts |
| Diagnostic counts by severity | Derived     | Count of `diagnostics.entries`   |
| Calculation duration          | Unavailable | Contract v2 has no field         |
| Validation duration           | Unavailable | Loader does not record it        |
| Renderer FPS/frame time       | Unavailable | Not deliberately measured        |
| Lookahead/horizon performance | Unavailable | Deferred beyond Milestone 1      |

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
4. The workbench sets source kind/name, determines inspection mode from `run.status`, resets replay
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

A structurally valid record whose status is `unresolved`, `iteration-limited` or `invalid` loaded
successfully. It replaces the prior current run because its failure is domain data worth
inspecting, not a loader failure. The workbench then applies the restricted inspection mode and
never silently promotes it to `complete`.

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
- The evidence area uses two columns: event timeline and diagnostics; metrics spans both below.
- The viewport remains at least `50vh` where viewport height permits and stays more prominent than
  any one evidence panel.

### Narrow layout: below `720px`

Stack regions in this exact order:

1. compact application bar;
2. viewport header and viewport;
3. playback controls;
4. run inspector;
5. event timeline;
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

| Component or module   | Owns                                                                                                             | Must not own                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `+page.svelte`        | Route composition and the explicit repository fixture catalog import                                             | Three.js lifecycle, animation frame loop, file parsing details or full workbench CSS |
| `SimulationWorkbench` | Current accepted run/source, load-attempt state, inspection mode, selected event and coordination between panels | Physical calculations or mutation of run records                                     |
| `ApplicationBar`      | Source display, fixture selection, local-file interaction and load feedback presentation                         | Direct parser/version implementation or playback state                               |
| `SimulationViewport`  | Three.js mount/update/destroy lifecycle and rendering the supplied recorded frame                                | Run loading, authoritative time, run mutation or status promotion                    |
| `PlaybackControls`    | Accessible transport/seek presentation through typed values and callbacks                                        | Direct access to Three.js objects or the run loader                                  |
| `RunInspector`        | Read-only status, provenance, horizon, count and settings presentation                                           | Transport or file-input state                                                        |
| `EventTimeline`       | Read-only event list, selection presentation and seek request callback                                           | Clock mutation beyond emitting the selected stored timestamp                         |
| `DiagnosticsConsole`  | Read-only diagnostic-entry presentation and optional local severity filter                                       | Load errors or synthetic diagnostics                                                 |
| `MetricsPanel`        | Recorded/derived/unavailable metric presentation                                                                 | Speculative profiling collection                                                     |

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
    -> read-only inspector, event, diagnostics and metrics views
```

Event selection sends one stored simulation timestamp to the playback controller. The evaluated
frame then flows to the viewport; the event list never manipulates a mesh.

## Data availability boundary

### Available now

- contract version;
- scene ID and source name/kind;
- all four run statuses and failure reason;
- bodies, static colliders and their physical circle data;
- simulation settings and tolerances;
- trajectories and segment counts;
- full contact-event records with time, participants, position and normal;
- solver iteration count;
- simulated-until time;
- structured diagnostics; and
- playable-until time derived by the current renderer adapter.

### Derived without loss

- body, collider, trajectory, segment, event and diagnostic counts;
- diagnostic counts by severity;
- selected/current event relative to replay time; and
- transport state.

### Deferred or unavailable

- solver calculation duration;
- saved-run validation duration;
- frame time and FPS;
- memory, lookahead or rolling-horizon metrics;
- export/save actions;
- scenario input editing;
- invoking or rerunning the real solver;
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
- Apply completed-replay, recorded-prefix and diagnostics-only restrictions.
- Show recorded/derived/unavailable metric provenance without adding a profiler.
- Keep route, viewport lifecycle, controls and read-only diagnostic regions in cohesive component
  homes.
- Update browser tests to target stable workbench roles and cover the workflows required by
  FLAME-23.
