// core/inventory — the single movement-writer used by every event service (KOK-012).
// Doc 03 §1-2 (kardex derivation), Doc 04 §3.4 (stock_movements / item_stock DDL),
// INV-1, INV-5, INV-8, INV-9. Correction policy: Doc 03 §7 (R-1).
//
// ARCHITECTURAL CONSTRAINT: this module is a BUILDING BLOCK, not a top-level command (unlike
// core/catalog, whose functions DO call db.batch() themselves because catalog commands ARE
// top-level). It never calls db.batch(). Every future event service (purchases KOK-016,
// production KOK-026, sales KOK-030, exits KOK-018, counts KOK-019) composes ONE atomic
// db.batch() per command (D-3) containing: its own event-table insert(s) + the statements this
// module builds + (later) financial-transaction statements + an audit_log insert
// (core/audit.ts's buildAuditLogInsert). This module follows the exact same "build, don't
// execute" shape as buildAuditLogInsert — it only builds Drizzle statement objects and returns
// them for the caller to push into its own array.

import type { StockMovementType } from "@kokoro/shared";
import { generateUuidV7, nowIso, roundHalfUpToInt } from "@kokoro/shared";
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { itemStock, stockMovements } from "../../db/schema.js";
import { validationError } from "../errors.js";
import type { StockMovementInput } from "./types.js";

type Statement = BatchItem<"sqlite">;

/**
 * Canonical direction per movement type (Doc 03 §1-2). PURCHASE_IN/PRODUCTION_IN are always
 * entries (qty > 0); PRODUCTION_OUT/SALE_OUT/EXIT_OUT are always exits (qty < 0); ADJUST
 * (inventory-count variance) may be either sign but never zero — Doc 10's KOK-019 note says
 * "zero-variance lines produce no movement", so a zero-qty movement reaching this module is a
 * caller bug and is rejected defensively, never silently dropped (INV-1/INV-9 correctness
 * depends on this being enforced centrally here, not trusted per-caller).
 */
const MOVEMENT_DIRECTION: Record<StockMovementType, "IN" | "OUT" | "EITHER"> = {
  PURCHASE_IN: "IN",
  PRODUCTION_IN: "IN",
  PRODUCTION_OUT: "OUT",
  SALE_OUT: "OUT",
  EXIT_OUT: "OUT",
  ADJUST: "EITHER",
};

// Mirrors packages/shared/src/numeric.ts's assertSafeInteger pattern. That module is deliberately
// NOT part of @kokoro/shared's public barrel (packages/shared/package.json only exports ".") — it
// is money.ts/qty.ts's own private trusted-boundary helper. core/inventory is a *different*
// trusted boundary (D-5: the kardex is where qty/cost integers are finally persisted), so it
// keeps its own copy of the same check rather than reaching past the package's export map. Throws
// a DomainError (not RangeError) because this module's callers are core/ services and routes,
// which expect caller mistakes surfaced as a VALIDATION DomainError, not an uncaught exception.
function assertSafeIntegerInput(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationError(`${label} debe ser un entero seguro.`, { [label]: value });
  }
}

function assertValidMovementQty(type: StockMovementType, qty: number): void {
  assertSafeIntegerInput(qty, "qty");
  if (qty === 0) {
    throw validationError("La cantidad de un movimiento de stock no puede ser cero.", {
      type,
      qty,
    });
  }
  const direction = MOVEMENT_DIRECTION[type];
  if (direction === "IN" && qty < 0) {
    throw validationError(
      `Los movimientos de tipo ${type} deben tener cantidad positiva (entrada de stock).`,
      { type, qty },
    );
  }
  if (direction === "OUT" && qty > 0) {
    throw validationError(
      `Los movimientos de tipo ${type} deben tener cantidad negativa (salida de stock).`,
      { type, qty },
    );
  }
}

function assertValidUnitCost(unitCost: number): void {
  if (typeof unitCost !== "number" || !Number.isFinite(unitCost) || unitCost < 0) {
    throw validationError("El costo unitario debe ser un número finito no negativo.", {
      unitCost,
    });
  }
}

