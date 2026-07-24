// Unit + property tests for core/costing's pure C-3 replacement-cost math (KOK-029, Doc 03 §4,
// Doc 11 §1-2). Plain, synchronous, DB-free (see replacement-cost.ts's header) — a plain Vitest
// run is enough, no D1 binding needed. Mirrors recipes-theoretical-cost.test.ts's structure for
// the sibling C-3b function.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  computeItemReplacementCost,
  type ReplacementCostLine,
} from "../src/core/costing/replacement-cost.js";

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
  it("computes a simple single-line recipe: 1000 milli-units of flour @ 5 centavos/milli-unit, yield 1000 milli-units", () => {
    const lines: ReplacementCostLine[] = [{ qty: 1000, unitCost: 5 }];
    expect(computeItemReplacementCost(lines, 1000)).toBe(5);
  });

  it("sums multiple lines and divides by yield, unrounded and NOT scaled to a whole-unit price (unlike C-3b's preview)", () => {
    // batch cost = 500*10 + 200*3 = 5600 centavos, yield = 2000 milli-units -> 2.8 centavos/milli-unit.
    const lines: ReplacementCostLine[] = [
      { qty: 500, unitCost: 10 },
      { qty: 200, unitCost: 3 },
    ];
    expect(computeItemReplacementCost(lines, 2000)).toBe(2.8);
  });

  it("a recipe with no lines costs nothing (the Zod command schema forbids empty recipes on write, not this pure function)", () => {
    expect(computeItemReplacementCost([], 1000)).toBe(0);
  });

  it("shrinkage (yield below total input qty) can push the per-milli-unit cost above any single ingredient's unit cost — deliberately NOT bounded by the ingredient range, unlike a true weighted average", () => {
    // 1000 milli-units @ 10 centavos/milli-unit in, only 500 milli-units out (50% loss).
    const lines: ReplacementCostLine[] = [{ qty: 1000, unitCost: 10 }];
    expect(computeItemReplacementCost(lines, 500)).toBe(20);
  });

  it("rejects a non-positive expectedYieldQty", () => {
    expectDomainValidationError(() => computeItemReplacementCost([], 0));
    expectDomainValidationError(() => computeItemReplacementCost([], -1000));
  });

  it("rejects a non-positive line qty", () => {
    expectDomainValidationError(() => computeItemReplacementCost([{ qty: 0, unitCost: 5 }], 1000));
    expectDomainValidationError(() =>
      computeItemReplacementCost([{ qty: -100, unitCost: 5 }], 1000),
    );
  });

  it("rejects a negative unit cost", () => {
    expectDomainValidationError(() =>
      computeItemReplacementCost([{ qty: 100, unitCost: -1 }], 1000),
    );
  });

  const lineArb = fc.record({
    qty: fc.integer({ min: 1, max: 1_000_000 }),
    unitCost: fc.double({ min: 0, max: 100_000, noNaN: true }),
  });

  it("property: all-zero unit costs always cost nothing, regardless of quantities or yield", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (qtys, expectedYieldQty) => {
          const lines: ReplacementCostLine[] = qtys.map((qty) => ({ qty, unitCost: 0 }));
          expect(computeItemReplacementCost(lines, expectedYieldQty)).toBe(0);
        },
      ),
    );
  });

  it("property: raising any single line's unit cost never decreases the result (all else fixed)", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 9 }),
        fc.double({ min: 0, max: 100_000, noNaN: true }),
        (lines, expectedYieldQty, indexSeed, extraCost) => {
          const index = indexSeed % lines.length;
          const before = computeItemReplacementCost(lines, expectedYieldQty);
          const raised = lines.map((line, i) =>
            i === index ? { ...line, unitCost: line.unitCost + extraCost } : line,
          );
          const after = computeItemReplacementCost(raised, expectedYieldQty);
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
    );
  });

  it("property: raising expected yield never increases the result (lines fixed) — more output spreads the same batch cost thinner", () => {
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

  it("property: exactly reconstructs Σ(qty × unitCost) / expectedYieldQty (definitional identity, no hidden rounding)", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 0, maxLength: 10 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (lines, expectedYieldQty) => {
          const expected =
            lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0) / expectedYieldQty;
          expect(computeItemReplacementCost(lines, expectedYieldQty)).toBe(expected);
        },
      ),
    );
  });
});
