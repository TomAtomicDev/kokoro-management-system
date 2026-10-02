// core/orders — UC-05…UC-08 "custom order lifecycle" (KOK-033/KOK-205, Doc 03 §5 O-8, Doc 04 §3.3
// `custom_orders`/`custom_order_lines` + §5, ADR-022). Named `orders` (not `custom-orders`) to
// match Doc 03's own UC table, which calls these commands `orders.quote` / `orders.confirm` /
// `orders.deliver` / `orders.cancel`.
//
// Same TEMPLATE shape as core/sales and core/purchasing: every exported command is a top-level
// entry point that does its own defensive validation (D-2: core/ never trusts that a caller ran
// Zod), builds every row itself, and executes exactly ONE atomic `db.batch()` (D-3/INV-1).
//
// Status transitions remain named and guarded. The pre-delivery agreement has one audited,
// optimistic-concurrency-guarded `updateOrder` command; `CANCELLED` remains terminal:
//
//   QUOTING --confirm(no cash)--> CONFIRMED --start--> IN_PRODUCTION --ready--> READY
//           --deliver--> DELIVERED --undo--> READY
//   {QUOTING, CONFIRMED, IN_PRODUCTION, READY} --cancel--> CANCELLED (final)
//
// Every other (status, transition) pair is a 409 CONFLICT with a Spanish `message_es`
// (`assertTransitionAllowed`), which is what makes the illegal-transition tests exhaustive.
//
// ---- MONEY (INV-7 / ADR-022) -------------------------------------------------------------------
// Every order transition is cash-free. Receipts/refunds and their account deltas belong to
// core/finance; delivery owns only its frozen sale/stock snapshot. Receipt reads used by the edit
// form are order-scoped and never write or reinterpret finance rows.
//
// ---- WHY DELIVERY DEMANDS ITEM-LINKED LINES (Doc 04 §5) ---------------------------------------
// `custom_order_lines.item_id` is NULLABLE (free-text one-offs are legal while quoting), but
// `sale_lines.item_id` is NOT NULL and FINISHED-only, and Doc 04 §5 recomputes
// `sales.total = Σ(qty × unit_price)` server-side. A line-less or free-text-only delivery therefore
// cannot produce a sale whose total is the agreed total without either inventing revenue with no
// lines behind it or dropping the SALE_OUT movement for what was actually shipped — the latter
// drifting `item_stock` upward forever (INV-5), since O-4 says order production is a normal
// ProductionRun that already booked PRODUCTION_IN against a real `output_item_id`.
// So `deliverOrder` REFUSES (409) while any line lacks an `item_id`. The pre-delivery agreement form
// can resolve free-text lines through `updateOrder` before offering "Entregar".
//
// `deliverOrder` runs the same INV-11/R-2 ordering guard `recordSale` does, gated by the same
// shared `confirm` flag (R-5/ADR-016): it writes SALE_OUT movements, so a BACKDATED delivery
// re-weights C-1 for every later kardex entry exactly as a backdated sale does.

import type {
  AuditActor,
  CancelOrderCommand,
  CancelOrderResult,
  ConfirmOrderCommand,
  ConfirmOrderResult,
  CustomOrderStatus,
  DeliverOrderCommand,
  DeliverOrderResult,
  ListOrdersFilters,
  ListOrdersResult,
  MilliCentavosPerUnit,
  OrderBalanceDto,
  OrderDto,
  OrderImpactRequest,
  OrderLineDto,
  OrderListCursor,
  OrderReceiptSummaryDto,
  OrderTransitionResult,
  QuoteOrderCommand,
  QuoteOrderResult,
  ReplayImpactDto,
  SaleDto,
  UndoDeliverOrderCommand,
  UpdateOrderCommand,
  UpdateOrderResult,
} from "@kokoro/shared";
import {
  addMoney,
  allocateAgreedTotalToOrderLines,
  businessDateRangeToUtcWindow,
  calculateOrderReceiptBalance,
  cancelOrderCommandSchema,
  confirmOrderCommandSchema,
  DEFAULT_DEPOSIT_PCT_BP,
  deliverOrderCommandSchema,
  generateUuidV7,
  mulMoneyByBasisPoints,
  nowIso,
  quoteOrderCommandSchema,
  REPLAY_CONFIRMATION_REQUIRED,
  toBasisPoints,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
  updateOrderCommandSchema,
} from "@kokoro/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import {
  customOrderLines,
  customOrders,
  financialTransactions,
  saleLines,
  sales,
} from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import type { CostingReplayPlan } from "../costing/replay.js";
import { planCostingReplay } from "../costing/replay.js";
import { snapshotUnitCost } from "../costing/wac.js";
import { conflict, DomainError, notFound, validationError } from "../errors.js";
import { getOrderFinanceBalances, type OrderFinanceBalance } from "../finance/index.js";
import {
  buildReplaceMovementsForSourceStatements,
  buildStockMovementStatements,
} from "../inventory/movements.js";
import type { StockMovementInput } from "../inventory/types.js";
import { planSaleMutationCostingImpact } from "../sales/index.js";
import { getSetting } from "../settings/index.js";

type Statement = BatchItem<"sqlite">;
type OrderRow = typeof customOrders.$inferSelect;
type OrderLineRow = typeof customOrderLines.$inferSelect;
type SaleRow = typeof sales.$inferSelect;
type SaleLineRow = typeof saleLines.$inferSelect;

/** Keep set-based follow-up reads below D1's bound-parameter limit at the maximum page size. */
const ORDER_READ_BATCH_SIZE = 90;

function chunkValues<T>(values: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    chunks.push(values.slice(offset, offset + chunkSize));
  }
  return chunks;
}

// ---- Status machine ---------------------------------------------------------------------------

/** The single source of truth for which statuses each transition may run from (Doc 03 §5). Every
 * guard below reads this table, so a legal/illegal transition test suite is exhaustive by
 * construction. */
const ALLOWED_FROM = {
  confirm: ["QUOTING"],
  start: ["CONFIRMED"],
  ready: ["IN_PRODUCTION"],
  deliver: ["READY"],
  cancel: ["QUOTING", "CONFIRMED", "IN_PRODUCTION", "READY"],
  undoStart: ["IN_PRODUCTION"],
  undoReady: ["READY"],
  undoDeliver: ["DELIVERED"],
} as const satisfies Record<string, readonly CustomOrderStatus[]>;

const EDITABLE_ORDER_STATUSES: readonly CustomOrderStatus[] = ALLOWED_FROM.cancel;

type OrderTransition = keyof typeof ALLOWED_FROM;

