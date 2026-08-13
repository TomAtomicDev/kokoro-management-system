// core/sales — UC-03 "Record catalog sale" (KOK-030, Doc 03 UC-03, Doc 04 §3.3 `sales`/`sale_lines`
// + §5) + UC-18 edit/delete/restore (KOK-064, Doc 03 §7 R-1/R-3/R-5). Same TEMPLATE shape as
// core/purchasing/index.ts (see that module's header): a top-level command entry point, not a
// building block — it does its own defensive validation, builds every row itself, and executes
// exactly ONE atomic `db.batch()` (D-3) containing:
//   - the `sales` + `sale_lines` inserts (the event itself)
//   - the SALE_OUT `stock_movements` + `item_stock` upserts (core/inventory's
//     buildStockMovementStatements — negative stock is ALLOWED, never an error: INV-8)
//   - (PAID only) the account balance CREDIT (core/finance's buildAccountBalanceDelta) + the
//     system-owned INCOME/SALE `financial_transactions` row (sourceEventType/Id set to the sale, per
//     Doc 04 §5). ON_CREDIT books NO cash at sale time — the receivable is collected later (KOK-031).
//   - the `audit_log` row (core/audit's buildAuditLogInsert)
//   - (KOK-064) whatever `planCostingReplay` returns when the sale is BACKDATED.
//
// A sale is stock-wise IDENTICAL to a non-commercial exit (core/inventory/exits.ts): a SALE_OUT is
// an OUT movement that FREEZES its cost at the item's CURRENT WAC (`unit_cost_snapshot`) and NEVER
// mutates that WAC (C-6 spirit / R-4 — the per-line margin is frozen forever). Do NOT add an
// `items.wac` UPDATE of this module's own here — that would corrupt WAC. What a sale adds ON TOP of
// an exit is the CASH side: a PAID sale credits an account and books income, mirroring how
// recordPurchase debits one.
//
// `planCostingReplay` IS NOW CALLED (KOK-064; previously deliberately absent — see
// docs/development/kok-030-sales-end-to-end.md §2's history). `sale` is a modelled
// `costing_adjustments.trigger_event_type` (Doc 04 §3.4) as of migration
// `0004_allow_sale_costing_trigger.sql`: a sale being stock-wise identical to a stock exit means a
// backdated sale re-weights C-1 for every later entry exactly like a backdated exit does. So
// `recordSale`/`updateSale`/`deleteSale`/`restoreSale` all run the same INV-11/R-2 ordering guard
// `recordPurchase`/`recordExit` do, gated by the same `confirm` flag.
//
// EDIT/DELETE/RESTORE (KOK-064) are shaped like `core/inventory/exits.ts`'s, NOT like
// `core/purchasing`'s: like an exit (C-6), a sale never owns `items.wac`/`replacement_cost`, so
// `commitSaleMutation` carries no `items` UPDATE of its own — the only `items.wac` writes a sale
// mutation can produce come from `planCostingReplay`'s own statements, and only when the sale is
// backdated. The cash side (PAID's INCOME/SALE row) IS regenerated on edit/delete/restore, mirroring
// `core/purchasing`'s `buildReplaceTransactionsForSourceStatements` usage — exits have no cash side
// to regenerate, purchases always have one; a sale has one only conditionally (PAID).
//
// ONE GUARD NEITHER PURCHASES NOR EXITS HAVE: `updateSale`/`deleteSale` refuse (409 CONFLICT) once a
// sale has already been collected via `collectPayment` (KOK-031) — i.e. it carries a
// `financial_transactions` row with `category='DEBT_COLLECTION'` sourced to it
// (`assertSaleNotCollected`). `collectPayment` books that row at the COLLECTION moment, independent
// of the sale's own `occurred_at`/`accountId`/`paymentMethod`; a full-replacement edit that
// regenerated it the way `updatePurchase` regenerates its own transaction would silently overwrite
// the true collection date/category with a fresh SALE-category row dated at the sale's own
// `occurred_at` — a financial-history regression, not a correction. See
// docs/development/kok-030-sales-end-to-end.md §1 for the full reasoning. `restoreSale` needs no
// equivalent guard: `collectPayment` requires a non-deleted sale, so a soft-deleted sale can never
// have been collected while deleted.
//
// Every line's `unit_cost_snapshot` is taken FRESH from the item's current WAC on every `updateSale`
// (reusing `resolveLineSnapshots`, identical to the create path) rather than preserved per-line like
// `updateStockExit`'s single-line policy — `updateSaleCommandSchema` is a full line-set replacement
// with no line ids to match "same line, corrected qty" against, so there is no unambiguous "this is
// the same line" to preserve a snapshot for. This is not an R-4 violation: R-4 governs a REPLAY never
// rewriting a frozen snapshot, not an owner's deliberate edit of the event's own stored content —
// exactly as `updatePurchase` freshly recomputes each line's unit cost from its (possibly edited)
// `lineTotal`/`qty` rather than carrying over a prior generation's value. `restoreSale` is the
// opposite: it reuses each line's STORED `unit_cost_snapshot` verbatim (mirrors
// `restoreStockExit`/`restorePurchase` — undo brings back exactly what was deleted, not a
// freshly-priced version of it).

import type {
  AuditActor,
  CollectPaymentCommand,
  CollectPaymentResult,
  DeleteSaleCommand,
  DeleteSaleResult,
  ListReceivablesResult,
  ListSalesFilters,
  ListSalesResult,
  MilliCentavosPerUnit,
  ReceivableDto,
  RecordSaleCommand,
  RecordSaleResult,
  ReplayImpactDto,
  SaleDto,
  SaleImpactRequest,
  SaleLineDto,
  UpdateSaleCommand,
  UpdateSaleResult,
} from "@kokoro/shared";
import {
  addMoney,
  generateUuidV7,
  nowIso,
  REPLAY_CONFIRMATION_REQUIRED,
  subMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialTransactions, saleLines, sales } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import type { CostingReplayPlan } from "../costing/replay.js";
