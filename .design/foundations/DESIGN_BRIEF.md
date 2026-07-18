# Design Brief: Kokoro Management — Foundational Design Language

> Scope: this is the **product-wide design brief** for the web app (the desktop-first React SPA).
> It defines the design language that every screen, token, and component inherits. It is the input
> to the Information Architecture and Design Tokens work, and will be reconciled into the KB
> (Doc 06 — UX/UI Specification) once ratified. It does **not** re-specify individual screens
> (Doc 07) or the Telegram surface.

## Problem

She runs the entire business by herself — buying, baking, fermenting, selling, delivering,
collecting deposits, tracking cash in two places. Today it lives in her head and in Excel, and
that produces a constant, low-grade uncertainty: *Am I still making money now that flour costs
more? Is this cash mine or is it a customer's deposit I haven't earned yet? Do I actually have
that stock? Which product is quietly losing me money?* The doubt is exhausting. Excel only tells
her what she already typed, hours late, and never answers the question she actually has. Managing
the business alone means there is no one to check her math or catch the drift.

## Solution

A calm, clear tool that hands her **certainty at a glance**. The numbers that matter — cash,
margin at replacement cost, stock, what's owed, what's a deposit — are immediately visible and
trustworthy, computed by the system so she never doubts them. Capturing and reviewing takes
seconds. Nothing is cluttered, decorative, or confusing. It doesn't feel like another chore or
another thing to learn; it feels like a steady second pair of hands that already did the
accounting for her. The app is **for her**; Kokoro's brand — the part that makes *customers* feel
something — appears here only as a warm, quiet nod, never as costume.

## Experience Principles

1. **Certainty over decoration** — Every figure reads as trustworthy and is visibly system-derived
   (never hand-typed, never editable, one tap to see the calculation behind it). The interface
   never shows off, never makes her wonder whether a number can be believed. When in doubt between
   "prettier" and "clearer," clearer wins.

2. **The main thing, first, at a glance** — Ruthless hierarchy. On every screen the one number or
   action that matters most is the loudest thing; everything else recedes. She should find the
   principal thing in a second without reading. Depth (kardex, history, breakdowns) is always one
   click away and never in the way. Fast to the primary, calm about the secondary.

3. **Calm support over alarm** — The tool reduces anxiety, it doesn't add to it. Flag, never block
   (negative stock, unusual amounts, below-cost prices are warm inline warnings, not walls that
   discard her work). Undo over "are you sure?". A warm neutral canvas with color used *only* where
   it carries meaning — money direction, a real problem, a status — so that when something does turn
   red, she trusts it.

## Aesthetic Direction

- **Philosophy**: **Quiet utilitarian calm.** Functional minimalism — generous whitespace, restraint,
  few colors, strong typographic hierarchy — warmed from cold "tool gray" into Kokoro's natural
  palette. A distant echo of the brand's Japanese-inspired simplicity (*ma* / breathing room,
  beauty in the plain) expressed structurally through space and quiet, **not** through ornament.
  The brand is a *temperature*, not a theme.
