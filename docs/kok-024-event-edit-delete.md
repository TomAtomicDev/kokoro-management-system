# KOK-024 — Event Edit/Delete Framework

How editing, deleting, and undoing a purchase or stock exit actually works, why it's built the
way it is, and what's left. This is an implementation deep-dive, not a spec — for the business
rules themselves (R-1…R-5, INV-11, C-1/C-3/C-6) see the
[System Design Knowledge Base](system-design-knowledge-base/README.md), specifically Doc 03 §7,
Doc 04 §3.4, and ADR-016 (Doc 12). This document exists because several decisions and a few real
gotchas live only in code comments and PR history today — this collects them in one place.

## 1. What this task actually covers

KOK-024 shipped for **purchases and stock exits only** — the two event types with a live
`record*` path when the task started. Sales, custom orders, and production runs have no create
path yet, so they got no edit/delete either. When one ships, it needs this same pattern applied,
not a new one invented.

Per event type, four operations:

| Operation | Purchases | Stock exits |
|---|---|---|
| Edit (full replacement) | `updatePurchase` | `updateStockExit` |
| Delete (soft) | `deletePurchase` | `deleteStockExit` |
| Restore (undo a delete) | `restorePurchase` | `restoreStockExit` |
| Dry-run impact preview | `previewPurchaseImpact` | `previewStockExitImpact` |

All four live in `apps/worker/src/core/purchasing/index.ts` and
`apps/worker/src/core/inventory/exits.ts` respectively, routed through
`apps/worker/src/api/purchasing.ts` / `apps/worker/src/api/inventory.ts`, and consumed by
`apps/web/src/components/purchases/{PurchaseForm,PurchaseDetailDrawer}.tsx` and
`apps/web/src/components/inventory/{ExitForm,ExitDetailDrawer}.tsx`.

## 2. The core mechanism: synchronous replay

**The problem.** WAC (C-1) is an incremental weighted average — each kardex entry folds into a
running total in chronological order. Recording today's production before backdating last week's
flour purchase (an ordinary Tuesday for a Telegram-first capture flow, not an edge case) breaks
that assumption: every entry after the backdated one was averaged against the wrong prior state,
and any sale/exit that consumed the item since then already froze a cost snapshot that's now
wrong.

**The fix (INV-11, ADR-016).** Any create/edit/delete/restore whose `(occurred_at, created_at)`
point precedes the latest already-processed movement for an affected item triggers a **synchronous
replay** inside the same `db.batch()` as the command — not a nightly job. `planCostingReplay`
(`apps/worker/src/core/costing/replay.ts`) is the ONE function that does this, and it is the only
place this logic exists:

1. Find the "touched point" — the earliest kardex position disturbed, across the union of
   movements being removed and movements being added.
2. Project the full kardex for every affected item (own item + anything reachable through an
   ACTIVE production recipe, dependency-ordered): replay the untouched **prefix** from zero to get
   a seed state (no per-movement WAC cache exists — see §4), then replay the **suffix** from the
   touched point forward.
3. If any sale line, stock exit, or production run recorded strictly after the touched point
   already froze a cost snapshot, mark `confirmationRequired: true` and compute the aggregate
   `costDelta` per affected item.
4. Book a `costing_adjustments` row (R-4) for each affected item whose delta is **nonzero** —
   never for an item the replay touched but didn't actually move.
5. Return `{ impact, confirmationRequired, replayedItemIds, statements }` — `statements` is never
   executed here; the caller appends them to its own batch.

**R-5's confirmation gate** lives at each command's own call site, not inside the planner: if
`confirmationRequired && !command.confirm`, throw `409 CONFLICT` with
`details.reason = "REPLAY_CONFIRMATION_REQUIRED"` and `details.impact` attached, before any
statement is built. The caller retries with `confirm: true` merged into the same command.

**Ordering, both fields.** The comparison that decides "does this land before existing history" is
`occurred_at` then `created_at` as a tiebreak (`comparePoints` in replay.ts) — **not**
`business_date`. Two movements can share a `business_date` (the reporting day) but disagree on
`occurred_at` (the actual instant); the kardex orders by the latter. Doc 03's R-2/INV-11 wording
was fixed to say this explicitly (Phase H) after living as an inaccurate "business_date" claim
through Phases A–G.

