# Saved run and regression fixtures

Saved runs use the public `SimulationRunRecord` contract as plain JSON. They contain no Svelte,
Three.js, DOM or other renderer-owned objects.

## Locations and names

- `fixtures/runs/<descriptive-name>.json` contains shared canonical examples. The browser prototype
  and headless tests both load `canonical-synthetic-contact.json` from this directory.
- `fixtures/regressions/flame-<issue-number>-<short-description>.json` contains runs captured from
  reproducible failures. Use lowercase kebab-case, for example
  `flame-123-high-speed-peg-contact.json`.

Keep one run record per file. Do not create renderer-specific copies.

## Capturing a regression

1. Reduce the failure to the smallest simulation input that still reproduces it.
2. Save the simulator's exact `SimulationRunRecord`, including its input, terminal status, valid
   trajectory prefix, events and diagnostics. Do not change an unresolved or invalid status to
   `complete`.
3. Add the JSON file under `fixtures/regressions/` using the issue-based naming convention.
4. Load it with `parseSimulationRunFixture`. This rejects malformed JSON, unsupported contract
   versions and fields that do not match the public contract with a typed `RunFixtureError`.
5. Add a focused headless test that reproduces the failure or asserts the corrected result.
   Completed fixtures may pass through `toRendererPlaybackInput` and ordinary replay. Incomplete
   fixtures must continue to be rejected by `assertPlaybackEligible`; tests may inspect their
   preserved valid prefix and diagnostics directly.
6. Run the focused test, then run `npm run check` before requesting review.

There is deliberately no migration framework. If `contractVersion` changes, decide how to update
or retain affected fixtures as part of that contract change.

FLAME-26 advanced the contract to version 3 so saved records include the board coordinate system,
line-segment boundaries and termination regions. The pre-release canonical fixture was updated in
place; earlier data is intentionally rejected rather than guessed or migrated.
