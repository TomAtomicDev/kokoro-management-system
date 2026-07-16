// core/costing — the DB-touching half of KOK-013: reading the live WAC (`getCurrentWac`, the
// integration point future exit-valuing services use to obtain the value to pass through
// `snapshotUnitCost`) and building the nightly R-2 repair (`buildWacRepairIfDrifted`).
//
// ARCHITECTURAL CONSTRAINT (same rule as core/inventory and core/audit's buildAuditLogInsert —
// "build, don't execute"): `buildWacRepairIfDrifted` never calls `db.batch()`. It only READS
// (the item row + its full movement history) and BUILDS statement objects for a future top-level
// job handler (KOK-021, not built by this task) to include in ITS OWN batch, possibly across many
// items in one nightly run.

import { nowIso } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { items } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { notFound } from "../errors.js";
import { recomputeWacFromMovements } from "./wac.js";

type Statement = BatchItem<"sqlite">;

/** R-2: "if drift > 1% it repairs it". */
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

/**
 * R-2's nightly consistency check for one item: recomputes WAC from the FULL kardex
 * (`recomputeWacFromMovements`) and compares it against the currently-stored `items.wac`. If the
 * relative drift exceeds 1%, RETURNS (does not execute) the repair statements — an `items.wac`
 * UPDATE plus a `costing_repair` audit_log row (Doc 04 §3.5's action enum). Returns `null` when
 * drift is within tolerance, meaning "no-op, nothing to include in this item's slot of the
 * nightly batch."
 *
 * Movements are read ordered by `occurredAt` then `createdAt` as a stable tiebreak (two movements
 * can share the same `occurred_at` instant, e.g. two purchase lines on the same invoice; ordering
 * by insertion order in that case reproduces the order they were actually written to the kardex).
 * Out of scope: this function never touches `items.replacement_cost` /
 * `replacement_cost_updated_at` (C-3 is KOK-029, not this task).
 */
export async function buildWacRepairIfDrifted(
  db: Db,
  itemId: string,
): Promise<{ statements: Statement[] } | null> {
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

  const now = nowIso();
  const statements: Statement[] = [
    db.update(items).set({ wac: recomputed, updatedAt: now }).where(eq(items.id, itemId)),
    buildAuditLogInsert(db, {
      actor: "SYSTEM",
      action: "costing_repair",
      entityType: "items",
      entityId: itemId,
      before: { wac: current },
      after: { wac: recomputed },
    }),
  ];

  return { statements };
}
