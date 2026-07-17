// core/purchasing — UC-01 "Record purchase" (KOK-016, Doc 03 UC-01, Doc 04 §3.3/§3.4). This is the
// TEMPLATE event-vertical module every future business-event service (production KOK-026, sales
// KOK-030, exits KOK-018, counts KOK-019) copies the shape of: `recordPurchase` is a top-level
// command entry point — like core/finance/transactions.ts and core/catalog, NOT a building block
// like core/inventory/core/costing — so it does its own defensive validation, builds every row
// itself, and executes exactly ONE atomic `db.batch()` (D-3) containing:
//   - the `purchases` + `purchase_lines` inserts (the event itself)
//   - the PURCHASE_IN `stock_movements` + `item_stock` upserts (core/inventory's
//     buildStockMovementStatements — a building block spliced into this batch, never its own)
//   - one `items` UPDATE per distinct item touched, carrying the C-1 WAC update and (RAW_MATERIAL
//     only) the C-3 replacement_cost update
//   - the account balance debit (core/finance's buildAccountBalanceDelta)
//   - the system-owned EXPENSE/SUPPLY_PURCHASE `financial_transactions` row — sourceEventType/
//     sourceEventId are SET here (unlike core/finance/transactions.ts's standalone commands, which
//     are always null), per Doc 04 §5's rule that purchase-sourced transactions carry their source
//   - the `audit_log` row (core/audit's buildAuditLogInsert)

import type {
  AuditActor,
  ListPurchasesFilters,
  ListPurchasesResult,
  PurchaseDto,
  PurchaseLineDto,
  RecordPurchaseCommand,
  RecordPurchaseResult,
} from "@kokoro/shared";
import { addMoney, generateUuidV7, nowIso, subMoney } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialTransactions, items, purchaseLines, purchases } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { applyWacEntry, computePurchaseLineUnitCost } from "../costing/wac.js";
import { notFound, validationError } from "../errors.js";
import { buildAccountBalanceDelta, findActiveAccountRowOrThrow } from "../finance/accounts.js";
import { toAccountDto } from "../finance/dto.js";
import { buildStockMovementStatements } from "../inventory/movements.js";
import type { StockMovementInput } from "../inventory/types.js";

type Statement = BatchItem<"sqlite">;
type PurchaseRow = typeof purchases.$inferSelect;
type PurchaseLineRow = typeof purchaseLines.$inferSelect;
type ItemRow = typeof items.$inferSelect;

/**
 * Running WAC/on-hand state for ONE item across a purchase's lines, threaded per-line so a second
 * line for the same item (e.g. two batches of flour on one invoice) applies C-1 against the
 * FIRST line's effect, not the pre-purchase snapshot twice — see this module's header and Doc 10
 * KOK-016's "sequencing multi-line same-item purchases" note. Seeded ONCE per distinct item from
 * its currently-stored `items.wac` / `item_stock.qty_on_hand` (defaulting on-hand to 0 when no
 * `item_stock` row exists yet, i.e. a brand-new item's first-ever movement) — this is NOT a full
 * kardex replay (that's `recomputeWacFromMovements`, R-2, a different call site); it only threads
 * this purchase's own lines forward from the current live state.
 */
interface ItemPurchaseState {
  wac: number;
  onHand: number;
  kind: ItemRow["kind"];
  /** Unit cost of the LAST line processed so far for this item. Overwritten on every line that
   * touches this item, so after the full pass it holds the last line's value regardless of how
   * many lines (or their position among other items' lines) touched this item — C-3: "for
   * RAW_MATERIAL, replacement_cost = last purchase unit cost". */
  lastUnitCost: number;
}

