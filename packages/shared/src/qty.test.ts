import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { UNITS, type Unit } from "./enums";
import {
  compatibleUnitsFor,
  convertDisplayValueToMilliUnits,
  convertMilliUnitsToDisplayValue,
  defaultDisplayUnitFor,
  formatQty,
  inferDisplayUnitFromMilliUnits,
  type QtyDisplayUnit,
  toMilliUnits,
} from "./qty";

describe("toMilliUnits", () => {
  it("passes safe integers through unchanged", () => {
    expect(toMilliUnits(1500)).toBe(1500);
    expect(toMilliUnits(0)).toBe(0);
    expect(toMilliUnits(-1500)).toBe(-1500);
  });

  it("rejects non-integer / NaN / Infinity input", () => {
    expect(() => toMilliUnits(1.5)).toThrow(RangeError);
    expect(() => toMilliUnits(Number.NaN)).toThrow(RangeError);
    expect(() => toMilliUnits(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatQty", () => {
  it("matches the canonical mass and length examples", () => {
    expect(formatQty(0, "KG")).toBe("0 kg");
    expect(formatQty(580, "KG")).toBe("580 g");
    expect(formatQty(1000, "KG")).toBe("1 kg");
    expect(formatQty(25000, "KG")).toBe("25 kg");
    expect(formatQty(-580, "KG")).toBe("-580 g");
    expect(formatQty(-25000, "KG")).toBe("-25 kg");
    expect(formatQty(580, "M")).toBe("58 cm");
    expect(formatQty(999, "M")).toBe("99,9 cm");
    expect(formatQty(1000, "M")).toBe("1 m");
  });

  it("handles volume analogously", () => {
    expect(formatQty(0, "L")).toBe("0 L");
    expect(formatQty(580, "L")).toBe("580 ml");
    expect(formatQty(999, "L")).toBe("999 ml");
    expect(formatQty(1000, "L")).toBe("1 L");
    expect(formatQty(25000, "L")).toBe("25 L");
    expect(formatQty(-580, "L")).toBe("-580 ml");
    expect(formatQty(-25000, "L")).toBe("-25 L");
  });

  it.each([
    ["KG", "g", "kg"],
    ["L", "ml", "L"],
    ["M", "cm", "m"],
  ] as const)("straddles the 999/1000 boundary for %s with both signs", (unit, small, large) => {
    const smallValue = unit === "M" ? "99,9" : "999";
    expect(formatQty(999, unit)).toBe(`${smallValue} ${small}`);
    expect(formatQty(1000, unit)).toBe(`1 ${large}`);
    expect(formatQty(-999, unit)).toBe(`-${smallValue} ${small}`);
    expect(formatQty(-1000, unit)).toBe(`-1 ${large}`);
  });

  it("uses the canonical unit for zero in every family", () => {
    expect(UNITS.map((unit) => formatQty(0, unit))).toEqual(["0 kg", "0 L", "0 m", "0 u"]);
  });

  it("never scales the UNIT family", () => {
    expect(formatQty(500, "UNIT")).toBe("0,5 u");
    expect(formatQty(999, "UNIT")).toBe("0,999 u");
    expect(formatQty(1000, "UNIT")).toBe("1 u");
    expect(formatQty(-999, "UNIT")).toBe("-0,999 u");
    expect(formatQty(-1000, "UNIT")).toBe("-1 u");
  });

  it("trims trailing zeros and groups thousands", () => {
    expect(formatQty(1250, "KG")).toBe("1,25 kg");
    expect(formatQty(1005, "KG")).toBe("1,005 kg");
    expect(formatQty(1234500, "KG")).toBe("1.234,5 kg");
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
          const formatted = formatQty(milliUnits, unit);
          expect(formatted.length).toBeGreaterThan(0);
          const numeric = formatted.slice(0, formatted.lastIndexOf(" "));
          expect(numeric.includes(",") ? numeric.split(",").length : 2).toBe(2);
        },
      ),
    );
  });
});

describe("quantity display-unit conversions", () => {
  const cases: readonly [
    canonical: Unit,
    small: QtyDisplayUnit,
    smallValue: number,
    canonicalValue: number,
  ][] = [
    ["KG", "G", 580, 1.25],
    ["L", "ML", 580, 1.25],
    ["M", "CM", 58, 1.25],
    ["UNIT", "UNIT", 0.5, 1.25],
  ];

  it.each(cases)(
    "round-trips %s values in its small and canonical units",
    (canonical, small, smallValue, canonicalValue) => {
      const smallMilliUnits = convertDisplayValueToMilliUnits(smallValue, small, canonical);
      expect(convertMilliUnitsToDisplayValue(smallMilliUnits, small, canonical)).toBe(smallValue);

      const canonicalMilliUnits = convertDisplayValueToMilliUnits(
        canonicalValue,
        canonical,
        canonical,
      );
      expect(convertMilliUnitsToDisplayValue(canonicalMilliUnits, canonical, canonical)).toBe(
        canonicalValue,
      );
    },
  );

  it("exposes compatible and default units per family", () => {
    expect(compatibleUnitsFor("KG")).toEqual(["G", "KG"]);
    expect(compatibleUnitsFor("L")).toEqual(["ML", "L"]);
    expect(compatibleUnitsFor("M")).toEqual(["CM", "M"]);
    expect(compatibleUnitsFor("UNIT")).toEqual(["UNIT"]);
    expect(UNITS.map(defaultDisplayUnitFor)).toEqual(["G", "ML", "CM", "UNIT"]);
  });

  it("infers units from magnitude and preserves UNIT", () => {
    expect(inferDisplayUnitFromMilliUnits(0, "KG")).toBe("KG");
    expect(inferDisplayUnitFromMilliUnits(999, "KG")).toBe("G");
    expect(inferDisplayUnitFromMilliUnits(-999, "M")).toBe("CM");
    expect(inferDisplayUnitFromMilliUnits(1000, "M")).toBe("M");
    expect(inferDisplayUnitFromMilliUnits(1, "UNIT")).toBe("UNIT");
  });

  it("rejects incompatible display units", () => {
    expect(() => convertDisplayValueToMilliUnits(5, "ML", "KG")).toThrow(RangeError);
    expect(() => convertMilliUnitsToDisplayValue(5, "CM", "L")).toThrow(RangeError);
  });

  it("property: milli-units round-trip through every compatible display unit", () => {
    for (const canonical of UNITS) {
      for (const displayUnit of compatibleUnitsFor(canonical)) {
        fc.assert(
          fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (milliUnits) => {
            const displayValue = convertMilliUnitsToDisplayValue(
              milliUnits,
              displayUnit,
              canonical,
            );
            expect(convertDisplayValueToMilliUnits(displayValue, displayUnit, canonical)).toBe(
              milliUnits,
            );
          }),
        );
      }
    }
  });
});