import { planCostingReplay } from "../costing/replay.js";
import { snapshotUnitCost } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
import type { FinancialTransactionInput } from "../finance/accounts.js";
import {
  assertPaymentMethodMatchesAccountType,
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
type SaleRow = typeof sales.$inferSelect;
type SaleLineRow = typeof saleLines.$inferSelect;
type FinancialAccountRow = Awaited<ReturnType<typeof findActiveAccountRowOrThrow>>;

function toSaleDto(row: SaleRow, lineRows: readonly SaleLineRow[]): SaleDto {
  const lines: SaleLineDto[] = lineRows.map((l) => ({
    id: l.id,
    itemId: l.itemId,
    qty: l.qty,
    unitPriceMc: toMilliCentavosPerUnit(l.unitPriceMc),
    unitCostSnapshotMc: l.unitCostSnapshotMc,
  }));
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    businessDate: row.businessDate,
    channel: row.channel,
    customOrderId: row.customOrderId,
    customerId: row.customerId,
    sessionId: row.sessionId,
    total: row.total,
    paymentStatus: row.paymentStatus,
    paidAt: row.paidAt,
    paymentMethod: row.paymentMethod,
    accountId: row.accountId,
    notes: row.notes,
    lines,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The current WAC to freeze onto each of a sale's lines, one lookup per DISTINCT item. Every line for
 * the same item snapshots the SAME value: a sale never mutates WAC (C-6 spirit), so the WAC does not
 * change between two lines of one sale. Validates each item exists AND is `kind='FINISHED'`
 * (Doc 04 §5 / §3.3's service-enforced rule — there is no DB CHECK for it): selling any other
 * item kind is a VALIDATION error, not a NOT_FOUND.
 */
async function resolveLineSnapshots(
  db: Db,
  command: RecordSaleCommand,
): Promise<Map<string, MilliCentavosPerUnit>> {
  const snapshotByItem = new Map<string, MilliCentavosPerUnit>();
  for (const itemId of new Set(command.lines.map((l) => l.itemId))) {
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemId),
    });
    if (!itemRow) {
      throw notFound("No se encontró el ítem.", { id: itemId });
    }
    if (itemRow.kind !== "FINISHED") {
      throw validationError("Solo se pueden vender ítems terminados (FINISHED).", {
        itemId,
        kind: itemRow.kind,
      });
    }
    // C-6: value at the item's CURRENT WAC, snapshotted onto the sale line's own
    // unit_cost_snapshot_mc — never recomputed via applyWacEntry (that is only for entries).
    snapshotByItem.set(itemId, snapshotUnitCost(toMilliCentavosPerUnit(itemRow.wacMc)));
  }
  return snapshotByItem;
}

/**
 * Builds the create path's post-state: the fresh-snapshotted `saleLineRows`, this sale's SALE_OUT
 * `movements`, its `saleRow`, and the validated destination `account` (PAID only) — everything
 * `recordSale` needs to keep assembling its batch, and everything `previewSaleImpact`'s "create" dry
 * run needs to call `planCostingReplay` with. Extracted (KOK-064, mirrors
 * `buildPurchaseCreateMovements`/`buildRecordExitMovement`) so the two can never build these inputs
 * differently — this module's header: "the preview and the mutation it previews must run the exact
 * same planner, or the preview is a lie with a UI around it." Pure construction; never calls
 * `db.batch()`.
 */
