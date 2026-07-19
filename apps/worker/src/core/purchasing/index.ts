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
  DeletePurchaseCommand,
  DeletePurchaseResult,
  ListPurchasesFilters,
  ListPurchasesResult,
  PurchaseDto,
  PurchaseLineDto,
  RecordPurchaseCommand,
  RecordPurchaseResult,
  UpdatePurchaseCommand,
  UpdatePurchaseResult,
} from "@kokoro/shared";
import {
  addMoney,
  generateUuidV7,
  nowIso,
  REPLAY_CONFIRMATION_REQUIRED,
  subMoney,
} from "@kokoro/shared";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialTransactions, items, purchaseLines, purchases } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import type { CostingReplayPlan } from "../costing/replay.js";
import { planCostingReplay } from "../costing/replay.js";
import type { ReplayMovement } from "../costing/wac.js";
import { applyWacEntry, computePurchaseLineUnitCost, replayWacFrom } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
import type { FinancialTransactionInput } from "../finance/accounts.js";
import {
  buildAccountBalanceDelta,
  buildReplaceTransactionsForSourceStatements,
  findActiveAccountRowOrThrow,
} from "../finance/accounts.js";
import { toAccountDto } from "../finance/dto.js";
import {
  buildReplaceMovementsForSourceStatements,
  buildStockMovementStatements,
} from "../inventory/movements.js";
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

// ============================================================================================
// UC-01 EDIT / DELETE (KOK-024 Phase E) — Doc 03 §7 R-1 (edit regenerates derived rows in ONE
// batch), R-3 (deletions are soft), R-5 (confirm a replay that moves already-booked cost),
// INV-9 (no orphan derived rows), INV-10 (delete soft-deletes the event AND reverses its derived
// rows in the same batch).
//
// The shape below is deliberately the create path's, with two REPLACEMENTS swapped in for the two
// INSERT building blocks: `buildReplaceMovementsForSourceStatements` for the kardex and
// `buildReplaceTransactionsForSourceStatements` for the cash side. Both are idempotent
// regenerations keyed on `(source_event_type, source_event_id)` and both net exactly one delta per
// touched item / account, which is what makes "the same purchase, but on the other account" come
// out right on BOTH sides rather than double-counting one of them.
//
// A delete is the same code path with `newMovements = []` and `newTransactions = []` — that is the
// whole difference, and it is why delete needs no reversal arithmetic of its own.
// ============================================================================================

/** A kardex row as the projected-WAC recompute below manipulates it: `ReplayMovement` (what the
 * C-1 replay consumes) plus the sort key that puts the rows in kardex order first. */
interface ProjectedKardexRow extends ReplayMovement {
  occurredAt: string;
  createdAt: string;
}

/** The kardex sort key, IDENTICAL to core/costing/replay.ts's `comparePoints` and repair.ts's
 * `asc(occurredAt), asc(createdAt)`. All three must agree or the synchronous replay, this
 * recompute, and the nightly audit would each settle on a different WAC. */
function compareKardexRows(a: ProjectedKardexRow, b: ProjectedKardexRow): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

/**
 * The post-state `items.wac` for ONE item, computed by replaying its PROJECTED kardex — the rows
 * that will exist once this purchase's movements are replaced by `newMovements`.
 *
 * WHY A FULL REPLAY AND NOT `recordPurchase`'s INCREMENTAL THREADING. C-1 is a weighted average
 * folded forward one entry at a time; it is NOT INVERTIBLE. `recordPurchase` can thread from the
 * currently-stored `items.wac` because a create only ever ADDS an entry to the end. An edit or a
 * delete REMOVES the entries this purchase previously contributed, and there is no arithmetic that
 * backs a specific entry out of a weighted average — the stored WAC simply does not carry enough
 * information. Undoing it requires the history, so this reads the history.
 *
 * Used only for the items the replay plan does NOT own (`plan.replayedItemIds`). When the plan owns
 * an item its own replay is authoritative and this must not run — see the call site.
 *
 * O(kardex) per touched item, deliberately: an edit is rare (the owner correcting an invoice), and
 * the alternative is the `wac_after` cache column ADR-016 §4 rejected — a third place for the WAC
 * to be wrong.
 */
