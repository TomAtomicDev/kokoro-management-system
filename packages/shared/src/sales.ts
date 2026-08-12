// Sales command DTOs (KOK-030, Doc 03 UC-03, Doc 04 §3.3 `sales`/`sale_lines` + §5). Single-contract
// rule (D-4): the API route and any future web form / AI draft tool for sales import these same
// schemas — never redeclare field validation elsewhere. Mirrors packages/shared/src/purchasing.ts's
// shape (field schemas -> command schema -> hand-written DTOs).
//
// Scope: CREATE + READ (KOK-030), UPDATE + DELETE + RESTORE + the dry-run impact request (KOK-064,
// applying the KOK-024 pattern — see docs/development/kok-030-sales-end-to-end.md §1/§2). Mirrors
// how core/purchasing shipped CREATE+READ (KOK-016) before UPDATE/DELETE/RESTORE (KOK-024).
//
// `confirm` flag (KOK-064; previously deliberately absent — see the KOK-030 doc §2 history). The
// flag gates the R-5 backdated-replay confirmation (ADR-016): `sale` is now a modelled
// `costing_adjustments.trigger_event_type` (Doc 04 §3.4, `CostingAdjustmentTrigger`), a sale being
// stock-wise identical to a stock exit (SALE_OUT), so `recordSale`/`updateSale`/`deleteSale`/
// `restoreSale` all run the same INV-11/R-2 ordering guard `recordPurchase`/`recordExit` do.
//
// There is no client-supplied `total` field on any command schema here — Doc 04 §5's integrity rule
// requires `sales.total = Σ(qty × unit_price)`, recomputed server-side and never trusted from the
// caller (core/sales/index.ts is the only place a sale's total is produced).

import { z } from "zod";
import { confirmFlagSchema } from "./costing.js";
import {
  type PaymentMethod,
  type PaymentStatus,
  paymentMethodSchema,
  type SaleChannel,
} from "./enums.js";
import type { FinancialAccountDto } from "./finance.js";
import { type MilliCentavosPerUnit, toMilliCentavosPerUnit } from "./money.js";
import { safeText } from "./text.js";

/** Milli-units of the item's own stored unit (Doc 04 §2), matching qty.ts's representation. Always
 * positive — a sale line removes stock, and the OUT sign is applied server-side, never sent. */
const qtySchema = z
  .number()
  .int()
  .positive("La cantidad debe ser un entero positivo (mili-unidades).");
/** Centavos per WHOLE unit (INV-6), editable vs the catalog list price (Doc 04 §3.3). May be zero
 * (a giveaway line) but never negative. The per-line money total is `qty × unit_price` computed
 * server-side (Doc 04 §5), never sent by the caller. */
const unitPriceMcSchema = z
  .number()
  .int()
  .nonnegative("El precio unitario debe ser un entero no negativo (milicentavos por unidad).")
  .transform(toMilliCentavosPerUnit);
/** `YYYY-MM-DD`, America/La_Paz local calendar date (Doc 04 §1, INV-3). */
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD.");
/** UTC ISO-8601 instant (Doc 04 §1). */
const occurredAtSchema = z
  .string()
  .datetime({ offset: true, message: "occurredAt debe ser una fecha ISO-8601." });

export const saleLineCommandSchema = z.object({
  itemId: z.string().min(1),
  qty: qtySchema,
  unitPriceMc: unitPriceMcSchema,
});
export type SaleLineCommand = z.infer<typeof saleLineCommandSchema>;

/** Fields common to both payment branches. `channel` is NOT accepted: this task records CATALOG
 * sales only (CUSTOM_ORDER sales are created by the custom-order delivery flow, KOK-033/034, O-2);
 * the service pins `channel = 'CATALOG'`. `customerId` is an optional nullable FK, set via the web
 * `CustomerPicker` (KOK-032) — still passed through with no existence check beyond the DB's own
 * `ON DELETE RESTRICT` FK, since the picker only ever emits ids of customers it already fetched. */
const saleCommandCommonFields = {
  customerId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  notes: z.string().trim().pipe(safeText(2000)).optional(),
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  lines: z.array(saleLineCommandSchema).min(1, "Se requiere al menos una línea de venta."),
  // R-5 / ADR-016 (KOK-064): a sale whose `business_date` lands BEFORE the latest already-processed
  // movement of an item it touches re-weights C-1 for every later kardex entry, which can change
  // cost already booked against a recorded sale/exit. When it does, the service refuses with a
  // CONFLICT carrying a ReplayImpactDto until the caller re-sends with `confirm: true`. Shared flag
  // (D-4) — the same one every other replay-triggering command uses.
  confirm: confirmFlagSchema,
} as const;

