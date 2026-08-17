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
The dynamic-support family adds six workbench experiments covering continued sliding on an anchored
dynamic body, transmitted load that remains supported, exact loss of a fixed support reaction,
third-body interruption, launch from the support and the explicit unsupported moving-pair boundary.

The workbench may replace the selected scenario's editable input fields only in its draft copy.
User-facing speed and angle controls use degrees measured from positive `x` toward positive `y`;
they deterministically produce `(speed × cos(angle), speed × sin(angle))`. Direct velocity
components remain available for exact regression reproduction. An explicit Run action validates
and snapshots the resulting `SimulationInput` before invoking the headless solver.

Scenario input JSON uses a version 7 `simulation-input` envelope. Its loader validates scene and
body structure, stable identities, positive mass, non-negative release times and common-time body
overlap. Version 6 single-body envelopes remain loadable through explicit defaults of unit mass and
release time zero. The current single-ball runner separately requires exactly one body released at
time zero. A loaded scenario never becomes renderer state directly: only the run record returned by
the simulator can be adapted for replay.

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
grazing, initial contact or indeterminate. Decisive separated/overlapping neighbourhood topology
takes precedence over the derivative evaluated at the isolated root, so a tangent root separated on
both sides remains grazing when root-location noise gives it a tiny signed normal velocity. Signed
normal motion is used only when that local topology is unavailable or ambiguous. A nondecisive
root and its consecutive isolated neighbours form one local topology cluster. The cluster is
grazing only when wider samples certify separation on both sides and every derivative critical
point keeps penetration within `contactDistance`; missing evidence, deeper penetration or
contradictory topology fails closed. A certified entering root with definite incoming normal
motion is an impact; an entering root inside the
normal-velocity ambiguity band is a non-impulsive contact onset. External grazing and exiting roots
are rejected, while indeterminate topology fails closed.

A segment that starts penetrating the fixed circle is invalid. A just-released supporting circle
owns its initial root cluster until the same free-flight path certifies positive separation. Roots
inside that release-owned cluster are rejected, but a later entering root with certified separated
evidence before it remains eligible as a genuine recollision. This policy uses geometry rather than
an elapsed-time ignore window. If an entering root or overlapping local evidence appears before
positive separation is certified, the query fails closed as unresolved instead of silently
returning no contact. The search horizon is inclusive and must not extend beyond the segment.

The one exception is an explicitly identified accumulation-manifold release. Its limiting tangent
direction can start from the last tolerance-resolved alternating impact and cross a microscopic
release-owned root cluster before separating. The circle query isolates the entry, exit and every
polynomial critical point between them, then rejects the cluster only when the certified maximum
penetration is no greater than `contactDistance`. The permission is scoped to the retained
colliders from that acquired manifold; ordinary releases and deeper crossings keep the fail-closed
policy above.

The query has four typed outcomes: `contact`, `no-contact`, `unresolved`, and `invalid-input`.
Coefficient overflow, a degenerate polynomial, non-finite candidate state, or exhausted root
refinement returns `unresolved`; numerical uncertainty is never reported as a clear path.
`contactCaptureDistance` is a represented-physics resolution: rebounds whose certified normal
excursion does not exceed it may be represented as contact. It is deliberately independent of
the numerical tolerances below; a zero capture distance therefore never collapses a positive
represented rebound. Version 7 inputs that predate the explicit field are normalised
once from their historical `contactDistance` value when loaded; newly serialised inputs always
record it explicitly. Tolerances are named by purpose:

- `contactDistance` verifies candidate geometry and stable normals;
- `eventTime` controls root isolation/refinement precision;
- `normalVelocity` classifies approach versus separation; and
- `polynomialResidual` detects roots at interval and derivative-partition boundaries.

### FLAME-47 directional sign audit

The bounded contact-path audit classifies sign-sensitive decisions by their physical role:

