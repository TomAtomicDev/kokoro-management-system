// Custom-order command DTOs (KOK-033, Doc 03 UC-05…UC-08 + §5's O-1…O-5, Doc 04 §3.3
// `custom_orders`/`custom_order_lines` + §5). Single-contract rule (D-4): the API route, the web
// `OrderBoard` drawer (KOK-034) and any future AI draft tool import THESE schemas — never redeclare
// field validation elsewhere. Mirrors packages/shared/src/sales.ts's structure (field schemas ->
// command schemas -> hand-written DTOs -> result types).
//
// THE STATE MACHINE IS THE API. There is deliberately no generic `updateOrder` that free-edits
// arbitrary columns: Doc 04 §5 says "`custom_orders` transitions only along the state machine
// (O-1…O-3)", so every mutation below is a named transition with its own guard, and `status` is
// never a caller-supplied field. `CANCELLED` is the terminal "this didn't happen" state — there is
// no soft-delete/restore pair for orders (contrast core/sales' UC-18 verbs).
//
//   QUOTING --confirm(+deposit)--> CONFIRMED --start--> IN_PRODUCTION --ready--> READY
//           --deliver--> DELIVERED (final)
//   {QUOTING, CONFIRMED, IN_PRODUCTION, READY} --cancel--> CANCELLED (final)
//
// `startOrderProduction` and `markOrderReady` have NO command schema on purpose: they are pure
// status transitions carrying no caller input at all (the service takes only the order id), so
// there is nothing for a schema to validate. Adding an empty `z.object({})` for symmetry would be
// noise the route would still have to parse.
//
// MONEY (INV-6/D-5): every amount here is integer centavos. `agreedTotal` is the customer-facing
// contract price and is NEVER recomputed from lines — it is the INPUT to the delivery-time
// allocation below, the reverse of how `sales.total` works (Doc 04 §5 recomputes that one from its
// lines, and `deliverOrder` still satisfies that rule — see `allocateAgreedTotalToOrderLines`).

import { z } from "zod";
import { confirmFlagSchema } from "./costing.js";
import { businessDateSchema, occurredAtSchema } from "./dates.js";
import {
  type CancelResolution,
  type CustomOrderStatus,
  cancelResolutionSchema,
  customOrderStatusSchema,
  paymentMethodSchema,
} from "./enums.js";
import type { FinancialAccountDto } from "./finance.js";
import {
  allocateLargestRemainder,
  type Centavos,
  type MilliCentavosPerUnit,
  rateFromTotal,
  toCentavos,
  totalCentavos,
} from "./money.js";
import { toMilliUnits } from "./qty.js";
import type { SaleDto } from "./sales.js";
import { safeText } from "./text.js";

/** Centavos (INV-6). The price agreed with the customer; required before an order can be CONFIRMED
 * (Doc 04 §3.3's "required to confirm"), hence optional at quote time. Strictly positive: an order
 * worth nothing has no deposit to take and no sale to create. */
const agreedTotalSchema = z
  .number()
  .int()
  .positive("El total acordado debe ser un entero positivo (centavos).");
/** Centavos (INV-6), never negative — a deposit of 0 is expressed by omitting the deposit, not by
 * sending a zero. */
const depositAmountSchema = z
  .number()
  .int()
  .positive("El anticipo debe ser un entero positivo (centavos).");
/** Milli-units of the item's own stored unit (Doc 04 §2). Defaults to 1000 (= one whole unit),
 * matching `custom_order_lines.qty`'s own DDL default — the overwhelmingly common custom order is
 * "one of this thing". */
const orderLineQtySchema = z
  .number()
  .int()
  .positive("La cantidad debe ser un entero positivo (mili-unidades).");

/**
 * One line of what will be delivered (Doc 04 §3.3 `custom_order_lines`: "item-linked or free text").
 *
 * `itemId` is nullable at QUOTING time — a one-off creation may not have a catalog item yet — but
 * `description` is then REQUIRED, exactly as the DDL comment says. Note the delivery-time
 * consequence, which the `OrderBoard` drawer (KOK-034) must surface BEFORE offering "Entregar":
 * `deliverOrder` refuses (409) while any line still lacks an `itemId`, because `sale_lines.item_id`
 * is NOT NULL and FINISHED-only (Doc 04 §3.3/§5) and a delivered order that produced no `SALE_OUT`
 * movement for what it shipped would drift `item_stock` upward forever (INV-5).
 *
 * `lineTotal` is this line's centavos share of `agreedTotal` — OPTIONAL, per the DDL. Lines that
 * carry one are pinned at that value; lines that don't split whatever is left over, weighted by
 * `qty` (see `allocateAgreedTotalToOrderLines`).
 */
