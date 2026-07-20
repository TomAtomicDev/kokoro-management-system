// core/costing — pure weighted-average-cost (WAC) math (KOK-013).
// Doc 03 §4 "Costing rules (normative)" C-1, C-2, C-6; Doc 03 §7 "Correction & recalculation
// policy" R-2. Every function in this file is a plain, synchronous, DB-free computation — no `Db`
// parameter, nothing async — so it is trivially usable both by future event services (purchases
// KOK-016, production KOK-026) and by fast-check property tests (Doc 11 §2).
//
// Convention (matches core/inventory, see movements.ts): `wac` / `entryUnitCost` / the return
// value of every function here are CENTAVOS PER MILLI-UNIT (a deliberately-float quantity, Doc 04
// §2/§3.4), the exact same unit as `stock_movements.unit_cost`. A value produced here can be
// passed straight into a StockMovementInput's `unitCost` field with no conversion. `on_hand` /
// `qty` values are milli-unit integers.
//
// ADJUST-vs-entry reasoning (C-1/C-6, KB-amendment-worthy — Doc 03 does not spell this out in so
// many words, see the report for this task):
// C-1 says WAC updates on every stock ENTRY with an externally-given unit cost `c`. C-6 groups
// ADJUST together with true exits (SALE_OUT/EXIT_OUT/PRODUCTION_OUT) for VALUATION purposes: "exits
// and count adjustments value at current WAC". A positive ADJUST (an inventory count that found
// MORE stock than the system expected) is therefore NOT treated as a C-1 entry, even though it
// increases on-hand qty like an entry would: its `unit_cost` is whatever WAC already was at the
// time the movement was written (i.e. it is DERIVED FROM the WAC, per C-6), so feeding it back
// into the C-1 formula as if it were an externally-priced entry would be circular and would let an
// inventory-count correction silently drag the WAC toward itself. Only PURCHASE_IN and
// PRODUCTION_IN — movements that carry a genuine externally-given cost (a purchase invoice line, a
// production run's computed output cost) — trigger the C-1 update. This is encoded below by
// `recomputeWacFromMovements`'s `ENTRY_TYPES` set and mirrored by every future exit-valuing
// service, which must call `snapshotUnitCost`/`getCurrentWac` (repair.ts) rather than ever calling
// `applyWacEntry` for an ADJUST or exit movement.

import type { StockMovementType } from "@kokoro/shared";

import { validationError } from "../errors.js";

// Mirrors packages/shared/src/numeric.ts's assertSafeInteger pattern. That module is deliberately
// NOT part of @kokoro/shared's public barrel (packages/shared/package.json only exports ".") —
// see core/inventory/movements.ts's identical note. core/costing is yet another trusted boundary
// (D-5: this is where WAC itself is computed), so it keeps its own copy rather than reaching past
// the package's export map, exactly like core/inventory does.
function assertSafeIntegerInput(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationError(`${label} debe ser un entero seguro.`, { [label]: value });
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw validationError(`${label} debe ser un número finito no negativo.`, { [label]: value });
  }
}

/**
 * C-1: `wac' = (max(on_hand,0)·wac + q·c) / (max(on_hand,0) + q)`.
 *
 * `currentOnHand` is the running on-hand balance BEFORE this entry (milli-units, may be negative
 * per INV-8 — the `max(on_hand,0)` guard treats a negative balance as a zero WEIGHT in the
 * average, not as a negative weight). `entryQty` is this entry's qty (milli-units) and MUST be
 * strictly positive: C-1 is defined only for genuine stock entries (PURCHASE_IN/PRODUCTION_IN),
 * which core/inventory's sign enforcement (movements.ts) already guarantees are qty > 0 — this
 * function defensively re-asserts it rather than trusting the caller, because requiring
 * `entryQty > 0` is also exactly what makes the denominator `max(on_hand,0) + entryQty`
 * STRUCTURALLY unable to reach zero (max(on_hand,0) >= 0, entryQty > 0 ⇒ sum > 0), which is the
 * task's required guard against a NaN/Infinity division — expressed as a precondition instead of
 * a separate post-hoc zero-check.
 */
export function applyWacEntry(
  currentWac: number,
  currentOnHand: number,
  entryQty: number,
  entryUnitCost: number,
): number {
  assertFiniteNonNegative(currentWac, "currentWac");
  assertSafeIntegerInput(currentOnHand, "currentOnHand");
  assertSafeIntegerInput(entryQty, "entryQty");
  assertFiniteNonNegative(entryUnitCost, "entryUnitCost");

  if (entryQty <= 0) {
    throw validationError(
      "applyWacEntry solo aplica a entradas de stock con cantidad positiva (C-1).",
      { entryQty },
    );
  }

  const onHandFloor = Math.max(currentOnHand, 0);
  const newOnHand = onHandFloor + entryQty; // strictly > 0, see doc comment above.

  return (onHandFloor * currentWac + entryQty * entryUnitCost) / newOnHand;
}