async function buildSaleCreateMovements(
  db: Db,
  command: RecordSaleCommand,
): Promise<{
  account: FinancialAccountRow | null;
  saleId: string;
  now: string;
  movements: StockMovementInput[];
  saleLineRows: SaleLineRow[];
  total: number;
  saleRow: SaleRow;
}> {
  // Defensive re-check (core/ services never trust a caller already ran Zod, D-2) — mirrors
  // recordSaleCommandSchema's `.min(1)` on `lines`.
  if (command.lines.length === 0) {
    throw validationError("Se requiere al menos una línea de venta.", {});
  }

  // The credited account (PAID only) must be active — same precedent as recordPurchase. Validated
  // before the batch is assembled so a bad account fails without writing anything.
  let account: FinancialAccountRow | null = null;
  if (command.paymentStatus === "PAID") {
    account = await findActiveAccountRowOrThrow(db, command.accountId);
    assertPaymentMethodMatchesAccountType(command.paymentMethod, account);
  }

  const snapshotByItem = await resolveLineSnapshots(db, command);

  const saleId = generateUuidV7();
  const now = nowIso();

  const movements: StockMovementInput[] = [];
  const saleLineRows: SaleLineRow[] = [];
  const lineTotals: number[] = [];
  for (const line of command.lines) {
    const unitCostSnapshotMc = snapshotByItem.get(line.itemId);
    if (unitCostSnapshotMc === undefined) {
      // Unreachable: snapshotByItem was seeded from the same distinct itemIds as command.lines.
      throw validationError("Estado interno de venta inconsistente.", { itemId: line.itemId });
    }

    // Doc 04 §5: the per-line money total is qty (milli-units) × unit_price (centavos/whole unit),
    // rounded to whole centavos — mulMoneyByQty is exactly that. Summed into the sale total below.
    lineTotals.push(
      totalCentavos(toMilliCentavosPerUnit(line.unitPriceMc), toMilliUnits(line.qty)),
    );

    saleLineRows.push({
      id: generateUuidV7(),
      saleId,
      itemId: line.itemId,
      qty: line.qty,
      unitPriceMc: line.unitPriceMc,
      unitCostSnapshotMc,
    });

    movements.push({
      itemId: line.itemId,
      occurredAt: command.occurredAt,
      businessDate: command.businessDate,
      type: "SALE_OUT",
      // sale_lines.qty is stored POSITIVE (its own CHECK); the OUT sign convention is applied only
      // here, at the movements boundary — identically to core/inventory/exits.ts.
      qty: -line.qty,
      unitCostMc: unitCostSnapshotMc,
      sourceEventType: "sale",
      sourceEventId: saleId,
    });
  }

  // Server-recomputed, never trusted from the caller (Doc 04 §5) — recordSaleCommandSchema has no
  // `total` field, so this is the only place a sale's total is produced.
  const total = addMoney(...lineTotals.map(toCentavos));

  const isPaid = command.paymentStatus === "PAID";
  const saleRow: SaleRow = {
    id: saleId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    channel: "CATALOG",
    customOrderId: null,
    customerId: command.customerId ?? null,
    sessionId: command.sessionId ?? null,
    total,
    paymentStatus: command.paymentStatus,
    // A PAID sale was paid at the moment it occurred; an ON_CREDIT sale's paid_at stays null until
    // collectPayment (KOK-031) sets it.
    paidAt: isPaid ? command.occurredAt : null,
    paymentMethod: command.paymentStatus === "PAID" ? command.paymentMethod : null,
    accountId: command.paymentStatus === "PAID" ? command.accountId : null,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return { account, saleId, now, movements, saleLineRows, total, saleRow };
}

/**
 * UC-03: record one multi-line catalog sale in one atomic batch (D-3). See this module's header for
 * the full statement list. FINISHED-only line validation, per-line WAC snapshot frozen at sale
 * time, SALE_OUT movements (negative stock allowed, INV-8), income transaction when PAID / receivable when
 * ON_CREDIT, and `total` server-recomputed as Σ(qty × unit_price) (Doc 04 §5).
 */
export async function recordSale(
  db: Db,
  command: RecordSaleCommand,
  actor: AuditActor,
): Promise<RecordSaleResult> {
  const { account, saleId, now, movements, saleLineRows, total, saleRow } =
    await buildSaleCreateMovements(db, command);

  // ---- INV-11 / R-2 ordering guard (ADR-016 §1, KOK-064) ------------------------------------
  // A sale is not exempt from the replay just because it is a CREATE — recording today's production
  // and only then backdating an earlier sale is the same ordinary-Tuesday scenario
  // core/purchasing's recordPurchase guards against. Planned BEFORE the batch is assembled so the
  // R-5 refusal below can happen before a single write.
  const plan = await planCostingReplay(db, {
    trigger: {
      eventType: "sale",
      eventId: saleId,
      businessDate: command.businessDate,
      occurredAt: command.occurredAt,
    },
    changes: [{ sourceEventType: "sale", sourceEventId: saleId, newMovements: movements }],
    actor,
  });

  // R-5: the replay would move cost already booked against a recorded sale/exit/production run.
  // Refuse — before `db.batch`, so nothing is written — and hand the caller the impact it needs to
  // render the preview and re-submit with `confirm: true`. Identical contract to recordPurchase's.
  if (plan.confirmationRequired && command.confirm !== true) {
    throw conflict(
      "Esta venta tiene fecha anterior a movimientos ya registrados y cambia costos ya calculados. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: plan.impact },
    );
  }

  const { statements: movementStatements } = buildStockMovementStatements(db, movements);

  // financial_transactions.amount is always > 0 (Doc 04 §3.4's CHECK). A PAID sale whose total is 0
  // (all-giveaway lines) moved no cash, so it books no income row — mirrors recordPurchase's
  // total===0 skip. An ON_CREDIT sale books nothing here regardless: the money arrives via
  // collectPayment (KOK-031), and until then the sale sits in v_receivables.
  const financialStatements: Statement[] = [];
  if (command.paymentStatus === "PAID" && total > 0) {
    financialStatements.push(
      buildAccountBalanceDelta(db, command.accountId, total),
      db.insert(financialTransactions).values({
        id: generateUuidV7(),
        occurredAt: command.occurredAt,
        businessDate: command.businessDate,
        accountId: command.accountId,
        type: "INCOME" as const,
        category: "SALE" as const,
        amount: total,
        counterpartTxId: null,
        sourceEventType: "sale",
        sourceEventId: saleId,
        description: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  const statements: Statement[] = [
    db.insert(sales).values(saleRow),
    ...saleLineRows.map((row) => db.insert(saleLines).values(row)),
    ...movementStatements,
    ...financialStatements,
    // Intentionally NO items.wac update — a sale freezes its cost snapshot but never moves WAC
    // (C-6 spirit) — see this module's header.
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "sales",
      entityId: saleId,
      before: null,
      after: saleRow,
    }),
    // R-2: the replay lands in THIS batch, not a second one (D-3). LAST on purpose, and specifically
    // after `movementStatements` (replay.ts's module header states this requirement). Empty on the
    // fast path (the overwhelmingly common ordinary same-day sale).
    ...plan.statements,
  ];

  // `statements` always starts with the fixed sales insert, so it is never empty — same cast
  // technique as core/purchasing/index.ts's recordPurchase, for the same reason.
  await db.batch(statements as [Statement, ...Statement[]]);

  return {
    sale: toSaleDto(saleRow, saleLineRows),
    account:
      account !== null
        ? toAccountDto({
            ...account,
            balance: addMoney(toCentavos(account.balance), toCentavos(total)),
          })
        : null,
  };
}

// ============================================================================================
// UC-18 EDIT / DELETE / RESTORE (KOK-064) — Doc 03 §7 R-1 (edit regenerates derived rows in ONE
// batch), R-3 (deletions are soft), R-5 (confirm a replay that moves already-booked cost), INV-9
// (no orphan derived rows), INV-10 (delete soft-deletes the event AND reverses its derived rows in
// the same batch). See this module's header for how this shape differs from both
// `core/purchasing`'s and `core/inventory/exits.ts`'s.
// ============================================================================================

/** Refuses (409 CONFLICT) once `saleId` has already been collected via `collectPayment` (KOK-031) —
 * i.e. it carries a `financial_transactions` row with `category='DEBT_COLLECTION'` sourced to it.
 * See this module's header for why an edit/delete must not reach a collected sale. */
export async function assertSaleNotCollected(db: Db, saleId: string): Promise<void> {
  const collected = await db.query.financialTransactions.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(
        eqOp(t.sourceEventType, "sale"),
        eqOp(t.sourceEventId, saleId),
        eqOp(t.category, "DEBT_COLLECTION"),
      ),
  });
  if (collected) {
    throw conflict(
      "Esta venta ya fue cobrada; no se puede editar ni eliminar. Corrige el cobro por separado.",
      { id: saleId },
    );
  }
}

/** Loads the live (non-soft-deleted), NOT-YET-COLLECTED `sales` row an edit/delete targets, or
 * throws NOT_FOUND / CONFLICT. Mirrors `core/purchasing`'s `loadPurchaseForMutation` plus the
 * collected-sale guard folded in, so both `updateSale` and `deleteSale` (and `previewSaleImpact`'s
 * matching branches, which call this same loader) enforce it identically. */
async function loadSaleForMutation(
  db: Db,
  id: string,
): Promise<{ row: SaleRow; lines: SaleLineRow[] }> {
  const row = await db.query.sales.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull }) => andOp(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la venta.", { id });
  }
  // KOK-033: a CUSTOM_ORDER sale is DERIVED — `deliverOrder` (O-2) created it from the order's
  // agreed total and lines, and `custom_orders.sale_id` points back at it. Editing or deleting it
  // here would desynchronize the two (a changed total would no longer match `agreed_total`; a
  // delete would strand `sale_id` and silently un-release the deposit liability, INV-7) and would
  // rewrite the order's own ORDER_BALANCE row into a plain SALE one. Doc 04 §5's "transitions only
  // along the state machine" applies to everything the order owns, this sale included.
  if (row.channel === "CUSTOM_ORDER") {
    throw conflict(
      "Esta venta pertenece a un pedido; corrígela desde el pedido, no desde ventas.",
      { id, customOrderId: row.customOrderId },
    );
  }
  await assertSaleNotCollected(db, id);
  const lines = await db.query.saleLines.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.saleId, id),
  });
  return { row, lines };
}

