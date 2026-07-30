# Milestone 1 verification

This audit records the evidence that closes Milestone 1 without introducing Milestone 2 physics or
later execution infrastructure.

## Exit criteria

| Criterion                                         | Repository evidence                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One saved run feeds headless and browser playback | `fixtures/runs/canonical-synthetic-contact.json` is parsed and replayed by `run-fixture.spec.ts` and loaded directly by `src/routes/+page.svelte`.                                                                                                |
| Simulation remains headless                       | Simulation production files import only plain contracts. ESLint rejects Svelte, Three.js, rendering-module, DOM, worker and network dependencies in this module. Vitest runs the simulation in Node.                                              |
| Public contracts are serialisable                 | `contracts.ts` contains plain readonly data types, and `contracts.spec.ts` round-trips representative records through JSON.                                                                                                                       |
| Behavioural values are configured                 | Gravity, restitution, event and time limits, and named contact/event tolerances enter through `SimulationSettings`; the synthetic run derives its trajectory from them.                                                                           |
| Incomplete runs cannot enter ordinary playback    | Fixture loading preserves status. `assertPlaybackEligible` rejects `unresolved`, `iteration-limited` and `invalid` runs before frame evaluation or scene mounting, with regression coverage in both playback and fixture tests.                   |
| Rendering is presentation-only                    | Rendering consumes `RendererPlaybackInput`, evaluates recorded segments without mutating the run and owns only playback time and Three.js presentation resources. ESLint prevents production rendering from importing simulation implementations. |
| Repository health is comprehensive                | `npm run check` runs formatting, linting, Svelte/TypeScript checks, all Vitest tests and the production Vite build in sequence. Focused commands are documented in `docs/workflow.md`.                                                            |

## Scope audit

The repository contains no backend service, network transport, Web Worker, hosted CI workflow,
mandatory pull-request workflow, Rust or WebAssembly implementation. It also contains no partial
collision solver, friction, spin, rolling or resting-contact abstraction. The current synthetic
contact exists only to exercise the completed-run contract and playback path; real collision search
and response remain Milestone 2 work.

No follow-up issue was created during this audit because the build's bundle-size and adapter notices
do not affect the Milestone 1 architecture or local prototype workflow.
