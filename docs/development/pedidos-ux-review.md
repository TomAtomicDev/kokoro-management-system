# Pedidos — UX review and improvement proposals

**Product + development review · 2026-09-29 · Owner decisions incorporated; implementation tracked in Phase 3.5**

## Executive recommendation

Keep Pedidos as a **status board**, but place its active states in vertical reading order: Cotizando at the top through Listo at the bottom. Show every active order regardless of creation date. Within each state row, sort by promised delivery date from latest to earliest, with the latest date at the left. Move delivered and cancelled orders to a separate Historial view, with quick filters for delivered with balance due, delivered and paid, and cancelled. Use status-colored card borders while retaining readable status labels.

The current “Margen” is not order profit: it subtracts the costs of linked production runs only, omitting assemblies and stock fulfillment, and can display before its queries finish. The history also needs the linked sale's *current* payment state, because a credit sale may be collected later. Improve those read models and labels before making any broader financial claim.

This review uses the supplied screenshots and the repository's current UI, shared contracts, services, and KB. It is **not** a live usability test or a verification of historical transaction amounts. Source of business rules: [KB README](../system-design-knowledge-base/README.md), particularly [Doc 03 §5, O-1–O-7](../system-design-knowledge-base/03-domain-model.md), [Doc 04 §5](../system-design-knowledge-base/04-data-model.md), [Doc 07 SC-04](../system-design-knowledge-base/07-screen-catalog.md), and the [packaging decision](acuerdos-prueba-usuario-1.md).

## Decisions from the owner discussion

| Decision | Product interpretation | Planning |
|---|---|---|
| Active work stays a board | Four full-width status lanes, top to bottom: Cotizando → Confirmado → En producción → Listo. Include active orders across all creation dates. | KOK-201 |
| Board card order | Sort by promised `deliveryDate` descending within each lane; latest promised date at the left. Missing dates remain last, consistent with the current null-date placement. | KOK-201; clarify SC-04 / O-5 |
| Closed work has its own view | Historial contains delivered and cancelled orders, with quick filters for Por cobrar, Pagados and Cancelados, plus an explicitly labelled date filter. | KOK-201 |
| Related events stay in order detail | Do not put deposit, production, assembly, delivery-session or sale links in history rows. Show those references in the order detail; link a delivered order to its generated sale. | KOK-202/204 |
| Status uses color and text | Color the card border by status, while keeping the status chip/text as the accessible, unambiguous label. | KOK-201 |
| External delivery is a pass-through | When the business pays an external delivery service, record its real shared session cost and charge the same amount to the customer in the sale total. Show both in the order detail, but exclude both from product gross margin. Create a closed five-minute-default `DELIVERY_RUN` session for the order by workflow convention; do not add a database uniqueness constraint. | KOK-204 |
| Corrections are stage-specific | Allow full quote edits in QUOTING; after confirmation, separate logistics edits from an explicit commercial renegotiation. Never rewrite paid deposits or physical production/assembly history. | KOK-205 |

## What the owner experiences today

| Finding | Evidence / consequence | Recommendation | Priority |
|---|---|---|---|
| Active work is mixed with history and constrained by a date range | `OrderBoard.tsx` renders six status columns in a horizontal scroller. `/orders` defaults to the current month and `listOrders()` filters `createdAt`, so an older active order disappears. | Put only active statuses on the main board, across all creation dates. Keep delivered/cancelled records in Historial with quick status filters and an explicitly labelled date filter. Use vertical status lanes and responsive cards rather than a sideways six-column board. | P1 |
| Current order sorting does not match the agreed priority | `listOrders()` sorts by `deliveryDate` ascending. The owner wants the latest promised date at the left in each lane. | Sort promised delivery dates descending within each active lane; put undated orders last. Preserve delivery date as the sort key; do not substitute creation date. | P1 |
| No safe general correction path today | `/orders/new` is create-only; Doc 04 §5 prohibits generic `updateOrder`. `resolveOrderLine` only attaches an item to an existing line. | Implement the approved named commands in KOK-205: full quote edits in QUOTING, logistics-only changes after confirmation, and audited renegotiation for merchandise terms. Renegotiation can add the first line to an empty quote; delivery still requires every line to resolve to a FINISHED item. Do not edit the generated sale independently. | P1 / KOK-205 |
| Linked work is not identifiable in the detail | Production and assembly forms have an `OrderPicker`; the order drawer fetches linked runs and assemblies but currently only shows run dates, not event codes, and does not show the generated sale or delivery session. | In the order detail, show separate Anticipo, Producción, Envasado, Entrega and Venta references with human-readable codes and links. Keep these event links out of the Historial rows. Make `ENV`, `SES` and deposit links deep-link to their detail destinations where needed. | P1 |
| The displayed “Margen” overstates what is known | `OrderDetailDrawer.tsx` calculates agreed total minus linked production-run cost only. It omits assembly evidence; a batch's full cost may not be attributable to this order; stock fulfillment may have no linked run. Loading/error can also appear as zero. | Replace the profit claim with an honest linked-cost panel. After delivery, show **margen bruto de artículos** = product subtotal less frozen sale-line COGS. Exclude the delivery surcharge and matching external-service expense from that margin; show both amounts separately as pass-through facts. Keep loading/error/verified-empty distinct. | P1 |
| Packaging is framed as a delivery-line problem | `DeliverOrderDialog.tsx` has no packaging fields, by design. The approved Presentation/Combo model records packaging when physically used through Assembly; sales contain the resulting FINISHED item. | Keep packaging out of ordinary order/sale lines and do not deduct it twice. If packing happens at handoff, record the Assembly at that physical moment. Do not add a hard “must have linked production” gate: O-4 allows fulfillment from existing stock. | Existing domain rule |

