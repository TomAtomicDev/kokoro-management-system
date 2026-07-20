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

import { confirmFlagSchema } from "./costing.js";
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
  // R-5 / ADR-016 (KOK-024). An exit books no WAC of its own (C-6), but a BACKDATED one changes
  // `on_hand` at the point it lands, and `on_hand` is C-1's weight — so every entry after it
  // re-averages differently, which can move cost already booked against a later sale/exit. Same
  // shared flag as purchasing.ts (D-4).
  confirm: confirmFlagSchema,
});
/** `z.input`, not `z.infer` — see purchasing.ts's `RecordPurchaseCommand` for why (the `confirm`
 * default would otherwise make the flag required on every command literal). */
export type RecordStockExitCommand = z.input<typeof recordStockExitCommandSchema>;

/**
 * PUT /inventory/exits/:id (KOK-024 Phase E). FULL REPLACEMENT semantics, not a patch: the service
 * regenerates this exit's derived kardex rows from the command's post-state (R-1), so a caller that
 * omitted a field would be asking for it to be cleared, not preserved. The web form and any future
 * AI edit tool must therefore submit the whole event, exactly like the create form does.
 *
 * Deliberately an ALIAS of the record schema rather than a second object literal. The record
 * command already carries no server-derived field — `unit_cost_snapshot` is computed inside
 * core/inventory/exits.ts and has never been accepted from a caller — so "the record fields minus
 * the server-derived ones, plus `confirm`" is, term for term, the record schema itself. Two copies
 * of the same seven fields would be a D-4 drift hazard for zero benefit. It is exported under its
 * own name so routes/forms/tools bind to the edit contract by name and this can become a distinct
 * schema the day the two shapes genuinely diverge.
 */
export const updateStockExitCommandSchema = recordStockExitCommandSchema;
/** `z.input` for the same reason as `RecordStockExitCommand` — the `confirm` default. */
export type UpdateStockExitCommand = z.input<typeof updateStockExitCommandSchema>;

/**
 * DELETE /inventory/exits/:id (KOK-024 Phase E). Carries only the R-5 acknowledgement: a delete
 * names its target in the path, and deleting a BACKDATED exit re-weights C-1 for every later entry
 * of that item exactly as creating one does, so it needs the same confirmation gate.
 */
export const deleteStockExitCommandSchema = z.object({
  confirm: confirmFlagSchema,
});
export type DeleteStockExitCommand = z.input<typeof deleteStockExitCommandSchema>;

/**
 * Body of the dry-run impact endpoint (Phase F): "what would this create / edit / delete do?",
 * answered without writing anything. Discriminated on `op` so a `create` (no id yet) and an
 * `update` (id + full post-state) and a `delete` (id only) cannot be confused for one another at
 * the type level or the validation boundary.
 *
 * The `command` members reuse the very schemas the mutations parse (D-4): a preview validated
 * against a laxer shape than the write it previews would be able to promise something the write
 * then rejects.
 */
export const stockExitImpactRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), command: recordStockExitCommandSchema }),
  z.object({
    op: z.literal("update"),
    id: z.string().min(1),
    command: updateStockExitCommandSchema,
  }),
  z.object({ op: z.literal("delete"), id: z.string().min(1) }),
]);
/** `z.input` — the nested command's `confirm` default would otherwise be required on a literal. */
export type StockExitImpactRequest = z.input<typeof stockExitImpactRequestSchema>;

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

/** Mirrors `RecordStockExitResult`: the exit as it stands AFTER the edit. */
export interface UpdateStockExitResult {
  exit: StockExitDto;
}

/**
 * Mirrors `RecordStockExitResult`, plus R-3's timestamp. The row still exists (soft delete, D-8) —
 * `exit` is its final state — and `deletedAt` is the instant it was retired, the value the 90-day
 * reversal window in R-3 is measured from.
 */
export interface DeleteStockExitResult {
  exit: StockExitDto;
  deletedAt: string;
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
