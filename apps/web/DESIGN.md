---
name: Kokoro Management
description: A calm, warm operating tool that gives a solo food-business owner certainty at a glance
colors:
  background: "#FAF6EF"
  card: "#FFFFFF"
  sidebar: "#F4EEE3"
  muted: "#F4EEE3"
  accent: "#EFE6D3"
  border: "#E9E0D0"
  input: "#D9CCB3"
  ink: "#241A12"
  ink-hover: "#3A2A1C"
  ink-foreground: "#FBF6EC"
  muted-foreground: "#6B5D4C"
  subtle-foreground: "#9C8D76"
  brand-brown: "#5A3B27"
  brand-foreground: "#FBF6EC"
  matcha-green: "#3F7038"
  matcha-green-bg: "#E9F0E4"
  living-red: "#B33F2F"
  living-red-bg: "#FAEAE6"
  contained-ochre: "#8F660F"
  contained-ochre-bg: "#FBF3E1"
typography:
  display:
    fontFamily: "Cinzel, ui-serif, Georgia, 'Times New Roman', serif"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.04em"
  page-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.3
  kpi:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
  subheading:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.02em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-secondary:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge-positive:
    backgroundColor: "{colors.matcha-green-bg}"
    textColor: "{colors.matcha-green}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-negative:
    backgroundColor: "{colors.living-red-bg}"
    textColor: "{colors.living-red}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-warning:
    backgroundColor: "{colors.contained-ochre-bg}"
    textColor: "{colors.contained-ochre}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
---

# Design System: Kokoro Management

## Overview

**Creative North Star: "The Steady Second Pair of Hands"**

She runs the whole business alone — buying, baking, selling, delivering, tracking cash across two
accounts — and today that means constant low-grade doubt: is this cash mine or a customer's
deposit? Am I still profitable now that flour costs more? Kokoro Management exists to end that
doubt. The interface is built to feel like a second pair of hands that already did the accounting
for her: it never shows off, never makes her double-check a number, never adds a chore. Every
figure on screen is system-derived, never hand-typed, and one tap from its own explanation.

The palette is warm — near-white cream canvas, espresso ink, a whisper of the Kokoro brand brown —
but the warmth is a *temperature*, not a costume. The customer-facing Kokoro brand (Cinzel display
type, the deep brand brown) is deliberately rationed to three moments — the sidebar wordmark, the
login screen, the first onboarding step — because every other sighting flips her out of "working
in my tool" and into "looking at packaging." Everywhere else, hierarchy is carried by a single
near-black ink color, tabular numerals, generous whitespace, and restraint, echoing (structurally,
never decoratively) the brand's own Japanese-influenced idea of *ma* — breathing room as a form of
respect for the person using the space.

Confirmed rejections: Montserrat as a UI face (geometric brand type reads as "heavy" across dense
tables), literal packaging ornament in the product (frames, flourishes, Cinzel headings), loud
multi-color SaaS dashboards, and cold enterprise gray.

**Key Characteristics:**
- Near-white warm neutrals with tiny luminance steps, not beige mass
- One interactive color (ink) carries emphasis everywhere; brand brown is reserved for three brand moments
- Color is a scarce semantic accent (≤5–8% of any screen) — charts are the one deliberate exception
- Tabular numerals everywhere money or quantity appears
- Tactile, confident chrome: firm hairline borders, ambient shadow at rest, clear hover feedback

## Colors

Warmth comes from hue at near-white luminance, not from beige saturation — the palette is
deliberately low-chroma so tables and cards keep contrast instead of dissolving into each other
after hours of use.

### Primary
- **UI Ink** (`#241A12`): The single interactive color — primary buttons, active sidebar state,
  focus ring, links. Dark enough to read as *emphasis and hierarchy*, not as "a brown button." This
  one decision is what keeps the daily-use tool from feeling like the customer-facing brand. In
  dark mode this inverts to a warm parchment/tan fill (`#E8D9BC`) with espresso text — same
  intent, opposite luminance direction, since a near-black fill disappears on a dark canvas.

### Secondary
- **Brand Brown** (`#5A3B27`): Kokoro's actual brand color. Used in exactly three places — the
  sidebar wordmark, the login screen, and the first onboarding step. Never a control color, never
  applied to a button, badge, or any daily-flow surface.

