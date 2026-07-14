import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE, nowIso, toBusinessDate } from "./dates";

describe("toBusinessDate (INV-3, America/La_Paz = UTC-4, no DST)", () => {
  it("maps a late-night UTC instant back to the previous local day", () => {
    // 02:00Z on the 14th == 22:00 on the 13th in La Paz.
    expect(toBusinessDate("2026-07-14T02:00:00Z")).toBe("2026-07-13");
  });

  it("keeps the same day for daytime instants", () => {
    expect(toBusinessDate("2026-07-14T12:00:00Z")).toBe("2026-07-14"); // 08:00 local
    expect(toBusinessDate("2026-07-14T15:30:00Z")).toBe("2026-07-14"); // 11:30 local
  });

  it("handles the exact UTC-4 midnight boundary", () => {
    // 03:59Z is 23:59 on the 13th (still the 13th locally)...
    expect(toBusinessDate("2026-07-14T03:59:00Z")).toBe("2026-07-13");
    // ...04:00Z is 00:00 on the 14th (rolls into the 14th locally).
    expect(toBusinessDate("2026-07-14T04:00:00Z")).toBe("2026-07-14");
  });

  it("accepts a Date object as well as a string", () => {
    expect(toBusinessDate(new Date("2026-01-01T03:00:00Z"))).toBe("2025-12-31");
  });

  it("respects an explicit timezone override", () => {
    // Same instant, UTC → the 14th.
    expect(toBusinessDate("2026-07-14T02:00:00Z", "UTC")).toBe("2026-07-14");
    expect(DEFAULT_TIMEZONE).toBe("America/La_Paz");
  });

  it("throws on an invalid instant", () => {
    expect(() => toBusinessDate("not-a-date")).toThrow(RangeError);
  });
});

describe("nowIso", () => {
  it("returns a parseable UTC ISO-8601 string", () => {
    const iso = nowIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
  });
});
