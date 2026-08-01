// Unit + property tests for core/costing's pure math (KOK-013, Doc 11 §1-2).
//
// These functions are plain, synchronous, DB-free (see wac.ts's header comment), so unlike
// inventory.test.ts / catalog.test.ts they do NOT need @cloudflare/vitest-pool-workers or a D1
// binding — a plain Vitest run is enough. The DB-touching half of this task
// (detectWacDrift / getCurrentWac) is covered separately in costing-repair.test.ts
// against real D1, mirroring inventory.test.ts's pattern.
//
// ADR-017: `wac`/`unitCost`/entry costs are integer `MilliCentavosPerUnit` (branded via `mc` =
// `toMilliCentavosPerUnit`, an alias kept local to this file for readability).
// `applyWacEntry`/`replayWacFrom` round every intermediate WAC to the nearest integer
// (`roundHalfUpToInt`), so the engine is exactly reproducible but does not conserve centavos
// bit-for-bit. The bounded-rounding-error property below is what describes it.

import { toMilliCentavosPerUnit } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ReplayMovement } from "../src/core/costing/index.js";
import {
  applyWacEntry,
  computePurchaseLineUnitCost,
  recomputeWacFromMovements,
  snapshotUnitCost,
} from "../src/core/costing/index.js";
// KOK-024 Phase B additions are imported from the module directly rather than through the barrel:
// core/costing/index.ts is being edited concurrently by the service half of this task, so this
// phase deliberately does not touch it. Re-export them from the barrel when the halves merge.
import { replayWacFrom, replayWacWithTrace } from "../src/core/costing/wac.js";

const mc = toMilliCentavosPerUnit;

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
    expect(applyWacEntry(mc(100), 1000, 1000, mc(200))).toBe(150);
  });

  it("first-ever entry (onHand=0, wac=0) yields exactly the entry's unit cost", () => {
    // onHandFloor=0 so the numerator is exactly entryQty·entryUnitCost and the denominator is
    // exactly entryQty — the division is exact for ANY integer entryUnitCost, no rounding
    // involved, so this is `toBe`, not the old `toBeCloseTo`.
    expect(applyWacEntry(mc(0), 0, 5000, mc(333))).toBe(333);
  });

  it("guards max(on_hand,0): a negative on-hand is treated as a ZERO weight, not a negative one", () => {
    // onHand=-2000 (INV-8 negative stock) @ wac=100 (stale), entry qty=1000 @ cost=400.
    // max(on_hand,0)=0, so result must be exactly the entry's own cost (400), NOT a blend that
    // lets the negative balance pull the average down/up.
    expect(applyWacEntry(mc(100), -2000, 1000, mc(400))).toBe(400);
  });

  it("weights larger entries more than smaller on-hand, and vice versa", () => {
    // onHand=100 @ wac=1000, entry qty=100000 @ cost=10: on-hand's weight is only ~0.1% of the
    // total (100 vs 100100). The true weighted average is (100*1000 + 100000*10)/100100 =
    // 1100000/100100 ≈ 10.989, which `roundHalfUpToInt` rounds to 11 —
    // an integer, so this is no longer "close to 10", it IS 11.
    const dominated = applyWacEntry(mc(1000), 100, 100000, mc(10));
    expect(dominated).toBe(11);

    // onHand=100000 @ wac=10, entry qty=100 @ cost=1000: by symmetry this is exactly the same
    // numerator/denominator (1100000/100100) as above, so it rounds to the same integer, 11.
    const barelyMoved = applyWacEntry(mc(10), 100000, 100, mc(1000));
    expect(barelyMoved).toBe(11);
  });

  it("rejects entryQty <= 0 (C-1 only applies to genuine positive-qty entries)", () => {
    expectDomainValidationError(() => applyWacEntry(mc(100), 1000, 0, mc(200)));
    expectDomainValidationError(() => applyWacEntry(mc(100), 1000, -500, mc(200)));
  });

  it("rejects non-integer / unsafe on-hand or qty", () => {
    expectDomainValidationError(() => applyWacEntry(mc(100), 1.5, 1000, mc(200)));
    expectDomainValidationError(() => applyWacEntry(mc(100), 1000, 1.5, mc(200)));
    expectDomainValidationError(() => applyWacEntry(mc(100), Number.NaN, 1000, mc(200)));
  });

  it("rejects negative wac or unit cost", () => {
    expectDomainValidationError(() => applyWacEntry(mc(-1), 1000, 1000, mc(200)));
    expectDomainValidationError(() => applyWacEntry(mc(100), 1000, 1000, mc(-1)));
  });
});

