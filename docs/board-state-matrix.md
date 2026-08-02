# Board-state matrix and terminal outcomes

FLAME-33 extends the Milestone 2 headless experiment catalogue beyond the canonical board.
`boardStateScenarios` in `src/lib/simulation/world/board-state-scenarios.ts` contains only ordinary
serialisable scene, body and settings data. Every entry runs through `constructSingleBallRun`;
scenario IDs and peg counts never select solver behaviour.

The diagnostic workbench consumes this same catalogue through a workbench-facing descriptor. It
groups these entries with canonical launches, displays their purpose and terminal contract before
execution, and submits their unchanged `SimulationInput` through the public headless run API. The
returned run remains the only source for actual outcome and renderer playback.

## Scenario matrix

| Scenario                    | Peg count | Material variation                                      | Expected terminal outcome          |
| --------------------------- | --------: | ------------------------------------------------------- | ---------------------------------- |
| `no-pegs`                   |         0 | Empty ballistic scene with a bottom exit                | `exited`                           |
| `isolated-peg`              |         1 | Smallest complete fixed-circle collision run            | `exited`                           |
| `sparse`                    |         6 | Three rows with large gaps                              | `escaped` through supported bounds |
| `canonical`                 |        60 | Canonical eight-row Plinko board                        | `exited`                           |
| `dense`                     |        45 | Five rows with `0.42 m` horizontal spacing              | `exited`                           |
| `mirrored-sparse`           |         6 | Sparse scene and launch reflected across `x = 0`        | `escaped`                          |
| `reversed-sparse`           |         6 | Identical sparse data with collider order reversed      | `escaped`                          |
| `flat-support`              |         0 | Declared horizontal supporting surface                  | `settled`                          |
| `angled-ramp`               |         0 | Angled line with tangential motion                      | `escaped` after sustained sliding  |
| `close-contacts`            |         2 | Exact two-peg contact tie                               | `unresolved`                       |
| `no-reachable-exit-settled` |         0 | Unreachable normal exit above a flat support            | `settled`                          |
| `no-future-event`           |         0 | Stationary body with zero acceleration                  | `no-future-event`                  |
| `explicit-time-limit`       |         0 | Moving body with no event before the configured horizon | `time-limit`                       |

The matrix tests run all entries headlessly, assert monotonic positive-duration segments, verify
adjacent segment continuity, re-query the interior of every committed segment for unexpected
contacts, and round-trip scenario and run data through JSON. Mirrored runs must reflect contact
positions and preserve event times. Reversing collider order must preserve the complete run.

## Public terminal outcomes

Contract version 6 retains the top-level `RunOutcome` vocabulary:

- `exited`: a continuous path entered a declared completion region;
- `escaped`: a continuous path entered an escape region or crossed the supported scene bounds;
- `settled`: a supported contact has zero tangential motion and acceleration;
- `no-future-event`: no supported future event exists for a permanently stationary path;
- `time-limit`: the valid path prefix reached the configured simulation-time horizon;
- `event-limit`: the valid prefix reached the configured contact-event limit;
- `unresolved`: calculation cannot certify the next interval or supported terminal state; and
- `invalid`: the input or produced record violates the public contract.

`terminalReason` retains the more detailed explanation, such as the completion region, escaped
bounds edge, zero-time loop, numerical failure or supporting collider. `validity` remains separate:
only the `invalid` outcome has invalid validity. Ordinary playback accepts valid `exited` and
`settled` histories; every other valid outcome remains a visibly incomplete recorded prefix.

Saved-run validation checks that outcome, detailed terminal reason, validity, terminal time,
recorded counts, referenced region or supporting collider, final resting contact and final
diagnostic code agree. A structurally valid but deliberately mislabelled result is rejected.

## Continuous exits and bounds

Completion-region, escape-region and supported-bounds intersections are solved directly against the
current constant-acceleration path. The earliest root is compared with fixed-world contact
candidates. A contact at or before the crossing wins; otherwise the terminal segment ends at the
exact crossing. Render frames and sampled physics positions are never used for exit discovery.

## Resting and sliding contact

Any fixed segment or circular peg can support the ball when its contact normal supplies a
non-negative reaction. Support is a physical classification rather than an opt-in scene role.
Zero tangential velocity and acceleration produce explicit resting contact. Meaningful tangential
motion or gravity produces an authoritative sustained-contact segment, including continuous ramp
sliding and changing-normal peg motion. Insufficient support detaches; invalid overlap and
uncertain constrained continuation remain invalid or unresolved rather than being relabelled as
resting.