/** The system-owned INCOME/SALE cash row a sale projects, or none when it moved no cash (ON_CREDIT,
 * or a PAID sale whose total is 0). Mirrors `core/purchasing`'s `buildPurchaseTransactionInputs`.
 * Only ever called for a row that passed `assertSaleNotCollected` (update/delete/restore all load
 * through `loadSaleForMutation` or, for restore, a sale that structurally cannot be collected — see
 * this module's header), so a PAID row reaching here is always PAID-AT-CREATION (SALE category),
 * never a collected sale's DEBT_COLLECTION — `accountId` is therefore always set for it, but this
 * still asserts rather than trusts, mirroring D-2's "core/ services never trust prior validation". */
function buildSaleTransactionInputs(row: SaleRow): FinancialTransactionInput[] {
  if (row.paymentStatus !== "PAID" || row.total <= 0) return [];
  if (row.accountId === null) {
    throw validationError("Una venta pagada requiere una cuenta.", { saleId: row.id });
  }
  return [
    {
      occurredAt: row.occurredAt,
      businessDate: row.businessDate,
      accountId: row.accountId,
      type: "INCOME",
      category: "SALE",
      amount: row.total,
      description: null,
      sourceEventType: "sale",
      sourceEventId: row.id,
    },
  ];
}

/** Turns a sale's post-state `lines` into their SALE_OUT kardex movements, reusing whatever
 * `unit_cost_snapshot` is already stamped on each line — the boundary between `updateSale` (which
 * stamps a FRESH snapshot per line before calling this, see this module's header) and `restoreSale`
 * (which passes the lines' STORED snapshot verbatim, unchanged) lives entirely in what the caller
 * passes in, not in this function. Mirrors `core/purchasing`'s
 * `buildPurchaseInMovementsFromLines`. */
function buildSaleOutMovementsFromLines(
  saleId: string,
  lines: readonly SaleLineRow[],
  occurredAt: string,
  businessDate: string,
): StockMovementInput[] {
  return lines.map((line) => ({
    itemId: line.itemId,
    occurredAt,
    businessDate,
    type: "SALE_OUT",
    // Positive on the event row, negative in the kardex — same convention as recordSale.
    qty: -line.qty,
    unitCostMc: toMilliCentavosPerUnit(line.unitCostSnapshotMc),
    sourceEventType: "sale",
    sourceEventId: saleId,
  }));
}

/** Canonical identity of one kardex row for the "did the kardex actually change?" comparison below —
 * identical shape to `core/purchasing/index.ts`'s `movementKey` (private, duplicated per this
 * codebase's established convention — see `core/inventory/exits.ts`'s copy for another instance).
 * Deliberately EXCLUDES `id` and `created_at`, which the regeneration reassigns and which carry no
 * business meaning. */
function movementKey(m: {
  itemId: string;
  occurredAt: string;
  businessDate: string;
  type: string;
  qty: number;
  unitCostMc: number;
}): string {
  return [m.itemId, m.occurredAt, m.businessDate, m.type, m.qty, m.unitCostMc].join("|");
}

/** True when `newMovements` describes exactly the kardex rows that already exist for this sale —
 * i.e. the edit changed only descriptive fields (customerId/sessionId/notes) or the cash side only.
 * Compared as multisets: a sale may legitimately list the same item twice. Identical reasoning to
 * `core/purchasing/index.ts`'s `movementSetsEqual`. */
function movementSetsEqual(
  existingRows: readonly {
    itemId: string;
    occurredAt: string;
    businessDate: string;
    type: string;
    qty: number;
    unitCostMc: number;
  }[],
  newMovements: readonly StockMovementInput[],
): boolean {
  if (existingRows.length !== newMovements.length) return false;
  const a = existingRows.map(movementKey).sort();
  const b = newMovements.map(movementKey).sort();
  return a.every((key, i) => key === b[i]);
}

/** The plan a descriptive-only edit gets: no replay was run, so nothing is owned, nothing is
 * corrected, and nothing needs confirming. Identical shape to `core/purchasing/index.ts`'s
 * `NO_KARDEX_CHANGE_PLAN`, duplicated locally for the same reason. */
const NO_KARDEX_CHANGE_PLAN: CostingReplayPlan = {
  required: false,
  impact: {
    affectedSaleLineIds: [],
    affectedStockExitIds: [],
    affectedProductionRunIds: [],
    affectedAssemblyIds: [],
    affectedItemIds: [],
    costDelta: 0,
    requiresConfirmation: false,
  },
  replayedItemIds: [],
  confirmationRequired: false,
  statements: [],
};

/**
 * Plans the costing replay ONE pending update/delete/restore implies (R-2/R-5), skipping it entirely
 * when the kardex is provably unchanged (KOK-066's guard, applied here from the start rather than as
 * a follow-up fix — see `core/inventory/exits.ts`'s header for why this guard is load-bearing for
 * R-5, not merely an optimisation). SHARED, verbatim, between `commitSaleMutation` and
 * `previewSaleImpact`'s "update"/"delete" dry run.
 */
