// Production-run command DTOs (KOK-026, Doc 03 UC-02 / §3 Recipe-as-template / §4 C-4, Doc 04
// §3.3 `production_runs`/`production_consumptions`). Single-contract rule (D-4): the API route
// and the web form import these same schemas — never redeclare field validation elsewhere.
//
// This is the SECOND full event-vertical schema module, mirroring purchasing.ts's template shape
// (field schemas -> command schema -> discriminated impact request -> hand-written DTOs) crossed
// with exits.ts's "no financial transaction" precedent: a production run moves stock on BOTH sides
// (PRODUCTION_OUT per consumption line, one PRODUCTION_IN for the output) but — like an exit —
// never creates a `financial_transactions` row itself; `indirect_cost` is a plain manual-entry
// centavos column with no cash-account linkage (Doc 03 §4 C-4, confirmed absent from Doc 04's
// schema — there is no accountId anywhere on `production_runs`).
//
// Recipe-as-template (Doc 03 §3 aggregate note): consumption lines default from `recipe.lines ×
// batches` but are freely editable before commit, so `lines` here is the run's ACTUAL post-edit
// consumption, never re-derived from the recipe server-side. `outputItemId` is likewise NOT part
// of any command — it is denormalized from `recipes.outputItemId` at commit time (Doc 04 §3.3's
// own comment: "denormalized from recipe at commit"), so accepting it from the caller would let a
// client claim a production run yielded a different item than its recipe actually makes.
//
// `allocatedSessionCost` is entirely absent from every command below: it is a stored column
// (`production_runs.allocated_session_cost`, default 0) owned exclusively by KOK-028's
// shared-cost-allocation job on session close, never by this module. `total_cost` computed here is
// always `direct_cost + indirect_cost` (i.e. `+ 0` for the allocation term) — see core/production's
// header for the exact C-4 arithmetic this schema's fields feed.

import { z } from "zod";
import { confirmFlagSchema } from "./costing.js";
import { businessDateSchema, occurredAtSchema } from "./dates.js";
import { safeText } from "./text.js";

/** Milli-units of the item's own stored unit (Doc 04 §2), matching qty.ts's representation.
 * Always positive — a production consumption line removes stock, it never adds it (the OUTPUT
 * side is `actualOutputQty`, a separate field, not a line). */
const lineQtySchema = z
  .number()
  .int()
  .positive("La cantidad de la línea debe ser un entero positivo (mili-unidades).");
/** The recipe multiplier (Doc 04 §3.3 CHECK `batches > 0`). REAL, not necessarily integer — half a
 * batch or two-and-a-half batches are both legitimate ("tanda"/"lote", Doc 13 glossary). */
const batchesSchema = z.number().positive("Las tandas deben ser un número positivo.");
/** Milli-units of the OUTPUT item's own stored unit. Always positive (Doc 04 §3.3 CHECK) — actual
 * yield absorbs merma automatically (C-4); it is never zero or negative. */
const actualOutputQtySchema = z
  .number()
  .int()
  .positive("La cantidad de salida real debe ser un entero positivo (mili-unidades).");
/** Centavos (INV-6), run-specific extras not tracked as raw-material consumption (Doc 04 §3.3
 * comment: "run-specific extras"). Optional, defaults to 0 — most runs have none. Never negative:
 * this is a cost, not a signed adjustment. */
const indirectCostSchema = z
  .number()
  .int()
  .nonnegative("El costo indirecto debe ser un entero no negativo (centavos).")
  .optional()
  .default(0);
export const productionLineCommandSchema = z.object({
  itemId: z.string().min(1),
  qty: lineQtySchema,
});
export type ProductionLineCommand = z.infer<typeof productionLineCommandSchema>;

export const recordProductionRunCommandSchema = z.object({
  recipeId: z.string().min(1),
  // Sessions (KOK-027) and custom orders (KOK-033) don't exist yet — accepted and passed through,
  // not validated against their tables here beyond the DB's own `ON DELETE restrict` FK, mirroring
  // purchasing.ts's identical `sessionId` precedent.
  sessionId: z.string().min(1).optional(),
  customOrderId: z.string().min(1).optional(),
  batches: batchesSchema,
  actualOutputQty: actualOutputQtySchema,
  indirectCost: indirectCostSchema,
  notes: z.string().trim().pipe(safeText(2000)).optional(),
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  lines: z.array(productionLineCommandSchema).min(1, "Se requiere al menos un insumo consumido."),
  // R-5 / ADR-016 (KOK-024's mechanism, KOK-026 is its first non-purchasing consumer): a run whose
  // `business_date` lands before the latest already-processed movement of an item it touches (an
  // input OR the output) re-weights C-1 for every later kardex entry, which can change cost already
  // booked against a recorded sale/exit/other production run. Same shared flag as purchasing.ts /
  // exits.ts (D-4).
  confirm: confirmFlagSchema,
});
/** `z.input`, not `z.infer` — see purchasing.ts's `RecordPurchaseCommand` for why (`confirm` and
 * `indirectCost`'s `.default()`s would otherwise make both fields required on every command
 * literal, including the many call sites — web mutation hooks, tests — that legitimately omit
 * them and mean "false"/"0"). */
export type RecordProductionRunCommand = z.input<typeof recordProductionRunCommandSchema>;