async function computeProjectedWac(
  db: Db,
  itemId: string,
  purchaseId: string,
  newMovements: readonly StockMovementInput[],
  pendingCreatedAt: string,
): Promise<number> {
  const existingRows = await db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
  });

  const projected: ProjectedKardexRow[] = existingRows
    // This purchase's CURRENT movements are about to be deleted by
    // `buildReplaceMovementsForSourceStatements`, so they are not part of the post-state.
    .filter((row) => !(row.sourceEventType === "purchase" && row.sourceEventId === purchaseId))
    .map((row) => ({
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      type: row.type,
      qty: row.qty,
      unitCost: row.unitCost,
    }));

  for (const movement of newMovements) {
    if (movement.itemId !== itemId) continue;
    projected.push({
      occurredAt: movement.occurredAt,
      // The replacement rows do not exist yet; `buildMovementInsert` will stamp them with its own
      // `nowIso()`. Planning against the same pending value keeps this recompute's ordering
      // identical to what actually lands — and matches how replay.ts sorts its pending rows.
      createdAt: pendingCreatedAt,
      type: movement.type,
      qty: movement.qty,
      unitCost: movement.unitCost,
    });
  }

  projected.sort(compareKardexRows);
  return replayWacFrom({ onHand: 0, wac: 0 }, projected).wac;
}

/** A purchase line's C-3 candidate: its unit cost, plus the `(business_date, created_at)` point that
 * decides which candidate is "last". */
interface ReplacementCostCandidate {
  businessDate: string;
  createdAt: string;
  unitCost: number;
}

/** C-3's "last" ordering (Doc 03 §4, as amended in Phase D): last by `business_date`, ties broken by
 * capture order. Strict — equal points are NOT "later". */
function isLaterCandidate(a: ReplacementCostCandidate, b: ReplacementCostCandidate): boolean {
  if (a.businessDate !== b.businessDate) return a.businessDate > b.businessDate;
  return a.createdAt > b.createdAt;
}

/**
 * The latest purchase line for `itemId` among all OTHER purchases (C-3, Doc 03 §4). Soft-deleted
 * purchases are excluded — the create path's `hasLaterDatedPurchaseForItem` already established
 * that a reverted invoice must not keep pinning a price (INV-10 / D-8), and an edit or delete has
 * to honour the same rule from the other direction.
 *
 * `purchase_lines.id` is the final tiebreak because line ids are uuid-v7, generated in command
 * order: within one purchase that lists the same item twice, "last" means the last line, which is
 * exactly what `recordPurchase`'s `lastUnitCost` threading records.
 */
async function findLatestOtherPurchaseLineForItem(
  db: Db,
  itemId: string,
  excludePurchaseId: string,
): Promise<ReplacementCostCandidate | null> {
  const rows = await db
    .select({
      qty: purchaseLines.qty,
      lineTotal: purchaseLines.lineTotal,
      lineId: purchaseLines.id,
      businessDate: purchases.businessDate,
      createdAt: purchases.createdAt,
    })
    .from(purchaseLines)
    .innerJoin(purchases, eq(purchaseLines.purchaseId, purchases.id))
    .where(
      and(
        eq(purchaseLines.itemId, itemId),
        isNull(purchases.deletedAt),
        ne(purchases.id, excludePurchaseId),
      ),
    )
    .orderBy(purchases.businessDate, purchases.createdAt, purchaseLines.id);

  const last = rows.at(-1);
  if (last === undefined) return null;
  return {
    businessDate: last.businessDate,
    createdAt: last.createdAt,
    unitCost: computePurchaseLineUnitCost(last.lineTotal, last.qty),
  };
}