export const orderLineCommandSchema = z
  .object({
    itemId: z.string().min(1).nullish(),
    description: z.string().trim().pipe(safeText(500)).nullish(),
    qty: orderLineQtySchema.default(1000),
    lineTotal: z.number().int().nonnegative().nullish(),
  })
  .refine((line) => line.itemId != null || (line.description != null && line.description !== ""), {
    message: "Cada línea necesita un ítem del catálogo o una descripción.",
    path: ["description"],
  });
/** `z.input` (not `z.infer`): `qty` carries a `.default()`, and the output type would make it
 * REQUIRED on every call site that legitimately means "one unit". Same reasoning as
 * `RecordSaleCommand`'s note in sales.ts. */
export type OrderLineCommand = z.input<typeof orderLineCommandSchema>;

/**
 * UC-05 quote a custom order. The order starts at `QUOTING`; only `customerId` (a NOT NULL FK per
 * the DDL — an order always belongs to someone) and `description` are required. Everything a
 * confirmation needs (`agreedTotal`, the deposit) may arrive later via `confirmOrderCommandSchema`.
 */
export const quoteOrderCommandSchema = z.object({
  customerId: z.string().min(1),
  description: z.string().trim().min(1, "La descripción es obligatoria.").pipe(safeText(2000)),
  agreedTotal: agreedTotalSchema.optional(),
  /** Centavos the owner expects as a deposit. Omitted → derived at confirm time from the
   * `default_deposit_pct` app setting (basis points, Doc 04 §3.5), falling back to 50% (O-1). */
  depositRequired: z.number().int().nonnegative().optional(),
  deliveryDate: businessDateSchema.optional(),
  deliveryPlace: z.string().trim().pipe(safeText(200)).optional(),
  notes: z.string().trim().pipe(safeText(2000)).optional(),
  lines: z.array(orderLineCommandSchema).default([]),
});
/** `z.input` — `lines` and each line's `qty` carry defaults. */
export type QuoteOrderCommand = z.input<typeof quoteOrderCommandSchema>;

/**
 * UC-06 confirm with a deposit (O-1: "`CONFIRMED` requires a recorded deposit"). `depositAmount` is
 * therefore required and strictly positive at the SCHEMA level — a confirmation without money is
 * not a confirmation. `paymentMethod`/`accountId` mirror `recordSaleCommandSchema`'s PAID branch:
 * the cash physically arrives in a real account (ADR-012), while the matching liability is DERIVED
 * via `v_liability` and never stored (INV-7 — this money is not revenue yet).
 *
 * `agreedTotal` is required here only when the quote didn't already carry one; the service resolves
 * `command.agreedTotal ?? order.agreedTotal` and rejects when both are absent.
 */
export const confirmOrderCommandSchema = z.object({
  /** When the deposit was actually received — the transaction's own cash date (INV-3). */
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  agreedTotal: agreedTotalSchema.optional(),
  depositRequired: z.number().int().nonnegative().optional(),
  depositAmount: depositAmountSchema,
  paymentMethod: paymentMethodSchema,
  accountId: z.string().min(1),
});
export type ConfirmOrderCommand = z.infer<typeof confirmOrderCommandSchema>;

/** Fields both delivery branches share. */
const deliverOrderCommonFields = {
  /** When the goods were handed over — becomes the sale's `occurred_at` (INV-3). */
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  /** Free-text note copied onto the created sale. */
  notes: z.string().trim().pipe(safeText(2000)).optional(),
  // R-5 / ADR-016: delivering writes SALE_OUT movements, so a BACKDATED delivery re-weights C-1 for
  // every later kardex entry exactly as a backdated sale does (KOK-064). When it would move cost
  // already booked, the service refuses with a ReplayImpactDto until the caller re-sends with
  // `confirm: true`. Shared flag (D-4) — the same one every replay-triggering command uses.
  confirm: confirmFlagSchema,
} as const;

