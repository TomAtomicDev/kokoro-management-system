# 07 — Screen Catalog

Web app screens (React SPA). Shared layout, table/drawer pattern, and components per
[06 — UX/UI Specification](06-ux-ui-specification.md). Every list screen supports: date-range +
entity filters, search, CSV export, row → `DetailDrawer` with audit trail.

> **Phase 3.2 amendment (decided 2026-08-11, implementation pending).** Every **line-bearing event
> form** — Compra, Venta, Producción, Envasado/Armado, Pedido, Conteo — is a **full page with its
> own URL** and a pinned summary footer, not a modal or drawer (Doc 06 §2). Drawers keep the
> read-and-act role; small dialogs keep the single-decision role. Where a screen below still says
> "modal/drawer" for one of those forms, this amendment governs. List filters, tabs and date
> ranges persist in the URL; the default range on Ventas and Salidas is *start of month → today*.
> Pedidos defaults to all active orders with no creation-date bound; its Historial date filter is
> optional, explicitly labelled as order creation date, and the active board sorts by promised
> delivery date descending (KOK-201; O-5).

## SC-01 · Dashboard — `/`

**Purpose:** daily situational awareness; answers "¿cómo está el negocio hoy/este mes?"
**Content:** `StatCard` row — Caja total (bank+cash, with split), Ventas del mes (Δ vs prev),
Ganancia del mes (revenue − COGS − opex), Bs/hora del mes (G3), Valor de inventario;
AlertsPanel summary strip; "Pedidos próximos" (next 5 by delivery date); "Margen en riesgo"
top-5 from `listPriceHealth` (`core/costing/price-health.ts`, KOK-035 — margins are computed in
application code, not in `v_price_health`, per Doc 04 §4/KOK-069), presented as **Bs at risk**
rather than margin % (KOK-074); sales-last-30-days chart; quick-add shortcuts. The **Por cobrar**
StatCard always shows the global outstanding balance across all dates and links to SC-21, where the
owner can inspect and collect the underlying debts.
**Data:** daily_snapshots + live aggregates. Every number links to its source screen (UX-5).

**Business-health placement rule (2026-07-27).** The dashboard carries the _now_ layer only —
one number per question, each deep-linking to the screen that explains it. Ganancia and Bs/hora
gain an 8-week sparkline (KOK-081) but no axis and no second series: the trend lives one click
away in SC-13's "Salud del negocio" tab. Resist growing this screen into a report; the owner
opens it in thirty seconds between batches.

## SC-02 · Sales list — `/sales` (UC-03, UC-04, UC-18)

Table: código (KOK-185, Doc 04 §3.6), fecha, canal, cliente, items resumen, total, margen (from
`unit_cost_snapshot`), estado pago (badge POR COBRAR), método. Actions: new sale, mark paid
(account + method inline), edit/delete. The date-range filter remains a sales-period view; the old
"Por cobrar" preset is replaced by a **Gestionar deudas** link to SC-21 so outstanding balances
from earlier dates are not hidden by the current month's range. The debt-management screen is the
primary place to review receivables by customer and source sale.

This margin is historical — the WAC frozen at sale time, not the item's current replacement cost —
so it is a plain neutral figure, deliberately **not** `MarginBadge`/C-5-thresholded (KOK-036):
badging a historical number with the anti-decapitalization threshold would read as "this sale is
fine" when the real question C-5 asks is "would selling at this price today still be fine." SC-12
is where that question lives.

## SC-03 · Sale form — `/sales/new` (full page)

**One** `LineEditor` section: FINISHED items only — ordinary products, presentations and combos —
with price prefilled from `items.sale_price` and editable. The former second **packaging** section
is **removed** (Phase 3.2, KOK-126): packaging leaves stock when the product is packed, not when it
is sold, and its cost is already inside the presentation's WAC, so a packaging line here would
deduct the same bottle twice and would show the customer a line she never bought.

One `PaymentAccountPicker` replaces the separate method and account fields (KOK-113); optional
customer/session. Warnings: stock going negative (amber, INV-8) — **shown on create only, never in
edit mode**, where it is meaningless (KOK-112); price vs. replacement cost as a live `MarginBadge`
(C-5, KOK-036) as the price is typed, reading `GET /pricing-settings` for the threshold. Shows a
neutral "Costo pendiente" label instead of the badge when the item's effective replacement cost is
0 (C-3c): a badge would otherwise misreport a missing cost as a healthy 100% margin.

The pinned footer carries the total and "se descontará X de la cuenta Y" — the figure the owner
could not find during the first user test — plus a line pointing to *Entregar pedido* for order
deliveries, since a delivery already creates its own sale (O-2) and recording one here would
duplicate it.

## SC-04 · Orders board — `/orders` (UC-05…UC-08)

