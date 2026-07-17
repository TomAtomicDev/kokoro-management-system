// core/inventory/counts — UC-10 "Inventory count & adjust" (KOK-019, Doc 03 §3, Doc 04 §3.3
// `inventory_counts` / `inventory_count_lines`). A DRAFT -> COMMITTED state machine, unlike every
// other event vertical in core/inventory (exits.ts writes one-shot immutable events): a count is
// STARTED (freezing expected_qty per selected item), edited line-by-line over possibly many
// sessions while DRAFT, then COMMITTED exactly once.
//
// THE CRITICAL CORRECTNESS RULE (Doc 10 KOK-019's "snapshot semantics" edge-case note —
// "items counted while other events land mid-count"): `expected_qty` is captured ONCE, at
// startCount time, from `item_stock.qty_on_hand`, and is NEVER refreshed afterward — not even if
// other events (a purchase, another count, anything) change that item's live stock while this
// count is still DRAFT. commitCount's ADJUST movement qty is ALWAYS
// `line.countedQty - line.expectedQty` using the STORED (frozen) `expectedQty` column, never a
// re-read of `item_stock` at commit time. Only the VALUATION side (`getCurrentWac`) is genuinely
// live at commit time, matching C-6's exit-valuation rule exactly (value at CURRENT WAC, but never
// freeze that part the way `expectedQty` is frozen). Get the frozen/live split backwards and the
// whole feature silently corrupts inventory data — see test/counts.test.ts's dedicated
// snapshot-semantics test, which is the load-bearing test for this entire module.
//
// State-machine guard (mirrors core/finance/transactions.ts's `assertTransactionEditable`
// precedent — Doc 08 §2's error-code taxonomy draws the 409-vs-400 distinction between "this row's
// state forbids this operation" and "bad input"): editing a line on, or committing, a count that
// is already COMMITTED throws `conflict()` (409), never `validationError()` (400).

import type {
  AuditActor,
  CommitCountCommand,
  CommitCountResult,
  CountAdjustmentDto,
  InventoryCountDto,
  InventoryCountLineDto,
  ListCountsFilters,
  ListCountsResult,
  StartCountCommand,
  StartCountResult,
  UpdateCountLineCommand,
  UpdateCountLineResult,
} from "@kokoro/shared";
import { generateUuidV7, nowIso, toBusinessDate } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { inventoryCountLines, inventoryCounts } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { listItems } from "../catalog/items.js";
import { getCurrentWac } from "../costing/repair.js";
import { snapshotUnitCost } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
import { buildStockMovementStatements } from "./movements.js";
import type { StockMovementInput } from "./types.js";

type Statement = BatchItem<"sqlite">;
type InventoryCountRow = typeof inventoryCounts.$inferSelect;
type InventoryCountLineRow = typeof inventoryCountLines.$inferSelect;

function toLineDto(row: InventoryCountLineRow): InventoryCountLineDto {
  return {
    id: row.id,
    itemId: row.itemId,
    expectedQty: row.expectedQty,
    countedQty: row.countedQty,
  };
}

function toCountDto(
  row: InventoryCountRow,
  lineRows: readonly InventoryCountLineRow[],
): InventoryCountDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    businessDate: row.businessDate,
    status: row.status,
    notes: row.notes,
    lines: lineRows.map(toLineDto),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function fetchLines(db: Db, countId: string): Promise<InventoryCountLineRow[]> {
  return db.query.inventoryCountLines.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.countId, countId),
  });
}

async function findCountRowOrThrow(db: Db, id: string): Promise<InventoryCountRow> {
  const row = await db.query.inventoryCounts.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull }) => andOp(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró el conteo de inventario.", { id });
  }
  return row;
}

/**
 * UC-10 step 1: start a new count in one atomic batch (D-3). Resolves the item set via
 * core/catalog's `listItems`, ALWAYS with `isActive: true` regardless of the caller's own kind/
 * category filter — a count over discontinued stock the owner isn't tracking day-to-day is not
 * meaningful (Doc 07 SC-08's "new count -> item checklist (filter by category)" implicitly scopes
 * to the items the owner is actually managing). Omitting BOTH `kind` and `category` includes every
 * active item.
 *
 * Freezes each resolved item's CURRENT `item_stock.qty_on_hand` as `expectedQty` (defaulting to 0
 * for an item with no `item_stock` row yet, i.e. one that has never had a movement) — see this
 * module's header for why this value is NEVER refreshed once frozen. `countedQty` starts equal to
 * `expectedQty` ("no variance yet") — the owner edits it line-by-line via `updateCountLine` as they
 * physically count.
 */
