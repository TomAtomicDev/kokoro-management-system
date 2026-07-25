# KOK-033 — Custom-order state machine

What `core/orders` covers, the two KB ambiguities it had to resolve, and what KOK-034 (Orders board
UI) must know before building against it. Business rules themselves live in the
[System Design Knowledge Base](../system-design-knowledge-base/README.md): Doc 03 §5 (O-1…O-5),
Doc 04 §3.3/§4/§5, ADR-012.

## 1. Scope

The whole lifecycle, as six guarded transitions, each one atomic batch (D-3/INV-1):

| Command | Transition | Writes |
|---|---|---|
| `quoteOrder` | → `QUOTING` | `custom_orders` + `custom_order_lines` + audit |
| `confirmOrder` | `QUOTING` → `CONFIRMED` | INCOME/`ORDER_DEPOSIT` tx + account credit + order update + audit |
| `startOrderProduction` | `CONFIRMED` → `IN_PRODUCTION` | order update + audit |
| `markOrderReady` | `IN_PRODUCTION` → `READY` | order update + audit |
| `deliverOrder` | `READY` → `DELIVERED` | `sales` + `sale_lines` + SALE_OUT movements + `item_stock` + (balance only) INCOME/`ORDER_BALANCE` + order update + 2 audit rows + replay statements |
| `cancelOrder` | `{QUOTING,CONFIRMED,IN_PRODUCTION,READY}` → `CANCELLED` | REFUND: EXPENSE/`DEPOSIT_REFUND` + account debit · FORFEIT: in-place recategorization of the deposit row · then order update + audit |

Reads: `getOrder`, `listOrders` (status/customer/delivery-date filters, sorted by `delivery_date`
with undated orders last, O-5). Dry run: `previewOrderImpact` (R-5, delivery only).

There is **no** `updateOrder` and no soft-delete/restore: Doc 04 §5 says transitions only, and
`CANCELLED` is the terminal "this didn't happen" state.

## 2. The free-text-line problem, and why delivery is stricter than quoting

`custom_order_lines.item_id` is nullable, but `sale_lines.item_id` is NOT NULL + FINISHED-only and
Doc 04 §5 recomputes `sales.total = Σ(qty × unit_price)`. O-2 also wants the sale to equal
`agreed_total`. Those cannot all hold for an order whose value sits in item-less free-text lines.

Resolution (KB amended in the same commit): free-text lines stay legal while QUOTING, but
**`deliverOrder` refuses with a 409 until every line carries an `item_id`**. Skipping the line
instead would have dropped the `SALE_OUT` for goods that really shipped — and since O-4 says order
production is a normal ProductionRun that already booked `PRODUCTION_IN` against a real
`output_item_id`, `item_stock` would drift upward forever (INV-5).

`agreed_total` is split across those lines by `allocateAgreedTotalToOrderLines`
(`packages/shared/src/orders.ts`): explicit `line_total`s are pinned, the rest share the remainder
weighted by `qty` via largest remainder, and the result is rejected unless `Σ(qty × unit_price)`
reproduces `agreed_total` exactly (D-5). With `qty = 1000` (one whole unit — the DDL default and
the normal case) `unit_price === line_total`, so this can only refuse on genuinely indivisible
fractional quantities, e.g. Bs 1,00 across a single 3-unit line.

## 3. FORFEIT recategorizes; it does not book

`v_liability` nets `ORDER_DEPOSIT − DEPOSIT_REFUND − Σ deposit_paid of DELIVERED orders`. A
FORFEITed order never reaches `DELIVERED`, so its deposit would have stayed a liability forever.

`cancelOrder` with `FORFEIT` therefore **recategorizes the existing deposit transaction in place**
to `OTHER_INCOME` — same row, account, amount and original `business_date`. The row drops out of the
view's category filter (liability cleared) and the income is recognized, in one write. A second
income row would have double-counted cash that is already in the account (ADR-012). `v_liability`
needed **no** definition change; the accepted consequence is that the forfeited amount lands in the
cash-flow category mix of the month the deposit was *received*.

## 4. `v_receivables` now reports the remainder (migration 0005)

O-2 makes the delivered sale carry the FULL agreed total, but only the balance was ever
uncollected. The view's `total` column is now `sales.total − custom_orders.deposit_paid` for
CUSTOM_ORDER sales (unchanged for CATALOG ones). `core/sales`' `outstandingForSale` computes the
same figure on the cash side, so `collectPayment` on a delivered order credits the **balance**, not
the agreed total — without it the deposit would have been banked twice.

## 5. The order owns its sale

`updateSale`/`deleteSale` refuse (409) for any `channel='CUSTOM_ORDER'` sale. Editing it would
desynchronize `custom_orders.sale_id`/`agreed_total` and would rewrite the order's `ORDER_BALANCE`
transaction into a plain `SALE` one. Corrections go through the order.

## 6. What KOK-034 must build

- **Board**: `GET /api/orders?status=…`, one column per status, cards sorted by `delivery_date`.
  `OrderDto` already carries `customerName` and a derived `balanceDue` — no extra fetch needed.
- **Delivery drawer must gate "Entregar"**: the button may only be enabled once every line has an
  `itemId`. Surface an inline line editor (item picker per line) for orders quoted with free text,
  otherwise the owner gets a 409 she cannot act on. `orderLineCommandSchema` allows a null `itemId`
  precisely so quoting stays fast — resolving it is the drawer's job.
- **Deliver** posts `balancePaymentStatus: 'PAID' | 'ON_CREDIT'`; PAID additionally needs
  `paymentMethod` + `accountId`. When `balanceDue === 0` either branch is accepted and the sale is
  marked PAID.
- **Backdated delivery** needs the same `useReplayConfirmableMutation` wrapper `SaleForm` uses:
  the 409 carries `{ reason: REPLAY_CONFIRMATION_REQUIRED, impact }`, and `POST /api/orders/impact`
  is the dry run.
- **Cancel** asks for REFUND/FORFEIT only when `depositPaid > 0`; sending a resolution on a
  deposit-free order is a 400, and omitting one on a deposit-bearing order is also a 400.

## 7. Where things live

| Layer | Custom orders |
|---|---|
| Zod schemas / DTOs | `packages/shared/src/orders.ts` |
| Pure money math + property tests | `packages/shared/src/orders.ts`, `packages/shared/src/orders.test.ts` |
| Core service | `apps/worker/src/core/orders/index.ts` |
| Routes | `apps/worker/src/api/orders.ts` |
| Migration | `apps/worker/migrations/0005_receivables_net_of_deposit.sql` |
| Tests | `apps/worker/test/orders.test.ts` |
| UI | KOK-034 (not built) |
