## Backlog ID

KOK-###

## Summary

<!-- 1-3 bullet points describing what this PR accomplishes -->
- 
- 
- 

## KB Compliance Checklist

<!-- All items must pass before merge. See CLAUDE.md and docs/system-design-knowledge-base/08-ai-development-guide.md. -->

- [ ] Business rules follow Docs 03–04; no invented rule (or a KB amendment is included in this PR if one was needed) — **D-1**
- [ ] All writes to business tables go through `core/` services; no raw SQL from routes, bot, assistant, jobs, or tests — **D-2**
- [ ] Each command is one atomic `db.batch()` with a single service function — **D-3**
- [ ] Shared Zod schemas reused across API/web/AI channels for any command touched; no schema redefinition per channel — **D-4**
- [ ] Money/quantity arithmetic uses `money.ts`/`qty.ts` only; no raw float math on amounts — **D-5**
- [ ] Doc 04 (and Doc 03 if rules changed) updated in this PR if the schema changed — **D-6**
- [ ] Prompt/tool changes pass the eval suite and don't regress acceptance-rate fixtures — **D-7**
- [ ] Business-event deletes are soft deletes, not hard deletes — **D-8**
- [ ] New/changed UI strings live in the shared i18n Spanish file (`i18n/es.ts`), reviewed for tone — **D-9**
- [ ] No new dependency added without a documented rationale (ADR note if architecturally significant) — **D-10**
- [ ] Invariant tests (`test/invariants/*`) pass; new derived data covered by the consistency check (INV-5) where applicable
- [ ] `pnpm check` passes locally (lint + typecheck + unit + integration)
- [ ] Deployed/smoke-tested on staging where the change touches a running flow

## Notes for Reviewer

<!-- Use this section to flag judgment calls, architectural concerns, or constraints that guided implementation. Per CLAUDE.md §4, put doubts here rather than silently expanding scope. -->
