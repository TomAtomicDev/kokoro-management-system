// Custom-order command DTOs (KOK-033, Doc 03 UC-05…UC-08 + §5's O-1…O-5, Doc 04 §3.3
// `custom_orders`/`custom_order_lines` + §5). Single-contract rule (D-4): the API route, the web
// `OrderBoard` drawer (KOK-034) and any future AI draft tool import THESE schemas — never redeclare
// field validation elsewhere. Mirrors packages/shared/src/sales.ts's structure (field schemas ->
// command schemas -> hand-written DTOs -> result types).
//
// Status transitions remain named commands, while the pre-delivery agreement is replaced through
// one full-state `updateOrder` command. `status` is never caller-supplied; DELIVERED agreement edits
// require undo, and CANCELLED remains terminal.
//
//   QUOTING --confirm(no cash)--> CONFIRMED --start--> IN_PRODUCTION --ready--> READY
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
import { businessDateSchema, calendarDateSchema, occurredAtSchema } from "./dates.js";
import { type CustomOrderStatus, customOrderStatusSchema } from "./enums.js";
import {
  addMoney,
  allocateLargestRemainder,
  type Centavos,
  type MilliCentavosPerUnit,
  rateFromTotal,
  subMoney,
  toCentavos,
  totalCentavos,
} from "./money.js";
import { toMilliUnits } from "./qty.js";
import type { SaleDto } from "./sales.js";
import { safeText } from "./text.js";

export const ORDER_DESCRIPTION_MAX_LENGTH = 2000;
export const ORDER_NOTES_MAX_LENGTH = 2000;

/** Centavos (INV-6). Merchandise subtotal, optional while quoting and nonnegative when supplied. */
const agreedTotalSchema = z
  .number()
  .int()
  .nonnegative("El subtotal de artículos debe ser un monto entero no negativo (centavos).")
  .refine(Number.isSafeInteger, "El subtotal excede el rango entero seguro.");
/** Centavos (INV-6), never negative. */
const additionalChargeSchema = z
  .number()
  .int()
  .nonnegative("El cargo adicional debe ser un entero no negativo (centavos).")
  .refine(Number.isSafeInteger, "El cargo adicional excede el rango entero seguro.");
/** Milli-units of the item's own stored unit (Doc 04 §2). Defaults to 1000 (= one whole unit),
 * matching `custom_order_lines.qty`'s own DDL default — the overwhelmingly common custom order is
 * "one of this thing". */
const orderLineQtySchema = z
  .number()
  .int()
  .positive("La cantidad debe ser un entero positivo (mili-unidades).")
  .refine(Number.isSafeInteger, "La cantidad excede el rango entero seguro.");

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
    lineTotal: z
      .number()
      .int()
      .nonnegative()
      .refine(Number.isSafeInteger, "El importe de línea excede el rango entero seguro.")
      .nullish(),
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
 * the DDL — an order always belongs to someone) and `description` are required. The merchandise
 * subtotal may arrive later via the pre-delivery agreement edit.
 */
export const quoteOrderCommandSchema = z
  .object({
    customerId: z.string().min(1),
    description: z
      .string()
      .trim()
      .min(1, "La descripción es obligatoria.")
      .pipe(safeText(ORDER_DESCRIPTION_MAX_LENGTH)),
    agreedTotal: agreedTotalSchema.optional(),
    /** Legacy quote guidance only; confirmation never creates a receipt. */
    depositRequired: z.number().int().nonnegative().optional(),
    /** Separately quoted customer charge, not allocated onto merchandise lines. */
    additionalCharge: additionalChargeSchema.default(0),
    /** Promised calendar date; unlike transaction dates, it may be in the future (Doc 03 O-5). */
    deliveryDate: calendarDateSchema.optional(),
    deliveryPlace: z.string().trim().pipe(safeText(200)).optional(),
    notes: z.string().trim().pipe(safeText(ORDER_NOTES_MAX_LENGTH)).optional(),
    lines: z.array(orderLineCommandSchema).default([]),
  })
  .superRefine((command, ctx) => {
    if (command.agreedTotal === undefined) return;
    try {
      calculateOrderReceiptBalance(command.agreedTotal, command.additionalCharge, 0);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El importe al cliente excede el rango entero seguro.",
        path: ["additionalCharge"],
      });
    }
  });