describe("computePurchaseLineUnitCost (C-2)", () => {
  it("rate-from-total: line_total (centavos) × 1,000,000 / qty (milli-units), rounded half-up (ADR-017)", () => {
    // 10000 centavos / 3000 milli-units -> exact rate is 10000*1e6/3000 = 3,333,333.33... ->
    // roundHalfUpToInt takes it to 3,333,333.
    expect(computePurchaseLineUnitCost(10000, 3000)).toBe(3_333_333);
    expect(computePurchaseLineUnitCost(5000, 1000)).toBe(5_000_000); // exact whole-unit case
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
    expect(snapshotUnitCost(mc(123_456))).toBe(123_456);
    expect(snapshotUnitCost(mc(0))).toBe(0);
  });

  it("rejects a negative wac", () => {
    expectDomainValidationError(() => snapshotUnitCost(mc(-1)));
  });
});

describe("recomputeWacFromMovements (R-2)", () => {
  it("replays a simple purchase-then-sale history: sale does not change WAC", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(100) },
      { type: "SALE_OUT", qty: -400, unitCostMc: mc(100) }, // exit valued at wac, doesn't feed back
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(300) }, // onHand before this entry = 600
    ];
    // After first purchase: onHand=1000, wac=100.
    // After sale: onHand=600, wac=100 (unchanged).
    // Second purchase: (600*100 + 1000*300) / 1600 = (60000+300000)/1600 = 225 (exact).
    expect(recomputeWacFromMovements(movements)).toBe(225);
  });

  it("ADJUST movements of either sign never change WAC, even a positive (found-more-stock) ADJUST", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(100) },
      { type: "ADJUST", qty: 500, unitCostMc: mc(100) }, // positive adjust: found more stock than expected
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(500) }, // onHand before this entry = 1500
    ];
    // After purchase: onHand=1000, wac=100. After ADJUST: onHand=1500, wac=100 (unchanged).
    // Second purchase: (1500*100 + 1000*500) / 2500 = (150000+500000)/2500 = 260 (exact).
    expect(recomputeWacFromMovements(movements)).toBe(260);
  });

  it("a negative ADJUST also never changes WAC", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(100) },
      { type: "ADJUST", qty: -300, unitCostMc: mc(100) }, // negative adjust: counted less than expected
    ];
    expect(recomputeWacFromMovements(movements)).toBe(100);
  });

  it("PRODUCTION_OUT/EXIT_OUT never change WAC", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 2000, unitCostMc: mc(50) },
      { type: "PRODUCTION_OUT", qty: -500, unitCostMc: mc(50) },
      { type: "EXIT_OUT", qty: -300, unitCostMc: mc(50) },
    ];
    expect(recomputeWacFromMovements(movements)).toBe(50);
  });

  it("a purchase entry after on-hand went negative floors the weight at zero (max(on_hand,0))", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(100) },
      { type: "SALE_OUT", qty: -3000, unitCostMc: mc(100) }, // onHand goes to -2000 (INV-8)
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(400) }, // onHand before this entry = -2000, floored to 0
    ];
    // Second purchase entry: max(-2000,0)=0, so wac' = (0*100 + 1000*400)/1000 = 400 exactly.
    expect(recomputeWacFromMovements(movements)).toBe(400);
  });

  it("empty history returns wac=0", () => {
    expect(recomputeWacFromMovements([])).toBe(0);
  });

  it("rejects a zero-qty movement in the history (defensive — should be unreachable against real data)", () => {
    expectDomainValidationError(() =>
      recomputeWacFromMovements([{ type: "PURCHASE_IN", qty: 0, unitCostMc: mc(100) }]),
    );
  });
});