**Implementation note:** the following board/drawer paragraphs document the pre-KOK-204
payment-coupled screen. The **target contract** below supersedes them where they refer to
single deposits, automatic collection/refund, sale-based order debt, matched provider expense,
payment-based undo restrictions and the three O-7 edit flows. KOK-206 revises the shipped or
in-review KOK-197…201 surfaces; unimplemented KOK-202 is superseded, with its valid detail
evidence requirements incorporated into KOK-208's dedicated order page.

`OrderBoard` has two views. **Activos** is the default and shows every nonterminal order without a
creation-date limit, in four full-width vertical lanes from top to bottom: QUOTING, CONFIRMED,
IN_PRODUCTION, READY. Cards show code (KOK-185, Doc 04 §3.6), customer, delivery date/place, agreed
merchandise subtotal (`agreed_total`), deposit and the correct balance/payment label. Before
delivery, the displayed balance is the expected merchandise remainder at handoff
(`agreed_total − deposit_paid`), labelled **Saldo previsto al entregar**; it is not a receivable.
Delivered cards instead show the linked sale's current **Pagado / Por cobrar** state and actual
outstanding remainder, which becomes zero after collection. Cancelled orders have no balance. Within each
  lane, sort by promised `delivery_date` descending (latest date first, top to bottom); undated orders last,
  breaking ties by creation time then ID descending. Load further bounded pages when needed so
  active orders beyond the first 500 are not silently omitted. Give
cards a status-colored
border and retain the text status chip; do not rely on color alone. On narrow screens the lane cards
wrap without nested horizontal scrolling.

**Historial** contains DELIVERED and CANCELLED orders, with **Todos** and quick filters for **Por cobrar**,
**Pagados** and **Cancelados**. **Por cobrar** means a delivered sale whose current outstanding
remainder is greater than zero; **Pagados** includes every delivered sale with zero outstanding,
including one paid later through collection. An optional, initially empty date range is labelled
**Fecha de creación** and can be cleared to review all history. Switching back to **Activos** clears
that history-only date range. History uses bounded continuation
  too; **Todos** must not silently stop at the first 500 closed orders. History rows open the order detail
but do not show links to the deposit, production, assembly, delivery-session or sale events. Delivered
payment filters use the linked sale's current payment state, so a later collection moves an order
from Por cobrar to Pagados.

Card → detail drawer with full lifecycle actions: **Confirmar** (suggests a 50% deposit, editable
including Bs 0; zero requires explicit high-risk acknowledgment and creates no cash/deposit-liability
row) · **Iniciar producción** · **Marcar listo** · **Entregar** (creates the Sale; the agreed amount
is the merchandise subtotal; if an external provider is used, the final sale total adds the delivery
pass-through. The remaining balance is paid or ON_CREDIT). Choosing ON_CREDIT requires a separate
high-risk acknowledgment that shows the exact final balance becoming due, including the external
delivery pass-through when present. This is distinct from the R-5 backdated-cost confirmation, and
both are required if both conditions apply. · **Cancelar** (REFUND/FORFEIT choice, O-3).

When the owner pays an external delivery provider for this order, the delivery form records the
provider amount and expense account as a real session shared cost (not an estimate). It creates a
closed `DELIVERY_RUN` session with the delivery time as its end; duration defaults to 5 minutes and
is editable, with start calculated as end minus duration. The same amount, without markup, becomes
`sales.delivery_fee`; the sale total and any receivable include it. This is a pass-through, not
product revenue for the order's gross-margin calculation. The expense account is separate from the
account used to receive the customer's balance. No delivery session/cost is created for an order
with no paid external provider service.

The order detail is the only place that shows linked **Anticipo**, **Producción**, **Envasado**,
**Entrega** and **Venta** references and links to their details. Production/assembly/session/sale use
their PRD/ENV/SES/VTA code; the system-owned deposit transaction has no separate code and is
identified by the linked PED order. The generated sale uses its `VTA-…` code and current payment
state. For an external delivery, show the session's actual expense, the equal amount included in the
  sale total, and the final total; keep these pass-through amounts out of **margen bruto de artículos**.
  After undo/re-delivery, distinguish the current sale's provider session from earlier retained
  provider expenses: reusing the original paid service posts no second expense, while a newly paid
  service has its own session and the earlier expense remains historical.
That margin is available only after delivery and is `(merchandise subtotal) − frozen sale-line COGS`.
Other linked production/assembly costs remain partial evidence, not a substitute for sale-line COGS.
Loading, query error, verified empty and available data are distinct states. Keep **“Iniciar
producción”** (status change) distinct from **“Registrar producción”** (creates work). The drawer's
`open` state is synchronized with `/orders?open=<id>` for refresh and browser back/forward.

