# Regression run fixtures

Save future reproducible simulation failures here as
`flame-<issue-number>-<short-description>.json`.

Each file contains one public `SimulationRunRecord` or compact `SimulationInputFixture` in the
current contract. See `docs/regression-fixtures.md` for the capture, validation and replay process.

- `flame-27-high-speed-peg-contact.json` verifies continuous fixed-peg contact discovery at a speed
  that would expose tunnelling in a sampled collision check.
- `flame-42-post-detachment-zero-time-loop.json` preserves the unresolved run that exposed a
  microscopic same-circle root after circular support loss; tests rerun its input without changing
  the forensic record.
- `flame-43-circular-turning-point.json` preserves the complete certified run whose circular
  contact reaches exact rest, reverses direction, and continues downhill to support loss.
- `flame-45-sub-tolerance-circle-release.json` preserves the full forensic run whose final
  diminishing bounce against `peg-row-01-column-04` never established tolerance-sized separation.
  The historical record reports a valid exit but independent validation rejects its later
  free-flight peg crossing with `EARLY_GEOMETRY_CROSSING`.
- `flame-46-exact-fit-tangent-release.json` preserves the dense-board input whose exact-width throat
  must acquire both alternating peg contacts and release downward.
- `flame-46-oversized-two-peg-rest.json` preserves the paired dense-board input whose wider ball must
  acquire both peg contacts and settle on their certified support manifold.
