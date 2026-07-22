// core/recipes — pure theoretical-cost math (KOK-025, Doc 03 §4 C-3b — a KOK-025 KB amendment
// generalizing C-3's replacement-cost formula to a WAC basis and to any recipe, not only the
// default). Every function here is plain, synchronous, DB-free (same convention as
// core/costing/wac.ts), so it is directly usable by both the recipe service and fast-check property
// tests (Doc 11 §2) without a D1 binding.
//
// Rounding discipline (D-5, INV-6): the running total inside `computeTheoreticalCostPerOutputUnit`
// is a raw, UNROUNDED float (centavos-per-milli-unit, the same convention `items.wac` /
// `items.replacement_cost` already use, per core/costing/wac.ts's header) — it is only rounded to a
// whole-centavos integer once, at the very end, when it becomes a genuine money amount comparable to
// `items.sale_price`. `computeRecipeMargin`'s subtraction runs on already-rounded integers via
// money.ts's own helpers, never on the raw intermediate.

import { roundHalfUpToInt, subMoney } from "@kokoro/shared";

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
    throw validationError(`${label} debe ser un número finito no negativo.`, { [label]: value });
  }
}

/** One recipe line's costing input. `unitCost` is centavos PER MILLI-UNIT (the same convention as
 * `items.wac` / `items.replacement_cost`, NOT the whole-unit convention `money.ts`'s
 * `mulMoneyByQty` expects) — pass the ingredient's `wac` for the WAC valuation or its
 * `replacementCost` for the replacement-cost valuation (C-3b). */
export interface RecipeCostLine {
  /** Milli-units (Doc 04 §2). Must be a positive safe integer — a zero/negative line is not a
   * valid recipe line (the Zod command schema already enforces this on write; this function
   * re-asserts it defensively rather than trusting the caller). */
  qty: number;
  /** Centavos per milli-unit — a float, never itself rounded (mirrors `items.wac`'s convention). */
  unitCost: number;
}

/**
 * C-3b: `theoretical_cost = Σ(line qty × ingredient unit cost) / expected_yield`, expressed as
 * centavos per WHOLE output unit (rounded half-up — the only rounding step in this function,
 * D-5). `expectedYieldQty` is milli-units of the output item (Doc 04 §2) and MUST be strictly
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

  let totalRawCentavos = 0; // centavos for one full batch, unrounded intermediate (C-3b).
  for (const line of lines) {
    assertSafeIntegerInput(line.qty, "qty");
    if (line.qty <= 0) {
      throw validationError("La cantidad de la línea debe ser un entero positivo.", {
        qty: line.qty,
      });
    }
    assertFiniteNonNegative(line.unitCost, "unitCost");
    totalRawCentavos += line.qty * line.unitCost;
  }

  // totalRawCentavos / expectedYieldQty = centavos per milli-unit of OUTPUT (same convention as
  // items.wac); × 1000 milli-units/unit converts to centavos per WHOLE output unit.
  return roundHalfUpToInt((totalRawCentavos / expectedYieldQty) * 1000);
}

export interface RecipeMargin {
  /** Centavos (INV-6): `salePrice − costPerOutputUnit`. */
  amount: number;
  /** Basis points (INV-6): `amount / salePrice`, rounded half-up. */
  pctBasisPoints: number;
}

/**
 * C-5, applied to a recipe's theoretical cost instead of `items.wac`/`items.replacement_cost`
 * directly (those only reflect the DEFAULT recipe, per C-3 — see C-3b). Returns `null` when there
 * is nothing meaningful to compare against: no sale price set yet, or a sale price of exactly zero
 * (a percentage over zero is undefined, not "0%").
 */
export function computeRecipeMargin(
  salePrice: number | null,
  costPerOutputUnit: number,
): RecipeMargin | null {
  if (salePrice === null || salePrice === 0) return null;
  assertSafeIntegerInput(salePrice, "salePrice");
  assertSafeIntegerInput(costPerOutputUnit, "costPerOutputUnit");

  const amount = subMoney(salePrice, costPerOutputUnit);
  const pctBasisPoints = roundHalfUpToInt((amount * 10000) / salePrice);
  return { amount, pctBasisPoints };
}