| Category                           | Audited decisions                                                                                                               | Policy                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed physical direction          | normal approach/separation, support pressing/detachment, tangent direction and outward bounds motion                            | Keep the comparison relative to the local normal, tangent or declared bounds face; reflecting the geometry and gravity reflects the basis too. |
| Tolerance-aware near zero          | circle-root derivative fallback, tolerance-contained tangent clusters, reconstructed manifold response and circular entry speed | Use the existing collision or submitted tolerance before sign can select impact, grazing or clockwise/counter-clockwise motion.                |
| Inherently non-negative constraint | impulses, support reactions, squared speed and separation bounds                                                                | Preserve unilateral non-negativity; tolerances may admit numerical residuals but never attractive impulses or reactions.                       |
| Strictly positive domain           | radii, segment lengths, search durations, event intervals and simulation horizons                                               | Preserve strict positivity because zero or negative values do not describe the supported domain.                                               |
| World-axis assumption              | termination boxes and declared board bounds only                                                                                | Keep their explicit coordinate-axis checks; no contact, manifold or sustained-contact classification depends on a preferred world direction.   |

This audit changed only the near-zero policies. Stable ordering by collider ID or feature remains
diagnostic and deterministic, but it does not select a physical response.

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

The exact earliest timestamp defines the common event state. Every candidate no later than
`eventTime` after that timestamp is reported as near-simultaneous, then re-evaluated at the common
position and velocity. Exact-time touching, non-separating candidates form the contact set. A
positive but tolerance-near time difference is unresolved because `eventTime` is not a physics rule
for merging distinct impacts. ID and feature keys order diagnostics only. A `no-event` result is permitted only when
every collider reports no contact. Any unresolved collider calculation makes the whole world query
unresolved because it could conceal an earlier event; a valid later candidate remains diagnostic
evidence but is not committed as the result.

## Event-to-event world runs

`constructSimulationRun` is the authoritative producer. It accepts one immutable
`SimulationInput` and maintains one local state, revision and certified prediction per released
body. A deterministic scan chooses the earliest exact time across scheduled releases, local
fixed-world events and supported continuous body-pair contacts. Only the selected body's prefix is committed; every unrelated body retains its
existing continuous prediction across that world event. Exact-time independent candidates are
processed as a body-ID-ordered batch without tolerance-merging distinct times. The compatibility
name `constructSingleBallRun` routes through this same scheduler.

The local-event solver constructs a ballistic or constrained path from the body's current event
state, queries every fixed collider continuously, and exposes the next contact, transition,
terminal boundary or failure as a prediction. Prepared sustained-contact legs are not committed
until their local boundary is selected, which is the interruption boundary later body-pair search
will use. The runner never advances collision state through renderer frames or physics timesteps.

Body-pair search synchronizes the two authoritative paths over their shared time interval. Pairs of
polynomial paths use relative contact-polynomial roots. When either path is a changing-normal
circular continuation, a bounded continuous search excludes intervals using a conservative
relative-speed limit and refines entering brackets to the configured tolerances. If that proof
cannot distinguish separation from contact within its deterministic interval budget, the run is
unresolved. An accepted pair event truncates both incoming paths at the exact contact time and seeds
the same exact-time component response used by free-flight impacts.

Each selected contact set is evaluated directly on the incoming path. For one contact, restitution
reduces to the familiar outward-normal response:

```text
v' = v - (1 + e)(v · n)n
```

For several contacts the solver chooses non-negative normal impulses together. It enumerates the
one- and two-constraint active bases available to a two-dimensional single-body system, solves the
active equalities, rejects attractive impulses, verifies every candidate's target normal velocity,
and chooses the minimum velocity change. Incoming contacts receive the configured restitution;
existing zero-normal-speed supports receive a zero target and act as unilateral constraints.
Candidate ordering and collider names cannot enter the velocity objective.

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

Contract version 7 retains the stable world-level `outcome` vocabulary (`exited`, `escaped`,
`settled`, `no-future-event`, `time-limit`, `event-limit`, `unresolved`, or `invalid`) separately
from the detailed `terminalReason`. Run `validity` records whether the retained prefix conforms to
the public contract. Diagnostics retain each contact search's accepted and rejected candidates and
record search iterations, event count, candidate count, segment count, simulated horizon and
calculation wall time. Accepted contact candidates additionally preserve their proposed time delta,
position, contact point, normal, pre- and coupled post-contact velocity, near-simultaneous and
event-contact-set membership, positive-impulse contribution, retained/released support
classification, impulse, and outgoing normal velocity. Membership is independent of impulse: a
retained unilateral support can remain active with zero instantaneous impact impulse. Evidence is
matched to the exact event-time candidate; later roots for the same collider and feature retain their
original classification. Contact events preserve the same complete manifold evidence. These optional
forensic fields remain diagnostic evidence only:
instrumentation is written after selection and never participates in
event selection or becomes authoritative trajectory motion.

