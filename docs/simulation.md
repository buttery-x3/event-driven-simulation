# Canonical Plinko scene and scenarios

Milestone 2 uses one fixed physical board and a curated named scenario catalogue. Both are ordinary
TypeScript data exposed by `src/lib/simulation/world`; they can be imported in Node tests without
Three.js, Svelte or DOM globals.

## Board coordinate system

The canonical board is `canonical-plinko-board`.

| Property        | Convention                                                  |
| --------------- | ----------------------------------------------------------- |
| Length unit     | metre                                                       |
| Origin          | centre of the physical board's bottom edge                  |
| Horizontal axis | positive `x` points right                                   |
| Vertical axis   | positive `y` points up                                      |
| Bounds          | `5.4 m` wide by `7 m` high; `x = -2.7..2.7`, `y = 0..7`     |
| Dynamic motion  | two-dimensional positions and velocities in the same axes   |
| Rendering       | maps physical `(x, y)` directly to presentation `(x, y, z)` |

The renderer chooses only presentation depth, materials, lighting and camera framing. It derives
the board face, peg positions, boundary lengths and termination marker from the physical scene.
Mesh transforms never feed back into simulation.

## Fixed geometry

The board contains:

- eight staggered peg rows, alternating between seven and eight circular pegs;
- 60 pegs in total, each with radius `0.09 m`;
- `0.6 m` horizontal and vertical peg spacing;
- left and right side walls;
- angled entry guides;
- angled exit floors that leave a `1 m` centre opening; and
- an axis-aligned completion region below that opening.

Peg IDs use `peg-row-RR-column-CC`, with one-based, zero-padded row and column numbers. Boundary
and termination IDs are descriptive and stable. A run completes physically when the ball enters
`termination-centre-exit`; a future solver should not treat the configured maximum time as the
ordinary success condition.

Line-segment boundaries are mathematically zero-thickness collision surfaces. The renderer gives
their boxes a small visible thickness, but that value is presentation-only and must not affect
collision calculations.

## Scenario catalogue

Each scenario uses one `0.13 m` radius ball named `ball-primary`, gravity `(0, -9.81) m/s²`,
restitution `0.78`, a maximum simulation time of `60 s`, and the canonical board. The extended
horizon allows slow or contact-heavy canonical launches to reach a physical outcome instead of
being cut off by the former `10 s` limit. Positions are metres and velocities are metres per second.

| Scenario ID                | Initial position | Initial velocity | Intended verification purpose                                                               |
| -------------------------- | ---------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `vertical-centre-drop`     | `(0, 6.62)`      | `(0, 0)`         | Baseline gravity traversal and symmetric first contact with the centre peg.                 |
| `offset-drop`              | `(0.43, 6.62)`   | `(0, 0)`         | Asymmetric peg selection and deterministic sensitivity to launch position.                  |
| `angled-launch`            | `(-1.45, 6.5)`   | `(1.8, -0.3)`    | Combined horizontal and vertical motion through the staggered field.                        |
| `high-speed-launch`        | `(-1.8, 6.48)`   | `(8, -14)`       | Earliest-event solving at a speed that would expose tunnelling in sampled collision checks. |
| `near-grazing-peg-contact` | `(0.219, 6.62)`  | `(0, 0)`         | Contact classification when a vertical path nearly grazes the first-row centre peg.         |

The scenario records include their initial-condition summaries and verification purposes so tools
do not need this document to interpret them. The catalogue is JSON-serialisable for headless tests,
browser replay input and future regression capture.

The `world/scenarios` subdomain also contains the varied-board and adversarial catalogues. Every
public descriptor carries a stable ID and category, complete submitted input, verification purpose,
permitted outcome set, relevant event/contact-mode expectations, complete-versus-valid-prefix replay
expectation, requirement-coverage tags and regression-fixture provenance. The adversarial catalogue
uses focused named experiments for launch/path, initial-position, physical-setting and sustained-
contact extremes; it is intentionally not a Cartesian parameter generator. Mirrored near-centre
entries are constructed as an explicit pair and contract tests compare their authoritative evidence.

The workbench may replace the selected scenario's editable input fields only in its draft copy.
User-facing speed and angle controls use degrees measured from positive `x` toward positive `y`;
they deterministically produce `(speed × cos(angle), speed × sin(angle))`. Direct velocity
components remain available for exact regression reproduction. An explicit Run action validates
and snapshots the resulting `SimulationInput` before invoking the headless solver.

Scenario input JSON uses a version 6 `simulation-input` envelope. Its loader applies the same
structural input validation used by saved-run contract validation, followed by the authoritative
single-ball semantic validator. A loaded scenario never becomes renderer state directly: only the
run record returned by the simulator can be adapted for replay.

