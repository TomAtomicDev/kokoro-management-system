import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rateFromTotal, toCentavos, toMilliCentavosPerUnit, totalCentavos } from "./money";
import { computeMarginBasisPoints } from "./pricing";
import { WHOLE_UNIT_MILLI_UNITS } from "./qty";

const mc = toMilliCentavosPerUnit;

describe("computeMarginBasisPoints (C-5)", () => {
  it("converts milli-centavo rates to a whole-unit margin", () => {
    expect(computeMarginBasisPoints(mc(8_000_000), mc(5_000_000))).toEqual({
      amount: 3000,
      pctBasisPoints: 3750,
    });
    expect(computeMarginBasisPoints(mc(4_000_000), mc(5_000_000))).toEqual({
      amount: -1000,
      pctBasisPoints: -2500,
    });
  });

  it("handles a zero cost (100% margin)", () => {
    expect(computeMarginBasisPoints(mc(1_000_000), mc(0))).toEqual({
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
          const margin = computeMarginBasisPoints(
            rateFromTotal(toCentavos(salePrice), WHOLE_UNIT_MILLI_UNITS),
            mc(costMc),
          );
          expect(margin.amount + totalCentavos(mc(costMc), WHOLE_UNIT_MILLI_UNITS)).toBe(salePrice);
        },
      ),
    );
  });
});