### Neutral
- **Warm Cream** (`#FAF6EF`): Page canvas.
- **Card White** (`#FFFFFF`): Card, panel, and dropdown surfaces — one step lighter than canvas.
- **Warm Sand** (`#F4EEE3`): Sidebar chrome and subtle wells (inputs, chips, disabled fields).
- **Toasted Wheat** (`#EFE6D3`): Hover background for non-active nav items and list rows.
- **Soft Hairline** (`#E9E0D0`): Decorative border and divider color — not the accessibility
  boundary for interactive elements (see Named Rule below).
- **Muted Ink** (`#6B5D4C`): Secondary text — labels, timestamps, sub-rows.
- **Faint Ink** (`#9C8D76`): Placeholder and disabled text *only* — below body-text AA contrast by
  design, never used for meaningful content.

### Semantic
- **Matcha Green** (`#3F7038` on `#E9F0E4`): Positive — income, healthy margin, growth.
- **Living Red** (`#B33F2F` on `#FAEAE6`): Problem — a below-replacement-cost price, a negative
  balance. Kept alive and legible, deliberately not muted toward terracotta: the Price Health
  "below cost" signal is a product pillar and must be impossible to miss.
- **Contained Ochre** (`#8F660F` on `#FBF3E1`): Attention/warning, used sparingly.
- No blue and no generic "info" color exist in this system. Ink plus icon carries neutral
  information; a fifth hue was judged to add noise, not clarity.

### Named Rules
**The Two Browns Rule.** Brand Brown is a brand moment (wordmark, login, first onboarding, never a
control). UI Ink is the interactive color everywhere else. Never substitute one for the other.

**The Ring-Carries-Focus Rule.** Resting borders (`--border`, `--input`) are intentionally soft
(~1.2–1.5:1 contrast) and are not the accessibility guarantee for interactive boundaries — the
focus ring (`--ring`, ≥14:1 in both modes) carries that guarantee. Don't chase AA contrast on
resting input borders; the ring is where it's verified. **Bug fixed 2026-08-11:** the ring's own
2px offset was invisibly hardcoded to opaque white by Tailwind's Preflight (a `@property` reset
with `inherits: false`, so no `:root`-level override could reach it) — every focused control in
dark mode showed a stark white halo *before* the actual ring color, undermining this exact rule.
Fixed with an unlayered `* { --tw-ring-offset-color: var(--background); }` in `globals.css`.

**The Color Budget Rule.** Semantic color (green/red/ochre) covers roughly 5–8% of any screen.
Charts are the one named exception — a multi-series chart legitimately needs several
distinguishable hues and lives outside the budget by nature.

## Typography

**Display Font:** Cinzel (with Georgia, Times New Roman, serif fallback) — brand moments only.
**Body Font:** Inter (with the system UI sans stack) — the product face everywhere else.
**Brand Text Font:** Montserrat — brand-only, alongside Cinzel; never a UI face.

**Character:** Inter is chosen specifically to disappear — the same reasoning Linear, Stripe,
Notion, and Figma apply to dense data products. The user should never think "nice type," only "I
understand my numbers." Cinzel and Montserrat carry the opposite job: distinctive, brand-forward,
and confined to three sanctioned surfaces so every sighting still reads as a deliberate brand
moment rather than habitual chrome.

### Hierarchy
- **Display** (400, 2.5rem, 1.2 line-height, Cinzel, 0.04em tracking): Brand-only headline — login
  screen and first onboarding, never daily-flow UI.
- **Page Title** (700, 1.625rem/26px): Top of each screen.
- **KPI Figure** (700, 2rem/32px, tabular-nums): Hero dashboard numbers — cash position, top-line
  totals. 700 weight is reserved for KPI figures and page titles only.
- **Subheading** (600, 1.125rem/18px): Card and section headers.
- **Body** (400, 0.875rem/14px): Default UI text — compact-leaning, appropriate for a dense
  numbers tool rather than a marketing page.
- **Label** (500, 0.75rem/12px, slight tracking): Field labels, table headers, badges, captions.

### Named Rules
**The Three-Sightings Rule.** Cinzel appears in exactly three places in the product: the sidebar
wordmark, the login screen, and the first onboarding step. Not in empty states, not in headings,
not anywhere in daily-flow UI — each sighting flips the user from "tool" mode to "brand" mode.

