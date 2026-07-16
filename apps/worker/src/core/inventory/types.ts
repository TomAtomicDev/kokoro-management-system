// Inventory movement input contract (KOK-012, Doc 03 §1-2, Doc 04 §3.4).
//
// This is a plain data shape, not a Zod schema: core/inventory is a building block called by
// future event services (purchases KOK-016, production KOK-026, sales KOK-030, exits KOK-018,
// counts KOK-019 — none exist yet). Each of those owns its own Command DTO Zod schema in
// packages/shared (D-4) and maps its own fields into this shape before calling
// buildStockMovementStatements / buildReplaceMovementsForSourceStatements. Duplicating a schema
// here would create a second source of truth for a shape with no caller yet to validate against.

import type { StockMovementType } from "@kokoro/shared";

export interface StockMovementInput {
  itemId: string;
  /** UTC ISO-8601 instant (Doc 04 §1). */
  occurredAt: string;
  /** Local business date `YYYY-MM-DD`, America/La_Paz (INV-3). */
  businessDate: string;
  type: StockMovementType;
  /**
   * Signed milli-units (Doc 04 §3.4). Sign is enforced centrally by this module per `type`
   * (Doc 03 §1-2) — callers must not pre-negate/pre-validate; a caller-supplied sign that
   * disagrees with the canonical direction for `type` is rejected.
   */
  qty: number;
  /**
   * Centavos per milli-unit at movement time (Doc 04 §3.4) — the one deliberately-float column
   * (Doc 04 §2). `total_cost` is derived from this internally; it is NOT a caller input.
   */
  unitCost: number;
  /** e.g. 'purchase' | 'production_run' | 'sale' | 'stock_exit' | 'inventory_count' — free text, no FK by design (INV-9). */
  sourceEventType: string;
  sourceEventId: string;
}
