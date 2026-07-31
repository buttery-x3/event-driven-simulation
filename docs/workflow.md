# Repository quality workflow

The authoritative repository-health command is:

```sh
npm run check
```

Run it before completing an issue. The command executes formatting verification, linting, type
checking, unit tests and a production build in sequence. The commands are joined so that a failure
in any stage stops the gate and produces a non-zero exit code.

Browser-facing behavioral changes must also run the relevant browser tests before review. Pure
headless simulation changes do not require browser tests unless they affect the replay contract or
rendered behavior. The fixed ports, exact commands, server ownership rules and conflict-handling
workflow are defined in [`docs/browser-testing.md`](browser-testing.md).

Formatting covers tracked source, configuration, documentation and JSON fixtures; generated output
and the npm-generated lockfile are excluded. ESLint checks the JavaScript, TypeScript and Svelte
source tree and enforces the simulation-renderer dependency direction described in
`docs/architecture.md`. Vitest runs in Node so headless simulation and fixture tests do not acquire
browser globals accidentally. The final Vite build verifies the browser entry point and production
bundle.

Install dependencies once with `npm install`. During implementation, use the smallest relevant
focused command:

| Command                   | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| `npm run dev`             | Start the fixed-port development server.       |
| `npm run format`          | Apply Prettier formatting.                     |
| `npm run format:check`    | Verify formatting without changing files.      |
| `npm run lint`            | Run ESLint.                                    |
| `npm run typecheck`       | Run Svelte and TypeScript checks.              |
| `npm run typecheck:watch` | Keep type checking active during development.  |
| `npm run test`            | Run the unit test suite once.                  |
| `npm run test:watch`      | Run unit tests in watch mode.                  |
| `npm run test:browser`    | Run canonical headless Chromium browser tests. |
| `npm run build`           | Create a production build.                     |
| `npm run preview`         | Start the fixed-port production preview.       |

Vitest accepts a path after `--` for a focused run. For example, use
`npm run test -- src/lib/simulation/run-fixture.spec.ts` while changing saved-run validation, then
return to `npm run check` before review.

The simulation contracts live under `src/lib/simulation` and contain only serialisable,
renderer-independent data. Three.js integration lives under `src/lib/rendering`; it consumes those
plain inputs and owns only presentation resources. See `docs/architecture.md` for the contract
responsibilities and dependency boundary.

Saved run naming, validation and the process for turning a reproducible failure into a regression
case are documented in `docs/regression-fixtures.md`.