/**
 * C-3 for the post-state: `replacement_cost = last purchase unit cost`, evaluated over the
 * purchases that will exist AFTER this edit/delete commits.
 *
 * Two candidates compete: the latest line from any other live purchase, and — unless this purchase
 * is being deleted or no longer lists the item — this purchase's own edited line. The later
 * `(business_date, created_at)` wins, so an edit that moves a purchase's date BACKWARD correctly
 * yields the floor to a newer invoice instead of clobbering it, and a delete correctly falls back to
 * whatever the previous purchase paid.
 *
 * Returns 0 — `items.replacement_cost`'s schema default — when nothing is left: deleting an item's
 * only purchase leaves no "last purchase unit cost" to name, and a stale price from a reverted
 * invoice is exactly what INV-10 says must not survive.
 */
async function computeReplacementCost(
  db: Db,
  itemId: string,
  purchaseId: string,
  own: ReplacementCostCandidate | null,
): Promise<number> {
  const other = await findLatestOtherPurchaseLineForItem(db, itemId, purchaseId);
  if (own === null) return other?.unitCost ?? 0;
  if (other === null) return own.unitCost;
  // `own` keeps the tie: the create path resolves same-date purchases by capture order and this
  // purchase's `created_at` is compared on exactly that footing.
  return isLaterCandidate(other, own) ? other.unitCost : own.unitCost;
}

/** Canonical identity of one kardex row for the "did the kardex actually change?" comparison below.
 * Covers every column the C-1 replay reads plus both dates, so two movement sets that agree on this
 * key project the same stock, the same WAC and the same `replacement_cost`. Deliberately EXCLUDES
 * `id` and `created_at`, which the regeneration reassigns and which carry no business meaning. */
function movementKey(m: {
  itemId: string;
  occurredAt: string;
  businessDate: string;
  type: string;
  qty: number;
  unitCost: number;
}): string {
  return [m.itemId, m.occurredAt, m.businessDate, m.type, m.qty, m.unitCost].join("|");
}

/** True when `newMovements` describes exactly the kardex rows that already exist for this event —
 * i.e. the edit changed only descriptive fields (notes, supplier, receipt photo). Compared as
 * multisets: a purchase may legitimately list the same item twice at the same price. */
function movementSetsEqual(
  existingRows: readonly {
    itemId: string;
    occurredAt: string;
    businessDate: string;
    type: string;
    qty: number;
    unitCost: number;
  }[],
  newMovements: readonly StockMovementInput[],
): boolean {
  if (existingRows.length !== newMovements.length) return false;
  const a = existingRows.map(movementKey).sort();
  const b = newMovements.map(movementKey).sort();
  return a.every((key, i) => key === b[i]);
}

/** The plan a descriptive-only edit gets: no replay was run, so nothing is owned, nothing is
 * corrected, and nothing needs confirming. Shaped like `planCostingReplay`'s own fast-path return
 * so the code below cannot tell the difference. */
const NO_KARDEX_CHANGE_PLAN: CostingReplayPlan = {
  required: false,
  impact: {
    affectedSaleLineIds: [],
    affectedStockExitIds: [],
    affectedProductionRunIds: [],
    affectedItemIds: [],
    costDelta: 0,
    requiresConfirmation: false,
  },
  replayedItemIds: [],
  confirmationRequired: false,
  statements: [],
};

/** Everything the shared edit/delete commit path needs. `newMovements` / `newTransactions` empty
 * means "this event no longer has a stock or cash effect" — which is precisely a delete. */
interface PurchaseMutationPlan {
  action: "update" | "delete";
  existing: PurchaseRow;
  existingLines: readonly PurchaseLineRow[];
  newRow: PurchaseRow;
  newLines: readonly PurchaseLineRow[];
  newMovements: StockMovementInput[];
  newTransactions: FinancialTransactionInput[];
  confirm: boolean;
  actor: AuditActor;
}

