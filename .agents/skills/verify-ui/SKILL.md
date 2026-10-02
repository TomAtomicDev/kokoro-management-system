---
name: verify-ui
description: Build and run this project's local dev server (Wrangler on :8787), log in with the dev password, and verify the UI with Playwright MCP (preferred in OpenCode; CLI fallback). Use before reporting any apps/web UI task as done, or whenever a change needs to be checked in a real browser against a real local backend.
allowed-tools: Bash(pnpm --filter @kokoro/web build) Bash(pnpm --filter @kokoro/worker dev*) Bash(pnpm --filter @kokoro/worker db:migrate:dev) Skill(playwright-cli)
---

# Verify a UI change in the local dev app

This is a runbook for exercising a UI change end-to-end — build the SPA, run it behind the real
Worker (API + assets on one origin), log in, and drive it with Playwright. In OpenCode, use the
project's `playwright` MCP server as the primary browser automation path. Use the CLI only as a
fallback when the MCP tools are unavailable.

## 1. Start the server

```bash
pnpm --filter @kokoro/web build
pnpm --filter @kokoro/worker dev
```

Run both, in that order, from the repo root. `wrangler dev` serves the built SPA (`apps/web/dist`)
and the `/api/*` routes on the **same origin**, `http://localhost:8787` — this is what makes
session cookies and the CSRF flow work. The Vite dev server alone (`pnpm --filter @kokoro/web dev`)
has no API proxy and will 404 on every `/api/*` call; don't use it for this.

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

**Preferred: Playwright MCP in OpenCode.** The project config starts Microsoft's
`@playwright/mcp` server in headless, isolated mode. Use its tools (prefixed `playwright_` in
OpenCode) instead of invoking `playwright-cli` through the shell; this avoids the CLI process
hang reported in [OpenCode issue #36384](https://github.com/anomalyco/opencode/issues/36384).

1. Navigate to `http://localhost:8787/` with `playwright_browser_navigate`.
2. On that same origin, log in with `playwright_browser_evaluate`:

   ```js
   async () => {
     const response = await fetch("/api/auth/login", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       credentials: "include",
       body: JSON.stringify({ password: "test-password-123" }),
     });
     return { status: response.status, body: await response.text() };
   }
   ```

   Confirm a `200` response, then navigate to the app again and use
   `playwright_browser_snapshot` to inspect it. Interact with snapshot targets through
   `playwright_browser_click`, `playwright_browser_type`, or `playwright_browser_fill_form`;
   use `playwright_browser_take_screenshot` when a visual check is useful. Close the browser
   with `playwright_browser_close` when done.

**Fallback: `playwright-cli` skill.** If the MCP server is unavailable or the client does not
support MCP, invoke the `playwright-cli` skill and use its commands (`open`, `goto`, `snapshot`,
`screenshot`, ...). Avoid shelling out to the CLI in OpenCode when the MCP is available.

**Last fallback: a throwaway Playwright script** (any agent with Node + shell) — `@playwright/test`
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
