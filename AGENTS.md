# New document

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

---

## Testing

Use proportional testing.

During development:

* run only tests relevant to the modified area where practical.

Before completing an issue:

* run the repository quality gate.

Behavioural changes should include appropriate tests.

Previously discovered bugs should become regression fixtures whenever practical.

---

## Git Workflow

Agents may create commits autonomously.

Guidelines:

* commit small coherent units of work;
* WIP commits are encouraged during implementation;
* push after each commit unless explicitly instructed otherwise;
* use descriptive commit messages referencing the active Linear issue.

An issue should only be marked complete after:

* implementation;
* relevant testing;
* final push.

---

## Interruption Protocol

If an agent encounters:

* conflicting requirements;
* architectural uncertainty;
* missing information;
* potentially destructive decisions;

it should:

1. preserve progress;
2. commit work;
3. push it;
4. create or switch to an interrupted issue branch if appropriate;
5. clearly explain:
   * the problem;
   * work completed;
   * tests run;
   * recommended solution;
6. wait for user authorisation.

Do not guess architectural decisions simply to continue.

---

## Continuous Quality

Do not introduce hosted CI systems (for example GitHub Actions) unless explicitly requested.

Repository quality is verified locally through the repository quality-gate command.

---

## Pull Requests

Do not create pull requests unless explicitly requested.

---

## Documentation

When architectural decisions change:

* update repository documentation;
* keep AGENTS.md concise;
* place detailed rationale in project documentation rather than expanding AGENTS.md indefinitely.

---

## Default Behaviour

If multiple reasonable implementations exist:

1. choose the simplest;
2. minimise coupling;
3. preserve future flexibility;
4. document important decisions;
5. ask rather than assuming when uncertainty materially affects the architecture.