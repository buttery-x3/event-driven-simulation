# Repository quality workflow

The authoritative repository-health command is:

```sh
npm run check
```

Run it before completing an issue. The command executes formatting verification, linting, type
checking, unit tests and a production build in sequence. The commands are joined so that a failure
in any stage stops the gate and produces a non-zero exit code.

Install dependencies once with `npm install`. During implementation, use the smallest relevant
focused command:

| Command                   | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `npm run dev`             | Start the local SvelteKit development server.     |
| `npm run format`          | Apply Prettier formatting.                        |
| `npm run format:check`    | Verify formatting without changing files.         |
| `npm run lint`            | Run ESLint.                                       |
| `npm run typecheck`       | Run Svelte and TypeScript checks.                 |
| `npm run typecheck:watch` | Keep type checking active during development.     |
| `npm run test`            | Run the unit test suite once.                     |
| `npm run test:watch`      | Run unit tests in watch mode.                     |
| `npm run build`           | Create a production build.                        |
| `npm run preview`         | Preview the most recent production build locally. |

The simulation contract lives under `src/lib/simulation` and contains only serialisable,
renderer-independent data. Three.js integration lives under `src/lib/rendering`; it consumes a
simulation snapshot and owns only presentation resources.