export async function planSaleMutationCostingImpact(
  db: Db,
  saleId: string,
  newRow: Pick<SaleRow, "businessDate" | "occurredAt">,
  newMovements: readonly StockMovementInput[],
  actor: AuditActor,
): Promise<{ kardexUnchanged: boolean; costingPlan: CostingReplayPlan }> {
  const existingMovementRows = await db.query.stockMovements.findMany({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.sourceEventType, "sale"), eqOp(t.sourceEventId, saleId)),
  });

  const kardexUnchanged = movementSetsEqual(existingMovementRows, newMovements);

  const costingPlan = kardexUnchanged
    ? NO_KARDEX_CHANGE_PLAN
    : await planCostingReplay(db, {
        trigger: {
          eventType: "sale",
          eventId: saleId,
          businessDate: newRow.businessDate,
          occurredAt: newRow.occurredAt,
        },
        changes: [
          { sourceEventType: "sale", sourceEventId: saleId, newMovements: [...newMovements] },
        ],
        actor,
      });

  return { kardexUnchanged, costingPlan };
}

/** Everything the shared edit/delete/restore commit path needs. `newMovements`/`newTransactions`
 * empty means "this event no longer has a stock or cash effect" — which is precisely a delete; a
 * restore is the mirror image. Mirrors `core/purchasing`'s `PurchaseMutationPlan`. */
interface SaleMutationPlan {
  action: "update" | "delete" | "restore";
  existing: SaleRow;
  existingLines: readonly SaleLineRow[];
  newRow: SaleRow;
  newLines: readonly SaleLineRow[];
  newMovements: StockMovementInput[];
  newTransactions: FinancialTransactionInput[];
  confirm: boolean;
  actor: AuditActor;
}

/**
 * The single commit path shared by `updateSale`, `deleteSale`, and `restoreSale`: plans the replay,
 * honours R-5, and executes ONE atomic `db.batch()` (D-3) containing the event write, its
 * regenerated derived rows (kardex + cash), the costing correction, and the audit row. Carries NO
 * `items` UPDATE of its own — see this module's header for why a sale mutation never owns
 * `items.wac`/`replacement_cost`.
 */
async function commitSaleMutation(db: Db, plan: SaleMutationPlan): Promise<void> {
  const { existing, newRow, newMovements, newTransactions } = plan;
  const saleId = existing.id;

  const { kardexUnchanged, costingPlan } = await planSaleMutationCostingImpact(
    db,
    saleId,
    newRow,
    newMovements,
    plan.actor,
  );

  // R-5, identical contract to core/purchasing's: refuse BEFORE `db.batch` and hand back the impact.
  if (costingPlan.confirmationRequired && plan.confirm !== true) {
    throw conflict(
      plan.action === "delete"
        ? "Eliminar esta venta cambia costos ya calculados de ventas o salidas registradas. Revisa el impacto y confirma para eliminarla."
        : plan.action === "restore"
          ? "Restaurar esta venta cambia costos ya calculados de ventas o salidas registradas. Revisa el impacto y confirma para restaurarla."
          : "Esta edición cambia costos ya calculados de ventas o salidas registradas. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: costingPlan.impact },
    );
  }

  const movementStatements = kardexUnchanged
    ? []
    : (await buildReplaceMovementsForSourceStatements(db, "sale", saleId, newMovements)).statements;

  // The cash side is replaced unconditionally, mirroring core/purchasing's rationale:
  // financial_transactions rows carry no ordering semantics, so regenerating an identical row (or
  // regenerating "no row" when the sale is/became ON_CREDIT) is a genuine no-op the primitive's own
  // idempotency guarantee already covers.
  const { statements: transactionStatements } = await buildReplaceTransactionsForSourceStatements(
    db,
    "sale",
    saleId,
    newTransactions,
  );

  const statements: Statement[] = [
    // The EVENT itself. On delete this carries `deleted_at` (R-3/D-8). `channel`/`custom_order_id`
    // are deliberately NOT in this SET list — they are immutable via this path (a catalog sale
    // recorded by this module never becomes a CUSTOM_ORDER sale, or vice versa).
    db
      .update(sales)
      .set({
        occurredAt: newRow.occurredAt,
        businessDate: newRow.businessDate,
        customerId: newRow.customerId,
        sessionId: newRow.sessionId,
        total: newRow.total,
        paymentStatus: newRow.paymentStatus,
        paidAt: newRow.paidAt,
        paymentMethod: newRow.paymentMethod,
        accountId: newRow.accountId,
        notes: newRow.notes,
        deletedAt: newRow.deletedAt,
        updatedAt: newRow.updatedAt,
      })
      .where(eq(sales.id, saleId)),
    // `sale_lines` are components of the event aggregate, not independently-addressable business
    // events — no `deleted_at` column (Doc 04 §3.3), replaced wholesale on UPDATE only. A DELETE
    // touches them not at all: the sale is soft-deleted, so its lines survive intact for R-3's
    // 90-day reversal (mirrors core/purchasing's identical rule).
    ...(plan.action === "update"
      ? [
          db.delete(saleLines).where(eq(saleLines.saleId, saleId)),
          ...plan.newLines.map((row) => db.insert(saleLines).values(row)),
        ]
      : []),
    ...movementStatements,
    ...transactionStatements,
    buildAuditLogInsert(db, {
      actor: plan.actor,
      action: plan.action,
      entityType: "sales",
      entityId: saleId,
      before: { ...existing, lines: plan.existingLines },
      after: { ...newRow, lines: plan.newLines },
    }),
    // LAST, and specifically after `movementStatements` — replay.ts's module header states this
    // requirement. Empty on the fast path.
    ...costingPlan.statements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);
}

/** Everything `updateSale` needs to keep assembling its batch, AND everything
 * `previewSaleImpact`'s "update" dry run needs — same extraction reasoning as
 * `buildSaleCreateMovements`. Every line re-snapshots FRESH at the item's current WAC — see this
 * module's header for why (no line ids to preserve a per-line snapshot against). */