## Ballistic motion and fixed-world contacts

`MotionSegment` is the canonical continuous-path representation. `free-flight` and
`linear-contact` segments have immutable position, velocity and constant-acceleration conditions at
`startTime`. `circular-contact` segments record the supporting collider, expanded contact radius,
angular interval, direction, entry tangential speed and gravity. The shared motion evaluator uses
those records directly at any requested time. Simulation code must not mutate a segment or advance
it through sampled timesteps.

`findEarliestCircleCircleContact` performs continuous dynamic-circle versus fixed-circle discovery
over a declared future interval inside one motion segment. It substitutes normalized interval time
into the ballistic path and forms the quartic squared-distance equation using the combined circle
radii. Real roots are isolated by recursively partitioning the interval at the roots of the
polynomial derivative. Sign-changing intervals are refined by bisection; a zero at a derivative
root preserves tangent contacts that sign-change-only searches would miss.

Each isolated root carries a geometry-neutral isolating interval and certified neighbouring
polynomial samples. The math subsystem does not interpret their signs. Circle-circle policy
evaluates physical separation at those samples and classifies roots as entering, exiting, external
grazing, initial contact or indeterminate. Definite incoming normal motion is an impact. An
entering root inside the normal-velocity ambiguity band is a non-impulsive contact onset; external
grazing and exiting roots are rejected, while indeterminate topology fails closed.

A segment that starts penetrating the fixed circle is invalid. A just-released supporting circle
owns its initial root cluster until the same free-flight path certifies positive separation. Roots
inside that release-owned cluster are rejected, but a later entering root with certified separated
evidence before it remains eligible as a genuine recollision. This policy uses geometry rather than
an elapsed-time ignore window. The search horizon is inclusive and must not extend beyond the
segment.

The query has four typed outcomes: `contact`, `no-contact`, `unresolved`, and `invalid-input`.
Coefficient overflow, a degenerate polynomial, non-finite candidate state, or exhausted root
refinement returns `unresolved`; numerical uncertainty is never reported as a clear path.
Tolerances are named by purpose:

- `contactDistance` verifies candidate geometry and stable normals;
- `eventTime` controls root isolation/refinement precision;
- `normalVelocity` classifies approach versus separation; and
- `polynomialResidual` detects roots at interval and derivative-partition boundaries.

Diagnostics record the normalized polynomial, its scale, candidate sources, residuals, geometric
separation, normal velocity, local topology, release ownership, classification, and refinement
counts.

`findEarliestBoundaryContact` applies the same continuous-path policy to a fixed line segment. The
ball centre is solved against the two parallel face offsets at one ball radius from the supporting
line. A face root is valid only when its tangent coordinate lies within the finite segment extent;
an infinite-line root outside that extent is retained as a rejection diagnostic, not promoted to a
contact.

Finite boundaries use explicit capsule semantics. The segment face owns the closed tangent interval
between its endpoints. Each endpoint is also solved continuously as a zero-radius point feature and
owns roots immediately beyond its adjacent face extent. This makes endpoint-adjacent contact
possible without extending the face into an infinite wall. The selected boundary state records the
owning feature and physical surface contact point as well as the ball-centre position, outward
normal and normal velocity.

`findEarliestFixedWorldContact` queries every fixed circle and line segment over the same ballistic
interval and converts successful results into `FixedWorldContactCandidate`. This common candidate
contains the collider ID and kind, owning feature, event time, ball-centre position, surface contact
point, normal and normal velocity. The query returns `contact`, `no-event`, `unresolved`, or
`invalid-input`.

Candidate ordering follows this numerical policy:

1. exact event time ascending;
2. collider ID using deterministic string ordering; then
3. feature name using deterministic string ordering.

The exact earliest timestamp always wins. Every candidate no later than `eventTime` after that
timestamp is also reported as near-simultaneous, so a later tolerance-neighbour cannot win silently.
The ID and feature keys resolve exact-time ties only. A `no-event` result is permitted only when
every collider reports no contact. Any unresolved collider calculation makes the whole world query
unresolved because it could conceal an earlier event; a valid later candidate remains diagnostic
evidence but is not committed as the result.

## Event-to-event single-ball runs

`constructSingleBallRun` is the authoritative Milestone 2 producer. It accepts one immutable
`SimulationInput`, constructs a ballistic path from the current event state, queries every fixed
collider continuously, and commits a segment only after the selected interval has been certified
collision-free. It never advances collision state through renderer frames or physics timesteps.

Each selected contact is evaluated directly on the incoming path. Restitution is applied only to a
definite incoming impact. For outward unit normal `n`, incoming velocity `v` and restitution `e`,
the outgoing velocity is:

