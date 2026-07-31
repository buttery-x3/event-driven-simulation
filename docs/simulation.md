# Canonical Plinko scene and scenarios

Milestone 2 uses one fixed physical board and a small named scenario catalogue. Both are ordinary
TypeScript data under `src/lib/simulation`; they can be imported in Node tests without Three.js,
Svelte or DOM globals.

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
restitution `0.78`, and the canonical board. Positions are metres and velocities are metres per
second.

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

## Ballistic motion and peg contacts

`MotionSegment` is the canonical ballistic-path representation. Its start position, start velocity
and constant acceleration are immutable initial conditions at `startTime`;
`evaluateMotionSegmentPosition` and `evaluateMotionSegmentVelocity` evaluate them directly at any
requested time. Simulation code must not mutate the segment or advance it through sampled
timesteps.

`findEarliestPegContact` performs continuous ball-versus-fixed-circle discovery over a declared
future interval inside one motion segment. It substitutes normalized interval time into the
ballistic path and forms the quartic squared-distance equation using the combined ball and peg
radius. Real roots are isolated by recursively partitioning the interval at the roots of the
polynomial derivative. Sign-changing intervals are refined by bisection; a zero at a derivative
root preserves tangent contacts that sign-change-only searches would miss.

The contact policy accepts the earliest root on the supported interval whose geometric separation
is within `contactDistance` and whose outward normal velocity is no greater than
`normalVelocity`. Separating roots are retained in diagnostics and rejected. A segment that starts
penetrating the peg is invalid. The search horizon is inclusive and must not extend beyond the
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
separation, normal velocity, classification, and refinement counts.

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
the current headless synthetic producer both validate the scene before accepting or generating run
data.
