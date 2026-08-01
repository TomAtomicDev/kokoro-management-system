// core/recipes â€” pure theoretical-cost math (KOK-025, Doc 03 Â§4 C-3b â€” a KOK-025 KB amendment
// generalizing C-3's replacement-cost formula to a WAC basis and to any recipe, not only the
// default). Every function here is plain, synchronous, DB-free (same convention as
// core/costing/wac.ts), so it is directly usable by both the recipe service and fast-check property
// tests (Doc 11 Â§2) without a D1 binding.
//
// Rounding discipline (D-5, INV-6): line costs are integer MilliCentavosPerUnit values on the
// `_mc` grid. The recipe total is rounded half-up to that same integer grid once before
// `totalCentavos` converts it to a whole-unit centavo display value; it is therefore directly
// comparable to `items.sale_price`. `computeRecipeMargin`'s subtraction runs on already-rounded
// integers via money.ts's own helpers.

import {
  type MilliCentavosPerUnit,
  roundHalfUpToInt,
  subMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";

import { validationError } from "../errors.js";

// Mirrors packages/shared/src/numeric.ts's assertSafeInteger pattern. Kept as a local copy for the
// same reason core/costing/wac.ts keeps its own: @kokoro/shared's package.json only exports "."
// (numeric.ts is deliberately not part of the public barrel), and core/recipes is a trusted boundary
// like core/costing (D-5: this is where a recipe's theoretical cost is computed).
function assertSafeIntegerInput(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationError(`${label} debe ser un entero seguro.`, { [label]: value });
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw validationError(`${label} debe ser un nÃºmero finito no negativo.`, { [label]: value });
  }
}

/** One recipe line's costing input. `unitCost` is integer milli-centavos per WHOLE unit (the
 * `MilliCentavosPerUnit` convention used by `items.wac_mc` / `items.replacement_cost_mc`) â€” pass
 * the ingredient's `wacMc` for the WAC valuation or its `replacementCostMc` for the
 * replacement-cost valuation (C-3b). */
export interface RecipeCostLine {
  /** Milli-units (Doc 04 Â§2). Must be a positive safe integer â€” a zero/negative line is not a
   * valid recipe line (the Zod command schema already enforces this on write; this function
   * re-asserts it defensively rather than trusting the caller). */
  qty: number;
  /** Integer milli-centavos per whole unit; must be a non-negative safe integer. */
  unitCost: MilliCentavosPerUnit;
}

/**
 * C-3b: `theoretical_cost = Î£(line qty Ã— ingredient unit cost) / expected_yield`, expressed as
 * centavos per WHOLE output unit (rounded half-up â€” the only rounding step in this function,
 * D-5). `expectedYieldQty` is milli-units of the output item (Doc 04 Â§2) and MUST be strictly
 * positive: a recipe with zero expected yield can't price anything (division by zero is refused
 * as a precondition, not caught after the fact).
 */
export function computeTheoreticalCostPerOutputUnit(
  lines: readonly RecipeCostLine[],
  expectedYieldQty: number,
): number {
  assertSafeIntegerInput(expectedYieldQty, "expectedYieldQty");
  if (expectedYieldQty <= 0) {
    throw validationError("El rendimiento esperado debe ser un entero positivo.", {
      expectedYieldQty,
    });
  }

  let totalMcMilliUnits = 0;
  for (const line of lines) {
    assertSafeIntegerInput(line.qty, "qty");
    if (line.qty <= 0) {
      throw validationError("La cantidad de la lÃ­nea debe ser un entero positivo.", {
        qty: line.qty,
      });
    }
    assertFiniteNonNegative(line.unitCost, "unitCost");
    assertSafeIntegerInput(line.unitCost, "unitCost");
    if (line.unitCost < 0) {
      throw validationError("El costo unitario debe ser un entero no negativo.", {
        unitCost: line.unitCost,
      });
    }
    totalMcMilliUnits += line.qty * line.unitCost;
  }

  // The rounded rate is milli-centavos per WHOLE output unit; totalCentavos converts the
  // milli-centavo/milli-unit product back to centavos for one whole output unit.
  return totalCentavos(
    toMilliCentavosPerUnit(roundHalfUpToInt(totalMcMilliUnits / expectedYieldQty)),
    WHOLE_UNIT_MILLI_UNITS,
  );
}

export interface RecipeMargin {
  /** Centavos (INV-6): `salePrice âˆ’ costPerOutputUnit`. */
  amount: number;
  /** Basis points (INV-6): `amount / salePrice`, rounded half-up. */
  pctBasisPoints: number;
}

/**
 * C-5, applied to a recipe's theoretical cost instead of `items.wac`/`items.replacement_cost`
 * directly (those only reflect the DEFAULT recipe, per C-3 â€” see C-3b). Returns `null` when there
 * is nothing meaningful to compare against: no sale price set yet, or a sale price of exactly zero
 * (a percentage over zero is undefined, not "0%").
 */
export function computeRecipeMargin(
  salePriceMc: MilliCentavosPerUnit | null,
  costPerOutputUnit: number,
): RecipeMargin | null {
  if (salePriceMc === null || salePriceMc === 0) return null;
  assertSafeIntegerInput(salePriceMc, "salePriceMc");
  assertSafeIntegerInput(costPerOutputUnit, "costPerOutputUnit");

  const salePrice = totalCentavos(salePriceMc, WHOLE_UNIT_MILLI_UNITS);
  const amount = subMoney(salePrice, toCentavos(costPerOutputUnit));
  const pctBasisPoints = roundHalfUpToInt((amount * 10000) / salePrice);
  return { amount, pctBasisPoints };
}
