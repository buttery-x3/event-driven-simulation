# Module design and growth policy

## Purpose and authority

This document defines how the Event-Driven Simulation repository turns the general modularity rules
in `AGENTS.md` into project-specific implementation constraints.

It complements, rather than replaces:

- [`architecture.md`](architecture.md), which owns the simulation/rendering boundary, public
  contracts and conceptual dependency direction;
- [`simulation.md`](simulation.md), which owns the physical model, supported geometry and numerical
  behaviour; and
- [`workflow.md`](workflow.md), which owns the repository quality-gate process and commands.

Do not duplicate those subjects here. This document owns responsibility boundaries, decomposition
triggers, file and function growth limits, and the evidence required when a decomposition is
performed.

## Core rule

A production module has one primary reason to change.

The simplest implementation is the simplest one that preserves coherent ownership, not the one
with the smallest diff. The "smallest coherent extraction" is the smallest stable ownership
boundary with reasonable headroom; it is not the minimum number of moved lines needed to satisfy a
checker. The current source topology must evolve when observed responsibilities no longer match its
boundaries.

A feature area is not automatically one responsibility. For example, constructing a single-ball run
involves several distinct responsibilities:

- event-loop orchestration;
- semantic input validation;
- continuous termination and bounds searches;
- numerical contact solving;
- collision-response policy;
- sustained-contact classification and continuation;
- run-record assembly; and
- diagnostic evidence construction.

Those responsibilities may collaborate closely without belonging in one implementation file.

Private helper functions do not establish modularity when they implement independently testable
policies or algorithms inside an unrelated orchestrator.

## Responsibility categories

Use these categories when assessing a file:

| Category                | Typical responsibility                                              |
| ----------------------- | ------------------------------------------------------------------- |
| Orchestration           | Sequences subsystem calls and owns a state machine or lifecycle     |
| Numerical algorithm     | Solves roots, intersections, contacts or other mathematical results |
| Policy                  | Classifies, orders or resolves outcomes according to named rules    |
| Validation              | Accepts unknown or untrusted input and reports typed failures       |
| Serialization           | Parses, versions or writes external representations                 |
| Diagnostics             | Records or formats evidence without changing authoritative results  |
| Presentation adaptation | Converts authoritative data into renderer or UI view models         |
| Resource lifecycle      | Creates, updates and disposes runtime resources                     |

A file may contain small supporting details from another category, but it should not become the
primary implementation home for several independently changing categories.

## Decomposition triggers

A decomposition check is mandatory before adding production functionality when any of the following
is true:

- the file exceeds 350 non-blank, non-comment lines;
- the proposed change would add approximately 100 or more lines;
- the change introduces another responsibility category;
- the file already combines orchestration with an independently testable algorithm, policy,
  validator, serializer or diagnostic builder;
- a function exceeds 150 non-blank, non-comment lines; or
- the proposed change would make a function exceed that threshold;
- a directory contains six of its eight permitted implementation files; or
- three or more implementation files serve one newly introduced state machine or domain concept.

The check must identify:

1. the file's current responsibilities;
2. the new responsibility;
3. the smallest stable ownership boundary with reasonable headroom;
4. the public API that must remain stable;
5. the focused tests that protect the extraction.

## Hard growth limits

After the current legacy files have been decomposed:

- hand-written production files must not exceed 500 non-blank, non-comment lines;
- production functions must not exceed 200 non-blank, non-comment lines;
- public entry-point files must not contain implementation logic and should remain below 100
  non-blank, non-comment lines.

Tests, generated code, declarative fixtures and contract-only type declarations may receive a
documented exception where splitting would reduce clarity.

The limits are smoke alarms, not design targets. A 490-line file that owns four policies is still
poorly modularised.

"The file remains below the hard limit" is never sufficient modularity justification. A threshold
failure is evidence to reassess ownership, not permission to increase the threshold or shave lines
until the file barely passes. If an implementation encounters file or function limits more than
once, stop line-budget refactoring and restate the ownership plan before continuing.

A newly created production file above 350 effective lines requires an explicit
one-primary-reason-to-change justification and credible growth assessment in the completion report.
Duplicated lifecycle, result or transition construction across domain modules is also an ownership
signal even when each duplicated helper is small.

Threshold increases and exceptions may not be made silently. They require repository-owner
approval and a documented responsibility-based justification.

An existing file above a hard limit may receive a minimal correctness fix. It must not receive a new
independent responsibility without being decomposed in the same issue.

## Repository application

### Single-ball run

Before FLAME-35, `src/lib/simulation/single-ball-run.ts` owned too many responsibility categories:

