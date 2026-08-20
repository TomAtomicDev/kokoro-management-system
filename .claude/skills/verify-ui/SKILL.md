---
name: verify-ui
description: Build and run this project's local dev server (Wrangler on :8787), log in with the dev password, and drive the UI with Playwright to verify a change actually works. Use before reporting any apps/web UI task as done, or whenever a change needs to be checked in a real browser against a real local backend.
allowed-tools: Bash(pnpm --filter @kokoro/web build) Bash(pnpm --filter @kokoro/worker dev*) Bash(pnpm --filter @kokoro/worker db:migrate:dev) Skill(playwright-cli)
---

# Verify a UI change in the local dev app

This is a runbook for actually exercising a UI change end-to-end — build the SPA, run it behind
the real Worker (API + assets on one origin), log in, and drive it with Playwright. Any coding
agent with shell + Node access can follow it; Claude Code additionally gets the `playwright-cli`
skill as the preferred automation path (see step 3).

## 1. Start the server

```bash
pnpm --filter @kokoro/web build
pnpm --filter @kokoro/worker dev
```

Run both, in that order, from the repo root. `wrangler dev` serves the built SPA (`apps/web/dist`)
and the `/api/*` routes on the **same origin**, `http://localhost:8787` — this is what makes
session cookies and the CSRF flow work. The Vite dev server alone (`pnpm --filter @kokoro/web dev`)
has no API proxy and will 404 on every `/api/*` call; don't use it for this.

**`wrangler dev` never exits — run it backgrounded, then poll for readiness before moving on.**
It's a long-running server process, not a one-shot command. If it's run as an ordinary blocking
shell call, the call just hangs until the shell tool's timeout — which looks identical to "the
browser step is stuck" even though the browser hasn't been touched yet. Start it in the
background, then poll the port instead of guessing a fixed sleep (first build/boot can take a
while, and a fixed sleep is either too short and racy or too long and wasteful):

```bash
pnpm --filter @kokoro/worker dev &   # or your tool's background-run mechanism
for i in $(seq 1 60); do
  curl -s -o /dev/null http://localhost:8787/ && break
  sleep 2
done
```

Only proceed to step 2 once that loop confirms the port is answering. Before starting a fresh
instance, check whether one is already running on :8787 (e.g. `curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/`) — a prior session's server left running is a normal way to skip
steps 1 and end up already ready.

If `apps/worker/.dev.vars` doesn't exist yet on this machine, copy
`apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` before starting — that's a plain copy
(exactly what the worker's own `pretest` script does automatically for `pnpm test`), not an edit
or regeneration of any value. See the guardrail in step 2 for what NOT to do with this file.

## 2. Dev login

- **Password:** the literal string `test-password-123`. It's already the password baked into
  `apps/worker/.dev.vars.example`'s `OWNER_PASSWORD_HASH` and is reused as `DEV_PASSWORD` across
  `apps/worker/test/*.test.ts` — this is a known-good, intentionally-committed dev credential, not
  something to look up or derive.
- **Endpoint:** `POST /api/auth/login` with JSON body `{ "password": "test-password-123" }`. A
  200 response sets the `kokoro_session` and `kokoro_csrf` session cookies the rest of the app
  needs.
- **Guardrail:** never read, edit, or regenerate anything in `.dev.vars` or any other secrets
  file, and never try to derive/hash a new password. If `test-password-123` doesn't log you in,
  **stop and report it** rather than trying to manufacture working credentials — a mismatch means
  someone changed the local `.dev.vars` on purpose or something else is broken, not that you're
  missing a step.

## 3. Drive the browser

In order of preference:

**(a) `playwright-cli` skill** (Claude Code) — if it's available, invoke it via the Skill tool by
name and drive the flow with its commands (`open`, `goto`, `fill --submit`, `snapshot`,
`screenshot`, ...). See that skill's own SKILL.md for the full command reference. `screenshot` and
`pdf` save to the current working directory by default — pass `--filename` pointing into
`.playwright-cli/screenshots/` so they don't litter the repo root, and sweep that directory (and
`.playwright-cli/page-*.yml` / `console-*.log`) once verification is done.

Run each `playwright-cli` command as its own standalone shell call, one per line — the same way
this file's and that skill's own examples do it. Wrapping it inside a subshell/pipe (e.g.
`time (playwright-cli open ... | tail)`, or chaining it with `&&`/`;` into one compound command)
has been observed to hang indefinitely on Windows even though the browser itself opens in 2-3s:
the command's own stdout pipe never signals EOF back to the wrapping shell. If a call ever does
seem to hang, don't keep waiting — run `playwright-cli list` from a separate call; the browser is
very likely already open, so recover by continuing (not by re-running `open`, which is safe to
retry but unnecessary) rather than waiting out a long timeout.

**(b) Fallback: a throwaway Playwright script** (any agent with Node + shell) — `@playwright/test`
is already an installed dependency. Launch Chromium, authenticate via a direct API request rather
than filling a login form (faster and avoids depending on form markup), then navigate normally:

```js
const { chromium, request } = require("@playwright/test");

const ctx = await request.newContext({ baseURL: "http://localhost:8787" });
const loginRes = await ctx.post("/api/auth/login", { data: { password: "test-password-123" } });
const cookies = await ctx.storageState();

const browser = await chromium.launch();
const page = await browser.newPage({ storageState: cookies });
await page.goto("http://localhost:8787/");
await page.screenshot({ path: "verify-ui.png" });
await browser.close();
```

Delete the throwaway script and any screenshots before finishing the task — or write them to a
gitignored temp path — so `git status` stays clean.

## 4. Known gotcha: "no such table" on a fresh local D1

The persistent local D1 file (`.wrangler/state`) does **not** auto-apply new migrations the way
the test suite's in-memory D1 does. A `500` with a "no such table" error means the local DB is
just behind, not that the code is broken. Fix it once from the repo root:

```bash
pnpm --filter @kokoro/worker db:migrate:dev
```

Then retry the request. Don't spend time debugging application code for this symptom before
ruling out a stale local DB.
