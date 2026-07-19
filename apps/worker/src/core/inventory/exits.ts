// core/inventory/exits — UC-09 "Record non-commercial exit" (KOK-018, Doc 03 §3, Doc 04 §3.3
// `stock_exits`). Same TEMPLATE shape as core/purchasing/index.ts (see that module's header): a
// top-level command entry point, not a building block — it does its own defensive validation,
// builds every row itself, and executes exactly ONE atomic `db.batch()` (D-3). Much simpler than
// purchasing though: one item, one line, no financial side, no WAC mutation.
//
// C-6 "invisible cost" (Doc 03 §3, the single most important rule in this file): an exit is
// VALUED at the item's CURRENT WAC (via core/costing's `getCurrentWac` + `snapshotUnitCost`) but
// NEVER changes that WAC (`applyWacEntry` is only for genuine entries — PURCHASE_IN/
// PRODUCTION_IN — per core/costing/wac.ts's `WAC_ENTRY_TYPES` header comment) and NEVER creates a
// `financial_transactions` row. The cost was already paid when the item was purchased; the exit
// just makes that sunk cost visible in reporting (`v_waste`, see waste.ts) — it doesn't touch
// cash again. Do NOT add a financial_transactions insert here, an account balance delta, or an
// `items.wac` update: that would be a bug (double-counting the cost / silently corrupting WAC),
// not a missing feature. This omission is intentional and pinned by test/exits.test.ts.
//
// ONE carve-out, added in KOK-024 and NOT a weakening of the above: when this exit is BACKDATED,
// the batch may carry `items.wac` UPDATEs produced by `planCostingReplay`. Those correct the WAC of
// entries recorded AFTER the point the exit lands (a backdated exit changes `on_hand`, and
// `on_hand` is C-1's weight) — they are never a WAC for this exit, and they are never emitted by
// this file. C-6 is intact: on the same-day path the plan is empty and not one of these exists.
//
// `unit_cost_snapshot` ON EDIT (KOK-024 Phase E) — the one policy call this file makes, stated here
// because the KB does not rule on it directly. R-4 protects a frozen snapshot from being rewritten
// by a REPLAY: a day already reported must keep reporting the margin it reported. It says nothing
// about the owner deliberately opening this very exit and correcting it. `updateStockExit` therefore
// splits the two cases:
//   - qty / reason / notes / date / session changed, SAME item → KEEP the original snapshot. The
//     snapshot is this exit's frozen valuation of that item; nothing about correcting "8 kg, not
//     5 kg" makes the price the flour was carried at that day wrong, and re-snapshotting would
//     silently re-value a past day at today's WAC — R-4's spirit, arriving through the edit door.
//   - `item_id` changed → RE-SNAPSHOT at the new item's current WAC. The old snapshot was a price
//     per milli-unit OF A DIFFERENT ITEM; carrying it over would value sugar at the WAC of flour,
//     which is not a preserved history, just a wrong number. There is no correct old snapshot to
//     preserve here, so C-6's ordinary rule (value at the item's current WAC) applies afresh.
// Either way this stays a VALUATION read (`getCurrentWac` + `snapshotUnitCost`) and never an
// `applyWacEntry`: an edited exit still books no WAC and still writes no financial transaction.

import type {
  AuditActor,
  DeleteStockExitCommand,
  DeleteStockExitResult,
  ListStockExitsFilters,
  ListStockExitsResult,
  RecordStockExitCommand,
  RecordStockExitResult,
  StockExitDto,
  UpdateStockExitCommand,
  UpdateStockExitResult,
} from "@kokoro/shared";
import { generateUuidV7, nowIso, REPLAY_CONFIRMATION_REQUIRED } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { stockExits } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { getCurrentWac } from "../costing/repair.js";
import { planCostingReplay } from "../costing/replay.js";
import { snapshotUnitCost } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
import {
  buildReplaceMovementsForSourceStatements,
  buildStockMovementStatements,
} from "./movements.js";
import type { StockMovementInput } from "./types.js";

type Statement = BatchItem<"sqlite">;
type StockExitRow = typeof stockExits.$inferSelect;

