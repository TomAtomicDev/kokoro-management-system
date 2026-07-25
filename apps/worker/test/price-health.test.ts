// Unit + property tests for core/costing's pure C-5 margin/price-suggestion math (KOK-035, Doc 03
// §4 C-5, Doc 07 SC-12, Doc 11 §1-2). Plain, synchronous, DB-free (see price-health.ts's header) —
// a plain Vitest run is enough, no D1 binding needed. Mirrors
// test/recipes-theoretical-cost.test.ts's exact style for the sibling C-3b pure-math module.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { computePriceMargin, computePriceSuggested } from "../src/core/costing/price-health.js";

function expectDomainValidationError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toMatchObject({ code: "VALIDATION" });
}

describe("computePriceMargin (C-5)", () => {
  it("converts the per-milli-unit cost to per-whole-unit before subtracting from price", () => {
    // costPerMilliUnit=5 -> 5*1000=5000 centavos/unit; price=8000 -> margin 3000, 37.5% -> 3750bp.
    expect(computePriceMargin(8000, 5)).toEqual({ amount: 3000, pctBasisPoints: 3750 });
  });

  it("computes a negative margin when cost (converted) exceeds price — C-5 alert territory", () => {
    const margin = computePriceMargin(4000, 5); // cost/unit = 5000 > price 4000
    expect(margin).toEqual({ amount: -1000, pctBasisPoints: -2500 });
  });

  it("returns null when there is no sale price set", () => {
    expect(computePriceMargin(null, 5)).toBeNull();
  });

  it("returns null when the sale price is exactly zero", () => {
    expect(computePriceMargin(0, 5)).toBeNull();
  });

  it("a zero cost yields a 100% margin", () => {
    expect(computePriceMargin(1000, 0)).toEqual({ amount: 1000, pctBasisPoints: 10000 });
  });

  it("property: amount + rounded costPerUnit always reconstructs salePrice exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.double({ min: 0, max: 100_000, noNaN: true }),
        (salePrice, costPerMilliUnit) => {
          const margin = computePriceMargin(salePrice, costPerMilliUnit);
          expect(margin).not.toBeNull();
          const costPerUnit = Math.round(costPerMilliUnit * 1000);
          expect((margin as { amount: number }).amount + costPerUnit).toBe(salePrice);
        },
      ),
    );
  });
});

describe("computePriceSuggested (Doc 07 SC-12)", () => {
  it("computes the classic example: replacement cost 7 centavos/milli-unit, 30% target margin", () => {
    // costPerUnit = 7*1000 = 7000; 7000 / (1 - 0.30) = 10000.
    expect(computePriceSuggested(7, 3000)).toBe(10000);
  });

  it("returns null when replacement cost is zero (nothing to mark up from yet)", () => {
    expect(computePriceSuggested(0, 3000)).toBeNull();
  });

  it("rejects a target margin of 100% or more (no finite price achieves it)", () => {
    expectDomainValidationError(() => computePriceSuggested(5, 10000));
    expectDomainValidationError(() => computePriceSuggested(5, 15000));
  });

  it("rejects a negative replacement cost", () => {
    expectDomainValidationError(() => computePriceSuggested(-1, 3000));
  });

  it("property: the suggested price, fed back through computePriceMargin, reproduces the target margin within the rounding slack a whole-centavo price allows", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100_000, noNaN: true }),
        fc.integer({ min: 0, max: 9900 }),
        (replacementCostPerMilliUnit, minMarginPctBp) => {
          const suggested = computePriceSuggested(replacementCostPerMilliUnit, minMarginPctBp);
          expect(suggested).not.toBeNull();
          const margin = computePriceMargin(suggested, replacementCostPerMilliUnit);
          expect(margin).not.toBeNull();
          const actualBp = (margin as { pctBasisPoints: number }).pctBasisPoints;
          // Two independent half-up roundings can each shift the effective numerator by up to 0.5
          // centavo in the same direction (rounding `suggested` itself, and re-rounding the cost
          // inside computePriceMargin) — up to ~1 whole centavo combined, which is a LARGER share
          // of bp for a small price than a large one (e.g. Bs 0.10 vs Bs 1000.00). So the tolerance
          // must scale with 1/suggested, not be a flat few bp.
          const toleranceBp = Math.ceil(10000 / (suggested as number)) + 2;
          expect(Math.abs(actualBp - minMarginPctBp)).toBeLessThanOrEqual(toleranceBp);
        },
      ),
    );
  });

  it("property: raising the target margin never decreases the suggested price (cost fixed)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100_000, noNaN: true }),
        fc.integer({ min: 0, max: 9800 }),
        fc.integer({ min: 0, max: 100 }),
        (replacementCostPerMilliUnit, minMarginPctBp, extraBp) => {
          const before = computePriceSuggested(replacementCostPerMilliUnit, minMarginPctBp);
          const after = computePriceSuggested(
            replacementCostPerMilliUnit,
            minMarginPctBp + extraBp,
          );
          expect(after).not.toBeNull();
          expect(before).not.toBeNull();
          expect(after as number).toBeGreaterThanOrEqual(before as number);
        },
      ),
    );
  });
});