describe("replayWacFrom (R-2/R-4 resume-from-a-point)", () => {
  const history: ReplayMovement[] = [
    { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(100) },
    { type: "SALE_OUT", qty: -400, unitCostMc: mc(100) },
    { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(300) },
  ];

  it("from a zero seed is exactly equivalent to recomputeWacFromMovements", () => {
    expect(replayWacFrom({ onHand: 0, wac: mc(0) }, history).wac).toBe(
      recomputeWacFromMovements(history),
    );
    expect(replayWacFrom({ onHand: 0, wac: mc(0) }, []).wac).toBe(recomputeWacFromMovements([]));
  });

  it("returns the running on-hand balance alongside the wac", () => {
    // 1000 - 400 + 1000 = 1600 milli-units.
    expect(replayWacFrom({ onHand: 0, wac: mc(0) }, history)).toEqual({ onHand: 1600, wac: 225 });
  });

  it("resumes from a non-zero seed: the seed acts as the pre-existing on-hand weight", () => {
    // seed onHand=600 @ wac=100, then PURCHASE_IN(1000 @ 300) -> (600*100 + 1000*300)/1600 = 225.
    // Identical to replaying the full `history`, whose state at that cut point is exactly the seed.
    const tail: ReplayMovement[] = [{ type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(300) }];
    expect(replayWacFrom({ onHand: 600, wac: mc(100) }, tail)).toEqual({
      onHand: 1600,
      wac: 225,
    });
  });

  it("an empty tail returns the seed unchanged", () => {
    // seed.wac is validated eagerly (even for an empty tail), so it must be an integer.
    const seed = { onHand: 750, wac: mc(4250) };
    expect(replayWacFrom(seed, [])).toEqual(seed);
  });

  it("honours a negative seed on-hand via C-1's max(on_hand,0) floor (INV-8)", () => {
    expect(
      replayWacFrom({ onHand: -2000, wac: mc(100) }, [
        { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(400) },
      ]),
    ).toEqual({ onHand: -1000, wac: 400 });
  });

  it("rejects an invalid seed (negative wac, non-integer on-hand)", () => {
    expectDomainValidationError(() => replayWacFrom({ onHand: 0, wac: mc(-1) }, history));
    expectDomainValidationError(() => replayWacFrom({ onHand: 1.5, wac: mc(0) }, history));
  });

  it("still rejects a zero-qty movement in the tail", () => {
    expectDomainValidationError(() =>
      replayWacFrom({ onHand: 100, wac: mc(10) }, [
        { type: "PURCHASE_IN", qty: 0, unitCostMc: mc(100) },
      ]),
    );
  });
});

