import { toMilliCentavosPerUnit } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { computeAssemblyCost } from "./cost.js";

describe("computeAssemblyCost", () => {
  it("transfers the complete direct cost into actual output", () => {
    expect(
      computeAssemblyCost(
        [
          { qty: 5000, unitCostSnapshotMc: toMilliCentavosPerUnit(1_300_000) },
          { qty: 5000, unitCostSnapshotMc: toMilliCentavosPerUnit(1_800_000) },
          { qty: 5000, unitCostSnapshotMc: toMilliCentavosPerUnit(570_000) },
          { qty: 5000, unitCostSnapshotMc: toMilliCentavosPerUnit(300_000) },
          { qty: 5000, unitCostSnapshotMc: toMilliCentavosPerUnit(50_000) },
          { qty: 5000, unitCostSnapshotMc: toMilliCentavosPerUnit(50_000) },
        ],
        5000,
      ),
    ).toEqual({ directCost: 20_350, outputUnitCostMc: 4_070_000 });
  });

  it("rejects zero actual output through the sanctioned rate conversion", () => {
    expect(() => computeAssemblyCost([], 0)).toThrow();
  });

  it("property: raising an input cost never lowers direct or output cost", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (qty, unitCost, increase, outputQty) => {
          const before = computeAssemblyCost(
            [{ qty, unitCostSnapshotMc: toMilliCentavosPerUnit(unitCost) }],
            outputQty,
          );
          const after = computeAssemblyCost(
            [{ qty, unitCostSnapshotMc: toMilliCentavosPerUnit(unitCost + increase) }],
            outputQty,
          );
          expect(after.directCost).toBeGreaterThanOrEqual(before.directCost);
          expect(after.outputUnitCostMc).toBeGreaterThanOrEqual(before.outputUnitCostMc);
        },
      ),
    );
  });
});
