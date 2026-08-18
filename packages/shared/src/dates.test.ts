import { describe, expect, it } from "vitest";
import {
  businessDateRangeToUtcWindow,
  businessDateSchema,
  calendarDateSchema,
  DEFAULT_TIMEZONE,
  fromDatetimeLocal,
  nowIso,
  occurredAtSchema,
  toBusinessDate,
  toDatetimeLocal,
} from "./dates";
import { quoteOrderCommandSchema } from "./orders";

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

describe("datetime-local timezone helpers", () => {
  it("formats an instant in America/La_Paz without using the host timezone", () => {
    expect(toDatetimeLocal("2026-07-01T14:30:00.000Z")).toBe("2026-07-01T10:30");
  });

  it("round-trips a La Paz wall-clock value through UTC", () => {
    expect(fromDatetimeLocal("2026-07-01T10:30")).toBe("2026-07-01T14:30:00.000Z");
  });

  it("rejects malformed or impossible wall-clock values", () => {
    expect(fromDatetimeLocal("2026-07-01T10:30:45")).toBeUndefined();
    expect(fromDatetimeLocal("2026-02-30T10:30")).toBeUndefined();
  });

  it("includes a 20:30 La Paz instant in that local day's UTC window", () => {
    const window = businessDateRangeToUtcWindow("2026-07-13", "2026-07-13");
    const eveningInstant = new Date("2026-07-14T00:30:00.000Z");

    expect(toBusinessDate(eveningInstant)).toBe("2026-07-13");
    expect(eveningInstant.getTime()).toBeGreaterThanOrEqual(
      new Date(window.startInclusive).getTime(),
    );
    expect(eveningInstant.getTime()).toBeLessThan(new Date(window.endExclusive).getTime());
  });
});

describe("shared event date schemas", () => {
  const shiftedDate = (days: number): string => {
    const shifted = new Date();
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return toBusinessDate(shifted);
  };

  it("accepts today's business date", () => {
    expect(businessDateSchema.safeParse(toBusinessDate(new Date())).success).toBe(true);
  });

  it("accepts yesterday's business date", () => {
    expect(businessDateSchema.safeParse(shiftedDate(-1)).success).toBe(true);
  });

  it("rejects tomorrow's business date with the agreed message", () => {
    const result = businessDateSchema.safeParse(shiftedDate(1));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("La fecha no puede ser futura.");
    }
  });

  it("accepts a future delivery date while rejecting a future transaction date", () => {
    const futureDate = shiftedDate(14);
    const quote = quoteOrderCommandSchema.safeParse({
      customerId: "customer-1",
      description: "Pedido para la próxima quincena",
      deliveryDate: futureDate,
    });

    expect(calendarDateSchema.safeParse(futureDate).success).toBe(true);
    expect(quote.success).toBe(true);

    const businessDate = businessDateSchema.safeParse(futureDate);
    expect(businessDate.success).toBe(false);
    if (!businessDate.success) {
      expect(businessDate.error.issues[0]?.message).toBe("La fecha no puede ser futura.");
    }
  });

  it("checks occurredAt through its La Paz business date", () => {
    const tomorrow = shiftedDate(1);
    const tomorrowLateInLaPaz = new Date(`${tomorrow}T23:30:00-04:00`).toISOString();

    expect(tomorrowLateInLaPaz.slice(0, 10)).not.toBe(tomorrow);
    expect(toBusinessDate(tomorrowLateInLaPaz)).toBe(tomorrow);
    expect(occurredAtSchema.safeParse(tomorrowLateInLaPaz).success).toBe(false);
  });
});
