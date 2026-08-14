# Block C — Sessions & Orders (KOK-132…139, KOK-153)

9 tasks from Phase 3.2 Block C (`docs/system-design-knowledge-base/10-implementation-backlog.md`),
per `docs/development/acuerdos-prueba-usuario-1.md`. Branch
`TomAtomicDev/kok-132-139-sessions-orders` off `develop` (base `63e9096`), 46 files changed,
+3297/-215. Full designs and diffs are in git history; this collects what later tasks — especially
anything touching sessions, orders, production, or assemblies — should know before reinventing it.

## Commits

| Task | Commits | Summary |
| --- | --- | --- |
| KOK-132 | `3a3fef7` | Header session control + `SessionChip` action menu |
| KOK-133 | `1dd2abb` | S-3 reallocation-on-add + session-preselected forms |
| KOK-134 | `31e2741` | Weekly session calendar view |
| KOK-135 | `8387f52` | Deduplicated interval-union hours for monthly Bs/hour (S-5) |
| KOK-136 | `e07440f`, `891fc2e`, `81606f1` | Order status reversal + "Deshacer entrega" |
| KOK-138 | `61d7d47` | Future-date rejection + editable payment dates on confirm/deliver |
| KOK-139 | `9246190` | Order-lines explanatory copy |
| KOK-153 | `36c55fe`, `e1c57ef` | Envasado/Armado recording form (web) — first full-page, non-dialog form in the app |
| KOK-137 | `c6a3e68`, `a9d6de2`, `f5149af`, `c857217`, `eaf9686`, `460e1c0` | Orders ↔ production/assembly wiring |

## New shared surfaces other tasks should reuse

| Surface | File | Built by | Reuse for |
| --- | --- | --- | --- |
| `OrderPicker` | `apps/web/src/components/orders/OrderPicker.tsx` | KOK-137 | Any future form that links to a custom order by customer/description search, filtered by status. Mirrors `CustomerPicker`'s combobox shape (search input, dropdown, outside-click close, X to clear) minus its inline-create flow. **Resolves the selected value via its own `useOrder(id)` query, independent of whatever status filter the search list uses** — copy that split if you build a similar picker over a status-excluded list; using the same query for both search results and the current selection silently blanks out an existing selection once it falls outside the filter (see Decisions below). |
| `assemblies.tsx` (`AssemblyRecordRoute`) | `apps/web/src/routes/assemblies.tsx` | KOK-153 | The first full-page (not dialog) recording form in the app — create-only. `apps/web/src/features/assemblies/api.ts`, `apps/web/src/features/assembly-definitions/api.ts`, and `apps/web/src/lib/i18n-assemblies.ts` shipped alongside it. Precedent for KOK-141 (Block D), which migrates other forms onto this full-page pattern. |
| `assertOrderLinkable` | `apps/worker/src/core/orders/index.ts` | KOK-137 | The guard any future writer of `custom_orders.id`-referencing rows should call before persisting the link — rejects DELIVERED/CANCELLED orders with a `validationError` (not `conflict`: see Decisions). `loadOrderRowOrThrow` in the same file was widened from private to exported for this, zero logic change. |
| `listOrdersFiltersSchema.excludeStatuses` | `packages/shared/src/orders.ts` | KOK-137 | Additive filter — comma-separated on the wire, array-typed for callers — for excluding a set of statuses from `listOrders` server-side. Use this instead of fetching unfiltered and discarding client-side when the exclusion is status-based. |
| `SessionChip` | (header) | KOK-132 | Session action menu surfaced from the app header — check this file before adding another session-control affordance elsewhere. |

## Decisions worth knowing about

