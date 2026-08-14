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

**Revised 2026-08-11** (post-MVP design review — see `docs/system-design-knowledge-base/10-implementation-backlog.md`
Phase 3.2, KOK-151): the first cut of the dark palette copied light mode's "tiny luminance step"
philosophy for `--card`/`--border` verbatim, on the assumption that `--shadow-sm` would still
carry visible separation the way it does in light mode. It doesn't — a shadow tinted with
`--shadow-color` (the light-mode ink RGB triplet) cast onto an already near-black canvas is
functionally invisible, so every card, table and StatCard rendered as one undifferentiated dark
mass. Light mode gets away with a ~1.08:1 background/card luminance ratio precisely *because* the
ink-tinted shadow reads clearly against a near-white surface; dark mode needed its separation
budget moved into the surface step and the border instead, since the shadow can no longer do that
job. Three tokens changed as a result — `--card`/`--popover` lifted from `#261C15` to `#2F251C`
(background contrast 1.09:1 → 1.21:1), `--border`/`--sidebar-border` raised from `#3A2E24` to
`#453726` (contrast against `--card` 1.27:1 → 1.45:1), and `--shadow-color` now overrides to true
black (`0 0 0`) in dark mode instead of inheriting the light-mode ink tint — rather than widen the
step further and risk the palette reading as a generic gray dark theme instead of Kokoro's own.
Both changed text/surface pairs were re-verified: `--foreground` on the new `--card` is ~12.1:1
(was ~13.5:1) and `--muted-foreground` on it is ~5.2:1 (was ~5.8:1) — comfortably inside AA on
both counts.

| Token | Value | Role |
|---|---|---|
| `--background` | `#1C140F` | Canvas |
| `--card` / `--popover` | `#2F251C` | Surfaces — raised 2026-08-11 for dark-mode elevation (see above) |
| `--sidebar` | `#201810` | Sidebar |
| `--primary` | `#E8D9BC` | **Inverted**: warm parchment/tan fill (was near-black in light mode) |
| `--primary-hover` | `#DFCBA5` | Deeper tan on hover (darkening = "pressed", same convention as light mode) |
| `--primary-foreground` | `#241A12` | Espresso text on the tan fill |
| `--foreground` | `#F0E6D2` | Body text |
| `--muted-foreground` | `#A8967D` | Secondary text |
| `--border` / `--sidebar-border` | `#453726` | Raised 2026-08-11 — dark mode's primary depth cue since shadow can't carry it (see above) |
| `--brand` | `#D8B48C` | Lightened for dark-canvas legibility; still reads as "brand", not ink |
| `--positive` / `-bg` | `#86BD72` / `#23331E` | |
| `--negative` / `-bg` | `#E38268` / `#3A211B` | |
| `--warning` / `-bg` | `#D6A852` / `#362A14` | |
| `--ring` | `#E8D9BC` | Focus ring = tan primary |
| `--shadow-color` | `0 0 0` | True black override (light mode's ink tint is invisible on a dark canvas) — secondary reinforcement for modals/drawers, not load-bearing the way it is in light mode |

## Accessibility verification (WCAG 2.1 AA)

Computed via relative-luminance contrast (not eyeballed) for every text/background pairing that
carries meaningful content. Full pass, both modes, **except one deliberate exception**:

- `--subtle-foreground` (light `#9C8D76` ≈ 3.0:1, dark `#7C6C56` ≈ 3.6:1) is **below the 4.5:1
  body-text threshold by design** — it is used *exclusively* for placeholder and disabled text,
  which WCAG does not require to meet body-text contrast. It must never be used for meaningful
  content (labels, values, status).
- Resting borders (`--border`, `--input`) are intentionally soft — light mode ~1.2-1.5:1 — and are
  **not** the accessibility guarantee for interactive boundaries — `--ring` (verified ≥15:1 light,
  ≥14:1 dark) carries that guarantee at focus. This matches how Stripe/Linear-class products treat
  resting vs. focused input chrome, and preserves the brief's "superficies... que el usuario casi
  no note el color" requirement without sacrificing keyboard-user accessibility. Dark mode's
  `--border` sits a shade higher (~1.45-1.58:1, 2026-08-11) because it is dark mode's *primary*
  depth cue rather than a secondary one — see the dark-mode elevation note above.
- Every semantic color (`positive`, `negative`, `warning`) passes 4.5:1 as text **and** in its
  paired `-bg` well, in both modes — required because `MarginBadge`/`StatDelta` render these as
  small (12-13px) text, not large display type.
- **Focus ring offset (fixed 2026-08-11):** Tailwind registers `--tw-ring-offset-color` via
  `@property` with `inherits: false`, so its Preflight reset to opaque white on every element could
  not be overridden by a `:root`-level declaration — every `ring-offset-2` control (buttons,
  inputs, selects, switches) rendered a stark white 2px halo under the real focus ring once
  `--background` went dark, directly undermining the ring-carries-focus guarantee this section
  documents. Fixed with an unlayered `* { --tw-ring-offset-color: var(--background); }` rule in
  `globals.css`, which outranks Tailwind's `@layer base` reset regardless of specificity.

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
- ~~Doc 06 §3 still shows the old amber-based token table~~ — **checked 2026-08-11: already
  reconciled.** Doc 06 §3 summarizes the current two-brown/semantic-triad system correctly and
  points to this document + `globals.css` as canonical; this line was stale bookkeeping from the
  2026-07-16 token rewrite and is removed.
- **No in-app dark-mode toggle exists** (found during the 2026-08-11 review). `globals.css`
  documents a `.dark` class meant to be "added/removed by a settings switch," and both the
  `prefers-color-scheme` media query and the `.dark` class are fully wired in code — but no such
  switch was ever built in Configuración. Dark mode is reachable only via the OS-level preference,
  which is almost certainly why the elevation and focus-ring bugs fixed in this pass went unnoticed
  this long: nobody could reach dark mode from inside the app to check it. Tracked as KOK-151 in
  Phase 3.2.
- `apps/web/src/lib/chart-theme.ts` (`chartPalette`/`chartChrome`/`chartSemantic`, dark-mode-ready)
  is fully built but **imported nowhere** — confirmed 2026-08-11 that no chart component exists yet
  anywhere in `apps/web/src`; Reportes is a literal "próximamente" placeholder. Not a defect, just
  a flag for whoever builds Reportes/Insights (Phase 5-ish, "Dashboard v2" per `StatCard.tsx`'s own
  comments): wire into this file rather than re-deriving a chart palette.
