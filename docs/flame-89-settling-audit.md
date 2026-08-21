# FLAME-89 finite-capture settling audit

## Scope and baseline

The audit uses production `constructSimulationRun` on `main` after FLAME-88. Every named primary
scenario keeps the production represented-physics capture distance of `1e-9 m`; no scenario-specific
tuning or FLAME-57 accumulation mechanism is present. The legacy five-column input is retained only
as a control.

The event counts below are the public `RunDiagnostics.eventCount` values. Speeds are reported only
to distinguish a microscopic tail from a materially moving unresolved component; they are not new
acceptance tolerances.

## Primary frontier

| Scenario                     | Outcome and events                                                           | Finite-capture evidence                                                                                                                                                                                                                        | Contact-topology evidence                                                                                                                                                                                                                           | First remaining boundary                                                                                                                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `three-ball-settlement`      | `time-limit` at `5 s`; 44 events; maximum terminal speed about `1.75e-4 m/s` | Nine coupled decisions remain ordinary. At the last decision both body/body contacts have positive separating velocity but no locally pressing normal acceleration, so excursion is unbounded and capture distance is not the deciding factor. | The original supported horizontal reproducer alternates both adjacent body edges.                                                                                                                                                                   | Independent verification first reports `IMPACT_EVIDENCE_MISMATCH` for `collapse-2` at `0.6830048228 s`: the last dynamic-contact geometry/incoming-motion evidence does not agree with both paths. The run otherwise continues in low-speed floor-constrained motion to its time limit. |
| `off-axis-incremental-pile`  | `unresolved`; 50 events; maximum terminal speed about `1.48 m/s`             | Capture first occurs at `3.9456529677 s`, retaining `joining-01 <-> joining-02` and `joining-01 <-> floor`; no contact is released by that decision.                                                                                           | Three distinct body edges occur, eight recorded body contacts are oblique, partners change, and the initially dormant base is reactivated by the first scheduled join.                                                                              | The capture is accepted, then scheduler commitment ends at `unsupported-body-body-response`: retained dynamic contact requires a persistent body/body mode beyond the current fixed-anchored support capability. Independent validation of the prefix passes.                           |
| `staggered-twenty-ball-pile` | `unresolved`; 18 events; maximum terminal speed about `2.67 m/s`             | Capture first occurs at `0.4470560360 s`, retaining `staggered-1-2 <-> staggered-2-2` and `staggered-1-2 <-> floor`; no contact is released by that decision.                                                                                  | Twenty positively separated bodies start in five four-ball rows with alternating half-spacing offsets. The prefix records seven distinct body edges, 25 oblique body contacts, changing partners, and oblique joins after floor interaction begins. | Independent verification identifies the earliest wrong evidence at `0.4467507866 s`: `IMPACT_EVIDENCE_MISMATCH` for `staggered-1-1`. The scheduler subsequently ends at the same downstream `unsupported-body-body-response` boundary seen by the small pile.                           |

FLAME-98 later showed the three-ball and related settling `IMPACT_EVIDENCE_MISMATCH` reports were
verifier eligibility false positives: a post-impact `resting-anchored` support record at the same
timestamp was checked as incoming impact evidence. The represented-rest transition itself was
already authoritative.

## Capture-distance sensitivity

The one permitted comparison reruns only `three-ball-settlement` at the FLAME-87 proof scale of
`1e-6 m`. It produces the same 44-event `time-limit`, the same terminal speed and no captured
endpoint. This is not capture-distance tuning pressure: the horizontal body/body contacts lack a
locally pressing normal acceleration, so their separating excursions are unbounded at either
distance.

## Legacy control

`legacy-twenty-ball-container-drop-control` preserves the five neat columns and tiny alternating
lateral drift from FLAME-57. It records five vertical body edges and no oblique body contact, so it
is not evidence for the dense acceptance case.

Finite capture prevents the former `A dynamic pair root had indeterminate local topology` terminal
failure. The control instead captures a body/floor-supported pair at `0.4238597894 s` and ends at
`unsupported-body-body-response` after 45 events. Independent verification already reports four
earlier `CONTACT_SET_MISMATCH` findings at `0.4236738962 s`, where transitions to sliding lack a
retained outgoing constrained segment.

## Remaining blockers

1. The supported horizontal three-body tail is not locally persistent under the finite-capture
   rule, and its last simultaneous dynamic-contact record fails independent geometry/motion
   validation.
2. A valid captured body/body contact that also has fixed support still reaches the scheduler's
   explicit persistent body/body-mode boundary in both challenging primary piles.
3. The dense primary case and legacy control expose earlier run-record/transition validation
   mismatches that must remain separate bounded defects from capture itself.

No audited input reaches the former indeterminate dynamic-pair root-topology terminal reason. The
remaining failures occur after or outside the finite-capture decision and do not justify an
accumulation detector, broader capture distance, or solver rewrite in FLAME-89.

FLAME-100 later made capture persistence internally authoritative. The legacy control still ends at
event-limit without the former root-topology reason, but independent verification can now also
report `EARLY_GEOMETRY_CROSSING` after zero-velocity floor contacts are released by that
authority. That is a later independent frontier, not a return of indeterminate pair-root topology.