/**
 * The single commit path shared by `updatePurchase` and `deletePurchase`: plans the replay, honours
 * R-5, and executes ONE atomic `db.batch()` (D-3) containing the event write, its regenerated
 * derived rows, the costing correction, and the audit row.
 */
async function commitPurchaseMutation(db: Db, plan: PurchaseMutationPlan): Promise<void> {
  const { existing, newRow, newMovements, newTransactions } = plan;
  const purchaseId = existing.id;
  const now = newRow.updatedAt;

  const existingMovementRows = await db.query.stockMovements.findMany({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.sourceEventType, "purchase"), eqOp(t.sourceEventId, purchaseId)),
  });

  // Does this edit change the KARDEX at all, or only the purchase's descriptive fields?
  //
  // This distinction is load-bearing for R-5, not an optimisation. `planCostingReplay` decides by
  // kardex POSITION — "is there history after the point this event sits at?" — which is the right
  // question for a change that moves stock, and the wrong one for a change that does not. Without
  // this guard, fixing a typo in the supplier name of a three-month-old invoice would compute a
  // replay over every exit since, find those exits' frozen snapshots, and demand the owner confirm
  // a cost correction of exactly zero. She would learn to click through confirmations that mean
  // nothing, which is how R-5's actual warnings stop being read.
  //
  // It also makes the skip below SAFE rather than merely cheap. `buildReplaceMovementsForSource-
  // Statements` regenerates rows with a fresh `created_at`, which is the kardex tiebreak between
  // movements sharing an instant — so replacing an identical movement set is not quite a no-op, it
  // can reorder this purchase against a same-instant movement of another event. Emitting nothing is
  // the only way "nothing changed" is actually true.
  const kardexUnchanged = movementSetsEqual(existingMovementRows, newMovements);

  // ---- INV-11 / R-2 ordering guard (ADR-016 §1) --------------------------------------------
  // Planned against the POST-state movement set, exactly as `recordPurchase` does. The planner
  // itself notes the touched point is the EARLIEST kardex position disturbed across the union of
  // the movements being removed and those being added — so an edit that MOVES a purchase's date is
  // measured from whichever end is earlier, and a delete is measured from where the purchase was.
  // Planned BEFORE any statement is assembled so the R-5 refusal below writes nothing.
  const costingPlan = kardexUnchanged
    ? NO_KARDEX_CHANGE_PLAN
    : await planCostingReplay(db, {
        trigger: {
          eventType: "purchase",
          eventId: purchaseId,
          businessDate: newRow.businessDate,
          occurredAt: newRow.occurredAt,
        },
        changes: [{ sourceEventType: "purchase", sourceEventId: purchaseId, newMovements }],
        actor: plan.actor,
      });

  // R-5, identical to the create path's: refuse BEFORE `db.batch` and hand back the impact preview.
  if (costingPlan.confirmationRequired && plan.confirm !== true) {
    throw conflict(
      plan.action === "delete"
        ? "Eliminar esta compra cambia costos ya calculados de ventas o salidas registradas. Revisa el impacto y confirma para eliminarla."
        : "Esta edición cambia costos ya calculados de ventas o salidas registradas. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: costingPlan.impact },
    );
  }

  const movementStatements = kardexUnchanged
    ? []
    : (await buildReplaceMovementsForSourceStatements(db, "purchase", purchaseId, newMovements))
        .statements;
  // The cash side is replaced unconditionally: `financial_transactions` rows carry no ordering
  // semantics (nothing sorts by their `created_at`), so regenerating an identical row is a genuine
  // no-op that the primitive's own idempotency guarantee already covers.
  const { statements: transactionStatements } = await buildReplaceTransactionsForSourceStatements(
    db,
    "purchase",
    purchaseId,
    newTransactions,
  );

  // Same rule as the create path: exactly ONE of the plan and this service writes each item's WAC,
  // never both, or the batch would carry two conflicting `items` UPDATEs for one row.
  const replayOwnedItemIds = new Set(costingPlan.replayedItemIds);
  const pendingCreatedAt = nowIso();

  // Every item the edit touches on EITHER side: an item dropped from the purchase needs its WAC and
  // replacement cost recomputed just as much as one that was added (INV-9 — no derived state may be
  // left describing lines that no longer exist).
  //
  // Empty when the kardex is unchanged: movement equality covers `occurred_at`, `business_date`,
  // qty and unit cost, so every input to BOTH C-1 and C-3 is provably identical and there is
  // nothing for an `items` UPDATE to say.
  const touchedItemIds = kardexUnchanged
    ? new Set<string>()
    : new Set<string>([
        ...plan.existingLines.map((l) => l.itemId),
        ...plan.newLines.map((l) => l.itemId),
      ]);

  const itemUpdateStatements: Statement[] = [];
  for (const itemId of touchedItemIds) {
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemId),
    });
    if (!itemRow) {
      throw notFound("No se encontró el ítem.", { id: itemId });
    }

    const values: Partial<typeof items.$inferInsert> = {};
    if (!replayOwnedItemIds.has(itemId)) {
      values.wac = await computeProjectedWac(
        db,
        itemId,
        purchaseId,
        newMovements,
        pendingCreatedAt,
      );
    }
    if (itemRow.kind === "RAW_MATERIAL") {
      // C-3 restricts replacement_cost to RAW_MATERIAL, same as the create path.
      //
      // A SOFT-DELETED purchase supplies no candidate at all, even though its lines survive the
      // delete (R-3 keeps them for the 90-day reversal). "Last purchase unit cost" means the last
      // LIVE purchase — the same reading `findLatestOtherPurchaseLineForItem`'s `deleted_at` filter
      // and the create path's `hasLaterDatedPurchaseForItem` both take (INV-10). Without this gate a
      // delete would leave the item pinned to the price of the invoice just reverted.
      const ownLast =
        newRow.deletedAt === null
          ? plan.newLines.filter((l) => l.itemId === itemId).at(-1)
          : undefined;
      const own: ReplacementCostCandidate | null =
        ownLast === undefined
          ? null
          : {
              businessDate: newRow.businessDate,
              createdAt: newRow.createdAt,
              unitCost: computePurchaseLineUnitCost(ownLast.lineTotal, ownLast.qty),
            };
      const replacementCost = await computeReplacementCost(db, itemId, purchaseId, own);
      if (replacementCost !== itemRow.replacementCost) {
        values.replacementCost = replacementCost;
        values.replacementCostUpdatedAt = now;
      }
    }

    if (Object.keys(values).length === 0) continue;
    itemUpdateStatements.push(
      db
        .update(items)
        .set({ ...values, updatedAt: now })
        .where(eq(items.id, itemId)),
    );
  }

  const statements: Statement[] = [
    // The EVENT itself. On delete this carries `deleted_at` (R-3/D-8: the event is soft-deleted;
    // only its DERIVED rows above are hard-replaced, which is the carve-out D-8 names explicitly).
    db
      .update(purchases)
      .set({
        occurredAt: newRow.occurredAt,
        businessDate: newRow.businessDate,
        supplierName: newRow.supplierName,
        sessionId: newRow.sessionId,
        accountId: newRow.accountId,
        total: newRow.total,
        receiptPhotoKey: newRow.receiptPhotoKey,
        notes: newRow.notes,
        deletedAt: newRow.deletedAt,
        updatedAt: newRow.updatedAt,
      })
      .where(eq(purchases.id, purchaseId)),
    // `purchase_lines` are components of the event aggregate, not independently-addressable business
    // events — they carry no `deleted_at` column (Doc 04 §3.3) and only ever exist as the current
    // content of their purchase. Replacing them wholesale is therefore the same regeneration D-8
    // permits, and the full previous content is preserved in the audit row's `before`.
    //
    // A DELETE touches them not at all: the purchase is soft-deleted, so its lines must survive
    // intact for R-3's 90-day reversal. Only the DERIVED rows (kardex, cash) are removed.
    ...(plan.action === "update"
      ? [
          db.delete(purchaseLines).where(eq(purchaseLines.purchaseId, purchaseId)),
          ...plan.newLines.map((row) => db.insert(purchaseLines).values(row)),
        ]
      : []),
    ...movementStatements,
    ...itemUpdateStatements,
    ...transactionStatements,
    buildAuditLogInsert(db, {
      actor: plan.actor,
      action: plan.action,
      entityType: "purchases",
      entityId: purchaseId,
      // R-1 / INV-10: the complete event, lines included, on both sides — this is the record that
      // makes a delete reversible for 90 days (R-3), so a partial snapshot would not be enough.
      before: { ...existing, lines: plan.existingLines },
      after: { ...newRow, lines: plan.newLines },
    }),
    // LAST, and specifically after `movementStatements` — replay.ts's module header states this
    // requirement: the `item_stock` upsert there recomputes `negative_since` incrementally from its
    // own delta, while the plan's is the authoritative recomputation over the whole projected kardex
    // and must land last to win. Empty on the fast path.
    ...costingPlan.statements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);
}