## 3. R-4: never rewrite history, book it forward instead

A day already reported must keep reporting the same margin. So a replay never touches
`sale_lines.unit_cost_snapshot` / `stock_exits.unit_cost_snapshot` — instead it books a
`costing_adjustments` row per affected item (Doc 04 §3.4), dated to the **correction's own**
`business_date` (today), capturing the signed `cost_delta` in centavos. Cumulative profitability
absorbs the correction; historical per-day reports never change underneath the owner.

`costing_adjustments` has no `affected_production_run_ids` column — only `affected_sale_line_ids`
and `affected_stock_exit_ids`. Not an oversight: no replay can touch a production run until
production runs exist (KOK-026), so the column is deferred rather than added speculatively. The
in-memory `ReplayImpactDto` (used only for the preview response, never persisted) already carries
`affectedProductionRunIds` for the day it matters.

## 4. Why edit/delete cost changed from O(1) to O(n)

ADR-009 assumed edits were rare and nightly repair was fine. ADR-016 replaces that, and the
consequence is real: **there is no per-movement WAC cache**. To seed the replay's starting state,
`planCostingReplay` replays the item's entire untouched prefix from zero every time (see step 2
above) — cost is O(n) in the item's total movement count, not O(k) suffix-only as an earlier draft
of ADR-016 claimed (fixed in Phase H). A cache column was explicitly rejected: it would be a third
place for the WAC to be wrong, alongside the stored `items.wac` and whatever a caller's own
threading computes. Bounded in practice to tens/low-hundreds of movements for a solo-operator
business — cheap enough synchronously, expensive enough that this is not free to call in a loop.

## 5. Restore (undo) is a mutation, not a snapshot

Doc 06 principle 6 (soft delete + 10s "Deshacer" toast, no confirm-dialog wall) governs the
default delete UX. Two implementation choices worth recording:

- **Delete commits immediately; restore is a real server round-trip**, not a client-side debounce.
  This was a deliberate choice over "queue the delete for 10s and just cancel the fetch" — the
  latter is simpler but leaves the row fully live server-side during the window (a second
  tab/device wouldn't see it as deleted) and offers no path back once the toast is gone.
  `restorePurchase`/`restoreStockExit` reconstruct the derived rows from the event's own
  **unchanged stored content** (a purchase's lines survive a delete; only its kardex/cash rows were
  reversed) and route through the exact same commit path as edit/delete, audited as `"restore"` —
  a free-form `audit_log.action` string, no migration needed.
- **Restoring is itself replay- and R-5-aware.** Reinserting historical movements at their
  original dates can collide with bookings made while the event was deleted, exactly like a
  backdated edit. No special-casing exists for this — restore just flows through
  `planPurchaseMutationCostingImpact` / the exits equivalent like any other mutation, and can throw
  its own 409 requiring confirmation.
- **A restored stock exit reuses its exact stored `unit_cost_snapshot`** rather than re-pricing at
  today's WAC (C-6/R-4's spirit: undo brings back exactly what was deleted, not a freshly-priced
  version of it).

## 6. The "descriptive-only edit" optimization — and where it's missing

Fixing a typo in a three-month-old purchase's supplier name should not trigger a replay over every
movement since, nor ask the owner to confirm a `costDelta` of exactly zero — she'd learn to click
through confirmations that mean nothing, which is how R-5's real warnings stop being read.

`updatePurchase` guards against this: `movementSetsEqual` compares the existing kardex rows
against the post-edit ones (by item/occurredAt/businessDate/type/qty/unitCost, excluding `id` and
`created_at`), and skips `planCostingReplay` entirely when they're identical
(`kardexUnchanged` in `apps/worker/src/core/purchasing/index.ts`).

