// core/costing — the `costing_adjustments` ledger writer (KOK-024 Phase C, R-4 / ADR-016,
// Doc 04 §3.4).
//
// R-4 forbids rewriting a frozen cost snapshot (`sale_lines.unit_cost_snapshot`,
// `stock_exits.unit_cost_snapshot`): the margin the owner was shown for a past day must keep
// reading exactly as it did then. The correction is instead booked FORWARD as a row in this
// ledger, so cumulative profitability absorbs it without history silently changing underneath
// her.
//
// ARCHITECTURAL CONSTRAINT (identical to core/audit.ts's buildAuditLogInsert and
// core/inventory/movements.ts): this module BUILDS statements and never executes. The adjustment
// belongs in the SAME db.batch() as the edit/delete that triggered it (D-3) — a correction that
// could land without its trigger, or vice versa, is exactly the split-brain state the one-batch
// rule exists to prevent.

import type { Centavos } from "@kokoro/shared";
import { generateUuidV7, nowIso, toBusinessDate } from "@kokoro/shared";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { costingAdjustments } from "../../db/schema.js";
import { validationError } from "../errors.js";

type Statement = BatchItem<"sqlite">;

/** The trigger event kinds that can move a downstream WAC, mirroring `costing_adjustments`'
 * `trigger_event_type` CHECK (Doc 04 §3.4, as amended by Phase A to admit `stock_exit`). */
export type CostingAdjustmentTrigger = "purchase" | "production_run" | "stock_exit";

/** One item's slice of a replay's cost correction. One replay produces one entry per item whose
 * `costDelta` is nonzero — see replay.ts. */
export interface CostingAdjustmentEntry {
  itemId: string;
  triggerEventType: CostingAdjustmentTrigger;
  /** The id of the create/edit/delete that triggered the replay, NOT of an affected sale/exit. */
  triggerEventId: string;
  /** `sale_lines.id`s whose frozen snapshot this delta corrects. Serialized as a JSON array. */
  affectedSaleLineIds: readonly string[];
  /** `stock_exits.id`s whose frozen snapshot this delta corrects. Serialized as a JSON array. */
  affectedStockExitIds: readonly string[];
  /** Signed integer centavos (D-5). Negative = accumulated margin fell. */
  costDelta: Centavos;
}

/**
 * Builds (does not execute) the `costing_adjustments` INSERT for one item's correction.
 *
 * DATING (R-4, and the explicit column comment on `costing_adjustments.business_date`): both
 * `occurred_at` and `business_date` are the CORRECTION's own moment — right now, in the shop's
 * timezone — and NEVER the backdated event's date. This is the whole point of the ledger: dating
 * the row back to the event it corrects would retroactively change the P&L of a day that has
 * already been reported, which is precisely what R-4 forbids and what booking the correction
 * forward avoids. `business_date` goes through `toBusinessDate` (INV-3) rather than slicing the
 * ISO string, because 20:00 America/La_Paz is already the next calendar day in UTC — a hand-rolled
 * `.slice(0, 10)` would misfile every evening correction by one day.
 */
export function buildCostingAdjustmentInsert(db: Db, entry: CostingAdjustmentEntry): Statement {
  if (!Number.isSafeInteger(entry.costDelta)) {
    // D-5: `cost_delta` is an INTEGER centavos column. A float here would mean some caller did
    // money math outside money.ts and skipped the single half-up rounding at the aggregate.
    throw validationError("El ajuste de costo debe ser un entero seguro (centavos).", {
      costDelta: entry.costDelta,
    });
  }

  const occurredAt = nowIso();

  return db.insert(costingAdjustments).values({
    id: generateUuidV7(),
    occurredAt,
    businessDate: toBusinessDate(occurredAt),
    itemId: entry.itemId,
    triggerEventType: entry.triggerEventType,
    triggerEventId: entry.triggerEventId,
    affectedSaleLineIds: JSON.stringify(entry.affectedSaleLineIds),
    affectedStockExitIds: JSON.stringify(entry.affectedStockExitIds),
    costDelta: entry.costDelta,
    createdAt: occurredAt,
  });
}