async function buildSaleUpdateMutationInputs(
  db: Db,
  id: string,
  command: UpdateSaleCommand,
): Promise<{
  existing: SaleRow;
  existingLines: SaleLineRow[];
  newRow: SaleRow;
  newLines: SaleLineRow[];
  newMovements: StockMovementInput[];
  newTransactions: FinancialTransactionInput[];
}> {
  // Defensive re-check (core/ services never trust a caller already ran Zod, D-2).
  if (command.lines.length === 0) {
    throw validationError("Se requiere al menos una línea de venta.", {});
  }

  const { row: existing, lines: existingLines } = await loadSaleForMutation(db, id);

  // The destination account (PAID only) must be active — same precedent as recordSale.
  if (command.paymentStatus === "PAID") {
    const account = await findActiveAccountRowOrThrow(db, command.accountId);
    assertPaymentMethodMatchesAccountType(command.paymentMethod, account);
  }

  const snapshotByItem = await resolveLineSnapshots(db, command);

  const now = nowIso();
  const isPaid = command.paymentStatus === "PAID";
  const lineTotals: number[] = [];
  const newLines: SaleLineRow[] = command.lines.map((line) => {
    const unitCostSnapshotMc = snapshotByItem.get(line.itemId);
    if (unitCostSnapshotMc === undefined) {
      // Unreachable: snapshotByItem was seeded from the same distinct itemIds as command.lines.
      throw validationError("Estado interno de venta inconsistente.", { itemId: line.itemId });
    }
    lineTotals.push(
      totalCentavos(toMilliCentavosPerUnit(line.unitPriceMc), toMilliUnits(line.qty)),
    );
    return {
      id: generateUuidV7(),
      saleId: id,
      itemId: line.itemId,
      qty: line.qty,
      unitPriceMc: line.unitPriceMc,
      unitCostSnapshotMc,
    };
  });
  const total = addMoney(...lineTotals.map(toCentavos));

  const newRow: SaleRow = {
    ...existing,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    customerId: command.customerId ?? null,
    sessionId: command.sessionId ?? null,
    total,
    paymentStatus: command.paymentStatus,
    paidAt: isPaid ? command.occurredAt : null,
    paymentMethod: isPaid ? command.paymentMethod : null,
    accountId: isPaid ? command.accountId : null,
    notes: command.notes ?? null,
    deletedAt: null,
    updatedAt: now,
  };

  const newMovements = buildSaleOutMovementsFromLines(
    id,
    newLines,
    newRow.occurredAt,
    newRow.businessDate,
  );

  return {
    existing,
    existingLines,
    newRow,
    newLines,
    newMovements,
    newTransactions: buildSaleTransactionInputs(newRow),
  };
}

/** Everything `deleteSale` needs to keep assembling its batch, AND everything
 * `previewSaleImpact`'s "delete" dry run needs — same extraction reasoning as
 * `buildSaleUpdateMutationInputs`. */
async function buildSaleDeleteMutationInputs(
  db: Db,
  id: string,
): Promise<{ existing: SaleRow; existingLines: SaleLineRow[]; newRow: SaleRow }> {
  const { row: existing, lines: existingLines } = await loadSaleForMutation(db, id);
  const now = nowIso();
  const newRow: SaleRow = { ...existing, deletedAt: now, updatedAt: now };
  return { existing, existingLines, newRow };
}

/** Re-reads an account AFTER the mutation batch — the one answer that cannot disagree with what was
 * actually written. Mirrors `core/purchasing`'s `readAccountDtoOrThrow`. */
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
 * UC-18 edit (R-1): replaces a sale's content and regenerates every row derived from it — the
 * kardex, `item_stock`, and (conditionally) the cash transaction and account balance — in ONE
 * atomic batch (D-3). Refuses (409 CONFLICT) if the sale has already been collected via
 * `collectPayment` (see this module's header, `assertSaleNotCollected`).
 *
 * FULL REPLACEMENT, not a patch: `command.lines` becomes the sale's complete line set, and `total`
 * is re-derived server-side as Σ(qty × unit_price) (Doc 04 §5), never accepted from the caller —
 * identical to the create path.
 */
export async function updateSale(
  db: Db,
  id: string,
  command: UpdateSaleCommand,
  actor: AuditActor,
): Promise<UpdateSaleResult> {
  const { existing, existingLines, newRow, newLines, newMovements, newTransactions } =
    await buildSaleUpdateMutationInputs(db, id, command);

  await commitSaleMutation(db, {
    action: "update",
    existing,
    existingLines,
    newRow,
    newLines,
    newMovements,
    newTransactions,
    confirm: command.confirm === true,
    actor,
  });

  return {
    sale: toSaleDto(newRow, newLines),
    account: newRow.accountId !== null ? await readAccountDtoOrThrow(db, newRow.accountId) : null,
  };
}

/**
 * UC-18 delete (R-3/INV-10): soft-deletes the sale and reverses everything derived from it in ONE
 * atomic batch (D-3) — the kardex rows are removed outright (D-8's derived-row carve-out),
 * `item_stock` is netted back, and (if the sale was PAID) its INCOME/SALE transaction and account
 * balance are reversed. Refuses (409 CONFLICT) if the sale has already been collected (see this
 * module's header).
 *
 * INV-8: deleting a sale whose stock was already consumed further downstream is permitted and can
 * drive `qty_on_hand` more negative — never a blocking error, mirrors `deletePurchase`'s identical
 * INV-8 note.
 */
export async function deleteSale(
  db: Db,
  id: string,
  command: DeleteSaleCommand,
  actor: AuditActor,
): Promise<DeleteSaleResult> {
  const { existing, existingLines, newRow } = await buildSaleDeleteMutationInputs(db, id);

  await commitSaleMutation(db, {
    action: "delete",
    existing,
    existingLines,
    newRow,
    // A deleted sale projects NOTHING: no lines, no kardex rows, no cash row.
    newLines: existingLines,
    newMovements: [],
    newTransactions: [],
    confirm: command.confirm === true,
    actor,
  });

  return {
    sale: toSaleDto(newRow, existingLines),
    account:
      existing.accountId !== null ? await readAccountDtoOrThrow(db, existing.accountId) : null,
  };
}

/** Loads a sale and its lines for a restore, refusing one that is MISSING or already LIVE. Mirrors
 * `core/purchasing`'s `loadPurchaseForRestore`. No `assertSaleNotCollected` guard needed: a
 * soft-deleted sale can never have been collected while deleted (`collectPayment` requires a
 * non-deleted sale), so this state is structurally unreachable — see this module's header. */
async function loadSaleForRestore(
  db: Db,
  id: string,
): Promise<{ row: SaleRow; lines: SaleLineRow[] }> {
  const row = await db.query.sales.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNotNull }) =>
      andOp(eqOp(t.id, id), isNotNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la venta eliminada.", { id });
  }
  const lines = await db.query.saleLines.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.saleId, id),
  });
  for (const line of lines) {
    const item = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, line.itemId),
    });
    if (item?.kind !== "FINISHED") {
      throw validationError(
        "No se puede restaurar esta venta: contiene una línea de empaque, que ya no se vende directamente bajo el modelo de presentaciones y combos.",
        { saleId: id },
      );
    }
  }
  return { row, lines };
}

