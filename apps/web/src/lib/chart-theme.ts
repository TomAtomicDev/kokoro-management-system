/**
 * Recharts palette (Doc 06 §3: "one categorical palette defined once"). Charts are the one
 * deliberate carve-out from the ≤5-8%-of-screen semantic-color budget (see
 * .design/foundations/DESIGN_TOKENS.md) — a multi-series chart legitimately needs several
 * distinguishable hues. This ramp is derived from the same warm, desaturated system as the rest
 * of the UI (ink + the two semantic accents + muted brand/warning/clay/slate notes) so a chart
 * never looks like a different product bolted onto the dashboard.
 *
 * Order matters: series consume colors in this order, so the first 1-2 hues (ink, positive green)
 * carry the most common single/primary-series cases (e.g. a single sales line) before less-central
 * hues are needed for 3+ category breakdowns.
 *
 * Values are NOT CSS variables — Recharts renders to SVG/canvas outside the DOM cascade some of
 * the time (exports, canvas fallbacks), so literal hex keeps the palette portable. Keep this file
 * as the single place that changes if the palette moves.
 */

export const chartPalette = {
  light: [
    "#241a12", // ink — primary series (e.g. the single "sales" line)
    "#3f7038", // positive green — secondary series, income-adjacent categories
    "#8a6748", // muted brand-brown — tertiary
    "#b8862e", // ochre — quaternary
    "#bf8f7a", // dusty clay — quinary (NOT the semantic --negative red; a neutral category note)
    "#7c8da6", // muted slate — senary; the one cool note, kept clearly desaturated
  ],
  dark: [
    "#f0e6d2", // warm off-white — primary series on dark canvas
    "#86bd72", // positive green (dark-mode tuned)
    "#c9ab86", // muted tan-brown
    "#d6a852", // ochre (dark-mode tuned)
    "#d1a496", // dusty clay
    "#9db0c7", // muted slate
  ],
} as const;

/** Axis/grid/tooltip chrome — always neutral, never a semantic or categorical color. */
export const chartChrome = {
  light: {
    grid: "#e9e0d0",
    axis: "#8b7c68",
    tooltipBg: "#ffffff",
    tooltipBorder: "#e9e0d0",
    tooltipText: "#241a12",
  },
  dark: {
    grid: "#3a2e24",
    axis: "#a8967d",
    tooltipBg: "#261c15",
    tooltipBorder: "#3a2e24",
    tooltipText: "#f0e6d2",
  },
} as const;

/**
 * Semantic overrides — use these instead of the categorical ramp when a series has real financial
 * meaning (e.g. a margin-erosion chart plotting price vs. replacement cost, Price Health SC-12).
 * Function over palette order: a "problem" line is always --negative, never whatever the ramp's
 * next slot happens to be.
 */
export const chartSemantic = {
  light: { positive: "#3f7038", negative: "#b33f2f", warning: "#8f660f", ink: "#241a12" },
  dark: { positive: "#86bd72", negative: "#e38268", warning: "#d6a852", ink: "#e8d9bc" },
} as const;

export type ChartMode = keyof typeof chartPalette;