/**
 * UC-03 record a catalog sale. Discriminated on `paymentStatus` so the payment-method/account fields
 * are required EXACTLY when the sale is PAID and forbidden when it is ON_CREDIT — the single-contract
 * (D-4) expression of Doc 04 §3.3's "`account_id` required when PAID" and Doc 03's "income tx when
 * PAID / receivable when ON_CREDIT":
 *   - PAID      → `paymentMethod` + `accountId` required; the service credits that account and books
 *                 an INCOME/SALE `financial_transactions` row, and stamps `paid_at = occurred_at`.
 *   - ON_CREDIT → no method/account; NO financial transaction at sale time (the money arrives later
 *                 via collectPayment, KOK-031); the sale sits in `v_receivables` until collected.
 */
export const recordSaleCommandSchema = z.discriminatedUnion("paymentStatus", [
  z.object({
    paymentStatus: z.literal("PAID"),
    paymentMethod: paymentMethodSchema,
    accountId: z.string().min(1),
    ...saleCommandCommonFields,
  }),
  z.object({
    paymentStatus: z.literal("ON_CREDIT"),
    ...saleCommandCommonFields,
  }),
]);
/**
 * NOTE the deliberate `z.input` (not `z.infer`): `confirm` is the only field with a Zod `.default()`,
 * and the OUTPUT type would make it REQUIRED on every command literal — including the many
 * unrelated call sites (web mutation hooks, tests) that legitimately omit it and mean "false". The
 * input type keeps it optional; the service reads it as `=== true`, so an omitted flag is the safe
 * value with or without a `.parse()` in front. Mirrors `RecordPurchaseCommand`'s identical note.
 */
export type RecordSaleCommand = z.input<typeof recordSaleCommandSchema>;

/**
 * UC-18 edit (KOK-064, Doc 03 §7 R-1). Deliberately an ALIAS of the create schema, exactly like
 * `updatePurchaseCommandSchema` aliases `recordPurchaseCommandSchema`: an update is a FULL
 * REPLACEMENT of the sale's post-state (the caller sends the complete edited sale, not a patch), so
 * its field set is by definition identical to the create's — same lines, same payment-status
 * discrimination, same `confirm` flag, and the same absence of a client-supplied `total`.
 *
 * Payment fields (`paymentStatus`/`paymentMethod`/`accountId`) ARE editable through this schema —
 * `updateSale` itself refuses (409 CONFLICT) before ever validating the command's shape once the
 * sale has already been collected via `collectPayment` (see core/sales/index.ts's
 * `assertSaleNotCollected` and docs/development/kok-030-sales-end-to-end.md §1), so this alias never
 * needs to special-case those fields at the schema level.
 */
export const updateSaleCommandSchema = recordSaleCommandSchema;
/** `z.input` for the same reason `RecordSaleCommand` is. */
export type UpdateSaleCommand = z.input<typeof updateSaleCommandSchema>;

/**
 * UC-18 delete (KOK-064, R-3 soft delete + R-5 confirmation). Carries ONLY the confirm flag —
 * mirrors `deletePurchaseCommandSchema`: the server already knows everything else about the sale
 * being deleted.
 */
export const deleteSaleCommandSchema = z.object({
  confirm: confirmFlagSchema,
});
/** `z.input` — same `confirm` default reasoning as `RecordSaleCommand`. */
export type DeleteSaleCommand = z.input<typeof deleteSaleCommandSchema>;

/**
 * Body of the DRY-RUN impact endpoint (R-5 / ADR-016), mirroring
 * `purchaseImpactRequestSchema` exactly: one request shape covers create/update/delete because
 * `planCostingReplay` already does. Discriminated on `op` so `id` is required exactly where it is
 * meaningful.
 */
export const saleImpactRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    command: recordSaleCommandSchema,
  }),
  z.object({
    op: z.literal("update"),
    id: z.string().min(1),
    command: updateSaleCommandSchema,
  }),
  z.object({
    op: z.literal("delete"),
    id: z.string().min(1),
  }),
]);
/** `z.input` — the nested command schemas carry `confirm`'s default. */
export type SaleImpactRequest = z.input<typeof saleImpactRequestSchema>;