describe("replayWacWithTrace (R-4 cost_delta inputs)", () => {
  it("emits one index-aligned step per movement, exposing the WAC as of that movement", () => {
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(100) },
      { type: "SALE_OUT", qty: -400, unitCostMc: mc(100) },
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(300) },
      { type: "SALE_OUT", qty: -100, unitCostMc: mc(225) },
    ];
    const { final, steps } = replayWacWithTrace({ onHand: 0, wac: mc(0) }, movements);

    expect(steps).toHaveLength(movements.length);
    expect(steps[0]).toEqual({ wacBefore: 0, wacAfter: 100, onHandBefore: 0, onHandAfter: 1000 });
    // The exit carries WAC forward untouched (C-6) — before and after are equal.
    expect(steps[1]).toEqual({
      wacBefore: 100,
      wacAfter: 100,
      onHandBefore: 1000,
      onHandAfter: 600,
    });
    expect(steps[2]).toEqual({
      wacBefore: 100,
      wacAfter: 225,
      onHandBefore: 600,
      onHandAfter: 1600,
    });
    // The second sale's frozen snapshot (225) matches the replayed WAC at its point => no drift.
    expect(steps[3]?.wacBefore).toBe(225);

    expect(final).toEqual({ onHand: 1500, wac: 225 });
  });

  it("surfaces a stale exit snapshot as a non-zero difference against the replayed WAC (R-4)", () => {
    // The sale was originally valued at 100, but an earlier purchase has since been corrected so
    // the replay says WAC was 225 at that point: cost_delta is computed off exactly this gap.
    const movements: ReplayMovement[] = [
      { type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(225) },
      { type: "SALE_OUT", qty: -400, unitCostMc: mc(100) },
    ];
    const { steps } = replayWacWithTrace({ onHand: 0, wac: mc(0) }, movements);
    // frozen snapshot (100) - replayed WAC at that point (225) = -125.
    expect(100 - (steps[1]?.wacBefore ?? Number.NaN)).toBe(-125);
  });

  it("agrees with replayWacFrom on the final state and produces no steps for an empty tail", () => {
    const seed = { onHand: 600, wac: mc(100) };
    const movements: ReplayMovement[] = [{ type: "PURCHASE_IN", qty: 1000, unitCostMc: mc(300) }];
    expect(replayWacWithTrace(seed, movements).final).toEqual(replayWacFrom(seed, movements));
    expect(replayWacWithTrace(seed, []).steps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Property tests (Doc 11 §2, mandatory for money math per D-5/backlog 🧠5).
// ---------------------------------------------------------------------------

const entryArb = fc.record({
  qty: fc.integer({ min: 1, max: 1_000_000 }), // milli-units, always positive (a real entry)
  unitCost: fc.integer({ min: 0, max: 100_000 }).map(mc), // integer MilliCentavosPerUnit
});

describe("property: WAC stays bounded by the entry unit costs used to compute it", () => {
  it("∀ entry sequences starting from onHand=0/wac=0: final wac ∈ [min(costs), max(costs)]", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 50 }), (entries) => {
        let onHand = 0;
        let wac = mc(0);
        for (const entry of entries) {
          wac = applyWacEntry(wac, onHand, entry.qty, entry.unitCost);
          onHand += entry.qty;
        }

        const costs = entries.map((e) => e.unitCost);
        const min = Math.min(...costs);
        const max = Math.max(...costs);

        // Every value here is an integer, and roundHalfUpToInt of a real number in [min,max]
        // (min/max integers) can never land outside [min,max] — so no epsilon is needed; the
        // bound holds exactly.
        expect(wac).toBeGreaterThanOrEqual(min);
        expect(wac).toBeLessThanOrEqual(max);
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
      entryArb.map((e) => ({ type: "PURCHASE_IN" as const, qty: e.qty, unitCostMc: e.unitCost })),
      fc
        .integer({ min: 1, max: 500_000 })
        .map((qty) => ({ type: "SALE_OUT" as const, qty: -qty, unitCostMc: mc(0) })),
      fc
        .integer({ min: -500_000, max: 500_000 })
        .filter((q) => q !== 0)
        .map((qty) => ({ type: "ADJUST" as const, qty, unitCostMc: mc(0) })),
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
            .map((m) => m.unitCostMc);
          const max = Math.max(...entryCosts);
          // integers throughout, no epsilon needed (see the property above).
          expect(wac).toBeGreaterThanOrEqual(0);
          expect(wac).toBeLessThanOrEqual(max);
        },
      ),
    );
  });
});

describe("property: applyWacEntry's rounding error is bounded — accepts a ≤0.5-per-unit remainder in exchange for integer determinism", () => {
  // applyWacEntry does NOT satisfy an exact "loses no centavos" identity, and cannot: the result
  // is rounded to the nearest integer (roundHalfUpToInt, ADR-017's determinism requirement — no
  // accumulated drift across a replay), so rounding the rate before multiplying it back out by
  // newOnHand can move the reconstructed total away from the exact numerator by up to
  // newOnHand/2. The property that does hold is that the rounding error is bounded, not absent —
  // that is what this asserts.
  it("∀ (currentWac, currentOnHand, entryQty, entryUnitCost): |newOnHand·newWac − exactNumerator| ≤ newOnHand/2", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }).map(mc), // currentWac
        fc.integer({ min: -1_000_000, max: 1_000_000 }), // currentOnHand (may be negative, INV-8)
        fc.integer({ min: 1, max: 1_000_000 }), // entryQty (always positive)
        fc.integer({ min: 0, max: 100_000 }).map(mc), // entryUnitCost
        (currentWac, currentOnHand, entryQty, entryUnitCost) => {
          const newWac = applyWacEntry(currentWac, currentOnHand, entryQty, entryUnitCost);
          const onHandFloor = Math.max(currentOnHand, 0);
          const newOnHand = onHandFloor + entryQty;

          const exactNumerator = onHandFloor * currentWac + entryQty * entryUnitCost;
          const lhs = newOnHand * newWac;

          expect(Math.abs(lhs - exactNumerator)).toBeLessThanOrEqual(newOnHand / 2);
        },
      ),
    );
  });
});

