# Regression run fixtures

Save future reproducible simulation failures here as
`flame-<issue-number>-<short-description>.json`.

Each file must contain one complete `SimulationRunRecord` in the current public contract. See
`docs/regression-fixtures.md` for the capture, validation and replay process.

- `flame-27-high-speed-peg-contact.json` verifies continuous fixed-peg contact discovery at a speed
  that would expose tunnelling in a sampled collision check.