/**
 * Server side of the "Deshacer" 10s-undo toast (Doc 06 principle 6): un-deletes a soft-deleted sale
 * and reconstructs everything `deleteSale` reversed, in ONE atomic batch (D-3), routed through the
 * SAME `commitSaleMutation` path `updateSale`/`deleteSale` already share (audited as `"restore"`).
 *
 * `sale_lines` survive a delete unchanged (only the kardex/cash were reversed), so `newLines` is the
 * sale's own stored lines and `newMovements` reuses each line's STORED `unit_cost_snapshot`
 * verbatim (never re-snapshotted at today's WAC — C-6/R-4's spirit: undo brings back exactly what
 * was deleted, not a freshly-priced version of it).
 *
 * Re-inserting historical movements at their original dates can itself require R-5 confirmation —
 * `commitSaleMutation`'s existing gate handles that with no special-casing here.
 */
export async function restoreSale(
  db: Db,
  id: string,
  command: DeleteSaleCommand,
  actor: AuditActor,
): Promise<UpdateSaleResult> {
  const { row: existing, lines: existingLines } = await loadSaleForRestore(db, id);

  const now = nowIso();
  const newRow: SaleRow = { ...existing, deletedAt: null, updatedAt: now };
  const newMovements = buildSaleOutMovementsFromLines(
    id,
    existingLines,
    newRow.occurredAt,
    newRow.businessDate,
  );

  await commitSaleMutation(db, {
    action: "restore",
    existing,
    existingLines,
    newRow,
    newLines: existingLines,
    newMovements,
    newTransactions: buildSaleTransactionInputs(newRow),
    confirm: command.confirm === true,
    actor,
  });

  return {
    sale: toSaleDto(newRow, existingLines),
    account: newRow.accountId !== null ? await readAccountDtoOrThrow(db, newRow.accountId) : null,
  };
}

/**
 * A placeholder `AuditActor` for `planCostingReplay` calls this dry run makes — mirrors
 * `core/purchasing`'s `PREVIEW_ACTOR`. `actor` only labels the (discarded) `costing_replay` audit
 * -row statement; this function never reaches `db.batch()`, so no audit row is ever written.
 */
const PREVIEW_ACTOR: AuditActor = "SYSTEM";

/**
 * R-5 / ADR-016's dry-run endpoint (Doc 03 §7): "what would this create/edit/delete do to costing?",
 * answered WITHOUT writing anything. Every branch below calls the SAME builder the corresponding
 * real mutation calls (`buildSaleCreateMovements` / `buildSaleUpdateMutationInputs` /
 * `buildSaleDeleteMutationInputs`) and the SAME planning step (`planCostingReplay` /
 * `planSaleMutationCostingImpact`) — never a re-implementation that could silently drift.
 */
export async function previewSaleImpact(
  db: Db,
  request: SaleImpactRequest,
): Promise<ReplayImpactDto> {
  if (request.op === "create") {
    const { saleId, movements } = await buildSaleCreateMovements(db, request.command);
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "sale",
        eventId: saleId,
        businessDate: request.command.businessDate,
        occurredAt: request.command.occurredAt,
      },
      changes: [{ sourceEventType: "sale", sourceEventId: saleId, newMovements: movements }],
      actor: PREVIEW_ACTOR,
    });
    return plan.impact;
  }

  if (request.op === "update") {
    const { newRow, newMovements } = await buildSaleUpdateMutationInputs(
      db,
      request.id,
      request.command,
    );
    const { costingPlan } = await planSaleMutationCostingImpact(
      db,
      request.id,
      newRow,
      newMovements,
      PREVIEW_ACTOR,
    );
    return costingPlan.impact;
  }

  // request.op === "delete"
  const { newRow } = await buildSaleDeleteMutationInputs(db, request.id);
  const { costingPlan } = await planSaleMutationCostingImpact(
    db,
    request.id,
    newRow,
    [],
    PREVIEW_ACTOR,
  );
  return costingPlan.impact;
}

export async function getSale(db: Db, id: string): Promise<SaleDto> {
  const row = await db.query.sales.findFirst({
    where: (t, { and, eq: eqOp, isNull }) => and(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la venta.", { id });
  }
  const lineRows = await db.query.saleLines.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.saleId, id),
  });
  return toSaleDto(row, lineRows);
}

/** Read query for the Sales screen's list (Doc 07 SC-02/03). Mirrors core/purchasing's listPurchases.
 * Soft-delete-aware even though nothing deletes sales yet (a later task's job). */
export async function listSales(db: Db, filters: ListSalesFilters = {}): Promise<ListSalesResult> {
  const rows = await db.query.sales.findMany({
    where: (t, { and, eq: eqOp, gte, lte, isNull }) => {
      const conditions = [isNull(t.deletedAt)];
      if (filters.customerId) conditions.push(eqOp(t.customerId, filters.customerId));
      if (filters.paymentStatus) conditions.push(eqOp(t.paymentStatus, filters.paymentStatus));
      if (filters.fromDate) conditions.push(gte(t.businessDate, filters.fromDate));
      if (filters.toDate) conditions.push(lte(t.businessDate, filters.toDate));
      return and(...conditions);
    },
    orderBy: (t, { desc }) => [desc(t.businessDate), desc(t.createdAt)],
    limit: filters.limit ?? 200,
  });

  const saleIds = rows.map((r) => r.id);
  const lineRows =
    saleIds.length > 0
      ? await db.query.saleLines.findMany({
          where: (t, { inArray }) => inArray(t.saleId, saleIds),
        })
      : [];
  const linesBySale = new Map<string, SaleLineRow[]>();
  for (const line of lineRows) {
    const arr = linesBySale.get(line.saleId) ?? [];
    arr.push(line);
    linesBySale.set(line.saleId, arr);
  }

  return {
    sales: rows.map((row) => toSaleDto(row, linesBySale.get(row.id) ?? [])),
  };
}

