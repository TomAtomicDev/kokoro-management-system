import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { UNITS } from "./enums";
import { formatQty } from "./qty";

describe("formatQty", () => {
  it("formats each unit in its own stored unit (no auto-conversion)", () => {
    expect(formatQty(1500, "KG")).toBe("1,5 kg");
    expect(formatQty(12000, "UNIT")).toBe("12 u");
    expect(formatQty(1500, "G")).toBe("1,5 g");
    expect(formatQty(2000, "L")).toBe("2 l");
    expect(formatQty(750, "ML")).toBe("0,75 ml");
  });

  it("trims trailing zeros and keeps up to milli precision", () => {
    expect(formatQty(1000, "KG")).toBe("1 kg");
    expect(formatQty(1250, "KG")).toBe("1,25 kg");
    expect(formatQty(1, "G")).toBe("0,001 g"); // 1 milli-gram
    expect(formatQty(1005, "KG")).toBe("1,005 kg");
  });

  it("groups thousands and handles negatives", () => {
    expect(formatQty(1234500, "G")).toBe("1.234,5 g");
    expect(formatQty(-1500, "KG")).toBe("-1,5 kg");
    expect(formatQty(0, "UNIT")).toBe("0 u");
  });

  it("rejects non-integer input and unknown units", () => {
    expect(() => formatQty(1.5, "KG")).toThrow(RangeError);
    expect(() => formatQty(Number.NaN, "KG")).toThrow(RangeError);
    // @ts-expect-error unknown unit at the type level too
    expect(() => formatQty(1000, "TON")).toThrow(RangeError);
  });

  it("property: every valid milli-unit/unit pair formats to a non-empty string", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.constantFrom(...UNITS),
        (milliUnits, unit) => {
          const s = formatQty(milliUnits, unit);
          expect(s.endsWith(` ${{ G: "g", KG: "kg", ML: "ml", L: "l", UNIT: "u" }[unit]}`)).toBe(
            true,
          );
          // decimal separator is a comma, never a dot
          const numeric = s.slice(0, s.lastIndexOf(" "));
          expect(numeric.includes(",") ? numeric.split(",").length : 2).toBe(2);
        },
      ),
    );
  });
});