**`updateStockExit` has no equivalent guard.** Every exit edit — including one that only changes
`reason`/`notes`/`sessionId` — unconditionally calls `buildReplaceMovementsForSourceStatements`
(regenerating the kardex row with a fresh `created_at`) and `planCostingReplay`. In practice this
is unlikely to trip R-5 for a same-item, same-date, same-qty edit, but it is not guarded the way
purchasing is, and it does needlessly regenerate the kardex row's tiebreak timestamp on every
edit. **Worth closing** — see §8.

## 7. Other decisions worth knowing

- **Two-phase impact API, one planner.** `previewPurchaseImpact`/`previewStockExitImpact` exist
  as dedicated dry-run endpoints (`POST /purchases/impact`, `POST /inventory/exits/impact`) so a
  UI can show impact before the user commits to saving — but they call the exact same builder +
  `planCostingReplay` the real mutation calls (via small extracted helpers like
  `buildPurchaseCreateMovements`/`buildPurchaseUpdateMutationInputs`), never a second
  implementation. The fallback "attempt the real mutation, read the impact off the 409" path also
  still works and uses the identical planner — a preview computed differently from the write it
  previews would be, in replay.ts's own words, "a lie with a UI around it."
- **`useReplayConfirmableMutation`** (`apps/web/src/hooks/useReplayConfirmableMutation.ts`) is the
  one place the catch/capture/retry dance for a 409 lives, shared by all six purchase/exit
  edit-delete-restore call sites in the UI. `execute()`/`confirm()` never throw; a
  `REPLAY_CONFIRMATION_REQUIRED` refusal populates `pendingConfirmation` instead of `error`, so a
  genuinely different failure (validation, 500) still surfaces normally.
- **Hand-rolled toast, no new dependency (D-10).** `apps/web/src/components/ui/toast.tsx` is the
  first toast primitive in this app — a small context/provider, not sonner or radix-toast.
  `showUndo()` forces the Doc 06-mandated 10s window so no call site repeats the magic number.
- **`ImpactConfirmDialog` is feature-agnostic** — takes its own Spanish copy as props rather than
  importing any feature's i18n file, so `core/ui` never depends on `features/`. Purchases and
  exits both use it today; sales/production would reuse it unchanged later.
- **`occurredAt` is preserved on edit**, not re-stamped to "now" — there's no UI field to change
  it, and re-stamping would silently rewrite when a purchase/exit actually happened every time the
  owner fixes an unrelated typo.
- **Exit snapshot-on-edit policy**: editing the SAME item keeps the frozen `unit_cost_snapshot`
  (correcting "8 kg, not 5 kg" doesn't change what price the flour was carried at that day);
  changing the exit to a DIFFERENT item re-snapshots at that item's current WAC (there is no valid
  old snapshot to preserve — it was priced in a different item's units).
- **Nightly job demoted, not removed** (Phase H). `core/costing/repair.ts`'s `detectWacDrift`
  (renamed from `buildWacRepairIfDrifted`) now only detects and reports drift into
  `job_runs.detail` — it never writes `items.wac` again. Before KOK-024 this was the *only*
  mechanism that ever corrected WAC; today the synchronous replay owns that job R-4/R-5-correctly,
  and a blind nightly overwrite would silently reintroduce the exact history-rewriting risk R-4
  exists to prevent, the day a caller's replay has a bug or someone bypasses services with a direct
  DB fix.

## 8. What's deferred / not done

- **Sales, custom orders, and production runs have no edit/delete/restore.** No live create path
  existed for any of them when this task ran; when one ships, apply this exact pattern (Phases
  A–D's core mechanism already generalizes — the dependency-graph cascade and `costing_adjustments`
  schema were built for this) rather than re-deriving it.
- **The exits `kardexUnchanged` guard (§6).** `updateStockExit` should get the same
  descriptive-only-edit short-circuit `updatePurchase` has, both to avoid needless kardex
  regeneration and to avoid a same-instant-tiebreak reordering risk on every edit.
- **Backdated CREATE through the web UI has no confirmation path.** `recordPurchase`/`recordExit`
  both enforce INV-11 on create (Phase D) and can throw the same 409
  `REPLAY_CONFIRMATION_REQUIRED` a backdated edit does. But `PurchaseForm`/`ExitForm`'s CREATE
  branch calls `createMutation.mutateAsync` directly in a plain try/catch, NOT wrapped in
  `useReplayConfirmableMutation` — a backdated create today shows the refusal as a plain red error
  string with no way to actually confirm and proceed. Only the EDIT branch of each form got the
  full dialog treatment. This is a real dead end for an owner recording a genuinely backdated new
  purchase/exit through the web UI (Telegram/AI capture doesn't exist yet either, so there is no
  workaround channel). Fixing it means wrapping the create mutation the same way the edit one is
  wrapped.
- **No audit-trail footer.** `DetailDrawer`'s footer shows only `createdAt`/`updatedAt` — Doc
  06/Doc 10 both originally called for something richer ("editado 2 veces"), but there is no
  audit-log READ query or route anywhere in the codebase yet. Building one (`GET
  /purchases/:id/audit` or similar, backed by a new `core/audit` read function) is a prerequisite.
- **No component-level render tests.** Neither jsdom nor `@testing-library/react` is installed in
  this workspace (checked deliberately — D-10 blocks adding either without an ADR). `PurchaseForm`,
  `PurchaseDetailDrawer`, `ExitForm`, `ExitDetailDrawer`'s interactive wiring (does clicking
  "Editar" actually open the right dialog, does cancel actually preserve in-progress edits) is
  verified today by manual browser testing (see `apps/web/e2e/` for the existing Playwright setup,
  not yet extended to these flows) and by the pure-function extractions
  (`purchaseToFormState`, `exitFormInitialState`) each form's test file covers — not by a rendered
  assertion. Worth an ADR-backed decision on adding `@testing-library/react` + jsdom if deeper
  coverage is wanted before KOK-055 (the planned E2E suite) picks this up.