**Corrections (O-7, KOK-205):** QUOTING has **Editar cotización**, a full-page form that may update
the quote fields and lines. CONFIRMED/IN_PRODUCTION/READY offer **Ajustar entrega** for date, place
and notes, and **Renegociar pedido** for description, merchandise lines/quantities (including adding
the first line to an empty quote) and merchandise subtotal. Renegotiation is a separate full-page
form with a before/after summary; it never silently
changes the paid deposit or rewrites linked production/assembly events. The customer cannot change
once a positive deposit is paid; a zero-deposit order requires a renewed risk acknowledgment and
audit if its customer changes. A new merchandise subtotal below the deposit already paid is refused
with a clear message; resolve it by cancelling/refunding and recording a new order (partial deposit
  refunds on an active order are unsupported). The form rejects line shares that cannot reproduce the
  agreed subtotal on delivery, offers explicit clearing for optional fields, and reports a stale-edit
  conflict rather than overwriting newer work. DELIVERED remains editable only through O-6's guarded
Deshacer entrega path; CANCELLED remains terminal.

**Backward actions (Phase 3.2, KOK-136, O-6):** a **Volver atrás** action in the detail of orders
in CONFIRMED/IN_PRODUCTION/READY (one step, simple confirmation, no money moves), and **Deshacer
entrega** in the detail of a DELIVERED order — explicit confirmation plus an `ImpactConfirmDialog`,
because it deletes the sale delivery created and returns the deposit to the liability. It is
**disabled with an explanation when that sale has already been collected**: the money really
arrived, and the owner must reverse the collection first (O-6). CANCELLED orders carry no backward
action: that state is terminal by decision. Also shown: a warning when **Marcar listo** is pressed
  on an order with no linked production run ("este pedido no tiene producción vinculada — ¿continuar?")
  — a warning, never a block (O-4).

**Target order UI (KOK-204…208):** keep the existing active/history board and its bounded
pagination, but use `/orders/:id` as the canonical detail with a stable deep link, full edit
form, lifecycle actions, related-work references, linked cash-event timeline and separate
amounts for merchandise agreement, additional customer charge, receipts, expected/actual debt,
excess, product gross margin and order cash result. Keep `/orders?open=<id>` as a compatibility
redirect to the same page. A drawer is not the primary editing/detail surface after KOK-208.
KOK-204 provides shared finance commands and the relationship in Finance reads, but does
not add a Finance order picker or an interim drawer-based order payment flow. KOK-208 makes
the page the creation surface: its expense/income/refund buttons open the familiar Finance
forms with the current PED already fixed as context; income categories include deposit,
order balance and other income (the last does not settle debt). Saved rows appear in both the order
timeline and the Finance movements table. Backend commands take the order ID directly,
without any session intermediary or reliance on the current drawer.

The customer amount is merchandise `agreed_total + additional_charge`; the charge does not
require a provider payment and may differ from one or several order-linked delivery expenses.
Order receipt actions accept multiple manual ORDER_DEPOSIT and ORDER_BALANCE incomes with
independent account/date/amount and their own ING codes; refunds are separately captured
ORDER_REFUND expenses. Finance edits/delete/restore are available for those manual rows in any
order status. Purchases and their derived expense retain the purchase as the editable source;
an order relationship is an additional association. Do not show a standalone edit action on a
purchase-owned finance row. Do not automatically create money on confirm/deliver/cancel/undo.
Undo delivery always presents the stock/cost impact preview (R-5), including after collection,
and never changes finance rows or account balances. Cancelled orders retain cash history, show
no collectible debt and permit explicit refunds without reopening the agreement.

Before delivery, label `max(customer amount − qualifying receipts, 0)` as expected balance, not
a receivable. Only delivered orders with a positive derived balance appear in the history's
"to collect" filter and SC-21; a later partial receipt refreshes that balance immediately.
Show overpayment/tips separately even when debt is zero. Show product gross margin after delivery
from the active sale's frozen line COGS, and show order cash result (all linked active income minus
all linked active expenses) independently; never call the latter gross margin. An agreement edit
is permitted in QUOTING/CONFIRMED/IN_PRODUCTION/READY even below receipts, displaying excess;
the customer is locked once any receipt exists. DELIVERED requires undo before agreement/line
edits; CANCELLED is terminal. Product production and purchase links remain visible across states.

## SC-05 · Production list — `/production` (UC-02)

Table: código (KOK-185, Doc 04 §3.6), fecha, receta, tandas, salida real vs esperada (yield %),
costo total, costo unitario, sesión, pedido. New run flow: pick recipe → batches → **consumption lines prefilled from recipe,
editable** → actual output qty → indirect cost. Shows live computed unit cost before commit
(`CalcTrace` shows C-4 formula).

**Phase 3.2 changes to the form (full page per the amendment above):**

- **"Sin receta" mode** (KOK-144): `recipe_id` is optional; the output item is chosen manually and
  consumption lines are entered directly. Real costing is unaffected — C-4 always used actual
  consumption, the recipe only prefilled.
- Actual output **recomputes when `batches` changes** (it only prefilled on recipe pick before),
  without overwriting a hand-edited value; the unit shows the output item's name ("kg de Masa
  madre activada") and unit cost reads "Bs/[output unit]" (KOK-117).
- **Per-ingredient stock indicator** (KOK-116): check / "!" as a warning only, never a block
  (INV-8); unmetered items (Agua, C-9) show a neutral "No medido" dash rather than a false check.