/** Spanish label per status, for the CONFLICT messages the drawer surfaces verbatim (D-9). */
const STATUS_LABEL_ES: Record<CustomOrderStatus, string> = {
  QUOTING: "en cotización",
  CONFIRMED: "confirmado",
  IN_PRODUCTION: "en producción",
  READY: "listo",
  DELIVERED: "entregado",
  CANCELLED: "cancelado",
};

const TRANSITION_LABEL_ES: Record<OrderTransition, string> = {
  confirm: "confirmar",
  start: "iniciar la producción de",
  ready: "marcar como listo",
  deliver: "entregar",
  cancel: "cancelar",
  undoStart: "volver a confirmado",
  undoReady: "volver a en producción",
  undoDeliver: "deshacer la entrega de",
};

/** 409 CONFLICT unless `row.status` is a legal starting point for `transition` (Doc 04 §5). A
 * state-machine violation is a CONFLICT, never a VALIDATION error: the command is well-formed, the
 * order is simply not in a state that admits it. */
function assertTransitionAllowed(row: OrderRow, transition: OrderTransition): void {
  const allowed: readonly CustomOrderStatus[] = ALLOWED_FROM[transition];
  if (!allowed.includes(row.status)) {
    throw conflict(
      `No se puede ${TRANSITION_LABEL_ES[transition]} un pedido ${STATUS_LABEL_ES[row.status]}.`,
      { id: row.id, status: row.status, transition, allowedFrom: allowed },
    );
  }
}

// ---- DTO mapping ------------------------------------------------------------------------------

function toOrderLineDto(row: OrderLineRow): OrderLineDto {
  return {
    id: row.id,
    itemId: row.itemId,
    description: row.description,
    qty: row.qty,
    lineTotal: row.lineTotal,
  };
}

function toOrderDto(
  row: OrderRow,
  lineRows: readonly OrderLineRow[],
  customerName: string | null,
  financeBalance: OrderFinanceBalance,
): OrderDto {
  const isPreDelivery =
    row.status === "QUOTING" ||
    row.status === "CONFIRMED" ||
    row.status === "IN_PRODUCTION" ||
    row.status === "READY";
  const balance: OrderBalanceDto = {
    customerAmount: financeBalance.customerAmount,
    qualifyingReceipts: financeBalance.qualifyingReceipts,
    expectedBalance: isPreDelivery ? financeBalance.expected : null,
    receivableBalance: row.status === "DELIVERED" ? financeBalance.expected : null,
    excess: financeBalance.excess,
  };

  return {
    id: row.id,
    status: row.status,
    customerId: row.customerId,
    customerName,
    description: row.description,
    agreedTotal: row.agreedTotal,
    additionalCharge: row.additionalCharge,
    balance,
    deliveryDate: row.deliveryDate,
    deliveryPlace: row.deliveryPlace,
    saleId: row.saleId,
    code: row.code,
    notes: row.notes,
    lines: lineRows.map(toOrderLineDto),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSaleDto(row: SaleRow, lineRows: readonly SaleLineRow[]): SaleDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    businessDate: row.businessDate,
    channel: row.channel,
    customOrderId: row.customOrderId,
    customerId: row.customerId,
    sessionId: row.sessionId,
    total: row.total,
    additionalCharge: row.additionalCharge,
    paymentStatus: row.paymentStatus,
    paidAt: row.paidAt,
    paymentMethod: row.paymentMethod,
    accountId: row.accountId,
    code: row.code,
    notes: row.notes,
    lines: lineRows.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      qty: l.qty,
      unitPriceMc: toMilliCentavosPerUnit(l.unitPriceMc),
      unitCostSnapshotMc: l.unitCostSnapshotMc,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---- Loading ----------------------------------------------------------------------------------

export async function loadOrderRowOrThrow(db: Db, id: string): Promise<OrderRow> {
  const row = await db.query.customOrders.findFirst({
    where: (t, { and, eq: eqOp, isNull }) => and(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró el pedido.", { id });
  }
  return row;
}

/** KOK-137: production_runs/assemblies write `customOrderId` with no existence/status check
 * today (the backlog row's own flagged hole) — both modules call this before persisting a link.
 * DELIVERED/CANCELLED orders are historical fact. validationError, not conflict: this validates
 * a foreign key on the caller's work command, not a transition on the order's own lifecycle. */
export async function assertOrderLinkable(db: Db, customOrderId: string): Promise<void> {
  const row = await loadOrderRowOrThrow(db, customOrderId);
  if (row.status === "DELIVERED" || row.status === "CANCELLED") {
    throw validationError(
      `No se puede vincular producción a un pedido ${STATUS_LABEL_ES[row.status]}.`,
      { id: customOrderId, status: row.status },
    );
  }
}

async function loadOrderLineRows(db: Db, orderId: string): Promise<OrderLineRow[]> {
  return db.query.customOrderLines.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.customOrderId, orderId),
  });
}

async function loadCustomerName(db: Db, customerId: string): Promise<string | null> {
  const row = await db.query.customers.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, customerId),
  });
  return row?.name ?? null;
}

/** Reads back the order exactly as it now stands, for the result DTO every command returns. */
async function readOrderDto(db: Db, id: string): Promise<OrderDto> {
  const row = await loadOrderRowOrThrow(db, id);
  const [lineRows, customerName, financeBalances] = await Promise.all([
    loadOrderLineRows(db, id),
    loadCustomerName(db, row.customerId),
    getOrderFinanceBalances(db, [id]),
  ]);
  const financeBalance = financeBalances.get(id);
  if (financeBalance === undefined) {
    throw new DomainError("INTERNAL", "No se pudo derivar el saldo del pedido.", { orderId: id });
  }
  return toOrderDto(row, lineRows, customerName, financeBalance);
}

/** Read only the manual receipt rows that qualify for the pre-delivery agreement preview. */
export async function getOrderReceiptSummary(db: Db, id: string): Promise<OrderReceiptSummaryDto> {
  const order = await loadOrderRowOrThrow(db, id);
  if (!EDITABLE_ORDER_STATUSES.includes(order.status)) {
    throw conflict("El resumen de recibos solo está disponible antes de entregar el pedido.", {
      id,
      status: order.status,
    });
  }

  const rows = await db
    .select({ amount: financialTransactions.amount, deletedAt: financialTransactions.deletedAt })
    .from(financialTransactions)
    .where(
      and(
        eq(financialTransactions.customOrderId, id),
        eq(financialTransactions.type, "INCOME"),
        inArray(financialTransactions.category, ["ORDER_DEPOSIT", "ORDER_BALANCE"]),
        isNull(financialTransactions.sourceEventId),
      ),
    );
  const qualifyingReceipts = rows.reduce(
    (total, receipt) =>
      receipt.deletedAt === null ? addMoney(toCentavos(total), toCentavos(receipt.amount)) : total,
    toCentavos(0),
  );

  return {
    qualifyingReceipts,
    hasEverQualifyingReceipt: rows.length > 0,
  };
}