/** `z.input` — `lines` and each line's `qty` carry defaults. */
export type QuoteOrderCommand = z.input<typeof quoteOrderCommandSchema>;

/** Full replacement of the editable agreement. Null explicitly clears nullable agreement fields. */
export const updateOrderCommandSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime(),
    customerId: z.string().min(1),
    description: z
      .string()
      .trim()
      .min(1, "La descripción es obligatoria.")
      .pipe(safeText(ORDER_DESCRIPTION_MAX_LENGTH)),
    agreedTotal: agreedTotalSchema.nullable(),
    additionalCharge: additionalChargeSchema,
    deliveryDate: calendarDateSchema.nullable(),
    deliveryPlace: z.string().trim().pipe(safeText(200)).nullable(),
    notes: z.string().trim().pipe(safeText(ORDER_NOTES_MAX_LENGTH)).nullable(),
    lines: z.array(orderLineCommandSchema),
  })
  .superRefine((command, ctx) => {
    if (command.agreedTotal === null) return;
    try {
      calculateOrderReceiptBalance(command.agreedTotal, command.additionalCharge, 0);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El importe al cliente excede el rango entero seguro.",
        path: ["additionalCharge"],
      });
    }
  });
export type UpdateOrderCommand = z.input<typeof updateOrderCommandSchema>;

/** Confirm is a pure state transition. Receipts are separate finance commands (ADR-022). */
export const confirmOrderCommandSchema = z.object({}).strict();
export type ConfirmOrderCommand = z.infer<typeof confirmOrderCommandSchema>;

/** Delivery records when stock left; its confirmation flag exists only for R-5 costing replay. */
export const deliverOrderCommandSchema = z
  .object({
    /** When the goods were handed over — becomes the sale's `occurred_at` (INV-3). */
    occurredAt: occurredAtSchema,
    businessDate: businessDateSchema,
    /** Free-text note copied onto the created sale. */
    notes: z.string().trim().pipe(safeText(ORDER_NOTES_MAX_LENGTH)).optional(),
    // R-5 / ADR-016: delivering writes SALE_OUT movements, so a BACKDATED delivery re-weights C-1 for
    // every later kardex entry exactly as a backdated sale does (KOK-064). When it would move cost
    // already booked, the service refuses with a ReplayImpactDto until the caller re-sends with
    // `confirm: true`. Shared flag (D-4) — the same one every replay-triggering command uses.
    confirm: confirmFlagSchema,
  })
  .strict();
/** `z.input` — `confirm` carries a `.default()`, same reasoning as `RecordSaleCommand`. */
export type DeliverOrderCommand = z.input<typeof deliverOrderCommandSchema>;

/** UC-07-undo ("Deshacer entrega", Doc 03 §5 amendment). No fields but `confirm` — R-2/R-5 inherits
 * in full (a backdated delivery may have re-weighted WAC for later events; undoing it replays the
 * same way deleting a sale does). */
export const undoDeliverOrderCommandSchema = z.object({ confirm: confirmFlagSchema });
/** `z.input` — `confirm` carries a `.default()`, same reasoning as `DeliverOrderCommand`. */
export type UndoDeliverOrderCommand = z.input<typeof undoDeliverOrderCommandSchema>;

/** Cancellation is terminal; any refund is recorded separately through finance. */
export const cancelOrderCommandSchema = z
  .object({
    notes: z.string().trim().pipe(safeText(ORDER_NOTES_MAX_LENGTH)).optional(),
  })
  .strict();
export type CancelOrderCommand = z.infer<typeof cancelOrderCommandSchema>;

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