/**
 * Builds (does not execute) the `stock_movements` INSERT for one movement, enforcing the sign
 * convention (Doc 03 §1-2) and computing `total_cost` internally so it can never drift from
 * `qty × unit_cost` — callers do not supply `total_cost`.
 *
 * Per Doc 04 §3.4's column comments, `unit_cost` is "centavos per milli-unit at movement time"
 * and `total_cost` is "centavos, signed (qty × unit_cost rounded)": this is a DIRECT multiply of
 * signed milli-units by centavos-per-milli-unit, then round half-up. This is deliberately NOT
 * `mulMoneyByQty` from packages/shared/money.ts — that helper assumes a price quoted per WHOLE
 * unit and divides by 1000 internally, which would be off by a factor of 1000 for this column.
 */
function buildMovementInsert(input: StockMovementInput, createdAt: string, db: Db): Statement {
  assertValidMovementQty(input.type, input.qty);
  assertValidUnitCost(input.unitCost);

  const totalCost = roundHalfUpToInt(input.qty * input.unitCost);
  assertSafeIntegerInput(totalCost, "totalCost");

  return db.insert(stockMovements).values({
    id: generateUuidV7(),
    occurredAt: input.occurredAt,
    businessDate: input.businessDate,
    itemId: input.itemId,
    type: input.type,
    qty: input.qty,
    unitCost: input.unitCost,
    totalCost,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId,
    createdAt,
  });
}

/**
 * Builds (does not execute) the single `item_stock` upsert for one item: nets `delta` signed
 * milli-units into `qty_on_hand` and sets/clears `negative_since` (INV-8), all in one statement.
 *
 * Implementation: a single `INSERT ... ON CONFLICT(item_id) DO UPDATE` whose SET-clause
 * expressions reference the table's OWN column (`item_stock.qty_on_hand`, `item_stock.negative_
 * since`) alongside `excluded.qty_on_hand` (the row proposed for insertion — i.e. `delta`, NOT an
 * absolute new balance). SQLite (and D1/better-sqlite3, which share the same upstream SQLite
 * engine) evaluate every SET-clause expression against the pre-update row: `excluded.*` is fixed
 * for the whole statement and `item_stock.qty_on_hand` inside the CASE always resolves to the OLD
 * balance, even while the same statement's own `qtyOnHand` SET-clause is computing a new one —
 * there is no "left-to-right sequential" mutation visible mid-statement. This is exercised
 * directly in inventory.test.ts with a case (the negative_since transition) that would compute
 * the wrong result under a sequential-evaluation model, so the assumption is verified against the
 * real D1 SQLite engine, not just asserted here.
 *
 * `negative_since` transition rule, expressed against OLD balance `b0 = item_stock.qty_on_hand`
 * and NEW balance `b1 = b0 + excluded.qty_on_hand`:
 *   - `b0 >= 0 AND b1 < 0` → crossing into negative → set to `now`.
 *   - `b1 >= 0` → crossing back to (or staying at) non-negative → clear to NULL.
 *   - otherwise (`b0 < 0 AND b1 < 0`, still negative) → leave `item_stock.negative_since`
 *     untouched (do not reset the original flagged timestamp).
 * INV-8 is explicit that stock MAY go negative: this function never rejects a negative result,
 * it only flags it.
 */
function buildItemStockUpsert(itemId: string, delta: number, now: string, db: Db): Statement {
  assertSafeIntegerInput(delta, "delta");

  return db
    .insert(itemStock)
    .values({
      itemId,
      qtyOnHand: delta,
      negativeSince: delta < 0 ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: itemStock.itemId,
      set: {
        qtyOnHand: sql`${itemStock.qtyOnHand} + excluded.qty_on_hand`,
        negativeSince: sql`CASE
          WHEN (${itemStock.qtyOnHand} + excluded.qty_on_hand) < 0 AND ${itemStock.qtyOnHand} >= 0 THEN ${now}
          WHEN (${itemStock.qtyOnHand} + excluded.qty_on_hand) >= 0 THEN NULL
          ELSE ${itemStock.negativeSince}
        END`,
        updatedAt: now,
      },
    });
}

function netDeltasByItem(movements: readonly StockMovementInput[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const movement of movements) {
    net.set(movement.itemId, (net.get(movement.itemId) ?? 0) + movement.qty);
  }
  return net;
}

