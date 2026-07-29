// Price-health DTOs (KOK-035, Doc 03 Ãƒâ€šÃ‚Â§4 C-5, Doc 07 SC-12). No new command schema here: the
// "Actualizar precio" write (Doc 07: "writes price_history + items.sale_price") reuses catalog.ts's
// `updateItemCommandSchema` (D-4) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `core/catalog/items.ts`'s `updateItem` is what appends the
// `price_history` row, in the same batch as the `items.sale_price` write (D-3).
//
// Powers KOK-036's Price-health screen (SC-12) and every `MarginBadge` consumer: this module only
// supplies the raw numbers (margins, suggestion, `min_margin_pct`) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â MarginBadge itself already
// owns the threshold-to-color classification (apps/web/src/components/pricing/MarginBadge.tsx), so
// no `belowMinMargin`-style flag is duplicated here.

import type { MilliCentavosPerUnit } from "./money.js";

export interface PriceMarginDto {
  /** Centavos (INV-6): `salePrice ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ cost`, already rounded to a whole-centavos amount (D-5). */
  amount: number;
  /** Basis points (INV-6): `amount / salePrice`, rounded half-up. */
  pctBasisPoints: number;
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
  /** C-5 margin over `wac` ("margen histÃƒÆ’Ã‚Â³rico") ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `null` when `salePrice` is null or zero. */
  marginWac: PriceMarginDto | null;
  /** C-5 margin over `replacementCostMc` ("margen real") ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the anti-decapitalization figure Doc 06
   * principle 4 calls out as the one to render prominently. `null` when `salePrice` is null/zero. */
  marginReplacement: PriceMarginDto | null;
  /** `replacement_cost_mc / (1 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ min_margin_pct)` (Doc 07 SC-12), centavos per whole unit,
   * rounded half-up. `null` when `replacementCostMc` is 0. */
  priceSuggested: number | null;
  /** `price_history.effective_from` of this item's most recent price change, or `null` if the item
   * has never had a priced `price_history` entry. */
  lastPriceChangeAt: string | null;
}

export interface ListPriceHealthResult {
  rows: PriceHealthRowDto[];
  /** `app_settings.min_margin_pct` (C-5), basis points ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the single alert threshold, shared with
   * every `MarginBadge` consumer (mirrors recipes.ts's `RecipeSettingsDto` precedent). */
  minMarginPct: number;
}
