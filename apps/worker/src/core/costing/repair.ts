// core/costing — the DB-touching half of KOK-013: reading the live WAC (`getCurrentWac`, the
// integration point future exit-valuing services use to obtain the value to pass through
// `snapshotUnitCost`) and detecting nightly WAC drift (`detectWacDrift`).
//
// KOK-024 / ADR-016 DEMOTED THIS FROM REPAIR TO DETECTION. Before KOK-024, this was the ONLY
// mechanism that ever corrected `items.wac` — ADR-009's "nightly-only, O(1) edits" framing — so
// it silently overwrote the column and left a `costing_repair` audit row as its only record.
// KOK-024's synchronous replay (INV-11, `core/costing/replay.ts`) now corrects WAC drift
// immediately, inside the triggering command's own batch, and does it R-4/R-5-correctly: it never
// rewrites an already-frozen `unit_cost_snapshot` and it asks for confirmation before moving
// already-booked cost. A blind nightly overwrite of `items.wac` does neither of those — it would
// silently reintroduce exactly the history-rewriting risk R-4 exists to prevent, the day some
// caller's replay has a bug or a direct DB fix bypasses services entirely. So this function no
// longer builds a repair; it only detects and reports drift, exactly like
// `core/inventory/queries.ts`'s `getStockConsistencyMismatches` and `core/finance/accounts.ts`'s
// `getBalanceConsistencyMismatches` already do for their own consistency checks — a human
// investigates, this doesn't guess which side is right.

import type { Db } from "../../db/index.js";
import { notFound } from "../errors.js";
import { recomputeWacFromMovements } from "./wac.js";

/** R-2: "if drift > 1% it's worth a human's attention". */
const DRIFT_THRESHOLD_RATIO = 0.01;
/** Denominator floor for the drift ratio when `current` is 0, so `0/0` (no drift) doesn't divide
 * by zero, while any nonzero `recomputed` against a `current` of 0 still reads as ~infinite drift
 * (comfortably over the 1% threshold) rather than as a NaN. */
const DRIFT_EPSILON = 1e-9;

/**
 * Fetches the live `items.wac` for `itemId` (centavos per milli-unit). This is the actual
 * integration point future services (purchases, production, sales, exits, counts) use to obtain
 * the value to pass through `snapshotUnitCost` onto their own `*_unit_cost_snapshot` column.
 */
export async function getCurrentWac(db: Db, itemId: string): Promise<number> {
  const row = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, itemId),
  });
  if (!row) {
    throw notFound("No se encontró el ítem.", { id: itemId });
  }
  return row.wac;
}

/** One item's detected WAC drift: the currently-stored value, what the full kardex replay says it
 * should be, and the relative drift ratio between them. */
export interface WacDrift {
  itemId: string;
  current: number;
  recomputed: number;
  driftRatio: number;
}

/**
 * The nightly backstop's per-item WAC check (R-2, INV-5): recomputes WAC from the FULL kardex
 * (`recomputeWacFromMovements`) and compares it against the currently-stored `items.wac`.
 * DETECTION ONLY — returns the drift for a human to see when the relative difference exceeds 1%,
 * and never builds or executes a write. `items.wac` is now corrected exclusively by the
 * synchronous replay (`core/costing/replay.ts`, INV-11); if this function ever finds real drift,
 * that means the synchronous path missed something (a bug, or a direct DB fix bypassing services)
 * and the fix belongs to a human investigating it, not to this job silently applying one. Returns
 * `null` when drift is within tolerance, meaning "nothing to report for this item."
 *
 * Movements are read ordered by `occurredAt` then `createdAt` as a stable tiebreak (two movements
 * can share the same `occurred_at` instant, e.g. two purchase lines on the same invoice; ordering
 * by insertion order in that case reproduces the order they were actually written to the kardex).
 * Out of scope: this function never touches `items.replacement_cost` /
 * `replacement_cost_updated_at` (C-3 is KOK-029, not this task).
 */
export async function detectWacDrift(db: Db, itemId: string): Promise<WacDrift | null> {
  const itemRow = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, itemId),
  });
  if (!itemRow) {
    throw notFound("No se encontró el ítem.", { id: itemId });
  }
  const current = itemRow.wac;

  const movementRows = await db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
  });

  const recomputed = recomputeWacFromMovements(
    movementRows.map((row) => ({ type: row.type, qty: row.qty, unitCost: row.unitCost })),
  );

  const driftDenominator = Math.max(Math.abs(current), DRIFT_EPSILON);
  const driftRatio = Math.abs(recomputed - current) / driftDenominator;
  if (driftRatio <= DRIFT_THRESHOLD_RATIO) {
    return null;
  }

  return { itemId, current, recomputed, driftRatio };
}
