# Regression run fixtures

Save future reproducible simulation failures here as
`flame-<issue-number>-<short-description>.json`.

Each file must contain one complete `SimulationRunRecord` in the current public contract. See
`docs/regression-fixtures.md` for the capture, validation and replay process.

- `flame-27-high-speed-peg-contact.json` verifies continuous fixed-peg contact discovery at a speed
  that would expose tunnelling in a sampled collision check.
- `flame-42-post-detachment-zero-time-loop.json` preserves the unresolved run that exposed a
  microscopic same-circle root after circular support loss; tests rerun its input without changing
  the forensic record.
- `flame-43-circular-turning-point.json` preserves the complete certified run whose circular
  contact reaches exact rest, reverses direction, and continues downhill to support loss.
