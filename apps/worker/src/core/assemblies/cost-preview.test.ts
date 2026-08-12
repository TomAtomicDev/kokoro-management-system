import { toMilliCentavosPerUnit } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { computeAssemblyCostPerOutputUnit, computeAssemblyMargin } from "./cost-preview.js";

describe("computeAssemblyCostPerOutputUnit", () => {
  it("sums component costs and divides by output quantity", () => {
    expect(
      computeAssemblyCostPerOutputUnit(
        [
          { qty: 500, unitCost: toMilliCentavosPerUnit(10_000_000) },
          { qty: 200, unitCost: toMilliCentavosPerUnit(3_000_000) },
        ],
        2000,
      ),
    ).toBe(2800);
  });

  it("rounds only the final output-unit cost", () => {
    expect(
      computeAssemblyCostPerOutputUnit([{ qty: 1, unitCost: toMilliCentavosPerUnit(1_001) }], 3),
    ).toBe(0);
  });

  it("rejects invalid output and component quantities", () => {
    expect(() => computeAssemblyCostPerOutputUnit([], 0)).toThrow();
    expect(() =>
      computeAssemblyCostPerOutputUnit([{ qty: 0, unitCost: toMilliCentavosPerUnit(1) }], 1000),
    ).toThrow();
  });

  it("property: raising a component cost never lowers the preview", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (qty, unitCost, increase, outputQty) => {
          const before = computeAssemblyCostPerOutputUnit(
            [{ qty, unitCost: toMilliCentavosPerUnit(unitCost) }],
            outputQty,
          );
          const after = computeAssemblyCostPerOutputUnit(
            [{ qty, unitCost: toMilliCentavosPerUnit(unitCost + increase) }],
            outputQty,
          );
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
    );
  });

  it("property: raising output quantity never raises the preview", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        (qty, unitCost, outputQty, extraOutput) => {
          const lines = [{ qty, unitCost: toMilliCentavosPerUnit(unitCost) }];
          expect(
            computeAssemblyCostPerOutputUnit(lines, outputQty + extraOutput),
          ).toBeLessThanOrEqual(computeAssemblyCostPerOutputUnit(lines, outputQty));
        },
      ),
    );
  });
});

describe("computeAssemblyMargin", () => {
  it("computes positive margin and returns null without a price", () => {
    expect(computeAssemblyMargin(toMilliCentavosPerUnit(1_000_000), 700)).toEqual({
      amount: 300,
      pctBasisPoints: 3000,
    });
    expect(computeAssemblyMargin(null, 700)).toBeNull();
  });
});
