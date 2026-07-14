# CI/CD (KOK-009)

Two workflows, per `docs/system-design-knowledge-base/02-system-architecture.md` §9:

- **`ci.yml`** — runs on every push (except `main`) and PR: lint (Biome), typecheck, unit +
  integration tests, and an SPA build. Fast feedback loop; deploys nothing.
- **`deploy.yml`** — runs on push to `main`: checks → build SPA → migrate + deploy **staging**
  → Playwright smoke test against the live staging URL → **manual approval** (the `production`
  GitHub Environment has a required reviewer configured in repo Settings → Environments →
  `production`) → migrate + deploy **prod**.

Migrations always run *before* the Worker version switch, in the same job, so a mid-deploy
failure never leaves the DB ahead of the code that expects it (expand → migrate → contract,
Doc 02 §9). Migrations must stay backward-compatible with the previous Worker version for exactly
this reason.

## Required GitHub secrets

Set once via `gh secret set <NAME>` or repo Settings → Secrets and variables → Actions:

| Secret | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `wrangler` auth in CI (needs D1 edit + Workers Scripts edit + R2 read permissions on the account) |
| `CLOUDFLARE_ACCOUNT_ID` | Passed to `wrangler` so it skips the `/memberships` account-discovery call, which a narrowly-scoped token often can't make |
| `STAGING_OWNER_PASSWORD` (optional) | Plaintext of the staging owner password, so the Playwright smoke suite can exercise the login flow (Doc 11 §6: "login works" is a P0 gate). If unset, that one check skips itself — everything else in the pipeline still runs. |

Cloudflare **secrets** (`OWNER_PASSWORD_HASH`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, etc.) are
separate from the GitHub secrets above — those are set directly on each Worker environment via
`wrangler secret put <NAME> --env <staging|prod>` (see `apps/worker/.dev.vars.example` for the
full list and `apps/worker/scripts/hash-password.mjs` for generating `OWNER_PASSWORD_HASH`), not
through GitHub Actions.

## GitHub Environments

- **`staging`** — no protection rules; every push to `main` deploys here automatically.
- **`production`** — has a required reviewer. The `deploy-prod` job pauses until approved from
  the workflow run's "Review deployments" button in the GitHub UI. This *is* the "manual
  approval" step from Doc 02 §9.

## Rollback

**Worker code:** `wrangler rollback` reverts to the previously deployed Worker version — near
instant, no rebuild, no migration involved:

```bash
cd apps/worker
pnpm exec wrangler rollback --env staging   # or --env prod
```

Pick a specific prior version instead of "the previous one":

```bash
pnpm exec wrangler deployments list --env prod   # find the version id
pnpm exec wrangler rollback --env prod <version-id>
```

**Database:** D1 migrations are **forward-fix only** (Doc 02 §9) — there is no automated
`migrations rollback`. If a bad migration ships, write a new migration that undoes/repairs the
change; never edit or delete an already-applied migration file (Doc 08 D-1/guardrails). This is
why migrations must be backward-compatible with the Worker version they're deployed alongside —
a `wrangler rollback` of the *code* must still work against whatever the *database* looks like
after the newest migration.

## Manual deploy (bypassing CI, e.g. a hotfix)

```bash
cd apps/worker
pnpm exec wrangler d1 migrations apply kokoro-<staging|prod> --remote --env <staging|prod>
pnpm exec wrangler deploy --env <staging|prod>
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your shell environment (see the
root README / `apps/worker/.dev.vars.example`).