- **Telegram + AI assistant channels don't support edit/delete/restore.** UC-18 ("Edit/delete any
  event") is scoped `Web` only in Doc 03's use-case catalog — no `draft_update_purchase` /
  confirmation-card work was in scope here.
- **KOK-026/028 will extend the recipe cascade.** The dependency-graph walker
  (`topoOrderAffectedItems`) is generically correct today but exercises only a single-node graph
  (no production recipes exist yet) — its multi-item cascade behavior is unit-tested against
  synthetic edges, not yet proven against a real production run.

## 9. Where things live (map)

| Layer | Purchases | Stock exits | Shared |
|---|---|---|---|
| Zod schemas / DTOs | `packages/shared/src/purchasing.ts` | `packages/shared/src/exits.ts` | `packages/shared/src/costing.ts` (`ReplayImpactDto`, `confirmFlagSchema`) |
| Replay planner | — | — | `apps/worker/src/core/costing/replay.ts` |
| WAC math | — | — | `apps/worker/src/core/costing/wac.ts` |
| Recipe cascade | — | — | `apps/worker/src/core/costing/dependency-graph.ts` |
| Adjustment ledger writer | — | — | `apps/worker/src/core/costing/adjustments.ts` |
| Nightly backstop | — | — | `apps/worker/src/core/costing/repair.ts`, `apps/worker/src/jobs/daily-snapshot.ts` |
| Core service | `apps/worker/src/core/purchasing/index.ts` | `apps/worker/src/core/inventory/exits.ts` | |
| Routes | `apps/worker/src/api/purchasing.ts` | `apps/worker/src/api/inventory.ts` | |
| Query hooks | `apps/web/src/features/purchases/api.ts` | `apps/web/src/features/inventory/api.ts` | |
| Form (create+edit) | `PurchaseForm.tsx` | `ExitForm.tsx` | |
| Detail drawer | `PurchaseDetailDrawer.tsx` | `ExitDetailDrawer.tsx` | |
| UI primitives | — | — | `useReplayConfirmableMutation.ts`, `ImpactConfirmDialog.tsx`, `toast.tsx` |
| Invariant tests | `apps/worker/test/invariants/` (`wac-replay`, `cross-item-cascade`, `frozen-snapshots`) | | |

All of the above under `apps/web/src/components/{purchases,inventory}/` and
`apps/worker/src/{core,api}/`.
