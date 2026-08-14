import { describe, expect, it } from "vitest";

import { commitCountCommandSchema } from "./counts";

describe("commit count opening valuation schema (KOK-084 / C-8)", () => {
  it("allows ordinary commits without opening costs and accepts positive milli-centavos", () => {
    expect(commitCountCommandSchema.parse({ countId: "count-1" })).toEqual({ countId: "count-1" });
    expect(
      commitCountCommandSchema.parse({
        countId: "count-1",
        lines: [{ itemId: "item-1", unitCostMc: 2_500_000 }],
      }),
    ).toEqual({
      countId: "count-1",
      lines: [{ itemId: "item-1", unitCostMc: 2_500_000 }],
    });
  });

  it("rejects zero or fractional opening costs at the shared command boundary", () => {
    expect(
      commitCountCommandSchema.safeParse({
        countId: "count-1",
        lines: [{ itemId: "item-1", unitCostMc: 0 }],
      }).success,
    ).toBe(false);
    expect(
      commitCountCommandSchema.safeParse({
        countId: "count-1",
        lines: [{ itemId: "item-1", unitCostMc: 1.5 }],
      }).success,
    ).toBe(false);
  });
});