// ---- Shared validation ------------------------------------------------------------------------

/** Every order line that carries an `itemId` must point at a real, FINISHED item — the same rule
 * `core/sales`' `resolveLineSnapshots` enforces for sale lines (Doc 04 §5), applied as early as
 * quoting so an order cannot be built out of lines that could never be delivered. Returns the WAC
 * to freeze per item, which `deliverOrder` reuses for its `unit_cost_snapshot`s. */
async function resolveItemSnapshots(
  db: Db,
  itemIds: readonly string[],
): Promise<Map<string, MilliCentavosPerUnit>> {
  const snapshotByItem = new Map<string, MilliCentavosPerUnit>();
  for (const itemId of new Set(itemIds)) {
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemId),
    });
    if (!itemRow) {
      throw notFound("No se encontró el ítem.", { id: itemId });
    }
    if (itemRow.kind !== "FINISHED") {
      throw validationError("Un pedido solo puede entregar ítems terminados (FINISHED).", {
        itemId,
        kind: itemRow.kind,
      });
    }
    // C-6: value at the item's CURRENT WAC; a sale never moves WAC, so one lookup per item is
    // enough however many lines reference it.
    snapshotByItem.set(itemId, snapshotUnitCost(toMilliCentavosPerUnit(itemRow.wacMc)));
  }
  return snapshotByItem;
}

async function assertCustomerExists(db: Db, customerId: string): Promise<void> {
  const row = await db.query.customers.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, customerId),
  });
  if (!row) {
    throw notFound("No se encontró el cliente.", { id: customerId });
  }
}

/** O-1's "default 50%, editable": the owner's `default_deposit_pct` app setting (basis points,
 * Doc 04 §3.5) when present and parseable, else `DEFAULT_DEPOSIT_PCT_BP`. */
async function resolveDefaultDepositRequired(db: Db, agreedTotal: number): Promise<number> {
  const raw = await getSetting(db, "default_deposit_pct");
  const parsed = raw === null ? Number.NaN : Number(raw);
  const bp = Number.isInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : null;
  return mulMoneyByBasisPoints(
    toCentavos(agreedTotal),
    toBasisPoints(bp ?? DEFAULT_DEPOSIT_PCT_BP),
  );
}

// ---- UC-05 quote ------------------------------------------------------------------------------

/**
 * UC-05: open a custom order at `QUOTING` in one atomic batch (D-3) — the `custom_orders` row, its
 * `custom_order_lines`, and the `audit_log` row. No money and no kardex: a quote is a promise, not
 * an event with cash or stock behind it.
 *
 * `agreedTotal` is optional here (Doc 04 §3.3's "required to confirm") — a quote may legitimately
 * be opened before the price is settled. `depositRequired` is derived from `default_deposit_pct`
 * when a price IS present and the caller did not name one (O-1).
 */
export async function quoteOrder(
  db: Db,
  command: QuoteOrderCommand,
  actor: AuditActor,
): Promise<QuoteOrderResult> {
  const parsedCommand = quoteOrderCommandSchema.safeParse(command);
  if (!parsedCommand.success) {
    throw validationError(
      parsedCommand.error.issues[0]?.message ?? "Los datos de la cotización no son válidos.",
      { issues: parsedCommand.error.issues },
    );
  }
  command = parsedCommand.data;
  await assertCustomerExists(db, command.customerId);

  const commandLines = command.lines ?? [];
  // Defensive re-check of orderLineCommandSchema's refinement (D-2).
  for (const line of commandLines) {
    const description = line.description?.trim() ?? "";
    if ((line.itemId ?? null) === null && description === "") {
      throw validationError("Cada línea necesita un ítem del catálogo o una descripción.", {
        line,
      });
    }
  }
  await resolveItemSnapshots(
    db,
    commandLines.map((l) => l.itemId).filter((id): id is string => typeof id === "string"),
  );

  const agreedTotal = command.agreedTotal ?? null;
  if (agreedTotal !== null && (!Number.isSafeInteger(agreedTotal) || agreedTotal < 0)) {
    throw validationError("El subtotal de artículos debe ser un entero no negativo (centavos).", {
      agreedTotal,
    });
  }
  const additionalCharge = command.additionalCharge ?? 0;
  if (!Number.isSafeInteger(additionalCharge) || additionalCharge < 0) {
    throw validationError("El cargo adicional debe ser un entero no negativo (centavos).", {
      additionalCharge,
    });
  }
  if (
    agreedTotal !== null &&
    commandLines.length > 0 &&
    allocateAgreedTotalToOrderLines(
      toCentavos(agreedTotal),
      commandLines.map((line) => ({ qty: line.qty ?? 1000, lineTotal: line.lineTotal })),
    ) === null
  ) {
    throw validationError("Las líneas no se pueden repartir exactamente en el subtotal acordado.", {
      agreedTotal,
    });
  }

  const depositRequired =
    command.depositRequired ??
    (agreedTotal === null ? null : await resolveDefaultDepositRequired(db, agreedTotal));

  const orderId = generateUuidV7();
  const now = nowIso();
  const orderRow: OrderRow = {
    id: orderId,
    status: "QUOTING",
    customerId: command.customerId,
    description: command.description,
    agreedTotal,
    additionalCharge,
    depositRequired,
    depositPaid: 0,
    depositTxId: null,
    deliveryDate: command.deliveryDate ?? null,
    deliveryPlace: command.deliveryPlace ?? null,
    saleId: null,
    cancelResolution: null,
    // KOK-185: assigned by an AFTER INSERT trigger (migration 0024), never by core/ — re-read
    // after db.batch() and folded into the returned DTO.
    code: null,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const lineRows: OrderLineRow[] = commandLines.map((line) => ({
    id: generateUuidV7(),
    customOrderId: orderId,
    itemId: line.itemId ?? null,
    description: line.description?.trim() || null,
    qty: line.qty ?? 1000,
    lineTotal: line.lineTotal ?? null,
  }));

  const statements: Statement[] = [
    db.insert(customOrders).values(orderRow),
    ...lineRows.map((row) => db.insert(customOrderLines).values(row)),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "custom_orders",
      entityId: orderId,
      before: null,
      after: orderRow,
    }),
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  const [codeRow, customerName] = await Promise.all([
    db.query.customOrders.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, orderId),
      columns: { code: true },
    }),
    loadCustomerName(db, command.customerId),
  ]);
  const initialBalance = calculateOrderReceiptBalance(agreedTotal, additionalCharge, 0);
  const financeBalance: OrderFinanceBalance = {
    orderId,
    status: "QUOTING",
    customerAmount: initialBalance.customerAmount,
    qualifyingReceipts: 0,
    expected: initialBalance.expected,
    excess: initialBalance.excess,
  };

  return {
    order: toOrderDto(
      { ...orderRow, code: codeRow?.code ?? null },
      lineRows,
      customerName,
      financeBalance,
    ),
  };
}