/** GET /sales query filters — mirrors listPurchasesFiltersSchema's shape (purchasing.ts). */
export const listSalesFiltersSchema = z.object({
  customerId: z.string().min(1).optional(),
  paymentStatus: z.enum(["PAID", "ON_CREDIT"]).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListSalesFilters = z.infer<typeof listSalesFiltersSchema>;

export interface SaleLineDto {
  id: string;
  itemId: string;
  /** Milli-units (Doc 04 §2). */
  qty: number;
  /** Centavos per whole unit (INV-6). */
  unitPriceMc: MilliCentavosPerUnit;
  /** WAC frozen at sale time (Doc 04 §3.3): milli-centavos per WHOLE unit (ADR-017) — the
   * per-line margin forever. Never recomputed after the sale commits. */
  unitCostSnapshotMc: number;
}

export interface SaleDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  /** Always `'CATALOG'` for sales recorded by this task (the column also admits CUSTOM_ORDER,
   * written by the custom-order delivery flow, KOK-033/034). */
  channel: SaleChannel;
  customOrderId: string | null;
  customerId: string | null;
  sessionId: string | null;
  /** Centavos (INV-6), server-recomputed as Σ(qty × unit_price) — never caller-supplied (Doc 04 §5). */
  total: number;
  paymentStatus: PaymentStatus;
  /** ISO-8601 instant the sale was paid: `occurred_at` for a PAID sale, `null` while ON_CREDIT
   * (set later by collectPayment, KOK-031). */
  paidAt: string | null;
  /** Non-null only for a PAID sale. */
  paymentMethod: PaymentMethod | null;
  /** The credited account for a PAID sale; `null` for ON_CREDIT (no cash moved yet). */
  accountId: string | null;
  notes: string | null;
  lines: SaleLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordSaleResult {
  sale: SaleDto;
  /** The credited account carrying its post-sale balance for a PAID sale; `null` for ON_CREDIT,
   * which moves no cash at sale time (the receivable is collected later, KOK-031). */
  account: FinancialAccountDto | null;
}

/** Mirrors `RecordSaleResult`: the sale in its NEW (post-edit) state, plus the account carrying its
 * post-edit balance — `null` when the edited sale is ON_CREDIT (no cash side to report). */
export interface UpdateSaleResult {
  sale: SaleDto;
  account: FinancialAccountDto | null;
}

/** Mirrors `RecordSaleResult`. `sale` is the soft-deleted row as it now stands (R-3: the event
 * survives with `deleted_at` set, reversible for 90 days via audit data), and `account` carries the
 * balance with the sale's cash effect reversed — `null` when the deleted sale was ON_CREDIT. */
export interface DeleteSaleResult {
  sale: SaleDto;
  account: FinancialAccountDto | null;
}

export interface ListSalesResult {
  sales: SaleDto[];
}

/**
 * UC-04 (KOK-031): collect a receivable. Unlike `recordSaleCommandSchema`, this is never
 * discriminated — `collectPayment` only ever runs against a sale already sitting in
 * `v_receivables` (`payment_status = 'ON_CREDIT'`), so `paymentMethod`/`accountId` are always
 * required here (mirrors `recordSaleCommandSchema`'s PAID branch). `occurredAt`/`businessDate` are
 * the moment the money was actually collected — independent of the sale's own `occurred_at`, which
 * stays frozen at when the goods left (Doc 04 §3.3).
 */
export const collectPaymentCommandSchema = z.object({
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  paymentMethod: paymentMethodSchema,
  accountId: z.string().min(1),
});
export type CollectPaymentCommand = z.infer<typeof collectPaymentCommandSchema>;

export interface CollectPaymentResult {
  sale: SaleDto;
  /** The credited account carrying its post-collection balance. */
  account: FinancialAccountDto;
}

/**
 * One row of `v_receivables` (Doc 04 §4): an ON_CREDIT, non-deleted sale with its age in days.
 * `daysOutstanding` is computed by the view itself (`julianday('now') - julianday(occurred_at)`),
 * not recomputed client-side, so every consumer (this screen, and later KOK-046's alerts job)
 * agrees on the same number.
 */
export interface ReceivableDto {
  saleId: string;
  occurredAt: string;
  businessDate: string;
  customerId: string | null;
  customerName: string | null;
  total: number;
  channel: SaleChannel;
  customOrderId: string | null;
  daysOutstanding: number;
}

export interface ListReceivablesResult {
  receivables: ReceivableDto[];
}