/**
 * UC-04 (KOK-031): collect a receivable. One atomic batch (D-3):
 *   - updates the sale row: `payment_status='PAID'`, `paid_at`/`payment_method`/`account_id` set.
 *   - (total > 0 only) credits the chosen account + books an INCOME/DEBT_COLLECTION
 *     `financial_transactions` row sourced to this sale — the exact cash-side shape recordSale's
 *     PAID branch books at sale time, just deferred to whenever the money actually arrives.
 *   - the `audit_log` row.
 *
 * No stock/kardex/WAC touch of any kind — the SALE_OUT movement and its unit_cost_snapshot were
 * already frozen at `recordSale` time and never move again (C-6 spirit).
 */
export async function collectPayment(
  db: Db,
  id: string,
  command: CollectPaymentCommand,
  actor: AuditActor,
): Promise<CollectPaymentResult> {
  const saleRow = await db.query.sales.findFirst({
    where: (t, { and, eq: eqOp, isNull }) => and(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!saleRow) {
    throw notFound("No se encontró la venta.", { id });
  }
  if (saleRow.paymentStatus !== "ON_CREDIT") {
    throw conflict("Esta venta ya está pagada; no se puede cobrar de nuevo.", { id });
  }

  const account = await findActiveAccountRowOrThrow(db, command.accountId);
  assertPaymentMethodMatchesAccountType(command.paymentMethod, account);

  // KOK-033: what is actually OUTSTANDING, which is not always the sale's total. A CUSTOM_ORDER
  // sale created by `deliverOrder` (O-2) carries the FULL agreed total, but its deposit was already
  // banked as ORDER_DEPOSIT at confirm time — collecting `total` here would credit that money a
  // SECOND time. This is the same netting `v_receivables` performs (migration 0005), applied to the
  // cash side so the view and the collection can never disagree.
  const outstanding = await outstandingForSale(db, saleRow);

  const now = nowIso();
  const updatedFields = {
    paymentStatus: "PAID" as const,
    paidAt: command.occurredAt,
    paymentMethod: command.paymentMethod,
    accountId: command.accountId,
    updatedAt: now,
  };

  // financial_transactions.amount is always > 0 (Doc 04 §3.4's CHECK): a receivable of 0 (an
  // all-giveaway ON_CREDIT sale, or a delivered order whose deposit covered everything) is marked
  // collected but moves no cash, mirroring recordSale's own total===0 skip.
  const financialStatements: Statement[] = [];
  if (outstanding > 0) {
    financialStatements.push(
      buildAccountBalanceDelta(db, command.accountId, outstanding),
      db.insert(financialTransactions).values({
        id: generateUuidV7(),
        occurredAt: command.occurredAt,
        businessDate: command.businessDate,
        accountId: command.accountId,
        type: "INCOME" as const,
        category: "DEBT_COLLECTION" as const,
        amount: outstanding,
        counterpartTxId: null,
        sourceEventType: "sale",
        sourceEventId: id,
        description: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  const statements: Statement[] = [
    db.update(sales).set(updatedFields).where(eq(sales.id, id)),
    ...financialStatements,
    buildAuditLogInsert(db, {
      actor,
      action: "collect_payment",
      entityType: "sales",
      entityId: id,
      before: {
        paymentStatus: saleRow.paymentStatus,
        paidAt: saleRow.paidAt,
        paymentMethod: saleRow.paymentMethod,
        accountId: saleRow.accountId,
      },
      after: updatedFields,
    }),
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  const lineRows = await db.query.saleLines.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.saleId, id),
  });

  return {
    sale: toSaleDto({ ...saleRow, ...updatedFields }, lineRows),
    account: toAccountDto({
      ...account,
      balance: addMoney(toCentavos(account.balance), toCentavos(outstanding)),
    }),
  };
}

/**
 * What a sale still owes, netting off any deposit already banked against it (KOK-033).
 *
 * For an ordinary CATALOG sale this is just `total`. For a `CUSTOM_ORDER` sale it is
 * `total − custom_orders.deposit_paid`: O-2 makes the delivery sale carry the FULL agreed total,
 * but the deposit portion arrived at confirm time as its own ORDER_DEPOSIT transaction, so only the
 * balance was ever uncollected. `v_receivables` reports the identical figure (migration 0005) —
 * this is that formula on the cash side, kept in one place so the two cannot drift apart.
 */
async function outstandingForSale(db: Db, saleRow: SaleRow): Promise<number> {
  const customOrderId = saleRow.customOrderId;
  if (customOrderId === null) return saleRow.total;
  const orderRow = await db.query.customOrders.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull }) =>
      andOp(eqOp(t.id, customOrderId), isNull(t.deletedAt)),
  });
  if (!orderRow) return saleRow.total;
  return Math.max(subMoney(toCentavos(saleRow.total), toCentavos(orderRow.depositPaid)), 0);
}

/** Raw `v_receivables` row shape (snake_case, exactly the view's SELECT list — Doc 04 §4). The
 * view is defined only in apps/worker/migrations/0001_init.sql (Drizzle's SQLite dialect has no
 * binding for it, same precedent as core/inventory/queries.ts's v_stock/v_kardex reads), so this
 * queries it via `db.all(sql\`...\`)` and hand-maps the row into `ReceivableDto`. */
interface ReceivableRow {
  sale_id: string;
  occurred_at: string;
  business_date: string;
  customer_id: string | null;
  customer_name: string | null;
  total: number;
  channel: SaleDto["channel"];
  custom_order_id: string | null;
  days_outstanding: number;
}

/**
 * SC-02's "Por cobrar" preset (KOK-031): every ON_CREDIT, non-deleted sale with its age in days,
 * oldest first. This is also the read the future alerts job (KOK-046, Doc 10 — still 📋 To Do at
 * the time this was written) will consume for its "receivables aging >7 days" line; wiring it into
 * that cron job is KOK-046's own scope, not this one's.
 */
export async function listReceivables(db: Db): Promise<ListReceivablesResult> {
  const rows = await db.all<ReceivableRow>(sql`
    SELECT * FROM v_receivables ORDER BY days_outstanding DESC
  `);

  const receivables: ReceivableDto[] = rows.map((row) => ({
    saleId: row.sale_id,
    occurredAt: row.occurred_at,
    businessDate: row.business_date,
    customerId: row.customer_id,
    customerName: row.customer_name,
    total: row.total,
    channel: row.channel,
    customOrderId: row.custom_order_id,
    daysOutstanding: row.days_outstanding,
  }));

  return { receivables };
}