function nextOrderUpdatedAt(expectedUpdatedAt: string): string {
  const nowMs = Date.parse(nowIso());
  const expectedMs = Date.parse(expectedUpdatedAt);
  if (!Number.isSafeInteger(expectedMs)) {
    throw validationError("La versión del pedido no es válida.", { expectedUpdatedAt });
  }
  return new Date(Math.max(nowMs, expectedMs + 1)).toISOString();
}

/** Update an active agreement and its lines as one stale-safe, audited D1 batch. */
export async function updateOrder(
  db: Db,
  id: string,
  command: UpdateOrderCommand,
  actor: AuditActor,
): Promise<UpdateOrderResult> {
  const parsedCommand = updateOrderCommandSchema.safeParse(command);
  if (!parsedCommand.success) {
    throw validationError(
      parsedCommand.error.issues[0]?.message ?? "Los datos del pedido no son válidos.",
      { issues: parsedCommand.error.issues },
    );
  }
  command = parsedCommand.data;
  const row = await loadOrderRowOrThrow(db, id);
  if (!EDITABLE_ORDER_STATUSES.includes(row.status)) {
    throw conflict("Solo se puede editar un pedido antes de entregarlo o cancelarlo.", {
      id,
      status: row.status,
    });
  }
  if (row.updatedAt !== command.expectedUpdatedAt) {
    throw conflict(
      "El pedido cambió mientras lo editabas. Actualiza la página e inténtalo de nuevo.",
      {
        id,
        expectedUpdatedAt: command.expectedUpdatedAt,
        currentUpdatedAt: row.updatedAt,
      },
    );
  }

  await assertCustomerExists(db, command.customerId);
  if (command.customerId !== row.customerId) {
    const receiptSummary = await getOrderReceiptSummary(db, id);
    if (receiptSummary.hasEverQualifyingReceipt) {
      throw conflict("No se puede cambiar el cliente después de vincular un recibo al pedido.", {
        id,
        customerId: row.customerId,
      });
    }
  }

  if (
    command.agreedTotal !== null &&
    (!Number.isSafeInteger(command.agreedTotal) || command.agreedTotal < 0)
  ) {
    throw validationError("El subtotal de artículos debe ser un entero no negativo (centavos).", {
      agreedTotal: command.agreedTotal,
    });
  }
  if (command.agreedTotal === null && row.status !== "QUOTING") {
    throw validationError(
      "El subtotal de artículos es obligatorio después de confirmar el pedido.",
      {
        id,
        status: row.status,
      },
    );
  }
  if (!Number.isSafeInteger(command.additionalCharge) || command.additionalCharge < 0) {
    throw validationError("El cargo adicional debe ser un entero no negativo (centavos).", {
      additionalCharge: command.additionalCharge,
    });
  }

  const commandLines = command.lines;
  for (const line of commandLines) {
    if (!Number.isSafeInteger(line.qty ?? 1000) || (line.qty ?? 1000) <= 0) {
      throw validationError("La cantidad de cada línea debe ser un entero positivo.", { line });
    }
    const description = line.description?.trim() ?? "";
    if ((line.itemId ?? null) === null && description === "") {
      throw validationError("Cada línea necesita un ítem del catálogo o una descripción.", {
        line,
      });
    }
    if (line.lineTotal != null && (!Number.isSafeInteger(line.lineTotal) || line.lineTotal < 0)) {
      throw validationError("El importe de cada línea debe ser un entero no negativo.", { line });
    }
  }
  await resolveItemSnapshots(
    db,
    commandLines.map((line) => line.itemId).filter((itemId): itemId is string => itemId != null),
  );

  if (
    command.agreedTotal !== null &&
    commandLines.length > 0 &&
    allocateAgreedTotalToOrderLines(
      toCentavos(command.agreedTotal),
      commandLines.map((line) => ({ qty: line.qty ?? 1000, lineTotal: line.lineTotal })),
    ) === null
  ) {
    throw validationError("Las líneas no se pueden repartir exactamente en el subtotal acordado.", {
      id,
      agreedTotal: command.agreedTotal,
      lines: commandLines,
    });
  }

  const beforeLines = await loadOrderLineRows(db, id);
  const now = nextOrderUpdatedAt(command.expectedUpdatedAt);
  const updatedFields = {
    customerId: command.customerId,
    description: command.description,
    agreedTotal: command.agreedTotal,
    additionalCharge: command.additionalCharge,
    deliveryDate: command.deliveryDate,
    deliveryPlace: command.deliveryPlace,
    notes: command.notes,
    updatedAt: now,
  };
  const lineRows: OrderLineRow[] = commandLines.map((line) => ({
    id: generateUuidV7(),
    customOrderId: id,
    itemId: line.itemId ?? null,
    description: line.description?.trim() || null,
    qty: line.qty ?? 1000,
    lineTotal: line.lineTotal ?? null,
  }));

  const versionGuard = sql`EXISTS (
    SELECT 1 FROM custom_orders
    WHERE id = ${id}
      AND updated_at = ${command.expectedUpdatedAt}
      AND deleted_at IS NULL
      AND status IN ('QUOTING','CONFIRMED','IN_PRODUCTION','READY')
  )`;
  const statements: Statement[] = [
    db.delete(customOrderLines).where(and(eq(customOrderLines.customOrderId, id), versionGuard)),
    ...lineRows.map((line) =>
      db.insert(customOrderLines).select(sql`
        SELECT ${line.id}, ${line.customOrderId}, ${line.itemId}, ${line.description}, ${line.qty}, ${line.lineTotal}
        WHERE ${versionGuard}
      `),
    ),
    buildAuditLogInsert(db, {
      actor,
      action: "update",
      entityType: "custom_orders",
      entityId: id,
      before: { ...row, lines: beforeLines },
      after: { ...updatedFields, lines: lineRows },
    }),
    db
      .update(customOrders)
      .set(updatedFields)
      .where(
        and(
          eq(customOrders.id, id),
          eq(customOrders.updatedAt, command.expectedUpdatedAt),
          isNull(customOrders.deletedAt),
          inArray(customOrders.status, EDITABLE_ORDER_STATUSES),
          command.customerId === row.customerId
            ? sql`1 = 1`
            : sql`NOT EXISTS (
                SELECT 1 FROM financial_transactions
                WHERE custom_order_id = ${id}
                  AND type = 'INCOME'
                  AND category IN ('ORDER_DEPOSIT','ORDER_BALANCE')
                  AND source_event_id IS NULL
              )`,
        ),
      ),
    // `D1Database.batch` rolls the whole command back on statement failure. This tripwire turns a
    // failed compare-and-swap (changes() = 0 on the immediately preceding UPDATE) into that rollback,
    // including the audit row built above; it does not write on a successful update.
    db.insert(customOrderLines).select(sql`
      SELECT NULL, NULL, NULL, NULL, 0, NULL WHERE changes() = 0
    `),
  ];

  try {
    await db.batch(statements as [Statement, ...Statement[]]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("custom_order_lines.id")) {
      const current = await loadOrderRowOrThrow(db, id);
      if (current.updatedAt !== command.expectedUpdatedAt) {
        throw conflict(
          "El pedido cambió mientras lo editabas. Actualiza la página e inténtalo de nuevo.",
          {
            id,
            expectedUpdatedAt: command.expectedUpdatedAt,
            currentUpdatedAt: current.updatedAt,
          },
        );
      }
      if (command.customerId !== row.customerId) {
        const receiptSummary = await getOrderReceiptSummary(db, id);
        if (receiptSummary.hasEverQualifyingReceipt) {
          throw conflict(
            "No se puede cambiar el cliente después de vincular un recibo al pedido.",
            {
              id,
              customerId: current.customerId,
            },
          );
        }
      }
      throw conflict("El pedido ya no está disponible para editar.", {
        id,
        status: current.status,
      });
    }
    throw error;
  }

  return { order: await readOrderDto(db, id) };
}

