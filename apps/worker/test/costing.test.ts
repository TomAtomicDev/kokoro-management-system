// Unit + property tests for core/costing's pure math (KOK-013, Doc 11 §1-2).
//
// These functions are plain, synchronous, DB-free (see wac.ts's header comment), so unlike
// inventory.test.ts / catalog.test.ts they do NOT need @cloudflare/vitest-pool-workers or a D1
// binding — a plain Vitest run is enough. The DB-touching half of this task
// (buildWacRepairIfDrifted / getCurrentWac) is covered separately in costing-repair.test.ts
// against real D1, mirroring inventory.test.ts's pattern.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  applyWacEntry,
  computePurchaseLineUnitCost,
  recomputeWacFromMovements,
  snapshotUnitCost,
} from "../src/core/costing/index.js";
import type { ReplayMovement } from "../src/core/costing/index.js";

function expectDomainValidationError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toMatchObject({ code: "VALIDATION" });
}

describe("applyWacEntry (C-1)", () => {
  it("computes the weighted average for a simple entry into positive on-hand", () => {
    // onHand=1000 @ wac=100, entry qty=1000 @ cost=200 -> (1000*100 + 1000*200) / 2000 = 150.
    expect(applyWacEntry(100, 1000, 1000, 200)).toBe(150);
  });

  it("first-ever entry (onHand=0, wac=0) yields exactly the entry's unit cost", () => {
    expect(applyWacEntry(0, 0, 5000, 333.33)).toBeCloseTo(333.33, 9);
  });

  it("guards max(on_hand,0): a negative on-hand is treated as a ZERO weight, not a negative one", () => {
    // onHand=-2000 (INV-8 negative stock) @ wac=100 (stale), entry qty=1000 @ cost=400.
    // max(on_hand,0)=0, so result must be exactly the entry's own cost (400), NOT a blend that
    // lets the negative balance pull the average down/up.
    expect(applyWacEntry(100, -2000, 1000, 400)).toBe(400);
  });

  it("weights larger entries more than smaller on-hand, and vice versa", () => {
    // onHand=100 @ wac=1000, entry qty=100000 @ cost=10: on-hand's weight is only ~0.1% of the
    // total (100 vs 100100), so the result sits close to the entry's own cost (10) but is pulled
    // slightly above it by the small on-hand weight: (100*1000 + 100000*10)/100100 ≈ 10.989.
    const dominated = applyWacEntry(1000, 100, 100000, 10);
    expect(dominated).toBeCloseTo(1100000 / 100100, 9);
    expect(dominated).toBeGreaterThan(10);
    expect(dominated).toBeLessThan(11);

    // onHand=100000 @ wac=10, entry qty=100 @ cost=1000: the entry's weight is only ~0.1% of the
    // total, so the result barely moves from 10, landing at the same fraction by symmetry.
    const barelyMoved = applyWacEntry(10, 100000, 100, 1000);
    expect(barelyMoved).toBeCloseTo(1100000 / 100100, 9);
    expect(barelyMoved).toBeGreaterThan(10);
    expect(barelyMoved).toBeLessThan(11);
  });

  it("rejects entryQty <= 0 (C-1 only applies to genuine positive-qty entries)", () => {
    expectDomainValidationError(() => applyWacEntry(100, 1000, 0, 200));
    expectDomainValidationError(() => applyWacEntry(100, 1000, -500, 200));
  });

  it("rejects non-integer / unsafe on-hand or qty", () => {
    expectDomainValidationError(() => applyWacEntry(100, 1.5, 1000, 200));
    expectDomainValidationError(() => applyWacEntry(100, 1000, 1.5, 200));
    expectDomainValidationError(() => applyWacEntry(100, Number.NaN, 1000, 200));
  });

  it("rejects negative wac or unit cost", () => {
    expectDomainValidationError(() => applyWacEntry(-1, 1000, 1000, 200));
    expectDomainValidationError(() => applyWacEntry(100, 1000, 1000, -1));
  });
});

describe("computePurchaseLineUnitCost (C-2)", () => {
  it("divides line_total by qty without rounding", () => {
    expect(computePurchaseLineUnitCost(10000, 3000)).toBeCloseTo(3.3333333, 5); // 10000/3000
    expect(computePurchaseLineUnitCost(5000, 1000)).toBe(5); // exact whole-unit case
  });

  it("rejects qty <= 0", () => {
    expectDomainValidationError(() => computePurchaseLineUnitCost(1000, 0));
    expectDomainValidationError(() => computePurchaseLineUnitCost(1000, -1000));
  });

  it("rejects a negative line total", () => {
    expectDomainValidationError(() => computePurchaseLineUnitCost(-1000, 1000));
  });

  it("rejects non-integer inputs", () => {
    expectDomainValidationError(() => computePurchaseLineUnitCost(1000.5, 1000));
    expectDomainValidationError(() => computePurchaseLineUnitCost(1000, 1000.5));
  });
});

