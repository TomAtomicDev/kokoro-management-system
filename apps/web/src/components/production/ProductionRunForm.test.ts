import type { ProductionRunDto, RecipeDto } from "@kokoro/shared";
import { describe, expect, it } from "vitest";

import {
  productionRunEditTracking,
  productionRunToFormState,
  recomputeProductionRunForBatches,
} from "./ProductionRunForm";

function recipe(overrides: Partial<RecipeDto> = {}): RecipeDto {
  return {
    id: "recipe-1",
    name: "Pan de prueba",
    outputItemId: "output-1",
    expectedYieldQty: 1000,
    estLaborMin: null,
    isDefault: true,
    isActive: true,
    notes: null,
    lines: [
      { id: "recipe-line-1", itemId: "ingredient-1", qty: 200 },
      { id: "recipe-line-2", itemId: "ingredient-2", qty: 500 },
    ],
    theoreticalCostWac: { costPerOutputUnit: 100, margin: null },
    theoreticalCostReplacement: { costPerOutputUnit: 120, margin: null },
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

function productionRun(overrides: Partial<ProductionRunDto> = {}): ProductionRunDto {
  return {
    id: "production-run-1",
    occurredAt: "2026-07-01T12:00:00.000Z",
    businessDate: "2026-07-01",
    recipeId: "recipe-1",
    sessionId: "session-1",
    customOrderId: null,
    batches: 1,
    outputItemId: "output-1",
    actualOutputQty: 1000,
    indirectCost: 0,
    allocatedSessionCost: 0,
    directCost: 100,
    totalCost: 100,
    outputUnitCostMc: 100,
    code: null,
    notes: "Nota original",
    lines: [
      { id: "consumption-1", itemId: "ingredient-1", qty: 200, unitCostSnapshotMc: 100 },
      { id: "consumption-2", itemId: "ingredient-2", qty: 500, unitCostSnapshotMc: 100 },
    ],
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("productionRunToFormState", () => {
  it("keys matched saved lines by recipe id and gives unmatched lines stable collision-safe keys", () => {
    const currentRecipe = recipe({
      lines: [
        { id: "recipe-line-1", itemId: "ingredient-1", qty: 200 },
        {
          id: "saved-production-line-consumption-removed",
          itemId: "ingredient-2",
          qty: 500,
        },
      ],
    });
    const run = productionRun({
      lines: [
        { id: "consumption-1", itemId: "ingredient-1", qty: 200, unitCostSnapshotMc: 100 },
        { id: "consumption-removed", itemId: "removed-item", qty: 500, unitCostSnapshotMc: 100 },
      ],
    });

    const state = productionRunToFormState(run, currentRecipe);
    const repeatedState = productionRunToFormState(run, currentRecipe);

    expect(state.lines[0]?.lineKey).toBe("recipe-line-1");
    expect(state.lines[1]?.lineKey).toBe("saved-production-line-consumption-removed-1");
    expect(repeatedState.lines).toEqual(state.lines);
    expect(currentRecipe.lines.some((line) => line.id === state.lines[1]?.lineKey)).toBe(false);
  });
});

describe("production run edit-mode quantity tracking", () => {
  it("recomputes clean saved output and every ingredient when batches change", () => {
    const currentRecipe = recipe();
    const run = productionRun();
    const initial = productionRunToFormState(run, currentRecipe);
    const tracking = productionRunEditTracking(run, currentRecipe, initial.lines);

    expect(tracking.actualOutputQtyDirty).toBe(false);
    expect(tracking.dirtyLineKeys).toEqual(new Set());

    const next = recomputeProductionRunForBatches(
      {
        actualOutputQty: initial.actualOutputQty,
        actualOutputQtyAuto: tracking.actualOutputQtyAuto,
        actualOutputQtyDirty: tracking.actualOutputQtyDirty,
        lines: initial.lines,
        lineAutoQty: tracking.lineAutoQty,
        dirtyLineKeys: tracking.dirtyLineKeys,
      },
      currentRecipe,
      3,
    );

    expect(next.actualOutputQty).toBe("3");
    expect(next.lines.map((line) => line.qty)).toEqual(["0.6", "1.5"]);
  });

  it("protects a saved hand-edited line and output while recomputing untouched values", () => {
    const currentRecipe = recipe();
    const run = productionRun({
      actualOutputQty: 750,
      lines: [
        { id: "consumption-1", itemId: "ingredient-1", qty: 350, unitCostSnapshotMc: 100 },
        { id: "consumption-2", itemId: "ingredient-2", qty: 500, unitCostSnapshotMc: 100 },
      ],
    });
    const initial = productionRunToFormState(run, currentRecipe);
    const tracking = productionRunEditTracking(run, currentRecipe, initial.lines);

    expect(tracking.actualOutputQtyDirty).toBe(true);
    expect(tracking.dirtyLineKeys).toEqual(new Set(["recipe-line-1"]));

    const next = recomputeProductionRunForBatches(
      {
        actualOutputQty: initial.actualOutputQty,
        actualOutputQtyAuto: tracking.actualOutputQtyAuto,
        actualOutputQtyDirty: tracking.actualOutputQtyDirty,
        lines: initial.lines,
        lineAutoQty: tracking.lineAutoQty,
        dirtyLineKeys: tracking.dirtyLineKeys,
      },
      currentRecipe,
      3,
    );

    expect(next.actualOutputQty).toBe("0.75");
    expect(next.lines.map((line) => line.qty)).toEqual(["0.35", "1.5"]);
  });

  it("leaves consumption quantities byte-identical when only notes are changed", () => {
    const currentRecipe = recipe();
    const run = productionRun({ notes: "Nota editada" });
    const initial = productionRunToFormState(run, currentRecipe);
    const tracking = productionRunEditTracking(run, currentRecipe, initial.lines);
    const next = recomputeProductionRunForBatches(
      {
        actualOutputQty: initial.actualOutputQty,
        actualOutputQtyAuto: tracking.actualOutputQtyAuto,
        actualOutputQtyDirty: tracking.actualOutputQtyDirty,
        lines: initial.lines,
        lineAutoQty: tracking.lineAutoQty,
        dirtyLineKeys: tracking.dirtyLineKeys,
      },
      currentRecipe,
      1,
    );

    expect(initial.notes).toBe("Nota editada");
    expect(next.lines.map((line) => line.qty)).toEqual(initial.lines.map((line) => line.qty));
  });
});
