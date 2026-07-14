# Deployment Guide

How Kokoro Management gets from a `git push` to a running Cloudflare Worker, what infrastructure
already exists, and how to operate it. This is an operational runbook, not a spec — for business
rules and architecture decisions, see the
[System Design Knowledge Base](system-design-knowledge-base/README.md); this document assumes
you've read `.github/workflows/README.md` (the shorter pipeline reference) and expands on it.

## 1. Architecture at a glance

One Cloudflare Worker per environment, each with its own D1 database and R2 bucket. No shared
infrastructure between environments — a bug in staging cannot touch prod data.

| Environment | Worker name | D1 database | R2 bucket | URL |
|---|---|---|---|---|
| dev | `kokoro-dev` | `kokoro-dev` | `kokoro-dev` | local only (`wrangler dev`) |
| staging | `kokoro-staging` | `kokoro-staging` | `kokoro-staging` | `https://kokoro-staging.tomatomic.workers.dev` |
| prod | `kokoro` | `kokoro-prod` | `kokoro-prod` | `https://kokoro.tomatomic.workers.dev` (once deployed) |

The Cloudflare account's `workers.dev` subdomain is `tomatomic` — every Worker gets
`<worker-name>.tomatomic.workers.dev` for free, no custom domain required yet.

## 2. Cloudflare resources already provisioned

These were created once, manually, during KOK-005/KOK-009 (Phase 0). You will not need to
recreate them — this section exists so you know what's out there and why.

**D1 databases** (`wrangler d1 create <name>`):

| Database | id |
|---|---|
| `kokoro-dev` | `245c738d-c408-4372-8d20-ade56bcb468b` |
| `kokoro-staging` | `3fb59c2f-4fa0-46eb-81ed-04cf87cf3a3b` |
| `kokoro-prod` | `725f51d1-d2ae-41e0-95dd-64917d575f49` |

These ids are already wired into `apps/worker/wrangler.toml`'s `[[d1_databases]]` /
`[[env.<name>.d1_databases]]` blocks — you never need to type them again.

**R2 buckets** (`wrangler r2 bucket create <name>`): `kokoro-dev`, `kokoro-staging`,
`kokoro-prod` — one per environment, same naming convention as D1. R2 had to be enabled once on
the Cloudflare account (Dashboard → R2 → "Enable R2") before any bucket could be created; that's
already done.

**Migration 0001** (the full schema, KOK-005) has been applied to `kokoro-dev` (local) and
`kokoro-staging` (remote). It has **not** been applied to `kokoro-prod` yet — that happens
automatically the first time `deploy.yml`'s `deploy-prod` job runs (see §4).

**`kokoro-staging` has been deployed and smoke-tested live** (KOK-009) — it currently runs with
placeholder secrets (see §5) so the pipeline mechanism could be proven end-to-end before real
credentials exist. `kokoro` (prod) has never been deployed.

## 3. GitHub configuration already in place

**Repository secrets** (Settings → Secrets and variables → Actions → Repository secrets),
visible to every job in every workflow regardless of which GitHub Environment that job declares:

- `CLOUDFLARE_API_TOKEN` — used by every `wrangler` command in CI (deploy, migrations apply).
- `CLOUDFLARE_ACCOUNT_ID` — lets `wrangler` skip an account-discovery API call that a
  narrowly-scoped token often can't make.

Both were set by you directly (not by the pipeline) and are account-wide — the same pair is
reused for staging and prod, which is intentional (see §6.1 for why a single token is fine here).

**GitHub Environments** (Settings → Environments):

- `staging` — no protection rules. `deploy.yml`'s `deploy-staging` job runs automatically on
  every push to `main`.
- `production` — has **TomAtomicDev** configured as a required reviewer. `deploy.yml`'s
  `deploy-prod` job pauses here; nothing reaches prod until you click "Review deployments" →
  "Approve and deploy" on that workflow run in the GitHub UI.

Neither environment currently has its own environment-scoped secrets — everything comes from the
repository-level pair above.

## 4. The pipeline, step by step

Two workflows, both in `.github/workflows/`:

**`ci.yml`** — push to any branch except `main`, or any PR: install → lint → typecheck → build
SPA → test. Never deploys anything. This is what you see on every commit while developing.

**`deploy.yml`** — push to `main` only:

```
check (lint/typecheck/build/test)
        │
        ▼
deploy-staging (migrate kokoro-staging → deploy kokoro-staging Worker)
        │
        ▼
smoke-staging (Playwright: SPA loads, /api/health ok, 401 without session,
               login works if STAGING_OWNER_PASSWORD secret is set)
        │
        ▼
deploy-prod  ◄── PAUSED: waiting for your approval in GitHub's UI
        │        (production environment's required reviewer gate)
        ▼
   migrate kokoro-prod → deploy kokoro Worker
```

