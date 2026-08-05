import { toMilliCentavosPerUnit } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatCostRateInput, parseCostRateInput } from "./cost-rate";
import { exceedsScale, parseDecimalToInt } from "./decimal";

describe("cost-rate inputs", () => {
  it.each([
    ["0.00231", 231],
    ["0,00231", 231],
    ["0.0023100", 231],
  ])("parses %s exactly at five-decimal scale", (input, expected) => {
    expect(parseCostRateInput(input)).toEqual({
      ok: true,
      value: toMilliCentavosPerUnit(expected),
    });
  });

  it.each([
    ["", "empty"],
    ["water", "invalid"],
    ["0.002307", "tooManyDecimals"],
    ["0", "notPositive"],
    ["-0.1", "notPositive"],
  ] as const)("classifies %j as %s", (input, reason) => {
    expect(parseCostRateInput(input)).toEqual({ ok: false, reason });
  });

  it("allows zero only when the caller explicitly permits it", () => {
    expect(parseCostRateInput("0", { allowZero: true })).toEqual({
      ok: true,
      value: toMilliCentavosPerUnit(0),
    });
  });

  it("formats stored rates directly and preserves exact edit values", () => {
    expect(formatCostRateInput(toMilliCentavosPerUnit(231))).toBe("0.00231");
    expect(formatCostRateInput(toMilliCentavosPerUnit(500))).toBe("0.005");
  });

  it("property: every representable formatted rate round-trips exactly", () => {
    fc.assert(
      fc.property(fc.nat({ max: Number.MAX_SAFE_INTEGER }), (rawRate) => {
        const rate = toMilliCentavosPerUnit(rawRate);
        const parsed = parseCostRateInput(formatCostRateInput(rate), { allowZero: true });

        expect(parsed).toEqual({ ok: true, value: rate });
      }),
    );
  });

  it("property: excess precision exactly predicts valid decimal parse failure", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 999_999 }),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 10 }),
        fc.boolean(),
        (whole, fractionalDigits, useComma) => {
          const separator = useComma ? "," : ".";
          const input = `${whole}${separator}${fractionalDigits.join("")}`;

          expect(exceedsScale(input, 5)).toBe(parseDecimalToInt(input, 5) === null);
        },
      ),
    );
  });
});