export async function startCount(
  db: Db,
  command: StartCountCommand,
  actor: AuditActor,
): Promise<StartCountResult> {
  const { items: resolvedItems } = await listItems(db, {
    kind: command.kind,
    category: command.category,
    isActive: true,
  });
  if (resolvedItems.length === 0) {
    throw validationError("No hay ítems activos que coincidan con el alcance del conteo.", {
      kind: command.kind,
      category: command.category,
    });
  }

  const itemIds = resolvedItems.map((item) => item.id);
  const stockRows = await db.query.itemStock.findMany({
    where: (t, { inArray: inArrayOp }) => inArrayOp(t.itemId, itemIds),
  });
  const onHandByItem = new Map(stockRows.map((row) => [row.itemId, row.qtyOnHand]));

  const countId = generateUuidV7();
  const now = nowIso();

  const lineRows: InventoryCountLineRow[] = itemIds.map((itemId) => {
    const expectedQty = onHandByItem.get(itemId) ?? 0;
    return {
      id: generateUuidV7(),
      countId,
      itemId,
      expectedQty,
      countedQty: expectedQty,
    };
  });

  const countRow: InventoryCountRow = {
    id: countId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    status: "DRAFT",
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const statements: Statement[] = [
    db.insert(inventoryCounts).values(countRow),
    ...lineRows.map((row) => db.insert(inventoryCountLines).values(row)),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "inventory_counts",
      entityId: countId,
      before: null,
      after: countRow,
    }),
  ];

  // `statements` always starts with the fixed inventory_counts insert above, so it is never
  // empty — same cast technique as core/purchasing/index.ts's recordPurchase, for the same reason.
  await db.batch(statements as [Statement, ...Statement[]]);

  return { count: toCountDto(countRow, lineRows) };
}

/**
 * UC-10 step 2: edit one line's `countedQty` while the count is still DRAFT. Wrapped in its own
 * `db.batch()` (even as a 1-element array) per D-3's spirit — a DRAFT line edit is arguably not yet
 * a "committed" business event, but for safety and consistency with every other mutation in this
 * codebase it goes through the same non-empty-tuple cast technique regardless. Does NOT write its
 * own audit_log row: a DRAFT count's in-progress line edits are working state, not yet a committed
 * fact — audit fires once, on `commitCount`, at the command/aggregate boundary (mirrors the general
 * "audit on the aggregate boundary, not every field edit" precedent, e.g. `core/catalog`'s item
 * field updates vs. its own audit granularity).
 */
export async function updateCountLine(
  db: Db,
  command: UpdateCountLineCommand,
  _actor: AuditActor,
): Promise<UpdateCountLineResult> {
  const countRow = await findCountRowOrThrow(db, command.countId);
  if (countRow.status !== "DRAFT") {
    throw conflict("No se puede editar un conteo que ya fue confirmado.", {
      countId: command.countId,
      status: countRow.status,
    });
  }

  const lineRow = await db.query.inventoryCountLines.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.countId, command.countId), eqOp(t.itemId, command.itemId)),
  });
  if (!lineRow) {
    throw notFound("Este ítem no forma parte del conteo.", {
      countId: command.countId,
      itemId: command.itemId,
    });
  }

  const statements: Statement[] = [
    db
      .update(inventoryCountLines)
      .set({ countedQty: command.countedQty })
      .where(eq(inventoryCountLines.id, lineRow.id)),
  ];
  await db.batch(statements as [Statement, ...Statement[]]);

  return { line: toLineDto({ ...lineRow, countedQty: command.countedQty }) };
}

/**
 * UC-10 step 3: commit a DRAFT count in one atomic batch (D-3) — THE method enforcing this
 * module's frozen-snapshot correctness rule (see header). For every line, `delta =
 * line.countedQty - line.expectedQty` using the STORED (frozen) `expectedQty` column — never a
 * fresh `item_stock` read. Lines with `delta === 0` produce NO movement (Doc 10: "zero-variance
 * lines produce no movement" — filtered out BEFORE `buildStockMovementStatements`, which rejects a
 * qty=0 movement by design). For each remaining line's item, `getCurrentWac` is read LIVE at commit
 * time (C-6 — this genuinely is live state, unlike `expectedQty`) and snapshotted via
 * `snapshotUnitCost`.
 *
 * The ADJUST movements' `occurredAt`/`businessDate` are the COMMIT's own "when"
 * (`nowIso()`/`toBusinessDate(nowIso())`), NOT the count's original start-time
 * `occurredAt`/`businessDate` — a count may stay open for days, and the adjustment only becomes a
 * real kardex event once it is actually committed.
 *
 * A perfect count (every line zero-variance) still commits successfully: the status update + audit
 * row are written, but `buildStockMovementStatements` is simply never called (it throws on an empty
 * movements array by design — see movements.ts's own guard) rather than being called with one.
 */