Migrations always run immediately before the Worker deploy in the *same* job, so a failed
migration never leaves a deployed Worker pointed at a schema it doesn't expect (expand → migrate
→ contract, Doc 02 §9).

**To trigger it:** merge/push to `main`. Nothing has been pushed to `main` yet as of this
writing — everything so far lives on `develop`. The first real run of `deploy.yml` is still
ahead of you.

## 5. Cloudflare Worker secrets — what they are, and how to set real ones

`wrangler secret put` secrets are **per-Worker, per-environment** — separate from the GitHub
Actions secrets in §3, and separate from local `.dev.vars`. Setting a secret on `kokoro-staging`
does not affect `kokoro-dev` or `kokoro` (prod); you set each environment independently.

| Secret | What it's for | Currently on staging |
|---|---|---|
| `SESSION_SECRET` | HMAC signing key for the login session cookie. Anyone with this value can forge a valid session and log in as you without knowing the password. | placeholder random value |
| `OWNER_PASSWORD_HASH` | PBKDF2 hash of your login password (never the plaintext itself). | hash of a temporary test password — replace via §5.1 |
| `TELEGRAM_BOT_TOKEN` | Auth token for the Telegram bot (from @BotFather). Not read by any code yet — wired up in Phase 4 (KOK-038). | obvious placeholder string |
| `TELEGRAM_WEBHOOK_SECRET` | Random string Telegram echoes back so the Worker can verify a webhook call really came from Telegram. Phase 4. | obvious placeholder string |
| `OPENAI_API_KEY` | OpenAI API key for the AI assistant (captures, chat). Phase 4. | obvious placeholder string |
| `OWNER_TELEGRAM_CHAT_ID` | Your Telegram chat id — the allowlist of exactly one person the bot will talk to. Phase 4. | `0` |

Only `SESSION_SECRET` and `OWNER_PASSWORD_HASH` are exercised by any code that exists right now
(KOK-007, owner auth). The other four exist because the full secret set was scaffolded up front;
they'll matter once Phase 4 lands.

### 5.1 Setting `OWNER_PASSWORD_HASH` for real

1. Pick a real password. This is the password you'll type to log into the web app.
2. Generate its hash:
   ```bash
   node apps/worker/scripts/hash-password.mjs "your-real-password"
   ```
   This prints a string like `pbkdf2-sha256$100000$<salt>$<hash>`. That whole string is the
   secret value — not your password itself.
3. Set it on the environment you want:
   ```bash
   cd apps/worker
   echo 'pbkdf2-sha256$100000$...$...' | pnpm exec wrangler secret put OWNER_PASSWORD_HASH --env staging
   # or --env prod
   ```
   **Use single quotes, not double quotes**, around the hash — it contains `$` characters, and
   bash treats `$1`, `$0`, etc. inside double quotes as positional-parameter expansions. This
   silently corrupts the value (try it: `echo "a$100000$b"` prints `a00000b`, not what you typed)
   instead of erroring, so it's easy to set a broken secret without noticing. Single quotes
   disable all expansion and paste the hash through byte-for-byte.

   (`echo | wrangler secret put` avoids the value ever landing in your shell history via `-x`
   tracing or a command-line arg — `wrangler secret put` reads the value from stdin.)
4. Repeat with `--env prod` using the same or a different password — staging and prod passwords
   don't have to match.

You do **not** need `CLOUDFLARE_ACCOUNT_ID` exported for this if you're already logged in via
`wrangler login`; if you're using an API token instead (like this project's CI does), export it
first: `export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...`.

### 5.2 Setting `SESSION_SECRET` for real

