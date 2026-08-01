import {
  rateFromTotal,
  toCentavos,
  toMilliCentavosPerUnit,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  computeRecipeMargin,
  computeTheoreticalCostPerOutputUnit,
  type RecipeCostLine,
} from "../src/core/recipes/theoretical-cost.js";

const mc = toMilliCentavosPerUnit;

function expectDomainValidationError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toMatchObject({ code: "VALIDATION" });
}

describe("computeTheoreticalCostPerOutputUnit (C-3b)", () => {
  it("computes a simple single-line recipe", () => {
    expect(
      computeTheoreticalCostPerOutputUnit([{ qty: 1000, unitCost: mc(5_000_000) }], 1000),
    ).toBe(5000);
  });

  it("sums multiple lines and divides by yield", () => {
    const lines: RecipeCostLine[] = [
      { qty: 500, unitCost: mc(10_000_000) },
      { qty: 200, unitCost: mc(3_000_000) },
    ];
    expect(computeTheoreticalCostPerOutputUnit(lines, 2000)).toBe(2800);
  });

  it("allows an empty recipe in pure math but rejects invalid inputs", () => {
    expect(computeTheoreticalCostPerOutputUnit([], 1000)).toBe(0);
    expectDomainValidationError(() => computeTheoreticalCostPerOutputUnit([], 0));
    expectDomainValidationError(() => computeTheoreticalCostPerOutputUnit([], -1000));
    expectDomainValidationError(() =>
      computeTheoreticalCostPerOutputUnit([{ qty: 0, unitCost: mc(5) }], 1000),
    );
    expectDomainValidationError(() =>
      computeTheoreticalCostPerOutputUnit([{ qty: -100, unitCost: mc(5) }], 1000),
    );
    expectDomainValidationError(() =>
      computeTheoreticalCostPerOutputUnit([{ qty: 100, unitCost: mc(-1) }], 1000),
    );
  });

  const lineArb = fc.record({
    qty: fc.integer({ min: 1, max: 1_000_000 }),
    unitCost: fc.integer({ min: 0, max: 100_000_000 }).map(mc),
  });

  it("property: all-zero unit costs always cost nothing", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (qtys, expectedYieldQty) => {
          const lines: RecipeCostLine[] = qtys.map((qty) => ({ qty, unitCost: mc(0) }));
          expect(computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty)).toBe(0);
        },
      ),
    );
  });

  it("property: raising a line cost never decreases the theoretical cost", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (lines, expectedYieldQty, indexSeed, extraCost) => {
          const index = indexSeed % lines.length;
          const raised = lines.map((line, i) =>
            i === index ? { ...line, unitCost: mc(line.unitCost + extraCost) } : line,
          );
          expect(
            computeTheoreticalCostPerOutputUnit(raised, expectedYieldQty),
          ).toBeGreaterThanOrEqual(computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty));
        },
      ),
    );
  });

  it("property: raising expected yield never increases the result", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        (lines, expectedYieldQty, extraYield) => {
          expect(
            computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty + extraYield),
          ).toBeLessThanOrEqual(computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty));
        },
      ),
    );
  });
});

describe("computeRecipeMargin (C-5, applied to a recipe's theoretical cost)", () => {
  it("computes positive and negative margins", () => {
    expect(computeRecipeMargin(toMilliCentavosPerUnit(1_000_000), 700)).toEqual({
      amount: 300,
      pctBasisPoints: 3000,
    });
    expect(computeRecipeMargin(toMilliCentavosPerUnit(500_000), 800)).toEqual({
      amount: -300,
      pctBasisPoints: -6000,
    });
  });

  it("returns null without a positive sale price", () => {
    expect(computeRecipeMargin(null, 700)).toBeNull();
    expect(computeRecipeMargin(toMilliCentavosPerUnit(0), 700)).toBeNull();
  });

  it("property: amount plus cost reconstructs sale price", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (salePrice, costPerOutputUnit) => {
          const margin = computeRecipeMargin(
            rateFromTotal(toCentavos(salePrice), WHOLE_UNIT_MILLI_UNITS),
            costPerOutputUnit,
          );
          expect((margin as { amount: number }).amount + costPerOutputUnit).toBe(salePrice);
        },
      ),
    );
  });
});
