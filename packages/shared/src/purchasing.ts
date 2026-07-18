// Purchasing command DTOs (KOK-016, Doc 03 UC-01, Doc 04 §3.3/§3.4). Single-contract rule (D-4):
// the API route and any future web form / AI draft tool for purchases import these same schemas —
// never redeclare field validation elsewhere.
//
// This is the TEMPLATE event-vertical schema module: future event verticals (production KOK-026,
// sales KOK-030, exits KOK-018, counts KOK-019) mirror this shape (field schemas -> command schema
// -> hand-written DTOs, matching packages/shared/src/finance.ts's precedent).
//
// Scope (Doc 10 KOK-016): CREATE + READ only. There is no client-supplied `total` field — Doc 04
// §5's integrity rule requires it to be server-recomputed as Σ lineTotal, never trusted from the
// caller (core/purchasing/index.ts's recordPurchase enforces this).

import { z } from "zod";

import type { FinancialAccountDto } from "./finance.js";

/** Milli-units of the item's own stored unit (Doc 04 §2), matching qty.ts's representation. Always
 * positive — a purchase line adds stock, it never removes it. */
const qtySchema = z
  .number()
  .int()
  .positive("La cantidad debe ser un entero positivo (mili-unidades).");
/** Centavos (INV-6) for the WHOLE line, not a per-unit price. May be zero (e.g. a free
 * promotional line) but never negative. */
const lineTotalSchema = z
  .number()
  .int()
  .nonnegative("El total de línea debe ser un entero no negativo (centavos).");
/** `YYYY-MM-DD`, America/La_Paz local calendar date (Doc 04 §1, INV-3). */
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD.");
/** UTC ISO-8601 instant (Doc 04 §1). */
const occurredAtSchema = z
  .string()
  .datetime({ offset: true, message: "occurredAt debe ser una fecha ISO-8601." });

export const purchaseLineCommandSchema = z.object({
  itemId: z.string().min(1),
  qty: qtySchema,
  lineTotal: lineTotalSchema,
});
export type PurchaseLineCommand = z.infer<typeof purchaseLineCommandSchema>;

export const recordPurchaseCommandSchema = z.object({
  supplierName: z.string().trim().max(200).optional(),
  accountId: z.string().min(1),
  // Sessions (KOK-0xx) don't exist yet — accepted and passed through, not validated against a
  // sessions table here (no FK check beyond what the DB's own `ON DELETE restrict` FK enforces at
  // write time).
  sessionId: z.string().min(1).optional(),
  receiptPhotoKey: z.string().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  lines: z.array(purchaseLineCommandSchema).min(1, "Se requiere al menos una línea de compra."),
});
export type RecordPurchaseCommand = z.infer<typeof recordPurchaseCommandSchema>;

/** GET /purchases query filters — mirrors listTransactionsFiltersSchema's shape (finance.ts). */
export const listPurchasesFiltersSchema = z.object({
  accountId: z.string().min(1).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListPurchasesFilters = z.infer<typeof listPurchasesFiltersSchema>;

export interface PurchaseLineDto {
  id: string;
  itemId: string;
  /** Milli-units (Doc 04 §2). */
  qty: number;
  /** Centavos (INV-6). */
  lineTotal: number;
}

export interface PurchaseDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  supplierName: string | null;
  sessionId: string | null;
  accountId: string;
  /** Centavos (INV-6), server-recomputed as Σ lineTotal — never caller-supplied (Doc 04 §5). */
  total: number;
  receiptPhotoKey: string | null;
  notes: string | null;
  lines: PurchaseLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordPurchaseResult {
  purchase: PurchaseDto;
  account: FinancialAccountDto;
}

export interface ListPurchasesResult {
  purchases: PurchaseDto[];
}
