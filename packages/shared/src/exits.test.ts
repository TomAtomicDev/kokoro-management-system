import { describe, expect, it } from "vitest";

import { recordStockExitCommandSchema } from "./exits.js";

const baseCommand = {
  itemId: "item-1",
  qty: 1000,
  reason: "GIFT_SAMPLE" as const,
  occurredAt: "2026-08-12T12:00:00.000Z",
  businessDate: "2026-08-12",
};

describe("recordStockExitCommandSchema packaging lines", () => {
  it("defaults packaging lines to an empty array", () => {
    expect(recordStockExitCommandSchema.parse(baseCommand).packagingLines).toEqual([]);
  });

  it("accepts positive milli-unit packaging quantities", () => {
    const parsed = recordStockExitCommandSchema.parse({
      ...baseCommand,
      packagingLines: [{ itemId: "bag-1", qty: 500 }],
    });
    expect(parsed.packagingLines).toEqual([{ itemId: "bag-1", qty: 500 }]);
  });

  it("rejects zero, negative, and fractional packaging quantities", () => {
    for (const qty of [0, -1, 1.5]) {
      expect(
        recordStockExitCommandSchema.safeParse({
          ...baseCommand,
          packagingLines: [{ itemId: "bag-1", qty }],
        }).success,
      ).toBe(false);
    }
  });
});