## Multi-body history contract

Version 7 defines multi-body semantics, continuous dynamic-circle pair discovery and frictionless
dynamic-body response. Each input body has a unique ID, positive finite mass, radius, initial state and
non-negative release time. Before that time it is `scheduled` and physically absent. Simultaneous
releases form one semantic batch; serialized array order and diagnostic IDs cannot decide physical
ordering or response. Exact fixed or dynamic touching is evidence for the applicable contact policy,
while overlap beyond `contactDistance` is invalid.

`bodyStates` records each body's current lifecycle independently of the world outcome:
`scheduled`, `active`, `resting`, `completed`, `escaped`, `invalid` or `unresolved`. Completed or
escaped bodies do not end a world while another body remains active. A completed world has no
scheduled, active, invalid or unresolved bodies. An incomplete outcome preserves each body's
certified `recordedUntilTime` and trajectory prefix.

Released bodies have explicit release events. `stationary` motion segments provide authoritative
position coverage when a dormant resting body remains present while other bodies continue. Dynamic
contacts use two semantic participants—body/body or fixed-collider/body—and a normal directed from
the first participant to the second, plus contact point, incoming/outgoing normal motion, per-body
pre/post velocities, equal-and-opposite impulse vectors and incoming/retained/released/rejected
state. Component records identify exact-time impact
or resting-anchored connectivity, active contacts and optional retained support reactions; lifecycle
events record creation, split, merge and dissolution without exposing solver matrices.

For the event-time fixed-impact and dormancy admissions implemented by FLAME-94, `0.01 m/s` is the
represented-motion rest speed. It is a physics representation policy, not a collision, event-time,
solver or support tolerance. A currently contacting body or contact-connected subset is only a
candidate when every member's velocity magnitude is at or below that speed. The existing
zero-velocity support-equilibrium solve then decides admission: the current contact graph must
anchor the candidate to fixed support with valid non-negative reactions. A successful candidate
selects the existing `resting-anchored` mode, snaps only its certified members to zero and reuses
reversible dormancy; otherwise every body keeps its ordinary moving mode.

The certificate may use a current-geometry contact that the ordinary impact response classified as
released because of a microscopic separating velocity. That override creates retained support
evidence only for the selected resting mode and only from contacts in its successful certificate;
ordinary retained/released evidence is unchanged when rest is not selected. The policy does not
infer future contacts, change restitution, add damping or count quiet events.

FLAME-95 applies the same policy when the simulator reaches an existing exact sustained-motion
boundary. Fixed linear and circular continuations provide the common authority with the actual
current velocity vector rather than pre-gating rest on numerical-zero local motion. Retained dynamic
support provides its moving body, anchored bodies, body/body support contact and anchored contact
network; the complete group enters the existing `resting-anchored` representation only when the
general current-geometry support certificate succeeds. Dynamic-support retires its active runtime
and prediction before dormancy persists the selected group. Failed certification preserves fixed
continuation, dynamic continuation, reversal, release or unsupported behaviour.

Crossing `0.01 m/s` inside an otherwise continuous supported path is not an event. Sustained paths do
not search, poll or step for that threshold; represented rest is considered only at a physical
boundary already selected by the existing path or reaction mathematics.

Diagnostic body horizons and pair predictions record a common validity interval, per-body revision
stamps and selected/retained/invalidated/stale decisions. Supported free-flight, linear-contact and
stationary path pairs are synchronized at the shared search start and reduced to one normalized
relative polynomial. The existing polynomial root isolator and circle-root topology policy select
the earliest entering contact without sampled advancement. Pair evidence retains relative and
contact-polynomial coefficients, roots, candidate times, geometry residuals, topology and incoming
normal motion. It is evidence only. Rendering evaluates
the authoritative trajectories and never reconstructs motion from predictions or component IDs.