// ---- UC-06 confirm (O-8) ----------------------------------------------------------------------

/** `QUOTING → CONFIRMED`: one audited status update, with no finance rows or account deltas. */
export async function confirmOrder(
  db: Db,
  id: string,
  command: ConfirmOrderCommand,
  actor: AuditActor,
): Promise<ConfirmOrderResult> {
  const parsedCommand = confirmOrderCommandSchema.safeParse(command);
  if (!parsedCommand.success) {
    throw validationError("Confirmar el pedido no acepta datos de pago.", {
      id,
      issues: parsedCommand.error.issues,
    });
  }
  const row = await loadOrderRowOrThrow(db, id);
  assertTransitionAllowed(row, "confirm");

  if (row.agreedTotal === null) {
    throw validationError("Define el total acordado antes de confirmar el pedido.", {
      id,
      agreedTotal: row.agreedTotal,
    });
  }
  const lineRows = await loadOrderLineRows(db, id);
  if (
    lineRows.length > 0 &&
    allocateAgreedTotalToOrderLines(toCentavos(row.agreedTotal), lineRows) === null
  ) {
    throw validationError("Las líneas no se pueden repartir exactamente en el subtotal acordado.", {
      id,
      agreedTotal: row.agreedTotal,
      lines: lineRows,
    });
  }

  const now = nextOrderUpdatedAt(row.updatedAt);
  const updatedFields = {
    status: "CONFIRMED" as const,
    updatedAt: now,
  };

  await db.batch([
    db.update(customOrders).set(updatedFields).where(eq(customOrders.id, id)),
    buildAuditLogInsert(db, {
      actor,
      action: "confirm",
      entityType: "custom_orders",
      entityId: id,
      before: { status: row.status },
      after: updatedFields,
    }),
  ]);

  return { order: await readOrderDto(db, id) };
}

// ---- Pure status transitions ------------------------------------------------------------------

/** `CONFIRMED → IN_PRODUCTION` and `IN_PRODUCTION → READY` are identical in shape: a guarded status
 * flip plus its audit row, in one batch. No money, no kardex — production itself is a separate
 * ProductionRun linked by `custom_order_id` (O-4), not something this transition writes. */
async function applyPureTransition(
  db: Db,
  id: string,
  transition: Extract<OrderTransition, "start" | "ready" | "undoStart" | "undoReady">,
  nextStatus: CustomOrderStatus,
  action: string,
  actor: AuditActor,
): Promise<OrderTransitionResult> {
  const row = await loadOrderRowOrThrow(db, id);
  assertTransitionAllowed(row, transition);

  const updatedFields = { status: nextStatus, updatedAt: nextOrderUpdatedAt(row.updatedAt) };
  await db.batch([
    db.update(customOrders).set(updatedFields).where(eq(customOrders.id, id)),
    buildAuditLogInsert(db, {
      actor,
      action,
      entityType: "custom_orders",
      entityId: id,
      before: { status: row.status },
      after: updatedFields,
    }),
  ]);

  return { order: await readOrderDto(db, id) };
}

/** UC-07 step: `CONFIRMED → IN_PRODUCTION`. */
export async function startOrderProduction(
  db: Db,
  id: string,
  actor: AuditActor,
): Promise<OrderTransitionResult> {
  return applyPureTransition(db, id, "start", "IN_PRODUCTION", "start_production", actor);
}

/** UC-07 step: `IN_PRODUCTION → READY`. */
export async function markOrderReady(
  db: Db,
  id: string,
  actor: AuditActor,
): Promise<OrderTransitionResult> {
  return applyPureTransition(db, id, "ready", "READY", "mark_ready", actor);
}

/** Free reversal (Doc 03 §5 amendment, no money): `IN_PRODUCTION -> CONFIRMED`. */
export async function undoStartOrderProduction(
  db: Db,
  id: string,
  actor: AuditActor,
): Promise<OrderTransitionResult> {
  return applyPureTransition(db, id, "undoStart", "CONFIRMED", "undo_start_production", actor);
}

/** Free reversal (Doc 03 §5 amendment, no money): `READY -> IN_PRODUCTION`. */
export async function undoMarkOrderReady(
  db: Db,
  id: string,
  actor: AuditActor,
): Promise<OrderTransitionResult> {
  return applyPureTransition(db, id, "undoReady", "IN_PRODUCTION", "undo_mark_ready", actor);
}

// ---- UC-07 deliver (O-8) ----------------------------------------------------------------------

interface DeliveryPlan {
  order: OrderRow;
  saleId: string;
  now: string;
  saleRow: SaleRow;
  saleLineRows: SaleLineRow[];
  movements: StockMovementInput[];
}

/**
 * Everything a delivery needs, built and validated but NOT written — so `previewOrderImpact`'s dry
 * run and `deliverOrder`'s real run can never derive the sale differently. Mirrors
 * `core/sales`' `buildSaleCreateMovements`.
 */
