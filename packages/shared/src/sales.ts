// Sales command DTOs (KOK-030, Doc 03 UC-03, Doc 04 §3.3 `sales`/`sale_lines` + §5). Single-contract
// rule (D-4): the API route and any future web form / AI draft tool for sales import these same
// schemas — never redeclare field validation elsewhere. Mirrors packages/shared/src/purchasing.ts's
// shape (field schemas -> command schema -> hand-written DTOs).
//
// Scope: CREATE + READ only (KOK-030) — `recordSale` + list/get — exactly as core/purchasing shipped
// in KOK-016 before UPDATE/DELETE/RESTORE were added later (KOK-024). Edit/delete/restore + the
// dry-run impact request are a separate follow-up task (see docs/development/kok-024-event-edit-
// delete.md §1/§8), so there is deliberately NO update/delete schema and NO impact-request schema here.
//
// NO `confirm` flag (deliberate, unlike purchasing/exits). The `confirm` flag exists solely to gate
// the R-5 backdated-replay confirmation (ADR-016). A sale is NOT a modelled replay trigger:
// `costing_adjustments.trigger_event_type` admits only purchase/production_run/stock_exit/session
// (Doc 04 §3.4, `CostingAdjustmentTrigger`), never `sale`. So `recordSale` never runs a costing
// replay and a `confirm` flag would gate nothing — it is omitted rather than cargo-culted. A
// backdated sale re-weighting a later WAC is the same documented open gap that a backdated
// CREATE purchase through the web UI has; the nightly WAC-drift detector (R-2) is the backstop.
//
// There is no client-supplied `total` field on the command — Doc 04 §5's integrity rule requires
// `sales.total = Σ(qty × unit_price)`, recomputed server-side and never trusted from the caller
// (core/sales/index.ts is the only place a sale's total is produced).

import { z } from "zod";

import {
  type PaymentMethod,
  type PaymentStatus,
  paymentMethodSchema,
  type SaleChannel,
} from "./enums.js";
import type { FinancialAccountDto } from "./finance.js";

/** Milli-units of the item's own stored unit (Doc 04 §2), matching qty.ts's representation. Always
 * positive — a sale line removes stock, and the OUT sign is applied server-side, never sent. */
const qtySchema = z
  .number()
  .int()
  .positive("La cantidad debe ser un entero positivo (mili-unidades).");
/** Centavos per WHOLE unit (INV-6), editable vs the catalog list price (Doc 04 §3.3). May be zero
 * (a giveaway line) but never negative. The per-line money total is `qty × unit_price` computed
 * server-side (Doc 04 §5), never sent by the caller. */
const unitPriceSchema = z
  .number()
  .int()
  .nonnegative("El precio unitario debe ser un entero no negativo (centavos).");
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
  unitPrice: unitPriceSchema,
});
export type SaleLineCommand = z.infer<typeof saleLineCommandSchema>;

/** Fields common to both payment branches. `channel` is NOT accepted: this task records CATALOG
 * sales only (CUSTOM_ORDER sales are created by the custom-order delivery flow, KOK-033/034, O-2);
 * the service pins `channel = 'CATALOG'`. `customerId` is an optional nullable FK — customers CRUD
 * (KOK-032) has not shipped, so it is passed through with no validation beyond the DB's own FK. */
const saleCommandCommonFields = {
  customerId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  lines: z.array(saleLineCommandSchema).min(1, "Se requiere al menos una línea de venta."),
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
export type RecordSaleCommand = z.infer<typeof recordSaleCommandSchema>;

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
  unitPrice: number;
  /** WAC frozen at sale time (Doc 04 §3.3): centavos per milli-unit, a deliberate REAL — the
   * per-line margin forever. Never recomputed after the sale commits. */
  unitCostSnapshot: number;
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

export interface ListSalesResult {
  sales: SaleDto[];
}