- **Order picker** (customer + date) offering every order except DELIVERED/CANCELLED (KOK-137).
  Built from scratch — no such picker exists today — and it ships with the missing server-side
  validation of `custom_order_id` (existence + status), which the service does not perform.
- The extra-cost field is renamed and carries a tooltip stating it is an estimate that moves no
  money (KOK-118) — the requested "estimado/real" toggle was rejected as meaningless here.
- Session is resolved automatically (Doc 03 S-1); the form shows which session the run will join
  rather than asking her to pick one.

## SC-06 · Recipes — `/production/recipes` (UC-15)

Recipe list by output item; editor: output item, expected yield, `LineEditor` of ingredients
(RAW_MATERIAL/SEMI_FINISHED only — PACKAGING is never offered here, KOK-1xx), est labor min,
default toggle. Panel: current
theoretical cost at WAC and at replacement cost per output unit (C-3) with margin preview
against sale price. **Recipes are not where packaging or bundling lives** — that is SC-19's
assembly definitions (Doc 03 §3). The "Notas" field is labelled **Preparación** (KOK-104), and the
"el ítem de salida no tiene precio de venta" note appears only for output kinds where a price is
actually expected (KOK-117). A `mm:ss` timer can be started from a recipe and continues in the
topbar after navigating away (KOK-149).

Expected yield and every ingredient quantity include an explicit selector limited to units
compatible with the resolved item's canonical unit. New or changed items clear the number and
default to the small unit when available; edit mode infers the initial unit from saved magnitude.
The selector remains stable while typing, and submit converts the display value to canonical
milli-units without adding the display unit to the recipe command.

## SC-07 · Purchases list — `/purchases` (UC-01, UC-18)

Table: código (KOK-185, Doc 04 §3.6), fecha, proveedor, items, total, cuenta, sesión, foto icon
(R2 signed URL viewer). The
**receipt photo stays in full** — removing it was requested and then reversed on 2026-08-11,
partly because dropping the column would also close the door on receipt OCR. Row →
detail drawer with Editar/Eliminar (KOK-024). Form (full page in Phase 3.2, shared by create and
edit, `PurchaseForm`), with the computed total and "se descontará X de la cuenta Y" pinned to the
footer (KOK-112) and one `PaymentAccountPicker` instead of separate method/account fields:
`LineEditor` (item, qty, line total → unit cost preview + Δ vs previous replacement cost
highlighted, the inflation signal), account, supplier, optional order association (KOK-204; any
order status), photo upload and session. The purchase remains the finance row's source owner; its
optional PED association is separate and follows purchase edits/regeneration. Eliminar commits
immediately (R-3, principle 6) with a 10s "Deshacer" undo toast; both edit and delete fall back to
an impact-confirmation dialog instead of the toast when the change would move already-booked cost
(R-5) — see UC-18 and Doc 06 principle 6 for the general pattern this and SC-08's Salidas tab
both follow.

## SC-08 · Inventory — `/inventory` (UC-09, UC-10, UC-18)

Tabs:

- **Stock** (default): v_stock table — item, kind, on hand, min, WAC, replacement cost, stock
  value; low-stock and negative-stock (INV-8 flag) rows pinned on top. Row → **Kardex** drawer
  (`KardexView`).
- **Salidas** (exits): list (código, KOK-185, Doc 04 §3.6, leading the columns) + form (item, qty,
  reason, session) showing valued cost; the item's
  unit sits next to **Cantidad** (KOK-107). "Costo invisible **del periodo**" by reason, over an
  arbitrary day range rather than only whole calendar months (KOK-114 — this changes the
  aggregation, not just the label). Row → detail drawer (`ExitDetailDrawer`, KOK-024) with
  Editar/Eliminar, same edit-form-reuse / immediate-delete-with-undo-toast /
  impact-confirmation-on-R-5 pattern as SC-07's Purchases screen.
  **Phase 3.2 (KOK-128):** the form gains optional **packaging lines** for an exit of an
  *unassembled* product (gifting an unbagged loaf in a bag with a label). Default is none;
  packaging is suggested only when the exited item is not itself an assembled presentation; an
  exit of a presentation never offers them, because its WAC already contains its packaging.
- **Conteos** (counts): count sessions, listed with their own código (KOK-185, Doc 04 §3.6); new
  count → item checklist (filter by category) with
  expected vs counted; commit shows variance summary and creates ADJUST movements.
  **Phase 3.2 (KOK-141):** the count is a **full page**, not a drawer — for legibility on a long
  checklist, not for data loss: counted quantities already save on blur — and a DRAFT count can
  finally be **cancelled, which deletes it**
  (soft, audit-reversible). No "Cancelado" status exists; a count that never committed produced no
  movements and has nothing to display as a state. Each count-line response carries the item's
  **current catalog name and canonical unit** (Doc 04 §2, §3.3), so the detail page does not fetch
  the whole catalog; only `expected_qty` is a count-start snapshot. The detail page distinguishes
  loading, request error (with an explicit retry), and a verified empty count in Spanish, and never
  substitutes a blank name or `UNIT` when identity is unavailable.

