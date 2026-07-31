# AGENTS.md

## Purpose

This repository is developed primarily by AI-assisted implementation agents.

The goal of these instructions is to ensure agents work safely, consistently and predictably while remaining lightweight. Prefer simple, incremental improvements over speculative architecture.

---

## Core Principles

* Keep It Simple, Stupid (KISS).
* Build only what is required for the current issue.
* Design modules so future capabilities have natural places to live.
* Do not implement speculative systems or empty abstractions.
* Preserve clear separation of responsibilities.

---

## Repository Architecture

Respect the repository's module boundaries.

In particular:

* simulation code must remain independent of rendering;
* rendering must never become the source of simulation truth;
* public contracts should remain serialisable and renderer-independent.

When unsure where functionality belongs, stop and ask rather than introducing coupling.

---

## Documentation

`AGENTS.md` defines repository operating rules for implementation agents.

Agents must not modify `AGENTS.md` unless explicitly instructed by the repository owner.

Project-specific architecture, implementation decisions, workflows and technical guidance belong in repository documentation under `/docs`, not in `AGENTS.md`.

Typical documentation includes (as required):

```text
/docs/
    architecture.md
    simulation.md
    testing.md
    workflow.md
    deployment.md
    ...
```

When implementation changes require documentation updates:

* update or create the appropriate document under `/docs`;
* keep `AGENTS.md` stable;
* only change `AGENTS.md` when the repository owner explicitly requests a change to agent operating rules.

## Implementation

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

Agents should prefer finishing one Linear issue completely before beginning another. If work uncovers a separate concern, document it as a follow-up rather than expanding the current issue unless the dependency is unavoidable and approved per the interruption protocol below.

---

## Testing

Use proportional testing.

During development:

* run only tests relevant to the modified area where practical.

Before requesting human review:

* run the repository quality gate with `npm run check`.

Behavioural changes should include appropriate tests.

Previously discovered bugs should become regression fixtures whenever practical.

For all browser testing and local browser automation, follow `docs/browser-testing.md`. Do not invent alternate ports or server-lifecycle workflows unless the active issue explicitly requires it.

---

## Git Workflow

Use a dedicated branch for each Linear issue unless explicitly instructed otherwise.

Agents may create commits and push autonomously.

During implementation:

* make small, coherent commits;
* use WIP commits for incomplete but meaningful progress;
* reference the active Linear issue in branch and commit names;
* push each commit so remote state remains current and recoverable.

Completed implementation must remain on the issue branch until the repository owner reviews and approves it.

Before requesting human review:

1. run all relevant focused tests;
2. run the full repository quality gate;
3. confirm the issue acceptance criteria are satisfied;
4. push the completed issue branch;
5. mark the Linear issue as `In Review`;
6. present the completed work, test results and any relevant review notes to the user;
7. explicitly request approval to integrate the issue branch into `main`, or request direction on further changes.

While an issue is in review:

* do not merge or fast-forward the issue branch into `main`;
* do not delete the local or remote issue branch;
* do not mark the Linear issue complete;
* apply requested changes on the same issue branch unless the user directs otherwise;
* rerun relevant checks and return the issue to the user for review after further changes.

After the repository owner explicitly approves the completed work:

1. confirm the issue branch is current with `origin/main`;
2. if `main` has advanced, rebase the issue branch onto the current `origin/main` and rerun the required checks;
3. fast-forward the completed issue branch into `main`;
4. push the updated `main` branch;
5. delete the completed local and remote issue branch where appropriate;
6. mark the Linear issue complete.

Human approval is required for each issue before integration into `main` and before marking the corresponding Linear issue complete. Approval of a plan, specification or earlier issue does not count as approval of the current implementation.

Prefer a fast-forward integration into `main`.

Never force-push `main`.

Force-pushing with `--force-with-lease` is permitted only for an agent-owned temporary issue branch after a deliberate rebase.

## Pull Requests

Pull requests are optional review tools, not the default integration mechanism.

Do not create a pull request unless:

* the user explicitly requests one;
* branch protection requires one;
* the change warrants a deliberate review before integration;
* or the agent cannot safely integrate the branch directly.

Human review and approval are still required before integration even when no pull request is used.

## Interruption Protocol

If conflicting requirements, architectural uncertainty, missing information, a non-trivial merge conflict, or a potentially destructive decision prevents safe completion:

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

Do not introduce hosted CI systems (for example GitHub Actions) or other CI solutions.

Repository quality is verified locally through the repository quality-gate command.

---

## Documentation

When architectural decisions change:

* update repository documentation;
* place detailed rationale in project documentation rather than expanding AGENTS.md indefinitely.

---

## Default Behaviour

If multiple reasonable implementations exist:

1. choose the simplest;
2. minimise coupling;
3. preserve future flexibility;
4. document important decisions;
5. ask rather than assuming when uncertainty materially affects the architecture.
6. do not modify repository agent instructions unless explicitly authorised.