/** Loads a purchase and its lines for mutation, refusing one that is missing or already
 * soft-deleted (INV-10: a reverted event is not editable — re-recording is the correction path). */
async function loadPurchaseForMutation(
  db: Db,
  id: string,
): Promise<{ row: PurchaseRow; lines: PurchaseLineRow[] }> {
  const row = await db.query.purchases.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(t.id, id), isNullOp(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la compra.", { id });
  }
  const lines = await db.query.purchaseLines.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.purchaseId, id),
  });
  return { row, lines };
}

/** The system-owned EXPENSE/SUPPLY_PURCHASE cash row a purchase projects, or none when it moved no
 * cash. `amount > 0` is a CHECK constraint (Doc 04 §3.4), so a fully-free purchase (total 0) has no
 * transaction at all — the same rule `recordPurchase` applies. */
function buildPurchaseTransactionInputs(row: PurchaseRow): FinancialTransactionInput[] {
  if (row.total <= 0) return [];
  return [
    {
      occurredAt: row.occurredAt,
      businessDate: row.businessDate,
      accountId: row.accountId,
      type: "EXPENSE",
      category: "SUPPLY_PURCHASE",
      amount: row.total,
      description: null,
      sourceEventType: "purchase",
      sourceEventId: row.id,
    },
  ];
}

