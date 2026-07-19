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
//   - (KOK-024) whatever `planCostingReplay` returns when this purchase is BACKDATED — the
//     corrected `items.wac` for every item whose kardex it re-weights, the `costing_adjustments`
//     row booking the difference forward (R-4), the `item_stock.negative_since` fix, and its own
//     audit row. Empty on the ordinary same-day capture, which is the overwhelmingly common case.

import type {
  AuditActor,
  ListPurchasesFilters,
  ListPurchasesResult,
  PurchaseDto,
  PurchaseLineDto,
  RecordPurchaseCommand,
  RecordPurchaseResult,
} from "@kokoro/shared";
import {
  addMoney,
  generateUuidV7,
  nowIso,
  REPLAY_CONFIRMATION_REQUIRED,
  subMoney,
} from "@kokoro/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialTransactions, items, purchaseLines, purchases } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { planCostingReplay } from "../costing/replay.js";
import { applyWacEntry, computePurchaseLineUnitCost } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
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

/**
 * C-3, "last by `business_date`": does a purchase dated AFTER this one already supply `itemId`'s
 * replacement cost?
 *
 * C-3 says `replacement_cost = last purchase unit cost`. Until KOK-024 "last" was implemented as
 * "most recently RECORDED", which let a backdated purchase clobber a replacement cost set by a
 * purchase with a later `business_date` — the owner backdates last week's invoice and today's
 * price silently rolls back to last week's. Doc 03 §4 C-3 now defines "last" as last by
 * `business_date` (D-1/D-6, amended in this same commit); this is that rule's query.
 *
 * Ties keep the previous behaviour deliberately (`>` not `>=`): two purchases on the SAME business
 * date are ordered only by capture, so the later-recorded one still wins — which is what the
 * ordinary same-day path has always done, and what "the last price I paid today" means.
 *
 * Runs BEFORE the insert, so this purchase's own (not yet written) line can never match. Soft
 * -deleted purchases are excluded (INV-10 / D-8): a reverted invoice must not keep pinning a price.
 */
async function hasLaterDatedPurchaseForItem(
  db: Db,
  itemId: string,
  businessDate: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: purchases.id })
    .from(purchaseLines)
    .innerJoin(purchases, eq(purchaseLines.purchaseId, purchases.id))
    .where(
      and(
        eq(purchaseLines.itemId, itemId),
        isNull(purchases.deletedAt),
        gt(purchases.businessDate, businessDate),
      ),
    )
    .limit(1);
  return rows.length > 0;
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

  // ---- INV-11 / R-2 ordering guard (ADR-016 §1) --------------------------------------------
  // A purchase is not exempt from the replay just because it is a CREATE: recording today's
  // production and only then backdating last week's flour invoice is an ordinary Tuesday, and the
  // C-1 threading above — which reads `items.wac` / `item_stock.qty_on_hand` at their CURRENT
  // value — is simply wrong for it. Planned BEFORE the batch is assembled so the R-5 refusal below
  // can happen before a single write.
  const plan = await planCostingReplay(db, {
    trigger: {
      eventType: "purchase",
      eventId: purchaseId,
      businessDate: command.businessDate,
      occurredAt: command.occurredAt,
    },
    changes: [{ sourceEventType: "purchase", sourceEventId: purchaseId, newMovements: movements }],
    actor,
  });

  // R-5: the replay would move cost already booked against a recorded sale/exit/production run.
  // Refuse — before `db.batch`, so nothing is written — and hand the caller the impact it needs to
  // render the preview and re-submit with `confirm: true`. CONFLICT/409 (Doc 08 §2), discriminated
  // by `details.reason`; see REPLAY_CONFIRMATION_REQUIRED for why this is not its own error code.
  if (plan.confirmationRequired && command.confirm !== true) {
    throw conflict(
      "Esta compra tiene fecha anterior a movimientos ya registrados y cambia costos ya calculados. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: plan.impact },
    );
  }

  const { statements: movementStatements } = buildStockMovementStatements(db, movements);

  // Which items' WAC does the plan own? For a backdated item the replay's value is authoritative
  // and the naive threaded one is stale, so exactly ONE of the two writes it — never both, or the
  // batch would contain two conflicting `items` UPDATEs for the same row. The planner already
  // decided this, per item, to pick the items it replayed; `replayedItemIds` is that decision,
  // reported rather than re-derived, so the two can no longer drift apart. Empty on the fast path
  // (`required === false`), which leaves the ordinary same-day capture writing every naive value.
  const replayOwnedItemIds = new Set(plan.replayedItemIds);

  // C-3, "last by business_date" (Doc 03 §4): a backdated purchase must not roll a replacement cost
  // back to an older price. Only RAW_MATERIAL is asked (C-3 restricts the rule to it), and only
  // when the purchase could actually be backdated — the same-day path never queries.
  const replacementCostSupersededItemIds = new Set<string>();
  for (const [itemId, state] of itemStates) {
    if (state.kind !== "RAW_MATERIAL") continue;
    if (await hasLaterDatedPurchaseForItem(db, itemId, command.businessDate)) {
      replacementCostSupersededItemIds.add(itemId);
    }
  }

  // At most ONE `items` UPDATE per distinct item touched (D-3, and the invariant the "threads WAC
  // across two lines" test pins), carrying whichever of the two columns this service still owns:
  //   - `wac`: its FINAL threaded C-1 value, UNLESS the replay owns this item (above).
  //   - `replacement_cost`: RAW_MATERIAL only, unless a later-dated purchase already supersedes it.
  // An item where the replay owns the WAC and C-3 is superseded needs no statement at all.
  const itemUpdateStatements: Statement[] = [];
  for (const [itemId, state] of itemStates) {
    const values: Partial<typeof items.$inferInsert> = {};
    if (!replayOwnedItemIds.has(itemId)) {
      values.wac = state.wac;
    }
    if (state.kind === "RAW_MATERIAL" && !replacementCostSupersededItemIds.has(itemId)) {
      values.replacementCost = state.lastUnitCost;
      values.replacementCostUpdatedAt = now;
    }
    if (Object.keys(values).length === 0) continue;
    itemUpdateStatements.push(
      db
        .update(items)
        .set({ ...values, updatedAt: now })
        .where(eq(items.id, itemId)),
    );
  }

  // financial_transactions.amount is always > 0 (no zero-value cash movements, Doc 04 §3.3) — a
  // purchase whose total across all lines is 0 (all free/promotional stock) moved no cash, so it
  // skips this row entirely rather than violating that CHECK constraint. PURCHASE_IN movements,
  // WAC, and replacement_cost above are unaffected either way.
  const financialStatements: Statement[] =
    total > 0
      ? [
          buildAccountBalanceDelta(db, command.accountId, -total),
          db.insert(financialTransactions).values({
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
          }),
        ]
      : [];

  const statements: Statement[] = [
    db.insert(purchases).values(purchaseRow),
    ...purchaseLineRows.map((row) => db.insert(purchaseLines).values(row)),
    ...movementStatements,
    ...itemUpdateStatements,
    ...financialStatements,
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "purchases",
      entityId: purchaseId,
      before: null,
      after: purchaseRow,
    }),
    // R-2: the replay lands in THIS batch, not a second one — a purchase and the cost correction it
    // forces are one atomic fact (D-3). LAST on purpose, and specifically after `movementStatements`
    // (replay.ts's module header states this requirement): the `item_stock` upsert there recomputes
    // `negative_since` incrementally from its own delta, while the plan's is the authoritative
    // recomputation over the whole projected kardex and must win. Empty on the fast path.
    ...plan.statements,
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