/** Keyset position for the stable O-5 order: delivery date DESC NULLS LAST, then created/id DESC. */
export interface OrderListCursor {
  deliveryDate: string | null;
  createdAt: string;
  id: string;
}

const orderListCursorSchema = z
  .object({
    deliveryDate: calendarDateSchema.nullable(),
    createdAt: z.string().min(1).max(40),
    id: z.string().min(1).max(100),
  })
  .strict();

const serializedOrderListCursorSchema = z
  .string()
  .max(500)
  .transform((value, ctx) => {
    try {
      const parsed: unknown = JSON.parse(value);
      const result = orderListCursorSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // Report malformed cursors as a normal shared-query validation error below.
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "El cursor de pedidos no es válido.",
    });
    return z.NEVER;
  });

/** GET /orders query filters. Date filters use the order's `created_at` timestamp, while cursor
 * pagination follows O-5's `delivery_date DESC NULLS LAST, created_at DESC, id DESC` order. */
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
  /** JSON-serialized O-5 keyset position on the HTTP query string. */
  cursor: z.union([orderListCursorSchema, serializedOrderListCursorSchema]).optional(),
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
  /** Merchandise subtotal in centavos; `null` only while QUOTING. */
  agreedTotal: number | null;
  /** Separately quoted customer charge; not allocated onto merchandise lines. */
  additionalCharge: number;
  /** Current ADR-022 receipt projection. Never derived from the generated sale's payment status. */
  balance: OrderBalanceDto;
  deliveryDate: string | null;
  deliveryPlace: string | null;
  /** Set on delivery: the order-owned `CUSTOM_ORDER` inventory/COGS snapshot sale. */
  saleId: string | null;
  /** KOK-185: human-readable code (PED-NNNN-YYYY) — see packages/shared/src/sales.ts's
   * SaleDto.code for the full contract. */
  code: string | null;
  notes: string | null;
  lines: OrderLineDto[];
  createdAt: string;
  updatedAt: string;
}

/** Delivered inventory/COGS snapshots retained for the order, including soft-deleted undeliveries. */
export interface OrderSaleHistoryDto {
  sale: SaleDto;
  deletedAt: string | null;
}

export interface ListOrderSalesResult {
  sales: OrderSaleHistoryDto[];
}

/** Read-time balance components for a custom order, in integer centavos. */
export interface OrderBalanceDto {
  /** `agreedTotal + additionalCharge`, or null until an agreement subtotal exists. */
  customerAmount: number | null;
  /** Active directly linked ORDER_DEPOSIT / ORDER_BALANCE receipts. */
  qualifyingReceipts: number;
  /** Pre-delivery estimate only; null for delivered/cancelled orders or no agreement. */
  expectedBalance: number | null;
  /** Delivered-order debt only; zero means fully covered and null means not delivered. */
  receivableBalance: number | null;
  /** Positive receipts above customer price; null until an agreement subtotal exists. */
  excess: number | null;
}

export interface QuoteOrderResult {
  order: OrderDto;
}

export interface UpdateOrderResult {
  order: OrderDto;
}

export interface ConfirmOrderResult {
  order: OrderDto;
}

/** Pure status transitions (`startOrderProduction`, `markOrderReady`) move no money and touch no
 * kardex, so they report nothing but the order's new state. */
export interface OrderTransitionResult {
  order: OrderDto;
}

export interface DeliverOrderResult {
  order: OrderDto;
  /** The order-owned `CUSTOM_ORDER` sale (O-8), with its derived `sale_lines`. */
  sale: SaleDto;
}

export interface CancelOrderResult {
  order: OrderDto;
}

/** Order-scoped active receipt aggregate for the pre-delivery agreement-edit preview. */
export interface OrderReceiptSummaryDto {
  qualifyingReceipts: number;
  /** True for any historically linked qualifying receipt, including a soft-deleted one. */
  hasEverQualifyingReceipt: boolean;
}

