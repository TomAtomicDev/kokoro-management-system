# KOK-030 — Sales End-to-End

What `core/sales` actually covers, why it stops where it stops, and what the next sales-adjacent
tasks (KOK-031 receivables, KOK-032 customers, KOK-033/034 custom orders) need to know before
touching this module. For the business rules themselves (UC-03, INV-8, C-5/C-6) see the
[System Design Knowledge Base](system-design-knowledge-base/README.md), Doc 03 and Doc 04 §3.3/§5.

## 1. Scope: CREATE + READ only

`core/sales/index.ts` originally shipped only `recordSale`, `getSale`, `listSales` — no `updateSale`,
`deleteSale`, `restoreSale`, or `collectPayment`. This mirrored how `core/purchasing` (KOK-016)
originally shipped CREATE+READ before UPDATE/DELETE/RESTORE arrived later as their own task
(KOK-024). `collectPayment`/`listReceivables` shipped in **KOK-031**; `updateSale`/`deleteSale`/
`restoreSale` shipped in **KOK-064** (which also closed the §2 backdated-replay gap below),
applying the exact KOK-024 pattern `docs/development/kok-024-event-edit-delete.md` §1/§8 called for
— nothing in that pattern needed reinventing.

**One deliberate divergence from `core/purchasing`'s edit/delete shape (KOK-064):** a sale that has
already been collected via `collectPayment` (i.e. it carries a `financial_transactions` row with
`category='DEBT_COLLECTION'` sourced to it) refuses `updateSale`/`deleteSale` with a `409 CONFLICT`
— a business-rule call, not an oversight. `collectPayment` books its `DEBT_COLLECTION` transaction
at the *collection* moment, separate from the sale's own `occurred_at`/`accountId`/`paymentMethod`;
letting a full-replacement edit regenerate that transaction the same way `updatePurchase` regenerates
its `SUPPLY_PURCHASE` row would silently overwrite the true collection date/category with a fresh
`SALE`-category row dated at the sale's own `occurred_at` — a financial-history regression, not a
correction. `restoreSale` needs no equivalent guard: `collectPayment` requires a non-deleted sale, so
a soft-deleted sale can never have been collected while deleted. See `core/sales/index.ts`'s
`assertSaleNotCollected`.

Sales' edit/delete/restore are also structurally closer to `core/inventory/exits.ts`'s shape than to
`core/purchasing`'s: like an exit (and unlike a purchase), a sale never owns `items.wac`/
`replacement_cost` (C-6), so `commitSaleMutation` carries no `items` UPDATE of its own — the only
`items.wac` writes a sale mutation can produce come from `planCostingReplay`'s own statements, when
the sale is backdated.

## 2. `recordSale` now calls `planCostingReplay` (KOK-064)

Until KOK-064, `costing_adjustments.trigger_event_type` (Doc 04 §3.4) only admitted `purchase` /
`production_run` / `stock_exit` / `session` — `sale` was not a member, so a backdated sale that
re-weighted a later item's WAC was never synchronously reconciled (the same gap
`recordPurchase`/`recordExit` had on their own backdated-CREATE-through-web-UI path before KOK-065,
kok-024 doc §8), leaving the nightly WAC-drift detector (`core/costing/repair.ts`) as the only
backstop.

KOK-064 closed this: `sale` was added to the `trigger_event_type` CHECK (migration
`0004_allow_sale_costing_trigger.sql`) and `recordSaleCommandSchema` gained the same `confirm` flag
every other replay-triggering command schema has (`confirmFlagSchema`, D-4). `recordSale` now runs
the identical INV-11/R-2 ordering guard `recordPurchase`/`recordExit` do — see `core/sales/index.ts`
— and `SaleForm`'s create path is wrapped in `useReplayConfirmableMutation` exactly like
`PurchaseForm`/`ExitForm` (KOK-065's pattern, reused rather than re-derived).

## 3. Cost/cash shape, in one paragraph

A sale is stock-wise identical to a non-commercial exit: a `SALE_OUT` movement that freezes
`sale_lines.unit_cost_snapshot` at the item's **current** WAC and never mutates `items.wac` (C-6
spirit). What a sale adds on top of an exit is the cash side: `paymentStatus: 'PAID'` credits the
chosen account and books an `INCOME`/`SALE` transaction (source-stamped per INV-9) in the same
batch; `paymentStatus: 'ON_CREDIT'` books no transaction at all — `paid_at` stays `null` and the sale
sits in `v_receivables` until `collectPayment` (KOK-031) sets it.

## 4. Fields intentionally left unwired

- `customerId` / `sessionId` are accepted by the schema (nullable FKs) but nothing in `SaleForm`
  sets them: customers CRUD (KOK-032) hasn't shipped, and no `SessionPicker` component exists
  anywhere in this codebase yet — every other event-vertical form (`PurchaseForm`,
  `ProductionRunForm`, `ExitForm`) has the identical gap. Build one picker, wire it everywhere at
  once, rather than duplicating a one-off per form.
- `channel` is always `'CATALOG'` from this task's create path. `CUSTOM_ORDER` sales are written by
  the order-delivery flow (O-2, KOK-033/034), which will call into `core/sales` differently (likely
  a variant entry point, not `recordSale` as-is, since a delivered order's sale is derived from
  already-agreed pricing, not a fresh `LineEditor` form) — read Doc 03's O-2 definition before
  assuming `recordSale` can be reused unchanged for it.

## 5. Where things live

| Layer | Sales |
|---|---|
| Zod schemas / DTOs | `packages/shared/src/sales.ts` |
| Core service | `apps/worker/src/core/sales/index.ts` |
| Routes | `apps/worker/src/api/sales.ts` |
| Query hooks | `apps/web/src/features/sales/api.ts` |
| Form (create only) | `apps/web/src/components/sales/SaleForm.tsx` |
| Table / detail | `apps/web/src/components/sales/{SalesTable,SaleDetailDrawer}.tsx` |
| i18n | `apps/web/src/lib/i18n-sales.ts` |
| Tests | `apps/worker/test/sales.test.ts` |
