# CLAUDE.md — Kokoro Management Development Guide

Kokoro Management is an operations, inventory, costing, and cash-flow system for a solo artisanal food business in Bolivia. It captures events via Telegram and AI assistant on mobile, and a web app on desktop, automating cost, margin, and time-profitability calculations in a high-inflation context. **The [System Design Knowledge Base](docs/system-design-knowledge-base/) (start at its `README.md`) is the single source of truth for business rules and architecture.** This file condenses the key constraints every change must respect; it is not a replacement for the KB.

## Golden Rules

These constraints are non-negotiable. Every code change must respect them.

| ID | Rule |
|----|------|
| D-1 | **The KB is law.** Business rules come from Docs 03–04; never invent one. If a needed rule is missing or contradictory, STOP and propose a KB amendment in the same PR (docs change + code change together). |
| D-2 | **All writes go through `core/` services.** No SQL inserts/updates to business tables from routes, bot handlers, assistant tools, jobs, or tests (tests use service factories). |
| D-3 | **One atomic batch per command** (INV-1). A new command = one service function that returns the prepared statements for a single `db.batch()`. |
| D-4 | **Shared Zod schemas are the single contract** (`packages/shared`). API route, web form, and AI draft tool for the same command MUST import the same schema. Adding a field = one schema change + migration + UI field. |
| D-5 | **Money/qty integers only** (INV-6). Never `parseFloat` on money; use `money.ts` / `qty.ts` helpers. Any `number` arithmetic on amounts outside those modules fails review. |
| D-6 | **Schema changes ship with docs.** A migration PR updates Doc 04 (and Doc 03 if rules changed) in the same commit. |
| D-7 | **Prompt/tool changes run the eval suite** (Doc 05 §8) before merge; acceptance-rate-critical fixtures may not regress. |
| D-8 | **Soft delete only** for business events (INV-10); hard DELETE is reserved for derived rows regeneration inside services. |
| D-9 | **UI strings in `i18n/es.ts`**, Spanish; identifiers/comments/commits in English. |
| D-10 | **No new dependencies without an ADR note.** Prefer stdlib/platform (Web Crypto, Intl) over packages. |

## Repository Conventions

- **Formatting & Linting:** Biome (single tool). CI gate: `biome check`, `tsc --noEmit`, tests.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`. No `any`; use `unknown` + narrowing. Exported functions have explicit return types.
- **Naming:** files `kebab-case.ts`; types `PascalCase`; DB per Doc 04 §1; commands use `record*/update*/delete*` verbs; queries use `get*/list*`.
- **Error handling:** Services throw typed `DomainError` with `code`, `message_es`, and `details`. Routes map to HTTP (400 validation, 401 unauthorized, 404 not found, 409 conflict/state-machine, 429 rate-limited, 500 server error). `message_es` is user-facing.
- **Commits:** Conventional Commits format (`feat(sales): …`, `fix(costing): …`). One logical change per PR; PRs reference backlog IDs (KOK-xxx).

## Playbook: Adding a New Event Type

Follow these 10 steps; skip only if the KB says the event already exists.

1. Read Doc 03 (business rules + invariants) and Doc 04 (tables) for the event.
2. `packages/shared`: add Command/Update DTO Zod schemas + result types.
3. `db/schema.ts` + migration (if new tables/columns) — update Doc 04 (D-6).
4. `core/<module>/`: service with `record`, `update`, `delete` producing one batch (D-3): event rows + derived `stock_movements`/`financial_transactions` + `item_stock`/balance deltas + `audit_log` row.
5. Unit tests for costing/derivation logic (pure parts) + integration test for the batch (Doc 11 templates).
6. `api/`: thin routes + TanStack Query hooks in `web/src/features/<module>/`.
7. `web/`: `EventForm` + table columns + drawer wiring (reuse Doc 06 components).
8. `assistant/tools/`: `draft_<event>` tool (imports the same schema, D-4) + capture few-shot example if utterance shape is new + eval fixtures (D-7).
9. `telegram/`: confirmation-card renderer for the event type (template in `telegram/cards.ts`).
10. Update Doc 07 if a screen changed; add glossary terms if new vocabulary appeared.

## Guardrails for AI Agents

- **Never modify:** applied migration files; `audit_log` write paths; invariant guard tests (`test/invariants/*` — fix code, not tests); prompt eval golden files without an explicit human-approved reason recorded in the PR description.
- **When uncertain** between two implementations, choose the one that keeps `core/` pure/testable and put the doubt in the PR description — do not silently expand scope.
- **Zero new lint suppressions:** generated code must compile with no new `// biome-ignore` comments; if one is required, include a justification comment.
- **Money math:** any task touching money math MUST add/extend a property-based test (Doc 11 §2).

## Definition of Done

Every backlog task ships only when:

1. Code + tests green locally (`pnpm check` = lint + types + unit + integration).
2. Invariant tests pass; new derived data covered by the nightly consistency check where applicable (INV-5).
3. Docs updated (D-6/D-7 as applicable).
4. Spanish UI strings reviewed for tone (concise, warm, no tech jargon).
5. Deployed to staging, smoke-tested via Playwright suite; manual exercises on staging Telegram bot when the task touches them.

For local UI verification against the dev server (before staging), use the `verify-ui` skill.

## Where Things Live

See the root `README.md` for the full monorepo directory tree and workspace dependency rules. Key points:

- **`docs/system-design-knowledge-base/`** — authoritative source for all business rules, data model, API design, and architectural decisions.
- **`packages/shared`** — Zod schemas, domain types, enums, money/qty utilities, i18n Spanish strings. No dependency on `apps/*`.
- **`apps/worker/src/`** — Cloudflare Worker (Hono). Routes (`api/`), domain services (`core/`), AI assistant (`assistant/`), Telegram bot (`telegram/`), jobs (`jobs/`), database (`db/`).
- **`apps/web/src/`** — React SPA. Routes, features (one per domain), components, lib utilities.
- **`tools/mcp-server/`** — dev-only MCP wrapper for the assistant tool registry.

**Workspace rule:** `core/` is called by `api/`, `telegram/`, `assistant/`, and `jobs/`, but `core/` never imports from any of them. All writes to business tables go through `core/` services.
