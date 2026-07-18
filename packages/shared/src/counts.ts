// Inventory count command DTOs (KOK-019, Doc 03 §3 UC-10, Doc 04 §3.3 `inventory_counts` /
// `inventory_count_lines`). Single-contract rule (D-4): the API route and any future web form / AI
// draft tool for counts import these same schemas — never redeclare field validation elsewhere.
//
// DRAFT -> COMMITTED state machine (Doc 10 KOK-019): a count is started (freezing each selected
// item's expected_qty from live item_stock), edited line-by-line while DRAFT (possibly over
// multiple sessions), then committed exactly once — committing writes signed ADJUST stock
// movements for every nonzero-variance line, valued at the item's CURRENT WAC at commit time (C-6,
// same rule as exits: adjustments value at current WAC, they never change it). A Zod schema can't
// express "read at start time, never re-read" — the frozen-snapshot correctness rule this implies
// lives entirely in apps/worker/src/core/inventory/counts.ts (see that file's header).
//
// Mirrors packages/shared/src/exits.ts / purchasing.ts's shape (field schemas -> command schema ->
// hand-written DTOs).

import { z } from "zod";

import type { InventoryCountStatus } from "./enums.js";
import { inventoryCountStatusSchema, itemCategorySchema, itemKindSchema } from "./enums.js";

/** `YYYY-MM-DD`, America/La_Paz local calendar date (Doc 04 §1, INV-3). */
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD.");
/** UTC ISO-8601 instant (Doc 04 §1). */
const occurredAtSchema = z
  .string()
  .datetime({ offset: true, message: "occurredAt debe ser una fecha ISO-8601." });
/** Milli-units of the item's own stored unit (Doc 04 §2), matching qty.ts's representation. A
 * physical count can never be negative (there is no such thing as -3 units on a shelf), but zero
 * is legitimate — a fully-depleted item legitimately counts to zero. */
const countedQtySchema = z
  .number()
  .int()
  .nonnegative("La cantidad contada debe ser un entero no negativo (mili-unidades).");

/** Optional scope filters — omitting BOTH means "every active item" (Doc 07 SC-08's "new count ->
 * item checklist (filter by category)"). */
export const startCountCommandSchema = z.object({
  kind: itemKindSchema.optional(),
  category: itemCategorySchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
});
export type StartCountCommand = z.infer<typeof startCountCommandSchema>;

export const updateCountLineCommandSchema = z.object({
  countId: z.string().min(1),
  itemId: z.string().min(1),
  countedQty: countedQtySchema,
});
export type UpdateCountLineCommand = z.infer<typeof updateCountLineCommandSchema>;

export const commitCountCommandSchema = z.object({
  countId: z.string().min(1),
});
export type CommitCountCommand = z.infer<typeof commitCountCommandSchema>;

/** GET /inventory/counts query filters — mirrors listPurchasesFiltersSchema's shape. */
export const listCountsFiltersSchema = z.object({
  status: inventoryCountStatusSchema.optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListCountsFilters = z.infer<typeof listCountsFiltersSchema>;

/** Deliberately minimal — mirrors purchasing.ts's PurchaseLineDto precedent of NOT denormalizing
 * itemName/unit onto the line DTO, leaving that lookup to the frontend's own item cache. */
export interface InventoryCountLineDto {
  id: string;
  itemId: string;
  /** Milli-units (Doc 04 §2) — the FROZEN snapshot of item_stock.qty_on_hand taken at count-start
   * time. Never refreshed while the count is DRAFT, even if other events change the item's live
   * stock in the meantime. */
  expectedQty: number;
  /** Milli-units (Doc 04 §2) — defaults to expectedQty at count-start (a "no variance yet"
   * starting point) and is editable via updateCountLine while the count is DRAFT. */
  countedQty: number;
}

export interface InventoryCountDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  status: InventoryCountStatus;
  notes: string | null;
  lines: InventoryCountLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface StartCountResult {
  count: InventoryCountDto;
}

export interface UpdateCountLineResult {
  line: InventoryCountLineDto;
}

/** One item's committed variance (UC-10/SC-08 "commit shows variance summary"). Only nonzero-delta
 * lines appear here — zero-variance lines produce no adjustment and are omitted entirely. */
export interface CountAdjustmentDto {
  itemId: string;
  /** Signed milli-units (Doc 04 §3.4) — the ADJUST movement's qty, computed as
   * `countedQty - expectedQty` against the FROZEN expectedQty snapshot, never a live re-read of
   * item_stock at commit time. */
  delta: number;
}

export interface CommitCountResult {
  count: InventoryCountDto;
  adjustments: CountAdjustmentDto[];
}

export interface ListCountsResult {
  counts: InventoryCountDto[];
}