### Recommended interaction model

The main `/orders` view has two explicit scopes: **Activos** and **Historial**. Activos is the default and has no creation-date limit. Its four lanes run vertically from Cotizando to Listo. Cards use a responsive grid within each lane, show the order's status in text and color the border by status. Sort within a lane by promised delivery date, newest/latest first from left to right; keep no-date orders at the end. There is no nested horizontal scroll for the primary workflow.

Historial contains DELIVERED and CANCELLED orders. Quick filters separate **Por cobrar**, **Pagados** and **Cancelados**. The delivered payment state comes from the linked sale's current state, not from `depositPaid`: collection can change a credit sale to paid after delivery. Keep the date filter and state its date basis in the UI; do not silently change the existing creation-date query semantics. Opening a history card shows its order detail; the history row itself does not expose links to finance, production, packing, delivery-session or sales events.

The order detail leads with the next action and exceptions, then agreement/promised date, deliverables and unresolved lines, linked Anticipo/Producción/Envasado/Entrega/Venta, current collection state, cost evidence, notes and audit history. The generated sale appears as its `VTA-…` code and opens the existing sale detail. When an external delivery is used, show the delivery session, actual expense and equal customer pass-through included in the final sale total. Keep **“Iniciar producción”** (a status change) distinct from **“Registrar producción”** (creates a work event).

### Agreed correction policy

A broad PATCH would contradict Doc 04 §5 and the shared order contract, so corrections use three named commands:

- **QUOTING — `updateOrderQuote`:** correct the customer, description, merchandise subtotal, lines, expected deposit, promised date/place and notes. No deposit has been received yet; preserve the stable `PED` code and audit the before/after values.
- **CONFIRMED / IN_PRODUCTION / READY — `updateOrderLogistics`:** date, place and notes only. No money or stock changes.
- **CONFIRMED / IN_PRODUCTION / READY — `renegotiateOrder`:** explicitly change the description, merchandise lines/quantities and merchandise subtotal. Keep `depositPaid` and its transaction unchanged; do not rewrite production, assembly or stock events. If a positive deposit was received, the customer is immutable. If the order was confirmed at zero deposit, changing the customer requires a fresh no-deposit risk acknowledgment and audit. The new merchandise subtotal cannot be below the amount already deposited; in that case cancel with REFUND and create a new order, because partial refunds on active orders are not supported.

For DELIVERED orders, use guarded **Deshacer entrega** when allowed; a collected sale blocks undo (O-6). CANCELLED remains terminal. Every correction keeps the stable order code and commits its order/line changes and audit through one `core/` batch.

An empty quote still cannot be delivered: delivery requires at least one resolvable FINISHED line. Do not silently require complete lines at quote time, since capture-first quoting permits free text and empty lines. QUOTING can be corrected with `updateOrderQuote`; after confirmation, `renegotiateOrder` can add the first line. The delivery gate remains unchanged.

### Packaging and the meaning of order profit

Packaging leaves stock when physically applied, through Assembly. A presentation/combo is a FINISHED item whose WAC includes its components and packaging; delivery sells that finished item and must not consume packaging again. Goods handed to the customer belong in order lines as FINISHED items; preparation/packing materials belong to production/assembly. The approved external-delivery pass-through is recorded as a period expense and matching customer charge, not as an inventory line. Other delivery expenses or time need separately approved attribution rules.

For a delivered order, **product subtotal less the linked sale lines' frozen COGS** is the realized product gross margin. It handles stock fulfillment and avoids subtracting a production batch twice. For open orders, show known linked cost evidence and missing inputs as partial/unknown, never realized profit. Do not sum linked production costs, assembly costs and delivered COGS: that can count the same inventory value more than once. An external delivery provider's actual expense remains an operating expense and its equal customer surcharge is included in the final sale total; show both in order detail but exclude both from product gross margin. Keep deposit, balance due, recognized revenue and product margin separate (INV-7).

