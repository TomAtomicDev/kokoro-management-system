# 08 — AI Development Guide

Rules for developing Kokoro with AI coding agents (Claude Code or similar). A condensed version
of this document MUST be maintained as `CLAUDE.md` at the repo root; this document is the
authoritative long form.

## 1. Golden rules

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

## 2. Repository conventions

- **Formatting/linting:** Biome (single tool). CI gate: `biome check`, `tsc --noEmit`, tests.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`. No `any`; `unknown` +
  narrowing. Exported functions have explicit return types.
- **Naming:** files `kebab-case.ts`; types `PascalCase`; DB per Doc 04 §1; commands
  `record*/update*/delete*` verbs; queries `get*/list*`.
- **Errors:** services throw typed `DomainError` (`code`, `message_es`, `details`); routes map
  to HTTP (400 validation, 401 unauthorized, 404 not found, 409 conflict/state-machine,
  429 rate-limited, 500 internal). `message_es` is user-facing. 401/429 added during KOK-007
  (owner auth) — the original 4-code list predated any auth surface.
- **Commits:** Conventional Commits (`feat(sales): …`, `fix(costing): …`). One logical change
  per PR; PRs reference backlog IDs (KOK-xxx).

## 3. How to implement a new event type (the canonical playbook)

1. Read Doc 03 (rules + invariants) and Doc 04 (tables) for the event.
2. `packages/shared`: add Command/Update DTO Zod schemas + result types.
3. `db/schema.ts` + migration (if new tables/columns) — update Doc 04 (D-6).
4. `core/<module>/`: service with `record`, `update`, `delete` producing one batch (D-3):
   event rows + derived `stock_movements`/`financial_transactions` + `item_stock`/balance
   deltas + `audit_log` row.
5. Unit tests for the costing/derivation logic (pure parts) + integration test for the batch
   (Doc 11 templates).
6. `api/`: routes (thin) + TanStack Query hooks in `web/src/features/<module>/`.
7. `web/`: `EventForm` + table columns + drawer wiring (reuse Doc 06 components).
8. `assistant/tools/`: `draft_<event>` tool (imports the same schema, D-4) + capture few-shot
   example if the utterance shape is new + eval fixtures (D-7).
9. `telegram/`: confirmation-card renderer for the event type (template in `telegram/cards.ts`).
10. Update Doc 07 if a screen changed; add glossary terms if new vocabulary appeared.

## 4. Guardrails for AI agents

- Never modify: applied migration files; `audit_log` write paths; INV-guard tests
  (`test/invariants/*` — fix code, not tests); prompt eval golden files without an explicit
  human-approved reason recorded in the PR description.
- When uncertain between two implementations, choose the one that keeps `core/` pure/testable
  and put the doubt in the PR description — do not silently expand scope.
- Generated code must compile with zero new lint suppressions; `// biome-ignore` requires a
  justification comment.
- Any task touching money math MUST add/extend a property-based test (Doc 11 §2).

## 5. Definition of Done (every backlog task)

1. Code + tests green locally (`pnpm check` = lint + types + unit + integration).
2. Invariant tests pass; new derived data covered by the nightly consistency check where
   applicable (INV-5).
3. Docs updated (D-6/D-7 as applicable).
4. Spanish UI strings reviewed for tone (concise, warm, no tech jargon).
5. Deployed to staging, smoke-tested via Playwright suite; capture flows manually exercised on
   the staging Telegram bot when the task touches them.
