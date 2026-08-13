// core/orders — UC-05…UC-08 "custom order lifecycle" (KOK-033, Doc 03 §5's O-1…O-5, Doc 04 §3.3
// `custom_orders`/`custom_order_lines` + §5, ADR-012). Named `orders` (not `custom-orders`) to
// match Doc 03's own UC table, which calls these commands `orders.quote` / `orders.confirm` /
// `orders.deliver` / `orders.cancel`.
//
// Same TEMPLATE shape as core/sales and core/purchasing: every exported command is a top-level
// entry point that does its own defensive validation (D-2: core/ never trusts that a caller ran
// Zod), builds every row itself, and executes exactly ONE atomic `db.batch()` (D-3/INV-1).
//
// THE STATE MACHINE IS THE ONLY WAY IN. Doc 04 §5: "`custom_orders` transitions only along the
// state machine (O-1…O-3)". There is deliberately no generic `updateOrder` free-editing columns,
// and no soft-delete/restore pair — `CANCELLED` IS the terminal "this didn't happen" state:
//
//   QUOTING --confirm(+deposit)--> CONFIRMED --start--> IN_PRODUCTION --ready--> READY
//           --deliver--> DELIVERED (final)
//   {QUOTING, CONFIRMED, IN_PRODUCTION, READY} --cancel--> CANCELLED (final)
//
// Every other (status, transition) pair is a 409 CONFLICT with a Spanish `message_es`
// (`assertTransitionAllowed`), which is what makes the illegal-transition tests exhaustive.
//
// ---- MONEY, AND WHY NONE OF IT IS REVENUE BEFORE DELIVERY (INV-7 / ADR-012) -------------------
// A deposit is CASH THAT IS NOT YOURS YET. `confirmOrder` books an INCOME/`ORDER_DEPOSIT` row and
// credits a real account (the money physically arrived), while the matching liability is DERIVED,
// never stored: `v_liability` nets ORDER_DEPOSIT − DEPOSIT_REFUND − Σ deposit_paid of DELIVERED
// orders. So each transition releases the liability by CHANGING THE FACTS THE VIEW READS, not by
// writing a balance anywhere:
//   - deliver → `status='DELIVERED'` makes the view subtract this order's `deposit_paid`. The
//     revenue is recognized exactly once, by the created sale, at delivery — never before (INV-7).
//   - cancel/REFUND  → an EXPENSE/`DEPOSIT_REFUND` row the view subtracts; the cash leaves too.
//   - cancel/FORFEIT → NO new transaction. The original deposit row is RECATEGORIZED IN PLACE to
//     `OTHER_INCOME`, which drops it out of the view's `category IN (...)` filter (liability gone)
//     and recognizes the income in one move. Writing a second income row instead would double-count
//     cash that is ALREADY in the account. This shifts that historical month's `v_cashflow_daily`
//     category mix by design (the row keeps its original `business_date`) — accepted, not a bug.
//
// ---- WHY DELIVERY DEMANDS ITEM-LINKED LINES (the O-2 / Doc 04 §5 collision) -------------------
// `custom_order_lines.item_id` is NULLABLE (free-text one-offs are legal while quoting), but
// `sale_lines.item_id` is NOT NULL and FINISHED-only, and Doc 04 §5 recomputes
// `sales.total = Σ(qty × unit_price)` server-side. A line-less or free-text-only delivery therefore
// cannot produce a sale whose total is the agreed total without either inventing revenue with no
// lines behind it or dropping the SALE_OUT movement for what was actually shipped — the latter
// drifting `item_stock` upward forever (INV-5), since O-4 says order production is a normal
// ProductionRun that already booked PRODUCTION_IN against a real `output_item_id`.
// So `deliverOrder` REFUSES (409) while any line lacks an `item_id`. The KOK-034 drawer must let
// the owner attach catalog items to every line before offering "Entregar".
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
  OrderDto,
  OrderImpactRequest,
  OrderLineDto,
  OrderTransitionResult,
  QuoteOrderCommand,
  QuoteOrderResult,
  ReplayImpactDto,
  ResolveOrderLineCommand,
  ResolveOrderLineResult,
  SaleDto,
  UndoDeliverOrderCommand,
} from "@kokoro/shared";
import {
  addMoney,
  allocateAgreedTotalToOrderLines,
  DEFAULT_DEPOSIT_PCT_BP,
  generateUuidV7,
  mulMoneyByBasisPoints,
  nowIso,
  REPLAY_CONFIRMATION_REQUIRED,
  subMoney,
  toBasisPoints,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { eq } from "drizzle-orm";
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
import { conflict, notFound, validationError } from "../errors.js";
import {
  assertPaymentMethodMatchesAccountType,
  buildAccountBalanceDelta,
  findActiveAccountRowOrThrow,
} from "../finance/accounts.js";
import { toAccountDto } from "../finance/dto.js";
import {
  buildReplaceMovementsForSourceStatements,
  buildStockMovementStatements,
} from "../inventory/movements.js";
import type { StockMovementInput } from "../inventory/types.js";
import { assertSaleNotCollected, planSaleMutationCostingImpact } from "../sales/index.js";
import { getSetting } from "../settings/index.js";

type Statement = BatchItem<"sqlite">;
type OrderRow = typeof customOrders.$inferSelect;
type OrderLineRow = typeof customOrderLines.$inferSelect;
type SaleRow = typeof sales.$inferSelect;
type SaleLineRow = typeof saleLines.$inferSelect;

/** `financial_transactions.source_event_type` for every cash row an order's lifecycle owns (the
 * deposit, its refund, and the delivery balance). Free text by design (INV-9) — the same convention
 * `core/sales` uses with `'sale'`. Deliberately NOT `'sale'` for the balance row: it belongs to the
 * order, and sourcing it to the sale would put it in reach of `updateSale`'s transaction
 * regeneration, which would rewrite an `ORDER_BALANCE` row into a plain `SALE` one. */
const ORDER_SOURCE_EVENT_TYPE = "custom_order";

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
): OrderDto {
  return {
    id: row.id,
    status: row.status,
    customerId: row.customerId,
    customerName,
    description: row.description,
    agreedTotal: row.agreedTotal,
    depositRequired: row.depositRequired,
    depositPaid: row.depositPaid,
    depositTxId: row.depositTxId,
    deliveryDate: row.deliveryDate,
    deliveryPlace: row.deliveryPlace,
    saleId: row.saleId,
    cancelResolution: row.cancelResolution,
    notes: row.notes,
    lines: lineRows.map(toOrderLineDto),
    // Derived, never stored: what the customer still owes (O-2's "balance").
    balanceDue:
      row.agreedTotal === null
        ? null
        : subMoney(toCentavos(row.agreedTotal), toCentavos(row.depositPaid)),
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
    paymentStatus: row.paymentStatus,
    paidAt: row.paidAt,
    paymentMethod: row.paymentMethod,
    accountId: row.accountId,
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

async function loadOrderRowOrThrow(db: Db, id: string): Promise<OrderRow> {
  const row = await db.query.customOrders.findFirst({
    where: (t, { and, eq: eqOp, isNull }) => and(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró el pedido.", { id });
  }
  return row;
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
  const [lineRows, customerName] = await Promise.all([
    loadOrderLineRows(db, id),
    loadCustomerName(db, row.customerId),
  ]);
  return toOrderDto(row, lineRows, customerName);
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
  if (agreedTotal !== null && agreedTotal <= 0) {
    throw validationError("El total acordado debe ser un entero positivo (centavos).", {
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
    depositRequired,
    depositPaid: 0,
    depositTxId: null,
    deliveryDate: command.deliveryDate ?? null,
    deliveryPlace: command.deliveryPlace ?? null,
    saleId: null,
    cancelResolution: null,
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

  return { order: toOrderDto(orderRow, lineRows, await loadCustomerName(db, command.customerId)) };
}

// ---- UC-06 confirm (O-1) ----------------------------------------------------------------------

/**
 * UC-06 / O-1: `QUOTING → CONFIRMED`, which REQUIRES a recorded deposit. One atomic batch (D-3):
 *   - the INCOME/`ORDER_DEPOSIT` `financial_transactions` row (sourced to this order, INV-9)
 *   - the account CREDIT — the cash really did arrive (ADR-012)
 *   - the `custom_orders` UPDATE: `status`, `agreed_total`, `deposit_required`, `deposit_paid`,
 *     `deposit_tx_id`
 *   - the `audit_log` row
 *
 * INV-7: nothing here touches a revenue path. The liability is derived by `v_liability` from the
 * very row this books, and is released only by delivery, refund, or forfeit.
 */
export async function confirmOrder(
  db: Db,
  id: string,
  command: ConfirmOrderCommand,
  actor: AuditActor,
): Promise<ConfirmOrderResult> {
  const row = await loadOrderRowOrThrow(db, id);
  assertTransitionAllowed(row, "confirm");

  const agreedTotal = command.agreedTotal ?? row.agreedTotal;
  if (agreedTotal === null || agreedTotal <= 0) {
    throw validationError("Define el total acordado antes de confirmar el pedido.", {
      id,
      agreedTotal,
    });
  }

  // O-1, defensively re-checked (D-2): confirmOrderCommandSchema already requires a positive
  // depositAmount, but a confirmation without money is not a confirmation whoever the caller is.
  if (!Number.isInteger(command.depositAmount) || command.depositAmount <= 0) {
    throw validationError("Para confirmar el pedido se requiere un anticipo.", {
      id,
      depositAmount: command.depositAmount,
    });
  }
  if (command.depositAmount > agreedTotal) {
    throw validationError("El anticipo no puede superar el total acordado.", {
      id,
      depositAmount: command.depositAmount,
      agreedTotal,
    });
  }

  const account = await findActiveAccountRowOrThrow(db, command.accountId);
  assertPaymentMethodMatchesAccountType(command.paymentMethod, account);

  const depositRequired =
    command.depositRequired ??
    row.depositRequired ??
    (await resolveDefaultDepositRequired(db, agreedTotal));

  const now = nowIso();
  const depositTxId = generateUuidV7();
  const updatedFields = {
    status: "CONFIRMED" as const,
    agreedTotal,
    depositRequired,
    depositPaid: command.depositAmount,
    depositTxId,
    updatedAt: now,
  };

  const statements: Statement[] = [
    db.insert(financialTransactions).values({
      id: depositTxId,
      occurredAt: command.occurredAt,
      businessDate: command.businessDate,
      accountId: command.accountId,
      type: "INCOME" as const,
      // NOT revenue (INV-7) — `v_liability` reads exactly this category to derive what the owner
      // still owes her customers.
      category: "ORDER_DEPOSIT" as const,
      amount: command.depositAmount,
      counterpartTxId: null,
      sourceEventType: ORDER_SOURCE_EVENT_TYPE,
      sourceEventId: id,
      description: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
    buildAccountBalanceDelta(db, command.accountId, command.depositAmount),
    db.update(customOrders).set(updatedFields).where(eq(customOrders.id, id)),
    buildAuditLogInsert(db, {
      actor,
      action: "confirm",
      entityType: "custom_orders",
      entityId: id,
      before: { status: row.status, agreedTotal: row.agreedTotal, depositPaid: row.depositPaid },
      after: updatedFields,
    }),
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return {
    order: await readOrderDto(db, id),
    account: toAccountDto({
      ...account,
      balance: addMoney(toCentavos(account.balance), toCentavos(command.depositAmount)),
    }),
  };
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

  const updatedFields = { status: nextStatus, updatedAt: nowIso() };
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

// ---- UC-07 deliver (O-2) ----------------------------------------------------------------------

interface DeliveryPlan {
  order: OrderRow;
  saleId: string;
  now: string;
  saleRow: SaleRow;
  saleLineRows: SaleLineRow[];
  movements: StockMovementInput[];
  balance: number;
  /** Non-null only when the balance is being settled in cash right now. */
  balanceAccountId: string | null;
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
  const order = await loadOrderRowOrThrow(db, id);
  assertTransitionAllowed(order, "deliver");

  const agreedTotal = order.agreedTotal;
  if (agreedTotal === null || agreedTotal <= 0) {
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

  // The O-2 / Doc 04 §5 collision, resolved by refusing rather than misstating — see this module's
  // header. The KOK-034 drawer must resolve these before offering "Entregar".
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
  const total = saleLineRows.reduce(
    (sum, line) =>
      addMoney(
        toCentavos(sum),
        totalCentavos(toMilliCentavosPerUnit(line.unitPriceMc), toMilliUnits(line.qty)),
      ),
    0,
  );
  if (total !== agreedTotal) {
    throw validationError("El total de las líneas no coincide con el total acordado.", {
      id,
      total,
      agreedTotal,
    });
  }

  const balance = subMoney(toCentavos(agreedTotal), toCentavos(order.depositPaid));
  // A fully-prepaid order owes nothing, so the sale is PAID however the caller framed the balance —
  // an ON_CREDIT sale with a zero receivable would sit in `v_receivables` forever meaning nothing.
  const isPaid = balance === 0 || command.balancePaymentStatus === "PAID";
  const balanceAccountId =
    command.balancePaymentStatus === "PAID" && balance > 0 ? command.accountId : null;

  const saleRow: SaleRow = {
    id: saleId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    channel: "CUSTOM_ORDER",
    customOrderId: id,
    customerId: order.customerId,
    sessionId: null,
    // O-2: the sale is for the FULL agreed total. Only the BALANCE is uncollected at delivery —
    // `v_receivables` nets `deposit_paid` off this figure (migration 0005) so the deposit is never
    // double-counted as still-owed.
    total,
    paymentStatus: isPaid ? "PAID" : "ON_CREDIT",
    paidAt: isPaid ? command.occurredAt : null,
    paymentMethod: command.balancePaymentStatus === "PAID" ? command.paymentMethod : null,
    accountId: balanceAccountId,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return { order, saleId, now, saleRow, saleLineRows, movements, balance, balanceAccountId };
}

/**
 * UC-07 / O-2: `READY → DELIVERED`. One atomic batch (D-3):
 *   - the `sales` + `sale_lines` inserts (channel `CUSTOM_ORDER`, `custom_order_id` set)
 *   - the SALE_OUT `stock_movements` + `item_stock` upserts (negative stock allowed, INV-8)
 *   - (balance PAID and > 0 only) the account CREDIT + an INCOME/`ORDER_BALANCE` row for the
 *     BALANCE ONLY — the deposit portion was banked at confirm time and must not be re-credited
 *   - the `custom_orders` UPDATE: `status='DELIVERED'` (which is what releases the deposit
 *     liability from `v_liability`) and `sale_id`
 *   - two `audit_log` rows: one for the order's transition, one for the sale it created
 *   - whatever `planCostingReplay` returns when the delivery is BACKDATED (R-2/INV-11)
 */
export async function deliverOrder(
  db: Db,
  id: string,
  command: DeliverOrderCommand,
  actor: AuditActor,
): Promise<DeliverOrderResult> {
  const plan = await buildDeliveryPlan(db, id, command);

  let account = null;
  if (command.balancePaymentStatus === "PAID") {
    // The PAID branch always carries a destination, even when the deposit covers the full
    // balance. Validate that destination consistently; only a positive balance returns an account
    // whose balance changed.
    const resolvedAccount = await findActiveAccountRowOrThrow(db, command.accountId);
    assertPaymentMethodMatchesAccountType(command.paymentMethod, resolvedAccount);
    if (plan.balanceAccountId !== null) {
      account = resolvedAccount;
    }
  }

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

  // financial_transactions.amount is always > 0 (Doc 04 §3.4's CHECK), so a zero balance books
  // nothing — mirrors recordSale's `total > 0` skip.
  const financialStatements: Statement[] = [];
  if (plan.balanceAccountId !== null && plan.balance > 0) {
    financialStatements.push(
      buildAccountBalanceDelta(db, plan.balanceAccountId, plan.balance),
      db.insert(financialTransactions).values({
        id: generateUuidV7(),
        occurredAt: command.occurredAt,
        businessDate: command.businessDate,
        accountId: plan.balanceAccountId,
        type: "INCOME" as const,
        category: "ORDER_BALANCE" as const,
        amount: plan.balance,
        counterpartTxId: null,
        sourceEventType: ORDER_SOURCE_EVENT_TYPE,
        sourceEventId: id,
        description: null,
        deletedAt: null,
        createdAt: plan.now,
        updatedAt: plan.now,
      }),
    );
  }

  const updatedFields = {
    status: "DELIVERED" as const,
    saleId: plan.saleId,
    updatedAt: plan.now,
  };

  const statements: Statement[] = [
    db.insert(sales).values(plan.saleRow),
    ...plan.saleLineRows.map((row) => db.insert(saleLines).values(row)),
    ...movementStatements,
    ...financialStatements,
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

  return {
    order: await readOrderDto(db, id),
    sale: toSaleDto(plan.saleRow, plan.saleLineRows),
    account:
      account !== null
        ? toAccountDto({
            ...account,
            balance: addMoney(toCentavos(account.balance), toCentavos(plan.balance)),
          })
        : null,
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

  // The one hard case the KB row calls out: refuse outright, never reverse the collection too.
  await assertSaleNotCollected(db, saleId);

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
 * UC-07-undo / O-2 in reverse: `DELIVERED -> READY`. One atomic batch (D-3):
 *   - reverses the SALE_OUT `stock_movements` + nets `item_stock` back (`buildReplaceMovementsFor-
 *     SourceStatements("sale", saleId, [])`)
 *   - reverses ONLY the delivery's own `ORDER_BALANCE` transaction + its account balance (found
 *     directly by `(sourceEventType, sourceEventId, category)` — NOT via the general
 *     `buildReplaceTransactionsForSourceStatements` primitive, which is unsafe here, see this
 *     module's Frozen-Contracts note above). The confirm-time `ORDER_DEPOSIT` row is untouched.
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

  const balanceTx = await db.query.financialTransactions.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull }) =>
      andOp(
        eqOp(t.sourceEventType, ORDER_SOURCE_EVENT_TYPE),
        eqOp(t.sourceEventId, id),
        eqOp(t.category, "ORDER_BALANCE"),
        isNull(t.deletedAt),
      ),
  });
  const financialStatements: Statement[] = [];
  if (balanceTx !== undefined) {
    // ORDER_BALANCE is always written as INCOME (deliverOrder hardcodes it) — the reversal is
    // therefore always a debit. Hard-delete is the D-8 derived-row-regeneration carve-out, same as
    // buildReplaceTransactionsForSourceStatements's own internal DELETE.
    financialStatements.push(
      db.delete(financialTransactions).where(eq(financialTransactions.id, balanceTx.id)),
      buildAccountBalanceDelta(db, balanceTx.accountId, -balanceTx.amount),
    );
  }

  const now = nowIso();
  const updatedSaleFields = { deletedAt: now, updatedAt: now };
  const updatedOrderFields = { status: "READY" as const, saleId: null, updatedAt: now };

  const statements: Statement[] = [
    ...movementStatements,
    ...financialStatements,
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
 * R-5 dry run (ADR-016): what delivering this order would do to already-booked cost, computed
 * without writing anything. Mirrors `previewSaleImpact`; `deliver` is the only transition that
 * writes kardex movements, so it is the only op this accepts.
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

// ---- UC-08 cancel (O-3) -----------------------------------------------------------------------

/**
 * UC-08 / O-3: `{QUOTING, CONFIRMED, IN_PRODUCTION, READY} → CANCELLED` in one atomic batch (D-3).
 *
 * With NO deposit on the order, this is a pure status flip — nothing to resolve, and `resolution`
 * must be omitted. With a deposit, the owner must choose (Doc 03 §5):
 *   - REFUND  → an EXPENSE/`DEPOSIT_REFUND` row + the account DEBIT. `v_liability` subtracts
 *               DEPOSIT_REFUND, so the liability clears and the cash genuinely leaves.
 *   - FORFEIT → NO new transaction and NO cash movement. The original INCOME/`ORDER_DEPOSIT` row
 *               is RECATEGORIZED IN PLACE to `OTHER_INCOME`: the money is already in the account
 *               (ADR-012), so booking a second income row would double-count it, while
 *               `v_liability`'s `category IN ('ORDER_DEPOSIT','DEPOSIT_REFUND')` filter stops
 *               matching it and the liability drops by exactly the deposit. Doc 04 §5 sanctions the
 *               owning service editing a system-owned transaction: this IS its source event.
 */
export async function cancelOrder(
  db: Db,
  id: string,
  command: CancelOrderCommand,
  actor: AuditActor,
): Promise<CancelOrderResult> {
  const row = await loadOrderRowOrThrow(db, id);
  assertTransitionAllowed(row, "cancel");

  const hasDeposit = row.depositPaid > 0;
  if (hasDeposit && command.resolution === undefined) {
    throw validationError(
      "Este pedido tiene un anticipo: elige si se devuelve (REFUND) o se retiene (FORFEIT).",
      { id, depositPaid: row.depositPaid },
    );
  }
  if (!hasDeposit && command.resolution !== undefined) {
    throw validationError(
      "Este pedido no tiene anticipo, así que no hay nada que devolver ni retener.",
      { id, resolution: command.resolution },
    );
  }

  const now = nowIso();
  const updatedFields = {
    status: "CANCELLED" as const,
    cancelResolution: command.resolution ?? null,
    notes: command.notes ?? row.notes,
    updatedAt: now,
  };

  const moneyStatements: Statement[] = [];
  let account = null;

  if (hasDeposit && command.resolution === "REFUND") {
    // Default to the account the deposit landed in — refunding from somewhere else is possible but
    // never the assumption.
    const depositTxId = row.depositTxId;
    const depositTx =
      depositTxId === null
        ? undefined
        : await db.query.financialTransactions.findFirst({
            where: (t, { eq: eqOp }) => eqOp(t.id, depositTxId),
          });
    const refundAccountId = command.accountId ?? depositTx?.accountId;
    if (refundAccountId === undefined) {
      throw validationError("Indica la cuenta desde la que se devuelve el anticipo.", { id });
    }
    account = await findActiveAccountRowOrThrow(db, refundAccountId);
    moneyStatements.push(
      db.insert(financialTransactions).values({
        id: generateUuidV7(),
        occurredAt: command.occurredAt,
        businessDate: command.businessDate,
        accountId: refundAccountId,
        type: "EXPENSE" as const,
        category: "DEPOSIT_REFUND" as const,
        amount: row.depositPaid,
        counterpartTxId: null,
        sourceEventType: ORDER_SOURCE_EVENT_TYPE,
        sourceEventId: id,
        description: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      buildAccountBalanceDelta(db, refundAccountId, -row.depositPaid),
    );
  }

  if (hasDeposit && command.resolution === "FORFEIT") {
    if (row.depositTxId === null) {
      throw conflict(
        "El pedido registra un anticipo pero no su transacción; corrige el anticipo antes de retenerlo.",
        { id },
      );
    }
    // The whole of the FORFEIT money effect: one category flip. No balance delta — the cash never
    // moves — and no new row, which is what keeps it from being counted twice.
    moneyStatements.push(
      db
        .update(financialTransactions)
        .set({ category: "OTHER_INCOME" as const, updatedAt: now })
        .where(eq(financialTransactions.id, row.depositTxId)),
    );
  }

  const statements: Statement[] = [
    ...moneyStatements,
    db.update(customOrders).set(updatedFields).where(eq(customOrders.id, id)),
    buildAuditLogInsert(db, {
      actor,
      action: "cancel",
      entityType: "custom_orders",
      entityId: id,
      before: {
        status: row.status,
        cancelResolution: row.cancelResolution,
        depositPaid: row.depositPaid,
        depositTxId: row.depositTxId,
      },
      after: updatedFields,
    }),
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return {
    order: await readOrderDto(db, id),
    account:
      account !== null
        ? toAccountDto({
            ...account,
            balance: subMoney(toCentavos(account.balance), toCentavos(row.depositPaid)),
          })
        : null,
  };
}

// ---- Line resolution (KOK-034, Doc 04 §5 amendment) --------------------------------------------

/** Same non-terminal set `cancelOrder` accepts (Doc 03 §5): a line can be resolved any time before
 * the order reaches a terminal status. Once `DELIVERED`/`CANCELLED` the lines are historical fact. */
const RESOLVABLE_STATUSES: readonly CustomOrderStatus[] = ALLOWED_FROM.cancel;

/**
 * Attaches a catalog item to ONE order line (KOK-034). Doc 04 §5 forbids a generic "update order"
 * command, but `custom_order_lines.item_id` starts NULL for a free-text one-off (a quoting
 * convenience, see `orderLineCommandSchema`'s header), and `deliverOrder` refuses (409) until every
 * line has one (`sale_lines.item_id` is NOT NULL + FINISHED-only). This is the narrow, single-
 * purpose action that resolves that gap without reopening the door the "no generic update" rule
 * closed: it touches exactly one line's `item_id`, nothing else about the order.
 *
 * `description` is left untouched — it stays as the owner's original note even once an item is
 * linked, same precedent as `qty`/`lineTotal` staying whatever they were quoted at.
 */
export async function resolveOrderLine(
  db: Db,
  orderId: string,
  lineId: string,
  command: ResolveOrderLineCommand,
  actor: AuditActor,
): Promise<ResolveOrderLineResult> {
  const row = await loadOrderRowOrThrow(db, orderId);
  if (!RESOLVABLE_STATUSES.includes(row.status)) {
    throw conflict(`No se puede vincular un ítem a un pedido ${STATUS_LABEL_ES[row.status]}.`, {
      id: orderId,
      status: row.status,
    });
  }

  const lineRow = await db.query.customOrderLines.findFirst({
    where: (t, { and, eq: eqOp }) => and(eqOp(t.id, lineId), eqOp(t.customOrderId, orderId)),
  });
  if (!lineRow) {
    throw notFound("No se encontró la línea del pedido.", { id: lineId, orderId });
  }

  // Same FINISHED-item guard every order line is checked against at quote/delivery time.
  await resolveItemSnapshots(db, [command.itemId]);

  const now = nowIso();

  await db.batch([
    db
      .update(customOrderLines)
      .set({ itemId: command.itemId })
      .where(eq(customOrderLines.id, lineId)),
    db.update(customOrders).set({ updatedAt: now }).where(eq(customOrders.id, orderId)),
    buildAuditLogInsert(db, {
      actor,
      action: "resolve_line",
      entityType: "custom_orders",
      entityId: orderId,
      before: { lineId, itemId: lineRow.itemId },
      after: { lineId, itemId: command.itemId },
    }),
  ]);

  return { order: await readOrderDto(db, orderId) };
}

// ---- Reads ------------------------------------------------------------------------------------

export async function getOrder(db: Db, id: string): Promise<OrderDto> {
  return readOrderDto(db, id);
}

/**
 * SC-04's board read. Ordered by `delivery_date` (O-5: "the Orders board sorts by delivery_date"),
 * nulls last so undated quotes sit at the bottom rather than at the top. Lines and customer names
 * are fetched in ONE extra query each — never per order (no N+1 behind the board).
 */
export async function listOrders(
  db: Db,
  filters: ListOrdersFilters = {},
): Promise<ListOrdersResult> {
  const rows = await db.query.customOrders.findMany({
    where: (t, { and, eq: eqOp, gte, isNull, lte }) => {
      const clauses = [isNull(t.deletedAt)];
      if (filters.status !== undefined) clauses.push(eqOp(t.status, filters.status));
      if (filters.customerId !== undefined) clauses.push(eqOp(t.customerId, filters.customerId));
      if (filters.fromDate !== undefined)
        clauses.push(gte(t.createdAt, `${filters.fromDate}T00:00:00.000Z`));
      if (filters.toDate !== undefined)
        clauses.push(lte(t.createdAt, `${filters.toDate}T23:59:59.999Z`));
      return and(...clauses);
    },
    orderBy: (t, { asc, sql: sqlOp }) => [sqlOp`${t.deliveryDate} IS NULL`, asc(t.deliveryDate)],
    limit: filters.limit,
  });

  if (rows.length === 0) return { orders: [] };

  const orderIds = rows.map((row) => row.id);
  const customerIds = [...new Set(rows.map((row) => row.customerId))];
  const [lineRows, customerRows] = await Promise.all([
    db.query.customOrderLines.findMany({
      where: (t, { inArray: inArrayOp }) => inArrayOp(t.customOrderId, orderIds),
    }),
    db.query.customers.findMany({
      where: (t, { inArray: inArrayOp }) => inArrayOp(t.id, customerIds),
    }),
  ]);

  const linesByOrder = new Map<string, OrderLineRow[]>();
  for (const line of lineRows) {
    const bucket = linesByOrder.get(line.customOrderId);
    if (bucket === undefined) linesByOrder.set(line.customOrderId, [line]);
    else bucket.push(line);
  }
  const nameById = new Map(customerRows.map((c) => [c.id, c.name]));

  return {
    orders: rows.map((row) =>
      toOrderDto(row, linesByOrder.get(row.id) ?? [], nameById.get(row.customerId) ?? null),
    ),
  };
}