function toPurchaseDto(row: PurchaseRow, lineRows: readonly PurchaseLineRow[]): PurchaseDto {
  const lines: PurchaseLineDto[] = lineRows.map((l) => ({
    id: l.id,
    itemId: l.itemId,
    qty: l.qty,
    lineTotal: l.lineTotal,
  }));
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    businessDate: row.businessDate,
    supplierName: row.supplierName,
    sessionId: row.sessionId,
    accountId: row.accountId,
    total: row.total,
    receiptPhotoKey: row.receiptPhotoKey,
    notes: row.notes,
    lines,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** UC-01: record a multi-line purchase in one atomic batch (D-3). See this module's header for the
 * full statement list this builds. */
export async function recordPurchase(
  db: Db,
  command: RecordPurchaseCommand,
  actor: AuditActor,
): Promise<RecordPurchaseResult> {
  // Defensive re-check (core/ services never trust a caller already ran Zod, D-2) — mirrors
  // recordPurchaseCommandSchema's `.min(1)` on `lines`.
  if (command.lines.length === 0) {
    throw validationError("Se requiere al menos una línea de compra.", {});
  }

  const account = await findActiveAccountRowOrThrow(db, command.accountId);

  // Seed one ItemPurchaseState per DISTINCT item up front (one items query + one item_stock query
  // per distinct itemId, never per line), then thread it through the lines below in order — see
  // ItemPurchaseState's doc comment for why this differs from a naive per-line snapshot read.
  const itemStates = new Map<string, ItemPurchaseState>();
  for (const itemId of new Set(command.lines.map((l) => l.itemId))) {
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemId),
    });
    if (!itemRow) {
      throw notFound("No se encontró el ítem.", { id: itemId });
    }
    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });
    itemStates.set(itemId, {
      wac: itemRow.wac,
      onHand: stockRow?.qtyOnHand ?? 0,
      kind: itemRow.kind,
      lastUnitCost: 0,
    });
  }

  const purchaseId = generateUuidV7();
  const now = nowIso();

  const movements: StockMovementInput[] = [];
  for (const line of command.lines) {
    const state = itemStates.get(line.itemId);
    if (!state) {
      // Unreachable: itemStates was seeded from the exact same distinct itemIds as command.lines
      // above. Fails loudly instead of silently if that invariant is ever broken by a future edit.
      throw validationError("Estado interno de compra inconsistente.", { itemId: line.itemId });
    }

    const unitCost = computePurchaseLineUnitCost(line.lineTotal, line.qty);
    state.wac = applyWacEntry(state.wac, state.onHand, line.qty, unitCost);
    state.onHand += line.qty;
    state.lastUnitCost = unitCost;

    movements.push({
      itemId: line.itemId,
      occurredAt: command.occurredAt,
      businessDate: command.businessDate,
      type: "PURCHASE_IN",
      qty: line.qty,
      unitCost,
      sourceEventType: "purchase",
      sourceEventId: purchaseId,
    });
  }

  // Server-recomputed, never trusted from the caller (Doc 04 §5) — recordPurchaseCommandSchema has
  // no `total` field at all, so this is the only place a purchase's total is ever produced.
  const total = addMoney(...command.lines.map((l) => l.lineTotal));

  const purchaseRow = {
    id: purchaseId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    supplierName: command.supplierName ?? null,
    sessionId: command.sessionId ?? null,
    accountId: command.accountId,
    total,
    receiptPhotoKey: command.receiptPhotoKey ?? null,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const purchaseLineRows: PurchaseLineRow[] = command.lines.map((line) => ({
    id: generateUuidV7(),
    purchaseId,
    itemId: line.itemId,
    qty: line.qty,
    lineTotal: line.lineTotal,
  }));

  const { statements: movementStatements } = buildStockMovementStatements(db, movements);

  // One `items` UPDATE per distinct item touched, carrying its FINAL threaded wac (C-1) and, for
  // RAW_MATERIAL only (C-3 — SEMI_FINISHED/FINISHED replacement cost is a recipe rollup, KOK-029,
  // out of scope here), the last line's unit cost as the new replacement_cost.
  const itemUpdateStatements: Statement[] = [];
  for (const [itemId, state] of itemStates) {
    if (state.kind === "RAW_MATERIAL") {
      itemUpdateStatements.push(
        db
          .update(items)
          .set({
            wac: state.wac,
            replacementCost: state.lastUnitCost,
            replacementCostUpdatedAt: now,
            updatedAt: now,
          })
          .where(eq(items.id, itemId)),
      );
    } else {
      itemUpdateStatements.push(
        db.update(items).set({ wac: state.wac, updatedAt: now }).where(eq(items.id, itemId)),
      );
    }
  }

  const transactionRow = {
    id: generateUuidV7(),
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    accountId: command.accountId,
    type: "EXPENSE" as const,
    category: "SUPPLY_PURCHASE" as const,
    amount: total,
    counterpartTxId: null,
    sourceEventType: "purchase",
    sourceEventId: purchaseId,
    description: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const statements: Statement[] = [
    db.insert(purchases).values(purchaseRow),
    ...purchaseLineRows.map((row) => db.insert(purchaseLines).values(row)),
    ...movementStatements,
    ...itemUpdateStatements,
    buildAccountBalanceDelta(db, command.accountId, -total),
    db.insert(financialTransactions).values(transactionRow),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "purchases",
      entityId: purchaseId,
      before: null,
      after: purchaseRow,
    }),
  ];

  // `statements` always starts with the fixed purchase insert above, so it is never empty — this
  // cast satisfies Drizzle's non-empty-tuple `batch()` signature for what is otherwise a
  // dynamic-length array (varying line/movement/item-update counts), the same technique
  // test/inventory.test.ts's execBatch helper uses for the identical reason.
  await db.batch(statements as [Statement, ...Statement[]]);

  return {
    purchase: toPurchaseDto(purchaseRow, purchaseLineRows),
    account: toAccountDto({ ...account, balance: subMoney(account.balance, total) }),
  };
}

