import { describe, expect, it } from "vitest";

import {
  commitCountCommandSchema,
  listCountsFiltersSchema,
  startCountCommandSchema,
} from "./counts";
import { toBusinessDate } from "./dates";

const shiftedDate = (days: number): string => {
  const shifted = new Date();
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toBusinessDate(shifted);
};

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

// KOK-168 (F-17): counts.ts must use dates.ts's real businessDateSchema/occurredAtSchema on the
// count's own date fields, not locally-redeclared copies without the future-date refinement.
describe("startCountCommandSchema dates (KOK-168 / F-17)", () => {
  it("rejects a future businessDate even with a valid occurredAt", () => {
    const result = startCountCommandSchema.safeParse({
      occurredAt: new Date().toISOString(),
      businessDate: shiftedDate(1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts today's businessDate/occurredAt", () => {
    const result = startCountCommandSchema.safeParse({
      occurredAt: new Date().toISOString(),
      businessDate: shiftedDate(0),
    });
    expect(result.success).toBe(true);
  });
});

describe("listCountsFiltersSchema date range (KOK-168 / F-17)", () => {
  it("accepts a future fromDate/toDate — a filter boundary is not a transaction date", () => {
    const future = shiftedDate(14);
    expect(listCountsFiltersSchema.safeParse({ fromDate: future, toDate: future }).success).toBe(
      true,
    );
  });
});
