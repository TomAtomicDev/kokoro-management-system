import { describe, expect, it } from "vitest";

import { recordSessionCommandSchema, updateSessionCommandSchema } from "./sessions.js";

const STARTED_AT = "2026-08-11T14:00:00.000Z";

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