function toStockExitDto(row: StockExitRow): StockExitDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    businessDate: row.businessDate,
    itemId: row.itemId,
    qty: row.qty,
    reason: row.reason,
    unitCostSnapshot: row.unitCostSnapshot,
    sessionId: row.sessionId,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * UC-09: record one non-commercial stock exit in one atomic batch (D-3): the `stock_exits`
 * insert + the single EXIT_OUT `stock_movements` insert + `item_stock` upsert (both from
 * core/inventory's `buildStockMovementStatements`) + the `audit_log` row. See this module's
 * header for why there is deliberately no financial_transactions row, no account balance delta,
 * and no `items.wac` update (C-6).
 *
 * Does NOT restrict exits to active items only: core/purchasing's `recordPurchase` looks up its
 * item(s) via a plain `db.query.items.findFirst` with no `isActive` check, and Doc 03 does not
 * call for restricting non-commercial exits to active items either — an owner should still be
 * able to record e.g. spoilage for an item they just deactivated. Mirrors that precedent rather
 * than inventing a new restriction here.
 */
export async function recordExit(
  db: Db,
  command: RecordStockExitCommand,
  actor: AuditActor,
): Promise<RecordStockExitResult> {
  // Defensive re-check (core/ services never trust a caller already ran Zod, D-2) — mirrors
  // recordStockExitCommandSchema's `.positive()` on `qty`.
  if (!Number.isInteger(command.qty) || command.qty <= 0) {
    throw validationError("La cantidad de la salida debe ser un entero positivo.", {
      qty: command.qty,
    });
  }

  const itemRow = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.itemId),
  });
  if (!itemRow) {
    throw notFound("No se encontró el ítem.", { id: command.itemId });
  }

  // C-6: value at the item's CURRENT WAC, snapshotted onto this exit's own unit_cost_snapshot —
  // never recomputed via applyWacEntry (that's only for PURCHASE_IN/PRODUCTION_IN entries).
  const currentWac = await getCurrentWac(db, command.itemId);
  const unitCostSnapshot = snapshotUnitCost(currentWac);

  const exitId = generateUuidV7();
  const now = nowIso();

  const movement: StockMovementInput = {
    itemId: command.itemId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    type: "EXIT_OUT",
    // stock_exits.qty is stored POSITIVE (its own CHECK constraint); the kardex sign convention
    // (EXIT_OUT is always an OUT movement) is applied only here, at the movements boundary.
    qty: -command.qty,
    unitCost: unitCostSnapshot,
    sourceEventType: "stock_exit",
    sourceEventId: exitId,
  };
  // ---- INV-11 / R-2 ordering guard (ADR-016 §1) --------------------------------------------
  // C-6 says an exit is not a WAC entry, and that stays true here: this exit books NO WAC of its
  // own and the plan can never attribute one to it. What a BACKDATED exit does change is
  // `on_hand` at the point it lands — and `on_hand` is the weight in C-1's
  // `(max(on_hand,0)·wac + q·c) / (max(on_hand,0) + q)`. Every entry recorded after it therefore
  // re-averages against a different weight, which can move the WAC that later sales/exits already
  // froze a snapshot from. That downstream correction is what the plan carries; it is not this
  // exit costing something.
  const plan = await planCostingReplay(db, {
    trigger: {
      eventType: "stock_exit",
      eventId: exitId,
      businessDate: command.businessDate,
      occurredAt: command.occurredAt,
    },
    changes: [{ sourceEventType: "stock_exit", sourceEventId: exitId, newMovements: [movement] }],
    actor,
  });

  // R-5, identical contract to core/purchasing's (CONFLICT/409 + `details.reason`) — thrown before
  // `db.batch`, so a refused exit writes nothing.
  if (plan.confirmationRequired && command.confirm !== true) {
    throw conflict(
      "Esta salida tiene fecha anterior a movimientos ya registrados y cambia costos ya calculados. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: plan.impact },
    );
  }

  const { statements: movementStatements } = buildStockMovementStatements(db, [movement]);

  const exitRow = {
    id: exitId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    itemId: command.itemId,
    qty: command.qty,
    reason: command.reason,
    unitCostSnapshot,
    sessionId: command.sessionId ?? null,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const statements: Statement[] = [
    db.insert(stockExits).values(exitRow),
    ...movementStatements,
    // Intentionally NO financial_transactions insert, NO buildAccountBalanceDelta, NO items.wac
    // update — see this module's header (C-6, "invisible cost").
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "stock_exits",
      entityId: exitId,
      before: null,
      after: exitRow,
    }),
    // R-2: the downstream WAC correction a BACKDATED exit forces lands in THIS batch (D-3), and
    // LAST — specifically after `movementStatements`, per replay.ts's module header, because the
    // `item_stock` upsert there recomputes `negative_since` incrementally while the plan's is the
    // authoritative recomputation and must win. Empty on the ordinary same-day capture. Note these
    // are `items.wac` corrections for LATER entries, never a WAC for this exit (C-6 still holds).
    ...plan.statements,
  ];

  // `statements` always starts with the fixed stock_exits insert above, so it is never empty —
  // same cast technique as core/purchasing/index.ts's recordPurchase, for the same reason.
  await db.batch(statements as [Statement, ...Statement[]]);

  return { exit: toStockExitDto(exitRow) };
}

