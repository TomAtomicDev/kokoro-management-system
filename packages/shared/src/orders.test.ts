// Unit + property tests for the pure money math in orders.ts (KOK-033, D-5 / Doc 11 §2). The
// stateful lifecycle itself is covered by apps/worker/test/orders.test.ts against real D1.
//
// `allocateAgreedTotalToOrderLines` is the only place a custom order's agreed price becomes
// per-unit sale prices, so "no centavo is invented or lost" is the property that matters: the sale
// it feeds stores `total` as Σ(qty × unit_price) (Doc 04 §5), and that has to reproduce
// `agreed_total` EXACTLY or O-2's "the sale is for the full agreed total" is a lie.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mulMoneyByQty } from "./money.js";
import { allocateAgreedTotalToOrderLines, orderLineCommandSchema } from "./orders.js";

/** Σ(qty × unit_price) exactly as core/orders will compute the sale's stored total. */
function reconstructTotal(
  allocations: readonly { unitPrice: number }[],
  lines: readonly { qty: number }[],
): number {
  return allocations.reduce((sum, a, i) => sum + mulMoneyByQty(a.unitPrice, lines[i]?.qty ?? 0), 0);
}

describe("allocateAgreedTotalToOrderLines", () => {
  it("prices a single whole-unit line at the agreed total", () => {
    const lines = [{ qty: 1000 }];
    expect(allocateAgreedTotalToOrderLines(35_000, lines)).toEqual([
      { lineTotal: 35_000, unitPrice: 35_000 },
    ]);
  });

  it("splits across whole-unit lines weighted by qty", () => {
    // Bs 300,00 across 1 + 2 units → 100,00 / 200,00.
    const lines = [{ qty: 1000 }, { qty: 2000 }];
    expect(allocateAgreedTotalToOrderLines(30_000, lines)).toEqual([
      { lineTotal: 10_000, unitPrice: 10_000 },
      { lineTotal: 20_000, unitPrice: 10_000 },
    ]);
  });

  it("pins lines that carry an explicit lineTotal and splits only the remainder", () => {
    const lines = [{ qty: 1000, lineTotal: 12_000 }, { qty: 1000 }, { qty: 1000 }];
    const out = allocateAgreedTotalToOrderLines(30_000, lines);
    expect(out).toEqual([
      { lineTotal: 12_000, unitPrice: 12_000 },
      { lineTotal: 9_000, unitPrice: 9_000 },
      { lineTotal: 9_000, unitPrice: 9_000 },
    ]);
  });

  it("gives the odd centavo to the largest remainder, never dropping it", () => {
    // Bs 10,00 across three equal lines: 334 + 333 + 333 = 1000, exactly.
    const lines = [{ qty: 1000 }, { qty: 1000 }, { qty: 1000 }];
    const out = allocateAgreedTotalToOrderLines(1000, lines);
    expect(out?.map((a) => a.lineTotal)).toEqual([334, 333, 333]);
    expect(out?.reduce((s, a) => s + a.lineTotal, 0)).toBe(1000);
  });

  it("returns null when there are no lines at all (nothing to price)", () => {
    expect(allocateAgreedTotalToOrderLines(10_000, [])).toBeNull();
  });

  it("returns null when pinned lines exceed the agreed total", () => {
    expect(allocateAgreedTotalToOrderLines(10_000, [{ qty: 1000, lineTotal: 12_000 }])).toBeNull();
  });

  it("returns null when every line is pinned but the pins do not add up", () => {
    expect(
      allocateAgreedTotalToOrderLines(30_000, [
        { qty: 1000, lineTotal: 12_000 },
        { qty: 1000, lineTotal: 12_000 },
      ]),
    ).toBeNull();
  });

  it("accepts fully-pinned lines that DO add up exactly", () => {
    const out = allocateAgreedTotalToOrderLines(24_000, [
      { qty: 1000, lineTotal: 12_000 },
      { qty: 1000, lineTotal: 12_000 },
    ]);
    expect(out?.map((a) => a.lineTotal)).toEqual([12_000, 12_000]);
  });

  it("returns null when per-unit prices cannot reproduce the total exactly", () => {
    // Bs 1,00 over a single 3-unit line: no integer centavo per-unit price yields exactly 100
    // (33 → 99, 34 → 102). Refusing beats misstating the sale by a centavo.
    expect(allocateAgreedTotalToOrderLines(100, [{ qty: 3000 }])).toBeNull();
  });

  it("returns null for a non-positive or non-integer qty", () => {
    expect(allocateAgreedTotalToOrderLines(1000, [{ qty: 0 }])).toBeNull();
    expect(allocateAgreedTotalToOrderLines(1000, [{ qty: -1000 }])).toBeNull();
    expect(allocateAgreedTotalToOrderLines(1000, [{ qty: 1500.5 }])).toBeNull();
  });

  it("property: single-unit lines ALWAYS allocate, and Σ(qty × unitPrice) === agreedTotal", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 20 }),
        (agreedTotal, lineCount) => {
          // qty === 1000 (one whole unit) on every line: the DDL default and the shape the
          // overwhelming majority of custom orders take. Here `unitPrice === lineTotal`
          // identically, so the reconstruction can never drift and the helper never refuses.
          const lines = Array.from({ length: lineCount }, () => ({ qty: 1000 }));
          const out = allocateAgreedTotalToOrderLines(agreedTotal, lines);
          expect(out).not.toBeNull();
          if (out === null) return;
          // The invariant that matters (Doc 11 §2): not one centavo invented or lost.
          expect(reconstructTotal(out, lines)).toBe(agreedTotal);
          for (const a of out) {
            expect(Number.isInteger(a.lineTotal)).toBe(true);
            expect(Number.isInteger(a.unitPrice)).toBe(true);
            expect(a.lineTotal).toBeGreaterThanOrEqual(0);
            expect(a.unitPrice).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("property: pinned lines are never altered, and the whole still reconstructs exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 10 }),
        (pinned, residual, unpinnedCount) => {
          const lines = [
            { qty: 1000, lineTotal: pinned },
            ...Array.from({ length: unpinnedCount }, () => ({ qty: 1000 })),
          ];
          const out = allocateAgreedTotalToOrderLines(pinned + residual, lines);
          expect(out).not.toBeNull();
          if (out === null) return;
          // Rule 1: a hand-priced line keeps exactly the price the owner typed.
          expect(out[0]?.lineTotal).toBe(pinned);
          expect(reconstructTotal(out, lines)).toBe(pinned + residual);
        },
      ),
    );
  });

  it("property: multi-unit lines either refuse or reconstruct exactly — never drift", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 12 }),
        (agreedTotal, unitCounts) => {
          // A line of N whole units carries ONE per-unit price, so its money is always a multiple
          // of N — some agreed totals are genuinely unrepresentable (Bs 1,00 over 3 units). The
          // helper must then refuse rather than round the customer's price.
          const lines = unitCounts.map((units) => ({ qty: units * 1000 }));
          const out = allocateAgreedTotalToOrderLines(agreedTotal, lines);
          if (out === null) return;
          expect(reconstructTotal(out, lines)).toBe(agreedTotal);
        },
      ),
    );
  });

  it("property: any successful allocation reconstructs exactly, whatever the quantities", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 9_000 }), { minLength: 1, maxLength: 12 }),
        (agreedTotal, qtys) => {
          const lines = qtys.map((qty) => ({ qty }));
          const out = allocateAgreedTotalToOrderLines(agreedTotal, lines);
          // Fractional quantities MAY be unrepresentable — but never silently wrong: the helper
          // either refuses (null) or reproduces the agreed total to the centavo.
          if (out === null) return;
          expect(reconstructTotal(out, lines)).toBe(agreedTotal);
        },
      ),
    );
  });
});

describe("orderLineCommandSchema", () => {
  it("accepts an item-linked line with no description", () => {
    const parsed = orderLineCommandSchema.parse({ itemId: "itm_1" });
    expect(parsed).toMatchObject({ itemId: "itm_1", qty: 1000 });
  });

  it("accepts a free-text line with a description and no item", () => {
    const parsed = orderLineCommandSchema.parse({ description: "Torta de 3 pisos" });
    expect(parsed).toMatchObject({ description: "Torta de 3 pisos", qty: 1000 });
  });

  it("rejects a line with neither an item nor a description", () => {
    expect(() => orderLineCommandSchema.parse({ qty: 2000 })).toThrow();
    expect(() => orderLineCommandSchema.parse({ description: "   " })).toThrow();
  });

  it("defaults qty to one whole unit (1000 milli-units), matching the DDL", () => {
    expect(orderLineCommandSchema.parse({ itemId: "itm_1" }).qty).toBe(1000);
  });
});