/**
 * Builds (does not execute) statements for one or more NEW stock movements, possibly spanning
 * several items (e.g. a purchase's several line items, or a production run's several consumption
 * lines): one INSERT per movement row, plus exactly ONE `item_stock` upsert per distinct item
 * touched, netting all movements for that item within this call. Include the returned statements
 * in the caller's own `db.batch()` alongside its event-table insert(s), financial-transaction
 * statements (if any), and its audit_log row (D-3) — this module never batches on its own.
 */
export function buildStockMovementStatements(
  db: Db,
  movements: StockMovementInput[],
): { statements: Statement[] } {
  if (movements.length === 0) {
    throw validationError("Se requiere al menos un movimiento de stock.", {});
  }

  const now = nowIso();
  const statements: Statement[] = movements.map((movement) =>
    buildMovementInsert(movement, now, db),
  );

  for (const [itemId, delta] of netDeltasByItem(movements)) {
    statements.push(buildItemStockUpsert(itemId, delta, now, db));
  }

  return { statements };
}

/**
 * The idempotent regeneration primitive for R-1/INV-9/INV-10 (a later backlog item, e.g. KOK-024,
 * will call this when an event is edited — or deleted, with `newMovements = []` — so its derived
 * kardex rows are regenerated atomically alongside the event's own update/soft-delete).
 *
 * Reads the existing `stock_movements` for `(sourceEventType, sourceEventId)` via a plain SELECT
 * (atomicity only applies to the WRITE statements returned here, per the same "build, don't
 * execute" contract as the rest of this module), then builds:
 *   - one DELETE removing all of those rows (hard-deleting system-owned derived rows here is the
 *     case D-8 explicitly carves out: "hard DELETE is reserved for derived rows regeneration
 *     inside services").
 *   - one INSERT per row of `newMovements`.
 *   - exactly ONE `item_stock` upsert per item touched by EITHER the old or the new movement set,
 *     netting the old movements' reversal (subtracted) and the new movements' effect (added) into
 *     a single delta per item — never two separate upserts for the same item. An item present in
 *     the old set but absent from `newMovements` nets to exactly `-oldQty`, i.e. its stock effect
 *     is fully reversed.
 *
 * Idempotent: calling this twice in a row with the same `newMovements` leaves `item_stock` (and
 * the *set* of movement rows for this source — same values, though the row ids/timestamps are
 * regenerated) in the same final state both times. The second call finds the first call's rows as
 * "existing", reverses them, and re-adds the same values, netting to a zero delta per item.
 */
export async function buildReplaceMovementsForSourceStatements(
  db: Db,
  sourceEventType: string,
  sourceEventId: string,
  newMovements: StockMovementInput[],
): Promise<{ statements: Statement[] }> {
  for (const movement of newMovements) {
    if (movement.sourceEventType !== sourceEventType || movement.sourceEventId !== sourceEventId) {
      // Defensive: every movement passed to a *regeneration* for a given source must agree with
      // that source, otherwise the netting below (keyed only on itemId) would silently mix
      // deltas that belong to a different event.
      throw validationError(
        "Todos los movimientos nuevos deben pertenecer al mismo evento origen que se está regenerando.",
        { sourceEventType, sourceEventId, movement },
      );
    }
  }

  const existingRows = await db.query.stockMovements.findMany({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.sourceEventType, sourceEventType), eqOp(t.sourceEventId, sourceEventId)),
  });

  const now = nowIso();
  const statements: Statement[] = [
    // Unconditional: a no-op DELETE (zero rows matched) is harmless and keeps this function's
    // shape identical whether or not a prior generation exists — important for idempotency on
    // the very first call, where existingRows is legitimately empty.
    db
      .delete(stockMovements)
      .where(
        and(
          eq(stockMovements.sourceEventType, sourceEventType),
          eq(stockMovements.sourceEventId, sourceEventId),
        ),
      ),
    ...newMovements.map((movement) => buildMovementInsert(movement, now, db)),
  ];

  const net = new Map<string, number>();
  for (const row of existingRows) {
    net.set(row.itemId, (net.get(row.itemId) ?? 0) - row.qty);
  }
  for (const movement of newMovements) {
    net.set(movement.itemId, (net.get(movement.itemId) ?? 0) + movement.qty);
  }
  for (const [itemId, delta] of net) {
    statements.push(buildItemStockUpsert(itemId, delta, now, db));
  }

  return { statements };
}