describe("property: a WAC replay is split-invariant — this is what makes resuming sound", () => {
  // The whole KOK-024 correction mechanism rests on this one property: replaying only the kardex
  // TAIL after the edited event, seeded with the state at the cut point, must land on exactly the
  // same place as replaying the item's entire history. If it did not, a corrected item's WAC would
  // depend on WHERE the correction happened to cut, which would be indefensible.
  //
  // Equality here is asserted EXACTLY, not approximately, and that is deliberate: the two runs
  // perform the identical sequence of identical integer operations (rounding is now a
  // deterministic function of the inputs, not float summation order), so any difference at all
  // would mean the seed is not carrying the full state (e.g. a lost negative on-hand, or a WAC
  // rounded on the way through) — precisely the class of bug this property exists to catch.
  const anyMovementArb = fc.oneof(
    fc.record({
      type: fc.constantFrom("PURCHASE_IN" as const, "PRODUCTION_IN" as const),
      qty: fc.integer({ min: 1, max: 1_000_000 }),
      unitCostMc: fc.integer({ min: 0, max: 100_000 }).map(mc),
    }),
    fc.record({
      type: fc.constantFrom("SALE_OUT" as const, "EXIT_OUT" as const, "PRODUCTION_OUT" as const),
      qty: fc.integer({ min: -500_000, max: -1 }),
      unitCostMc: fc.integer({ min: 0, max: 100_000 }).map(mc),
    }),
    fc.record({
      type: fc.constant("ADJUST" as const),
      qty: fc.integer({ min: -500_000, max: 500_000 }).filter((q) => q !== 0),
      unitCostMc: fc.integer({ min: 0, max: 100_000 }).map(mc),
    }),
  );

  const seedArb = fc.record({
    onHand: fc.integer({ min: -1_000_000, max: 1_000_000 }), // may be negative, INV-8
    wac: fc.integer({ min: 0, max: 100_000 }).map(mc),
  });

  it("∀ seed, movements, split index i: replay(prefix) then replay(suffix) == replay(whole)", () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.array(anyMovementArb, { minLength: 0, maxLength: 60 }),
        fc.nat(),
        (seed, movements, rawSplit) => {
          const split = movements.length === 0 ? 0 : rawSplit % (movements.length + 1);
          const prefix = movements.slice(0, split);
          const suffix = movements.slice(split);

          const whole = replayWacFrom(seed, movements);
          const resumed = replayWacFrom(replayWacFrom(seed, prefix), suffix);

          expect(resumed.wac).toBe(whole.wac);
          expect(resumed.onHand).toBe(whole.onHand);
        },
      ),
    );
  });

  it("∀ seed, movements: the trace's per-step states agree with replaying each prefix", () => {
    // steps[i] must describe movements[i] specifically — the R-4 cost_delta calculation reads
    // steps[i].wacBefore as "the WAC in effect when movements[i] happened", so an off-by-one or a
    // step that summarised the wrong movement would mis-price every corrected exit.
    fc.assert(
      fc.property(
        seedArb,
        fc.array(anyMovementArb, { minLength: 0, maxLength: 25 }),
        (seed, movements) => {
          const { final, steps } = replayWacWithTrace(seed, movements);
          expect(steps).toHaveLength(movements.length);

          for (const [i, step] of steps.entries()) {
            const before = replayWacFrom(seed, movements.slice(0, i));
            const after = replayWacFrom(seed, movements.slice(0, i + 1));
            expect(step.wacBefore).toBe(before.wac);
            expect(step.onHandBefore).toBe(before.onHand);
            expect(step.wacAfter).toBe(after.wac);
            expect(step.onHandAfter).toBe(after.onHand);
          }

          expect(final).toEqual(replayWacFrom(seed, movements));
        },
      ),
    );
  });
});
