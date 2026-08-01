// Price-health DTOs (KOK-035, Doc 03 §4 C-5, Doc 07 SC-12). No new command schema here: the
// "Actualizar precio" write (Doc 07: "writes price_history + items.sale_price") reuses catalog.ts's
// `updateItemCommandSchema` (D-4) — `core/catalog/items.ts`'s `updateItem` is what appends the
// `price_history` row, in the same batch as the `items.sale_price` write (D-3).
//
// Powers KOK-036's Price-health screen (SC-12) and every `MarginBadge` consumer: this module only
// supplies the raw numbers (margins, suggestion, `min_margin_pct`) — MarginBadge itself already
// owns the threshold-to-color classification (apps/web/src/components/pricing/MarginBadge.tsx), so
// no `belowMinMargin`-style flag is duplicated here.

import { type MilliCentavosPerUnit, roundHalfUpToInt, subMoney, totalCentavos } from "./money.js";
import { WHOLE_UNIT_MILLI_UNITS } from "./qty.js";

export interface PriceMarginDto {
  /** Centavos (INV-6): `salePrice − cost`, already rounded to a whole-centavos amount (D-5). */
  amount: number;
  /** Basis points (INV-6): `amount / salePrice`, rounded half-up. */
  pctBasisPoints: number;
}

/**
 * C-5's margin formula, factored out so both the worker's `computePriceMargin` (which adds input
 * validation and the null/zero-price early-outs a *command* needs) and the web app's live-preview
 * displays (KOK-036 SC-03's per-line margin badge, which has no DomainError boundary to validate
 * against) share one tested implementation, instead of the display side re-deriving the arithmetic
 * from scratch the way SC-02's SalesTable does for its own, deliberately different, WAC-snapshot
 * margin metric.
 *
 * Caller must ensure `salePriceMc` is a positive rate — this function does not special-case a
 * zero/negative sale price (that early-out is a per-caller concern: a command and a live-typed
 * form field disagree on what "nothing to show yet" even looks like).
 */
export function computeMarginBasisPoints(
  salePriceMc: MilliCentavosPerUnit,
  costMc: MilliCentavosPerUnit,
): PriceMarginDto {
  const salePrice = totalCentavos(salePriceMc, WHOLE_UNIT_MILLI_UNITS);
  const costPerUnit = totalCentavos(costMc, WHOLE_UNIT_MILLI_UNITS);
  const amount = subMoney(salePrice, costPerUnit);
  const pctBasisPoints = roundHalfUpToInt((amount * 10000) / salePrice);
  return { amount, pctBasisPoints };
}

export interface PriceHealthRowDto {
  itemId: string;
  name: string;
  /** Centavos per whole unit; `null` means no price set yet (nothing to alert on). */
  salePriceMc: MilliCentavosPerUnit | null;
  /** Integer milli-centavos per WHOLE unit (ADR-017). */
  wacMc: number;
  /** Integer milli-centavos per WHOLE unit (ADR-017). */
  replacementCostMc: number;
  replacementCostUpdatedAt: string | null;
  /** C-5 margin over `wac` ("margen histórico") — `null` when `salePrice` is null or zero. */
  marginWac: PriceMarginDto | null;
  /** C-5 margin over `replacementCostMc` ("margen real") — the anti-decapitalization figure Doc 06
   * principle 4 calls out as the one to render prominently. `null` when `salePrice` is null/zero. */
  marginReplacement: PriceMarginDto | null;
  /** `replacement_cost_mc / (1 − min_margin_pct)` (Doc 07 SC-12), centavos per whole unit,
   * rounded half-up. `null` when `replacementCostMc` is 0. */
  priceSuggested: number | null;
  /** `price_history.effective_from` of this item's most recent price change, or `null` if the item
   * has never had a priced `price_history` entry. */
  lastPriceChangeAt: string | null;
}

export interface ListPriceHealthResult {
  rows: PriceHealthRowDto[];
  /** `app_settings.min_margin_pct` (C-5), basis points — the single alert threshold, shared with
   * every `MarginBadge` consumer (mirrors recipes.ts's `RecipeSettingsDto` precedent). */
  minMarginPct: number;
}

export interface PricingSettingsDto {
  /** `app_settings.min_margin_pct` (C-5), basis points — the single alert threshold every
   * `MarginBadge` consumer reads (mirrors `RecipeSettingsDto`'s identical precedent). Exposed on
   * its own (`GET /pricing-settings`, KOK-036) for screens that need the threshold without needing
   * a whole `listPriceHealth`/`listRecipes` payload — SC-03's per-line margin badge, first. */
  minMarginPct: number;
}
