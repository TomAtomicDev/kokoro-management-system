import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { addMoney, subMoney, toCentavos, toMilliCentavosPerUnit, totalCentavos } from "./money.js";
import { toMilliUnits } from "./qty.js";
import { calculateSaleProductGrossMargin } from "./sales.js";

describe("calculateSaleProductGrossMargin (KOK-205 / Doc 03 §5 O-8)", () => {
  it("property: changing the separate customer charge never changes product gross margin", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.array(
          fc.tuple(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 0, max: 100_000_000 })),
          { minLength: 1, maxLength: 8 },
        ),
        (merchandiseTotal, additionalCharge, lineCosts) => {
          const lines = lineCosts.map(([qty, unitCostSnapshotMc], index) => ({
            id: `line-${index}`,
            itemId: `item-${index}`,
            qty,
            unitPriceMc: toMilliCentavosPerUnit(0),
            unitCostSnapshotMc,
          }));
          const total = addMoney(toCentavos(merchandiseTotal), toCentavos(additionalCharge));
          const chargedSale = { total, additionalCharge, lines };
          const saleWithoutCharge = {
            total: merchandiseTotal,
            additionalCharge: 0,
            lines,
          };
          const frozenCost = lines.reduce(
            (sum, line) =>
              addMoney(
                sum,
                totalCentavos(
                  toMilliCentavosPerUnit(line.unitCostSnapshotMc),
                  toMilliUnits(line.qty),
                ),
              ),
            toCentavos(0),
          );

          expect(calculateSaleProductGrossMargin(chargedSale)).toBe(
            calculateSaleProductGrossMargin(saleWithoutCharge),
          );
          expect(calculateSaleProductGrossMargin(chargedSale)).toBe(
            subMoney(toCentavos(merchandiseTotal), frozenCost),
          );
        },
      ),
    );
  });
});