- authoritative event-loop orchestration;
- single-ball semantic input validation;
- termination-region intersection;
- supported-bounds exit solving;
- impact response;
- sustained-contact classification and continuation;
- contact-search diagnostic conversion;
- terminal diagnostic construction; and
- run-record assembly.

FLAME-35 replaced that file with a single-ball subdomain in which the event loop remains obvious
while independent policies have separately named modules:

```text
run/single-ball/
    index.ts
    construct.ts
    input-validation.ts
    termination-search.ts
    diagnostics.ts
    run-assembly.ts
    local-events/
        index.ts
        types.ts
        prediction.ts
        commit.ts
    impact/
        index.ts
        response.ts
        resolution.ts
    manifold/
        index.ts
        types.ts
        impulse-solver.ts
        support-reactions.ts
        __tests__/
    sustained-contact/
        index.ts
        types.ts
        continuation.ts
        linear-contact.ts
        contact-mode-results.ts
        geometry.ts
        circular/
            index.ts
            continuation.ts
            angular-event-search.ts
            results.ts
        __tests__/
    __tests__/
```

FLAME-50 moved world orchestration into the sibling `run/scheduler/` subdomain and retained
single-body fixed-world solving as its local capability:

```text
run/scheduler/
    index.ts
    types.ts
    construct.ts
    release.ts
    assembly.ts
    __tests__/
```

The implemented ownership is:

- `construct.ts` — the event-to-event state machine and certified interval sequencing;
- `input-validation.ts` — semantic validation of a single-ball input;
- `termination-search.ts` — continuous region entry and supported-bounds exit solving;
- `impact/response.ts` — restitution response and conservative inelastic-collapse policy;
- `impact/resolution.ts` — contact-event commitment, diagnostic evidence, physical support/rest
  classification and next-state construction;
- `manifold/` — coupled normal-impulse and support-reaction algorithms;
- `run-assembly.ts` — committed history and terminal run-record assembly;
- `sustained-contact/index.ts` and `continuation.ts` — the named local capability and shape
  dispatch;
- `sustained-contact/linear-contact.ts` — fixed-line continuation and endpoint sequencing;
- `sustained-contact/circular/index.ts` and `continuation.ts` — the private circular-contact
  capability, including exact turning-point reversal and continuous leg sequencing;
- `sustained-contact/circular/angular-event-search.ts` — independently testable turning-point,
  support-loss and angular scene-event ordering policy;
- `sustained-contact/circular/results.ts` — circular leg terminal, continuation and diagnostic
  result construction;
- `sustained-contact/contact-mode-results.ts` — shared resting, detachment, unresolved and
  transition-result construction;
- `sustained-contact/geometry.ts` — distance and containment evaluation for constrained paths;
- `diagnostics.ts` — translation of solver evidence and terminal outcomes into recorded
  diagnostics;
- `index.ts` — explicit public exports only.

For FLAME-50, the earlier `construct.ts` and `input-validation.ts` bullets are superseded:
`construct.ts` is now only the compatibility export, `input-validation.ts` serves shared world
validation plus the narrower compatibility validator, and `local-events/prediction.ts` with
`commit.ts` owns per-body fixed-world prediction, exact-event commitment and retained
constrained-motion horizons.

Within `run/scheduler`, `construct.ts` owns monotonic global selection and exact-time batches,
`release.ts` owns release overlap admission, `assembly.ts` owns world/per-body outcome construction,
and `types.ts` owns only their scheduler state vocabulary. This boundary is evidenced by the new
global state machine, scheduled releases, later body-pair interruption consumer and independent
world/body outcomes; it is not a speculative layer.

FLAME-52 introduced enough pair-event policy to require the private `scheduler/pairs` subdomain.
`selection.ts` owns continuous prediction ordering, `component.ts` owns exact-time contact graph
construction, `commit.ts` owns isolated pair commitment and `coupled-commit.ts` owns simultaneous
component commitment. Its local `index.ts` is an explicit internal facade. Scheduler construction
continues to own global sequencing and imports this capability without re-exporting its internal
types from `run/index.ts`.

FLAME-53 introduced the sibling `run/dynamic-impact` numerical subdomain. `response.ts` preserves
the isolated closed-form response, `generalised-reflections.ts` owns the generalized simultaneous
impact operator, `lineality.ts` owns cone-lineality policy, `nonnegative-qp.ts` owns constrained
selection, and `linear-algebra.ts` owns small dense metric operations. The directory is at its
headroom-assessment threshold, but those modules still have one cohesive reason to change: the
frictionless dynamic-impact law. Rotational coordinates, sparse backends or independently
versioned solver policies would require a nested numerical subdomain rather than another sibling
implementation file.