/** Re-reads an account AFTER the mutation batch. Deliberately not arithmetic on the pre-state like
 * `recordPurchase` does: an edit can move a purchase between accounts, so the balance is the net of
 * a reversal and a new effect that `buildReplaceTransactionsForSourceStatements` owns. Reading the
 * committed row is the one answer that cannot disagree with what was actually written. */
async function readAccountDtoOrThrow(db: Db, accountId: string) {
  const row = await db.query.financialAccounts.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, accountId),
  });
  if (!row) {
    throw notFound("No se encontró la cuenta.", { accountId });
  }
  return toAccountDto(row);
}

/**
 * UC-01 edit (R-1): replaces a purchase's content and regenerates every row derived from it — the
 * kardex, `item_stock`, the WAC, `replacement_cost`, the cash transaction and the account balances —
 * in ONE atomic batch (D-3). See this section's header for the shape.
 *
 * The command is a FULL REPLACEMENT, not a patch: `command.lines` becomes the purchase's complete
 * line set, and `total` is re-derived server-side as Σ lineTotal (Doc 04 §5), never accepted from
 * the caller — identical to the create path.
 */
export async function updatePurchase(
  db: Db,
  id: string,
  command: UpdatePurchaseCommand,
  actor: AuditActor,
): Promise<UpdatePurchaseResult> {
  // Defensive re-check (core/ services never trust a caller already ran Zod, D-2).
  if (command.lines.length === 0) {
    throw validationError("Se requiere al menos una línea de compra.", {});
  }

  const { row: existing, lines: existingLines } = await loadPurchaseForMutation(db, id);
  // The DESTINATION account must be active, exactly as on create. The OLD account is deliberately
  // NOT checked: money already left it, and refusing to correct an invoice because the account it
  // was booked against has since been archived would strand the error permanently.
  await findActiveAccountRowOrThrow(db, command.accountId);

  const now = nowIso();
  const total = addMoney(...command.lines.map((l) => l.lineTotal));

  const newRow: PurchaseRow = {
    ...existing,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    supplierName: command.supplierName ?? null,
    sessionId: command.sessionId ?? null,
    accountId: command.accountId,
    total,
    receiptPhotoKey: command.receiptPhotoKey ?? null,
    notes: command.notes ?? null,
    deletedAt: null,
    updatedAt: now,
  };

  const newLines: PurchaseLineRow[] = command.lines.map((line) => ({
    id: generateUuidV7(),
    purchaseId: id,
    itemId: line.itemId,
    qty: line.qty,
    lineTotal: line.lineTotal,
  }));

  // The post-state kardex for this purchase. Unit cost is re-derived per line (D-5 — never carried
  // over from the previous generation, which may have had different quantities entirely).
  const newMovements: StockMovementInput[] = newLines.map((line) => ({
    itemId: line.itemId,
    occurredAt: newRow.occurredAt,
    businessDate: newRow.businessDate,
    type: "PURCHASE_IN",
    qty: line.qty,
    unitCost: computePurchaseLineUnitCost(line.lineTotal, line.qty),
    sourceEventType: "purchase",
    sourceEventId: id,
  }));

  await commitPurchaseMutation(db, {
    action: "update",
    existing,
    existingLines,
    newRow,
    newLines,
    newMovements,
    newTransactions: buildPurchaseTransactionInputs(newRow),
    confirm: command.confirm === true,
    actor,
  });

  return {
    purchase: toPurchaseDto(newRow, newLines),
    account: await readAccountDtoOrThrow(db, newRow.accountId),
  };
}

