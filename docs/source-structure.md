# Source structure and subsystem boundaries

## Purpose and authority

This document defines the filesystem representation of the Event-Driven Simulation architecture.

It complements:

- [`architecture.md`](architecture.md), which remains authoritative for conceptual subsystem
  responsibilities and the simulation/rendering boundary;
- [`modularity.md`](modularity.md), which defines file and function growth policy; and
- [`workflow.md`](workflow.md), which remains authoritative for quality-gate commands and review
  workflow.

This document owns stable top-level subsystem placement, subsystem entry points, cross-subsystem
import rules, the current internal topology and the rules for evolving that topology.

## Stable constraints and current state

FLAME-35 replaced the former flat `src/lib/simulation` layout with the named subsystems below.
Production implementation files belong to one of those subsystems, tests are in local `__tests__`
directories, and cross-subsystem consumers use explicit entry points. The architecture checker
prevents the former flat layout from returning.

Top-level subsystem ownership and the dependency direction in this document are architectural
constraints. Internal folders and filenames are descriptive and evolvable: they record the current
implementation, not every subdomain that may ever be permitted.

## Current/reference topology

```text
src/lib/simulation/
    contracts/
        index.ts
        __tests__/

    math/
        index.ts
        vector.ts
        polynomial-roots.ts
        __tests__/

    motion/
        index.ts
        trajectory.ts
        circular-contact.ts
        __tests__/

    collision/
        index.ts
        boundary-contact.ts
        boundary-candidate.ts
        boundary-query-validation.ts
        fixed-world/
            index.ts
            types.ts
            query.ts
            candidate-evaluation.ts
            manifold.ts
        circle-circle/
            index.ts
            query.ts
            contact-polynomial.ts
            query-validation.ts
            root-topology.ts
            types.ts
        __tests__/

    world/
        index.ts
        canonical-board.ts
        scene-validation.ts
        prototype-input.ts
        scenarios/
            index.ts
            types.ts
            canonical-launches.ts
            board-states.ts
            board-state-metadata.ts
            adversarial.ts
            manifold/
                index.ts
                definitions.ts
        __tests__/

    run/
        index.ts
        outcome.ts
        single-ball/
            index.ts
            construct.ts
            input-validation.ts
            termination-search.ts
			diagnostics.ts
			run-assembly.ts
			impact/
				index.ts
				alternating-limit.ts
				evidence.ts
				response.ts
				resolution.ts
            manifold/
                index.ts
                types.ts
                acquisition.ts
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
        __tests__/

    serialization/
        diagnostic-export/
            index.ts
            types.ts
            v1.ts
            __tests__/
        structural-validation/
            index.ts
            assertions.ts
            fixture-error.ts
        run-record/
            index.ts
            fixture.ts
            json.ts
            version.ts
            v6.ts
            v6-shape.ts
            v6-consistency.ts
            __tests__/
        simulation-input/
            index.ts
            fixture.ts
            v6.ts
            __tests__/

    verification/
        index.ts
        validate.ts
        results.ts
        history/
            index.ts
            record-integrity.ts
            temporal-continuity.ts
        physics/
            index.ts
            contact-geometry.ts
            collision-free.ts
            contact-dynamics.ts
            terminal-outcome.ts
        __tests__/
```

An optional `src/lib/simulation/index.ts` may exist only when a genuine package-level public facade
is needed. It must not become a universal barrel that exposes every internal capability.

## Subsystem ownership

| Subsystem       | Owns                                                                           | Does not own                                       |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| `contracts`     | Plain serialisable simulation, trajectory, event and diagnostic types          | Algorithms, browser types, runtime validation      |
| `math`          | Small reusable numerical and vector operations                                 | Scene semantics, collision policy, run state       |
| `motion`        | Evaluation of declared continuous motion segments                              | Contact discovery, rendering clocks                |
| `collision`     | Continuous fixed-geometry contact discovery and earliest-contact selection     | Run construction, terminal outcomes, serialization |
| `world`         | Scene validation, canonical boards and scenario definitions                    | Dynamic event sequencing, fixture parsing          |
| `run`           | Event-to-event simulation, response and terminal outcome construction          | Renderer resources, external JSON parsing          |
| `serialization` | Unknown-data parsing, contract-version dispatch and saved input/run validation | Authoritative motion or collision generation       |
| `verification`  | Independent public run-history invariants and structured validation evidence   | Event generation, record repair, renderer playback |