/**
 * Loads the live (non-soft-deleted) `stock_exits` row an edit/delete targets, or throws NOT_FOUND.
 *
 * An ALREADY soft-deleted exit is deliberately indistinguishable from a missing one here (D-8/R-3):
 * its derived kardex rows are already gone, so a second delete would net a zero-delta reversal of
 * nothing, and an "edit" would resurrect an event the owner retired without ever saying so. R-3's
 * 90-day reversal is a separate, explicit undo — not a side effect of PUT.
 */
async function loadLiveExit(db: Db, id: string): Promise<StockExitRow> {
  const row = await db.query.stockExits.findFirst({
    where: (t, { and, eq: eqOp, isNull }) => and(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la salida de stock.", { id });
  }
  return row;
}

/**
 * R-1: edit one stock exit and regenerate everything derived from it, in ONE atomic batch (D-3):
 * the `stock_exits` UPDATE + the full replacement of its `stock_movements` (and the netted
 * `item_stock` delta) via `buildReplaceMovementsForSourceStatements` + the `audit_log` row carrying
 * the complete before/after + whatever `planCostingReplay` requires when the edit is BACKDATED.
 *
 * Full-replacement semantics, matching `updateStockExitCommandSchema`'s contract: the command is
 * the post-state of the event, not a patch.
 *
 * NO financial side, exactly as on the create path — C-6 means an exit books no
 * `financial_transactions` row, so editing one has no transaction to regenerate either (contrast
 * core/purchasing, which must regenerate its payment). See this module's header, including the
 * `unit_cost_snapshot` policy this function implements.
 */
export async function updateStockExit(
  db: Db,
  id: string,
  command: UpdateStockExitCommand,
  actor: AuditActor,
): Promise<UpdateStockExitResult> {
  // Defensive re-check (D-2), same as recordExit's.
  if (!Number.isInteger(command.qty) || command.qty <= 0) {
    throw validationError("La cantidad de la salida debe ser un entero positivo.", {
      qty: command.qty,
    });
  }

  const current = await loadLiveExit(db, id);

  const itemRow = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.itemId),
  });
  if (!itemRow) {
    throw notFound("No se encontró el ítem.", { id: command.itemId });
  }

  // The policy documented in this module's header: the frozen snapshot survives an edit of the
  // SAME item, and is taken afresh only when the edit points this exit at a DIFFERENT item, whose
  // WAC the old snapshot says nothing about.
  const itemChanged = command.itemId !== current.itemId;
  const unitCostSnapshot = itemChanged
    ? snapshotUnitCost(await getCurrentWac(db, command.itemId))
    : current.unitCostSnapshot;

  const now = nowIso();

  const movement: StockMovementInput = {
    itemId: command.itemId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    type: "EXIT_OUT",
    // Positive on the event row, negative in the kardex — the sign convention is applied only at
    // this boundary, identically to recordExit.
    qty: -command.qty,
    unitCost: unitCostSnapshot,
    sourceEventType: "stock_exit",
    sourceEventId: id,
  };

  // R-2/INV-11, same contract as the create path. The plan reads this exit's CURRENT movements as
  // well as the pending ones, so moving an exit's date backwards is disturbed from BOTH points —
  // where the row was and where it is going.
  //
  // Note (observed, not a defect this file can fix): unlike the create path — where this exit's own
  // `stock_exits` row does not exist yet, so `readFrozenSnapshot` skips it — an EDIT of a backdated
  // exit finds ITSELF among the frozen snapshots the replay contradicts, which can be what tips
  // `confirmationRequired`. That errs toward asking the owner about an edit to a past event, which
  // is precisely what R-5 asks for; the alternative (silently committing) would be the unsafe one.
  const plan = await planCostingReplay(db, {
    trigger: {
      eventType: "stock_exit",
      eventId: id,
      businessDate: command.businessDate,
      occurredAt: command.occurredAt,
    },
    changes: [{ sourceEventType: "stock_exit", sourceEventId: id, newMovements: [movement] }],
    actor,
  });

  // R-5 — thrown BEFORE db.batch, so a refused edit writes nothing and the stored event is intact.
  if (plan.confirmationRequired && command.confirm !== true) {
    throw conflict(
      "Esta edición cambia costos ya calculados de movimientos posteriores. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: plan.impact },
    );
  }

  const { statements: movementStatements } = await buildReplaceMovementsForSourceStatements(
    db,
    "stock_exit",
    id,
    [movement],
  );

  const updatedRow = {
    ...current,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    itemId: command.itemId,
    qty: command.qty,
    reason: command.reason,
    unitCostSnapshot,
    sessionId: command.sessionId ?? null,
    notes: command.notes ?? null,
    updatedAt: now,
  };

  const statements: Statement[] = [
    db
      .update(stockExits)
      .set({
        occurredAt: updatedRow.occurredAt,
        businessDate: updatedRow.businessDate,
        itemId: updatedRow.itemId,
        qty: updatedRow.qty,
        reason: updatedRow.reason,
        unitCostSnapshot: updatedRow.unitCostSnapshot,
        sessionId: updatedRow.sessionId,
        notes: updatedRow.notes,
        updatedAt: updatedRow.updatedAt,
      })
      .where(eq(stockExits.id, id)),
    ...movementStatements,
    // Still NO financial_transactions statement and NO items.wac write of our own (C-6).
    // INV-9/INV-10: the full before/after is what makes R-3's 90-day reversal possible.
    buildAuditLogInsert(db, {
      actor,
      action: "update",
      entityType: "stock_exits",
      entityId: id,
      before: current,
      after: updatedRow,
    }),
    // MUST stay after `movementStatements` — replay.ts's module header: the `item_stock` upsert
    // there recomputes `negative_since` incrementally, while the plan's UPDATE is the authoritative
    // recomputation and has to land last to win.
    ...plan.statements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return { exit: toStockExitDto(updatedRow) };
}