export async function getPurchase(db: Db, id: string): Promise<PurchaseDto> {
  const row = await db.query.purchases.findFirst({
    where: (t, { and, eq: eqOp, isNull }) => and(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la compra.", { id });
  }
  const lineRows = await db.query.purchaseLines.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.purchaseId, id),
  });
  return toPurchaseDto(row, lineRows);
}

/** Read query for the (later) Purchases screen's list — mirrors core/finance/transactions.ts's
 * listTransactions. Soft-delete-aware even though nothing deletes purchases yet (KOK-024's job). */
export async function listPurchases(
  db: Db,
  filters: ListPurchasesFilters = {},
): Promise<ListPurchasesResult> {
  const rows = await db.query.purchases.findMany({
    where: (t, { and, eq: eqOp, gte, lte, isNull }) => {
      const conditions = [isNull(t.deletedAt)];
      if (filters.accountId) conditions.push(eqOp(t.accountId, filters.accountId));
      if (filters.fromDate) conditions.push(gte(t.businessDate, filters.fromDate));
      if (filters.toDate) conditions.push(lte(t.businessDate, filters.toDate));
      return and(...conditions);
    },
    orderBy: (t, { desc }) => [desc(t.businessDate), desc(t.createdAt)],
    limit: filters.limit ?? 200,
  });

  const purchaseIds = rows.map((r) => r.id);
  const lineRows =
    purchaseIds.length > 0
      ? await db.query.purchaseLines.findMany({
          where: (t, { inArray }) => inArray(t.purchaseId, purchaseIds),
        })
      : [];
  const linesByPurchase = new Map<string, PurchaseLineRow[]>();
  for (const line of lineRows) {
    const arr = linesByPurchase.get(line.purchaseId) ?? [];
    arr.push(line);
    linesByPurchase.set(line.purchaseId, arr);
  }

  return {
    purchases: rows.map((row) => toPurchaseDto(row, linesByPurchase.get(row.id) ?? [])),
  };
}
