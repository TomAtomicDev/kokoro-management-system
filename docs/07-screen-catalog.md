# 07 — Screen Catalog

Web app screens (React SPA). Shared layout, table/drawer pattern, and components per
[06 — UX/UI Specification](06-ux-ui-specification.md). Every list screen supports: date-range +
entity filters, search, CSV export, row → `DetailDrawer` with edit and audit trail.

## SC-01 · Dashboard — `/`

**Purpose:** daily situational awareness; answers "¿cómo está el negocio hoy/este mes?"
**Content:** `StatCard` row — Caja total (bank+cash, with split), Ventas del mes (Δ vs prev),
Ganancia del mes (revenue − COGS − opex), Bs/hora del mes (G3), Valor de inventario;
AlertsPanel summary strip; "Pedidos próximos" (next 5 by delivery date); "Margen en riesgo"
top-5 from v_price_health; sales-last-30-days chart; quick-add shortcuts.
**Data:** daily_snapshots + live aggregates. Every number links to its source screen (UX-5).

## SC-02 · Sales list — `/sales` (UC-03, UC-04, UC-18)

Table: fecha, canal, cliente, items resumen, total, margen (from `unit_cost_snapshot`), estado
pago (badge POR COBRAR), método. Actions: new sale, mark paid (account + method inline),
edit/delete. Filter presets include "Por cobrar" (v_receivables with aging).

## SC-03 · Sale form (modal/drawer)

`LineEditor` (FINISHED items only, price prefilled from `items.sale_price`, editable),
payment_status, method+account when PAID, optional customer/session. Warnings: stock going
negative (amber, INV-8), price below replacement cost (red, C-5).

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
(RAW_MATERIAL/SEMI_FINISHED + packaging), est labor min, default toggle. Panel: current
theoretical cost at WAC and at replacement cost per output unit (C-3) with margin preview
against sale price.

## SC-07 · Purchases list — `/purchases` (UC-01)

Table: fecha, proveedor, items, total, cuenta, sesión, foto icon (R2 signed URL viewer). Form:
`LineEditor` (item, qty, line total → unit cost preview + Δ vs previous replacement cost
highlighted, the inflation signal), account, supplier, photo upload, session.

## SC-08 · Inventory — `/inventory` (UC-09, UC-10)

Tabs:
- **Stock** (default): v_stock table — item, kind, on hand, min, WAC, replacement cost, stock
  value; low-stock and negative-stock (INV-8 flag) rows pinned on top. Row → **Kardex** drawer
  (`KardexView`).
- **Salidas** (exits): list + form (item, qty, reason, session) showing valued cost; monthly
  "costo invisible" total by reason (v_waste).
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

The anti-decapitalization screen. Table of FINISHED items: precio, WAC, costo de reposición,
margen histórico, **margen real (reposición)** with `MarginBadge`, sugerencia de precio para
margen objetivo (`price_suggested = replacement_cost / (1 − min_margin_pct)`), fecha del último
cambio de precio (price_history). Action: "Actualizar precio" → writes price_history +
items.sale_price. Chart: margin erosion over time for a selected item (price vs replacement
cost lines).

## SC-13 · Reports — `/reports`

Sub-reports (tab per report): Ventas (by product/channel/time), Producción (yields, unit-cost
trend per item), Mermas (v_waste), Horas y rentabilidad (hours by session type, session Bs/h,
monthly owner Bs/h trend — G3), Retiros (owner withdrawals vs profit). Each: chart + table +
CSV export.

## SC-14 · Assistant chat — `/assistant` (UC-16, UC-17)

`ChatPanel`: streaming answers, tool-activity indicator ("consultando ventas…"), inline charts
from `chart` blocks, suggested starter questions. Draft cards (`ConfirmDraftCard`) when the
user asks to record something from chat (same confirmation rule A-1).

## SC-15 · Catalog — `/settings/catalog` (UC-15)

Items table (kind/category filters): name, unit, kind, category, price (FINISHED), min stock,
aliases (chips, editable), active toggle. Merge-duplicates utility (re-points FKs, one-way).

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

1. Set password → 2. Opening balances (bank, cash) → 3. Import/create starter catalog (offers
the fixture bakery catalog as a template, editable) → 4. Recipes for main products → 5. Initial
inventory count (sets opening stock via ADJUST) → 6. Link Telegram (deep-link `t.me/...` +
`/start` code that records `chat_id`) → 7. "Registra tu primera venta" guided capture.
Steps skippable; dashboard `EmptyState`s point back to unfinished steps.

## Cross-screen flows

- **Alert → action:** every alert (bell or Telegram digest) deep-links to the filtered screen
  (low stock → SC-08 filtered; margin → SC-12 row; receivable → SC-02 "Por cobrar").
- **Order lifecycle:** SC-04 is the hub; production runs created from an order card land linked
  (O-4); delivery creates the sale visible in SC-02 with channel CUSTOM_ORDER.
- **Telegram ✏️ deep edit:** magic link opens the exact drawer (`/sales?open=<id>`).