async function buildDeliveryPlan(
  db: Db,
  id: string,
  command: DeliverOrderCommand,
): Promise<DeliveryPlan> {
  const parsedCommand = deliverOrderCommandSchema.safeParse(command);
  if (!parsedCommand.success) {
    throw validationError(
      parsedCommand.error.issues[0]?.message ?? "Los datos de entrega no son válidos.",
      { id, issues: parsedCommand.error.issues },
    );
  }
  command = parsedCommand.data;
  const order = await loadOrderRowOrThrow(db, id);
  assertTransitionAllowed(order, "deliver");

  const agreedTotal = order.agreedTotal;
  if (agreedTotal === null || !Number.isSafeInteger(agreedTotal) || agreedTotal < 0) {
    // Unreachable through the state machine (confirming requires one), but core/ asserts rather
    // than assumes (D-2).
    throw conflict("El pedido no tiene un total acordado; no se puede entregar.", { id });
  }

  const lineRows = await loadOrderLineRows(db, id);
  if (lineRows.length === 0) {
    throw conflict(
      "Agrega al menos una línea con un ítem del catálogo antes de entregar el pedido.",
      { id },
    );
  }

  // The Doc 04 §5 item-link rule is enforced by refusing rather than misstating. The pre-delivery
  // agreement form resolves these lines through `updateOrder` before offering "Entregar".
  const unlinked = lineRows.filter((line) => line.itemId === null);
  if (unlinked.length > 0) {
    throw conflict(
      "Cada línea del pedido debe estar vinculada a un ítem del catálogo antes de entregar. Vincula las líneas pendientes e inténtalo de nuevo.",
      { id, unlinkedLineIds: unlinked.map((l) => l.id) },
    );
  }

  const snapshotByItem = await resolveItemSnapshots(
    db,
    lineRows.map((l) => l.itemId).filter((itemId): itemId is string => itemId !== null),
  );

  // D-5: split the agreed total across the lines so Σ(qty × unit_price) reproduces it to the
  // centavo. Refuses (null) rather than rounding the customer's agreed price.
  const allocations = allocateAgreedTotalToOrderLines(toCentavos(agreedTotal), lineRows);
  if (allocations === null) {
    throw validationError(
      "No se puede repartir el total acordado en precios unitarios exactos para estas líneas. Ajusta el total acordado, las cantidades o los importes por línea.",
      {
        id,
        agreedTotal,
        lines: lineRows.map((l) => ({ id: l.id, qty: l.qty, lineTotal: l.lineTotal })),
      },
    );
  }

  const saleId = generateUuidV7();
  const now = nowIso();
  const saleLineRows: SaleLineRow[] = [];
  const movements: StockMovementInput[] = [];

  lineRows.forEach((line, i) => {
    const itemId = line.itemId;
    const allocation = allocations[i];
    if (itemId === null || allocation === undefined) {
      // Unreachable: both were established above.
      throw validationError("Estado inconsistente al preparar la entrega.", {
        id,
        lineId: line.id,
      });
    }
    const unitCostSnapshotMc = snapshotByItem.get(itemId);
    if (unitCostSnapshotMc === undefined) {
      throw validationError("Estado inconsistente al preparar la entrega.", { id, itemId });
    }
    saleLineRows.push({
      id: generateUuidV7(),
      saleId,
      itemId,
      qty: line.qty,
      unitPriceMc: allocation.unitPriceMc,
      unitCostSnapshotMc,
    });
    movements.push({
      itemId,
      occurredAt: command.occurredAt,
      businessDate: command.businessDate,
      type: "SALE_OUT",
      // sale_lines.qty is stored POSITIVE; the OUT sign is applied only at the movements boundary,
      // identically to core/sales and core/inventory/exits.
      qty: -line.qty,
      unitCostMc: unitCostSnapshotMc,
      // 'sale', NOT 'custom_order': stock-wise this IS a sale, and `costing_adjustments`'
      // trigger_event_type admits `sale` (migration 0004) so a backdated delivery replays like one.
      sourceEventType: "sale",
      sourceEventId: saleId,
    });
  });

  // Server-recomputed exactly as Doc 04 §5 requires — never read back from `agreedTotal`. The
  // allocation guarantees these agree; asserting it here is what makes that guarantee load-bearing
  // rather than assumed.
  const merchandiseTotal = saleLineRows.reduce(
    (sum, line) =>
      addMoney(
        toCentavos(sum),
        totalCentavos(toMilliCentavosPerUnit(line.unitPriceMc), toMilliUnits(line.qty)),
      ),
    0,
  );
  if (merchandiseTotal !== agreedTotal) {
    throw validationError("El total de las líneas no coincide con el total acordado.", {
      id,
      total: merchandiseTotal,
      agreedTotal,
    });
  }

  const total = addMoney(toCentavos(merchandiseTotal), toCentavos(order.additionalCharge));

  const saleRow: SaleRow = {
    id: saleId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    channel: "CUSTOM_ORDER",
    customOrderId: id,
    customerId: order.customerId,
    sessionId: null,
    total,
    additionalCharge: order.additionalCharge,
    // Required by the legacy sales schema only; custom-order debt is derived from direct receipts.
    paymentStatus: "ON_CREDIT",
    paidAt: null,
    paymentMethod: null,
    accountId: null,
    // KOK-185: assigned by an AFTER INSERT trigger (migration 0024), never by core/ — re-read
    // after db.batch() and folded into the returned DTO (mirrors core/sales/index.ts's own
    // recordSale, which this delivery-created sale otherwise parallels).
    code: null,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return { order, saleId, now, saleRow, saleLineRows, movements };
}

/** `READY → DELIVERED`: one atomic sale/stock/audit/replay batch; no financial rows or deltas. */
export async function deliverOrder(
  db: Db,
  id: string,
  command: DeliverOrderCommand,
  actor: AuditActor,
): Promise<DeliverOrderResult> {
  const plan = await buildDeliveryPlan(db, id, command);

  // INV-11 / R-2 ordering guard, identical to recordSale's: a delivery writes SALE_OUT movements,
  // so a backdated one re-weights C-1 for every later kardex entry. Planned BEFORE the batch is
  // assembled so the R-5 refusal happens before a single write.
  const replay = await planCostingReplay(db, {
    trigger: {
      eventType: "sale",
      eventId: plan.saleId,
      businessDate: command.businessDate,
      occurredAt: command.occurredAt,
    },
    changes: [
      { sourceEventType: "sale", sourceEventId: plan.saleId, newMovements: plan.movements },
    ],
    actor,
  });

  if (replay.confirmationRequired && command.confirm !== true) {
    throw conflict(
      "Esta entrega tiene fecha anterior a movimientos ya registrados y cambia costos ya calculados. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: replay.impact },
    );
  }

  const { statements: movementStatements } = buildStockMovementStatements(db, plan.movements);

  const updatedFields = {
    status: "DELIVERED" as const,
    saleId: plan.saleId,
    updatedAt: nextOrderUpdatedAt(plan.order.updatedAt),
  };

  const statements: Statement[] = [
    db.insert(sales).values(plan.saleRow),
    ...plan.saleLineRows.map((row) => db.insert(saleLines).values(row)),
    ...movementStatements,
    db.update(customOrders).set(updatedFields).where(eq(customOrders.id, id)),
    buildAuditLogInsert(db, {
      actor,
      action: "deliver",
      entityType: "custom_orders",
      entityId: id,
      before: { status: plan.order.status, saleId: plan.order.saleId },
      after: updatedFields,
    }),
    // The created sale is a first-class event of its own — it gets the same audit row recordSale
    // would have written for it.
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "sales",
      entityId: plan.saleId,
      before: null,
      after: plan.saleRow,
    }),
    // R-2: the replay lands in THIS batch (D-3), LAST and specifically after `movementStatements`
    // — replay.ts's module header states that requirement. Empty on the ordinary same-day path.
    ...replay.statements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  const saleCodeRow = await db.query.sales.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, plan.saleId),
    columns: { code: true },
  });

  return {
    order: await readOrderDto(db, id),
    sale: toSaleDto({ ...plan.saleRow, code: saleCodeRow?.code ?? null }, plan.saleLineRows),
  };
}

