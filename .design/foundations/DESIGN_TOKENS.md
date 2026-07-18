# Design Tokens: Kokoro Management — Foundational Design Language

> Implements `.design/foundations/DESIGN_BRIEF.md`. Source of truth in code:
> `apps/web/src/styles/globals.css` (Tailwind v4 `@theme` + CSS custom properties) and
> `apps/web/src/lib/chart-theme.ts` (chart carve-out). This document explains the *why* behind
> the values; the CSS file is what ships. Validated as a live mockup in Open-Pencil (Dashboard,
> owner-approved 2026-07-16) before being finalized here.

## Philosophy

**Quiet utilitarian calm** (from the design brief) — functional minimalism warmed from cold
"tool gray" into Kokoro's natural palette, with a distant structural echo of the brand's
Japanese-inspired restraint (space, quiet) rather than any literal ornament. Two ideas govern
every token decision:

1. **Typography, spacing, alignment, and tabular numbers carry the visual language. Color is a
   scarce semantic accent** (≤ ~5-8% of any screen), never decoration.
2. **Two browns, split by job.** `--brand` (Kokoro's actual brand brown) is a *brand moment*
   color — the sidebar wordmark, login, first onboarding — and is never a control color.
   `--primary` (a near-black warm "ink") is the interactive color everywhere else: buttons,
   active nav, focus. It reads as **emphasis/hierarchy**, not as "a themed brown button." This
   single decision is what keeps the product tool from feeling like the customer-facing brand.

## Naming convention

Token names follow shadcn/ui conventions (`components.json` has `cssVariables: true`), so future
`shadcn add` components map onto these without renaming — `background`/`foreground`,
`card`/`card-foreground`, `primary`/`primary-foreground`, `muted`/`muted-foreground`,
`destructive`, `border`/`input`/`ring`. Kokoro-specific extensions sit alongside: `brand` (brand
moments), the `positive`/`negative`/`warning` triads (each with a `-bg` well, for badges), and a
dedicated `sidebar` set (shadcn's own sidebar-component convention, pre-wired for later).

## Color — light mode

Near-white warm neutrals with **tiny luminance steps** — canvas ~98%L, card 100%, sidebar ~97% —
so warmth comes from *hue*, not from beige mass. Tables and cards keep contrast instead of
dissolving into each other after hours of use (a named risk in stakeholder review).

| Token | Value | Role |
|---|---|---|
| `--background` | `#FAF6EF` | Canvas (page bg) |
| `--card` / `--popover` | `#FFFFFF` | Card, panel, dropdown surfaces |
| `--sidebar` | `#F4EEE3` | Sidebar / structural chrome — one step down from white |
| `--muted` / `--secondary` | `#F4EEE3` | Subtle wells: inputs, chips, disabled fields |
| `--accent` | `#EFE6D3` | Hover bg for non-active nav items, menu/list rows |
| `--border` | `#E9E0D0` | Hairline — decorative separators only |
| `--input` | `#D9CCB3` | Resting input/component boundary (deliberately soft, see a11y note) |
| `--foreground` / `--primary` | `#241A12` | **UI Ink** — body text AND the interactive color |
| `--primary-hover` | `#3A2A1C` | Ink button/active-state hover |
| `--primary-foreground` | `#FBF6EC` | Text/icon on filled ink surfaces |
| `--muted-foreground` | `#6B5D4C` | Secondary text (labels, timestamps, sub-rows) |
| `--subtle-foreground` | `#9C8D76` | Placeholder/disabled text **only** — see a11y exception |
| `--brand` | `#5A3B27` | Brand Brown — wordmark / login / onboarding **only** |
| `--brand-foreground` | `#FBF6EC` | Text on brand-brown surfaces |
| `--positive` / `--positive-bg` | `#3F7038` / `#E9F0E4` | Matcha-tuned green — income, margin-OK, growth |
| `--negative` / `--negative-bg` | `#B33F2F` / `#FAEAE6` | Alive, not muted-terracotta — problems (below-replacement price, negative balance) |
| `--warning` / `--warning-bg` | `#8F660F` / `#FBF3E1` | Ochre — contained use, attention |
| `--ring` | `#241A12` | Focus ring = ink |

**Deviation from the mockup:** four values (`text-muted`, `positive`, `negative`, `warning`, and
`warning-bg`) were darkened/lightened slightly from what was validated in Open-Pencil, because the
mockup values failed WCAG 2.1 AA at small-text size (verified computationally — see below). The
mockup's *character* is unchanged; only enough luminance moved to pass 4.5:1. The live Open-Pencil
document variables were updated to match these final values.

## Color — dark mode

**Warm espresso, never cold charcoal.** The one open design decision carried over from the brief:
the "ink-as-primary" trick (a near-black fill reading as "emphasis, not a hue") is inherently
light-mode — a near-black fill disappears on a dark canvas. **Resolution: in dark mode `--primary`
inverts to a warm parchment/tan fill with espresso text**, preserving the same spirit in the
opposite direction.

| Token | Value | Role |
|---|---|---|
| `--background` | `#1C140F` | Canvas |
| `--card` / `--popover` | `#261C15` | Surfaces |
| `--sidebar` | `#201810` | Sidebar |
| `--primary` | `#E8D9BC` | **Inverted**: warm parchment/tan fill (was near-black in light mode) |
| `--primary-hover` | `#DFCBA5` | Deeper tan on hover (darkening = "pressed", same convention as light mode) |
| `--primary-foreground` | `#241A12` | Espresso text on the tan fill |
| `--foreground` | `#F0E6D2` | Body text |
| `--muted-foreground` | `#A8967D` | Secondary text |
| `--brand` | `#D8B48C` | Lightened for dark-canvas legibility; still reads as "brand", not ink |
| `--positive` / `-bg` | `#86BD72` / `#23331E` | |
| `--negative` / `-bg` | `#E38268` / `#3A211B` | |
| `--warning` / `-bg` | `#D6A852` / `#362A14` | |
| `--ring` | `#E8D9BC` | Focus ring = tan primary |

## Accessibility verification (WCAG 2.1 AA)

Computed via relative-luminance contrast (not eyeballed) for every text/background pairing that
carries meaningful content. Full pass, both modes, **except one deliberate exception**:

- `--subtle-foreground` (light `#9C8D76` ≈ 3.0:1, dark `#7C6C56` ≈ 3.6:1) is **below the 4.5:1
  body-text threshold by design** — it is used *exclusively* for placeholder and disabled text,
  which WCAG does not require to meet body-text contrast. It must never be used for meaningful
  content (labels, values, status).
- Resting borders (`--border`, `--input`) are intentionally soft (~1.2-1.5:1) and are **not** the
  accessibility guarantee for interactive boundaries — `--ring` (verified ≥15:1 light, ≥14:1 dark)
  carries that guarantee at focus. This matches how Stripe/Linear-class products treat resting vs.
  focused input chrome, and preserves the brief's "superficies... que el usuario casi no note el
  color" requirement without sacrificing keyboard-user accessibility.
- Every semantic color (`positive`, `negative`, `warning`) passes 4.5:1 as text **and** in its
  paired `-bg` well, in both modes — required because `MarginBadge`/`StatDelta` render these as
  small (12-13px) text, not large display type.

## Typography

**Two-tier, brand type kept out of product UI** (stakeholder-directed correction from the initial
brief draft, which had proposed Montserrat as the UI face):

- **Product UI face = Inter** (`--font-sans`) — a neutral humanist grotesque chosen to
  *disappear*, the same reasoning Linear/Stripe/Notion/Figma apply to dense data products. Already
  referenced in the codebase; zero new dependency.
- **Brand faces are brand-only**: `--font-brand-display` (Cinzel) and `--font-brand-text`
  (Montserrat) apply via the `.brand-display` / `.brand-text` utility classes, used in exactly
  three places — the sidebar wordmark, the login screen, and first onboarding. Not in empty
  states, not in headings, not anywhere in daily-flow UI.
- **Weight discipline**: 400 body / 500 labels / 600 buttons & section headers / **700 reserved
  for KPI figures and page titles only**. Never 800+/Black — a dominant weight fights the "calm"
  principle.
- Type scale is compact-leaning (`--text-base` = 14px, not the usual 16px marketing default) —
  appropriate for a dense numbers tool, matches the validated Dashboard mockup's table/label sizes.
- `font-variant-numeric: tabular-nums` remains mandatory in every numeric context (`.numeric-cell`
  utility, unchanged from the prior token file).

## Spacing, radius, shadow, motion

- **Spacing**: no parallel scale was introduced — Tailwind v4's default spacing scale is already
  4px-based and comprehensive; reinventing one would violate the "boring, evolvable technology"
  product principle. `--layout-*` tokens (topbar height, sidebar width/collapsed-width, content
  max-width, gutter) are the exception: these are Doc 06 §2 *normative* pixel values, now defined
  once in `globals.css` instead of being hardcoded independently in `AppShell`/`Sidebar`.
- **Radius**: `--radius-sm` 6px, `--radius-md` 8px (default: buttons/inputs/nav items),
  `--radius-lg` 12px (cards/panels), `--radius-xl` 16px (sheets), `--radius-full` (pills/badges) —
  matches the validated mockup exactly.
- **Shadow**: warm-tinted (espresso rgb triplet at low alpha), not cold black — matches the "quiet"
  aesthetic; the system otherwise leans on borders + spacing for separation over elevation
  (constraint over decoration).
- **Motion**: restrained durations (50/150/220/360ms), standard easing curves. **No bounce/spring
  easing** — a deliberate omission; a playful bounce contradicts "calm support over alarm."
  `prefers-reduced-motion` is respected globally.

## Chart palette (the one carve-out)

`apps/web/src/lib/chart-theme.ts` defines a small categorical ramp (ink → matcha green → muted
brand-brown → ochre → dusty clay → muted slate) plus a `chartSemantic` export for meaning-bearing
lines (e.g. Price Health's price-vs-replacement-cost chart, which must always use `--negative` for
the "problem" line, never whatever slot the categorical ramp assigns). Charts sit outside the
5-8%-of-screen color budget by nature — multi-series data genuinely needs several distinguishable
hues — but the ramp is still derived from the same warm, desaturated system so a chart never reads
as a different product bolted onto the dashboard.

## What changed in code

- `apps/web/src/styles/globals.css` — full token rewrite (previous bread-amber `#D97706` primary +
  cold zinc/stone neutrals + blue info are gone; see `.design/design-kb-needs-brand-revision`
  memory for why they existed).
- `button.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `AppShell.tsx`, `MobileBottomTabs.tsx`,
  `QuickAddModalPlaceholder.tsx` — updated to the renamed tokens. Two structural fixes rode along
  because the old tokens made them impossible to express correctly:
  - **Sidebar active state** is now a filled ink pill (`bg-primary text-primary-foreground`), not
    a text-color change — matches the validated mockup and the "reads as emphasis" intent.
  - **The wordmark moved to the sidebar only** (added, Cinzel, small) and was **removed from the
    topbar**, where it previously duplicated the brand moment on every screen — a direct violation
    of "Cinzel appears in at most three places" once the sidebar wordmark existed.
- `pnpm exec tsc --noEmit`, `pnpm run build`, and `biome check` all pass against these changes.

## Still open (not blocking, tracked for later)

- Inter/Cinzel/Montserrat are referenced by name but not yet self-hosted as font assets (existing
  TODO in `globals.css`, carried forward) — browsers currently fall back to the system UI stack.
- This document and `globals.css` are the code-level source of truth; **Doc 06 §3 (UX/UI
  Specification) in the KB still shows the old amber-based token table** and needs a follow-up
  amendment (D-6) to stay consistent with D-1 ("the KB is law"). Recommend doing that reconciliation
  pass once the first real components (`MoneyText`, `StatCard`, etc.) are built against these
  tokens, so the KB amendment reflects implementation reality rather than a second round of
  prediction.