**The Tabular Numerals Rule.** Every numeric context — money, quantities, percentages, table
columns — uses `font-variant-numeric: tabular-nums` (the `.numeric-cell` utility), so columns of
figures align and don't visually jitter as digits change.

**The Weight Discipline Rule.** 400 for body, 500 for labels, 600 for buttons and section headers,
700 reserved for KPI figures and page titles only. Never 800+/Black — a dominant weight fights the
calm the whole system is built around.

## Layout

Desktop-first: this is where analysis, editing, and configuration happen (capture lives in
Telegram). The persistent shell is a 56px topbar, a 232px sidebar collapsible to 64px icon-only,
and a content area capped at 1280px max-width with 24px gutters — every screen fills only the
outlet inside that frame. On narrower viewports the sidebar becomes a bottom tab bar (Panel,
Ventas, Inventario, Finanzas, Más), tables collapse to stacked cards, the right-side drawer becomes
a full-height sheet, and multi-column forms go single-column. No feature is desktop-only; density
and multi-pane layouts simply relax.

Spacing follows Tailwind's default 4px-based scale rather than a bespoke one — a deliberate choice
to avoid reinventing a solved primitive. The one exception is layout constants (topbar height,
sidebar widths, content max-width, gutter), which are defined once as CSS custom properties so no
component hardcodes them independently.

## Elevation & Depth

Depth is genuinely ambient, not confined to overlays: resting cards (`StatCard`, `AccountCard`,
the login panel) already pair a hairline border with a soft warm shadow (`shadow-sm`) rather than
relying on the border alone, and modals/drawers step up to a stronger shadow (`shadow-lg`) for
their overlay elevation. Shadows are warm-tinted — an espresso rgb triplet at low alpha — never
cold black, matching the same warm-neutral logic as the color system. **This paragraph describes
light mode; dark mode's mechanism is different — see below.**

### Shadow Vocabulary
- **`shadow-sm`** (`0 1px 2px rgb(36 26 18 / 0.06)`): Resting cards, list rows, stat tiles, the
  login panel — a soft lift off the canvas.
- **`shadow-md`** (`0 4px 10px rgb(36 26 18 / 0.08), 0 1px 2px rgb(36 26 18 / 0.06)`): Dropdowns,
  popovers, hover-elevated elements.
- **`shadow-lg`** (`0 12px 24px rgb(36 26 18 / 0.1), 0 2px 6px rgb(36 26 18 / 0.06)`): Modals and
  the right-side detail drawer — the strongest elevation in the system, still restrained.

### Named Rules
**The Warm Shadow Rule.** Every shadow in the system uses the ink color's RGB triplet at low
alpha, never a neutral or cool black — depth stays inside the same warm palette as everything else.
**Light mode only** — see the next rule for why dark mode can't use this mechanism.

**The Dark Elevation Rule** (added 2026-08-11). A shadow only reads as a shadow when it's visibly
darker than the surface it's cast on. The Warm Shadow Rule's ink-tinted shadow satisfies that on a
near-white light-mode canvas; on the near-black dark-mode canvas it doesn't — the shadow color and
the canvas color are nearly identical, so every card rendered as one undifferentiated dark mass
(confirmed by screenshot review, 2026-08-11). Dark mode instead carries its depth cue through the
surface step and the border: `--card`/`--popover` were lifted from `#261C15` to `#2F251C`
(1.09:1 → 1.21:1 against `--background`) and `--border`/`--sidebar-border` from `#3A2E24` to
`#453726` (1.27:1 → 1.45:1 against `--card`) — border is now dark mode's *primary* depth cue,
not the secondary one it is in light mode. `--shadow-color` also overrides to true black in dark
mode rather than inheriting the light-mode ink tint, as a modest secondary reinforcement for
modals/drawers. Full rationale and contrast math: `.design/foundations/DESIGN_TOKENS.md`.

## Shapes

A restrained, consistent radius scale rather than sharp corners or heavy rounding: 6px for the
smallest chrome, 8px as the default for buttons/inputs/nav items, 12px for cards and panels, 16px
for full-height sheets, and a full pill radius for badges, chips, and the session indicator.
Borders are hairline and used for structure (card outlines, table dividers, dialog frames) rather
than as decoration — the "Soft Hairline" neutral exists specifically so a border reads as
structure, not as a design flourish competing for attention.

