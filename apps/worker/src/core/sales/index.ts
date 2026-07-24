// core/sales — UC-03 "Record catalog sale" (KOK-030, Doc 03 UC-03, Doc 04 §3.3 `sales`/`sale_lines`
// + §5). Same TEMPLATE shape as core/purchasing/index.ts (see that module's header): a top-level
// command entry point, not a building block — it does its own defensive validation, builds every row
// itself, and executes exactly ONE atomic `db.batch()` (D-3) containing:
//   - the `sales` + `sale_lines` inserts (the event itself)
//   - the SALE_OUT `stock_movements` + `item_stock` upserts (core/inventory's
//     buildStockMovementStatements — negative stock is ALLOWED, never an error: INV-8)
//   - (PAID only) the account balance CREDIT (core/finance's buildAccountBalanceDelta) + the
//     system-owned INCOME/SALE `financial_transactions` row (sourceEventType/Id set to the sale, per
//     Doc 04 §5). ON_CREDIT books NO cash at sale time — the receivable is collected later (KOK-031).
//   - the `audit_log` row (core/audit's buildAuditLogInsert)
//
// A sale is stock-wise IDENTICAL to a non-commercial exit (core/inventory/exits.ts): a SALE_OUT is
// an OUT movement that FREEZES its cost at the item's CURRENT WAC (`unit_cost_snapshot`) and NEVER
// mutates that WAC (C-6 spirit / R-4 — the per-line margin is frozen forever). Do NOT add an
// `items.wac` UPDATE here — that would corrupt WAC. What a sale adds ON TOP of an exit is the CASH
// side: a PAID sale credits an account and books income, mirroring how recordPurchase debits one.
//
// DELIBERATELY NO `planCostingReplay` CALL (unlike recordPurchase/recordExit). Those two plan a
// backdated-replay because their trigger type (`purchase`/`stock_exit`) is a modelled
// `costing_adjustments.trigger_event_type` (Doc 04 §3.4). `sale` is NOT — the enum admits only
// purchase/production_run/stock_exit/session — so a sale cannot be a replay trigger without a schema
// + KB change (out of scope for KOK-030). A backdated sale that re-weights a later item's WAC is the
// same open gap a backdated CREATE purchase through the web UI has; the nightly WAC-drift detector
// (R-2, core/costing/repair.ts) is the backstop. This is why recordSale has no `confirm` flag.
//
// Scope: CREATE + READ (KOK-030) + collectPayment/listReceivables (KOK-031, UC-04). Still no
// generic update/delete/restore for a sale itself — that's KOK-064, a separate follow-up (the
// KOK-024 pattern), exactly as core/purchasing shipped CREATE+READ first. collectPayment is a
// narrow, single-purpose transition (ON_CREDIT -> PAID only), not the general edit path.

import type {
  AuditActor,
  CollectPaymentCommand,
  CollectPaymentResult,
  ListReceivablesResult,
  ListSalesFilters,
  ListSalesResult,
  ReceivableDto,
  RecordSaleCommand,
  RecordSaleResult,
  SaleDto,
  SaleLineDto,
} from "@kokoro/shared";
import { addMoney, generateUuidV7, mulMoneyByQty, nowIso } from "@kokoro/shared";
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialTransactions, saleLines, sales } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { snapshotUnitCost } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
import { buildAccountBalanceDelta, findActiveAccountRowOrThrow } from "../finance/accounts.js";
import { toAccountDto } from "../finance/dto.js";
import { buildStockMovementStatements } from "../inventory/movements.js";
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
    unitPrice: l.unitPrice,
    unitCostSnapshot: l.unitCostSnapshot,
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
 * change between two lines of one sale. Validates each item exists AND is `kind='FINISHED'` (Doc 04
 * §5 / §3.3's service-enforced rule — there is no DB CHECK for it): selling a RAW_MATERIAL or
 * SEMI_FINISHED item is a VALIDATION error, not a NOT_FOUND.
 */
async function resolveLineSnapshots(
  db: Db,
  command: RecordSaleCommand,
): Promise<Map<string, number>> {
  const snapshotByItem = new Map<string, number>();
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
    // unit_cost_snapshot — never recomputed via applyWacEntry (that is only for entries).
    snapshotByItem.set(itemId, snapshotUnitCost(itemRow.wac));
  }
  return snapshotByItem;
}