## SC-09 · Sessions — `/sessions` (UC-14)

List: código (KOK-185, Doc 04 §3.6), fecha, tipo, duración, costos compartidos, eventos vinculados
(count chips), Bs/h de la sesión (S-4). Open-session banner. Form: type, start/end or duration, `session_costs` editor
(label, amount, is_estimate, account), linked events viewer. Closing a PRODUCTION session
triggers shared-cost allocation (S-3) and shows the resulting per-run cost updates.

**Phase 3.2 (KOK-131…KOK-135):**

- **Two explicit form modes.** *Iniciar ahora* (one or two clicks, current time) and *Registrar
  sesión pasada* (date + start + end **or** duration, mutually exclusive and validated) — the
  latter creates the session already **CLOSED** in one step. (Today it always lands OPEN — that is
  the current design, not a slip: `status` is hardcoded on create and the command schema has no
  such field. We are changing the decision, so schema, service and form move together.) A start time is always required (Doc 03 S-2). The unlabelled number beside a shared cost is
  the **amount in Bs** and gets a visible label; its placeholder follows the session type
  ("Combustible o Transporte" / "Energía eléctrica Horno").
- **Week calendar** (`SessionCalendar`): cards by hour, click → detail, no drag/resize, green dot
  for an open session at a default one-hour size. No "sin horario" lane.
- **Add events to a session from its detail** (KOK-133), open or closed. Adding a run to a
  **closed** production session re-runs the S-3 allocation atomically — today it does not, which is
  a real gap — and can move historical costs, so it shows the R-5 impact warning first.
- **Hours are shown two ways when they differ** (S-5, KOK-135): the session's own duration, and the
  deduplicated wall-clock total used for the monthly Bs/hora, with copy explaining why overlapping
  sessions are counted once.

## SC-10 · Finance — `/finance` (UC-11, UC-12, UC-13)

Header: account cards (Banco, Caja chica) with balances + "Transferir" + "Retiro personal"
actions; liability strip: Anticipos de clientes (v_liability) + Por cobrar (v_receivables). The
Por cobrar amount is a link to SC-21 and displays the same global outstanding total as the Panel.
**KOK-204:** Finance shows a direct PED association in its own column, separate from "Origen";
the latter still identifies a purchase, sale or session that owns a derived transaction. **Target
KOK-206:** label the first metric as pre-delivery order cash exposure (Doc 04 §3.4.1), not a
status-released deposit liability, and reconcile the independent payments across Finance consumers.
Finance has no order picker to create or reassign order-linked finance rows: order-page actions
(KOK-208) supply the direct association, while Finance remains a list and manual-row editor.
Table: all financial_transactions (fecha, código, cuenta, tipo, categoría, monto signed-colored,
descripción, source-event link). System-owned rows (with source_event) are read-only here with
"editar el evento origen" link (Doc 04 §5). Forms: gasto operativo / otro ingreso; transfer
(from→to, amount); withdrawal (account, amount).

**Phase 3.2:** manual rows (no `source_event_id`) become **editable and deletable** — transfers as
an atomic pair via `counterpart_tx_id`, deletion soft and audit-reversible (KOK-146).

**Codes (KOK-185, Doc 04 §3.6) — supersedes the code-related text this row originally carried.**
The **código** column shows each manual row's own `GTO-`/`ING-`/`RET-`/`TRF-` code directly (both
legs of a transfer share one); a system-owned row shows nothing in that column, because the
source-event label already carries the identity that matters — it reads e.g. **"Compra
CMP-0031-2026 · 12/08"** rather than the bare "Compra · 12/08" this screen showed before a code
existed to put there. KOK-147's original premise here — *"no internal IDs are exposed — events
have no short human code and the internal ones are unreadable UUIDs, and inventing a code system
was considered and rejected as unnecessary"* — **was reversed** (Issue #44 §B-4; the owner hit
exactly the problem that decision predicted would not matter). That reversal made this row's own
deliverable *easier*, not harder: the label was always going to need something readable to show,
and now that something already exists everywhere else in the system instead of being invented
one-off for Finanzas.

## SC-11 · Cash flow report — `/reports/cashflow`

Monthly/weekly matrix by category (v_cashflow_daily rolled up); net flow line chart; in/out
stacked bars; period comparison.

## SC-12 · Price health — `/price-health` (G2, C-5)

The anti-decapitalization screen. It answers one question — **"¿qué precio subo esta semana?"** —
so everything on it must be actionable today; trends belong in SC-13.