describe("snapshotUnitCost", () => {
  it("is the identity for a valid wac", () => {
    expect(snapshotUnitCost(123.456)).toBe(123.456);
    expect(snapshotUnitCost(0)).toBe(0);
  });

  it("rejects a negative wac", () => {
    expectDomainValidationError(() => snapshotUnitCost(-1));
  });
});

describe("recomputeWacFromMovements (R-2)", () => {
  it("replays a simple purchase-then-sale history: sale does not change WAC", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCost: 100 },
      { type: "SALE_OUT", qty: -400, unitCost: 100 }, // exit valued at wac, doesn't feed back
      { type: "PURCHASE_IN", qty: 1000, unitCost: 300 }, // onHand before this entry = 600
    ];
    // After first purchase: onHand=1000, wac=100.
    // After sale: onHand=600, wac=100 (unchanged).
    // Second purchase: (600*100 + 1000*300) / 1600 = (60000+300000)/1600 = 225.
    expect(recomputeWacFromMovements(movements)).toBeCloseTo(225, 9);
  });

  it("ADJUST movements of either sign never change WAC, even a positive (found-more-stock) ADJUST", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCost: 100 },
      { type: "ADJUST", qty: 500, unitCost: 100 }, // positive adjust: found more stock than expected
      { type: "PURCHASE_IN", qty: 1000, unitCost: 500 }, // onHand before this entry = 1500
    ];
    // After purchase: onHand=1000, wac=100. After ADJUST: onHand=1500, wac=100 (unchanged).
    // Second purchase: (1500*100 + 1000*500) / 2500 = (150000+500000)/2500 = 260.
    expect(recomputeWacFromMovements(movements)).toBeCloseTo(260, 9);
  });

  it("a negative ADJUST also never changes WAC", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCost: 100 },
      { type: "ADJUST", qty: -300, unitCost: 100 }, // negative adjust: counted less than expected
    ];
    expect(recomputeWacFromMovements(movements)).toBe(100);
  });

  it("PRODUCTION_OUT/EXIT_OUT never change WAC", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 2000, unitCost: 50 },
      { type: "PRODUCTION_OUT", qty: -500, unitCost: 50 },
      { type: "EXIT_OUT", qty: -300, unitCost: 50 },
    ];
    expect(recomputeWacFromMovements(movements)).toBe(50);
  });

  it("a purchase entry after on-hand went negative floors the weight at zero (max(on_hand,0))", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCost: 100 },
      { type: "SALE_OUT", qty: -3000, unitCost: 100 }, // onHand goes to -2000 (INV-8)
      { type: "PURCHASE_IN", qty: 1000, unitCost: 400 }, // onHand before this entry = -2000, floored to 0
    ];
    // Second purchase entry: max(-2000,0)=0, so wac' = (0*100 + 1000*400)/1000 = 400 exactly.
    expect(recomputeWacFromMovements(movements)).toBe(400);
  });

  it("empty history returns wac=0", () => {
    expect(recomputeWacFromMovements([])).toBe(0);
  });

  it("rejects a zero-qty movement in the history (defensive — should be unreachable against real data)", () => {
    expectDomainValidationError(() =>
      recomputeWacFromMovements([{ type: "PURCHASE_IN", qty: 0, unitCost: 100 }]),
    );
  });
});

// ---------------------------------------------------------------------------
// Property tests (Doc 11 §2, mandatory for money math per D-5/backlog 🧠5).
// ---------------------------------------------------------------------------

const entryArb = fc.record({
  qty: fc.integer({ min: 1, max: 1_000_000 }), // milli-units, always positive (a real entry)
  unitCost: fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
});

