import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addMoney,
  allocateLargestRemainder,
  formatMoney,
  mulMoneyByBasisPoints,
  rateFromTotal,
  roundHalfUpToInt,
  subMoney,
  toBasisPoints,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
} from "./money";
import { toMilliUnits } from "./qty";

describe("brand constructors", () => {
  it("pass safe integers through unchanged", () => {
    expect(toCentavos(1250)).toBe(1250);
    expect(toBasisPoints(3000)).toBe(3000);
    expect(toMilliCentavosPerUnit(800_000)).toBe(800_000);
  });

  it("reject non-integer / NaN / Infinity / unsafe-magnitude input", () => {
    expect(() => toCentavos(12.5)).toThrow(RangeError);
    expect(() => toCentavos(Number.NaN)).toThrow(RangeError);
    expect(() => toCentavos(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toBasisPoints(0.5)).toThrow(RangeError);
    expect(() => toMilliCentavosPerUnit(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("formats basic amounts in es-BO", () => {
    expect(formatMoney(toCentavos(1250))).toBe("Bs 12,50");
    expect(formatMoney(toCentavos(0))).toBe("Bs 0,00");
    expect(formatMoney(toCentavos(5))).toBe("Bs 0,05");
    expect(formatMoney(toCentavos(100))).toBe("Bs 1,00");
  });

  it("groups thousands with '.' and uses ',' for decimals", () => {
    expect(formatMoney(toCentavos(123450))).toBe("Bs 1.234,50");
    expect(formatMoney(toCentavos(123456789))).toBe("Bs 1.234.567,89");
    expect(formatMoney(toCentavos(100000000))).toBe("Bs 1.000.000,00");
  });

  it("renders negatives with a leading minus before the prefix", () => {
    expect(formatMoney(toCentavos(-1250))).toBe("-Bs 12,50");
    expect(formatMoney(toCentavos(-123450))).toBe("-Bs 1.234,50");
  });

  it("honours the signed option (never signs zero)", () => {
    expect(formatMoney(toCentavos(500), { signed: true })).toBe("+Bs 5,00");
    expect(formatMoney(toCentavos(-500), { signed: true })).toBe("-Bs 5,00");
    expect(formatMoney(toCentavos(0), { signed: true })).toBe("Bs 0,00");
  });

  it("still guards at runtime against a bypassed brand (defense in depth)", () => {
    // @ts-expect-error simulating a caller that bypassed the brand
    expect(() => formatMoney(12.5)).toThrow(RangeError);
    // @ts-expect-error simulating a caller that bypassed the brand
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
    // @ts-expect-error simulating a caller that bypassed the brand
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
    expect(addMoney(toCentavos(100), toCentavos(250), toCentavos(50))).toBe(400);
    expect(addMoney()).toBe(0);
    expect(subMoney(toCentavos(1000), toCentavos(250))).toBe(750);
    expect(subMoney(toCentavos(250), toCentavos(1000))).toBe(-750);
  });

  it("applies basis-point rates with half-up rounding", () => {
    expect(mulMoneyByBasisPoints(toCentavos(1000), toBasisPoints(3000))).toBe(300); // 30%
    expect(mulMoneyByBasisPoints(toCentavos(1255), toBasisPoints(3000))).toBe(377); // 376.5 → 377
    expect(mulMoneyByBasisPoints(toCentavos(1000), toBasisPoints(5000))).toBe(500); // default deposit 50%
  });

  it("guards against non-integer inputs", () => {
    // @ts-expect-error simulating a caller that bypassed the brand
    expect(() => addMoney(1.5)).toThrow(RangeError);
    // @ts-expect-error simulating a caller that bypassed the brand
    expect(() => subMoney(10, Number.NaN)).toThrow(RangeError);
    // @ts-expect-error simulating a caller that bypassed the brand
    expect(() => mulMoneyByBasisPoints(10.5, 3000)).toThrow(RangeError);
  });
});

describe("totalCentavos / rateFromTotal (ADR-017 scale conversion)", () => {
  it("converts a per-unit rate and quantity into a total (half-up)", () => {
    // Bs 8.00/unit * 1.5 units = Bs 12.00
    expect(totalCentavos(toMilliCentavosPerUnit(800_000), toMilliUnits(1500))).toBe(1200);
    // exactly 1 unit
    expect(totalCentavos(toMilliCentavosPerUnit(800_000), toMilliUnits(1000))).toBe(800);
    // Bs 12.345/kg for 1 kg → Bs 12.35 (1234.5 rounds half-up)
    expect(totalCentavos(toMilliCentavosPerUnit(1_234_500), toMilliUnits(1000))).toBe(1235);
    // zero quantity → zero total
    expect(totalCentavos(toMilliCentavosPerUnit(800_000), toMilliUnits(0))).toBe(0);
  });

  it("derives the rate that produced a total over a quantity (half-up)", () => {
    expect(rateFromTotal(toCentavos(1200), toMilliUnits(1500))).toBe(800_000);
    expect(rateFromTotal(toCentavos(800), toMilliUnits(1000))).toBe(800_000);
  });

  it("guards against non-integer / NaN / Infinity inputs, and division by zero", () => {
    // @ts-expect-error simulating a caller that bypassed the brand
    expect(() => totalCentavos(12.5, toMilliUnits(1000))).toThrow(RangeError);
    // @ts-expect-error simulating a caller that bypassed the brand
    expect(() => rateFromTotal(toCentavos(100), Number.NaN)).toThrow(RangeError);
    expect(() => rateFromTotal(toCentavos(100), toMilliUnits(0))).toThrow(RangeError);
  });

  it("property: totalCentavos stays a safe integer within half a centavo of the exact value, across the ADR-017 overflow bound (rate ≤ 1e7 mc, qty ≤ 1e6 mu ⇒ product ≤ 1e13)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (rateValue, qtyValue) => {
          const total = totalCentavos(toMilliCentavosPerUnit(rateValue), toMilliUnits(qtyValue));
          expect(Number.isSafeInteger(total)).toBe(true);
          expect(Math.abs(total - (rateValue * qtyValue) / 1_000_000)).toBeLessThanOrEqual(0.5);
        },
      ),
    );
  });

  it("property: rateFromTotal stays a safe integer within half a milli-centavo of the exact value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (totalValue, qtyValue) => {
          const rate = rateFromTotal(toCentavos(totalValue), toMilliUnits(qtyValue));
          expect(Number.isSafeInteger(rate)).toBe(true);
          expect(Math.abs(rate - (totalValue * 1_000_000) / qtyValue)).toBeLessThanOrEqual(0.5);
        },
      ),
    );
  });

  it("property: a total→rate→total round trip drifts by at most 1 centavo (two half-up roundings compound at most once)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (totalValue, qtyValue) => {
          const total = toCentavos(totalValue);
          const qty = toMilliUnits(qtyValue);
          const rate = rateFromTotal(total, qty);
          const roundTripped = totalCentavos(rate, qty);
          expect(Math.abs(roundTripped - total)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("allocateLargestRemainder", () => {
  it("splits exactly with no lost centavos", () => {
    // 1000 split 1:1:1 → 334/333/333 (leftover to lowest index)
    expect(allocateLargestRemainder(toCentavos(1000), [1, 1, 1])).toEqual([334, 333, 333]);
  });

  it("distributes leftover to the largest remainders", () => {
    // 100 across weights 1:2:3 (sum 6) → base 16/33/50 (=99), leftover 1 to
    // the largest remainder. remainders: 100*1%6=4, 100*2%6=2, 100*3%6=0.
    expect(allocateLargestRemainder(toCentavos(100), [1, 2, 3])).toEqual([17, 33, 50]);
  });

  it("handles a single weight", () => {
    expect(allocateLargestRemainder(toCentavos(999), [5])).toEqual([999]);
  });

  it("returns [] for empty weights", () => {
    expect(allocateLargestRemainder(toCentavos(500), [])).toEqual([]);
  });

  it("falls back to equal shares when all weights are zero", () => {
    expect(allocateLargestRemainder(toCentavos(10), [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocateLargestRemainder(toCentavos(0), [0, 0])).toEqual([0, 0]);
  });

  it("gives 0 to excess allocatees when total < count", () => {
    const out = allocateLargestRemainder(toCentavos(2), [1, 1, 1, 1, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(2);
    expect(out).toEqual([1, 1, 0, 0, 0]);
  });

  it("throws on negative total or negative weight", () => {
    expect(() => allocateLargestRemainder(toCentavos(-1), [1, 1])).toThrow(RangeError);
    expect(() => allocateLargestRemainder(toCentavos(10), [1, -1])).toThrow(RangeError);
    // @ts-expect-error simulating a caller that bypassed the brand
    expect(() => allocateLargestRemainder(10.5, [1, 1])).toThrow(RangeError);
  });

  it("property: Σ parts === total, all non-negative integers, bounded", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.array(fc.nat({ max: 100_000 }), { minLength: 1, maxLength: 30 }),
        (totalValue, weights) => {
          const parts = allocateLargestRemainder(toCentavos(totalValue), weights);
          // same length
          expect(parts).toHaveLength(weights.length);
          // exact conservation — the core invariant (Doc 11 §2)
          expect(parts.reduce((a, b) => a + b, 0)).toBe(totalValue);
          const sumW = weights.reduce((a, b) => a + b, 0);
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i] ?? -1;
            expect(Number.isInteger(p)).toBe(true);
            expect(p).toBeGreaterThanOrEqual(0);
            // boundedness: never more than the ceiling proportional share + 1
            const w = weights[i] ?? 0;
            const ceilShare =
              sumW === 0
                ? Math.ceil(totalValue / weights.length)
                : Math.ceil((totalValue * w) / sumW);
            expect(p).toBeLessThanOrEqual(ceilShare + 1);
          }
        },
      ),
    );
  });
});
