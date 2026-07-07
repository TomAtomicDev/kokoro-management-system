# 06 — UX/UI Specification

Two surfaces, one design language:

- **Telegram** — capture and quick answers. Optimized for one thumb, ≤ 3 interactions per event.
- **Web app (desktop-first, responsive)** — tables, charts, editing, configuration, analytical
  chat. Usable on mobile browser as read-mostly fallback.

UI language: **Spanish (es-BO)**. All UI strings live in `packages/shared/i18n/es.ts` (single
locale file; the indirection exists for consistency and future locales, not translation now).
Currency `Bs 1.234,50` (space, comma decimals); dates `lun 6 jul` / `06/07/2026`.

## 1. UX principles (derived from product principles, Doc 01 §6)

1. **Three-tap capture.** Any event from Telegram: message → confirm → done. The web quick-add
   bar mirrors this.
2. **Never block, always flag.** Negative stock, missing session, unusual amounts → inline
   warnings (amber), never modal errors that discard input (INV-8).
3. **Derived numbers are visibly derived.** Computed fields (WAC, margins, balances) render with
   a subtle "calculado" affordance and are never editable; tapping shows the calculation trace
   (e.g., kardex behind a stock figure).
4. **Replacement-cost red.** Wherever a price/margin appears, margin-at-replacement is the
   prominent figure; below-threshold items are consistently marked (⚠ amber < threshold+5pp,
   ✖ red < threshold) across dashboard, tables, and chat.
5. **Everything editable from where you see it.** Every event row opens its edit form; every
   dashboard number links to its underlying list filtered accordingly.
6. **Undo over confirm-dialogs.** Destructive actions use soft delete + 10 s "Deshacer" toast
   (INV-10) instead of "¿Estás segura?" walls. Exception: order cancellation with deposit
   (explicit refund/forfeit choice, O-3).

## 2. Web app — navigation & layout

Persistent left sidebar (collapsible to icons), topbar with global search (⌘K), quick-add
button (`+ Registrar`), alerts bell, and open-session indicator chip (e.g., "🟢 Producción
2h 15m").

```
Sidebar:
  ◉ Panel            /                    (dashboard)
  ◉ Registrar        (menu of quick-add forms; also topbar +)
  ── Operación ──
  ◉ Ventas           /sales
  ◉ Pedidos          /orders              (custom orders board)
  ◉ Producción       /production
  ◉ Compras          /purchases
  ◉ Inventario       /inventory           (stock, kardex, counts, exits)
  ◉ Sesiones         /sessions
  ── Dinero ──
  ◉ Finanzas         /finance             (accounts, transactions, transfers, withdrawals)
  ── Análisis ──
  ◉ Precios y márgenes /price-health
  ◉ Reportes         /reports
  ◉ Asistente        /assistant           (chat)
  ── ⚙ Configuración /settings  · 🤖 IA Ops /settings/ai
```

Layout grid: topbar 56px; sidebar 232px (64px collapsed); content max-width 1280px, 24px gutters.
List pages share one pattern: filter bar (date range, entity filters, search) → data table →
row click opens right-side **detail drawer** (view + edit) — not a page navigation, so the table
context is never lost. Mobile web: sidebar becomes bottom tab bar (Panel, Ventas, Inventario,
Finanzas, Más).

## 3. Design system

- **Base:** Tailwind CSS v4 + shadcn/ui (Radix). Icons: lucide-react. Font: Inter; tabular
  numerals (`font-variant-numeric: tabular-nums`) mandatory in all numeric columns.
- **Tokens (CSS variables, light + dark via `prefers-color-scheme` + toggle):**
  neutral background/surfaces; primary `--brand` (warm bread-amber 600); semantic:
  `--positive` (green 600, income/margin-ok), `--negative` (red 600, expense/margin-bad),
  `--warning` (amber 500), `--info` (blue 600). Money coloring rule: income/positive green,
  expense/outflow default ink (red reserved for *problems*, not for ordinary expenses).
- **Charts:** Recharts styled per the dataviz skill conventions at build time; one categorical
  palette defined once in `web/src/lib/chart-theme.ts`.

## 4. Reusable components (canonical inventory)

| Component | Purpose / contract |
|-----------|--------------------|
| `MoneyText` | Formats centavos → `Bs 1.234,50`; props: `signed`, `colorBySign` |
| `QtyText` | milli-units + unit → `1,5 kg`, `12 u` |
| `MarginBadge` | margin% with C-5 threshold colors (used everywhere margins appear) |
| `ItemPicker` | combobox over items + aliases, filter by kind; inline "crear ítem" |
| `CustomerPicker` | combobox + inline create |
| `DateRangePicker` | presets: hoy, ayer, semana, mes, 3m, año, personalizado |
| `EventTable` | TanStack Table wrapper: server pagination, column defs, row → drawer |
| `DetailDrawer` | right drawer with view/edit modes, audit trail footer ("editado 2 veces") |
| `QuickAddModal` | hosts every event form; opened from `+`, ⌘K, or dashboard shortcuts |
| `EventForm/*` | one form per event type; **same Zod schema as API/AI** (ADR-8) |
| `LineEditor` | multi-line editor (purchase/sale/recipe lines): item, qty, amount, per-row remove |
| `SessionChip` | topbar open-session indicator; click → close-session form (hours, costs) |
| `AlertsPanel` | bell dropdown: low stock, price health, negative stock, stale orders |
| `KardexView` | per-item movement table with running balance + source-event links |
| `CalcTrace` | popover explaining a derived number (formula + inputs) — principle 3 |
| `StatCard` | dashboard KPI: value, delta vs previous period, sparkline, link |
| `OrderCard` / `OrderBoard` | kanban-ish board by status, sorted by delivery date |
| `ChatPanel` | assistant chat: streaming, tool-activity indicator, renders `chart` blocks |
| `ConfirmDraftCard` | web rendering of an AI draft (same data as Telegram card) |
| `EmptyState` | per-list guidance + primary action ("Registra tu primera compra") |
| `UndoToast` | soft-delete undo (principle 6) |

## 5. Telegram UX

- **Free text is the primary interface** ("compré 5 kg de harina a 60"). Commands exist as
  discoverable accelerators: `/venta`, `/compra`, `/produccion`, `/pedido`, `/gasto`, `/stock`,
  `/caja`, `/sesion`, `/resumen`, `/ayuda` — each starts a guided mini-form with buttons.
- **Confirmation card format** (CAPTURE, A-1):

  ```
  🧾 COMPRA — hoy 10:32 · Caja chica
  • Harina 5 kg — Bs 60,00
  • Leche 10 L — Bs 80,00
  Total: Bs 140,00   (sesión: Compras 🟢)
  [✅ Confirmar] [✏️ Corregir] [❌ Descartar]
  ```

- **Receipts** after commit show the most useful post-state: stock after (production/exit),
  account balance after (money events), order status after (order events).
- Morning alert digest (07:00): low stock, margins below threshold, deliveries due today,
  receivables aging > 7 days. One message, grouped, silent-hours respected.
- ✏️ Corregir → the card lists numbered fields; the owner taps a field button and replies with
  the new value; card re-renders. Deep edits: "ábrelo en la web" link (magic link to the drawer).

## 6. Accessibility & quality bars

WCAG 2.1 AA contrast; all interactive elements keyboard-reachable (web); focus states visible;
touch targets ≥ 44px; charts always accompanied by a data table toggle; loading via skeletons
(no spinners > 300 ms alone); every mutation gives optimistic UI + server reconciliation via
TanStack Query invalidation.