## Components

Every component leans the same direction: firm enough chrome to feel confident and finished, quiet
enough coloring that nothing performs or draws attention away from the numbers.

### Buttons
- **Shape:** Default radius (8px), consistent across all sizes.
- **Primary:** UI Ink fill, cream text, `hover:` deepens to `--primary-hover` — the emphasis color,
  never the brand brown.
- **Secondary / Outline / Ghost:** Warm Sand fill, card-white with hairline border, or transparent
  with hover-only Toasted Wheat background, respectively — each a step quieter than Primary.
- **Destructive:** Living Red fill, used for delete/cancel actions.
- **Focus:** A visible ink (or tan, in dark mode) ring with 2px offset on every interactive
  element — full keyboard reachability is non-negotiable given the single-user, desktop-analysis
  context.

### Badges
- **Style:** Full pill radius, small hairline-free chip, 12px label-weight text.
- **Variants:** default (Warm Sand), outline (hairline border, transparent), muted, and the three
  semantic tones (positive/negative/warning) each pairing a saturated text color with its own
  pale `-bg` well — this is the same tone system `MarginBadge` uses for margin-health thresholds.

### Cards / Containers
- **Corner Style:** 12px radius.
- **Background:** Card White on Warm Cream canvas.
- **Shadow Strategy:** `shadow-sm` at rest (see Elevation & Depth) plus a hairline border —
  together, not one or the other.
- **Internal Padding:** 16px standard.

### Inputs / Fields
- **Style:** Card White background, hairline `input` border (deliberately soft — see the
  Ring-Carries-Focus Rule), 8px radius, 36px height.
- **Focus:** Ink-colored ring, 2px offset — the border itself stays quiet; the ring is where
  accessibility contrast is guaranteed.
- **Placeholder / Disabled:** Faint Ink text, ~3:1 contrast by design (placeholder text is exempt
  from body-text AA requirements).

### Navigation
- **Sidebar:** Warm Sand chrome, Inter labels. The active item is a *filled* ink pill
  (background + inverted text), not a text-color change — it should read as "the important thing
  here," not as a subtle brand tint. Non-active hover uses Toasted Wheat. Collapses to a 64px
  icon-only rail; the wordmark (Cinzel, small) lives here and nowhere else in daily-flow chrome.
- **Mobile:** A bottom tab bar replaces the sidebar entirely below the desktop breakpoint.

### Detail Drawer
- Right-side panel (`shadow-lg`, hairline left border), header with title/subtitle and a ghost
  close button, scrollable body, and an optional footer carrying dates and an "editado N veces"
  audit line — table-to-drawer navigation never loses the caller's place in the filtered list
  behind it.

### Session Chip (signature component)
A full-pill status indicator in the topbar showing whether a session (a purchase trip, a
production run, a delivery) is currently open — a small living-green dot plus the session type and
elapsed duration when one session is open, a muted dot and neutral copy when none is, both as a
single clickable chip that deep-links straight into the relevant session. It is the one place in
the daily-flow UI where a semantic color (matcha green) appears purely as a status signal rather
than a data value.

## Do's and Don'ts

### Do:
- **Do** treat UI Ink as the one interactive color; reserve Brand Brown for the wordmark, login,
  and first onboarding.
- **Do** keep semantic color scarce — it should read as meaningful precisely because it's rare.
- **Do** use `tabular-nums` in every numeric column so figures never jitter or misalign.
- **Do** pair a hairline border with a soft warm shadow on resting cards; step shadow strength up
  for true overlays (dropdowns, modals, the detail drawer).
- **Do** keep hierarchy legible through type weight, size, and whitespace before reaching for
  color.

### Don't:
- **Don't** apply the brand's display or text typefaces (Cinzel, Montserrat) to any daily-flow
  surface — tables, forms, empty states, headings. They stay in their three sanctioned places.
- **Don't** let a resting border alone carry an accessibility guarantee for an interactive
  boundary — that's the focus ring's job.
- **Don't** introduce a fifth hue for "info" states; ink plus icon already carries neutral
  information without adding noise to the palette.
- **Don't** mute Living Red toward a soft terracotta — the below-replacement-cost signal needs to
  stay genuinely alarming, not merely warm.
