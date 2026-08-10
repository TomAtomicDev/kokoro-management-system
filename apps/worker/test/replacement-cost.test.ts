import { toMilliCentavosPerUnit } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  computeEffectiveReplacementCost,
  computeItemReplacementCost,
  type ReplacementCostLine,
} from "../src/core/costing/replacement-cost.js";

const mc = toMilliCentavosPerUnit;

describe("computeEffectiveReplacementCost (C-3c)", () => {
  const costArb = fc.integer({ min: 0, max: 100_000_000 }).map(mc);

  it("property: a timestamped replacement cost always wins regardless of WAC", () => {
    fc.assert(
      fc.property(costArb, costArb, (replacementCostMc, wacMc) => {
        expect(
          computeEffectiveReplacementCost(replacementCostMc, "2026-08-07T00:00:00.000Z", wacMc),
        ).toBe(replacementCostMc);
      }),
    );
  });

  it("property: an unstamped replacement cost always falls back to WAC", () => {
    fc.assert(
      fc.property(costArb, costArb, (replacementCostMc, wacMc) => {
        expect(computeEffectiveReplacementCost(replacementCostMc, null, wacMc)).toBe(wacMc);
      }),
    );
  });
});

function expectDomainValidationError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toMatchObject({ code: "VALIDATION" });
}

describe("computeItemReplacementCost (C-3, SEMI_FINISHED/FINISHED)", () => {
  it("computes a simple single-line recipe on the milli-centavo grid", () => {
    const lines: ReplacementCostLine[] = [{ qty: 1000, unitCost: mc(5_000_000) }];
    expect(computeItemReplacementCost(lines, 1000)).toBe(mc(5_000_000));
  });

  it("sums multiple lines and rounds half-up to an integer milli-centavo rate", () => {
    const lines: ReplacementCostLine[] = [
      { qty: 500, unitCost: mc(10_000_000) },
      { qty: 200, unitCost: mc(3_000_000) },
    ];
    expect(computeItemReplacementCost(lines, 2000)).toBe(mc(2_800_000));
  });

  it("a recipe with no lines costs nothing", () => {
    expect(computeItemReplacementCost([], 1000)).toBe(mc(0));
  });

  it("accounts for shrinkage", () => {
    const lines: ReplacementCostLine[] = [{ qty: 1000, unitCost: mc(10_000_000) }];
    expect(computeItemReplacementCost(lines, 500)).toBe(mc(20_000_000));
  });

  it("rejects invalid inputs", () => {
    expectDomainValidationError(() => computeItemReplacementCost([], 0));
    expectDomainValidationError(() => computeItemReplacementCost([], -1000));
    expectDomainValidationError(() =>
      computeItemReplacementCost([{ qty: 0, unitCost: mc(5) }], 1000),
    );
    expectDomainValidationError(() =>
      computeItemReplacementCost([{ qty: -100, unitCost: mc(5) }], 1000),
    );
    expectDomainValidationError(() =>
      computeItemReplacementCost([{ qty: 100, unitCost: mc(-1) }], 1000),
    );
  });

  const lineArb = fc.record({
    qty: fc.integer({ min: 1, max: 1_000_000 }),
    unitCost: fc.integer({ min: 0, max: 100_000_000 }).map(mc),
  });

  it("property: all-zero unit costs always cost nothing", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (qtys, expectedYieldQty) => {
          const lines: ReplacementCostLine[] = qtys.map((qty) => ({ qty, unitCost: mc(0) }));
          expect(computeItemReplacementCost(lines, expectedYieldQty)).toBe(mc(0));
        },
      ),
    );
  });

  it("property: raising any single line's unit cost never decreases the result", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (lines, expectedYieldQty, indexSeed, extraCost) => {
          const index = indexSeed % lines.length;
          const before = computeItemReplacementCost(lines, expectedYieldQty);
          const raised = lines.map((line, i) =>
            i === index ? { ...line, unitCost: mc(line.unitCost + extraCost) } : line,
          );
          expect(computeItemReplacementCost(raised, expectedYieldQty)).toBeGreaterThanOrEqual(
            before,
          );
        },
      ),
    );
  });

  it("property: raising expected yield never increases the result", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        (lines, expectedYieldQty, extraYield) => {
          const before = computeItemReplacementCost(lines, expectedYieldQty);
          const after = computeItemReplacementCost(lines, expectedYieldQty + extraYield);
          expect(after).toBeLessThanOrEqual(before);
        },
      ),
    );
  });

  it("property: equals the half-up integer result of the exact rational", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 0, maxLength: 10 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (lines, expectedYieldQty) => {
          const total = lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
          expect(computeItemReplacementCost(lines, expectedYieldQty)).toBe(
            mc(Math.floor(total / expectedYieldQty + 0.5)),
          );
        },
      ),
    );
  });

  it("property: recursive BOM rounding stays within 0.5 mc per derived level", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (rawCost, semiQty, semiYieldExtra, finishedYieldExtra) => {
          const semiYield = semiQty + semiYieldExtra;
          const finishedQty = semiYield;
          const finishedYield = finishedQty + finishedYieldExtra;
          const semi = computeItemReplacementCost(
            [{ qty: semiQty, unitCost: mc(rawCost) }],
            semiYield,
          );
          const finished = computeItemReplacementCost(
            [{ qty: finishedQty, unitCost: semi }],
            finishedYield,
          );
          const semiNum = BigInt(rawCost) * BigInt(semiQty);
          const semiDen = BigInt(semiYield);
          const finishedNum = semiNum * BigInt(finishedQty);
          const finishedDen = semiDen * BigInt(finishedYield);
          const within = (
            actual: number,
            numerator: bigint,
            denominator: bigint,
            levels: bigint,
          ): void => {
            const errorTwice = 2n * BigInt(actual) * denominator - 2n * numerator;
            const absolute = errorTwice < 0n ? -errorTwice : errorTwice;
            expect(absolute).toBeLessThanOrEqual(levels * denominator);
          };
          within(semi, semiNum, semiDen, 1n);
          within(finished, finishedNum, finishedDen, 2n);
        },
      ),
    );
  });
});