describe("property: WAC stays bounded by the entry unit costs used to compute it", () => {
  it("∀ entry sequences starting from onHand=0/wac=0: final wac ∈ [min(costs), max(costs)]", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 50 }), (entries) => {
        let onHand = 0;
        let wac = 0;
        for (const entry of entries) {
          wac = applyWacEntry(wac, onHand, entry.qty, entry.unitCost);
          onHand += entry.qty;
        }

        const costs = entries.map((e) => e.unitCost);
        const min = Math.min(...costs);
        const max = Math.max(...costs);

        // A weighted average of a set of costs can never fall outside the range of those costs.
        // Small epsilon for float rounding across many divisions.
        const epsilon = Math.max(1e-6, (max - min) * 1e-9);
        expect(wac).toBeGreaterThanOrEqual(min - epsilon);
        expect(wac).toBeLessThanOrEqual(max + epsilon);
      }),
    );
  });

  it("also holds — as [0, max(entry costs)], see below — when exits/ADJUST are interleaved (via recomputeWacFromMovements)", () => {
    // NOTE on why the bound here is [0, max] and not [min, max] like the pure-entries property
    // above: fast-check found (and this test pins down) a real, CORRECT edge case — a positive
    // ADJUST ("inventory count found MORE stock than expected") occurring BEFORE any real
    // PURCHASE_IN/PRODUCTION_IN has ever primed the WAC injects on-hand qty valued at whatever WAC
    // currently is, which at that point is still the placeholder 0 (no cost basis exists yet). The
    // NEXT entry's applyWacEntry call then legitimately blends that phantom zero-cost weight in,
    // which can pull the result BELOW every real entry's unit cost — e.g. onHand=0,wac=0 ->
    // ADJUST(+1) -> onHand=1,wac=0 (unchanged, per C-6) -> PURCHASE_IN(qty=1, cost=C) ->
    // wac' = (1*0 + 1*C)/2 = C/2, which is below min(entry costs)=C. This is exactly C-1's formula
    // working as specified (C-6: ADJUST values at current WAC, even when that's still 0) — not a
    // bug — so the property this replay CAN guarantee is the looser, still-always-true bound: by
    // induction, applyWacEntry's result is always a weighted average of two values already known
    // to be within [0, max(entry costs seen so far)] (the running wac, inductively, and the new
    // entryUnitCost, by definition), so the result never leaves that range either. It can, however,
    // legitimately fall below min(entry costs) when phantom pre-purchase ADJUST weight is present.
    const movementArb = fc.oneof(
      entryArb.map((e) => ({ type: "PURCHASE_IN" as const, qty: e.qty, unitCost: e.unitCost })),
      fc
        .integer({ min: 1, max: 500_000 })
        .map((qty) => ({ type: "SALE_OUT" as const, qty: -qty, unitCost: 0 })),
      fc
        .integer({ min: -500_000, max: 500_000 })
        .filter((q) => q !== 0)
        .map((qty) => ({ type: "ADJUST" as const, qty, unitCost: 0 })),
    );

    fc.assert(
      fc.property(
        fc.array(movementArb, { minLength: 1, maxLength: 60 }).filter((movements) =>
          // At least one entry must exist, else max over entry costs is undefined.
          movements.some((m) => m.type === "PURCHASE_IN"),
        ),
        (movements) => {
          const wac = recomputeWacFromMovements(movements);
          const entryCosts = movements
            .filter((m) => m.type === "PURCHASE_IN")
            .map((m) => m.unitCost);
          const max = Math.max(...entryCosts);
          const epsilon = Math.max(1e-6, max * 1e-9);
          expect(wac).toBeGreaterThanOrEqual(0 - epsilon);
          expect(wac).toBeLessThanOrEqual(max + epsilon);
        },
      ),
    );
  });
});

describe("property: applyWacEntry loses no centavos — the C-1 formula is exactly the algebraic identity it claims", () => {
  it("∀ (onHand, wac, entry qty, entry cost): new_on_hand·new_wac == floor(old_on_hand,0)·old_wac + entry_qty·entry_cost", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }), // currentWac
        fc.integer({ min: -1_000_000, max: 1_000_000 }), // currentOnHand (may be negative, INV-8)
        fc.integer({ min: 1, max: 1_000_000 }), // entryQty (always positive)
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }), // entryUnitCost
        (currentWac, currentOnHand, entryQty, entryUnitCost) => {
          const newWac = applyWacEntry(currentWac, currentOnHand, entryQty, entryUnitCost);
          const onHandFloor = Math.max(currentOnHand, 0);
          const newOnHand = onHandFloor + entryQty;

          const lhs = newOnHand * newWac;
          const rhs = onHandFloor * currentWac + entryQty * entryUnitCost;

          // Relative epsilon: these are floats multiplied by values up to 1e6, so allow a
          // proportionally scaled tolerance rather than a fixed absolute one.
          const scale = Math.max(Math.abs(lhs), Math.abs(rhs), 1);
          expect(Math.abs(lhs - rhs)).toBeLessThanOrEqual(scale * 1e-9);
        },
      ),
    );
  });
});