/**
 * UC-07 deliver (O-2). Creates the linked `CUSTOM_ORDER` sale for the full `agreedTotal`; the
 * deposit liability is released against it (it falls out of `v_liability` the moment the order
 * reaches `DELIVERED`), and the BALANCE — `agreedTotal − depositPaid` — is settled here.
 *
 * Discriminated on `balancePaymentStatus`, which describes the BALANCE only, never the whole sale
 * (the deposit portion was already collected at confirm time):
 *   - PAID      → `paymentMethod` + `accountId` required; books an INCOME/`ORDER_BALANCE` row for
 *                 the balance ONLY, and the sale is marked PAID.
 *   - ON_CREDIT → books nothing; the sale sits in `v_receivables`, which reports
 *                 `total − deposit_paid` so the already-banked deposit is never double-counted as
 *                 still-owed (migration 0005, Doc 04 §4).
 *
 * When the balance is zero (the deposit covered the whole order) the sale is PAID either way and no
 * balance transaction is written — nothing is owed and no cash moves at delivery.
 */
export const deliverOrderCommandSchema = z.discriminatedUnion("balancePaymentStatus", [
  z.object({
    balancePaymentStatus: z.literal("PAID"),
    paymentMethod: paymentMethodSchema,
    accountId: z.string().min(1),
    ...deliverOrderCommonFields,
  }),
  z.object({
    balancePaymentStatus: z.literal("ON_CREDIT"),
    ...deliverOrderCommonFields,
  }),
]);
/** `z.input` — `confirm` carries a `.default()`, same reasoning as `RecordSaleCommand`. */
export type DeliverOrderCommand = z.input<typeof deliverOrderCommandSchema>;

/** UC-07-undo ("Deshacer entrega", Doc 03 §5 amendment). No fields but `confirm` — R-2/R-5 inherits
 * in full (a backdated delivery may have re-weighted WAC for later events; undoing it replays the
 * same way deleting a sale does). */
export const undoDeliverOrderCommandSchema = z.object({ confirm: confirmFlagSchema });
/** `z.input` — `confirm` carries a `.default()`, same reasoning as `DeliverOrderCommand`. */
export type UndoDeliverOrderCommand = z.input<typeof undoDeliverOrderCommandSchema>;

/**
 * UC-08 cancel (O-3). Legal from every non-terminal status. `resolution` is required EXACTLY when
 * the order already holds a deposit (`deposit_paid > 0`) and must be absent otherwise — a quote
 * cancelled before any money changed hands has nothing to resolve. The service enforces both
 * directions (the schema cannot: it does not know `deposit_paid`).
 *   - REFUND  → an EXPENSE/`DEPOSIT_REFUND` transaction gives the money back; `v_liability`
 *               subtracts it and the liability clears.
 *   - FORFEIT → NO new transaction. The original INCOME/`ORDER_DEPOSIT` row is RECATEGORIZED in
 *               place to `OTHER_INCOME` (same row, account, amount and original `business_date`),
 *               which both recognizes the income and drops the row out of `v_liability`'s
 *               category filter in one move. Writing a fresh income row instead would double-count
 *               cash that is already sitting in the account (ADR-012).
 */
export const cancelOrderCommandSchema = z.object({
  /** When the cancellation happened; used as the refund transaction's cash date (REFUND only). */
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  resolution: cancelResolutionSchema.optional(),
  /** Where a REFUND's money comes FROM. Omitted → the account the deposit was received into. */
  accountId: z.string().min(1).optional(),
  notes: z.string().trim().pipe(safeText(2000)).optional(),
});
export type CancelOrderCommand = z.infer<typeof cancelOrderCommandSchema>;

/**
 * Resolves a free-text order line to a catalog item (KOK-034, Doc 04 §5 amendment). Doc 04 §5 rules
 * out a generic "update order" command, but that leaves no way to satisfy O-2's delivery gate: a
 * line quoted with only `description` (no `itemId`) cannot become a `sale_lines` row (NOT NULL +
 * FINISHED-only), and `deliverOrder` refuses (409) while any line lacks one. This is deliberately
 * NOT a generic line editor — it does exactly one thing (attach a catalog item to one line) and
 * nothing else about the order is editable through it, so it doesn't reopen the door the "no
 * generic update" rule closed. Legal on any non-terminal order (same set `cancelOrder` accepts);
 * once `DELIVERED`/`CANCELLED` the lines are historical fact, not something to keep resolving.
 */
export const resolveOrderLineCommandSchema = z.object({
  itemId: z.string().min(1, "Selecciona un ítem del catálogo."),
});
export type ResolveOrderLineCommand = z.infer<typeof resolveOrderLineCommandSchema>;

