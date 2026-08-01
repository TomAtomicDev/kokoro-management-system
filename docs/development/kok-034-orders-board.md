# KOK-034 — Orders board UI

What the `/orders` board builds on top of KOK-033's state machine, and the one backend gap it had
to close to make "Entregar" reachable. Business rules live in the
[System Design Knowledge Base](../system-design-knowledge-base/README.md): Doc 03 §5 (O-1…O-5),
Doc 04 §3.3/§5, Doc 07 SC-04.

## 1. Scope

`OrderBoard` (one column per status, O-5 delivery-date sort within each), `OrderCard`, and
`OrderDetailDrawer` with the full lifecycle: Confirmar → Iniciar producción → Marcar listo →
Entregar, plus Cancelar from any non-terminal status. `QuoteOrderForm` covers UC-05 (create).

The drawer also renders the order-profitability panel (agreed total − Σ order-linked production
run costs, via `production_runs.custom_order_id`, O-4) and the linked-runs list.

## 2. The missing piece: resolving a free-text line

KOK-033's dev doc flagged this exactly: `deliverOrder` refuses (409) while any
`custom_order_lines` row lacks an `item_id`, and the drawer must let the owner attach one before
offering "Entregar". But Doc 04 §5 is explicit that there is no generic "update order" command —
so nothing existed to persist that link.

Resolution (KB amended in the same commit, Doc 03 §5/Doc 04 §5): a new, narrow `resolveOrderLine`
command — `POST /orders/:id/lines/:lineId/resolve` — that does exactly one thing, attach an
`itemId` to one line, and nothing else. It is legal on any non-terminal order (the same status set
`cancelOrder` accepts), so the owner can resolve a line as soon as she knows what she's making,
not only at the moment of delivery. `description`/`qty`/`lineTotal` are left untouched. This is
deliberately not a generic line editor — the "no generic update order" rule stays intact.

The web drawer surfaces this inline: any line with `itemId === null` renders an `ItemPicker` +
"Vincular" button (`OrderDetailDrawer.tsx`'s `UnresolvedLineRow`) instead of the resolved line's
plain row. "Entregar" stays disabled (with a warning) until every line resolves.

## 3. Where things live

| Layer | Custom orders (KOK-033) | Line resolution (KOK-034) |
|---|---|---|
| Zod schema | `packages/shared/src/orders.ts` | `resolveOrderLineCommandSchema`, same file |
| Core service | `apps/worker/src/core/orders/index.ts` | `resolveOrderLine`, same file |
| Route | `apps/worker/src/api/orders.ts` | `POST /orders/:id/lines/:lineId/resolve` |
| Tests | `apps/worker/test/orders.test.ts` | `describe("resolveOrderLine (KOK-034)")` |
| UI | `apps/web/src/routes/orders.tsx`, `apps/web/src/components/orders/`, `apps/web/src/features/orders/api.ts` | `OrderDetailDrawer.tsx`'s `UnresolvedLineRow` |

## 4. Also touched

`listProductionRunsFiltersSchema` gained an optional `customOrderId` filter (mirrors the existing
`recipeId`/`outputItemId` filters) so the profitability panel can fetch an order's linked runs in
one request instead of filtering client-side over every run in the system.
