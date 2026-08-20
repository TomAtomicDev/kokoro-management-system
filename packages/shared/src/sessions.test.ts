import { describe, expect, it } from "vitest";

import { toBusinessDate } from "./dates.js";
import {
  listSessionsFiltersSchema,
  recordSessionCommandSchema,
  updateSessionCommandSchema,
} from "./sessions.js";

const STARTED_AT = "2026-08-11T14:00:00.000Z";

const shiftedDate = (days: number): string => {
  const shifted = new Date();
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toBusinessDate(shifted);
};

describe("recordSessionCommandSchema session timing", () => {
  it("requires startedAt", () => {
    expect(
      recordSessionCommandSchema.safeParse({ type: "PRODUCTION", businessDate: "2026-08-11" })
        .success,
    ).toBe(false);
  });

  it("rejects endedAt and durationMin together", () => {
    const parsed = recordSessionCommandSchema.safeParse({
      type: "PRODUCTION",
      businessDate: "2026-08-11",
      startedAt: STARTED_AT,
      endedAt: "2026-08-11T15:00:00.000Z",
      durationMin: 60,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toContain("no ambas");
  });

  it.each([STARTED_AT, "2026-08-11T13:59:59.999Z"])(
    "rejects an end that is not after the start (%s)",
    (endedAt) => {
      expect(
        recordSessionCommandSchema.safeParse({
          type: "PRODUCTION",
          businessDate: "2026-08-11",
          startedAt: STARTED_AT,
          endedAt,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts an end strictly after the start", () => {
    expect(
      recordSessionCommandSchema.safeParse({
        type: "PRODUCTION",
        businessDate: "2026-08-11",
        startedAt: STARTED_AT,
        endedAt: "2026-08-11T14:00:00.001Z",
      }).success,
    ).toBe(true);
  });

  it("applies the timing rules to updates too", () => {
    expect(
      updateSessionCommandSchema.safeParse({
        type: "PRODUCTION",
        businessDate: "2026-08-11",
        startedAt: STARTED_AT,
        endedAt: STARTED_AT,
        status: "CLOSED",
      }).success,
    ).toBe(false);
  });
});

// KOK-168 (F-17): sessions.ts must use dates.ts's real businessDateSchema on its own businessDate
// field, not a locally-redeclared copy without the future-date refinement (A-6/D-1).
describe("recordSessionCommandSchema businessDate (KOK-168 / F-17)", () => {
  it("rejects a future businessDate", () => {
    const result = recordSessionCommandSchema.safeParse({
      type: "PRODUCTION",
      businessDate: shiftedDate(1),
      startedAt: STARTED_AT,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("La fecha no puede ser futura.");
    }
  });
});

describe("listSessionsFiltersSchema date range (KOK-168 / F-17)", () => {
  it("accepts a future fromDate/toDate — a filter boundary is not a transaction date", () => {
    const future = shiftedDate(14);
    expect(listSessionsFiltersSchema.safeParse({ fromDate: future, toDate: future }).success).toBe(
      true,
    );
  });
});