/** Widened for KOK-136 exactly as this schema's own pre-existing comment anticipated ("a future
 * movement-writing transition can widen it into a discriminated union without breaking callers") —
 * `undo_deliver` is the only OTHER transition that writes/removes kardex rows. */
export const orderImpactRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("deliver"), id: z.string().min(1), command: deliverOrderCommandSchema }),
  z.object({
    op: z.literal("undo_deliver"),
    id: z.string().min(1),
    command: undoDeliverOrderCommandSchema,
  }),
]);
/** `z.input` — the nested command schema carries `confirm`'s default. */
export type OrderImpactRequest = z.input<typeof orderImpactRequestSchema>;

/** GET /orders query filters. `status` powers SC-04's board columns; date filters use the order's
 * `created_at` timestamp while results remain ordered by `delivery_date` (O-5). */
export const listOrdersFiltersSchema = z.object({
  status: customOrderStatusSchema.optional(),
  /** KOK-137: comma-separated on the wire ("DELIVERED,CANCELLED"), typed as an array for callers.
   * Lets the order picker exclude terminal statuses without a second endpoint. */
  excludeStatuses: z
    .union([z.array(customOrderStatusSchema), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")))
    .pipe(z.array(customOrderStatusSchema))
    .optional(),
  customerId: z.string().min(1).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListOrdersFilters = z.infer<typeof listOrdersFiltersSchema>;

export interface OrderLineDto {
  id: string;
  /** `null` for a free-text one-off line. Must be non-null on EVERY line before the order can be
   * delivered (see `orderLineCommandSchema`). */
  itemId: string | null;
  description: string | null;
  /** Milli-units (Doc 04 §2). */
  qty: number;
  /** Centavos share of `agreedTotal`, or `null` to let the delivery-time allocation decide. */
  lineTotal: number | null;
}

export interface OrderDto {
  id: string;
  status: CustomOrderStatus;
  customerId: string;
  /** Joined from `customers.name` for SC-04's cards — saves the board an N+1 per order. */
  customerName: string | null;
  description: string;
  /** Centavos (INV-6). `null` only while QUOTING — confirming requires one. */
  agreedTotal: number | null;
  depositRequired: number | null;
  /** Centavos actually received (0 until confirmed). */
  depositPaid: number;
  /** The INCOME/`ORDER_DEPOSIT` row the deposit was booked as — recategorized to `OTHER_INCOME`
   * in place if the order is later cancelled with FORFEIT (O-3). */
  depositTxId: string | null;
  deliveryDate: string | null;
  deliveryPlace: string | null;
  /** Set on delivery (O-2): the auto-created `CUSTOM_ORDER`-channel sale. */
  saleId: string | null;
  cancelResolution: CancelResolution | null;
  notes: string | null;
  lines: OrderLineDto[];
  /** DERIVED, not stored: `agreedTotal − depositPaid`, or `null` while `agreedTotal` is unset.
   * What the customer still owes; after delivery this is exactly what `v_receivables` reports for
   * the linked sale when the balance was left ON_CREDIT. */
  balanceDue: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteOrderResult {
  order: OrderDto;
}

export interface ConfirmOrderResult {
  order: OrderDto;
  /** The credited account carrying its post-deposit balance (the cash really did arrive, ADR-012). */
  account: FinancialAccountDto;
}

/** Pure status transitions (`startOrderProduction`, `markOrderReady`) move no money and touch no
 * kardex, so they report nothing but the order's new state. */
export interface OrderTransitionResult {
  order: OrderDto;
}

export interface DeliverOrderResult {
  order: OrderDto;
  /** The auto-created `CUSTOM_ORDER` sale (O-2), with its derived `sale_lines`. */
  sale: SaleDto;
  /** The credited account when the balance was taken as PAID; `null` when it was left ON_CREDIT or
   * when there was no balance to settle. */
  account: FinancialAccountDto | null;
}

export interface CancelOrderResult {
  order: OrderDto;
  /** The DEBITED account for a REFUND; `null` for FORFEIT (no cash moves — the money is already in
   * the account and merely stops being a liability) and for a deposit-free cancellation. */
  account: FinancialAccountDto | null;
}

/** Result of `resolveOrderLine` — no money or kardex moves, just the order with its updated line. */
export interface ResolveOrderLineResult {
  order: OrderDto;
}

export interface ListOrdersResult {
  orders: OrderDto[];
}

/** What `deliverOrder` derives for one order line before it becomes a `sale_lines` row. */
export interface OrderLineAllocation {
  /** Centavos this line contributes to `agreedTotal`. */
  lineTotal: Centavos;
  /** Centavos per WHOLE unit, i.e. what `sale_lines.unit_price` will store. */
  unitPriceMc: MilliCentavosPerUnit;
}

/**
 * Splits `agreedTotal` across an order's lines so the derived `sale_lines` reproduce it EXACTLY
 * (D-5: no lost centavos). Pure and total — no I/O, no rounding outside money.ts's helpers — so the
 * KOK-034 drawer can preview the same numbers the service will write.
 *
 * The rules, in order:
 *  1. A line carrying an explicit `lineTotal` is PINNED at it (the owner priced that line by hand).
 *  2. Whatever is left over is split across the remaining lines by `allocateLargestRemainder`,
 *     weighted by `qty` — so 2 cakes carry twice the share of 1, and the leftover centavos land on
 *     the largest remainders rather than vanishing.
 *  3. `unitPriceMc` is then derived with the sanctioned `rateFromTotal` helper.
 *
 * Returns `null` when the split is impossible, which the caller turns into a Spanish VALIDATION
 * error rather than silently misstating revenue:
 *  - pinned lines already exceed `agreedTotal`, or they fall short with no unpinned line to absorb
 *    the difference (the owner's own numbers don't add up); or
 *  - the per-unit rates cannot reproduce the split exactly — `Σ(qty × unitPriceMc)` must equal
 *    `agreedTotal` because Doc 04 §5 recomputes `sales.total` from exactly that expression. This is
 *    unreachable whenever every `qty` is 1000 (one whole unit — the DDL default and the normal
 *    case), where `unitPrice === lineTotal` identically; it can only bite on indivisible fractional
 *    quantities whose milli-centavo rate still rounds away from the agreed total.
 */
export function allocateAgreedTotalToOrderLines(
  agreedTotal: Centavos,
  lines: readonly { qty: number; lineTotal?: number | null }[],
): OrderLineAllocation[] | null {
  if (lines.length === 0) return null;
  // Defensive: `orderLineQtySchema` already forbids it, but a non-positive qty would divide by zero
  // below and this helper is exported for callers that may not have run Zod first.
  if (lines.some((line) => !Number.isInteger(line.qty) || line.qty <= 0)) return null;

  const pinnedSum = lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  const unpinnedIndexes = lines
    .map((line, i) => (line.lineTotal == null ? i : -1))
    .filter((i) => i >= 0);

  if (pinnedSum > agreedTotal) return null;
  // Everything is pinned but the pins don't reach the agreed total: there is no line free to absorb
  // the difference, and silently inflating a hand-priced line would misstate it.
  if (unpinnedIndexes.length === 0 && pinnedSum !== agreedTotal) return null;

  const residual = toCentavos(agreedTotal - pinnedSum);
  const shares = allocateLargestRemainder(
    residual,
    unpinnedIndexes.map((i) => lines[i]?.qty ?? 0),
  );

  const lineTotals = lines.map((line) => line.lineTotal ?? 0);
  unpinnedIndexes.forEach((lineIndex, shareIndex) => {
    lineTotals[lineIndex] = shares[shareIndex] ?? 0;
  });

  const allocations: OrderLineAllocation[] = lines.map((line, i) => {
    const lineTotal = toCentavos(lineTotals[i] ?? 0);
    return { lineTotal, unitPriceMc: rateFromTotal(lineTotal, toMilliUnits(line.qty)) };
  });

  // Doc 04 §5's `sales.total = Σ(qty × unit_price)` is what the service will actually store, so the
  // reconstruction — not the intermediate `lineTotals` — is what has to equal `agreedTotal`.
  const reconstructed = allocations.reduce(
    (sum, a, i) => sum + totalCentavos(a.unitPriceMc, toMilliUnits(lines[i]?.qty ?? 0)),
    0,
  );
  return reconstructed === agreedTotal ? allocations : null;
}

/** Basis points (Doc 04 §3.5 stores `default_deposit_pct` in bp) used when the owner has not set a
 * `default_deposit_pct` app setting: O-1's "default 50%, editable amount". */
export const DEFAULT_DEPOSIT_PCT_BP = 5000;
