import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { exceedsScale, formatIntAsDecimalInput, parseDecimalToInt } from "./decimal";

describe("parseDecimalToInt", () => {
  it("parses a plain integer", () => {
    expect(parseDecimalToInt("12", 2)).toBe(1200);
  });

  it("parses a decimal with a dot", () => {
    expect(parseDecimalToInt("12.50", 2)).toBe(1250);
  });

  it("parses a decimal with a comma (es-BO input)", () => {
    expect(parseDecimalToInt("12,5", 2)).toBe(1250);
  });

  it("parses milli-unit scale (3 decimals)", () => {
    expect(parseDecimalToInt("1.5", 3)).toBe(1500);
  });

  it("returns null for blank input", () => {
    expect(parseDecimalToInt("", 2)).toBeNull();
    expect(parseDecimalToInt("   ", 2)).toBeNull();
  });

  it("accepts valueless trailing zeros beyond the target scale", () => {
    expect(parseDecimalToInt("200.050", 2)).toBe(20005);
    expect(parseDecimalToInt("200.055", 2)).toBeNull();
  });

  it("returns null for more precision than the target scale supports", () => {
    expect(parseDecimalToInt("12.555", 2)).toBeNull();
  });

  it("identifies non-zero digits beyond the target scale", () => {
    expect(exceedsScale("200.050", 2)).toBe(false);
    expect(exceedsScale("200.055", 2)).toBe(true);
    expect(exceedsScale("not-a-number", 2)).toBe(false);
    expect(exceedsScale("-200.055", 2)).toBe(false);
  });

  it("returns null for non-numeric input", () => {
    expect(parseDecimalToInt("abc", 2)).toBeNull();
    expect(parseDecimalToInt("-5", 2)).toBeNull();
  });

  it("never goes through float multiplication (exactness check)", () => {
    // 1.005 * 100 === 100.49999999999999 in IEEE754 — the classic float trap this avoids.
    expect(parseDecimalToInt("1.01", 2)).toBe(101);
    expect(parseDecimalToInt("0.1", 2)).toBe(10);
  });

  it("property: appending trailing zeros preserves every valid value", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000_000 }),
        fc.integer({ min: 1, max: 3 }),
        fc.nat({ max: 8 }),
        (value, scale, trailingZeros) => {
          const base = formatIntAsDecimalInput(value, scale);
          const input = base.includes(".")
            ? `${base}${"0".repeat(trailingZeros)}`
            : `${base}.${"0".repeat(trailingZeros + 1)}`;

          expect(parseDecimalToInt(input, scale)).toBe(value);
        },
      ),
    );
  });
});

describe("formatIntAsDecimalInput", () => {
  it("round-trips through parseDecimalToInt", () => {
    expect(formatIntAsDecimalInput(1250, 2)).toBe("12.5");
    expect(formatIntAsDecimalInput(1200, 2)).toBe("12");
    expect(formatIntAsDecimalInput(1500, 3)).toBe("1.5");
    expect(formatIntAsDecimalInput(0, 2)).toBe("0");
  });
});
