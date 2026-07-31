# Browser testing and local servers

This document is the authoritative workflow for browser testing and local browser automation in this
repository. Use the fixed commands and ports below; do not invent an alternate server lifecycle or
silently select another port.

## Reserved ports

| Purpose                        | Address                 | Command                |
| ------------------------------ | ----------------------- | ---------------------- |
| Development server             | `http://127.0.0.1:8437` | `npm run dev`          |
| Manual production preview      | `http://127.0.0.1:8438` | `npm run preview`      |
| Automated browser-test preview | `http://127.0.0.1:8439` | `npm run test:browser` |

All three servers use Vite's strict-port behavior. A port conflict is an intentional hard failure.
Do not bypass it by changing the port or enabling fallback behavior.

## Commands and ownership

Install dependencies with `npm install`. On a machine that does not yet have Playwright's Chromium
binary, install it once with:

```sh
npm run test:browser:install
```

Use these commands for local servers and browser verification:

```sh
npm run dev
npm run preview
npm run test:browser
npm run test:browser:headed
npm run test:browser:ui
```

`npm run dev` owns a development server until the operator stops it. `npm run preview` owns a manual
production-preview server and expects a prior `npm run build`.

Each browser-test command owns its complete automated lifecycle. Playwright builds the application,
starts a production preview on `127.0.0.1:8439`, waits until it is ready, runs Chromium, and stops the
server it started. Do not start a development or preview server first. Playwright is configured with
`reuseExistingServer: false`, so it refuses to attach to any process already listening on the
browser-test port.

## Choosing a browser-test mode

- Run `npm run test:browser` for the canonical repeatable headless verification and before review.
- Run `npm run test:browser:headed` when a failure needs diagnosis in a visible Chromium window.
- Run `npm run test:browser:ui` for interactive step-through, DOM snapshots, filtering and repeated
  local diagnosis.

Headed and UI runs are diagnostic aids. A successful diagnostic run does not replace the canonical
headless run.

## Port conflicts

On Windows, identify the listener without changing it:

```powershell
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8437,8438,8439 -State Listen
Get-Process -Id <OwningProcess>
```

Use the first command's `OwningProcess` value in the second command. On macOS or Linux, inspect a
specific port with:

```sh
lsof -nP -iTCP:8439 -sTCP:LISTEN
```

An agent may terminate a listener only after establishing that the current task started that exact
process. If ownership is unknown or external, leave the process running, report its port, process ID
and any identifiable command, and ask the owner to resolve the conflict. Never kill an unknown
process merely to make a test pass.

## When browser verification is required

Run the relevant browser tests for browser-facing behavioral changes. Pure headless simulation
changes do not require browser tests unless they change the replay contract or rendered behavior.
`npm run check` remains the authoritative gate for formatting, linting, type checking, unit tests
and the production build; required browser tests are additional to that gate.

Before review, report:

- the exact browser-test command run;
- whether it passed, failed or was blocked;
- the tested Playwright project/browser;
- the number of passed, failed and skipped tests;
- any retained trace or other failure-artifact location;
- confirmation that the test server stopped, or details of any listener left behind.

## Cleanup after failures or interruption

Playwright normally stops its owned server after a passed or failed run. After an interrupted run,
check port `8439` using the commands above. Terminate a remaining listener only if its process
identity proves that the interrupted task started it. Report an unknown listener instead of killing
it. Playwright's generated `test-results` and `playwright-report` directories are ignored and may be
removed after their diagnostic value is exhausted.
