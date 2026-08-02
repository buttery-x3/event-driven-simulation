# Board-state matrix and terminal outcomes

FLAME-33 extends the Milestone 2 headless experiment catalogue beyond the canonical board.
`boardStateScenarios` in `src/lib/simulation/world/board-state-scenarios.ts` contains only ordinary
serialisable scene, body and settings data. Every entry runs through `constructSingleBallRun`;
scenario IDs and peg counts never select solver behaviour.

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
| `angled-ramp`               |         0 | Undeclared angled line with tangential motion           | `unresolved`                       |
| `close-contacts`            |         2 | Exact two-peg contact tie                               | `unresolved`                       |
| `no-reachable-exit-settled` |         0 | Unreachable normal exit above a flat support            | `settled`                          |
| `no-future-event`           |         0 | Stationary body with zero acceleration                  | `no-future-event`                  |
| `explicit-time-limit`       |         0 | Moving body with no event before the configured horizon | `time-limit`                       |

The matrix tests run all entries headlessly, assert monotonic positive-duration segments, verify
adjacent segment continuity, re-query the interior of every committed segment for unexpected
contacts, and round-trip scenario and run data through JSON. Mirrored runs must reflect contact
positions and preserve event times. Reversing collider order must preserve the complete run.

## Public terminal outcomes

Contract version 5 adds a top-level `RunOutcome` with exactly these values:

- `exited`: a continuous path entered a declared completion region;
- `escaped`: a continuous path entered an escape region or crossed the supported scene bounds;
- `settled`: the narrow supporting-flat policy certified a terminal rest state;
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
recorded counts, referenced region or supporting collider, final settlement contact and final
diagnostic code agree. A structurally valid but deliberately mislabelled result is rejected.

## Continuous exits and bounds

Completion-region, escape-region and supported-bounds intersections are solved directly against the
current constant-acceleration path. The earliest root is compared with fixed-world contact
candidates. A contact at or before the crossing wins; otherwise the terminal segment ends at the
exact crossing. Render frames and sampled physics positions are never used for exit discovery.

## Narrow settlement policy

Settlement is disabled unless both the scene and settings opt in:

1. the contacted line declares `surfaceRole: "supporting-flat"`;
2. scene validation proves that line is horizontal in board coordinates;
3. `settings.settlement` supplies named normal-speed, tangential-speed, contact-distance and
   pressing-acceleration thresholds;
4. acceleration presses the ball into the contact normal;
5. post-response normal separation and tangential speeds are no greater than their thresholds; and
6. the evaluated centre-to-contact-point separation agrees with the ball radius.

The shared matrix policy uses:

| Setting                         |       Value |
| ------------------------------- | ----------: |
| Maximum normal separation speed |  `0.02 m/s` |
| Maximum tangential speed        |  `0.01 m/s` |
| Contact-distance tolerance      |    `1e-8 m` |
| Minimum pressing acceleration   | `1e-6 m/s²` |

An angled line cannot declare the flat-support role. A ramp contact with meaningful tangential
motion therefore continues if supported or returns an explicit unresolved result; it is never
labelled settled to hide missing rolling or sliding dynamics.