The pair search ends at the earlier local-event horizon. Changing-normal circular paths use a
bounded relative-speed isolation query rather than the polynomial reduction. For a certified
isolated incoming pair, the scheduler applies the issue-owned frictionless response

```text
g- = (vB- - vA-) dot n
j = -(1 + e)g- / (1/mA + 1/mB)
vA+ = vA- - (j/mA)n
vB+ = vB- + (j/mB)n
```

and fails closed unless the result is finite, non-attractive, non-incoming, momentum preserving,
tangentially unchanged and energy plausible. Both participant paths are committed only through the
contact, their old local and pair predictions are marked invalidated, revisions are incremented and
new futures are built. Unrelated predictions retain their original revisions. Stale evidence remains
diagnostic but cannot be selected because every authoritative pair event must match both current
revision stamps.

After the response, a retained body/body contact may continue only when one participant belongs to
a fixed-anchored dormant component. The moving participant follows an authoritative circular path
around the still-dynamic support body while its reaction is applied as an equal-and-opposite
external load to the complete anchored component's support-equilibrium solve. The scheduler selects
the exact first boundary at which the body/body normal reaction or any fixed support reaction
reaches zero. A third-body impact at an earlier time invalidates the whole dynamic-support
prediction and rebuilds the complete connected component at that exact event. A retained moving
pair without this certificate stops explicitly with `unsupported-body-body-response`; ID order is
used only to organize diagnostics.

`schedulerSteps` records the local event that advanced world time, its body revision and the body
IDs whose predictions were retained unchanged. A future release remains an external event even
when every released body is dormant. Release batches are admitted together; overlap beyond
`contactDistance` with fixed geometry, a present body or another simultaneous release invalidates
the world. Any released body-level invalid or unresolved outcome terminates the initial scheduler
conservatively. Completed, escaped and resting body states remain separate from the aggregate world
outcome; mixed successful worlds use a `world-complete` terminal reason.

Supported scene-bounds crossings are solved continuously alongside explicit completion and escape
regions. A non-penetrating contact may enter sustained contact only when the contact normal can
supply the required support. Zero tangential velocity and acceleration produce `resting-contact`;
otherwise the body continues in a `linear-contact` or `circular-contact` segment.

## Sustained contact and impact collapse

The impact state machine distinguishes the ordinary restitution endpoint from a finite-contact
captured endpoint. After the existing fixed-world or generalized coupled solver completes the
ordinary impact, one solver-neutral policy evaluates the complete exact-time component. For each
ordinary separating contact it combines the outgoing normal velocity with the local
pressing acceleration and the changing-normal `vₜ²/R` term. An unbounded rebound, or any certified
normal excursion greater than `contactCaptureDistance`, vetoes capture for the complete component.
Otherwise the policy solves the zero-normal-velocity endpoint and removes zero-load or separating
contacts until the retained unilateral active set is stable. The resulting endpoint preserves
admissible tangent motion. Zero restitution uses the same support-feasibility path; speed alone is
never a support certificate. The policy never adds a position nudge, random direction, damping
step or synthetic time advance.

Capture is evaluated independently at each exact-time impact. A complete corner impact therefore
remains ordinary when one energetic contact vetoes capture, even if another contact has only a
microscopic rebound; that second contact may be captured at a distinct later recollision. Fixed
and coupled adapters record the same JSON-safe evidence: the declared capture distance, ordinary
and selected endpoints, meaningful-rebound veto, active-set removals, retained/released contact
IDs, geometric and pressing accelerations, excursion bounds and support reactions. Unbounded
quantities are recorded as `null`, never as non-JSON numeric values.

An alternating two-collider sequence is also eligible when five consecutive single-contact
observations prove an A-B-A-B-A pattern with shrinking intervals and normal approach speeds. The
manifold acquisition policy intersects the two expanded fixed-circle constraints, selects the
geometric limit nearest the resolved state, rejects any limit that penetrates another collider, and
retains every collider touching there. The configured contact distance determines how close the
resolved state must be to that limit; exact tangent constraints use the corresponding
curvature-derived position bound rather than a ball-radius threshold.