Any long random string works — it's an HMAC key, not something you need to remember.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```bash
cd apps/worker
echo '<the random string>' | pnpm exec wrangler secret put SESSION_SECRET --env staging
```

**Changing `SESSION_SECRET` invalidates every existing session** (everyone gets logged out) —
that's expected and harmless for a single-owner app, but worth knowing before you rotate it on a
whim.

### 5.3 The other four (Telegram, OpenAI)

Not urgent — nothing reads them yet. When you get to Phase 4 (KOK-038+), set them the same way:

```bash
echo '<real telegram bot token>' | pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN --env staging
echo '<real telegram webhook secret you make up>' | pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
echo '<real openai api key>' | pnpm exec wrangler secret put OPENAI_API_KEY --env staging
echo '<your telegram numeric chat id>' | pnpm exec wrangler secret put OWNER_TELEGRAM_CHAT_ID --env staging
```

Repeat with `--env prod`. Use **separate** Telegram bot tokens for staging and prod (Doc 02 §5) —
create two bots via @BotFather — so testing on staging never sends real messages through your
production bot.

### 5.4 Verifying what's set (without seeing the values)

Cloudflare never lets you read a secret's value back — only list which names exist:

```bash
pnpm exec wrangler secret list --env staging
pnpm exec wrangler secret list --env prod
```

If you need to confirm a secret has the *right* value (not just that it exists), the only way is
behavioral: try logging in and see if it works.

### 5.5 Local dev is separate from all of this

`apps/worker/.dev.vars` (gitignored) is what `wrangler dev` and the test suite read locally —
it's not connected to staging/prod secrets at all. See `apps/worker/.dev.vars.example` for the
template. Nothing in this section touches that file.

## 6. Lessons from the first real deploy (KOK-009)

Kept here because the reasoning is worth having on hand, not just the fact that it happened.

### 6.1 Why one Cloudflare API token for every environment

The token you created isn't scoped to a single Worker or database — Cloudflare API tokens are
account-wide (or scoped to broad permission groups like "D1 Edit", "Workers Scripts Edit"), not
resource-specific. Since `deploy-staging` and `deploy-prod` both just need "permission to deploy
a Worker and run D1 migrations," reusing the same repository-level `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` secrets for both is correct and simpler than trying to mint
narrower-but-nonexistent per-environment tokens. The blast radius of a leaked token is already
"the whole Cloudflare account" regardless of how many GitHub secrets you split it into.

### 6.2 One-time account setup that isn't automatable

Two things needed a human in the Cloudflare Dashboard before `wrangler` could do anything, and
no API/CLI path exists around them:

- **Enabling R2** — a Terms-of-Service style acceptance click, not an API call.
- **Registering a `workers.dev` subdomain** — a one-time account-level choice of subdomain name
  (`tomatomic`, in this case); every Worker you ever deploy without a custom domain hangs off it.

Both are now done; nobody needs to touch them again.

### 6.3 The PBKDF2 iteration-count bug

The single most important thing this deployment surfaced: **local tests passing does not mean
the code works on Cloudflare's real runtime.** `apps/worker/src/auth/password.ts` originally used
600,000 PBKDF2 iterations. All 47 tests passed locally (Miniflare, the simulator
`@cloudflare/vitest-pool-workers` uses, doesn't enforce this). The *first* live login attempt
against real `kokoro-staging` failed with `NotSupportedError: iteration counts above 100000 are
not supported` — the real `workerd` runtime hard-caps PBKDF2 at 100,000 iterations, a limit
Miniflare doesn't model. Fixed by lowering to 100,000 (the platform maximum) and documented in
`apps/worker/src/auth/password.ts` and ADR-007. This is exactly why KOK-009 did a real staging
deploy + live smoke test instead of treating "CI is green" as sufficient proof — and it's why
that practice is worth keeping for any future change that touches a Workers-runtime-specific API.

### 6.4 CI ordering bugs (three rounds, fixed in sequence)

1. **Node version** — `actions/setup-node` was pinned to Node 20, but pnpm 11 requires Node
   ≥22.13 and refuses to even start (`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`). Fixed by bumping
   every `node-version` to 24, matching the actual local dev runtime rather than picking an
   arbitrary LTS — the point being to keep local and CI in lockstep, not just to clear the error.
2. **Build-before-test** — `apps/worker`'s `wrangler.toml` declares an `[assets]` binding
   pointing at `../web/dist`; `@cloudflare/vitest-pool-workers` refuses to start *any* test file
   if that directory doesn't exist yet. The workflows (and the root `check` script) built the SPA
   *after* running tests. Reordered to build first everywhere, including the root `package.json`
   `check` script — a fresh clone running `pnpm run check` would have hit the identical failure
   before this fix.
3. **Missing `.dev.vars` in CI** — `.dev.vars` is correctly gitignored (it's local dev config),
   so a clean CI checkout had none, and every auth test got `undefined` secrets → 500 errors.
   Fixed with an `apps/worker` `pretest` script that seeds `.dev.vars` from the committed
   `.dev.vars.example` (fixed, non-secret placeholder values) if it's missing — self-healing for
   CI *and* for any fresh local clone, not a workflow-specific patch.

None of these were caught by writing the workflow YAML carefully — they were caught by actually
running it and reading the failure. That's the operating principle worth carrying forward:
infrastructure/pipeline changes get verified by execution, not just review.

## 7. Manual operations reference

See `.github/workflows/README.md` for the condensed version (required secrets, rollback
commands). The main things you'll do by hand before Phase 4:

```bash
# Check what's deployed right now
pnpm exec wrangler deployments list --env staging

# Roll back to the previous Worker version (near-instant, no rebuild)
pnpm exec wrangler rollback --env staging   # or --env prod

# Manually deploy without going through CI (e.g. a hotfix)
cd apps/worker
pnpm exec wrangler d1 migrations apply kokoro-staging --remote --env staging
pnpm exec wrangler deploy --env staging
```

D1 has no automated rollback — migrations are forward-fix only. If a bad migration ships, the fix
is a new migration that repairs it, never an edit to an already-applied one.