/**
 * UC-03: record one multi-line catalog sale in one atomic batch (D-3). See this module's header for
 * the full statement list. FINISHED-only line validation, per-line WAC snapshot frozen at sale time,
 * SALE_OUT movements (negative stock allowed, INV-8), income transaction when PAID / receivable when
 * ON_CREDIT, and `total` server-recomputed as Σ(qty × unit_price) (Doc 04 §5).
 */
export async function recordSale(
  db: Db,
  command: RecordSaleCommand,
  actor: AuditActor,
): Promise<RecordSaleResult> {
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
  }

  const snapshotByItem = await resolveLineSnapshots(db, command);

  const saleId = generateUuidV7();
  const now = nowIso();

  const movements: StockMovementInput[] = [];
  const saleLineRows: SaleLineRow[] = [];
  const lineTotals: number[] = [];
  for (const line of command.lines) {
    const unitCostSnapshot = snapshotByItem.get(line.itemId);
    if (unitCostSnapshot === undefined) {
      // Unreachable: snapshotByItem was seeded from the same distinct itemIds as command.lines.
      throw validationError("Estado interno de venta inconsistente.", { itemId: line.itemId });
    }

    // Doc 04 §5: the per-line money total is qty (milli-units) × unit_price (centavos/whole unit),
    // rounded to whole centavos — mulMoneyByQty is exactly that. Summed into the sale total below.
    lineTotals.push(mulMoneyByQty(line.unitPrice, line.qty));

    saleLineRows.push({
      id: generateUuidV7(),
      saleId,
      itemId: line.itemId,
      qty: line.qty,
      unitPrice: line.unitPrice,
      unitCostSnapshot,
    });

    movements.push({
      itemId: line.itemId,
      occurredAt: command.occurredAt,
      businessDate: command.businessDate,
      type: "SALE_OUT",
      // sale_lines.qty is stored POSITIVE (its own CHECK); the OUT sign convention is applied only
      // here, at the movements boundary — identically to core/inventory/exits.ts.
      qty: -line.qty,
      unitCost: unitCostSnapshot,
      sourceEventType: "sale",
      sourceEventId: saleId,
    });
  }

  // Server-recomputed, never trusted from the caller (Doc 04 §5) — recordSaleCommandSchema has no
  // `total` field, so this is the only place a sale's total is produced.
  const total = addMoney(...lineTotals);

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
    // (C-6 spirit), and NO planCostingReplay — see this module's header.
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "sales",
      entityId: saleId,
      before: null,
      after: saleRow,
    }),
  ];

  // `statements` always starts with the fixed sales insert, so it is never empty — same cast
  // technique as core/purchasing/index.ts's recordPurchase, for the same reason.
  await db.batch(statements as [Statement, ...Statement[]]);

  return {
    sale: toSaleDto(saleRow, saleLineRows),
    account:
      account !== null
        ? toAccountDto({ ...account, balance: addMoney(account.balance, total) })
        : null,
  };
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

  const now = nowIso();
  const updatedFields = {
    paymentStatus: "PAID" as const,
    paidAt: command.occurredAt,
    paymentMethod: command.paymentMethod,
    accountId: command.accountId,
    updatedAt: now,
  };

  // financial_transactions.amount is always > 0 (Doc 04 §3.4's CHECK): a receivable of 0 (an
  // all-giveaway ON_CREDIT sale) is marked collected but moves no cash, mirroring recordSale's own
  // total===0 skip.
  const financialStatements: Statement[] = [];
  if (saleRow.total > 0) {
    financialStatements.push(
      buildAccountBalanceDelta(db, command.accountId, saleRow.total),
      db.insert(financialTransactions).values({
        id: generateUuidV7(),
        occurredAt: command.occurredAt,
        businessDate: command.businessDate,
        accountId: command.accountId,
        type: "INCOME" as const,
        category: "DEBT_COLLECTION" as const,
        amount: saleRow.total,
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
    account: toAccountDto({ ...account, balance: addMoney(account.balance, saleRow.total) }),
  };
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
