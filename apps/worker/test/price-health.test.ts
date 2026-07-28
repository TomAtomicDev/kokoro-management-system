import {
  rateFromTotal,
  toCentavos,
  toMilliCentavosPerUnit,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { computePriceMargin, computePriceSuggested } from "../src/core/costing/price-health.js";

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

describe("computePriceMargin (C-5)", () => {
  it("converts a milli-centavo rate to a whole-unit cost", () => {
    expect(computePriceMargin(mc(8_000_000), mc(5_000_000))).toEqual({
      amount: 3000,
      pctBasisPoints: 3750,
    });
    expect(computePriceMargin(mc(4_000_000), mc(5_000_000))).toEqual({
      amount: -1000,
      pctBasisPoints: -2500,
    });
  });

  it("handles absent and zero costs", () => {
    expect(computePriceMargin(null, mc(5_000_000))).toBeNull();
    expect(computePriceMargin(mc(0), mc(5_000_000))).toBeNull();
    expect(computePriceMargin(mc(1_000_000), mc(0))).toEqual({
      amount: 1000,
      pctBasisPoints: 10000,
    });
  });

  it("property: amount plus rounded cost reconstructs sale price", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (salePrice, costMc) => {
          const margin = computePriceMargin(
            rateFromTotal(toCentavos(salePrice), WHOLE_UNIT_MILLI_UNITS),
            mc(costMc),
          );
          expect((margin as { amount: number }).amount + Math.floor(costMc / 1000 + 0.5)).toBe(
            salePrice,
          );
        },
      ),
    );
  });
});

describe("computePriceSuggested (Doc 07 SC-12)", () => {
  it("computes the classic 30% target-margin example", () => {
    expect(computePriceSuggested(mc(7_000_000), 3000)).toBe(10000);
    expect(computePriceSuggested(mc(0), 3000)).toBeNull();
  });

  it("rejects invalid margins and costs", () => {
    expectDomainValidationError(() => computePriceSuggested(mc(5_000_000), 10000));
    expectDomainValidationError(() => computePriceSuggested(mc(5_000_000), 15000));
    expectDomainValidationError(() => computePriceSuggested(mc(-1), 3000));
  });

  it("property: suggested prices reproduce the target within whole-centavo rounding slack", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 100_000_000 }),
        fc.integer({ min: 0, max: 9900 }),
        (replacementCostMc, minMarginPctBp) => {
          const suggested = computePriceSuggested(mc(replacementCostMc), minMarginPctBp) as number;
          const actualBp = (
            computePriceMargin(
              rateFromTotal(toCentavos(suggested), WHOLE_UNIT_MILLI_UNITS),
              mc(replacementCostMc),
            ) as {
              pctBasisPoints: number;
            }
          ).pctBasisPoints;
          const toleranceBp = Math.ceil(10_000 / suggested) + 2;
          expect(Math.abs(actualBp - minMarginPctBp)).toBeLessThanOrEqual(toleranceBp);
        },
      ),
    );
  });

  it("property: raising the target margin never decreases the suggested price", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 100_000_000 }),
        fc.integer({ min: 0, max: 9800 }),
        fc.integer({ min: 0, max: 100 }),
        (replacementCostMc, minMarginPctBp, extraBp) => {
          const before = computePriceSuggested(mc(replacementCostMc), minMarginPctBp) as number;
          const after = computePriceSuggested(
            mc(replacementCostMc),
            minMarginPctBp + extraBp,
          ) as number;
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
    );
  });
});
