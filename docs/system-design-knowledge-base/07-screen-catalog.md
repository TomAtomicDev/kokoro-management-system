# 07 — Screen Catalog

Web app screens (React SPA). Shared layout, table/drawer pattern, and components per
[06 — UX/UI Specification](06-ux-ui-specification.md). Every list screen supports: date-range +
entity filters, search, CSV export, row → `DetailDrawer` with audit trail.

> **Phase 3.2 amendment (decided 2026-08-11, implementation pending).** Every **line-bearing event
> form** — Compra, Venta, Producción, Envasado/Armado, Pedido, Conteo — is a **full page with its
> own URL** and a pinned summary footer, not a modal or drawer (Doc 06 §2). Drawers keep the
> read-and-act role; small dialogs keep the single-decision role. Where a screen below still says
> "modal/drawer" for one of those forms, this amendment governs. List filters, tabs and date
> ranges persist in the URL; the default range on Ventas, Pedidos and Salidas is *start of month →
> today*, and **Pedidos filters by creation date**, not delivery date (KOK-114).

## SC-01 · Dashboard — `/`

**Purpose:** daily situational awareness; answers "¿cómo está el negocio hoy/este mes?"
**Content:** `StatCard` row — Caja total (bank+cash, with split), Ventas del mes (Δ vs prev),
Ganancia del mes (revenue − COGS − opex), Bs/hora del mes (G3), Valor de inventario;
AlertsPanel summary strip; "Pedidos próximos" (next 5 by delivery date); "Margen en riesgo"
top-5 from `listPriceHealth` (`core/costing/price-health.ts`, KOK-035 — margins are computed in
application code, not in `v_price_health`, per Doc 04 §4/KOK-069), presented as **Bs at risk**
rather than margin % (KOK-074); sales-last-30-days chart; quick-add shortcuts.
**Data:** daily_snapshots + live aggregates. Every number links to its source screen (UX-5).

**Business-health placement rule (2026-07-27).** The dashboard carries the _now_ layer only —
one number per question, each deep-linking to the screen that explains it. Ganancia and Bs/hora
gain an 8-week sparkline (KOK-081) but no axis and no second series: the trend lives one click
away in SC-13's "Salud del negocio" tab. Resist growing this screen into a report; the owner
opens it in thirty seconds between batches.

## SC-02 · Sales list — `/sales` (UC-03, UC-04, UC-18)

Table: fecha, canal, cliente, items resumen, total, margen (from `unit_cost_snapshot`), estado
pago (badge POR COBRAR), método. Actions: new sale, mark paid (account + method inline),
edit/delete. Filter presets include "Por cobrar" (v_receivables with aging).

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

`OrderBoard` columns = status (QUOTING → … → DELIVERED); cards show customer, delivery
date/place, agreed total, deposit paid/pending badge, balance. Card → drawer with full lifecycle
actions: **Confirmar** (captures deposit: amount default 50%, account) · **Iniciar producción**
· **Marcar listo** · **Entregar** (creates the Sale; balance: paid method/account or ON_CREDIT)
· **Cancelar** (REFUND/FORFEIT choice, O-3). Linked production runs and their costs → order
profitability panel (price − order-linked costs).