Table of FINISHED items — **presentations and combos included, each with its own price, WAC and
composite replacement cost (C-3d)**; a combo whose historical margin looks healthy while its
replacement margin has fallen below the threshold is exactly the case this screen exists to catch
(Phase 3.2, KOK-127). Columns: precio, WAC, costo de reposición, margen histórico, **margen real
(reposición)** with `MarginBadge`, **sugerencia de precio** para margen objetivo
(`price_suggested = replacement_cost / (1 − min_margin_pct)` — the owner asked whether to remove
this column and the decision on 2026-08-11 was to **keep it visible**: it is the only direct answer
the system gives to "¿a qué precio subo?"), and **antigüedad del precio** —
days since the last `price_history` row versus days since `replacement_cost_updated_at` moved
(KOK-075). In an inflationary context the stale price, not the wrong price, is what
decapitalizes: this column is the screen's to-do list. Action: "Actualizar precio" → writes
price_history + items.sale_price.

**Headline chart — "Dinero en riesgo" (KOK-074):** horizontal bars, top 5 catalog items
(`sales.channel = 'CATALOG'`, custom orders excluded) ranked by
`last-30-day qty × (price − replacement cost)` versus the same volume at the target margin.
Ranking by Bs at stake rather than by margin % is deliberate — "margen 8%" prompts nothing;
"este producto te dejó Bs 340 este mes, a costo de hoy te deja Bs 40" prompts a price change.

**Row drawer — price vs real cost (KOK-076):** `price_history` as a step line against that
item's actual `unit_cost_snapshot` per sale, plus `replacement_cost_history` once KOK-073 has
accumulated points.

## SC-13 · Reports — `/reports`

Sub-reports (tab per report): Ventas (by product/channel/time), Producción (yields, unit-cost
trend per item), Mermas (v_waste), Horas y rentabilidad (hours by session type, session Bs/h,
monthly owner Bs/h trend — G3), Retiros (owner withdrawals vs profit). Each: chart + table +
CSV export.

**Ventas must separate two layers once combos exist (ADR-018):** *ofertas vendidas* — units,
revenue, COGS and margin per presentation/combo, the accounting metric — and *alcance de producto*,
an informational count of how many units of a product were sold directly versus included in combos
("Pan: 20 directos + 8 en combos = 28"). Combo revenue is **never** split across its components as
if it were observed revenue; the customer bought the bundle. If such a split is ever wanted it must
be labelled an estimated analytical allocation.

**Horas y rentabilidad shows both hour totals (S-5):** the sum of session durations and the
deduplicated wall-clock total that feeds the monthly G3 figure, with the difference explained
rather than hidden.

**Tab "Salud del negocio" (Phase 5.5)** — the depth layer behind the dashboard's headline
numbers, ordered by how often it changes a decision:

1. **Pareto de contribución** (KOK-077) — gross margin **Bs** per product, last 90 days,
   ranked and cumulative. The best seller is frequently not the money maker; this is usually the
   most surprising chart the owner sees.
2. **Bs/hora por producto** (KOK-079) — contribution ÷ production hours per output item (G3
   promises "by product" and nothing delivers it yet). For an artisan whose bottleneck is her own
   hands, this outranks margin %.
3. **Canasta de insumos** (KOK-078) — weighted purchase unit cost of the top raw inputs,
   indexed to 100 at a baseline month, from `purchase_lines`. The honest inflation instrument:
   "tus costos subieron 18% desde marzo", built only from what she actually paid.
4. **Posición real vs nominal** (KOK-080) — weekly net position (Doc 13) from `daily_snapshots`,
   plotted nominal and deflated by the index above, with owner withdrawals overlaid.
   Anti-descapitalización made literally visible: nominal growth lies under inflation.
5. **Ganancia y Bs/hora semanal** (KOK-081) — 4-week rolling, because weekly opex is lumpy.

Copy discipline for this tab: each chart carries one plain-Spanish sentence stating what it
means, not what it plots. A chart the owner cannot act on does not belong here.

## SC-14 · Assistant chat — `/assistant` (UC-16, UC-17)

`ChatPanel`: streaming answers, tool-activity indicator ("consultando ventas…"), inline charts
from `chart` blocks, suggested starter questions. Draft cards (`ConfirmDraftCard`) when the
user asks to record something from chat (same confirmation rule A-1).

## SC-15 · Catalog — `/settings/catalog` (UC-15)

Items table (kind/category filters, kind now includes PACKAGING), **ordered by kind**
(RAW_MATERIAL → SEMI_FINISHED → FINISHED → PACKAGING, KOK-110): name, unit, kind, category,
price (FINISHED), min stock, aliases (chips, editable), active toggle. RAW_MATERIAL item form
adds a "No medido" (`isUnmetered`) toggle (KOK-1xx, C-9) — when on, `minStockQty` is fixed to `0`
and `replacementCostMc` becomes a directly-editable field (no purchase ever sets it). Unmetered
items are excluded from `InventoryCount` screens. Merge-duplicates utility (re-points FKs,
one-way).