/**
 * R-3 + R-1: SOFT-delete one stock exit (D-8 — `deleted_at` is set, the row is never removed) and
 * reverse everything derived from it, in ONE atomic batch (D-3): the `stock_exits` UPDATE + a
 * replacement of its movements with the EMPTY set (which hard-deletes the derived kardex rows —
 * D-8's explicit carve-out for system-owned derived rows — and nets `-oldQty` back into
 * `item_stock`) + the `audit_log` row + any `planCostingReplay` statements.
 *
 * No financial reversal exists to make: C-6 means the exit never booked one.
 */
export async function deleteStockExit(
  db: Db,
  id: string,
  command: DeleteStockExitCommand,
  actor: AuditActor,
): Promise<DeleteStockExitResult> {
  const current = await loadLiveExit(db, id);

  // `newMovements: []` is replay.ts's encoding of "this source is going away" — the touched point
  // then comes purely from where the existing movements ARE. Deleting a backdated exit re-weights
  // C-1 for every later entry of the item exactly as creating one does.
  const plan = await planCostingReplay(db, {
    trigger: {
      eventType: "stock_exit",
      eventId: id,
      businessDate: current.businessDate,
      occurredAt: current.occurredAt,
    },
    changes: [{ sourceEventType: "stock_exit", sourceEventId: id, newMovements: [] }],
    actor,
  });

  // R-5 — before db.batch, so a refused delete leaves the exit and its kardex rows untouched.
  if (plan.confirmationRequired && command.confirm !== true) {
    throw conflict(
      "Eliminar esta salida cambia costos ya calculados de movimientos posteriores. Revisa el impacto y confirma para eliminarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: plan.impact },
    );
  }

  const { statements: movementStatements } = await buildReplaceMovementsForSourceStatements(
    db,
    "stock_exit",
    id,
    [],
  );

  const now = nowIso();
  const deletedRow = { ...current, deletedAt: now, updatedAt: now };

  const statements: Statement[] = [
    // Soft (D-8/R-3): never `db.delete(stockExits)`. The row stays readable for the 90-day
    // reversal window; `getStockExit` / `listStockExits` already filter on `deleted_at IS NULL`.
    db.update(stockExits).set({ deletedAt: now, updatedAt: now }).where(eq(stockExits.id, id)),
    ...movementStatements,
    buildAuditLogInsert(db, {
      actor,
      action: "delete",
      entityType: "stock_exits",
      entityId: id,
      before: current,
      after: deletedRow,
    }),
    // After `movementStatements`, for the same `negative_since` reason as above.
    ...plan.statements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return { exit: toStockExitDto(deletedRow), deletedAt: now };
}

export async function getStockExit(db: Db, id: string): Promise<StockExitDto> {
  const row = await db.query.stockExits.findFirst({
    where: (t, { and, eq: eqOp, isNull }) => and(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la salida de stock.", { id });
  }
  return toStockExitDto(row);
}

/** Read query for the (later) Exits screen's list — mirrors core/purchasing's listPurchases.
 * Soft-delete-aware even though nothing deletes exits yet. */
export async function listStockExits(
  db: Db,
  filters: ListStockExitsFilters = {},
): Promise<ListStockExitsResult> {
  const rows = await db.query.stockExits.findMany({
    where: (t, { and, eq: eqOp, gte, lte, isNull }) => {
      const conditions = [isNull(t.deletedAt)];
      if (filters.itemId) conditions.push(eqOp(t.itemId, filters.itemId));
      if (filters.reason) conditions.push(eqOp(t.reason, filters.reason));
      if (filters.fromDate) conditions.push(gte(t.businessDate, filters.fromDate));
      if (filters.toDate) conditions.push(lte(t.businessDate, filters.toDate));
      return and(...conditions);
    },
    orderBy: (t, { desc }) => [desc(t.businessDate), desc(t.createdAt)],
    limit: filters.limit ?? 200,
  });

  return { exits: rows.map(toStockExitDto) };
}
