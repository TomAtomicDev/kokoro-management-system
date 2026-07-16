# Kokoro Management System

Operations, inventory, costing, and cash-flow system for a one-person artisanal food business
in Bolivia. Event-based capture (Telegram + AI assistant on mobile, web app on desktop);
automates cost, margin, and time-profitability calculations in a high-inflation context.

**The single source of truth for behavior is the [System Design Knowledge Base](docs/system-design-knowledge-base/README.md).**
Read it before writing code — especially [08 — AI Development Guide](docs/system-design-knowledge-base/08-ai-development-guide.md)
and the repo-root `CLAUDE.md` (condensed version of it).

## Monorepo layout

pnpm workspaces, single repository:

```
kokoro/
├── docs/                      # System Design Knowledge Base (authoritative)
├── packages/
│   └── shared/                # Zod schemas, domain types, enums, money/qty utils, i18n strings
├── apps/
│   ├── worker/                # the deployable unit — Cloudflare Worker (Hono)
│   │   └── src/
│   │       ├── index.ts       # Hono app assembly + cron dispatcher
│   │       ├── db/            # drizzle schema, migrations, query helpers
│   │       ├── core/          # DOMAIN SERVICES (pure where possible)
│   │       ├── api/           # Hono routes (thin: parse → service → serialize)
│   │       ├── assistant/     # AI runtime, tool registry, prompts, interaction log
│   │       ├── telegram/      # grammY bot: conversations, confirmation cards
│   │       └── jobs/          # cron handlers
│   └── web/                   # React SPA (built into worker static assets)
│       └── src/ (routes/, features/, components/, lib/)
└── tools/
    └── mcp-server/             # dev-only MCP wrapper around the assistant tool registry
```

## Workspace dependency rule

`api/`, `telegram/`, `assistant/`, and `jobs/` (inside `apps/worker`) call into `core/` services.
**`core/` never imports from any of them.** All writes to business tables go through `core/`
services — never raw SQL from routes, the bot, AI tools, or tests. This is what keeps the AI
assistant, the HTTP API, and Telegram behaviorally identical (see Doc 02 §3).

At the package level:

- `packages/shared` has no dependency on `apps/*` — it is imported by both `apps/worker` and
  `apps/web` (and `tools/mcp-server`), never the other way around.
- `apps/worker` and `apps/web` do not import from each other.
- Every command's DTO is one Zod schema in `packages/shared`, imported by the API route, the
  React form, and the AI draft tool for that command (ADR-008) — never redefined per channel.

## Getting started

```bash
pnpm install
pnpm run check      # lint (biome) + typecheck (tsc) + tests, across all workspaces
pnpm run dev:worker # apps/worker via wrangler dev
pnpm run dev:web    # apps/web via vite
```

Node >= 24.18 (pnpm 11 itself requires it), pnpm 11 (see `devEngines` in `package.json`). Formatting/linting is Biome only
(`pnpm run lint:fix` / `pnpm run format`). TypeScript is `strict` with `noUncheckedIndexedAccess`
across every workspace (`tsconfig.base.json`).

## Deployment

CI/CD runs via GitHub Actions (`.github/workflows/ci.yml`, `deploy.yml`). For the full picture —
what Cloudflare infrastructure exists, how to set real secrets on staging/prod, and the pipeline
architecture — see [docs/deployment-guide.md](docs/deployment-guide.md). Quick reference (required
secrets, rollback commands) lives in [.github/workflows/README.md](.github/workflows/README.md).