The `serialization/diagnostic-export` subdomain owns construction and formatted JSON writing for
the versioned, immutable diagnostic evidence bundle. It consumes an accepted run record and
explicit workbench provenance; it does not load scenarios, validate saved runs, invoke simulation,
or depend on browser download APIs.

These responsibilities refine the module descriptions already present in `architecture.md`; they do
not replace the physical and renderer boundaries documented there.

## Allowed dependency direction

The allowed production dependency graph is:

```text
contracts

math          -> contracts
motion        -> contracts, math
collision     -> contracts, math, motion
world         -> contracts
run           -> contracts, math, motion, collision, world
serialization -> contracts, world, run
verification  -> contracts, math, motion
```

Additional rules:

- `contracts` imports no other simulation subsystem.
- `run` must not import `serialization`.
- `collision` must not import `world`, `run` or `serialization`.
- `world` must not import `collision`, `run` or `serialization`.
- `serialization` may validate and preserve run data but must never generate or repair
  authoritative motion.
- `verification` is a leaf validation capability. Simulation producers and serializers must not
  import it, and it must not reproduce collision discovery or constrained-motion solving.
- Rendering may consume only the documented public contract and motion-evaluation APIs, consistent
  with `architecture.md`.
- Application and workbench code may invoke run construction and serialization only through their
  public entry points.

Circular subsystem dependencies are forbidden.

## Public entry points

Each subsystem consumed outside itself must expose an explicit `index.ts`.

Entry points must:

- use explicit named exports;
- contain no implementation logic;
- avoid wildcard exports;
- expose only supported public capabilities;
- remain small enough to review as an API surface.

Cross-subsystem imports must use the target subsystem entry point:

```ts
import { findEarliestFixedWorldContact } from '../collision';
```

Cross-subsystem deep imports are forbidden:

```ts
import { findEarliestFixedWorldContact } from '../collision/fixed-world-contact';
```

Implementation files may import private sibling files within their own subsystem.

Tests may inspect private implementation modules inside the subsystem they test. Tests crossing into
another subsystem should use that subsystem's public entry point unless the test explicitly verifies
an internal architectural invariant.

## Evolving internal subdomains

When concrete responsibility pressure shows that the current internal topology is stale, introduce
or remove the genuine subdomain in the same issue that exposes the pressure. A new internal
subdomain must have:

- a specific domain name and stated responsibility;
- a narrow `index.ts` entry point where sibling consumers need a local capability boundary;
- a documented dependency relationship to its parent and sibling modules; and
- production files whose primary reasons to change belong to that domain.

Evidence may include current independently changing responsibilities, active near-term work,
multiple consumers, repeated threshold encounters or a newly implemented state machine/domain
concept. Do not create speculative empty layers. Introduce an evidenced named subdomain before its
parent directory is saturated rather than waiting for a ninth implementation file.

Update this reference topology and relevant ownership documentation in the same issue. The
architecture checker must enforce stable subsystem membership, dependency direction, entry-point
rules and prohibited catch-all directories without freezing every internal filename into a
permanent schema.

## Directory growth

A subsystem directory may contain at most eight production implementation files at one level,
excluding `index.ts` and `__tests__`.

At six implementation files, perform a subdomain and headroom assessment. When responsibility
pressure already makes a boundary apparent—or before the limit would be exceeded—define a named
subdomain with its own responsibility and entry point before adding more files.

Do not satisfy the limit with arbitrary nesting. Every directory must correspond to a concept that
can be described without using words such as “other”, “miscellaneous” or “shared stuff”.

Catch-all directories named `helpers`, `utils`, `common`, `shared`, `misc` or `core` require explicit
repository-owner approval and a narrowly documented responsibility.

## Test placement

Unit tests belong in a local `__tests__` directory under the subsystem or subdomain they test.

This keeps tests near their production code while allowing the source tree to communicate production
architecture when test directories are collapsed.

