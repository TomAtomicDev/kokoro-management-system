# KOK-030 — Sales End-to-End

What `core/sales` actually covers, why it stops where it stops, and what the next sales-adjacent
tasks (KOK-031 receivables, KOK-032 customers, KOK-033/034 custom orders) need to know before
touching this module. For the business rules themselves (UC-03, INV-8, C-5/C-6) see the
[System Design Knowledge Base](system-design-knowledge-base/README.md), Doc 03 and Doc 04 §3.3/§5.

## 1. Scope: CREATE + READ only

`core/sales/index.ts` ships `recordSale`, `getSale`, `listSales` — no `updateSale`, `deleteSale`,
`restoreSale`, or `collectPayment`. This mirrors how `core/purchasing` (KOK-016) originally shipped
CREATE+READ before UPDATE/DELETE/RESTORE arrived later as their own task (KOK-024). The backlog
description for KOK-030 never mentioned edit/delete (contrast KOK-026, whose description explicitly
called for "Full create/update/delete/restore"), and `docs/development/kok-024-event-edit-delete.md`
§1/§8 already flags sales as a type with "no live create path yet" that should "apply this exact
pattern" once one ships — read that document before building sales edit/delete/restore. It generalizes
cleanly; nothing here should need reinventing.

The web UI (`SaleForm`/`SalesTable`/`SaleDetailDrawer`) mirrors this: no edit/delete buttons, no
"mark paid" inline action, even though Doc 07's SC-02 entry describes both. Building UI against an
endpoint that doesn't exist yet would be worse than leaving it out — when `collectPayment` (KOK-031)
ships, wire "mark paid" into `SalesTable` then.

## 2. Why `recordSale` never calls `planCostingReplay`

`costing_adjustments.trigger_event_type` (Doc 04 §3.4) only admits `purchase` / `production_run` /
`stock_exit` / `session` — `sale` is not a member, and there's no `confirm` flag on
`recordSaleCommandSchema` as a result (a flag that gates nothing is worse than no flag). A backdated
sale that would re-weight a later item's WAC is therefore not synchronously reconciled — same open
gap `recordPurchase`/`recordExit` already have on their own backdated-CREATE-through-web-UI path
(kok-024 doc §8). The nightly WAC-drift detector (`core/costing/repair.ts`) is the backstop.

If this gap needs closing for sales specifically, it requires a schema change (adding `sale` to the
trigger-type CHECK + a migration) and a Doc 03/04 amendment (D-6) — not a quiet code-only fix.

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
