// Read-only DTOs/filters for the two SQL views backing SC-08's Inventory screen (KOK-017,
// Doc 04 §4 `v_stock`/`v_kardex`, Doc 07 SC-08). These are query-result shapes, not command
// inputs — like packages/shared/src/finance.ts's `FinancialAccountDto`/`ListAccountsResult`, the
// DTOs here are hand-written interfaces (not `z.infer`) since nothing ever constructs one from
// user input; only the *filters* schemas below are real Zod schemas (D-4: the API route and any
// future web form import them, never redeclare the same validation).
//
// `v_stock`/`v_kardex` are raw SQL views (apps/worker/migrations/0001_init.sql) — Drizzle's SQLite
// dialect can't express `v_kardex`'s window function or `v_stock`'s partial aggregation, so
// apps/worker/src/core/inventory/queries.ts queries them via `db.all(sql\`...\`)` and maps the
// raw snake_case rows into the camelCase DTOs declared here.
//
// Kept in a file named `inventory-views.ts`, not `inventory.ts`, so a future exits/counts command
// schema module (KOK-018/KOK-019) has an obvious, uncontested name of its own.

import { z } from "zod";

import type { ItemCategory, ItemKind, StockMovementType, Unit } from "./enums.js";
import { itemKindSchema } from "./enums.js";

/** `YYYY-MM-DD`, America/La_Paz local calendar date (Doc 04 §1, INV-3). */
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD.");

/** GET /inventory/stock query filters (SC-08's default "Stock" tab). Query-string values arrive
 * as strings, so the boolean flags use `z.coerce.boolean()` (matching the rest of the codebase's
 * `z.coerce.number()` precedent for numeric query params, e.g. finance.ts's `limit`). */
export const listStockFiltersSchema = z.object({
  kind: itemKindSchema.optional(),
  lowStockOnly: z.coerce.boolean().optional(),
  negativeOnly: z.coerce.boolean().optional(),
});
export type ListStockFilters = z.infer<typeof listStockFiltersSchema>;

/** GET /inventory/kardex query filters. `itemId` is REQUIRED — a kardex view without an item
 * filter would return every movement ever recorded and isn't a real use case per SC-08 (a table
 * row's "row -> Kardex drawer" interaction is always scoped to one item). */
export const listKardexFiltersSchema = z.object({
  itemId: z.string().min(1),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});
export type ListKardexFilters = z.infer<typeof listKardexFiltersSchema>;

export interface StockRowDto {
  itemId: string;
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  /** Weighted average cost, centavos per MILLI-unit (Doc 04 §2/§3.4, the one deliberately-float
   * column — same scale as `items.wac`/`stock_movements.unit_cost`; ×1000 to display as a
   * per-whole-unit price, matching `ItemForm.tsx`'s existing display precedent). */
  wac: number;
  /** Centavos per milli-unit (Doc 04 §2), also float — same scale as `wac` above. */
  replacementCost: number;
  /** Centavos (INV-6). Null when the item has no set sale price yet. */
  salePrice: number | null;
  /** Milli-units (Doc 04 §2). Null when no minimum stock threshold is configured for the item. */
  minStockQty: number | null;
  /** Milli-units (Doc 04 §2). */
  qtyOnHand: number;
  /** ISO-8601 instant the balance first went negative (INV-8), or null if currently non-negative. */
  negativeSince: string | null;
  /** Centavos (INV-6): `ROUND(qtyOnHand * wac)`, computed by the view itself. */
  stockValue: number;
  isLowStock: boolean;
}

export interface ListStockResult {
  stock: StockRowDto[];
}

export interface KardexRowDto {
  id: string;
  /** UTC ISO-8601 instant (Doc 04 §1). */
  occurredAt: string;
  /** Local business date `YYYY-MM-DD`, America/La_Paz (INV-3). */
  businessDate: string;
  itemId: string;
  itemName: string;
  unit: Unit;
  type: StockMovementType;
  /** Signed milli-units (Doc 04 §3.4). */
  qty: number;
  /** Centavos per milli-unit at movement time (Doc 04 §3.4). */
  unitCost: number;
  /** Centavos, signed (Doc 04 §3.4). */
  totalCost: number;
  sourceEventType: string;
  sourceEventId: string;
  createdAt: string;
  /** Running signed milli-unit balance for this item as of this movement, computed by the view's
   * window function (Doc 04 §4). */
  runningBalance: number;
}

export interface ListKardexResult {
  movements: KardexRowDto[];
}
