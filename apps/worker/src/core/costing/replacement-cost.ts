// core/costing — pure C-3 replacement-cost math for SEMI_FINISHED/FINISHED items (KOK-029, Doc 03
// §4 C-3: "replacement_cost = Σ(default-recipe line qty × ingredient replacement_cost) /
// expected_yield, recomputed by the nightly job and on demand; cached with timestamp").
//
// Deliberately NOT core/recipes/theoretical-cost.ts's computeTheoreticalCostPerOutputUnit, even
// though the shape is nearly identical: that function's job is a live, rounded, per-WHOLE-unit
// preview for comparing against `items.sale_price` (C-3b). This function's job is the CACHED
// column itself — `items.replacement_cost` — which is stored per-MILLI-unit, as a deliberately
// UNROUNDED float, the exact same convention `items.wac` / `stock_movements.unit_cost` use (see
// core/costing/wac.ts's header). Rounding this value would introduce drift every time a
// SEMI_FINISHED item is itself used as an ingredient in a deeper recipe (a multi-level BOM),
// compounding a rounding error at every level instead of only once, at display time, the way
// theoretical-cost.ts's C-3b preview does.
//
// Same "plain, synchronous, DB-free" convention as wac.ts/theoretical-cost.ts — no `Db` parameter,
// nothing async, directly usable by property tests (Doc 11 §2) without a D1 binding.

import { validationError } from "../errors.js";

// Mirrors wac.ts's/theoretical-cost.ts's identical local copy of this guard — see either module's
// header for why core/costing keeps its own rather than reaching into @kokoro/shared's
// non-exported numeric.ts.
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

/** One default-recipe line's costing input — same shape as `RecipeCostLine`
 * (core/recipes/theoretical-cost.ts), duplicated rather than imported because the two live in
 * different trust boundaries with different rounding rules downstream; keeping them separate types
 * stops a future edit to one from silently changing the other's contract. */
export interface ReplacementCostLine {
  /** Milli-units (Doc 04 §2). Must be a positive safe integer. */
  qty: number;
  /** Centavos per milli-unit — the ingredient's CURRENT `replacement_cost` (C-3, recursive: for a
   * RAW_MATERIAL this is its last purchase unit cost; for a SEMI_FINISHED ingredient this is
   * itself C-3's cached value, which is why the refresh job must visit items in dependency
   * order — see core/costing/replacement-cost-refresh.ts). */
  unitCost: number;
}

/**
 * C-3 for SEMI_FINISHED/FINISHED: `replacement_cost = Σ(line qty × ingredient replacement_cost) /
 * expected_yield`, expressed as centavos per MILLI-unit of output (unrounded — the same convention
 * `items.replacement_cost`/`items.wac` already use). `expectedYieldQty` is milli-units of the
 * output item and MUST be strictly positive: a recipe with zero expected yield can't price
 * anything (division by zero is refused as a precondition, not caught after the fact).
 */
export function computeItemReplacementCost(
  lines: readonly ReplacementCostLine[],
  expectedYieldQty: number,
): number {
  assertSafeIntegerInput(expectedYieldQty, "expectedYieldQty");
  if (expectedYieldQty <= 0) {
    throw validationError("El rendimiento esperado debe ser un entero positivo.", {
      expectedYieldQty,
    });
  }

  let totalRawCentavos = 0; // centavos for one full batch, unrounded (matches wac.ts's convention).
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

  return totalRawCentavos / expectedYieldQty;
}
