# 06 — UX/UI Specification

Two surfaces, one design language:

- **Telegram** — capture and quick answers. Optimized for one thumb, ≤ 3 interactions per event.
- **Web app (desktop-first, responsive)** — tables, charts, editing, configuration, analytical
  chat. Usable on mobile browser as read-mostly fallback.

UI language: **Spanish (es-BO)**. All UI strings live in `packages/shared/i18n/es.ts` (single
locale file; the indirection exists for consistency and future locales, not translation now).
Currency `Bs 1.234,50` (space, comma decimals); dates `lun 6 jul` / `06/07/2026`.

> **Source of truth for the design language:** `.design/foundations/DESIGN_BRIEF.md` (experience
> principles, aesthetic direction, philosophy) and `.design/foundations/DESIGN_TOKENS.md`
> (palette, typography, WCAG verification, dark mode). Both were produced with the owner against
> Kokoro's actual brand manual — this section summarizes their outcome; **any future design work
> (new screens, new components, token changes) starts from those two documents, not from this
> summary.** If §3 below and the code (`apps/web/src/styles/globals.css`,
> `apps/web/src/lib/chart-theme.ts`) ever disagree, the code + `.design/foundations/` win, and
> this document needs a D-6 amendment.

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
   (INV-10) instead of "¿Estás segura?" walls. Exceptions: order cancellation with deposit
   (explicit refund/forfeit choice, O-3), and any create/edit/delete/restore whose cost-replay
   impact requires confirmation (R-5, ADR-016) — that one genuinely needs the owner's informed
   yes before it commits, not an after-the-fact undo window (KOK-024).

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

Philosophy: **quiet utilitarian calm** — the app is a tool that gives the owner certainty amid
the uncertainty of running her business alone, not a vehicle for the Kokoro customer-facing
brand. Typography, spacing, alignment, and tabular numbers carry the visual language; **color is
a scarce semantic accent (≤ ~5-8% of any screen), never decoration.** Full rationale in
`.design/foundations/DESIGN_BRIEF.md`.

- **Base:** Tailwind CSS v4 + shadcn/ui (Radix), `cssVariables: true` — token names follow
  shadcn conventions (`background`/`foreground`, `card`, `primary`/`primary-foreground`,
  `muted`, `destructive`, `border`/`input`/`ring`) so future shadcn components map onto them
  without renaming. Icons: lucide-react.
- **Typography — two-tier, brand type stays OUT of the product UI:**
  - **Product UI face = Inter** (`--font-sans`). A neutral humanist grotesque chosen to
    *disappear* — the same reasoning Linear/Stripe/Notion/Figma apply to dense data products.
    Montserrat (the brand manual's body face) is explicitly **not** used in the UI: its
    geometric, high-presence letterforms read as "heavy" over hours of tables and forms.
  - **Brand faces are brand-only.** Cinzel (`--font-brand-display`) and Montserrat
    (`--font-brand-text`) appear in exactly **three places**: the sidebar wordmark, the login
    screen, and first onboarding. Never in empty states, headings, or any daily-flow surface —
    every sighting flips the user from "tool" mode to "brand" mode.
  - Weight discipline: 400 body / 500 labels / 600 buttons & section headers / **700 reserved
    for KPI figures and page titles only**. Never 800+/Black. `font-variant-numeric:
    tabular-nums` mandatory in all numeric columns (`.numeric-cell` utility).
- **Color — two browns, split by job:**
  - `--brand` (Brand Brown, close to the Kokoro wordmark) — **brand moments only**: the sidebar
    wordmark, login, onboarding illustration. Never a control color.
  - `--primary` (**UI Ink** — a near-black, desaturated warm espresso) — the interactive color
    everywhere else: primary buttons, active nav, focus ring (`--ring`). Dark enough that it
    reads as **emphasis/hierarchy, not "a brown button"** — this is what keeps the tool from
    feeling like the customer-facing packaging. In dark mode `--primary` **inverts** to a warm
    parchment/tan fill with espresso text (the ink-as-primary trick is inherently light-mode).
  - Neutrals are near-white with **tiny luminance steps** (canvas ~98%L, card 100%, sidebar
    ~97%) — warmth comes from hue, not from beige mass, so tables and cards keep contrast.
  - Semantics, assigned by **function only** (never by product category — no
    bakery-brown/pastry-pink/matcha-per-line coloring): `--positive` (matcha-tuned green —
    income, margin-OK, growth), `--negative` (an *alive*, only lightly warmed red — reserved for
    real problems: below-replacement-cost price, negative balance; kept legible enough that
    Price Health warnings are impossible to ignore, never for ordinary expenses), `--warning`
    (ochre, contained use). **No `--info`/blue** — removed; a fifth hue only adds noise.
  - Every semantic color and `--muted-foreground` is WCAG 2.1 AA-verified (4.5:1 as small text,
    including in its paired `-bg` well). The one deliberate exception is
    `--subtle-foreground` (placeholder/disabled text only, ~3:1) — never used for meaningful
    content. Resting borders (`--border`, `--input`) are intentionally soft and are **not** the
    accessibility guarantee for interactive boundaries; `--ring` (≥14:1 both modes) carries that
    guarantee at focus.
  - Canonical values: `apps/web/src/styles/globals.css`. Full contrast verification and the
    dark-mode inversion rationale: `.design/foundations/DESIGN_TOKENS.md`.
- **Charts:** Recharts styled per the dataviz skill conventions at build time; one categorical
  palette defined once in `web/src/lib/chart-theme.ts` (ink → matcha green → muted brand-brown →
  ochre → dusty clay → muted slate), plus a `chartSemantic` export so meaning-bearing lines
  (e.g. Price Health's price-vs-replacement-cost chart) always use `--negative`/`--positive`
  rather than whatever slot the categorical ramp assigns. Charts are the one deliberate carve-out
  from the color-budget rule above.
- **Motion:** restrained durations (50/150/220/360ms), standard easing curves, **no
  bounce/spring easing** (a playful bounce contradicts "calm support over alarm," UX principle
  6). `prefers-reduced-motion` respected globally.

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
| `EmptyState` | per-list guidance + primary action ("Registra tu primera compra"); **standard UI type only, never Cinzel** — empty states are daily-flow surfaces, not a brand moment (§3) |
| `UndoToast` | soft-delete undo (principle 6); shipped as a hand-rolled `ToastProvider`/`useToast` (no new dependency, D-10), not a third-party toast library |
| `ImpactConfirmDialog` | the principle-6 exception: shows a replay's affected counts + `cost_delta` (R-5, ADR-016) and requires explicit confirm/cancel before an edit/delete/restore commits (KOK-024) |

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