- **Tone**: Calm, certain, warm, supportive. Unhurried in feel but efficient in use. Professional
  and honest, never loud, never "extravagant" (the brand's own word), never cute.
- **Reference points**: Linear (clarity and calm density), Stripe Dashboard (trustworthy financial
  numbers, restrained color), Things / Bear (warm, humane minimalism). Type that **disappears**
  (Inter/Geist-class neutral grotesques — the opposite of display personality). The warmth of cream
  paper and coffee ink from Kokoro's own labels — as *neutrals*, not as a headline.
- **Anti-references**: The Kokoro packaging worn literally (Cinzel headings everywhere, decorative
  flourishes, label frames) — that is the customer's brand, not her tool. **High-personality /
  geometric display type as a UI face** (e.g., Montserrat in tables). Loud SaaS dashboards
  (gradients, confetti, big colorful tiles competing for attention). Cold enterprise gray. Anything
  cluttered, modal-heavy, or that shouts promotions/alerts. Red used for ordinary expenses.

## Existing Patterns

The web app was scaffolded in Phase 0 and the KB (Doc 06) specifies a system that this brief
**revises** where it predates the brand manual. Current state:

- **Typography** (two-tier — brand type stays OUT of the product UI):
  - *Product UI face = **Inter*** (already referenced in `globals.css`, so zero new dependency). A
    neutral humanist grotesque that **disappears** — the choice of Linear, Stripe, Notion, Figma
    for exactly this dense-data job. The user never thinks "nice type," only "I understand my
    numbers." Geist is an acceptable alternative if a slightly more distinctive-but-still-neutral
    tone is later wanted. **Montserrat is NOT a UI face** — its geometric, high-presence, small-
    aperture forms are a *branding* face and read as "heavy" over hours of tables.
  - *Brand faces (Cinzel + Montserrat) are brand-only.* Cinzel appears in the product in only three
    places: **app wordmark, the login screen, and the very first onboarding.** NOT in empty states,
    headings, or any daily-flow surface — every Cinzel sighting flips the user from "tool" mode to
    "brand" mode and breaks the working state.
  - *Weight discipline*: restrained ramp — ~400 body / 500 labels / 600 buttons & section headers /
    **700 reserved for KPI figures only**; never 800+/Black (dominant, un-calm).
  - `font-variant-numeric: tabular-nums` mandatory in every numeric context.
- **Colors**: current tokens (bread-amber `#d97706` primary, cold zinc/stone neutrals, blue info)
  predate the brand manual and are **replaced wholesale**. The new model is deliberately low-chroma:
  warmth comes from *hue at near-white luminance*, not from beige mass; the interactive color reads
  as **ink/hierarchy**, not as a themed color; semantic color is a scarce resource. See §"Color
  model" below; exact values in Design Tokens.
- **Spacing / radius / elevation / motion**: **not yet defined** — only Tailwind defaults. To be
  established in Design Tokens (type ramp, spacing scale, radii, warm shadows, motion, component
  tokens).
- **Components**: `AppShell`, `Sidebar`, `Topbar`, `MobileBottomTabs`, route stubs exist; shadcn/ui
  (Radix) + lucide-react + Tailwind v4 are wired (`components.json`). The 20+ canonical components
  in Doc 06 §4 are specified but unbuilt. This brief **extends** that inventory, it does not replace it.

### Color model

Load-bearing decisions (exact hex in Design Tokens). Guiding idea, stakeholder-led: **the visual
language rests on typography, spacing, alignment, and tabular numbers FIRST — color is a scarce
semantic accent, not the medium.**

1. **Two browns, split by job.**
   - *Brand Brown* (close to the wordmark, a mid warm brown) — **brand moments only**: wordmark,
     login, onboarding, illustration. Never a UI control color.
   - *UI Ink* (a much darker, desaturated warm espresso — near-black) — the **interactive / primary**
     color: primary buttons, active nav, focus ring, active states. Dark enough that the brain reads
     it as **emphasis / hierarchy, not "brown"** ("important action," not "coffee button"). This is
     what keeps the app from feeling like the packaging.
2. **Near-white warm surfaces, tiny luminance steps.** Canvas ~98–99% L, cards 100%, sidebar ~97% —
   warm in *hue* but barely perceptibly colored, so tables keep contrast and inputs/cards never
   dissolve into beige after hours of use.
3. **Semantic palette — minimal, by function only** (never by product category: no bakery-brown /
   pastry-pink / matcha-per-line coloring in the UI):
   - **Green (matcha-tuned) = positive** — income, money in, healthy margin, growth. Kept: it
     carries meaning, not brand.
   - **Red = problem** — below-replacement-cost price, negative balance. Kept **alive** (only
     slightly warmed, *not* muted terracotta): "precio bajo reposición" on Price Health (a product
     pillar) must be impossible to ignore. Alarm legibility beats warmth here.
   - **Amber / ochre = attention / warning**, very contained.
   - **No blue, no "info" color** — removed. Brown = interaction, green = positive, amber =
     attention, red = problem is a complete set; a fifth hue only adds noise. Neutral info = ink + icon.
4. **Color budget: ≤ ~5–8% of any screen carries semantic color.** If green, red, and amber all
   shout at once, nothing communicates. Most of every screen is warm-neutral + ink; color earns its place.
5. **Charts are the one carve-out.** Multi-series data needs a small categorical palette (built per
   the dataviz skill in `chart-theme.ts`) — a harmonious, desaturated set derived from the neutrals +
   the two accents. It lives outside the 5–8% budget by nature, scoped to chart surfaces.
6. **Dark mode = warm espresso** (never cold charcoal). **Open item for tokens:** the "ink-as-primary"
   trick is inherently light-mode; in dark mode the interactive color inverts to a **warm parchment /
   tan** fill with espresso text, preserving the "reads as emphasis, not hue" spirit. Resolve exact
   behavior in Design Tokens.

## Component Inventory

Foundational + shell components. Per-feature forms/tables are enumerated in Doc 07 / IA; here we
capture the shared vocabulary the design language must define. Status is relative to what is *built*.

| Component        | Status         | Notes                                                                 |
| ---------------- | -------------- | --------------------------------------------------------------------- |
| AppShell         | Modify         | Re-skin to warm neutrals; verify grid (topbar 56 / sidebar 232/64).   |
| Sidebar          | Modify         | Warm palette, coffee active state; collapsible to icons.              |
| Topbar           | Modify         | Global search (⌘K), `+ Registrar`, alerts bell, SessionChip.          |
| MobileBottomTabs | Modify         | Panel · Ventas · Inventario · Finanzas · Más.                         |
| MoneyText        | New            | centavos → `Bs 1.234,50`; `signed`, `colorBySign` (green in / ink out).|
| QtyText          | New            | milli-units + unit → `1,5 kg`, `12 u`; tabular.                       |
| MarginBadge      | New            | C-5 threshold colors; the anti-decapitalization signal.               |
| StatCard         | New            | Dashboard KPI: value (loud), delta, sparkline, link. Principle 2.     |
| EventTable       | New            | TanStack Table wrapper; row → drawer; tabular numeric columns.        |
| DetailDrawer     | New            | Right drawer, view/edit, audit footer; context never lost.            |
| CalcTrace        | New            | Popover explaining a derived number (formula + inputs). Principle 1.  |
| UndoToast        | New            | Soft-delete undo, 10s. Principle 3 (undo over confirm).               |
| EmptyState       | New            | Per-list guidance + primary action. **No Cinzel** — daily-flow surface; Inter only. |
| AlertsPanel      | New            | Bell dropdown; grouped, calm, deep-links to filtered screens.         |
| ItemPicker / CustomerPicker | New | Combobox + inline create.                                             |
| LineEditor       | New            | Multi-line editor (purchases/sales/recipes).                          |
| QuickAddModal    | New            | Hosts every event form; three-tap capture on desktop.                 |
| SessionChip      | New            | Open-session indicator + close-session form.                          |
| ChatPanel / ConfirmDraftCard | New | Assistant chat + web draft card (later phase, same language).         |
| KardexView / OrderBoard / DateRangePicker | New | Domain components, inherit the same tokens.               |

## Key Interactions

- **Three-tap capture**: `+ Registrar` / ⌘K → QuickAddModal with the right form → confirm → done.
  Optimistic UI, server reconciliation via TanStack Query. The fast path is always visible.
- **Table → drawer, never a page jump**: clicking a row opens the right-side DetailDrawer for
  view/edit; the filtered table stays behind it so she never loses her place.
- **Flag, never block**: negative stock / unusual amount / below-replacement-cost price render as
  inline amber (or red for below-cost) warnings *beside the field*; the event still saves (INV-8).
- **Undo, not confirm**: destructive actions soft-delete and raise a 10s "Deshacer" toast instead
  of a "¿Estás segura?" dialog (exception: order cancellation with a deposit).
- **Derived numbers are legibly derived**: computed figures carry a subtle "calculado" affordance
  and are never editable; tapping opens CalcTrace with the formula and inputs.
- **Every number is a door**: dashboard/report figures link to their underlying list, pre-filtered.

## Responsive Behavior

Desktop-first; the web app is where analysis, editing, and configuration live. Content max-width
1280px, 24px gutters. On mobile browser it degrades to a **read-mostly** companion (capture belongs
to Telegram): the sidebar becomes a bottom tab bar (Panel, Ventas, Inventario, Finanzas, Más),
tables collapse to stacked cards, the DetailDrawer becomes a full-height sheet, and multi-column
forms go single-column. No feature is desktop-only, but density and multi-pane layouts relax.

## Accessibility Requirements

WCAG 2.1 AA (all text and meaningful UI ≥ 4.5:1, large text ≥ 3:1 — verified against the warm
palette, which is easy to get wrong). `font-variant-numeric: tabular-nums` mandatory in every
numeric column. Color never the sole carrier of meaning — money direction, margin health, and
status also use sign, icon, or label (matters for the green/red semantics). Touch targets ≥ 44px.
Full keyboard reachability with visible focus (coffee focus ring at AA contrast on both cream and
espresso surfaces). Loading via skeletons, no lone spinners > 300ms. Respect
`prefers-reduced-motion`.

## Out of Scope

- **Exact token values** (hex, spacing numbers, ramp) — that is the Design Tokens deliverable.
- **Per-screen layouts** — Doc 07 Screen Catalog + the Information Architecture step own those.
- **Telegram bot visual/interaction design** — a separate surface; it shares the language and tone
  but is specified in Doc 06 §5, not here.
- **AI assistant conversation design** (prompt/response shaping) — Doc 05.
- **Customer-facing brand / marketing / packaging** — governed by the Kokoro brand manual; this
  brief deliberately keeps that at arm's length.
- **Motion system specifics** beyond the principle of restraint — detailed in tokens/components.
```
