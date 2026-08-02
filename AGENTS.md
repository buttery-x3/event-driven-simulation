# AGENTS.md

## Purpose

This repository is developed primarily by AI-assisted implementation agents.

The goal of these instructions is to ensure agents work safely, consistently and predictably while
remaining lightweight. Prefer simple, incremental improvements over speculative architecture.

---

## Core Principles

* Keep It Simple, Stupid (KISS): choose the simplest implementation that preserves coherent
  ownership, not merely the smallest diff.
* Build only what is required for the current issue.
* Design modules so future capabilities have natural places to live.
* Do not implement speculative systems or empty abstractions.
* Preserve clear separation of responsibilities.

---

## Repository Architecture

Respect the repository's documented module and dependency boundaries.

When unsure where functionality belongs, stop and ask rather than introducing coupling.

Detailed project architecture, subsystem responsibilities and dependency direction belong in
`docs/architecture.md`.

The documented internal source tree is a current architectural map, not an exhaustive frozen list.
When concrete responsibility pressure shows that the map is stale, agents must introduce and
document a clearer internal boundary in the active issue rather than forcing work into the old
topology.

---

## Documentation

`AGENTS.md` defines repository operating rules for implementation agents.

Agents must not modify `AGENTS.md` unless explicitly instructed by the repository owner.

Project-specific architecture, source layout, implementation decisions, workflows and technical
guidance belong under `/docs`, not in `AGENTS.md`.

When implementation changes require documentation updates:

* update or create the appropriate document under `/docs`;
* keep `AGENTS.md` stable;
* do not duplicate a rule across several documents;
* preserve one clearly identified authoritative home for each process or architectural decision;
* only change `AGENTS.md` when the repository owner explicitly requests a change to agent operating
  rules.

---

## Implementation

Before editing production code for a non-trivial implementation, publish a concise architectural
disposition in the implementation update. It must identify:

1. affected public entry points, implementation modules, tests and local architecture documents;
2. every responsibility introduced or materially changed;
3. whether the change has no architectural impact, extends one existing responsibility,
   introduces a new internal module, introduces a named subdomain or public boundary, or requires a
   repository-rule or dependency-direction change;
4. whether the current ownership structure can absorb the work coherently;
5. credible near-term pressure from active planned work, multiple consumers, a new state machine or
   domain concept, repeated growth, or independently changing policies;
6. the proposed ownership split and public API to preserve; and
7. affected file, function, directory-capacity, import-boundary and entry-point rules.

Selecting "no architectural impact" still requires a one-sentence justification. Keep the
disposition proportional; it is an implementation prerequisite, not a standalone design document
or a reason to require a separate architecture-review agent.

Agents may:

* create new modules;
* refactor existing code;
* reorganise files when it improves clarity;
* introduce configuration for behavioural values;
* improve tests alongside implementation.

Agents should avoid:

* placeholder implementations;
* unused interfaces;
* dead code;
* unnecessary dependencies;
* large unrelated refactors.

Agents should prefer finishing one Linear issue completely before beginning another. If work
uncovers a separate concern, document it as a follow-up rather than expanding the current issue
unless the dependency is unavoidable and approved per the interruption protocol below.

---

## Modularity

Keep production modules cohesive, bounded and independently understandable.

Before adding functionality to an existing production file, inspect the responsibilities it already
owns. Follow the decomposition triggers, size policy and review requirements in
`docs/modularity.md`.

A decomposition check is required when a proposed change:

* adds a new category of responsibility;
* materially enlarges an already substantial file or function;
* mixes orchestration with an independently testable algorithm, policy, validator, serializer or
  diagnostic builder; or
* extends a file already identified by the documented size or responsibility thresholds.

When a decomposition check is triggered:

1. identify the file's current responsibilities;
2. identify the responsibility introduced by the requested change;
3. choose the smallest stable ownership boundary with reasonable headroom that preserves behaviour
   and public contracts;
4. perform that extraction before or alongside the feature work.

Do not continue growing an oversized or multi-responsibility file merely because new helpers are
used by only one caller.

Thresholds are smoke alarms. Remaining below a hard limit is never sufficient modularity
justification, and a threshold failure requires reassessing ownership rather than raising the limit
or shaving lines until the file barely passes. If file or function limits are encountered more than
once, stop line-budget refactoring and restate the ownership plan before continuing.

Assess a named subdomain before a directory reaches saturation when it contains six of eight
implementation-file slots, when three or more implementation files serve one new state machine or
domain concept, or when lifecycle, result or transition construction is duplicated across domain
modules. Any threshold increase or exception requires repository-owner approval and documented
justification.

Do not satisfy modularity rules by creating arbitrary fragments, thin forwarding wrappers or
catch-all helper modules. Prefer a few substantial, well-named modules with explicit ownership.

Bug fixes may make the smallest safe change to an oversized file, but new independent behaviour
must not be added without the required decomposition.

---

## Source Organisation

Treat source layout as part of the architecture rather than as cosmetic file placement.

Before creating or moving a production file, follow `docs/source-structure.md` and confirm:

1. which documented subsystem owns the behaviour;
2. why that subsystem is the file's primary reason to change;
3. which public entry point exposes the behaviour, if any;
4. whether every new dependency follows the documented dependency direction.

Every production file must belong to a documented subsystem. Do not create new top-level source
groups, deep-import across subsystem boundaries, or introduce catch-all directories such as
`helpers`, `utils`, `common`, `shared` or `misc` unless the repository owner explicitly approves and
documents a narrowly defined responsibility.

Cross-subsystem consumers must use documented public entry points. Implementation files may use
private sibling modules only within their own subsystem.

An agent may and must introduce a clearly named internal subdomain, then update topology
documentation and checking in the same issue, when current responsibilities, active near-term work,
multiple consumers, repeated threshold pressure or a new state machine/domain concept provide
concrete evidence. Speculative empty layers remain forbidden.

Tests must follow the repository's documented local placement convention so production topology
remains readable when test folders are collapsed.

Where mechanical source-structure checks exist, they are part of the repository quality gate and
must not be bypassed with broad exclusions.

---

## Testing

Use proportional testing.

During development:

* run only tests relevant to the modified area where practical.

Before requesting human review:

* run the repository quality gate with `npm run check`.

Behavioural changes should include appropriate tests.

Previously discovered bugs should become regression fixtures whenever practical.

For all browser testing and local browser automation, follow `docs/browser-testing.md`. Do not
invent alternate ports or server-lifecycle workflows unless the active issue explicitly requires
it.

---

## Git Workflow

Use a dedicated branch for each Linear issue unless explicitly instructed otherwise.

Agents may create commits and push autonomously.

During implementation:

* make small, coherent commits;
* use WIP commits for incomplete but meaningful progress;
* reference the active Linear issue in branch and commit names;
* push each commit so remote state remains current and recoverable.

Completed implementation must remain on the issue branch until the repository owner reviews and
approves it.

Before requesting human review:

1. run all relevant focused tests;
2. run the full repository quality gate;
3. confirm the issue acceptance criteria are satisfied;
4. push the completed issue branch;
5. mark the Linear issue as `In Review`;
6. present the completed work, test results and any relevant review notes to the user;
7. explicitly request approval to integrate the issue branch into `main`, or request direction on
   further changes.

The completion report for every non-trivial implementation must include a compact
structural-pressure report covering:

* responsibilities added or changed and the module or subdomain owning each;
* boundaries or public entry points added, removed or changed;
* threshold, dependency-rule and documented-topology changes, or an explicit statement that none
  were required;
* remaining structural pressure and likely future split points supported by concrete evidence; and
* headroom concerns for every modified or newly created production file above 350 effective lines,
  including an explicit one-primary-reason-to-change justification for a newly created file.

This is implementation evidence, not permission for speculative architecture work.

While an issue is in review:

* do not merge or fast-forward the issue branch into `main`;
* do not delete the local or remote issue branch;
* do not mark the Linear issue complete;
* apply requested changes on the same issue branch unless the user directs otherwise;
* rerun relevant checks and return the issue to the user for review after further changes.

After the repository owner explicitly approves the completed work:

1. confirm the issue branch is current with `origin/main`;
2. if `main` has advanced, rebase the issue branch onto the current `origin/main` and rerun the
   required checks;
3. fast-forward the completed issue branch into `main`;
4. push the updated `main` branch;
5. delete the completed local and remote issue branch where appropriate;
6. mark the Linear issue complete.

Human approval is required for each issue before integration into `main` and before marking the
corresponding Linear issue complete. Approval of a plan, specification or earlier issue does not
count as approval of the current implementation.

Prefer a fast-forward integration into `main`.

Never force-push `main`.

Force-pushing with `--force-with-lease` is permitted only for an agent-owned temporary issue branch
after a deliberate rebase.

---

## Pull Requests

Pull requests are optional review tools, not the default integration mechanism.

Do not create a pull request unless:

* the user explicitly requests one;
* branch protection requires one;
* the change warrants a deliberate review before integration;
* or the agent cannot safely integrate the branch directly.

Human review and approval are still required before integration even when no pull request is used.

---

## Interruption Protocol

If conflicting requirements, architectural uncertainty, missing information, a non-trivial merge
conflict, or a potentially destructive decision prevents safe completion:

1. stop at the last coherent state;
2. preserve and commit the current work;
3. push it to an issue branch marked as interrupted;
4. do not merge it into `main`;
5. record which tests were and were not run;
6. explain the conflict and recommend a solution;
7. request user authorisation before continuing.

Interrupted work must never be presented or marked as complete.

---

## Continuous Quality

Do not introduce hosted CI systems, for example GitHub Actions, or other CI solutions.

Repository quality is verified locally through the repository quality-gate command documented in
`docs/workflow.md`.

---

## Default Behaviour

If multiple reasonable implementations exist:

1. choose the simplest;
2. minimise coupling;
3. preserve future flexibility;
4. document important decisions;
5. ask rather than assuming when uncertainty materially affects the architecture;
6. do not modify repository agent instructions unless explicitly authorised.