export async function commitCount(
  db: Db,
  command: CommitCountCommand,
  actor: AuditActor,
): Promise<CommitCountResult> {
  const countRow = await findCountRowOrThrow(db, command.countId);
  if (countRow.status !== "DRAFT") {
    throw conflict("Este conteo ya fue confirmado.", {
      countId: command.countId,
      status: countRow.status,
    });
  }

  const lineRows = await fetchLines(db, command.countId);
  const variantLines = lineRows
    .map((line) => ({ line, delta: line.countedQty - line.expectedQty }))
    .filter(({ delta }) => delta !== 0);

  const now = nowIso();
  const businessDate = toBusinessDate(now);

  const movements: StockMovementInput[] = [];
  const adjustments: CountAdjustmentDto[] = [];
  for (const { line, delta } of variantLines) {
    // Live at commit time (C-6) — NOT the frozen side of this command, unlike `line.expectedQty`.
    const currentWac = await getCurrentWac(db, line.itemId);
    const unitCostSnapshot = snapshotUnitCost(currentWac);
    movements.push({
      itemId: line.itemId,
      occurredAt: now,
      businessDate,
      type: "ADJUST",
      qty: delta,
      unitCost: unitCostSnapshot,
      sourceEventType: "inventory_count",
      sourceEventId: countRow.id,
    });
    adjustments.push({ itemId: line.itemId, delta });
  }

  const statements: Statement[] = [
    db
      .update(inventoryCounts)
      .set({ status: "COMMITTED", updatedAt: now })
      .where(eq(inventoryCounts.id, command.countId)),
  ];
  if (movements.length > 0) {
    const { statements: movementStatements } = buildStockMovementStatements(db, movements);
    statements.push(...movementStatements);
  }
  statements.push(
    buildAuditLogInsert(db, {
      actor,
      action: "commit",
      entityType: "inventory_counts",
      entityId: command.countId,
      before: { status: countRow.status },
      after: { status: "COMMITTED", adjustments },
    }),
  );

  // `statements` always starts with the fixed inventory_counts status update above, so it is never
  // empty — same cast technique as every other command in this codebase.
  await db.batch(statements as [Statement, ...Statement[]]);

  const updatedCountRow: InventoryCountRow = { ...countRow, status: "COMMITTED", updatedAt: now };
  return { count: toCountDto(updatedCountRow, lineRows), adjustments };
}

export async function getCount(db: Db, id: string): Promise<InventoryCountDto> {
  const row = await findCountRowOrThrow(db, id);
  const lineRows = await fetchLines(db, id);
  return toCountDto(row, lineRows);
}

/** Read query for the (later) Counts screen's list — mirrors core/purchasing's listPurchases. */
export async function listCounts(
  db: Db,
  filters: ListCountsFilters = {},
): Promise<ListCountsResult> {
  const rows = await db.query.inventoryCounts.findMany({
    where: (t, { and: andOp, eq: eqOp, gte, lte, isNull }) => {
      const conditions = [isNull(t.deletedAt)];
      if (filters.status) conditions.push(eqOp(t.status, filters.status));
      if (filters.fromDate) conditions.push(gte(t.businessDate, filters.fromDate));
      if (filters.toDate) conditions.push(lte(t.businessDate, filters.toDate));
      return andOp(...conditions);
    },
    orderBy: (t, { desc }) => [desc(t.businessDate), desc(t.createdAt)],
    limit: filters.limit ?? 200,
  });

  const countIds = rows.map((row) => row.id);
  const lineRows =
    countIds.length > 0
      ? await db.query.inventoryCountLines.findMany({
          where: (t, { inArray: inArrayOp }) => inArrayOp(t.countId, countIds),
        })
      : [];
  const linesByCount = new Map<string, InventoryCountLineRow[]>();
  for (const line of lineRows) {
    const arr = linesByCount.get(line.countId) ?? [];
    arr.push(line);
    linesByCount.set(line.countId, arr);
  }

  return {
    counts: rows.map((row) => toCountDto(row, linesByCount.get(row.id) ?? [])),
  };
}
