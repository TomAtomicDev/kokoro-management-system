import { describe, expect, it } from "vitest";

import { confirmFlagSchema, replayImpactSchema } from "./costing";

const emptyImpact = {
  affectedSaleLineIds: [],
  affectedStockExitIds: [],
  affectedProductionRunIds: [],
  affectedItemIds: [],
  costDelta: 0,
  requiresConfirmation: false,
};

describe("replayImpactSchema", () => {
  it("accepts a zero-impact replay (backdated edit after every consumption)", () => {
    const result = replayImpactSchema.safeParse(emptyImpact);
    expect(result.success).toBe(true);
  });

  it("round-trips a populated impact unchanged", () => {
    const impact = {
      affectedSaleLineIds: ["sl_1", "sl_2"],
      affectedStockExitIds: ["se_1"],
      affectedProductionRunIds: ["pr_1"],
      affectedItemIds: ["it_harina", "it_pan"],
      costDelta: -12_345,
      requiresConfirmation: true,
    };
    expect(replayImpactSchema.parse(impact)).toEqual(impact);
  });

  it("accepts a positive costDelta (accumulated margin rose)", () => {
    const result = replayImpactSchema.safeParse({ ...emptyImpact, costDelta: 500 });
    expect(result.success).toBe(true);
  });

  it("rejects a fractional costDelta (D-5: centavos are integers)", () => {
    const result = replayImpactSchema.safeParse({ ...emptyImpact, costDelta: -12.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a costDelta beyond the safe-integer range", () => {
    const result = replayImpactSchema.safeParse({
      ...emptyImpact,
      costDelta: Number.MAX_SAFE_INTEGER + 2,
    });
    expect(result.success).toBe(false);
  });

  it("requires every affected-id array to be present", () => {
    const { affectedItemIds: _omitted, ...withoutItemIds } = emptyImpact;
    const result = replayImpactSchema.safeParse(withoutItemIds);
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean requiresConfirmation", () => {
    const result = replayImpactSchema.safeParse({ ...emptyImpact, requiresConfirmation: "yes" });
    expect(result.success).toBe(false);
  });
});

describe("confirmFlagSchema", () => {
  it("defaults to false when omitted", () => {
    expect(confirmFlagSchema.parse(undefined)).toBe(false);
  });

  it("preserves an explicit true", () => {
    expect(confirmFlagSchema.parse(true)).toBe(true);
  });

  it("preserves an explicit false", () => {
    expect(confirmFlagSchema.parse(false)).toBe(false);
  });

  it("defaults to false when spread into a command schema and omitted", () => {
    const commandSchema = replayImpactSchema
      .pick({ costDelta: true })
      .extend({ confirm: confirmFlagSchema });
    expect(commandSchema.parse({ costDelta: 0 })).toEqual({ costDelta: 0, confirm: false });
  });

  it("rejects a non-boolean", () => {
    expect(confirmFlagSchema.safeParse("true").success).toBe(false);
  });
});