```text
v' = v - (1 + e)(v · n)n
```

Certified non-impulsive onset uses the unchanged incoming velocity and proceeds directly to
sustained-contact support classification. The contact position becomes the next segment's exact
start position. No positional nudge or arbitrary time advance is applied. If the next query still
selects a contradictory contact without a positive collision-free interval, the unchanged
`zero-time-loop` guard stops the run and preserves the certified prefix.

Axis-aligned completion and escape regions are intersected continuously with the same ballistic
path. A contact at or before a region entry wins; otherwise the committed terminal segment ends
exactly at the region boundary. Event and time limits, unresolved fixed-world searches, invalid
state, numerical failure and permanently stationary no-future-event states remain distinct typed
terminal reasons.

Contract version 6 records the stable top-level `outcome` vocabulary (`exited`, `escaped`,
`settled`, `no-future-event`, `time-limit`, `event-limit`, `unresolved`, or `invalid`) separately
from the detailed `terminalReason`. Run `validity` records whether the retained prefix conforms to
the public contract. Diagnostics retain each contact search's accepted and rejected candidates and
record search iterations, event count, candidate count, segment count, simulated horizon and
calculation wall time. Accepted contact candidates additionally preserve their proposed time delta,
position, contact point, normal, pre- and proposed post-contact velocity, and near-simultaneous
classification. These optional forensic fields remain diagnostic evidence only. They are
diagnostic evidence only: instrumentation is written after selection and never participates in
event selection or becomes authoritative trajectory motion.

Supported scene-bounds crossings are solved continuously alongside explicit completion and escape
regions. A non-penetrating contact may enter sustained contact only when the contact normal can
supply the required support. Zero tangential velocity and acceleration produce `resting-contact`;
otherwise the body continues in a `linear-contact` or `circular-contact` segment.

## Sustained contact and impact collapse

The impact state machine distinguishes an ordinary separating restitution response from the
inelastic-collapse limit. Zero restitution enters the limit immediately when support is available.
For positive restitution, collapse requires repeated impacts with the same collider, contracting
impact intervals and approach speeds, a sufficiently small normal speed derived from contact
distance and pressing acceleration, and a finite nearby predicted accumulation time. This policy
never adds a position nudge, random direction, damping step or synthetic time advance.

Every accepted impact remains a `contact` event. Entering or leaving sustained contact adds a
`contact-mode-transition` event with the supporting collider, position, normal, source and target
mode, and reason. A `linear-contact` or `circular-contact` motion segment is the authoritative
continuation between those transitions. Resting contact is terminal for the current fixed-world,
single-ball model because no supported future external event can change it.

For a fixed straight segment, the constrained acceleration is

```text
a_t = g - (g · n)n
```

The solver selects the earliest endpoint, other collider, termination region, bounds crossing or
time limit along that quadratic path. Reaching an endpoint detaches when the free radial
acceleration loses support; otherwise continuation changes to a circular arc around the physical
endpoint.

For a circular peg or supported line endpoint, the centre remains on the expanded circular contact
boundary. The evaluator conserves energy to obtain tangential speed as a function of angle and
uses endpoint-regularised adaptive quadrature plus bisection to map simulation time to angle.
Angular root isolation orders zero tangential speed, support loss, another collider, terminal-region
entry and bounds escape. A supported finite-time turning point ends the uphill segment at exact
rest; tangential acceleration then either starts a new segment in the opposite direction or leaves
the body resting when it cannot establish motion. Every accepted leg has positive duration, so the
same-time reversal boundary cannot enter the free-flight collision loop or require a position
nudge. The changing normal and resulting path are shared by headless simulation and renderer
replay; no chain of micro-impacts or renderer-only path exists.

## Scene validation

`validateSceneDefinition` accepts unknown input and returns either the validated scene or typed,
path-specific diagnostics. `assertValidSceneDefinition` throws `SceneValidationError` with the same
diagnostic collection when an assertion boundary is more convenient.

Current diagnostic codes are:

- `DUPLICATE_ENTITY_ID`;
- `INVALID_COORDINATE`;
- `INVALID_DIMENSION`;
- `INVALID_ENTITY_ID`;
- `INVALID_SCENE_STRUCTURE`; and
- `UNSUPPORTED_GEOMETRY`.

Validation covers the coordinate convention, board dimensions, supported circle and line-segment
colliders, finite coordinates, positive circle radii, non-zero segment lengths, unique collider and
termination IDs, and positive axis-aligned termination-region dimensions. Saved-run loading and
the authoritative headless run constructor both validate the scene before accepting or generating
run data.
