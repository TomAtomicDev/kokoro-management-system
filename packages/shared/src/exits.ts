// Stock-exit command DTOs (KOK-018, Doc 03 §3 UC-09, Doc 04 §3.3 `stock_exits` / §4 `v_waste`).
// Single-contract rule (D-4): the API route and any future web form / AI draft tool for
// non-commercial exits import these same schemas — never redeclare field validation elsewhere.
//
// C-6 "invisible cost": an exit is valued at the item's CURRENT WAC (core/costing's
// `snapshotUnitCost`) but never mutates that WAC and never creates a `financial_transactions`
// row — the cost was already paid when the item was purchased; the exit only makes that sunk
// cost visible in reporting (`v_waste`). See apps/worker/src/core/inventory/exits.ts for the
// enforcement of that rule.
//
// Mirrors packages/shared/src/purchasing.ts's shape (field schemas -> command schema -> hand-
// written DTOs). Kept in its own file, not inventory-views.ts (reserved for the two READ views
// per its own header comment) — a future counts.ts (KOK-019) gets its own name the same way.

import { z } from "zod";

import type { StockExitReason } from "./enums.js";
import { stockExitReasonSchema } from "./enums.js";

/** Milli-units of the item's own stored unit (Doc 04 §2), matching qty.ts's representation.
 * Always positive — the sign convention (exits are negative kardex movements) lives only in
 * `stock_movements` per Doc 04 §3.3 vs §3.4; `stock_exits.qty` itself is the positive reported
 * amount, matching the table's own CHECK constraint. */
const qtySchema = z
  .number()
  .int()
  .positive("La cantidad debe ser un entero positivo (mili-unidades).");
/** `YYYY-MM-DD`, America/La_Paz local calendar date (Doc 04 §1, INV-3). */
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD.");
/** UTC ISO-8601 instant (Doc 04 §1). */
const occurredAtSchema = z
  .string()
  .datetime({ offset: true, message: "occurredAt debe ser una fecha ISO-8601." });

export const recordStockExitCommandSchema = z.object({
  itemId: z.string().min(1),
  qty: qtySchema,
  reason: stockExitReasonSchema,
  // Sessions (KOK-0xx) don't exist yet — accepted and passed through, not validated against a
  // sessions table here (no FK check beyond what the DB's own `ON DELETE restrict` FK enforces at
  // write time), mirroring purchasing.ts's identical `sessionId` precedent.
  sessionId: z.string().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
});
export type RecordStockExitCommand = z.infer<typeof recordStockExitCommandSchema>;

/** GET /inventory/exits query filters — mirrors listPurchasesFiltersSchema's shape. */
export const listStockExitsFiltersSchema = z.object({
  itemId: z.string().min(1).optional(),
  reason: stockExitReasonSchema.optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListStockExitsFilters = z.infer<typeof listStockExitsFiltersSchema>;

/** GET /inventory/waste-summary query filters (v_waste, the "what's costing me the most lately"
 * read). No `itemId`/`reason` filter — `v_waste` is already a monthly/reason aggregate, not a
 * per-row list. */
export const listWasteSummaryFiltersSchema = z.object({
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});
export type ListWasteSummaryFilters = z.infer<typeof listWasteSummaryFiltersSchema>;

export interface StockExitDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  itemId: string;
  /** Milli-units (Doc 04 §2), always positive — matches `stock_exits.qty`'s own CHECK. */
  qty: number;
  reason: StockExitReason;
  /** Centavos per milli-unit (Doc 04 §3.4), the item's WAC snapshotted at exit time (C-6). */
  unitCostSnapshot: number;
  sessionId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordStockExitResult {
  exit: StockExitDto;
}

export interface ListStockExitsResult {
  exits: StockExitDto[];
}

/** One row of `v_waste` (Doc 04 §4): one (month, reason) bucket. */
export interface WasteSummaryRowDto {
  /** `YYYY-MM`. */
  month: string;
  reason: StockExitReason;
  exitCount: number;
  /** Centavos (INV-6): `SUM(ROUND(qty * unit_cost_snapshot))`, computed by the view itself. */
  totalCost: number;
}

export interface ListWasteSummaryResult {
  summary: WasteSummaryRowDto[];
}