FLAME-54 introduced a persistent dormant-component state machine and therefore the private
`scheduler/dormancy` subdomain rather than adding that lifecycle to the scheduler orchestrator.
`admission.ts` owns initial and single-body promotion, `rebuild.ts` owns post-impact retirement,
split/merge/recreation and reactivation, `records.ts` owns stable component/contact persistence,
and `support-equilibrium.ts` owns non-negative support certification. The local `index.ts` preserves
the narrow scheduler-facing API. Focused dormant-component scenarios and verification protect the
extraction; no compatibility wrapper remains at the old flat scheduler path.

FLAME-56 introduced the distinct `scheduler/dynamic-support` state machine for a moving body held
in circular contact by a dynamic body whose complete component remains fixed-anchored.
`admission.ts` owns certification and promotion, `prediction.ts` owns constrained motion plus
reaction-boundary search, `commit.ts` owns selected-boundary state transitions, `interruption.ts`
owns exact-time external-impact invalidation, `records.ts` owns history and diagnostic construction,
and `types.ts` owns private runtime vocabulary. The local `index.ts` preserves a narrow
scheduler-facing API, while public run construction remains unchanged through `run/index.ts`.

The subdomain is at the six-implementation-file headroom threshold. Its files remain cohesive parts
of one independently changing support state machine and no production file exceeds the review
threshold after record construction was extracted from commitment. A second constrained
body/body geometry, a replaceable reaction-search backend or independently configurable
certification policy would require a nested prediction or certification subdomain rather than a
seventh sibling implementation file.

Independent checks for dynamic support introduced `verification/physics/support` rather than
adding another category to the physics orchestrator. `dynamic.ts` owns the body/body geometry,
tangency, reaction, component-lifecycle and interruption checks; its local entry point leaves the
public `verification/index.ts` API unchanged.

FLAME-57 introduced the sibling `run/accumulation` subdomain because temporal-tail certification,
limiting-state estimation and complete limiting-geometry reconstruction are independently testable
policies and would make either `scheduler/construct.ts` or the fixed-world impact subdomain
multi-responsibility. Its internal entry point is `certifyAccumulationLimit`; the scheduler adapter
owns physical-history observation, external-event ordering, mathematical-limit trajectory
commitment and hand-off to existing exact-time components. No public run-construction API changed.

The accumulation adapter is itself a private scheduler subdomain: `observations.ts` owns physical
source capture, `orchestration.ts` owns certification and external-event barriers, `promotion.ts`
owns exact-time component adaptation, and `diagnostics.ts` owns public evidence publication. This
keeps the scheduler's direct implementation-file count below its headroom trigger. `run/accumulation` has five
implementation files plus its entry point; a new certification family should be assessed for a
nested temporal or reconstruction boundary before growing the directory beyond capacity.

`run/accumulation/geometry.ts` is above the 350-line review trigger because its single primary
responsibility is the complete limiting-geometry reconstruction transaction: seed ambiguous
constraints, project the candidate state, independently re-query every relevant fixed/body pair,
and assemble the resulting graph. Those stages share the same local geometry primitives and one
closed result contract, so extracting them now would create forwarding fragments rather than a
stable ownership boundary. It remains below the hard limit. A second geometry family, a reusable
spatial candidate index, or independent reconstruction policy would justify splitting query and
constraint projection into a named nested boundary before further growth.

Independent accumulation auditing lives in `verification/physics/accumulation`, avoiding another
unrelated responsibility in the already broad direct physics directory. The audit recomputes the
declared temporal envelope and limiting contact set but deliberately contains no impact or support
solver.

FLAME-36 moved restitution response out of `construct.ts` when sustained contact introduced a
second response mode. The orchestrator retains only state sequencing and run assembly.

The extraction must preserve `constructSingleBallRun` as the public capability and must not change
the current physical model.

### Boundary contact

The former `src/lib/simulation/boundary-contact.ts` exceeded the hard file limit and combined query
validation, finite-segment root solving, endpoint and face evidence classification, and earliest
candidate selection. FLAME-35 extracted query validation to
`collision/boundary-query-validation.ts` and candidate geometry classification to
`collision/boundary-candidate.ts`. `collision/boundary-contact.ts` now owns shared face/endpoint
polynomial construction, root isolation and earliest-candidate orchestration. Keeping those root
operations together avoids duplicating tolerance and ordering policy across tiny face and endpoint
wrappers.

### Circle-circle contact

