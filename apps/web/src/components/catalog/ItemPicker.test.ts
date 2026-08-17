import { describe, expect, it } from "vitest";

import { isItemEligible } from "./ItemPicker";

describe("isItemEligible", () => {
  it("accepts every item when no eligibility constraints are provided", () => {
    expect(isItemEligible({ kind: "RAW_MATERIAL", unit: "KG", isUnmetered: true })).toBe(true);
  });

  it("excludes unmetered items from a measured-item picker", () => {
    const eligibility = { isUnmetered: false } as const;

    expect(
      isItemEligible({ kind: "RAW_MATERIAL", unit: "L", isUnmetered: false }, eligibility),
    ).toBe(true);
    expect(
      isItemEligible({ kind: "RAW_MATERIAL", unit: "L", isUnmetered: true }, eligibility),
    ).toBe(false);
  });

  it("requires both FINISHED kind and UNIT for Envasado output", () => {
    const eligibility = { kind: "FINISHED" as const, unit: "UNIT" as const };

    expect(
      isItemEligible({ kind: "FINISHED", unit: "UNIT", isUnmetered: false }, eligibility),
    ).toBe(true);
    expect(isItemEligible({ kind: "FINISHED", unit: "KG", isUnmetered: false }, eligibility)).toBe(
      false,
    );
    expect(
      isItemEligible({ kind: "RAW_MATERIAL", unit: "UNIT", isUnmetered: false }, eligibility),
    ).toBe(false);
  });

  it("supports arrays for kind and unit constraints", () => {
    expect(
      isItemEligible(
        { kind: "SEMI_FINISHED", unit: "KG", isUnmetered: false },
        { kind: ["RAW_MATERIAL", "SEMI_FINISHED"], unit: ["KG", "L"] },
      ),
    ).toBe(true);
  });
});
