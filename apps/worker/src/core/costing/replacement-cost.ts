// core/costing — pure C-3 replacement-cost math for SEMI_FINISHED/FINISHED items (KOK-029, Doc 03
// §4 C-3: "replacement_cost = Σ(default-recipe line qty × ingredient replacement_cost) /
// expected_yield, recomputed by the nightly job and on demand; cached with timestamp").
//
// Deliberately NOT core/recipes/theoretical-cost.ts's computeTheoreticalCostPerOutputUnit, even
// though the shape is nearly identical: that function's job is a live, rounded, per-WHOLE-unit
// preview for comparing against `items.sale_price_mc` (C-3b). This function's job is the CACHED
// column itself — `items.replacement_cost_mc` — an integer `MilliCentavosPerUnit`.
//
// The cache is an integer even though it is read back RECURSIVELY as an ingredient cost by a
// deeper item's C-3 (RAW_MATERIAL → SEMI_FINISHED → FINISHED), because the `_mc` grid bounds each
// level's quantization to <= 0.5 mc — three decimal digits below the centavo the value is ever
// displayed at, and negligible against the leaf quantization that is unavoidable either way
// (ADR-017). Round half-up once here, then let dependency order feed that integer cache to deeper
// levels; display rounding remains a separate, coarser concern.
//
// Same "plain, synchronous, DB-free" convention as wac.ts/theoretical-cost.ts — no `Db` parameter,
// nothing async, directly usable by property tests (Doc 11 §2) without a D1 binding.

import {
  type MilliCentavosPerUnit,
  roundHalfUpToInt,
  toMilliCentavosPerUnit,
} from "@kokoro/shared";

import { validationError } from "../errors.js";

/**
 * C-3c read-time projection for every replacement-cost consumer. A non-null timestamp proves the
 * stored replacement cost came from a real purchase/owner estimate (or a derived-item refresh);
 * until then, WAC is the only meaningful available valuation. This helper never persists the
 * fallback into the item row.
 */
export function computeEffectiveReplacementCost(
  replacementCostMc: MilliCentavosPerUnit,
  replacementCostUpdatedAt: string | null,
  wacMc: MilliCentavosPerUnit,
): MilliCentavosPerUnit {
  return replacementCostUpdatedAt !== null ? replacementCostMc : wacMc;
}

// Mirrors wac.ts's/theoretical-cost.ts's identical local copy of this guard — see either module's
// header for why core/costing keeps its own rather than reaching into @kokoro/shared's
// non-exported numeric.ts.
function assertSafeIntegerInput(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationError(`${label} debe ser un entero seguro.`, { [label]: value });
  }
}

/** One default-recipe line's costing input — same shape as `RecipeCostLine`
 * (core/recipes/theoretical-cost.ts), duplicated rather than imported because the two live in
 * different trust boundaries with different rounding rules downstream; keeping them separate types
 * stops a future edit to one from silently changing the other's contract. */
export interface ReplacementCostLine {
  /** Milli-units (Doc 04 §2). Must be a positive safe integer. */
  qty: number;
  /** Milli-centavos per WHOLE unit — the ingredient's current `replacement_cost_mc` (C-3, recursive: for a
   * RAW_MATERIAL this is its last purchase unit cost; for a SEMI_FINISHED ingredient this is
   * itself C-3's cached value, which is why the refresh job must visit items in dependency
   * order — see core/costing/replacement-cost-refresh.ts). */
  unitCost: MilliCentavosPerUnit;
}

/**
 * C-3 for SEMI_FINISHED/FINISHED: `replacement_cost_mc = roundHalfUp(Σ(line qty × ingredient
 * replacement_cost_mc) / expected_yield)`, expressed as milli-centavos per WHOLE output unit.
 * `expectedYieldQty` is milli-units of the
 * output item and MUST be strictly positive: a recipe with zero expected yield can't price
 * anything (division by zero is refused as a precondition, not caught after the fact).
 */
export function computeItemReplacementCost(
  lines: readonly ReplacementCostLine[],
  expectedYieldQty: number,
): MilliCentavosPerUnit {
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
      throw validationError("La cantidad de la línea debe ser un entero positivo.", {
        qty: line.qty,
      });
    }
    assertSafeIntegerInput(line.unitCost, "unitCost");
    if (line.unitCost < 0) {
      throw validationError("El costo unitario debe ser un entero no negativo.", {
        unitCost: line.unitCost,
      });
    }
    totalMcMilliUnits += line.qty * line.unitCost;
  }

  return toMilliCentavosPerUnit(roundHalfUpToInt(totalMcMilliUnits / expectedYieldQty));
}