FLAME-42 replaced the substantial peg-specific contact module with the named
`collision/circle-circle` subdomain. `contact-polynomial.ts` owns quartic construction and ballistic
candidate geometry, `query.ts` owns root isolation and earliest eligible contact construction, and
`query-validation.ts` owns input validation. `root-topology.ts` owns the independently testable
entering, exiting, grazing, initial/release-owned and indeterminate policy, while `types.ts` owns
contract-only declarations. The local `index.ts` exposes geometry-pair terminology while the parent
collision entry point remains the supported cross-subsystem boundary.

### Dynamic-pair contact

FLAME-51 introduced continuous collision discovery between two moving circles as the named
`collision/dynamic-pair` subdomain. `contact-polynomial.ts` owns swap-invariant relative geometry,
`query-validation.ts` owns synchronized-path input policy, `query.ts` owns bounded root selection
and result construction, and `types.ts` owns the local path/result contracts. The local and parent
entry points preserve an explicit public collision capability without exposing scheduler state.

FLAME-55 added changing-normal circular paths without enlarging the already substantial polynomial
query. `bounded-query.ts` has one primary reason to change: conservative circular-path contact
isolation, refinement and typed evidence under a deterministic interval budget. At 389 lines it is
above the new-file review threshold, but splitting its interval state machine from its result and
candidate construction would obscure the fail-closed algorithm without establishing another
independently changing policy. The directory is at its headroom-assessment threshold. Another
numerical query family, independently configurable isolation backend or additional curved path
model must introduce a nested bounded-isolation subdomain rather than a seventh sibling file.

### Fixture validation

`serialization/simulation-input/v6.ts` retains the legacy version 6 input reader, while `v7.ts`
owns current input shape, body identity, mass, release-time and declared common-release overlap
validation. Legacy run shape and consistency remain in the version 6 files. The named
`serialization/run-record/v7` subdomain owns current run shape, multi-body consistency and v6-to-v7
migration assembly; `accumulation-shape.ts` owns the nested accumulation evidence shape so the main
shape reader remains bounded. Reusable
unknown-data assertions and typed fixture failures live in the narrowly named
`serialization/structural-validation` subdomain and are exposed through its local entry point.

The public `contracts` entry point was decomposed for FLAME-48. `geometry.ts`, `input.ts` and
`motion.ts` own their respective plain declarations; the named `contracts/history` subdomain owns
events, per-body/world outcomes, diagnostics and run-record composition. `contracts/index.ts`
remains the stable explicit public facade and contains no implementation logic.

## Extraction rules

A decomposition should:

- preserve observable behaviour before adding the requested feature;
- keep or narrow the existing public API;
- move tests rather than duplicate them;
- add focused tests only for newly isolated behaviour that lacked direct protection;
- avoid temporary compatibility wrappers unless an existing consumer genuinely requires one;
- delete obsolete aliases and dead modules when their compatibility purpose no longer exists;
- update `architecture.md` when module ownership or public entry points change.

An agent may introduce a clearly named internal subdomain and update documentation and mechanical
checking in the same issue when the active work provides concrete evidence: current
responsibilities, active near-term work, multiple consumers, repeated threshold encounters or a
new state machine/domain concept. Do not add empty layers for hypothetical change.

Do not create modules named `helpers`, `utils`, `common`, `shared`, `misc` or `core` as containers for
unowned behaviour. Name modules after the concept or policy they own.

## Review evidence

When a decomposition trigger applies, the implementation review must include:

- the responsibilities found before the change;
- the final responsibility of each affected module;
- the public API preserved or intentionally changed;
- focused tests run during extraction;
- the full repository quality-gate result;
- confirmation that no oversized file acquired a new independent responsibility.

Every non-trivial completion report must also identify remaining structural pressure, evidence-based
future split points, topology/dependency/threshold changes (or explicitly state that there were
none), and headroom concerns for modified or new files above 350 effective lines.

A review summary that only reports line movement is insufficient.

## Mechanical enforcement

ESLint enforces:

```js
{
  files: ['src/lib/**/*.{js,ts}'],
  ignores: ['src/lib/**/*.{spec,test}.{js,ts}'],
  rules: {
    'max-lines': [
      'error',
      {
        max: 500,
        skipBlankLines: true,
        skipComments: true
      }
    ],
    'max-lines-per-function': [
      'error',
      {
        max: 200,
        skipBlankLines: true,
        skipComments: true,
        IIFEs: true
      }
    ]
  }
}
```

The rules are active without a file-specific exception. FLAME-35 brought the former boundary module
and oversized functions below the hard limits before enabling enforcement.

Any temporary exception must:

- name the exact file;
- explain why splitting would currently reduce clarity;
- link to a Linear follow-up when further growth is expected; and
- avoid broad directory-level exclusions.

The enforcement belongs inside the existing `npm run check` workflow. Do not introduce a competing
completion command.