export interface ListOrdersResult {
  orders: OrderDto[];
  /** A bounded next page, or `null` when this response contains the final page. */
  nextCursor: OrderListCursor | null;
}

/** The shared URL representation used by the Worker API and the web query hook. */
export function serializeOrderListCursor(cursor: OrderListCursor): string {
  return JSON.stringify(cursor);
}

export interface OrderReceiptBalance {
  customerAmount: number | null;
  expected: number | null;
  excess: number | null;
}

/** Shared ADR-022 integer-centavo receipt math for KOK-205 preview and KOK-207 debt reads. */
export function calculateOrderReceiptBalance(
  agreedTotal: number | null,
  additionalCharge: number,
  qualifyingReceipts: number,
): OrderReceiptBalance {
  const charge = toCentavos(additionalCharge);
  const receipts = toCentavos(qualifyingReceipts);
  const zero = toCentavos(0);
  if (charge < zero || receipts < zero) {
    throw new RangeError("Order charges and qualifying receipts must be nonnegative centavos.");
  }
  if (agreedTotal === null) {
    return { customerAmount: null, expected: null, excess: null };
  }

  const merchandise = toCentavos(agreedTotal);
  if (merchandise < zero) {
    throw new RangeError("Order merchandise subtotal must be nonnegative centavos.");
  }
  const customerAmount = addMoney(merchandise, charge);
  const difference = subMoney(toCentavos(customerAmount), receipts);
  return {
    customerAmount,
    expected: difference > 0 ? difference : zero,
    excess: difference < 0 ? subMoney(zero, difference) : zero,
  };
}

/** Per-order pre-delivery cash exposure, floored before exposures are added across orders. */
export function calculatePreDeliveryOrderCashExposure(
  qualifyingReceipts: number,
  orderRefunds: number,
): number {
  const receipts = toCentavos(qualifyingReceipts);
  const refunds = toCentavos(orderRefunds);
  const zero = toCentavos(0);
  if (receipts < zero || refunds < zero) {
    throw new RangeError("Order receipts and refunds must be nonnegative centavos.");
  }
  const exposure = subMoney(receipts, refunds);
  return exposure > zero ? exposure : zero;
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
  if (!Number.isSafeInteger(agreedTotal) || agreedTotal < 0) return null;
  if (lines.length === 0) return null;
  // Defensive: `orderLineQtySchema` already forbids it, but a non-positive qty would divide by zero
  // below and this helper is exported for callers that may not have run Zod first.
  if (
    lines.some(
      (line) =>
        !Number.isSafeInteger(line.qty) ||
        line.qty <= 0 ||
        (line.lineTotal != null && (!Number.isSafeInteger(line.lineTotal) || line.lineTotal < 0)),
    )
  ) {
    return null;
  }

  let pinnedSum = toCentavos(0);
  try {
    for (const line of lines) {
      if (line.lineTotal != null) pinnedSum = addMoney(pinnedSum, toCentavos(line.lineTotal));
    }
  } catch {
    return null;
  }
  const unpinnedIndexes = lines
    .map((line, i) => (line.lineTotal == null ? i : -1))
    .filter((i) => i >= 0);

  if (pinnedSum > agreedTotal) return null;
  // Everything is pinned but the pins don't reach the agreed total: there is no line free to absorb
  // the difference, and silently inflating a hand-priced line would misstate it.
  if (unpinnedIndexes.length === 0 && pinnedSum !== agreedTotal) return null;

  const residual = subMoney(agreedTotal, pinnedSum);
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
    (sum, a, i) => addMoney(sum, totalCentavos(a.unitPriceMc, toMilliUnits(lines[i]?.qty ?? 0))),
    toCentavos(0),
  );
  return reconstructed === agreedTotal ? allocations : null;
}

/** Basis points (Doc 04 §3.5 stores `default_deposit_pct` in bp) used when the owner has not set a
 * `default_deposit_pct` app setting: O-1's "default 50%, editable amount". */
export const DEFAULT_DEPOSIT_PCT_BP = 5000;
