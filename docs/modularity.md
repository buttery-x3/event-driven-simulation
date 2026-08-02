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
    impact-response.ts
    diagnostics.ts
    sustained-contact/
        index.ts
        types.ts
        continuation.ts
        linear-contact.ts
        circular-contact.ts
        angular-event-search.ts
        contact-mode-results.ts
        geometry.ts
        __tests__/
    __tests__/
```

The implemented ownership is:

- `construct.ts` — the event-to-event state machine and committed-history assembly;
- `input-validation.ts` — semantic validation of a single-ball input;
- `termination-search.ts` — continuous region entry and supported-bounds exit solving;
- `impact-response.ts` — restitution response and conservative inelastic-collapse policy;
- `sustained-contact/index.ts` and `continuation.ts` — the named local capability and shape
  dispatch;
- `sustained-contact/linear-contact.ts` — fixed-line continuation and endpoint sequencing;
- `sustained-contact/circular-contact.ts` — changing-normal circular continuation;
- `sustained-contact/angular-event-search.ts` — independently testable detachment and angular
  next-event search policy;
- `sustained-contact/contact-mode-results.ts` — shared resting, detachment, unresolved and
  transition-result construction;
- `sustained-contact/geometry.ts` — distance and containment evaluation for constrained paths;
- `diagnostics.ts` — translation of solver evidence and terminal outcomes into recorded
  diagnostics;
- `index.ts` — explicit public exports only.

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

### Fixture validation

`serialization/simulation-input/v6.ts` owns standalone version 6 input shape validation.
`serialization/run-record/v6-shape.ts` owns run-record structural validation, while
`v6-consistency.ts` owns cross-field invariants and terminal references. `run-record/v6.ts` only
orchestrates those two phases. Reusable unknown-data assertions and typed fixture failures live in
the narrowly named `serialization/structural-validation` subdomain and are exposed to sibling
serialization modules through its local entry point.

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