**Phase 3.2:** the drawer gets a pencil icon and an "Editar ítem" title; choosing a kind prefills
category and unit (PACKAGING → No comestible + Unidad; RAW_MATERIAL/SEMI_FINISHED → kg; FINISHED →
Unidad) **in create mode only**, so it never overwrites an edit (KOK-110). A **"Tengo stock
inicial"** toggle (qty + unit cost) creates an opening balance in the same atomic batch, reusing
C-8's `OPENING_IN` mechanism rather than inventing a second valuation path — available here and in
the inline create from Recetas (KOK-145). Phase 3.5 extends this option to inline item creation
from component lines in the Envasar form (KOK-195). The Alias tooltip carries the owner's own
example ("Pan integral de 300 gr = Pint3") and explains that aliases drive search today and item
matching for the Phase 4 assistant (KOK-108).

## SC-16 · Settings — `/settings` (UC-20)

app_settings editor: umbral de margen, % anticipo por defecto, hora de alertas, alert toggles;
modelos de IA (`ai_model_text` / `ai_model_audio` / `ai_model_transcribe`, Doc 05 §1.1) with a
"probar" button that runs one eval fixture against the configured model;
account opening balances (initial setup only); backup status (last R2 export + "descargar
respaldo"); Telegram link status; session/password change.

## SC-17 · AI Ops — `/settings/ai` (Doc 05 §8)

Interaction log table (input, pipeline, outcome, latency, tokens, cost); acceptance-rate and
cost charts; most-corrected-fields ranking; prompt version in use. Read-only.

## SC-18 · Login — `/login`

Password → session. Rate-limited (5 tries / 15 min). Nothing else.

## SC-19 · Presentations & combos — `/packing/definitions` (UC-22, Phase 3.2)

The definition editor for the Presentation/Combo model (Doc 03 §3, KOK-123). Deliberately a
sibling of SC-06 Recipes, not a tab inside it: a recipe answers "how is this food made", a
definition answers "how is it presented or bundled", and merging them is what produced the
duplicate-recipe-per-size problem in the first place.

List by output item, split into **Presentaciones** (one base product + its packaging) and
**Combos** (several finished presentations + outer packaging) — the same editor either way, the
distinction is what the lines contain. Editor: output item (FINISHED, unit `UNIT`), output qty,
`LineEditor` of components (SEMI_FINISHED / FINISHED / PACKAGING; RAW_MATERIAL is never offered —
raw inputs belong to a recipe), default toggle, notes. Panel: theoretical cost per output unit at
WAC and at **composite replacement cost** (C-3d) with a margin preview against the sale price, so
the owner can see a combo's margin before she ever assembles one.

Saving refuses a definition that reaches its own output item through any chain of components
(cycle prohibition, Doc 04 §5) — including indirectly, since C-3d's rollup and R-2's replay both
walk this graph.

## SC-20 · Envasar — `/packing` (UC-21, Phase 3.2)

**Placement amendment (owner Phase 3.2 test, Issue #30, 2026-08-16).** Envasar is a distinct
top-level operation, not a Producción sub-route: it has its own history at `/packing`, recording
at `/packing/new`, editing at `/packing/:assemblyId/edit`, and definition management at
`/packing/definitions`. `Assembly` and `AssemblyDefinition` remain the domain identifiers.

List: código (KOK-185, Doc 04 §3.6), fecha, presentación/combo, unidades armadas vs planeadas,
costo total, costo unitario, sesión, pedido. The **sesión** column shows the linked session's own
code, not its bare type label (F-57: three packings against three different PRODUCTION sessions
used to all read the identical word "Producción," with no way to tell them apart — the owner's
original ask that started KOK-185). New assembly flow (full page): pick definition → planned qty →
**component lines
prefilled from the definition, editable** → actual units obtained → notes. Live unit cost before
commit with `CalcTrace` showing C-10.

On `/packing/new`, when creating an item inline from a component line, the item form offers the
existing opening-stock option (initial quantity and unit cost), including for PACKAGING items
(KOK-195). After creation, select the item into the component line only when its saved kind and unit
still satisfy that line's existing eligibility; preserve its kind and canonical unit for compatible
quantity entry. It records the opening balance through KOK-145's `OPENING_IN` mechanism (Doc 03 C-8)
as part of item creation; it does not introduce a separate assembly valuation path.

Copy discipline for this screen, because the concept is new to the owner: it states plainly that
this event **moves no money** — it converts product and packaging already in stock into finished
units — and that the units she actually got, not the ones she planned, carry the cost, which is
where a broken bottle becomes visible. Order picker offering every order except
DELIVERED/CANCELLED (KOK-137); the session is resolved automatically (Doc 03 S-1). Row → detail
drawer with Editar/Eliminar on the KOK-024 pattern, including the R-5 impact confirmation when the
change is backdated (an assembly can move WAC in both directions and downstream through the
definition graph).

## SC-21 · Deudas por cobrar — `/receivables` (UC-25; UC-04 collection)

**Target KOK-206 (supersedes the custom-order portions below):** include each delivered
custom order with derived positive outstanding, grouped by customer alongside unpaid catalog
sales without double counting its generated sale. Show PED code, delivered sale date for aging,
customer price, cumulative qualifying receipts and remaining debt; subsequent partial
ORDER_BALANCE receipts reduce it immediately. Order collection opens the order-linked manual
receipt flow, accepting any positive amount (including a tip/excess); catalog-sale collection
retains the full-balance `collectPayment` flow. Cancelled/pre-delivery orders never appear as
receivables. The global unfiltered total, dashboard, Finance summary and alert job share this
projection. Link an order row to `/orders/:id` (KOK-208); preserve date/search filters and
loading/error/empty distinctions. Source sales retain their own code for inventory history.

**Purpose:** manage every sale balance customers still owe, independent of sale date. The owner can
answer “¿quién me debe, cuánto y por cuáles ventas?” and collect the complete balance from the same
place. The global total reconciles to the Panel and Finanzas; it is the sum of outstanding
remainders in `v_receivables`, never the full sale totals for custom orders when a deposit was
already received.

**Header summary:** Por cobrar total (all active receivables/all dates), clientes con deuda and
ventas pendientes. Search by customer name or sale code; sort customer groups by highest balance or
oldest debt, and optionally narrow by age in days. Search/age filters affect the list, not the
global summary figures. Age means days since the sale's `occurred_at`; the app has no due-date rule,
so copy must not call a debt “vencida”.

**Customer groups:** each group shows the customer name, their aggregate outstanding balance and
number of unpaid sales. Expanding it reveals each source sale: code, date, channel (Venta or Pedido),
sale total, deposit applied, remaining balance and days outstanding. A row opens the source sale
detail (`GET /api/sales/:id`) or linked custom-order detail (`GET /api/orders/:id`). Sales without
an identified customer appear as individual rows in a separate **Sin cliente** group; they are
never combined into a fictitious customer balance.

**Collection:** **Cobrar saldo** opens the existing UC-04 collection flow for that exact sale,
credits the selected account for the full outstanding amount and marks that sale paid. Partial
collection is not supported. On success, the debt disappears and totals refresh. A group's total is
not itself collectible because it may contain several separate sales.

**Data contract:** `GET /api/receivables` (KOK-197) reads the existing `v_receivables` view through
`core/`; it accepts customer/code search, a minimum-age filter, and pagination over customer groups.
The response includes an unfiltered global summary plus filtered group totals and each group's
source receivables in integer centavos. A direct collection reuses the existing
`POST /api/sales/:id/collect-payment`; no new write endpoint or stored customer balance is introduced.
Filters persist in the URL. Loading, request-error, no-debts, and no-filter-matches states are
distinct. On mobile, the summary stays first and customer groups collapse to readable cards with
the balance and collection action visible without horizontal scrolling.

## Onboarding flow (first run, wizard on empty DB)

1. Password acknowledgment → 2. Opening balances (bank, cash) → 3. Import/create starter catalog
   (offers the fixture bakery catalog as a template, editable) → 4. Recipes for main products →
2. Initial inventory count (sets opening stock via ADJUST) → 6. Link Telegram (deep-link
   `t.me/...` + `/start` code that records `chat_id`) → 7. "Registra tu primera venta" guided
   capture. Steps skippable; dashboard `EmptyState`s point back to unfinished steps.

**Amendment (KOK-020):** step 1 is acknowledgment-only, not an editable form — "Set password" as
originally worded implied a form, but the owner's password is a Cloudflare Worker secret
(`OWNER_PASSWORD_HASH`, provisioned via `wrangler secret put`), not a DB row. A running Worker
cannot rewrite its own secret, and reaching the wizard already requires a successful login
(SC-18), so a password necessarily already exists by the time step 1 renders. Step 1 instead
shows a one-line confirmation ("tu contraseña ya está configurada ✓") with no form and no
password-change action; changing the password remains an out-of-band `wrangler secret put`
operation. Steps 6–7 (Telegram link, first sale) are out of scope until their respective backlog
items (Phase 3/4) land — KOK-020 implements steps 1–5 only.

**Amendment (Phase 3.2, KOK-111).** Step 3's starter catalog ships with every FINISHED item's
**price empty**, and the step refuses to save until the owner has typed each one. The intent
behind the request was that the price be her decision rather than a number the system suggested;
this delivers that without weakening KOK-096's rule that a FINISHED item requires a price — it
moves *where* the requirement is satisfied. Also in this step: the decimal-separator helper appears
once in the step instructions rather than per field, the "Ir a configuración" buttons are gone, the
"siguiente" arrow aligns with "atrás", and the Conteo step's headers line up with its body columns
(KOK-109).

## Cross-screen flows

- **Por cobrar → explanation:** the Panel StatCard and Finanzas liability strip link to SC-21;
  every receivable alert also deep-links to its exact sale/customer context there.
- **Sales → debt management:** SC-02's **Gestionar deudas** link opens SC-21 without carrying the
  sales list's date range, so older debts remain visible.
- **Order lifecycle:** SC-04 is the hub; production runs created from an order card land linked
  (O-4); delivery creates the sale visible in SC-02 with channel CUSTOM_ORDER.
- **Telegram ✏️ deep edit:** magic link opens the exact drawer (`/sales?open=<id>`).
