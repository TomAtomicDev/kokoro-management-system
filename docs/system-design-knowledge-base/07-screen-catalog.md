# 07 — Screen Catalog

Web app screens (React SPA). Shared layout, table/drawer pattern, and components per
[06 — UX/UI Specification](06-ux-ui-specification.md). Every list screen supports: date-range +
entity filters, search, CSV export, row → `DetailDrawer` with edit and audit trail.

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

## SC-03 · Sale form (modal/drawer)

Two `LineEditor` sections (KOK-1xx): **products** (FINISHED items, price prefilled from
`items.sale_price`, editable) and **packaging** (PACKAGING items, price prefilled `0` — the owner
is not charging separately for the bag/label — editable for the rare priced case). Both post as
`sale_lines`, same WAC-snapshot and `SALE_OUT` mechanics regardless of kind. payment_status,
method+account when PAID, optional customer/session. Warnings: stock going
negative (amber, INV-8); price vs. replacement cost as a live `MarginBadge` (C-5, KOK-036) as the
price is typed, reading `GET /pricing-settings` for the threshold — replaces the earlier plain-text
"below replacement cost" warning. Shows a neutral "Costo pendiente" label instead of the badge when
`replacementCostMc` is 0 (C-3 hasn't run for that item yet): a badge would otherwise misreport a
missing cost as a healthy 100% margin.

## SC-04 · Orders board — `/orders` (UC-05…UC-08)

`OrderBoard` columns = status (QUOTING → … → DELIVERED); cards show customer, delivery
date/place, agreed total, deposit paid/pending badge, balance. Card → drawer with full lifecycle
actions: **Confirmar** (captures deposit: amount default 50%, account) · **Iniciar producción**
· **Marcar listo** · **Entregar** (creates the Sale; balance: paid method/account or ON_CREDIT)
· **Cancelar** (REFUND/FORFEIT choice, O-3). Linked production runs and their costs → order
profitability panel (price − order-linked costs).

## SC-05 · Production list — `/production` (UC-02)

Table: fecha, receta, tandas, salida real vs esperada (yield %), costo total, costo unitario,
sesión, pedido. New run flow: pick recipe → batches → **consumption lines prefilled from recipe,
editable** → actual output qty → indirect cost. Shows live computed unit cost before commit
(`CalcTrace` shows C-4 formula).

## SC-06 · Recipes — `/production/recipes` (UC-15)

Recipe list by output item; editor: output item, expected yield, `LineEditor` of ingredients
(RAW_MATERIAL/SEMI_FINISHED only — PACKAGING is never offered here, KOK-1xx), est labor min,
default toggle. Panel: current
theoretical cost at WAC and at replacement cost per output unit (C-3) with margin preview
against sale price.

Expected yield and every ingredient quantity include an explicit selector limited to units
compatible with the resolved item's canonical unit. New or changed items clear the number and
default to the small unit when available; edit mode infers the initial unit from saved magnitude.
The selector remains stable while typing, and submit converts the display value to canonical
milli-units without adding the display unit to the recipe command.

## SC-07 · Purchases list — `/purchases` (UC-01, UC-18)

Table: fecha, proveedor, items, total, cuenta, sesión, foto icon (R2 signed URL viewer). Row →
detail drawer with Editar/Eliminar (KOK-024). Form (shared by create and edit, `PurchaseForm`):
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
- **Salidas** (exits): list + form (item, qty, reason, session) showing valued cost; monthly
  "costo invisible" total by reason (v_waste). Row → detail drawer (`ExitDetailDrawer`,
  KOK-024) with Editar/Eliminar, same edit-form-reuse / immediate-delete-with-undo-toast /
  impact-confirmation-on-R-5 pattern as SC-07's Purchases screen.
- **Conteos** (counts): count sessions; new count → item checklist (filter by category) with
  expected vs counted; commit shows variance summary and creates ADJUST movements.

## SC-09 · Sessions — `/sessions` (UC-14)

List: fecha, tipo, duración, costos compartidos, eventos vinculados (count chips), Bs/h de la
sesión (S-4). Open-session banner. Form: type, start/end or duration, `session_costs` editor
(label, amount, is_estimate, account), linked events viewer. Closing a PRODUCTION session
triggers shared-cost allocation (S-3) and shows the resulting per-run cost updates.

## SC-10 · Finance — `/finance` (UC-11, UC-12, UC-13)

Header: account cards (Banco, Caja chica) with balances + "Transferir" + "Retiro personal"
actions; liability strip: Anticipos de clientes (v_liability) + Por cobrar (v_receivables).
Table: all financial_transactions (fecha, cuenta, tipo, categoría, monto signed-colored,
descripción, source-event link). System-owned rows (with source_event) are read-only here with
"editar el evento origen" link (Doc 04 §5). Forms: gasto operativo / otro ingreso; transfer
(from→to, amount); withdrawal (account, amount).

## SC-11 · Cash flow report — `/reports/cashflow`

Monthly/weekly matrix by category (v_cashflow_daily rolled up); net flow line chart; in/out
stacked bars; period comparison.

## SC-12 · Price health — `/price-health` (G2, C-5)

The anti-decapitalization screen. It answers one question — **"¿qué precio subo esta semana?"** —
so everything on it must be actionable today; trends belong in SC-13.

Table of FINISHED items: precio, WAC, costo de reposición, margen histórico, **margen real
(reposición)** with `MarginBadge`, sugerencia de precio para margen objetivo
(`price_suggested = replacement_cost / (1 − min_margin_pct)`), and **antigüedad del precio** —
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

Items table (kind/category filters, kind now includes PACKAGING): name, unit, kind, category,
price (FINISHED), min stock, aliases (chips, editable), active toggle. RAW_MATERIAL item form
adds a "No medido" (`isUnmetered`) toggle (KOK-1xx, C-9) — when on, `minStockQty` is fixed to `0`
and `replacementCostMc` becomes a directly-editable field (no purchase ever sets it). Unmetered
items are excluded from `InventoryCount` screens. Merge-duplicates utility (re-points FKs,
one-way).

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

## Cross-screen flows

- **Alert → action:** every alert (bell or Telegram digest) deep-links to the filtered screen
  (low stock → SC-08 filtered; margin → SC-12 row; receivable → SC-02 "Por cobrar").
- **Order lifecycle:** SC-04 is the hub; production runs created from an order card land linked
  (O-4); delivery creates the sale visible in SC-02 with channel CUSTOM_ORDER.
- **Telegram ✏️ deep edit:** magic link opens the exact drawer (`/sales?open=<id>`).