/** Everything `undoDeliverOrder`'s real run and `previewOrderImpact`'s "undo_deliver" dry run both
 * need — same "plan once, both consume it" shape as `buildDeliveryPlan`. Read-only: loads, asserts,
 * and plans the replay, writes nothing. */
async function planUndoDeliverImpact(
  db: Db,
  id: string,
  actor: AuditActor,
): Promise<{
  order: OrderRow;
  saleId: string;
  saleRow: SaleRow;
  kardexUnchanged: boolean;
  costingPlan: CostingReplayPlan;
}> {
  const order = await loadOrderRowOrThrow(db, id);
  assertTransitionAllowed(order, "undoDeliver");

  const saleId = order.saleId;
  if (saleId === null) {
    // Unreachable through the state machine (DELIVERED always sets sale_id) — asserted per D-2.
    throw conflict("El pedido entregado no tiene una venta vinculada; no se puede deshacer.", {
      id,
    });
  }
  const saleRow = await db.query.sales.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, saleId),
  });
  if (!saleRow) {
    throw notFound("No se encontró la venta de este pedido.", { id, saleId });
  }

  const { kardexUnchanged, costingPlan } = await planSaleMutationCostingImpact(
    db,
    saleId,
    { businessDate: saleRow.businessDate, occurredAt: saleRow.occurredAt },
    [],
    actor,
  );

  return { order, saleId, saleRow, kardexUnchanged, costingPlan };
}

/**
 * O-8: `DELIVERED -> READY`. One atomic batch (D-3):
 *   - reverses the SALE_OUT `stock_movements` + nets `item_stock` back (`buildReplaceMovementsFor-
 *     SourceStatements("sale", saleId, [])`)
 *   - leaves every independently recorded finance row and account balance unchanged
 *   - soft-deletes the sale (D-8) — mirrors `deleteSale`'s own `newRow` shape exactly
 *   - the `custom_orders` UPDATE: `status='READY'`, `sale_id=null` (a future re-delivery mints a
 *     fresh sale id, consistent with `buildDeliveryPlan` always generating one)
 *   - two `audit_log` rows (order transition + sale soft-delete), mirroring `deliverOrder`'s own
 *     two-row shape
 *   - whatever `costingPlan.statements` the R-2/R-5 replay requires (LAST, after the movement
 *     statements — `replay.ts`'s own ordering requirement, unchanged from every other caller)
 */
export async function undoDeliverOrder(
  db: Db,
  id: string,
  command: UndoDeliverOrderCommand,
  actor: AuditActor,
): Promise<OrderTransitionResult> {
  const { order, saleId, saleRow, kardexUnchanged, costingPlan } = await planUndoDeliverImpact(
    db,
    id,
    actor,
  );

  if (costingPlan.confirmationRequired && command.confirm !== true) {
    throw conflict(
      "Deshacer esta entrega cambia costos ya calculados de ventas o salidas registradas. Revisa el impacto y confirma para deshacerla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: costingPlan.impact },
    );
  }

  const movementStatements = kardexUnchanged
    ? []
    : (await buildReplaceMovementsForSourceStatements(db, "sale", saleId, [])).statements;

  const now = nowIso();
  const updatedSaleFields = { deletedAt: now, updatedAt: now };
  const updatedOrderFields = {
    status: "READY" as const,
    saleId: null,
    updatedAt: nextOrderUpdatedAt(order.updatedAt),
  };

  const statements: Statement[] = [
    ...movementStatements,
    db.update(sales).set(updatedSaleFields).where(eq(sales.id, saleId)),
    db.update(customOrders).set(updatedOrderFields).where(eq(customOrders.id, id)),
    buildAuditLogInsert(db, {
      actor,
      action: "undo_deliver",
      entityType: "custom_orders",
      entityId: id,
      before: { status: order.status, saleId: order.saleId },
      after: updatedOrderFields,
    }),
    buildAuditLogInsert(db, {
      actor,
      action: "delete",
      entityType: "sales",
      entityId: saleId,
      before: saleRow,
      after: { ...saleRow, ...updatedSaleFields },
    }),
    ...costingPlan.statements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);
  return { order: await readOrderDto(db, id) };
}

/**
 * R-5 dry run (ADR-016): what delivery/undo would do to already-booked cost, computed without
 * writing anything. Mirrors `previewSaleImpact`; these are the order transitions that write kardex
 * movements, so they are the only operations this accepts.
 */
export async function previewOrderImpact(
  db: Db,
  request: OrderImpactRequest,
): Promise<ReplayImpactDto> {
  if (request.op === "undo_deliver") {
    const { costingPlan } = await planUndoDeliverImpact(db, request.id, "OWNER_WEB");
    return costingPlan.impact;
  }
  const plan = await buildDeliveryPlan(db, request.id, request.command);
  const replay = await planCostingReplay(db, {
    trigger: {
      eventType: "sale",
      eventId: plan.saleId,
      businessDate: request.command.businessDate,
      occurredAt: request.command.occurredAt,
    },
    changes: [
      { sourceEventType: "sale", sourceEventId: plan.saleId, newMovements: plan.movements },
    ],
    actor: "OWNER_WEB",
  });
  return replay.impact;
}