Regression JSON remains under the existing repository-level `fixtures/` directories. This document
does not change the regression-fixture process in `regression-fixtures.md`.

Browser tests remain under `tests/browser` and continue to follow `browser-testing.md`.

## Migration record

FLAME-35 applied this ownership map from the former flat locations:

| Former location                                                                                                        | Target subsystem                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts.ts`                                                                                                         | `contracts/index.ts`, with later type splitting only if independently justified                                                                            |
| `vector.ts`, `polynomial-roots.ts`                                                                                     | `math/`                                                                                                                                                    |
| `trajectory.ts`                                                                                                        | `motion/`                                                                                                                                                  |
| `peg-contact.ts`, `boundary-contact.ts`, `fixed-world-contact.ts`                                                      | `collision/`; FLAME-42 later replaced peg-specific collision terminology with the named `collision/circle-circle/` subdomain                               |
| `canonical-board.ts`, `board-state-scenarios.ts`, `scenario-catalogue.ts`, `scene-validation.ts`, `prototype-input.ts` | `world/`                                                                                                                                                   |
| `single-ball-run.ts`, `run-outcome.ts`                                                                                 | `run/`, including the `run/single-ball/` decomposition from `modularity.md`                                                                                |
| `synthetic-run.ts`                                                                                                     | remove if the compatibility alias is no longer required; otherwise expose the alias from `run/index.ts` without retaining a separate implementation module |
| `run-fixture*.ts`                                                                                                      | `serialization/run-record/`                                                                                                                                |
| `simulation-input-fixture.ts`                                                                                          | `serialization/simulation-input/`                                                                                                                          |
| co-located `*.spec.ts` files                                                                                           | the matching local `__tests__/` directory                                                                                                                  |

FLAME-39 later moved the independently growing canonical, board-state and adversarial catalogues
into the named `world/scenarios` subdomain. `types.ts` owns their shared serialisable descriptor
contract, the definition modules own complete `SimulationInput` values, and
`board-state-metadata.ts` keeps verification policy from further enlarging the substantial board
geometry module. Consumers continue to use `world/index.ts`.

The migration issue must also update the path references in `architecture.md`, `simulation.md`,
`workflow.md`, ESLint rules and all imports. Do not leave documentation describing paths that no
longer exist.

## Mechanical enforcement

`scripts/check-architecture.mjs` enforces the stable architecture rules while permitting documented,
named internal subdomains.

The checker should fail when it finds:

1. a production implementation file directly under `src/lib/simulation`;
2. an undocumented top-level simulation subsystem;
3. a cross-subsystem deep import;
4. an import that violates the allowed dependency graph;
5. a circular subsystem dependency;
6. more than eight production files at one directory level;
7. executable implementation logic in an `index.ts`;
8. a new catch-all directory without an explicit documented exception.

Use the TypeScript compiler API or another parser already available in the repository. Do not
introduce a dependency solely to parse imports unless the existing toolchain cannot do so safely.

The checker is exposed as:

```json
{
	"scripts": {
		"check:architecture": "node scripts/check-architecture.mjs"
	}
}
```

`npm run check:architecture` is included inside the existing `npm run check` chain.

The same issue must update `docs/workflow.md` so it continues to describe the actual canonical
quality gate. Do not create a second completion command or separate architecture-review ritual.

ESLint remains responsible for language-level import restrictions and the simulation/rendering
boundary. The architecture checker owns filesystem topology and subsystem-to-subsystem dependency
rules. Avoid implementing the same rule twice unless the duplication provides a clearly different
failure mode.

## Migration acceptance criteria

The source-topology issue is complete when:

- the stable top-level subsystems exist and every current simulation production file has an
  explicit home;
- `single-ball-run.ts` has been decomposed according to `modularity.md`;
- all unit tests have moved rather than been duplicated;
- public imports use subsystem entry points;
- dependency-direction and topology checks pass;
- `architecture.md`, `simulation.md`, `workflow.md` and ESLint paths describe the new layout;
- the existing repository quality gate passes;
- relevant browser tests pass because application import paths are affected;
- no physical behaviour, run contract or saved fixture meaning changed as part of the move.

Behavioural changes discovered during migration should become separate follow-up issues unless they
are necessary to preserve the existing contract.