## Additional issues discovered

1. **Balance label disagrees with payment state:** `OrderDto.balanceDue` is always `agreedTotal − depositPaid`, even if the delivered balance was paid or later collected. Before delivery label it as the amount expected at delivery, not a receivable. After delivery read the linked sale's current status: PAID means no outstanding balance; ON_CREDIT means the remainder is still owed. This requires a shared read-contract/core change but no new ledger or write command (P1, KOK-200).
2. **Quote with no lines can become a dead end today:** `quoteOrderCommandSchema` allows `lines: []`, while delivery allocation refuses an empty set and the drawer cannot add a line. KOK-205 resolves this through `updateOrderQuote` while quoting and `renegotiateOrder` after confirmation, without forcing an item at quote time.
3. **Loading/error can look like zero:** the drawer can render `Bs 0,00` while linked work is loading and can mistake a failed/unfinished query for no production when warning before READY. Distinguish loading, failure, verified empty and data (P1, KOK-202).
4. **Order drawer URL is only partly synchronized:** `/orders?open=id` opens a drawer, but card clicks only update local state and closing can leave the URL stale. Synchronize open/close with the query so refresh, back and shared links work (P2, KOK-203).

## Delivery sequence and acceptance checks

| Wave | Scope | Acceptance to review with owner |
|---|---|---|
| **1 · Trustworthy order state** | KOK-200: expose linked sale's current payment state and outstanding amount in the shared order read contract; correct labels in cards/detail. | A delivered paid or collected sale shows no debt; a delivered ON_CREDIT sale shows the current outstanding amount; before delivery, the balance is not presented as a current receivable. |
| **2 · Active board and history** | KOK-201: four vertical active lanes, active orders across creation dates, promised-date sort, status borders, explicit Historial with quick filters. | An old-created active order appears without date adjustment; latest promised date is leftmost within each lane; delivered-with-debt, paid and cancelled scopes are distinct; rows have no event links; layout works without sideways page scrolling. |
| **3 · Delivery pass-through** | KOK-204: actual external service expense and equal delivery surcharge in the sale total; one closed, five-minute-default delivery session, no DB uniqueness rule; exclude both pass-through amounts from product gross margin. | Sale total and receivable include the surcharge; the expense is recorded once to the selected account; session end matches delivery time and start is duration earlier; order detail reconciles session expense and surcharge; product gross margin is unchanged by the pass-through. |
| **4 · Detail evidence and navigation** | KOK-202/203: linked event codes/links in detail, honest partial cost evidence before delivery, realized product gross margin after delivery, loading/error states, URL-synchronized drawer. | Order detail opens the linked VTA/PRD/ENV/SES/anticipo records; delivered product gross margin reconciles to merchandise subtotal minus frozen sale-line COGS and excludes delivery pass-through; no unlinked or loading order looks like it has a verified zero cost or full profit; refresh/back/close preserve the expected drawer state. |
| **5 · Correct safely** | KOK-205: QUOTING edit, logistics correction and guarded renegotiation, with deposit floor, customer protection, audit and no collateral stock/production changes. | Owner can correct an incorrect promised date without cancelling/recreating; renegotiating lines/total preserves the actual deposit and event history; a total below deposit is refused with a clear refund/recreate path. |

Any handoff-specific packaging mechanism remains outside this delivery sequence. Delivery pass-through is specified separately from product gross margin. Implementation writes must go through `core/` atomic commands and shared schemas; UI strings stay in the Spanish i18n module.

## Deferred scope

The Phase 3.5 order metric is settled: product gross margin is available only after delivery and excludes the equal external-delivery pass-through. Attribution of other delivery expenses or time is deferred.

## Handoff clarifications (technical review)

- KOK-201 includes a bounded, continuable order-list read. The existing API caps results at 500; removing the creation-date filter alone would silently hide older active work. Sort ties deterministically by creation time and ID after promised date. Historial defaults to **Todos**; its creation-date range is optional and does not leak into Activos.
- KOK-200 separates the *expected merchandise balance* before delivery from the *current sale receivable* after delivery. A delivered order with a missing active sale is a data error, not a zero balance. Its fee-aware acceptance case is completed with KOK-204; the board does not need to wait for that feature.
- KOK-204 must account for undo followed by re-delivery: the original paid provider expense survives undo. Reuse it if there was no new provider payment (and keep its original service time), or record a distinct new session/expense if another payment actually occurred. Do not allow generic session edits to desynchronize a delivered sale's fee from its linked real cost. Order detail must identify retained historical costs when they exist rather than suggesting the new sale paid the provider twice.
- KOK-205 validates pinned line amounts against the new subtotal with the existing delivery allocation rules, preserves empty quotes, and refuses stale form submissions so corrections do not overwrite each other.