// ---- UC-08 cancel (O-8) -----------------------------------------------------------------------

/** Cancellation is terminal and changes no cash; refunds, if any, are independent finance events. */
export async function cancelOrder(
  db: Db,
  id: string,
  command: CancelOrderCommand,
  actor: AuditActor,
): Promise<CancelOrderResult> {
  const parsedCommand = cancelOrderCommandSchema.safeParse(command);
  if (!parsedCommand.success) {
    throw validationError(
      parsedCommand.error.issues[0]?.message ?? "Los datos de cancelación no son válidos.",
      { id, issues: parsedCommand.error.issues },
    );
  }
  command = parsedCommand.data;
  const row = await loadOrderRowOrThrow(db, id);
  assertTransitionAllowed(row, "cancel");

  const updatedFields = {
    status: "CANCELLED" as const,
    notes: command.notes ?? row.notes,
    updatedAt: nextOrderUpdatedAt(row.updatedAt),
  };

  const statements: Statement[] = [
    db.update(customOrders).set(updatedFields).where(eq(customOrders.id, id)),
    buildAuditLogInsert(db, {
      actor,
      action: "cancel",
      entityType: "custom_orders",
      entityId: id,
      before: { status: row.status },
      after: updatedFields,
    }),
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return { order: await readOrderDto(db, id) };
}

// ---- Reads ------------------------------------------------------------------------------------

export async function getOrder(db: Db, id: string): Promise<OrderDto> {
  return readOrderDto(db, id);
}

/**
 * SC-04's bounded board/history read. O-5 keyset pagination follows delivery_date DESC NULLS LAST,
 * created_at DESC, id DESC. Related rows are loaded in bounded set queries, never per order.
 */
export async function listOrders(
  db: Db,
  filters: ListOrdersFilters = {},
): Promise<ListOrdersResult> {
  const fromDate = filters.fromDate ?? filters.toDate;
  const toDate = filters.toDate ?? filters.fromDate;
  const dateWindow =
    fromDate !== undefined && toDate !== undefined
      ? businessDateRangeToUtcWindow(fromDate, toDate)
      : undefined;
  const pageSize = filters.limit ?? 500;

  const rowsWithLookahead = await db.query.customOrders.findMany({
    where: (t, { and, eq: eqOp, gte, isNull, lt, notInArray }) => {
      const clauses = [isNull(t.deletedAt)];
      if (filters.status !== undefined) clauses.push(eqOp(t.status, filters.status));
      if (filters.excludeStatuses !== undefined && filters.excludeStatuses.length > 0)
        clauses.push(notInArray(t.status, filters.excludeStatuses));
      if (filters.customerId !== undefined) clauses.push(eqOp(t.customerId, filters.customerId));
      if (filters.fromDate !== undefined && dateWindow !== undefined)
        clauses.push(gte(t.createdAt, dateWindow.startInclusive));
      if (filters.toDate !== undefined && dateWindow !== undefined)
        clauses.push(lt(t.createdAt, dateWindow.endExclusive));
      if (filters.cursor !== undefined) {
        const cursor = filters.cursor;
        const cursorClause =
          cursor.deliveryDate === null
            ? sql`(${t.deliveryDate} IS NULL AND (${t.createdAt} < ${cursor.createdAt} OR (${t.createdAt} = ${cursor.createdAt} AND ${t.id} < ${cursor.id})))`
            : sql`(${t.deliveryDate} < ${cursor.deliveryDate} OR ${t.deliveryDate} IS NULL OR (${t.deliveryDate} = ${cursor.deliveryDate} AND ${t.createdAt} < ${cursor.createdAt}) OR (${t.deliveryDate} = ${cursor.deliveryDate} AND ${t.createdAt} = ${cursor.createdAt} AND ${t.id} < ${cursor.id}))`;
        clauses.push(cursorClause);
      }
      return and(...clauses);
    },
    orderBy: (t, { asc, desc, sql: sqlOp }) => [
      asc(sqlOp`${t.deliveryDate} IS NULL`),
      desc(t.deliveryDate),
      desc(t.createdAt),
      desc(t.id),
    ],
    limit: pageSize + 1,
  });

  const hasMore = rowsWithLookahead.length > pageSize;
  const rows = hasMore ? rowsWithLookahead.slice(0, pageSize) : rowsWithLookahead;
  if (rows.length === 0) return { orders: [], nextCursor: null };

  const orderIds = rows.map((row) => row.id);
  const orderIdBatches = chunkValues(orderIds, ORDER_READ_BATCH_SIZE);
  const customerIdBatches = chunkValues(
    [...new Set(rows.map((row) => row.customerId))],
    ORDER_READ_BATCH_SIZE,
  );
  const [lineRowBatches, customerRowBatches] = await Promise.all([
    Promise.all(
      orderIdBatches.map((batch) =>
        db.query.customOrderLines.findMany({
          where: (t, { inArray: inArrayOp }) => inArrayOp(t.customOrderId, batch),
        }),
      ),
    ),
    Promise.all(
      customerIdBatches.map((batch) =>
        db.query.customers.findMany({
          where: (t, { inArray: inArrayOp }) => inArrayOp(t.id, batch),
        }),
      ),
    ),
  ]);
  const lineRows = lineRowBatches.flat();
  const customerRows = customerRowBatches.flat();

  const linesByOrder = new Map<string, OrderLineRow[]>();
  for (const line of lineRows) {
    const bucket = linesByOrder.get(line.customOrderId);
    if (bucket === undefined) linesByOrder.set(line.customOrderId, [line]);
    else bucket.push(line);
  }
  const nameById = new Map(customerRows.map((c) => [c.id, c.name]));
  const financeBalancesByOrderId = await getOrderFinanceBalances(db, orderIds);
  const lastOrder = rows[rows.length - 1];
  const nextCursor: OrderListCursor | null =
    hasMore && lastOrder !== undefined
      ? {
          deliveryDate: lastOrder.deliveryDate,
          createdAt: lastOrder.createdAt,
          id: lastOrder.id,
        }
      : null;

  return {
    nextCursor,
    orders: rows.map((row) => {
      const financeBalance = financeBalancesByOrderId.get(row.id);
      if (financeBalance === undefined) {
        throw new DomainError("INTERNAL", "No se pudo derivar el saldo del pedido.", {
          orderId: row.id,
        });
      }
      return toOrderDto(
        row,
        linesByOrder.get(row.id) ?? [],
        nameById.get(row.customerId) ?? null,
        financeBalance,
      );
    }),
  };
}
