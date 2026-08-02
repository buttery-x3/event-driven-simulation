# Module design and growth policy

## Purpose and authority

This document defines how the Event-Driven Simulation repository turns the general modularity rules
in `AGENTS.md` into project-specific implementation constraints.

It complements, rather than replaces:

* [`architecture.md`](architecture.md), which owns the simulation/rendering boundary, public
  contracts and conceptual dependency direction;
* [`simulation.md`](simulation.md), which owns the physical model, supported geometry and numerical
  behaviour; and
* [`workflow.md`](workflow.md), which owns the repository quality-gate process and commands.

Do not duplicate those subjects here. This document owns responsibility boundaries, decomposition
triggers, file and function growth limits, and the evidence required when a decomposition is
performed.

## Core rule

A production module has one primary reason to change.

A feature area is not automatically one responsibility. For example, constructing a single-ball run
involves several distinct responsibilities:

* event-loop orchestration;
* semantic input validation;
* continuous termination and bounds searches;
* numerical contact solving;
* collision-response policy;
* settlement classification;
* run-record assembly; and
* diagnostic evidence construction.

Those responsibilities may collaborate closely without belonging in one implementation file.

Private helper functions do not establish modularity when they implement independently testable
policies or algorithms inside an unrelated orchestrator.

## Responsibility categories

Use these categories when assessing a file:

| Category | Typical responsibility |
| --- | --- |
| Orchestration | Sequences subsystem calls and owns a state machine or lifecycle |
| Numerical algorithm | Solves roots, intersections, contacts or other mathematical results |
| Policy | Classifies, orders or resolves outcomes according to named rules |
| Validation | Accepts unknown or untrusted input and reports typed failures |
| Serialization | Parses, versions or writes external representations |
| Diagnostics | Records or formats evidence without changing authoritative results |
| Presentation adaptation | Converts authoritative data into renderer or UI view models |
| Resource lifecycle | Creates, updates and disposes runtime resources |

A file may contain small supporting details from another category, but it should not become the
primary implementation home for several independently changing categories.

## Decomposition triggers

A decomposition check is mandatory before adding production functionality when any of the following
is true:

* the file exceeds 350 non-blank, non-comment lines;
* the proposed change would add approximately 100 or more lines;
* the change introduces another responsibility category;
* the file already combines orchestration with an independently testable algorithm, policy,
  validator, serializer or diagnostic builder;
* a function exceeds 150 non-blank, non-comment lines; or
* the proposed change would make a function exceed that threshold.

The check must identify:

1. the file's current responsibilities;
2. the new responsibility;
3. the smallest coherent extraction;
4. the public API that must remain stable;
5. the focused tests that protect the extraction.

## Hard growth limits

After the current legacy files have been decomposed:

* hand-written production files must not exceed 500 non-blank, non-comment lines;
* production functions must not exceed 200 non-blank, non-comment lines;
* public entry-point files must not contain implementation logic and should remain below 100
  non-blank, non-comment lines.

Tests, generated code, declarative fixtures and contract-only type declarations may receive a
documented exception where splitting would reduce clarity.

The limits are smoke alarms, not design targets. A 490-line file that owns four policies is still
poorly modularised.

An existing file above a hard limit may receive a minimal correctness fix. It must not receive a new
independent responsibility without being decomposed in the same issue.

## Current repository application

### `single-ball-run.ts`

`src/lib/simulation/single-ball-run.ts` currently owns too many responsibility categories:

* authoritative event-loop orchestration;
* single-ball semantic input validation;
* termination-region intersection;
* supported-bounds exit solving;
* impact response;
* settlement classification;
* contact-search diagnostic conversion;
* terminal diagnostic construction; and
* run-record assembly.

The required destination is a single-ball subsystem in which the event loop remains obvious while
independent policies become separately named modules:

```text
run/single-ball/
    index.ts
    construct.ts
    input-validation.ts
    termination-search.ts
    settlement.ts
    diagnostics.ts
    __tests__/
```

The intended ownership is:

* `construct.ts` — the event-to-event state machine and committed-history assembly;
* `input-validation.ts` — semantic validation of a single-ball input;
* `termination-search.ts` — continuous region entry and supported-bounds exit solving;
* `settlement.ts` — the narrow supporting-flat settlement policy;
* `diagnostics.ts` — translation of solver evidence and terminal outcomes into recorded
  diagnostics;
* `index.ts` — explicit public exports only.

The existing restitution response may remain in `construct.ts` while it is one small linear policy.
It should move into a dedicated response module when additional response modes, friction, spin or
sustained contact are introduced.

The extraction must preserve `constructSingleBallRun` as the public capability and must not change
the current physical model.

### `boundary-contact.ts`

`src/lib/simulation/boundary-contact.ts` is also above the hard file limit. Its size alone does not
prove the numerical implementation is incorrectly divided, but it requires a decomposition review
before further feature growth.

The review should determine whether finite-segment face solving, endpoint solving, query validation
and candidate selection have independent reasons to change. A likely split is:

```text
collision/boundary/
    index.ts
    face-contact.ts
    endpoint-contact.ts
    select-contact.ts
    __tests__/
```

Do not perform that split merely to satisfy line count. Preserve shared numerical policy where
separation would duplicate tolerances, root handling or candidate semantics.

### Fixture validation

`run-fixture-v5.ts` is approaching the review threshold and currently combines structural field
validation with cross-field run consistency checks. It may remain intact while those concerns
change together, but the next substantial contract expansion must assess whether structural
validation and consistency validation should separate.

## Extraction rules

A decomposition should:

* preserve observable behaviour before adding the requested feature;
* keep or narrow the existing public API;
* move tests rather than duplicate them;
* add focused tests only for newly isolated behaviour that lacked direct protection;
* avoid temporary compatibility wrappers unless an existing consumer genuinely requires one;
* delete obsolete aliases and dead modules when their compatibility purpose no longer exists;
* update `architecture.md` when module ownership or public entry points change.

Do not create modules named `helpers`, `utils`, `common`, `shared`, `misc` or `core` as containers for
unowned behaviour. Name modules after the concept or policy they own.

## Review evidence

When a decomposition trigger applies, the implementation review must include:

* the responsibilities found before the change;
* the final responsibility of each affected module;
* the public API preserved or intentionally changed;
* focused tests run during extraction;
* the full repository quality-gate result;
* confirmation that no oversized file acquired a new independent responsibility.

A review summary that only reports line movement is insufficient.

## Mechanical enforcement

Once the legacy oversized files have been brought below the hard limits, ESLint should enforce:

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

Do not enable a permanently failing rule. The modularisation issue should first resolve or explicitly
grandfather each existing violation, then activate the rule in the same issue.

Any temporary exception must:

* name the exact file;
* explain why splitting would currently reduce clarity;
* link to a Linear follow-up when further growth is expected; and
* avoid broad directory-level exclusions.

The enforcement belongs inside the existing `npm run check` workflow. Do not introduce a competing
completion command.
