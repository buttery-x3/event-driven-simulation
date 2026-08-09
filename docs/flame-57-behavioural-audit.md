# FLAME-57 behavioural audit

## Status

FLAME-57 is incomplete. Production runs now expose genuine candidate behaviour, but no supported
accumulation family currently proves the unobserved temporal and state tails required for promotion.

## Certification finding

The former `monotone-geometric-interval-envelope` calculated a `ratioUpperBound` from the maximum
ratio in a finite observed prefix plus a five-percent margin. No scheduler invariant, contact law or
family-specific analytic result established that every future interval would remain below that
number. Any finite prefix is compatible with a later interval that violates the extrapolated ratio.
The resulting geometric-series value was therefore an estimate, not an upper bound.

Position and velocity tails reused the temporal ratio as a multiplier on their latest observed
steps. The implementation did not prove that either state-step sequence contracts at the temporal
ratio, so those values were not enclosures either.

The observed-ratio path now rejects with:

> Observed contraction ratios are finite-prefix evidence only; no supported analytic accumulation
> family certifies that future event intervals remain below the observed ratio.

No `AccumulationLimit`, `accumulation-tail` trajectory or downstream promotion is produced from that
evidence.

## Production scenario evidence

| Scenario                          | Genuine production witness                                                                    | Current narrow result                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| FLAME-46 exact-fit / oversized    | Positive-time alternating peg contacts                                                        | Rejected before promotion; exact-fit becomes unresolved and oversized reaches an invalid penetrating continuation |
| three-ball settlement             | Three supported moving bodies alternate collisions across both body edges                     | Time limit; no certified settlement                                                                               |
| dynamic alternating supports      | Every source impact component contains a body-body edge and fixed floor contacts              | Time limit; no certified promotion                                                                                |
| multi-body non-alternating        | Four bodies generate all three adjacent edges and overlapping three/four-body components      | Time limit; no certified promotion                                                                                |
| lineality created at accumulation | Dedicated two-peg throat generates alternating left/right contacts                            | Unresolved before limit reconstruction; no FLAME-53 lineality evidence yet                                        |
| separation after promotion        | Unsupported three-body inelastic collapse with contracting intervals                          | Time limit; no promotion, so separation-after-promotion is not demonstrated                                       |
| incremental pile                  | A scheduled body falls onto and collides repeatedly with a supported base                     | Unresolved dynamic-pair topology at the first join before the complete pile forms                                 |
| twenty-ball drop                  | Twenty bodies start above the floor, fall, hit the floor and form five dynamic stack contacts | Unresolved dynamic-pair topology; no settlement claim                                                             |
| pile reactivation                 | A striker is scheduled after the genuine pile-forming prefix                                  | The prefix becomes unresolved before the striker release, so reactivation is not demonstrated                     |
| dense nonconverging               | Elastic dense-board impacts with non-contracting intervals                                    | Explicit non-contracting rejection and no promotion                                                               |
| uncertifiable temporal tail       | Genuine three-body collapse with strictly contracting positive intervals                      | Explicit missing-analytic-family rejection                                                                        |
| uncertifiable geometry            | Genuine four-body changing-edge candidate                                                     | Blocked at the temporal prerequisite; a geometry-specific rejection is not yet reachable                          |

## Additional production limitations exposed

The genuine incremental and twenty-body inputs reach `A dynamic pair root had indeterminate local
topology` near the simultaneous-contact limit. Independent validation also rejects the final
same-time multi-body contact records in the unsupported three-/four-body collapse prefixes because
their recorded incoming-motion evidence no longer agrees with both paths. These are evidence of
unfinished accumulation-boundary handling, not scenario-success alternatives.

## Required next proof boundary

Before FLAME-57 can return to review, at least one bounded physical family must provide:

1. an analytic or otherwise independently justified bound on every future event interval;
2. independent position and velocity tail enclosures;
3. a limit-time ordering proof against unrelated scheduler events;
4. production-run reconstruction and downstream FLAME-53/54/56 witnesses; and
5. the pending scenario acceptance tests converted into executed assertions.

The workbench candidate inspector now lists participant IDs, fixed candidates, source physical-event
IDs and rejection reasons. Ordinary history entries provide contact times, edge participants,
component changes and subsequent body trajectories.