/**
 * C-2: `unit_cost = line_total / qty`. `lineTotal` is centavos (integer) for the WHOLE purchase
 * line; `qty` is milli-units (integer). Result is centavos-per-milli-unit — a float, matching
 * `items.wac` / `stock_movements.unit_cost`'s convention. Deliberately NOT rounded: this is a
 * cached/derived REAL value (Doc 04 §2), not a final money amount (INV-6's "rounded half-up at
 * the final step only" applies when this value is later multiplied by a qty to produce a money
 * total, e.g. core/inventory's `total_cost`, not here).
 */
export function computePurchaseLineUnitCost(lineTotal: number, qty: number): number {
  assertSafeIntegerInput(lineTotal, "lineTotal");
  assertSafeIntegerInput(qty, "qty");
  if (lineTotal < 0) {
    throw validationError("El total de la línea de compra no puede ser negativo.", { lineTotal });
  }
  if (qty <= 0) {
    throw validationError("La cantidad de la línea de compra debe ser positiva.", { qty });
  }
  return lineTotal / qty;
}

/**
 * Centralizes "unit-cost snapshotting for exits/sales" (KOK-013 task description): every future
 * exit-valuing service (sales, production consumption, stock exits, inventory-count ADJUST lines)
 * must call this ONE function to snapshot the item's current WAC onto its own
 * `*_unit_cost_snapshot` column, rather than reading `items.wac` ad hoc in each service. Presently
 * trivial (identity + validation) by design — C-6 says exits value AT current WAC, full stop — but
 * having a single named call site means a future costing nuance only needs to change here.
 */
export function snapshotUnitCost(currentWac: number): number {
  assertFiniteNonNegative(currentWac, "currentWac");
  return currentWac;
}

/** One kardex row's shape needed to replay WAC (R-2). Deliberately minimal — see the precondition
 * note on `recomputeWacFromMovements` below for why no timestamp field is included. */
export interface ReplayMovement {
  type: StockMovementType;
  /** Signed milli-units (Doc 04 §3.4), same sign convention as `stock_movements.qty`. */
  qty: number;
  /** Centavos per milli-unit (Doc 04 §3.4), same convention as `stock_movements.unit_cost`. */
  unitCost: number;
}

/** Movement types that trigger a C-1 WAC update on replay — see the ADJUST-vs-entry reasoning in
 * this file's header comment. PRODUCTION_OUT/SALE_OUT/EXIT_OUT/ADJUST never appear here. */
const WAC_ENTRY_TYPES: ReadonlySet<StockMovementType> = new Set(["PURCHASE_IN", "PRODUCTION_IN"]);

/**
 * R-2's full-kardex WAC recompute: replays one item's ENTIRE chronological movement history from
 * `onHand = 0, wac = 0` and returns the final `wac`.
 *
 * PRECONDITION (caller's responsibility, not checked here): `movements` MUST already be sorted in
 * chronological order (the order the events actually happened in the kardex — see repair.ts's
 * `occurredAt` then `createdAt` tiebreak). This function's input shape deliberately omits any
 * timestamp field to keep it minimal and directly reusable from a raw `stock_movements` row
 * (`{ type, qty, unitCost }` needs no mapping) — since there is no timestamp to sort by, this
 * function does NOT attempt to re-sort its input; doing so silently on unsorted input would hide a
 * caller bug instead of producing an obviously-wrong (but at least deterministic and debuggable)
 * WAC.
 *
 * For PURCHASE_IN/PRODUCTION_IN, applies C-1 via `applyWacEntry` using the running `onHand`
 * balance BEFORE this movement. For every other type (PRODUCTION_OUT/SALE_OUT/EXIT_OUT/ADJUST),
 * `wac` is carried forward unchanged (C-6) and only `onHand` accumulates. `onHand` always
 * accumulates every movement's signed qty, entries and exits alike — C-1's `max(on_hand,0)` needs
 * the true running balance at each step, not just the entries' running total.
 */
export function recomputeWacFromMovements(movements: readonly ReplayMovement[]): number {
  return replayWacFrom(ZERO_WAC_STATE, movements).wac;
}