**Backward actions (Phase 3.2, KOK-136, O-6):** a **Volver atrás** action on cards in
CONFIRMED/IN_PRODUCTION/READY (one step, simple confirmation, no money moves), and **Deshacer
entrega** on a DELIVERED card — explicit confirmation plus an `ImpactConfirmDialog`, because it
deletes the sale delivery created and returns the deposit to the liability. It is **disabled with
an explanation when that sale has already been collected**: the money really arrived, and the
owner must reverse the collection first (O-6). CANCELLED cards carry
no backward action: that state is terminal by decision. Also shown: a warning when **Marcar
listo** is pressed on an order with no linked production run ("este pedido no tiene producción
vinculada — ¿continuar?") — a warning, never a block (O-4).

## SC-05 · Production list — `/production` (UC-02)

Table: fecha, receta, tandas, salida real vs esperada (yield %), costo total, costo unitario,
sesión, pedido. New run flow: pick recipe → batches → **consumption lines prefilled from recipe,
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

Table: fecha, proveedor, items, total, cuenta, sesión, foto icon (R2 signed URL viewer). The
**receipt photo stays in full** — removing it was requested and then reversed on 2026-08-11,
partly because dropping the column would also close the door on receipt OCR. Row →
detail drawer with Editar/Eliminar (KOK-024). Form (full page in Phase 3.2, shared by create and
edit, `PurchaseForm`), with the computed total and "se descontará X de la cuenta Y" pinned to the
footer (KOK-112) and one `PaymentAccountPicker` instead of separate method/account fields:
`LineEditor` (item, qty, line total → unit cost preview + Δ vs previous replacement cost
highlighted, the inflation signal), account, supplier, photo upload, session. Eliminar commits
immediately (R-3, principle 6) with a 10s "Deshacer" undo toast; both edit and delete fall back to
an impact-confirmation dialog instead of the toast when the change would move already-booked cost
(R-5) — see UC-18 and Doc 06 principle 6 for the general pattern this and SC-08's Salidas tab
both follow.

## SC-08 · Inventory — `/inventory` (UC-09, UC-10, UC-18)

Tabs:

- **Stock** (default): v_stock table — item, kind, on hand, min, WAC, replacement cost, stock
  value; low-stock and negative-stock (INV-8 flag) rows pinned on top. Row → **Kardex** drawer
  (`KardexView`).
- **Salidas** (exits): list + form (item, qty, reason, session) showing valued cost; the item's
  unit sits next to **Cantidad** (KOK-107). "Costo invisible **del periodo**" by reason, over an
  arbitrary day range rather than only whole calendar months (KOK-114 — this changes the
  aggregation, not just the label). Row → detail drawer (`ExitDetailDrawer`, KOK-024) with
  Editar/Eliminar, same edit-form-reuse / immediate-delete-with-undo-toast /
  impact-confirmation-on-R-5 pattern as SC-07's Purchases screen.
  **Phase 3.2 (KOK-128):** the form gains optional **packaging lines** for an exit of an
  *unassembled* product (gifting an unbagged loaf in a bag with a label). Default is none;
  packaging is suggested only when the exited item is not itself an assembled presentation; an
  exit of a presentation never offers them, because its WAC already contains its packaging.
- **Conteos** (counts): count sessions; new count → item checklist (filter by category) with
  expected vs counted; commit shows variance summary and creates ADJUST movements.
  **Phase 3.2 (KOK-141):** the count is a **full page**, not a drawer — for legibility on a long
  checklist, not for data loss: counted quantities already save on blur — and a DRAFT count can
  finally be **cancelled, which deletes it**
  (soft, audit-reversible). No "Cancelado" status exists; a count that never committed produced no
  movements and has nothing to display as a state.

## SC-09 · Sessions — `/sessions` (UC-14)

List: fecha, tipo, duración, costos compartidos, eventos vinculados (count chips), Bs/h de la
sesión (S-4). Open-session banner. Form: type, start/end or duration, `session_costs` editor
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
actions; liability strip: Anticipos de clientes (v_liability) + Por cobrar (v_receivables).
Table: all financial_transactions (fecha, cuenta, tipo, categoría, monto signed-colored,
descripción, source-event link). System-owned rows (with source_event) are read-only here with
"editar el evento origen" link (Doc 04 §5). Forms: gasto operativo / otro ingreso; transfer
(from→to, amount); withdrawal (account, amount).

**Phase 3.2:** manual rows (no `source_event_id`) become **editable and deletable** — transfers as
an atomic pair via `counterpart_tx_id`, deletion soft and audit-reversible (KOK-146). The
source-event column shows a readable **"Compra · 12/08"** label linking to the event; **no internal
IDs are exposed** — events carry no short human code and UUIDs are unreadable, and inventing a code
system was considered and rejected as unnecessary (KOK-147).

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
the inline create from Recetas (KOK-145). The Alias tooltip carries the owner's own example
("Pan integral de 300 gr = Pint3") and explains that aliases drive search today and item matching
for the Phase 4 assistant (KOK-108).

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

## SC-19 · Presentations & combos — `/production/presentations` (UC-22, Phase 3.2)

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

## SC-20 · Envasado/Armado — `/production/assemblies` (UC-21, Phase 3.2)

List: fecha, presentación/combo, unidades armadas vs planeadas, costo total, costo unitario,
sesión, pedido. New assembly flow (full page): pick definition → planned qty → **component lines
prefilled from the definition, editable** → actual units obtained → notes. Live unit cost before
commit with `CalcTrace` showing C-10.

Copy discipline for this screen, because the concept is new to the owner: it states plainly that
this event **moves no money** — it converts product and packaging already in stock into finished
units — and that the units she actually got, not the ones she planned, carry the cost, which is
where a broken bottle becomes visible. Order picker offering every order except
DELIVERED/CANCELLED (KOK-137); the session is resolved automatically (Doc 03 S-1). Row → detail
drawer with Editar/Eliminar on the KOK-024 pattern, including the R-5 impact confirmation when the
change is backdated (an assembly can move WAC in both directions and downstream through the
definition graph).

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

- **Alert → action:** every alert (bell or Telegram digest) deep-links to the filtered screen
  (low stock → SC-08 filtered; margin → SC-12 row; receivable → SC-02 "Por cobrar").
- **Order lifecycle:** SC-04 is the hub; production runs created from an order card land linked
  (O-4); delivery creates the sale visible in SC-02 with channel CUSTOM_ORDER.
- **Telegram ✏️ deep edit:** magic link opens the exact drawer (`/sales?open=<id>`).