/**
 * Full replacement, same shape as create (mirrors purchasing.ts's `updatePurchaseCommandSchema`
 * precedent): the caller sends the complete edited run, not a patch — same lines, same recipe,
 * same batches/output/dates, and the same `confirm` flag.
 */
export const updateProductionRunCommandSchema = recordProductionRunCommandSchema;
/** `z.input` for the same reason as `RecordProductionRunCommand`. */
export type UpdateProductionRunCommand = z.input<typeof updateProductionRunCommandSchema>;

/**
 * Delete (R-3 soft delete + R-5 confirmation). Carries ONLY the confirm flag — the server already
 * knows everything else about the run being deleted.
 */
export const deleteProductionRunCommandSchema = z.object({
  confirm: confirmFlagSchema,
});
/** `z.input` — same `confirm` default reasoning as `RecordProductionRunCommand`. */
export type DeleteProductionRunCommand = z.input<typeof deleteProductionRunCommandSchema>;

/**
 * Body of the DRY-RUN impact endpoint (R-5 / ADR-016): "what would this create/edit/delete do to
 * costing?", answered without writing anything. Mirrors `purchaseImpactRequestSchema` /
 * `stockExitImpactRequestSchema` exactly — one request shape covers all three operations because
 * `planCostingReplay` already does, and the preview must run the identical planner the mutation
 * runs or the preview is a lie with a UI around it (core/costing/replay.ts's header).
 */
export const productionRunImpactRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), command: recordProductionRunCommandSchema }),
  z.object({
    op: z.literal("update"),
    id: z.string().min(1),
    command: updateProductionRunCommandSchema,
  }),
  z.object({ op: z.literal("delete"), id: z.string().min(1) }),
]);
/** `z.input` — the nested command schemas carry `confirm`/`indirectCost`'s defaults. */
export type ProductionRunImpactRequest = z.input<typeof productionRunImpactRequestSchema>;

/** GET /production-runs query filters — mirrors listPurchasesFiltersSchema's shape. */
export const listProductionRunsFiltersSchema = z.object({
  recipeId: z.string().min(1).optional(),
  outputItemId: z.string().min(1).optional(),
  /** O-4: production for an order is a normal ProductionRun linked via `custom_order_id`, enabling
   * the KOK-034 order-profitability panel (agreed total − order-linked run costs) without an N+1. */
  customOrderId: z.string().min(1).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListProductionRunsFilters = z.infer<typeof listProductionRunsFiltersSchema>;

export interface ProductionLineDto {
  id: string;
  itemId: string;
  /** Milli-units (Doc 04 §2). */
  qty: number;
  /** Milli-centavos per WHOLE unit (Doc 04 §3.4, ADR-017) — this line's item's WAC
   * snapshotted at commit time (C-4's "consumed item's WAC at commit time"), never rewritten by a
   * later REPLAY (R-4 protects frozen snapshots; the plan books a `costing_adjustments`
   * correction forward instead). */
  unitCostSnapshotMc: number;
}

export interface ProductionRunDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  recipeId: string;
  sessionId: string | null;
  customOrderId: string | null;
  /** REAL — see `batchesSchema`. */
  batches: number;
  /** Denormalized from the recipe at commit (Doc 04 §3.3) — never independently editable. */
  outputItemId: string;
  /** Milli-units (Doc 04 §2). Actual yield; absorbs merma vs. `recipe.expectedYieldQty × batches`
   * automatically (C-4) — this module has no separate "variance" field, the yield-% the UI shows
   * (SC-05) is computed client-side from this and the recipe's own `expectedYieldQty`. */
  actualOutputQty: number;
  /** Centavos (INV-6). */
  indirectCost: number;
  /** Centavos (INV-6). Always 0 until KOK-028's shared-cost-allocation job (session close) writes
   * it — this module never sets it to anything else. */
  allocatedSessionCost: number;
  /** Centavos (INV-6), C-4: `Σ(consumed qty × consumed item's WAC at commit time)`, rounded
   * half-up once at this aggregate (INV-6's "final step only" — never per-line). */
  directCost: number;
  /** Centavos (INV-6), C-4: `directCost + indirectCost + allocatedSessionCost`. */
  totalCost: number;
  /** Milli-centavos per WHOLE output unit (ADR-017): `rateFromTotal(totalCost,
   * actualOutputQty)` — directly comparable to `items.salePrice`, same convention as
   * `RecipeCostDto.costPerOutputUnit` (recipes.ts). Derived/read-only; never stored as its own
   * column (Doc 04 §3.3 has no such column — only `total_cost` and `actual_output_qty`, from
   * which this is always recomputable). */
  outputUnitCostMc: number;
  notes: string | null;
  lines: ProductionLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordProductionRunResult {
  productionRun: ProductionRunDto;
}

/** Mirrors `RecordProductionRunResult`: the run in its NEW (post-edit) state. */
export interface UpdateProductionRunResult {
  productionRun: ProductionRunDto;
}

/** Mirrors `RecordProductionRunResult`, plus R-3's timestamp — the row still exists (soft delete,
 * D-8); `productionRun` is its final state and `deletedAt` is the instant it was retired, matching
 * `DeleteStockExitResult`'s shape (exits.ts) since neither vertical has an account to reconcile. */
export interface DeleteProductionRunResult {
  productionRun: ProductionRunDto;
  deletedAt: string;
}

export interface ListProductionRunsResult {
  productionRuns: ProductionRunDto[];
}