**KOK-137 — `assertOrderLinkable` only runs on CREATE unconditionally; on UPDATE it only runs
when `customOrderId` is actually changing.** The first implementation (worker-authored, before
orchestrator review) called the guard unconditionally at the top of both
`buildProductionRunUpdateInputs` and `buildAssemblyUpdateInputs`, before the existing row was even
loaded. That meant any edit to a production run or assembly whose linked order had since gone
DELIVERED — a normal, expected sequence, since delivery typically happens *after* production is
recorded — would permanently fail to save, even for a change unrelated to the link (a notes typo,
a qty correction). Doc 03 §5 O-4 makes the link purely informational once set; an edit that
doesn't touch `customOrderId` shouldn't re-assert it. Fixed in `eaf9686`: the guard now loads
`existing` first and only validates when `command.customOrderId !== existing.customOrderId`. Any
future guard added over an update path that reuses the create path's command shape should ask
this question explicitly — "does this validate the CHANGE, or does it re-validate everything on
every save?"

**KOK-137 — guard throws `validationError`, not `conflict`.** `resolveOrderLine`'s existing
`"No se puede vincular un ítem a un pedido X."` (`core/orders/index.ts`) throws `conflict` because
that call mutates the ORDER's own lifecycle. `assertOrderLinkable` instead validates a foreign key
on someone *else's* command (a production run or assembly), the same shape as
`resolveItemSnapshots`' FINISHED-only item check a few lines above it in the same file, which
throws `validationError` — the closer precedent, followed here. Rule of thumb for future guards in
this file: `conflict` when the command mutates the checked row's own state machine, `validationError`
when the checked row is just a referenced foreign key.

**KOK-137 — order picker's text search is client-side, its status filter is server-side.**
`listOrdersFiltersSchema` has no customer-name text-search field; adding one was judged
out-of-scope for one picker at this business's order volume. `OrderPicker` fetches the
status-excluded list once via `useOrders({excludeStatuses:[...]})` and filters client-side by
`customerName`/`description` substring. If order volume ever grows enough that this becomes a
real list, revisit with a server-side search param — don't just widen the client-side filter.

**KOK-137 — "no linked production" warning checks BOTH production runs and assemblies.**
`OrderDetailDrawer.tsx`'s READY-transition button only blocks-with-confirm when *both*
`useProductionRuns({customOrderId})` and `useAssemblies({customOrderId})` are empty — an order
fulfilled purely via an Envasado/Armado run has production in the business sense even with zero
`production_runs` rows. Checking only one query would have false-positived on it. This is a
dismissible `window.confirm`, never a hard gate — O-4 again: orders never reserve stock, so a hard
gate would force fake zero-qty runs just to satisfy it, corrupting costing and WAC.

**KOK-138 date rules and KOK-136 order reversal** touch `apps/worker/src/core/orders/index.ts`
and `apps/web/src/components/orders/OrderDetailDrawer.tsx` alongside KOK-137 — verified at block
close that KOK-136's reversal buttons (`window.confirm`-gated, sibling conditional blocks per
status) and KOK-137's READY-warning change to the same file are non-overlapping (different
buttons, different conditions). No further detail captured here for KOK-132/133/134/135/136/138/139
beyond the commit summaries above — read their diffs directly if a future task needs their
internals; nothing about them proved load-bearing for KOK-137's design.

## Orchestration notes

- This block's ledger (`docs/development/.runs/KOK-132..KOK-139/`, now deleted post-merge-decision)
  needed to be manually copied into the Orca worktree after every edit — it lives in the main
  checkout and does not sync automatically. Cost two real escalations during KOK-136 before the
  pattern was caught.
- The dispatched Codex CLI in this worktree reliably reported `stage: input_accepted` without
  self-submitting on `worker-start`/`dispatch --inject`. Fix every time: an empty
  `terminal send --text "" --enter`, then `terminal read` to confirm a real turn started, before
  waiting on the dispatch.
- KOK-137's worker asked two legitimate clarifying questions (test-file location; a pre-existing
  UTC/La-Paz date-boundary flaky test blocking its acceptance run) — both answered, both handled
  correctly (the flaky-test fix landed as its own separate commit, `c6a3e68`, not folded into the
  feature commit).