/**
 * The complete running state a WAC replay carries between movements: the on-hand balance
 * (milli-unit integer, may be negative per INV-8) and the weighted-average cost (centavos per
 * milli-unit, float — same convention as `items.wac`). This is deliberately the WHOLE state, which
 * is what makes a replay resumable: `replayWacFrom(replayWacFrom(seed, a).final, b)` is identical
 * to `replayWacFrom(seed, [...a, ...b])` (pinned by a property test in costing.test.ts).
 */
export interface WacState {
  onHand: number;
  wac: number;
}

const ZERO_WAC_STATE: WacState = { onHand: 0, wac: 0 };

/** Per-movement WAC snapshot produced by `replayWacWithTrace`. `steps[i]` describes
 * `movements[i]`: the state immediately BEFORE that movement was applied and immediately AFTER.
 *
 * R-4's `cost_delta` is computed from `wacBefore`: for a SALE_OUT/EXIT_OUT movement, the frozen
 * `unit_cost_snapshot` written at event time is compared against the WAC the replay says was in
 * effect at that point in the kardex. (For exits the two WAC fields are equal — C-6 carries WAC
 * forward across exits — but both are exposed so the caller never has to know which type it is
 * holding, and so an entry's before/after are both available for debugging a drift report.)
 */
export interface WacTraceStep {
  wacBefore: number;
  wacAfter: number;
  onHandBefore: number;
  onHandAfter: number;
}

/**
 * Resume-from-a-point version of `recomputeWacFromMovements` (R-2/R-4): replays `movements`
 * starting from an ARBITRARY `seed` state instead of always from `onHand = 0, wac = 0`, and
 * returns the final state rather than just the final `wac`.
 *
 * This is what lets a correction replay only the kardex TAIL after the edited event: the caller
 * reads the last known-good `{ on_hand, wac }` at the cut point and feeds it in here, instead of
 * re-reading and re-replaying an item's entire history.
 *
 * Same PRECONDITION as `recomputeWacFromMovements`: `movements` MUST already be sorted
 * chronologically (see that function's note on why this is not checked here), and must all fall
 * AFTER the point `seed` describes. Same C-1/C-6 semantics: only `WAC_ENTRY_TYPES`
 * (PURCHASE_IN/PRODUCTION_IN) run the C-1 formula via `applyWacEntry`; every other type carries
 * `wac` forward untouched and only moves `onHand`.
 */
export function replayWacFrom(seed: WacState, movements: readonly ReplayMovement[]): WacState {
  return runReplay(seed, movements);
}

/**
 * `replayWacFrom` plus the per-movement trace (see `WacTraceStep`). `steps` is index-aligned with
 * `movements` — `steps.length === movements.length` — because R-4 needs the WAC as of each
 * INDIVIDUAL movement, not just the end state.
 */
export function replayWacWithTrace(
  seed: WacState,
  movements: readonly ReplayMovement[],
): { final: WacState; steps: WacTraceStep[] } {
  const steps: WacTraceStep[] = [];
  const final = runReplay(seed, movements, steps);
  return { final, steps };
}

/** Shared replay loop behind `replayWacFrom` / `replayWacWithTrace` / `recomputeWacFromMovements`
 * — one implementation so the three can never drift apart. Collecting the trace is opt-in (pass
 * `steps`) so the untraced callers allocate nothing per movement. */
function runReplay(
  seed: WacState,
  movements: readonly ReplayMovement[],
  steps?: WacTraceStep[],
): WacState {
  assertSafeIntegerInput(seed.onHand, "seed.onHand");
  assertFiniteNonNegative(seed.wac, "seed.wac");

  let onHand = seed.onHand;
  let wac = seed.wac;

  for (const movement of movements) {
    assertSafeIntegerInput(movement.qty, "qty");
    if (movement.qty === 0) {
      // Defensive: core/inventory (movements.ts) already rejects zero-qty movements at write
      // time, so this should be unreachable against real data — but a replay input built by hand
      // (e.g. a test fixture or a future caller) could violate that, and silently no-op-ing a
      // zero-qty "entry" would be worse than failing loudly.
      throw validationError("Un movimiento de stock no puede tener cantidad cero.", { movement });
    }

    const onHandBefore = onHand;
    const wacBefore = wac;

    if (WAC_ENTRY_TYPES.has(movement.type)) {
      wac = applyWacEntry(wac, onHand, movement.qty, movement.unitCost);
    }
    onHand += movement.qty;

    steps?.push({ wacBefore, wacAfter: wac, onHandBefore, onHandAfter: onHand });
  }

  return { onHand, wac };
}
