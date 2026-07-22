// Unit + property tests for core/recipes's pure theoretical-cost math (KOK-025, Doc 03 §4 C-3b,
// Doc 11 §1-2). Plain, synchronous, DB-free (see theoretical-cost.ts's header) — a plain Vitest run
// is enough, no D1 binding needed.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  computeRecipeMargin,
  computeTheoreticalCostPerOutputUnit,
  type RecipeCostLine,
} from "../src/core/recipes/theoretical-cost.js";

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
  it("computes a simple single-line recipe: 1000 milli-units of flour @ 5 centavos/milli-unit, yield 1 whole unit", () => {
    // batch cost = 1000 * 5 = 5000 centavos; / expectedYield(1000 milli-units) * 1000 = 5000.
    const lines: RecipeCostLine[] = [{ qty: 1000, unitCost: 5 }];
    expect(computeTheoreticalCostPerOutputUnit(lines, 1000)).toBe(5000);
  });

  it("sums multiple lines and divides by yield", () => {
    // batch cost = 500*10 + 200*3 = 5000 + 600 = 5600 centavos, yield = 2000 milli-units (2 units)
    // -> 5600/2000*1000 = 2800 centavos per whole output unit.
    const lines: RecipeCostLine[] = [
      { qty: 500, unitCost: 10 },
      { qty: 200, unitCost: 3 },
    ];
    expect(computeTheoreticalCostPerOutputUnit(lines, 2000)).toBe(2800);
  });

  it("a recipe with no lines costs nothing (degenerate case; the Zod command schema is what forbids empty recipes on write, not this pure function)", () => {
    expect(computeTheoreticalCostPerOutputUnit([], 1000)).toBe(0);
  });

  it("rejects a non-positive expectedYieldQty", () => {
    expectDomainValidationError(() => computeTheoreticalCostPerOutputUnit([], 0));
    expectDomainValidationError(() => computeTheoreticalCostPerOutputUnit([], -1000));
  });

  it("rejects a non-positive line qty", () => {
    expectDomainValidationError(() =>
      computeTheoreticalCostPerOutputUnit([{ qty: 0, unitCost: 5 }], 1000),
    );
    expectDomainValidationError(() =>
      computeTheoreticalCostPerOutputUnit([{ qty: -100, unitCost: 5 }], 1000),
    );
  });

  it("rejects a negative unit cost", () => {
    expectDomainValidationError(() =>
      computeTheoreticalCostPerOutputUnit([{ qty: 100, unitCost: -1 }], 1000),
    );
  });

  const lineArb = fc.record({
    qty: fc.integer({ min: 1, max: 1_000_000 }),
    unitCost: fc.double({ min: 0, max: 100_000, noNaN: true }),
  });

  it("property: all-zero unit costs always cost nothing, regardless of quantities or yield", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (qtys, expectedYieldQty) => {
          const lines: RecipeCostLine[] = qtys.map((qty) => ({ qty, unitCost: 0 }));
          expect(computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty)).toBe(0);
        },
      ),
    );
  });

  it("property: raising any single line's unit cost never decreases the theoretical cost (all else fixed)", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 9 }),
        fc.double({ min: 0, max: 100_000, noNaN: true }),
        (lines, expectedYieldQty, indexSeed, extraCost) => {
          const index = indexSeed % lines.length;
          const before = computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty);
          const raised = lines.map((line, i) =>
            i === index ? { ...line, unitCost: line.unitCost + extraCost } : line,
          );
          const after = computeTheoreticalCostPerOutputUnit(raised, expectedYieldQty);
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
    );
  });

  it("property: raising expected yield never increases the theoretical cost (lines fixed) — more output spreads the same batch cost thinner", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        (lines, expectedYieldQty, extraYield) => {
          const before = computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty);
          const after = computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty + extraYield);
          expect(after).toBeLessThanOrEqual(before);
        },
      ),
    );
  });
});

describe("computeRecipeMargin (C-5, applied to a recipe's theoretical cost)", () => {
  it("computes a positive margin when price exceeds cost", () => {
    expect(computeRecipeMargin(1000, 700)).toEqual({ amount: 300, pctBasisPoints: 3000 });
  });

  it("computes a negative margin when cost exceeds price (below-cost pricing, C-5 alert territory)", () => {
    const margin = computeRecipeMargin(500, 800);
    expect(margin?.amount).toBe(-300);
    expect(margin?.pctBasisPoints).toBe(-6000);
  });

  it("returns null when there is no sale price set", () => {
    expect(computeRecipeMargin(null, 700)).toBeNull();
  });

  it("returns null when the sale price is exactly zero (a percentage over zero is undefined, not 0%)", () => {
    expect(computeRecipeMargin(0, 700)).toBeNull();
  });

  it("property: amount + costPerOutputUnit always reconstructs salePrice exactly, whenever margin is non-null", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (salePrice, costPerOutputUnit) => {
          const margin = computeRecipeMargin(salePrice, costPerOutputUnit);
          expect(margin).not.toBeNull();
          expect((margin as { amount: number }).amount + costPerOutputUnit).toBe(salePrice);
        },
      ),
    );
  });
});