/**
 * UC-01 delete (R-3 / INV-10): soft-deletes the purchase and reverses everything derived from it in
 * ONE atomic batch (D-3) — the kardex rows and cash transaction are removed outright (the D-8
 * carve-out for derived-row regeneration), `item_stock` and the account balance are netted back, and
 * the WAC is recomputed as though the purchase had never happened.
 *
 * INV-8: deleting a purchase whose stock was ALREADY CONSUMED is permitted and will drive the item's
 * `qty_on_hand` negative. That is not an error here and must never become one — INV-8 states stock
 * MAY go negative and that a negative balance raises a persistent reconciliation flag, never a
 * blocking error. The capture-first premise depends on it: the owner correcting a wrongly-recorded
 * invoice cannot be told to first un-sell what she already sold. `item_stock.negative_since` is set
 * by the same statements that net the balance, so the reconciliation flag fires on its own.
 */
export async function deletePurchase(
  db: Db,
  id: string,
  command: DeletePurchaseCommand,
  actor: AuditActor,
): Promise<DeletePurchaseResult> {
  const { row: existing, lines: existingLines } = await loadPurchaseForMutation(db, id);

  const now = nowIso();
  const newRow: PurchaseRow = { ...existing, deletedAt: now, updatedAt: now };

  await commitPurchaseMutation(db, {
    action: "delete",
    existing,
    existingLines,
    newRow,
    // A deleted purchase projects NOTHING: no lines, no kardex rows, no cash row. Every reversal
    // below falls out of the replacement primitives netting an empty new set against the old one.
    newLines: existingLines,
    newMovements: [],
    newTransactions: [],
    confirm: command.confirm === true,
    actor,
  });

  return {
    purchase: toPurchaseDto(newRow, existingLines),
    account: await readAccountDtoOrThrow(db, existing.accountId),
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
