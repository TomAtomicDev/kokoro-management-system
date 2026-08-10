# CLAUDE.md — Kokoro Management Development Guide

Kokoro Management is an operations, inventory, costing, and cash-flow system for a solo artisanal food business in Bolivia. It captures events via Telegram and AI assistant on mobile, and a web app on desktop, automating cost, margin, and time-profitability calculations in a high-inflation context. **The [System Design Knowledge Base](docs/system-design-knowledge-base/) (start at its `README.md`) is the single source of truth for business rules and architecture.** This file condenses the key constraints every change must respect; it is not a replacement for the KB.

## Golden Rules

These constraints are non-negotiable. Every code change must respect them.


| ID   | Rule                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | **The KB is law.** Business rules come from Docs 03–04; never invent one. If a needed rule is missing or contradictory, STOP and propose a KB amendment in the same PR (docs change + code change together).            |
| D-2  | **All writes go through `core/` services.** No SQL inserts/updates to business tables from routes, bot handlers, assistant tools, jobs, or tests (tests use service factories).                                         |
| D-3  | **One atomic batch per command** (INV-1). A new command = one service function that returns the prepared statements for a single `db.batch()`.                                                                          |
| D-4  | **Shared Zod schemas are the single contract** (`packages/shared`). API route, web form, and AI draft tool for the same command MUST import the same schema. Adding a field = one schema change + migration + UI field. |
| D-5  | **Money/qty integers only** (INV-6). Never `parseFloat` on money; use `money.ts` / `qty.ts` helpers. Any `number` arithmetic on amounts outside those modules fails review.                                             |
| D-6  | **Schema changes ship with docs.** A migration PR updates Doc 04 (and Doc 03 if rules changed) in the same commit.                                                                                                      |
| D-7  | **Prompt/tool changes run the eval suite** (Doc 05 §8) before merge; acceptance-rate-critical fixtures may not regress.                                                                                                 |
| D-8  | **Soft delete only** for business events (INV-10); hard DELETE is reserved for derived rows regeneration inside services.                                                                                               |
| D-9  | **UI strings in `i18n/es.ts`**, Spanish; identifiers/comments/commits in English.                                                                                                                                       |
| D-10 | **No new dependencies without an ADR note.** Prefer stdlib/platform (Web Crypto, Intl) over packages.                                                                                                                   |


## Repository Conventions

- **Formatting &amp; Linting:** Biome (single tool). CI gate: `biome check`, `tsc --noEmit`, tests.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`. No `any`; use `unknown` + narrowing. Exported functions have explicit return types.
- **Naming:** files `kebab-case.ts`; types `PascalCase`; DB per Doc 04 §1; commands use `record*/update*/delete*` verbs; queries use `get*/list*`.
- **Error handling:** Services throw typed `DomainError` with `code`, `message_es`, and `details`. Routes map to HTTP (400 validation, 401 unauthorized, 404 not found, 409 conflict/state-machine, 429 rate-limited, 500 server error). `message_es` is user-facing.
- **Commits:** Conventional Commits format (`feat(sales): …`, `fix(costing): …`). One logical change per PR; PRs reference backlog IDs (KOK-xxx).

## Playbook: Adding a New Event Type

See the `add-event-type` skill for the 10-step playbook.

## Guardrails for AI Agents

- **Never modify:** applied migration files; `audit_log` write paths; invariant guard tests (`test/invariants/*` — fix code, not tests); prompt eval golden files without an explicit human-approved reason recorded in the PR description.
- **When uncertain** between two implementations, choose the one that keeps `core/` pure/testable and put the doubt in the PR description — do not silently expand scope.
- **Zero new lint suppressions:** generated code must compile with no new `// biome-ignore` comments; if one is required, include a justification comment.
- **Linting from inside a `.claude/worktrees/*` checkout:** `biome.json`'s `!**/.claude` exclusion matches anywhere in the resolved path, so any worktree — being physically nested under `.claude/`— reports "0 files" for `pnpm run lint` / `biome check .`, regardless of cwd or VCS flags. This is not a bug to fix by editing `biome.json` (it's shared across every checkout, including the main one — do not add worktree-specific exceptions to it). Instead scope the check to explicit paths: `pnpm exec biome check <changed files...>` or `pnpm --filter <pkg> exec biome check src`. `pnpm run typecheck` and test runners are unaffected and work normally from a worktree.
- **Money math:** any task touching money math MUST add/extend a property-based test (Doc 11 §2).

## Definition of Done

Every backlog task ships only when:

1. Code + tests green locally (`pnpm check` = lint + types + unit + integration).
2. Invariant tests pass; new derived data covered by the nightly consistency check where applicable (INV-5).
3. Docs updated (D-6/D-7 as applicable).
4. Spanish UI strings reviewed for tone (concise, warm, no tech jargon), none mojibake.
5. Deployed to staging, smoke-tested via Playwright suite; manual exercises on staging Telegram bot when the task touches them.

For local UI verification against the dev server (before staging), use the `verify-ui` skill.

## Where Things Live

See root `README.md` for the monorepo layout and workspace dependency rule.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
