import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addMoney,
  allocateLargestRemainder,
  formatMoney,
  mulMoneyByBasisPoints,
  mulMoneyByQty,
  roundHalfUpToInt,
  subMoney,
} from "./money";

describe("formatMoney", () => {
  it("formats basic amounts in es-BO", () => {
    expect(formatMoney(1250)).toBe("Bs 12,50");
    expect(formatMoney(0)).toBe("Bs 0,00");
    expect(formatMoney(5)).toBe("Bs 0,05");
    expect(formatMoney(100)).toBe("Bs 1,00");
  });

  it("groups thousands with '.' and uses ',' for decimals", () => {
    expect(formatMoney(123450)).toBe("Bs 1.234,50");
    expect(formatMoney(123456789)).toBe("Bs 1.234.567,89");
    expect(formatMoney(100000000)).toBe("Bs 1.000.000,00");
  });

  it("renders negatives with a leading minus before the prefix", () => {
    expect(formatMoney(-1250)).toBe("-Bs 12,50");
    expect(formatMoney(-123450)).toBe("-Bs 1.234,50");
  });

  it("honours the signed option (never signs zero)", () => {
    expect(formatMoney(500, { signed: true })).toBe("+Bs 5,00");
    expect(formatMoney(-500, { signed: true })).toBe("-Bs 5,00");
    expect(formatMoney(0, { signed: true })).toBe("Bs 0,00");
  });

  it("rejects non-integer / NaN / Infinity input", () => {
    expect(() => formatMoney(12.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
    expect(() => formatMoney(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("roundHalfUpToInt (half away from zero)", () => {
  it("rounds positive halves up", () => {
    expect(roundHalfUpToInt(0.5)).toBe(1);
    expect(roundHalfUpToInt(1.5)).toBe(2);
    expect(roundHalfUpToInt(2.5)).toBe(3);
  });

  it("rounds negative halves away from zero (NOT toward +Infinity)", () => {
    expect(roundHalfUpToInt(-0.5)).toBe(-1);
    expect(roundHalfUpToInt(-1.5)).toBe(-2);
    expect(roundHalfUpToInt(-2.5)).toBe(-3);
  });

  it("rounds sub-half values toward zero and normalises -0", () => {
    expect(roundHalfUpToInt(0.4999)).toBe(0);
    expect(roundHalfUpToInt(-0.4999)).toBe(0);
    expect(Object.is(roundHalfUpToInt(-0.4999), -0)).toBe(false);
    expect(roundHalfUpToInt(2.49)).toBe(2);
    expect(roundHalfUpToInt(-2.49)).toBe(-2);
  });

  it("is symmetric under negation for the .5 boundary", () => {
    for (const v of [0.5, 1.5, 2.5, 10.5, 999.5]) {
      expect(roundHalfUpToInt(-v)).toBe(-roundHalfUpToInt(v));
    }
  });

  it("rejects NaN / Infinity", () => {
    expect(() => roundHalfUpToInt(Number.NaN)).toThrow(RangeError);
    expect(() => roundHalfUpToInt(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("arithmetic helpers", () => {
  it("adds and subtracts integer centavos", () => {
    expect(addMoney(100, 250, 50)).toBe(400);
    expect(addMoney()).toBe(0);
    expect(subMoney(1000, 250)).toBe(750);
    expect(subMoney(250, 1000)).toBe(-750);
  });

  it("applies basis-point rates with half-up rounding", () => {
    expect(mulMoneyByBasisPoints(1000, 3000)).toBe(300); // 30%
    expect(mulMoneyByBasisPoints(1255, 3000)).toBe(377); // 376.5 → 377
    expect(mulMoneyByBasisPoints(1000, 5000)).toBe(500); // default deposit 50%
  });

  it("multiplies unit price by milli-unit quantity", () => {
    expect(mulMoneyByQty(800, 1500)).toBe(1200); // Bs 8.00 * 1.5 units
    expect(mulMoneyByQty(333, 1000)).toBe(333); // exactly 1 unit
    expect(mulMoneyByQty(100, 1500)).toBe(150); // 1.5 units of Bs 1.00
  });

  it("guards against non-integer inputs", () => {
    expect(() => addMoney(1.5)).toThrow(RangeError);
    expect(() => subMoney(10, Number.NaN)).toThrow(RangeError);
    expect(() => mulMoneyByBasisPoints(10.5, 3000)).toThrow(RangeError);
  });
});

describe("allocateLargestRemainder", () => {
  it("splits exactly with no lost centavos", () => {
    // 1000 split 1:1:1 → 334/333/333 (leftover to lowest index)
    expect(allocateLargestRemainder(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });

  it("distributes leftover to the largest remainders", () => {
    // 100 across weights 1:2:3 (sum 6) → base 16/33/50 (=99), leftover 1 to
    // the largest remainder. remainders: 100*1%6=4, 100*2%6=2, 100*3%6=0.
    expect(allocateLargestRemainder(100, [1, 2, 3])).toEqual([17, 33, 50]);
  });

  it("handles a single weight", () => {
    expect(allocateLargestRemainder(999, [5])).toEqual([999]);
  });

  it("returns [] for empty weights", () => {
    expect(allocateLargestRemainder(500, [])).toEqual([]);
  });

  it("falls back to equal shares when all weights are zero", () => {
    expect(allocateLargestRemainder(10, [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocateLargestRemainder(0, [0, 0])).toEqual([0, 0]);
  });

  it("gives 0 to excess allocatees when total < count", () => {
    const out = allocateLargestRemainder(2, [1, 1, 1, 1, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(2);
    expect(out).toEqual([1, 1, 0, 0, 0]);
  });

  it("throws on negative total or negative weight", () => {
    expect(() => allocateLargestRemainder(-1, [1, 1])).toThrow(RangeError);
    expect(() => allocateLargestRemainder(10, [1, -1])).toThrow(RangeError);
    expect(() => allocateLargestRemainder(10.5, [1, 1])).toThrow(RangeError);
  });

  it("property: Σ parts === total, all non-negative integers, bounded", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.array(fc.nat({ max: 100_000 }), { minLength: 1, maxLength: 30 }),
        (total, weights) => {
          const parts = allocateLargestRemainder(total, weights);
          // same length
          expect(parts).toHaveLength(weights.length);
          // exact conservation — the core invariant (Doc 11 §2)
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          const sumW = weights.reduce((a, b) => a + b, 0);
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i] ?? -1;
            expect(Number.isInteger(p)).toBe(true);
            expect(p).toBeGreaterThanOrEqual(0);
            // boundedness: never more than the ceiling proportional share + 1
            const w = weights[i] ?? 0;
            const ceilShare =
              sumW === 0 ? Math.ceil(total / weights.length) : Math.ceil((total * w) / sumW);
            expect(p).toBeLessThanOrEqual(ceilShare + 1);
          }
        },
      ),
    );
  });
});