The acquired normals are solved at zero restitution to remove the collapsing normal chatter while
preserving common tangent motion. A non-negative reaction solve against gravity decides supported
rest. If no support exists and the projected motion is a common escape direction, the transition
records the complete candidate manifold and releases it into free flight. A pressing manifold with
neither certified support nor a common release remains unresolved instead of selecting one
collider. Diagnostics record the alternating collider set, contracting intervals, candidate limit,
retained contacts, state distance, support-feasibility result and final classification.

### Support-preserving low-speed elastic response

FLAME-96 Phase A defines a bounded internal response at the provisional physical boundary
`LOW_SPEED_ELASTIC_IMPACT = 0.05 m/s`. It remains separate from the `0.01 m/s` represented-rest
threshold. It is not selected by production scheduler flow, so current run behaviour and saved-run
meaning remain unchanged.

For an already certified exact-time active contact set `A`, an integrating adapter must eventually
supply authoritative pre-existing support contacts `S`; every other active contact belongs to
`I = A minus S`. Activation speed is measured only from initially incoming contacts in `I`, while the
elastic propagation includes complete `I`, including unsupported contacts whose initial normal
velocity is zero. Contacts in `S` are bilateral zero-normal-velocity equalities and contacts in `I`
are unilateral impact directions with non-negative impulses.

The support-preserving operation and anchored fallback are distinct. Support preservation constrains
only the supplied support normals and retains their common tangent/nullspace motion. Anchored
fallback additionally accepts complete authoritative resting components and locks every coordinate
of every component member; it cannot lock an arbitrary body subset. Support and coordinate-lock
reaction multipliers are signed because they are bilateral low-speed constraints. Only impact
contact impulses are constrained non-negative.

The incoming state must already satisfy every supplied equality within numerical tolerance.
Mass-metric projection is used only to remove round-off-scale drift; a material correction rejects
the response as inconsistent support evidence. A successful endpoint separately certifies support
equalities, unilateral impact feasibility, kinetic-energy preservation and a concrete generalized
momentum decomposition through impact impulses plus declared support and lock reactions.

The adapter constructs an orthonormal basis for the mass-normalised explicit support and lock
gradients. It projects the near-identical incoming generalized velocity and every real impact
gradient into the basis nullspace, then calls `solveTerminatingElasticReflections(...)` with unit
metric coordinates. The shared kernel supplies the terminating elastic endpoint including implicit
impact lineality and anti-locking. FLAME-96 maps the endpoint through inverse square-root masses and
solves a physical momentum decomposition using the original impact gradients and explicit signed
equality reactions. It does not encode equalities as opposing contacts or dormant bodies as fixed
geometry. The Phase-A reference fixtures remain the physical oracle; scheduler integration stays
deferred until separate review.

Every ordinary accepted manifold remains one `contact` event. An alternating-limit release keeps
the last tolerance-resolved single impact as that contact event and records the complete candidate
accumulation manifold on the same-time `impact` to `free-flight` transition; this distinguishes
observed geometry from the finite limiting contact set without moving the trajectory state.
Entering or leaving sustained contact adds a `contact-mode-transition` event with the supporting
collider, position, normal, source and target mode, and reason. A `linear-contact` or
`circular-contact` motion segment is the authoritative continuation between those transitions. Rest requires a separate non-negative reaction solve
proving gravity can be balanced by the full contact set; small speed alone is insufficient.
Resting contact makes that body dormant. The world continues when a scheduled release or another
active body remains, and one stationary segment covers the dormant interval without cuts at
unrelated world events.

Dynamic support does not turn the supporting body into a static collider. The circular segment
identifies both the dynamic support body and its anchored component, while dynamic-contact,
component-lifecycle and support diagnostics retain admission, transmitted load, fixed reactions,
exact release reason and interruption evidence. Re-certification occurs at every selected boundary;
loss of any required unilateral reaction dissolves the sustained-support component at that exact
time before the released bodies receive new futures.

When a constrained circular path reaches a new collider, the circular segment end state supplies
the canonical event time, position and velocity directly to the manifold solve. The retained circle
support uses the end-state radial normal, and the new collider geometry is constructed at that same
state. The run does not introduce a sub-tolerance free-flight interval between the constrained path
and its impact.

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
