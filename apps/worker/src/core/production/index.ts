// core/production — UC-02 "Record production run" (KOK-026, Doc 03 UC-02 / §3 Recipe-as-template
// / §4 C-4, Doc 04 §3.3 `production_runs`/`production_consumptions`). SECOND full event-vertical
// module, copying core/purchasing/index.ts's TEMPLATE shape (that module's own header names it as
// such): a top-level command entry point — `recordProductionRun` is not a building block like
// core/inventory/core/costing — so it does its own defensive validation, builds every row itself,
// and executes exactly ONE atomic `db.batch()` (D-3) per command containing:
//   - the `production_runs` + `production_consumptions` inserts (the event itself)
//   - PRODUCTION_OUT `stock_movements` for every metered consumption line + ONE PRODUCTION_IN for the
//     output, all in a single call to core/inventory's `buildStockMovementStatements` (a building
//     block spliced into this batch, never its own)
//   - ONE `items` UPDATE for the OUTPUT item only, carrying the C-1 WAC update (`applyWacEntry`,
//     same as purchasing threads it per purchase line) — NEVER for a consumption item (C-6, see
//     below)
//   - the `audit_log` row (core/audit's buildAuditLogInsert)
//   - (mirrors purchasing's KOK-024 R-2/R-5 machinery) whatever `planCostingReplay` returns when
//     this run is BACKDATED — the corrected `items.wac_mc` for every item whose kardex it re-weights,
//     the `costing_adjustments` row booking the difference forward (R-4), the
//     `item_stock.negative_since` fix, and its own audit row. Empty on the ordinary same-day
//     capture.
//
// UNLIKE PURCHASING, LIKE core/inventory/exits.ts (C-6 "invisible cost", that module's header):
// the CONSUMPTION side of a run is valued at each metered item's CURRENT WAC (`getCurrentWac` +
// `snapshotUnitCost`) or an unmetered item's replacement cost (C-9), and NEVER written back —
// `applyWacEntry` is only ever called for the single OUTPUT item's PRODUCTION_IN entry. There is also NO financial side at all: `production_runs` has
// no `accountId` column (confirmed against schema.ts), so this file never builds a
// `financial_transactions` row or an account balance delta — skip that whole block purchasing has.
//
// C-4 ARITHMETIC (this module's one deliberately-shared computation, `computeProductionCosts`,
// used verbatim by BOTH the create and the update paths so they can never drift apart from each
// other or from core/costing/replay.ts's `applyProductionCostCorrections` — the function that
// re-derives this same run's cost later when a REPLAY moves one of its inputs' WAC):
//   direct = Σ totalCentavos(consumption line's unitCostSnapshotMc, qty) (ADR-017: each
//            line rounds to a proper Centavos amount via the one sanctioned rate->total helper,
//            summed exactly — INV-6)
//   total  = direct_cost + indirect_cost + allocated_session_cost (0 on create — that column is
//            owned exclusively by KOK-028's shared-cost-allocation job, never by this module; an
//            EDIT preserves whatever KOK-028 already wrote rather than resetting it to 0)
//   outputUnitCostMc (fed into the PRODUCTION_IN movement's `unitCostMc`) =
//            rateFromTotal(total_cost, actual_output_qty) — the one sanctioned total->rate helper,
//            same milli-centavos-per-WHOLE-unit convention as `items.wac_mc`.
//   outputUnitCostMc is exposed on the DTO at the same rate scale, recomputed with
//            `rateFromTotal` so it cannot drift from total_cost and actual_output_qty.
//
// RECIPE RESOLUTION, NOT ACCOUNT RESOLUTION: `command.recipeId` must name an ACTIVE recipe
// (`findActiveRecipeRowOrThrow`, mirroring `core/finance/accounts.ts`'s `findActiveAccountRowOrThrow`
// pattern exactly). `production_runs.output_item_id` is denormalized from `recipe.outputItemId` at
// commit time — the command schema deliberately has no `outputItemId` field, so this is the only
// place it is ever produced. `command.lines` is trusted as the run's ACTUAL, already-edited
// consumption (Doc 03 §3: "editable before commit") — this service never re-derives lines from the
// recipe's own lines.
//
// FINISHED-ITEM GUARD (Doc 04 §5, mirrors recipes.ts's `validateRecipeItemKinds`): every consumed
// item must be RAW_MATERIAL or SEMI_FINISHED, never FINISHED — re-checked here defensively (D-2)
// even though the web layer is expected to only ever offer valid items.
//
// STATEMENT ORDERING REQUIREMENT (same as purchasing/exits): `plan.statements` / `costingPlan.
// statements` always go LAST in the batch, and specifically after the movement-replacement
// statements — replay.ts's own module header states why (the `item_stock` upsert there recomputes
// `negative_since` incrementally; the plan's is the authoritative recomputation and must win).

import type {
  AuditActor,
  Centavos,
  DeleteProductionRunCommand,
  DeleteProductionRunResult,
  ListProductionRunsFilters,
  ListProductionRunsResult,
  MilliCentavosPerUnit,
  ProductionLineDto,
  ProductionRunDto,
  ProductionRunImpactRequest,
  RecordProductionRunCommand,
  RecordProductionRunResult,
  ReplayImpactDto,
  SessionStatus,
  UpdateProductionRunCommand,
  UpdateProductionRunResult,
} from "@kokoro/shared";
import {
  addMoney,
  allocateLargestRemainder,
  generateUuidV7,
  nowIso,
  REPLAY_CONFIRMATION_REQUIRED,
  rateFromTotal,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { items, productionConsumptions, productionRuns, type recipes } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { getCurrentWac } from "../costing/repair.js";
import type { CostingReplayPlan, PendingMovementChange } from "../costing/replay.js";
import { planCostingReplay } from "../costing/replay.js";
import type { ReplayMovement } from "../costing/wac.js";
import { applyWacEntry, replayWacFrom, snapshotUnitCost } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
import {
  buildReplaceMovementsForSourceStatements,
  buildStockMovementStatements,
} from "../inventory/movements.js";
import type { StockMovementInput } from "../inventory/types.js";
import { assertOrderLinkable } from "../orders/index.js";
import { resolveSessionForEvent } from "../sessions/index.js";

type Statement = BatchItem<"sqlite">;
type ProductionRunRow = typeof productionRuns.$inferSelect;
type ProductionConsumptionRow = typeof productionConsumptions.$inferSelect;
type RecipeRow = typeof recipes.$inferSelect;
type ProductionConsumptionItemState = {
  isUnmetered: boolean;
  replacementCostMc: MilliCentavosPerUnit;
};

function toProductionRunDto(
  row: ProductionRunRow,
  consumptionRows: readonly ProductionConsumptionRow[],
): ProductionRunDto {
  const lines: ProductionLineDto[] = consumptionRows.map((c) => ({
    id: c.id,
    itemId: c.itemId,
    qty: c.qty,
    unitCostSnapshotMc: c.unitCostSnapshotMc,
  }));
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    businessDate: row.businessDate,
    recipeId: row.recipeId,
    sessionId: row.sessionId,
    customOrderId: row.customOrderId,
    batches: row.batches,
    outputItemId: row.outputItemId,
    actualOutputQty: row.actualOutputQty,
    indirectCost: row.indirectCost,
    allocatedSessionCost: row.allocatedSessionCost,
    directCost: row.directCost,
    totalCost: row.totalCost,
    // Derived/read-only (Doc 04 §3.3 has no such column) — always recomputed from the two stored
    // columns, never cached, so it can never drift from them. ADR-017: the one sanctioned
    // total->rate conversion (`rateFromTotal`), not a bare `×1000`.
    outputUnitCostMc: rateFromTotal(toCentavos(row.totalCost), toMilliUnits(row.actualOutputQty)),
    code: row.code,
    notes: row.notes,
    lines,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Mirrors `core/finance/accounts.ts`'s `findActiveAccountRowOrThrow` precisely: a production run
 * may only reference a recipe that both EXISTS and is currently ACTIVE (Doc 03 §3 — an inactive
 * recipe is retired, not a valid template for a new run). */
async function findActiveRecipeRowOrThrow(db: Db, recipeId: string): Promise<RecipeRow> {
  const row = await db.query.recipes.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, recipeId),
  });
  if (!row) {
    throw notFound("No se encontró la receta.", { recipeId });
  }
  if (row.isActive !== 1) {
    throw validationError("La receta no está activa.", { recipeId });
  }
  return row;
}

/** Doc 04 §5 integrity rule, the consumption-side analogue of recipes.ts's
 * `validateRecipeItemKinds`: every consumed item must exist and be RAW_MATERIAL or SEMI_FINISHED
 * (a positive whitelist, not just "not FINISHED" — PACKAGING is a purchased item too, but Doc 03
 * §3's Item aggregate row is explicit that it is never a recipe/production input, only ever a
 * `sale_lines` row).
 * Defensive re-check (D-2): core/ services never trust that a caller already validated this. */
async function validateProductionConsumptionItemKinds(
  db: Db,
  lines: readonly { itemId: string }[],
): Promise<Map<string, ProductionConsumptionItemState>> {
  const itemStates = new Map<string, ProductionConsumptionItemState>();
  for (const line of lines) {
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, line.itemId),
    });
    if (!itemRow) {
      throw notFound("No se encontró el ítem consumido.", { id: line.itemId });
    }
    if (itemRow.kind !== "RAW_MATERIAL" && itemRow.kind !== "SEMI_FINISHED") {
      throw validationError(
        "Un insumo de producción debe ser una materia prima o un semielaborado.",
        { itemId: line.itemId, kind: itemRow.kind },
      );
    }
    itemStates.set(line.itemId, {
      isUnmetered: itemRow.isUnmetered === 1,
      replacementCostMc: toMilliCentavosPerUnit(itemRow.replacementCostMc),
    });
  }
  return itemStates;
}

/**
 * C-4, the ONE place this arithmetic is expressed — shared verbatim by the create and update
 * paths so they can never compute a different number for the same inputs, and deliberately mirrors
 * core/costing/replay.ts's `applyProductionCostCorrections` operation order (direct sum -> add
 * indirect + allocated -> divide by output qty), so a later REPLAY "correcting" this run's output
 * cost lands on the same number this module would have booked for the same consumption/costs. See
 * this module's header for the full rounding-point rationale (INV-6).
 */
export function computeProductionCosts(
  consumptions: readonly { qty: number; unitCostSnapshotMc: MilliCentavosPerUnit }[],
  indirectCost: number,
  allocatedSessionCost: number,
  actualOutputQty: number,
): {
  directCost: Centavos;
  totalCost: Centavos;
  outputUnitCostMc: MilliCentavosPerUnit;
} {
  // Each consumption's contribution is rounded to a proper Centavos amount via `totalCentavos`
  // (ADR-017) and summed exactly — no bare scale literal, and every line is independently an
  // honest money amount rather than a fraction carried until one aggregate step.
  const directCost: Centavos =
    consumptions.length === 0
      ? toCentavos(0)
      : addMoney(
          ...consumptions.map((c) => totalCentavos(c.unitCostSnapshotMc, toMilliUnits(c.qty))),
        );
  const totalCost = addMoney(
    directCost,
    toCentavos(indirectCost),
    toCentavos(allocatedSessionCost),
  );
  const outputUnitCostMc = rateFromTotal(totalCost, toMilliUnits(actualOutputQty));
  return { directCost, totalCost, outputUnitCostMc };
}

/** Turns a run's post-state consumption rows + output into its kardex movements: PRODUCTION_OUT
 * for each metered consumption line (sign-flipped at this boundary only, mirroring exits.ts's identical
 * convention) + ONE PRODUCTION_IN for the output. Shared by the create path, the update path, and
 * `restoreProductionRun` (which rebuilds these from the run's UNCHANGED stored consumption rows) —
 * one construction, never a second implementation that could quietly disagree (this module's header
 * / purchasing.ts's identical `buildPurchaseInMovementsFromLines` precedent). */
async function buildProductionMovementsFromConsumptions(
  db: Db,
  runId: string,
  consumptions: readonly ProductionConsumptionRow[],
  outputItemId: string,
  actualOutputQty: number,
  outputUnitCostMc: MilliCentavosPerUnit,
  occurredAt: string,
  businessDate: string,
): Promise<StockMovementInput[]> {
  const itemIds = [...new Set(consumptions.map((c) => c.itemId))];
  const unmeteredItemIds = new Set<string>();
  if (itemIds.length > 0) {
    const itemRows = await db.query.items.findMany({
      where: (t, { inArray }) => inArray(t.id, itemIds),
    });
    for (const item of itemRows) {
      if (item.isUnmetered === 1) unmeteredItemIds.add(item.id);
    }
  }
  const movements: StockMovementInput[] = consumptions
    .filter((c) => !unmeteredItemIds.has(c.itemId))
    .map((c) => ({
      itemId: c.itemId,
      occurredAt,
      businessDate,
      type: "PRODUCTION_OUT",
      qty: -c.qty,
      unitCostMc: toMilliCentavosPerUnit(c.unitCostSnapshotMc),
      sourceEventType: "production_run",
      sourceEventId: runId,
    }));
  movements.push({
    itemId: outputItemId,
    occurredAt,
    businessDate,
    type: "PRODUCTION_IN",
    qty: actualOutputQty,
    unitCostMc: outputUnitCostMc,
    sourceEventType: "production_run",
    sourceEventId: runId,
  });
  return movements;
}

/**
 * Builds the create path's post-state: a fresh run id, its consumption rows (each snapshotted at
 * its item's CURRENT WAC per C-6), its kardex movements, the C-4 cost figures, and the row ready to
 * insert. Shared with `previewProductionRunImpact`'s "create" branch (KOK-024 Phase F precedent,
 * carried over to this vertical) so the dry-run preview can never drift from what `recordProductionRun`
 * actually builds for the same command. Pure construction; never calls `db.batch()`.
 */
async function buildProductionRunCreateInputs(
  db: Db,
  command: RecordProductionRunCommand,
): Promise<{
  runId: string;
  now: string;
  movements: StockMovementInput[];
  consumptionRows: ProductionConsumptionRow[];
  newOutputWacMc: MilliCentavosPerUnit;
  runRow: ProductionRunRow;
  sessionStatements: Statement[];
  resolvedSessionStatus: SessionStatus;
}> {
  if (command.customOrderId) await assertOrderLinkable(db, command.customOrderId);
  // Defensive re-check (D-2) — mirrors recordProductionRunCommandSchema's `.min(1)` on `lines`.
  if (command.lines.length === 0) {
    throw validationError("Se requiere al menos un insumo consumido.", {});
  }

  const recipe = await findActiveRecipeRowOrThrow(db, command.recipeId);
  const resolvedSession = await resolveSessionForEvent(db, {
    type: "PRODUCTION",
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    explicitSessionId: command.sessionId ?? null,
  });
  const consumptionItemStates = await validateProductionConsumptionItemKinds(db, command.lines);

  const runId = generateUuidV7();
  const now = nowIso();

  // C-6: each consumption line is valued at its item's CURRENT WAC, snapshotted onto
  // production_consumptions.unit_cost_snapshot_mc — never via applyWacEntry (that is reserved for
  // the single OUTPUT entry below).
  const consumptionRows: ProductionConsumptionRow[] = [];
  for (const line of command.lines) {
    const itemState = consumptionItemStates.get(line.itemId);
    if (!itemState) {
      throw validationError("Estado interno de consumo inconsistente.", { itemId: line.itemId });
    }
    const unitCostSnapshotMc = snapshotUnitCost(
      itemState.isUnmetered ? itemState.replacementCostMc : await getCurrentWac(db, line.itemId),
    );
    consumptionRows.push({
      id: generateUuidV7(),
      productionRunId: runId,
      itemId: line.itemId,
      qty: line.qty,
      unitCostSnapshotMc,
    });
  }

  const indirectCost = command.indirectCost ?? 0;
  const { directCost, totalCost, outputUnitCostMc } = computeProductionCosts(
    consumptionRows.map((c) => ({
      qty: c.qty,
      unitCostSnapshotMc: toMilliCentavosPerUnit(c.unitCostSnapshotMc),
    })),
    indirectCost,
    // allocatedSessionCost: always 0 at create time — `production_runs.allocated_session_cost`'s
    // own schema default, owned exclusively by KOK-028 (this module's header).
    0,
    command.actualOutputQty,
  );

  // Seed the OUTPUT item's C-1 threading state from its currently-stored wac_mc/on-hand
  // (defaulting on-hand to 0 when no item_stock row exists yet), exactly as purchasing seeds
  // ItemPurchaseState.
  const outputItemRow = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, recipe.outputItemId),
  });
  if (!outputItemRow) {
    throw notFound("No se encontró el ítem de salida de la receta.", { id: recipe.outputItemId });
  }
  const outputStockRow = await db.query.itemStock.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, recipe.outputItemId),
  });
  const newOutputWacMc = applyWacEntry(
    toMilliCentavosPerUnit(outputItemRow.wacMc),
    outputStockRow?.qtyOnHand ?? 0,
    command.actualOutputQty,
    outputUnitCostMc,
  );

  const movements = await buildProductionMovementsFromConsumptions(
    db,
    runId,
    consumptionRows,
    recipe.outputItemId,
    command.actualOutputQty,
    outputUnitCostMc,
    command.occurredAt,
    command.businessDate,
  );

  const runRow: ProductionRunRow = {
    id: runId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    recipeId: command.recipeId,
    sessionId: resolvedSession.sessionId,
    customOrderId: command.customOrderId ?? null,
    batches: command.batches,
    outputItemId: recipe.outputItemId,
    actualOutputQty: command.actualOutputQty,
    indirectCost,
    allocatedSessionCost: 0,
    directCost,
    totalCost,
    // KOK-185: assigned by an AFTER INSERT trigger (migration 0024), never by core/ — re-read
    // after db.batch() and folded into the returned DTO.
    code: null,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    runId,
    now,
    movements,
    consumptionRows,
    newOutputWacMc,
    runRow,
    sessionStatements: resolvedSession.statements,
    resolvedSessionStatus: resolvedSession.status,
  };
}

interface ProductionRunCreateCostingResult {
  confirmationRequired: boolean;
  impact: ReplayImpactDto;
  statements: Statement[];
  allocation: SessionCostAllocationResult | null;
  runRow: ProductionRunRow;
  movements: StockMovementInput[];
  newOutputWacMc: MilliCentavosPerUnit;
  /** Needed only by the OPEN branch's existing caller-owned WAC guard. */
  replayedItemIds: readonly string[];
}

async function planProductionRunCreateCostingImpact(
  db: Db,
  built: Awaited<ReturnType<typeof buildProductionRunCreateInputs>>,
  actor: AuditActor,
): Promise<ProductionRunCreateCostingResult> {
  if (built.resolvedSessionStatus !== "CLOSED") {
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "production_run",
        eventId: built.runId,
        businessDate: built.runRow.businessDate,
        occurredAt: built.runRow.occurredAt,
      },
      changes: [
        {
          sourceEventType: "production_run",
          sourceEventId: built.runId,
          newMovements: built.movements,
        },
      ],
      actor,
    });
    return {
      confirmationRequired: plan.confirmationRequired,
      impact: plan.impact,
      statements: plan.statements,
      allocation: null,
      runRow: built.runRow,
      movements: built.movements,
      newOutputWacMc: built.newOutputWacMc,
      replayedItemIds: plan.replayedItemIds,
    };
  }

  const sessionId = built.runRow.sessionId;
  const costLineRows = await db.query.sessionCosts.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.sessionId, sessionId),
  });
  let totalSharedCost = 0;
  for (const row of costLineRows) totalSharedCost += row.amount;

  const allocation = await planSessionCostAllocation(
    db,
    sessionId,
    totalSharedCost,
    built.runRow.businessDate,
    built.runRow.occurredAt,
    actor,
    { run: built.runRow, consumptions: built.consumptionRows },
  );

  if (!allocation.pendingRunAllocation) {
    throw new Error(
      "planSessionCostAllocation did not return pendingRunAllocation for a supplied pendingRun",
    );
  }
  const { allocatedSessionCost, totalCost, movements } = allocation.pendingRunAllocation;

  return {
    confirmationRequired: allocation.confirmationRequired,
    impact: allocation.impact,
    statements: allocation.statements,
    allocation,
    runRow: { ...built.runRow, allocatedSessionCost, totalCost },
    movements,
    newOutputWacMc: built.newOutputWacMc,
    replayedItemIds: [],
  };
}

/** UC-02: record a production run in one atomic batch (D-3). See this module's header for the full
 * statement list this builds. */
export async function recordProductionRun(
  db: Db,
  command: RecordProductionRunCommand,
  actor: AuditActor,
): Promise<RecordProductionRunResult> {
  const built = await buildProductionRunCreateInputs(db, command);
  const created = await planProductionRunCreateCostingImpact(db, built, actor);

  // R-5: refuse BEFORE db.batch, carrying the impact for the confirmation dialog.
  if (created.confirmationRequired && command.confirm !== true) {
    throw conflict(
      created.allocation
        ? "Agregar esta producción a la sesión cerrada redistribuye el costo compartido entre las producciones existentes y puede cambiar costos ya calculados. Revisa el impacto y confirma para guardarla."
        : "Esta producción tiene fecha anterior a movimientos ya registrados y cambia costos ya calculados. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: created.impact },
    );
  }

  const { statements: movementStatements } = buildStockMovementStatements(db, created.movements);

  // Exactly ONE of the plan and this service writes the output item's WAC, never both (same
  // reasoning as purchasing's `replayOwnedItemIds` guard).
  const replayOwnedItemIds = new Set(created.replayedItemIds);
  const itemUpdateStatements: Statement[] =
    created.allocation !== null || replayOwnedItemIds.has(created.runRow.outputItemId)
      ? []
      : [
          db
            .update(items)
            .set({ wacMc: created.newOutputWacMc, updatedAt: built.now })
            .where(eq(items.id, created.runRow.outputItemId)),
        ];

  const statements: Statement[] = [
    ...built.sessionStatements,
    db.insert(productionRuns).values(created.runRow),
    ...built.consumptionRows.map((row) => db.insert(productionConsumptions).values(row)),
    ...movementStatements,
    ...itemUpdateStatements,
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "production_runs",
      entityId: built.runId,
      before: null,
      after: { ...created.runRow, lines: built.consumptionRows },
    }),
    // R-2: LAST, after movementStatements — see this module's header. Empty on the fast path.
    ...created.statements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  const codeRow = await db.query.productionRuns.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, built.runId),
    columns: { code: true },
  });

  return {
    productionRun: toProductionRunDto(
      { ...created.runRow, code: codeRow?.code ?? null },
      built.consumptionRows,
    ),
  };
}

// ============================================================================================
// UC-02 EDIT / DELETE / RESTORE — same shape as core/purchasing's, Doc 03 §7 R-1/R-3/R-5,
// INV-9/INV-10, D-8. See purchasing/index.ts's identical section header for the full rationale;
// this is that shape with `production_consumptions` standing in for `purchase_lines` and NO cash
// side to regenerate.
// ============================================================================================

/** A kardex row as the projected-WAC recompute below manipulates it — identical shape/sort key to
 * purchasing.ts's `ProjectedKardexRow`/`compareKardexRows` (duplicated locally: these are private
 * per-vertical implementation details, not shared building blocks — see purchasing.ts, which is
 * not exported either). All three copies across the codebase (here, purchasing.ts, and repair.ts's
 * own ordering) must agree on `occurredAt` then `createdAt`, or the synchronous replay, this
 * recompute, and the nightly audit would each settle on a different WAC. */
interface ProjectedKardexRow extends ReplayMovement {
  occurredAt: string;
  createdAt: string;
}

function compareKardexRows(a: ProjectedKardexRow, b: ProjectedKardexRow): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

/**
 * The post-state `items.wac_mc` for ONE item (always the output item, on either side of an edit —
 * see the call site), computed by replaying its PROJECTED kardex — mirrors purchasing.ts's
 * `computeProjectedWac` precisely (same "C-1 is not invertible, an edit/delete must replay the
 * item's full history" reasoning), filtered on `sourceEventType === "production_run"` instead of
 * `"purchase"`.
 */
async function computeProjectedOutputWac(
  db: Db,
  itemId: string,
  runId: string,
  newMovements: readonly StockMovementInput[],
  pendingCreatedAt: string,
): Promise<MilliCentavosPerUnit> {
  const existingRows = await db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
  });

  const projected: ProjectedKardexRow[] = existingRows
    .filter((row) => !(row.sourceEventType === "production_run" && row.sourceEventId === runId))
    .map((row) => ({
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      type: row.type,
      qty: row.qty,
      unitCostMc: toMilliCentavosPerUnit(row.unitCostMc),
    }));

  for (const movement of newMovements) {
    if (movement.itemId !== itemId) continue;
    projected.push({
      occurredAt: movement.occurredAt,
      createdAt: pendingCreatedAt,
      type: movement.type,
      qty: movement.qty,
      unitCostMc: movement.unitCostMc,
    });
  }

  projected.sort(compareKardexRows);
  return replayWacFrom({ onHand: 0, wac: toMilliCentavosPerUnit(0) }, projected).wac;
}

/** Canonical identity of one kardex row, identical shape to purchasing.ts's `movementKey` (private,
 * duplicated for the same reason as `ProjectedKardexRow` above). */
function movementKey(m: {
  itemId: string;
  occurredAt: string;
  businessDate: string;
  type: string;
  qty: number;
  unitCostMc: number;
}): string {
  return [m.itemId, m.occurredAt, m.businessDate, m.type, m.qty, m.unitCostMc].join("|");
}

/** True when `newMovements` describes exactly the kardex rows that already exist for this run —
 * i.e. the edit changed only descriptive fields (notes, sessionId, customOrderId). Identical
 * reasoning to purchasing.ts's `movementSetsEqual`: compared as multisets. */
function movementSetsEqual(
  existingRows: readonly {
    itemId: string;
    occurredAt: string;
    businessDate: string;
    type: string;
    qty: number;
    unitCostMc: number;
  }[],
  newMovements: readonly StockMovementInput[],
): boolean {
  if (existingRows.length !== newMovements.length) return false;
  const a = existingRows.map(movementKey).sort();
  const b = newMovements.map(movementKey).sort();
  return a.every((key, i) => key === b[i]);
}

/** The plan a descriptive-only edit gets — identical shape to purchasing.ts's
 * `NO_KARDEX_CHANGE_PLAN`, duplicated locally for the same reason. */
const NO_KARDEX_CHANGE_PLAN: CostingReplayPlan = {
  required: false,
  impact: {
    affectedSaleLineIds: [],
    affectedStockExitIds: [],
    affectedProductionRunIds: [],
    affectedAssemblyIds: [],
    affectedItemIds: [],
    costDelta: 0,
    requiresConfirmation: false,
  },
  replayedItemIds: [],
  confirmationRequired: false,
  statements: [],
};

interface ProductionRunMutationPlan {
  action: "update" | "delete" | "restore";
  existing: ProductionRunRow;
  existingConsumptions: readonly ProductionConsumptionRow[];
  newRow: ProductionRunRow;
  newConsumptions: readonly ProductionConsumptionRow[];
  newMovements: StockMovementInput[];
  confirm: boolean;
  actor: AuditActor;
  sessionStatements?: readonly Statement[];
}

/**
 * Plans the costing replay ONE pending update/delete/restore implies (R-2/R-5) — identical
 * reasoning and shape to purchasing.ts's `planPurchaseMutationCostingImpact`: whether the kardex
 * changed AT ALL decides whether a replay runs at all, which is what makes a descriptive-only edit
 * (notes/sessionId/customOrderId) never demand a pointless confirmation. SHARED, verbatim, between
 * `commitProductionRunMutation` and `previewProductionRunImpact`'s "update"/"delete" dry run.
 */
async function planProductionRunMutationCostingImpact(
  db: Db,
  runId: string,
  newRow: Pick<ProductionRunRow, "businessDate" | "occurredAt">,
  newMovements: readonly StockMovementInput[],
  actor: AuditActor,
): Promise<{ kardexUnchanged: boolean; costingPlan: CostingReplayPlan }> {
  const existingMovementRows = await db.query.stockMovements.findMany({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.sourceEventType, "production_run"), eqOp(t.sourceEventId, runId)),
  });

  const kardexUnchanged = movementSetsEqual(existingMovementRows, newMovements);

  const costingPlan = kardexUnchanged
    ? NO_KARDEX_CHANGE_PLAN
    : await planCostingReplay(db, {
        trigger: {
          eventType: "production_run",
          eventId: runId,
          businessDate: newRow.businessDate,
          occurredAt: newRow.occurredAt,
        },
        changes: [
          {
            sourceEventType: "production_run",
            sourceEventId: runId,
            newMovements: [...newMovements],
          },
        ],
        actor,
      });

  return { kardexUnchanged, costingPlan };
}

/**
 * The single commit path shared by `updateProductionRun`, `deleteProductionRun`, and
 * `restoreProductionRun`: plans the replay, honours R-5, and executes ONE atomic `db.batch()` (D-3)
 * containing the event write, its regenerated derived rows, the costing correction, and the audit
 * row. Mirrors purchasing.ts's `commitPurchaseMutation` exactly, minus the cash side.
 *
 * `touchedItemIds` is at most TWO items — `existing.outputItemId` and `newRow.outputItemId` — since
 * an edit that changes `recipeId` can change which item this run outputs to; a plain qty/line edit
 * leaves both equal to the same single item. Consumption items are NEVER in this set (C-6: this
 * module never writes a consumption item's WAC, on create OR on edit).
 */
async function commitProductionRunMutation(db: Db, plan: ProductionRunMutationPlan): Promise<void> {
  const { existing, newRow, newMovements } = plan;
  const runId = existing.id;
  const now = newRow.updatedAt;

  const { kardexUnchanged, costingPlan } = await planProductionRunMutationCostingImpact(
    db,
    runId,
    newRow,
    newMovements,
    plan.actor,
  );

  if (costingPlan.confirmationRequired && plan.confirm !== true) {
    throw conflict(
      plan.action === "delete"
        ? "Eliminar esta producción cambia costos ya calculados de ventas, salidas u otras producciones registradas. Revisa el impacto y confirma para eliminarla."
        : plan.action === "restore"
          ? "Restaurar esta producción cambia costos ya calculados de ventas, salidas u otras producciones registradas. Revisa el impacto y confirma para restaurarla."
          : "Esta edición cambia costos ya calculados de ventas, salidas u otras producciones registradas. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: costingPlan.impact },
    );
  }

  const movementStatements = kardexUnchanged
    ? []
    : (
        await buildReplaceMovementsForSourceStatements(db, "production_run", runId, [
          ...newMovements,
        ])
      ).statements;

  const replayOwnedItemIds = new Set(costingPlan.replayedItemIds);
  const pendingCreatedAt = nowIso();

  const touchedItemIds = kardexUnchanged
    ? new Set<string>()
    : new Set<string>([existing.outputItemId, newRow.outputItemId]);

  const itemUpdateStatements: Statement[] = [];
  for (const itemId of touchedItemIds) {
    if (replayOwnedItemIds.has(itemId)) continue;
    const wacMc = await computeProjectedOutputWac(
      db,
      itemId,
      runId,
      newMovements,
      pendingCreatedAt,
    );
    itemUpdateStatements.push(
      db.update(items).set({ wacMc, updatedAt: now }).where(eq(items.id, itemId)),
    );
  }

  const statements: Statement[] = [
    ...(plan.sessionStatements ?? []),
    db
      .update(productionRuns)
      .set({
        occurredAt: newRow.occurredAt,
        businessDate: newRow.businessDate,
        recipeId: newRow.recipeId,
        sessionId: newRow.sessionId,
        customOrderId: newRow.customOrderId,
        batches: newRow.batches,
        outputItemId: newRow.outputItemId,
        actualOutputQty: newRow.actualOutputQty,
        indirectCost: newRow.indirectCost,
        allocatedSessionCost: newRow.allocatedSessionCost,
        directCost: newRow.directCost,
        totalCost: newRow.totalCost,
        notes: newRow.notes,
        deletedAt: newRow.deletedAt,
        updatedAt: newRow.updatedAt,
      })
      .where(eq(productionRuns.id, runId)),
    // production_consumptions are components of the event aggregate (no deleted_at of their own,
    // Doc 04 §3.3), exactly like purchase_lines — a DELETE/RESTORE leaves them untouched (they
    // must survive intact for R-3's 90-day reversal); only an UPDATE replaces them wholesale.
    ...(plan.action === "update"
      ? [
          db
            .delete(productionConsumptions)
            .where(eq(productionConsumptions.productionRunId, runId)),
          ...plan.newConsumptions.map((row) => db.insert(productionConsumptions).values(row)),
        ]
      : []),
    ...movementStatements,
    ...itemUpdateStatements,
    buildAuditLogInsert(db, {
      actor: plan.actor,
      action: plan.action,
      entityType: "production_runs",
      entityId: runId,
      before: { ...existing, lines: plan.existingConsumptions },
      after: { ...newRow, lines: plan.newConsumptions },
    }),
    // LAST, after movementStatements — see this module's header. Empty on the fast path.
    ...costingPlan.statements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);
}

/** Loads a live (non-soft-deleted) production run + its consumption rows for mutation, or throws
 * NOT_FOUND — identical precedent to purchasing.ts's `loadPurchaseForMutation` (INV-10: a reverted
 * event is not editable). */
async function loadProductionRunForMutation(
  db: Db,
  id: string,
): Promise<{ row: ProductionRunRow; consumptions: ProductionConsumptionRow[] }> {
  const row = await db.query.productionRuns.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(t.id, id), isNullOp(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la producción.", { id });
  }
  const consumptions = await db.query.productionConsumptions.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.productionRunId, id),
  });
  return { row, consumptions };
}

/** Everything `updateProductionRun` needs to keep assembling its batch, AND everything
 * `previewProductionRunImpact`'s "update" dry run needs — same extraction reasoning as
 * `buildProductionRunCreateInputs`. */
async function buildProductionRunUpdateInputs(
  db: Db,
  id: string,
  command: UpdateProductionRunCommand,
): Promise<{
  existing: ProductionRunRow;
  existingConsumptions: ProductionConsumptionRow[];
  newRow: ProductionRunRow;
  newConsumptions: ProductionConsumptionRow[];
  newMovements: StockMovementInput[];
  sessionStatements: Statement[];
}> {
  // Defensive re-check (D-2).
  if (command.lines.length === 0) {
    throw validationError("Se requiere al menos un insumo consumido.", {});
  }

  const { row: existing, consumptions: existingConsumptions } = await loadProductionRunForMutation(
    db,
    id,
  );
  // KOK-137: only validate when the link is actually CHANGING. An edit that leaves
  // customOrderId untouched must stay editable even after that order later became
  // DELIVERED/CANCELLED — the link is historical fact at that point (O-4), not something this
  // edit is newly asserting, so re-validating it here would make an already-linked run
  // permanently unsavable for reasons unrelated to what the user is actually changing.
  // `undefined` means leave the existing link unchanged; `null` explicitly unlinks it.
  if (
    typeof command.customOrderId === "string" &&
    command.customOrderId !== existing.customOrderId
  ) {
    await assertOrderLinkable(db, command.customOrderId);
  }
  const recipe = await findActiveRecipeRowOrThrow(db, command.recipeId);
  const resolvedSession = await resolveSessionForEvent(db, {
    type: "PRODUCTION",
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    explicitSessionId: command.sessionId ?? null,
  });
  const consumptionItemStates = await validateProductionConsumptionItemKinds(db, command.lines);

  const now = nowIso();

  // unit_cost_snapshot-on-edit policy (mirrors core/inventory/exits.ts's identical precedent,
  // extended from that file's single-line case to N lines — "the one policy call this file makes",
  // stated here for the same reason exits.ts states its own): a line whose item MATCHES an existing
  // consumption line (matched by itemId, first-available-first-matched) keeps that line's FROZEN
  // unitCostSnapshotMc regardless of a qty/date change — R-4's spirit arriving through the edit door,
  // exactly as exits.ts's header describes. A line for an item that was not in the run before (or
  // an extra occurrence beyond what already existed) snapshots fresh at that item's CURRENT WAC
  // (C-6) — there is no old snapshot to preserve for it.
  const unmatchedExisting = [...existingConsumptions];
  const newConsumptions: ProductionConsumptionRow[] = [];
  for (const line of command.lines) {
    const matchIndex = unmatchedExisting.findIndex((c) => c.itemId === line.itemId);
    let unitCostSnapshotMc: MilliCentavosPerUnit;
    if (matchIndex >= 0) {
      const [matched] = unmatchedExisting.splice(matchIndex, 1);
      // matched is defined: matchIndex came from findIndex >= 0 on this same array.
      unitCostSnapshotMc =
        matched === undefined
          ? snapshotUnitCost(await getCurrentWac(db, line.itemId))
          : toMilliCentavosPerUnit(matched.unitCostSnapshotMc);
    } else {
      const itemState = consumptionItemStates.get(line.itemId);
      if (!itemState) {
        throw validationError("Estado interno de consumo inconsistente.", { itemId: line.itemId });
      }
      unitCostSnapshotMc = snapshotUnitCost(
        itemState.isUnmetered ? itemState.replacementCostMc : await getCurrentWac(db, line.itemId),
      );
    }
    newConsumptions.push({
      id: generateUuidV7(),
      productionRunId: id,
      itemId: line.itemId,
      qty: line.qty,
      unitCostSnapshotMc,
    });
  }

  const indirectCost = command.indirectCost ?? 0;
  const { directCost, totalCost, outputUnitCostMc } = computeProductionCosts(
    newConsumptions.map((c) => ({
      qty: c.qty,
      unitCostSnapshotMc: toMilliCentavosPerUnit(c.unitCostSnapshotMc),
    })),
    indirectCost,
    // Preserved, never reset: this module does not own allocated_session_cost (this module's
    // header) — an edit must not destroy whatever KOK-028's job already wrote.
    existing.allocatedSessionCost,
    command.actualOutputQty,
  );

  const newRow: ProductionRunRow = {
    ...existing,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    recipeId: command.recipeId,
    sessionId: resolvedSession.sessionId,
    customOrderId:
      command.customOrderId === undefined ? existing.customOrderId : command.customOrderId,
    batches: command.batches,
    outputItemId: recipe.outputItemId,
    actualOutputQty: command.actualOutputQty,
    indirectCost,
    directCost,
    totalCost,
    notes: command.notes ?? null,
    deletedAt: null,
    updatedAt: now,
  };

  const newMovements = await buildProductionMovementsFromConsumptions(
    db,
    id,
    newConsumptions,
    newRow.outputItemId,
    newRow.actualOutputQty,
    outputUnitCostMc,
    newRow.occurredAt,
    newRow.businessDate,
  );

  return {
    existing,
    existingConsumptions,
    newRow,
    newConsumptions,
    newMovements,
    sessionStatements: resolvedSession.statements,
  };
}

/** Everything `deleteProductionRun` needs, AND everything `previewProductionRunImpact`'s "delete"
 * dry run needs — same extraction reasoning as above. */
async function buildProductionRunDeleteInputs(
  db: Db,
  id: string,
): Promise<{
  existing: ProductionRunRow;
  existingConsumptions: ProductionConsumptionRow[];
  newRow: ProductionRunRow;
}> {
  const { row: existing, consumptions: existingConsumptions } = await loadProductionRunForMutation(
    db,
    id,
  );
  const now = nowIso();
  const newRow: ProductionRunRow = { ...existing, deletedAt: now, updatedAt: now };
  return { existing, existingConsumptions, newRow };
}

/**
 * UC-02 edit (R-1): replaces a production run's content and regenerates everything derived from
 * it — the kardex, `item_stock`, the OUTPUT item's WAC, and `direct_cost`/`total_cost` — in ONE
 * atomic batch (D-3). Full replacement, matching `updateProductionRunCommandSchema`'s contract:
 * `command.lines` becomes the run's complete consumption set, and `directCost`/`totalCost` are
 * always server-recomputed (this module's header's C-4 arithmetic), never accepted from the caller.
 */
export async function updateProductionRun(
  db: Db,
  id: string,
  command: UpdateProductionRunCommand,
  actor: AuditActor,
): Promise<UpdateProductionRunResult> {
  const {
    existing,
    existingConsumptions,
    newRow,
    newConsumptions,
    newMovements,
    sessionStatements,
  } = await buildProductionRunUpdateInputs(db, id, command);

  await commitProductionRunMutation(db, {
    action: "update",
    existing,
    existingConsumptions,
    newRow,
    newConsumptions,
    newMovements,
    sessionStatements,
    confirm: command.confirm === true,
    actor,
  });

  return { productionRun: toProductionRunDto(newRow, newConsumptions) };
}

/**
 * UC-02 delete (R-3 / INV-10): soft-deletes the run and reverses everything derived from it in ONE
 * atomic batch (D-3) — the kardex rows are removed outright (D-8's carve-out), `item_stock` and the
 * output item's WAC are netted/recomputed as though the run had never happened. INV-8 applies here
 * exactly as it does to purchasing: deleting a run whose OUTPUT has already been sold/consumed
 * further is permitted and may drive that item's `qty_on_hand` negative — never a blocking error.
 */
export async function deleteProductionRun(
  db: Db,
  id: string,
  command: DeleteProductionRunCommand,
  actor: AuditActor,
): Promise<DeleteProductionRunResult> {
  const { existing, existingConsumptions, newRow } = await buildProductionRunDeleteInputs(db, id);

  await commitProductionRunMutation(db, {
    action: "delete",
    existing,
    existingConsumptions,
    newRow,
    newConsumptions: existingConsumptions,
    newMovements: [],
    confirm: command.confirm === true,
    actor,
  });

  return {
    productionRun: toProductionRunDto(newRow, existingConsumptions),
    // Guaranteed a string: buildProductionRunDeleteInputs always sets deletedAt to `now` above.
    deletedAt: newRow.deletedAt as string,
  };
}

/** Loads a SOFT-DELETED production run + its (unchanged) consumption rows for a restore, or throws
 * NOT_FOUND — mirrors purchasing.ts's `loadPurchaseForRestore`. */
async function loadProductionRunForRestore(
  db: Db,
  id: string,
): Promise<{ row: ProductionRunRow; consumptions: ProductionConsumptionRow[] }> {
  const row = await db.query.productionRuns.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNotNull }) =>
      andOp(eqOp(t.id, id), isNotNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la producción eliminada.", { id });
  }
  const consumptions = await db.query.productionConsumptions.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.productionRunId, id),
  });
  return { row, consumptions };
}

/**
 * Server side of the "Deshacer" 10s-undo toast (Doc 06 principle 6): un-deletes a soft-deleted run
 * and reconstructs everything `deleteProductionRun` reversed, in ONE atomic batch (D-3), routed
 * through the SAME `commitProductionRunMutation` path update/delete already share.
 *
 * `production_consumptions` survive a delete unchanged (only the kardex was reversed), so this is
 * "an update with unchanged content, just un-deleting it": `newConsumptions` is the run's own
 * stored rows, `newMovements` re-derived from those SAME rows via
 * `buildProductionMovementsFromConsumptions` (never a re-implementation) using the run's STORED
 * `total_cost`/`actual_output_qty` for the output unit cost — a restore brings back exactly what
 * was deleted, not a freshly-priced version of it (same precedent as exits.ts's restore, which
 * reuses its stored `unit_cost_snapshot` verbatim).
 */
export async function restoreProductionRun(
  db: Db,
  id: string,
  command: DeleteProductionRunCommand,
  actor: AuditActor,
): Promise<UpdateProductionRunResult> {
  const { row: existing, consumptions: existingConsumptions } = await loadProductionRunForRestore(
    db,
    id,
  );

  const now = nowIso();
  const newRow: ProductionRunRow = { ...existing, deletedAt: null, updatedAt: now };
  const outputUnitCostMc = rateFromTotal(
    toCentavos(existing.totalCost),
    toMilliUnits(existing.actualOutputQty),
  );
  const newMovements = await buildProductionMovementsFromConsumptions(
    db,
    id,
    existingConsumptions,
    existing.outputItemId,
    existing.actualOutputQty,
    outputUnitCostMc,
    newRow.occurredAt,
    newRow.businessDate,
  );

  await commitProductionRunMutation(db, {
    action: "restore",
    existing,
    existingConsumptions,
    newRow,
    newConsumptions: existingConsumptions,
    newMovements,
    confirm: command.confirm === true,
    actor,
  });

  return { productionRun: toProductionRunDto(newRow, existingConsumptions) };
}

// ============================================================================================
// KOK-028 SHARED-COST ALLOCATION (S-3, ADR-010c) — triggered by core/sessions's `updateSession`
// on a PRODUCTION session's close, never by anything in this module's own command surface (there
// is no route/tool that calls this directly). Reuses this module's own C-4 building block
// (`buildProductionMovementsFromConsumptions`) and the SAME `planCostingReplay` (KOK-024) every
// other cost-changing mutation in this file routes through, so a session-driven correction can
// never land on a different number than a hand edit of the same run's cost would for the same
// `total_cost` (this module's header's "one shared computation" principle, extended across the
// session boundary).
//
// BASIS: `total_shared_cost` is the caller's to compute — core/sessions passes Σ `session_costs.
// amount` across ALL lines, cash AND `is_estimate` (Doc 03 §6 does not carve estimates out of the
// allocation basis, only out of cash creation; core/sessions's `listSessions` makes the identical
// judgment call for its own `costsTotal` display, for consistency). This function only splits
// that number: `allocateLargestRemainder`, weighted by each LIVE run's `direct_cost` (S-3) —
// `indirect_cost` is deliberately excluded from the weight, matching C-4's additive (not
// multiplicative) treatment of the three cost terms. Runs are ordered deterministically
// (`createdAt` then `id`, both monotonic under UUIDv7) so the largest-remainder tie-break is
// reproducible call to call, matching money.ts's own "ties broken by lowest original index".
//
// IDEMPOTENT, NOT TRANSITION-GATED: `core/sessions` calls this every time the post-edit session is
// `PRODUCTION`+`CLOSED`, not only on the OPEN->CLOSED transition — editing a cost line (or a
// linked run) then re-saving the session as CLOSED is the correction path (mirrors R-1's "re-
// recording is the correction path"). Only runs whose allocation ACTUALLY CHANGES are touched, so
// re-closing with unchanged inputs emits zero statements.
//
// WAC CASCADE: changing a run's `allocated_session_cost` changes its `total_cost`, hence its
// output unit cost, hence the PRODUCTION_IN movement that fed the output item's WAC (C-1) —
// exactly the shape `updateProductionRun` handles for a run's own direct-cost edit. This function
// builds the same kind of post-state movement set (unchanged consumption OUTs + a corrected
// PRODUCTION_IN) for every changed run and feeds ALL of them to ONE `planCostingReplay` call, so
// cross-run dependencies (one changed run's output feeding another changed run's input, within the
// same session) replay together rather than one at a time. Output items the plan does not claim
// (`plan.replayedItemIds` — the INV-11 fast path: nothing sits downstream of that PRODUCTION_IN
// yet) still need their WAC corrected directly, mirroring `commitProductionRunMutation`'s own
// `computeProjectedOutputWac` fallback — generalized here (`computeProjectedItemWacAcrossRuns`) to
// cover MULTIPLE simultaneously-changed runs sharing one output item (two batches of the same
// recipe in one session is not exotic).

export interface PendingProductionRunAllocationInput {
  /** Synthetic pending run inserted by the caller in the same batch. */
  run: ProductionRunRow;
  consumptions: readonly ProductionConsumptionRow[];
}

export interface SessionCostAllocationResult {
  /** One entry per production run whose allocation actually changed; empty when nothing did. */
  updatedRuns: ProductionRunDto[];
  /** For the caller's own single `db.batch()` (D-3) — this function never executes on its own. */
  statements: Statement[];
  confirmationRequired: boolean;
  impact: ReplayImpactDto;
  pendingRunAllocation?: {
    allocatedSessionCost: number;
    totalCost: number;
    outputUnitCostMc: MilliCentavosPerUnit;
    movements: StockMovementInput[];
  };
}

/**
 * Generalizes `computeProjectedOutputWac` (which assumes exactly ONE run's rows are being
 * replaced) to N simultaneously-changed runs that all output to `itemId` — see this section's
 * header. `excludedRunIds` are every production_run id whose STORED kardex rows must be dropped
 * before replaying; `newMovementsByRun` supplies each changed run's post-change movements, of
 * which only the ones actually targeting `itemId` matter (a run's PRODUCTION_OUT lines target
 * consumed items, never its own output, so in practice this is each run's single PRODUCTION_IN
 * row — unless one changed run also happens to consume another's output, in which case that
 * consumption row is correctly excluded here too, being sourced from a run in `excludedRunIds`).
 */
async function computeProjectedItemWacAcrossRuns(
  db: Db,
  itemId: string,
  excludedRunIds: ReadonlySet<string>,
  newMovementsByRun: ReadonlyMap<string, readonly StockMovementInput[]>,
  pendingCreatedAt: string,
): Promise<MilliCentavosPerUnit> {
  const existingRows = await db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
  });

  const projected: ProjectedKardexRow[] = existingRows
    .filter(
      (row) => !(row.sourceEventType === "production_run" && excludedRunIds.has(row.sourceEventId)),
    )
    .map((row) => ({
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      type: row.type,
      qty: row.qty,
      unitCostMc: toMilliCentavosPerUnit(row.unitCostMc),
    }));

  for (const movements of newMovementsByRun.values()) {
    for (const movement of movements) {
      if (movement.itemId !== itemId) continue;
      projected.push({
        occurredAt: movement.occurredAt,
        createdAt: pendingCreatedAt,
        type: movement.type,
        qty: movement.qty,
        unitCostMc: movement.unitCostMc,
      });
    }
  }

  projected.sort(compareKardexRows);
  return replayWacFrom({ onHand: 0, wac: toMilliCentavosPerUnit(0) }, projected).wac;
}

/**
 * UC-14 S-3: recomputes and applies one PRODUCTION session's shared-cost allocation across its
 * live (non-deleted) production runs, in statements meant for the CALLER's single `db.batch()`
 * (D-3) — see this section's header for the full mechanics.
 *
 * `businessDate`/`occurredAt` are the SESSION's own (the caller's `sessionTransactionOccurredAt`-
 * derived instant, mirroring how `core/sessions` dates its own cost-line transactions) — the
 * semantically correct "trigger" moment, since the trigger IS the session close, not any one of
 * its runs. `planCostingReplay` does not currently read either field for anything, but the type
 * requires them and a future use (e.g. surfacing "what closed when" on a replay) should get the
 * honest value, not an arbitrary run's.
 */
export async function planSessionCostAllocation(
  db: Db,
  sessionId: string,
  totalSharedCost: number,
  businessDate: string,
  occurredAt: string,
  actor: AuditActor,
  pendingRun?: PendingProductionRunAllocationInput,
): Promise<SessionCostAllocationResult> {
  const dbRuns = await db.query.productionRuns.findMany({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(t.sessionId, sessionId), isNullOp(t.deletedAt)),
    orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
  });
  const allRuns = pendingRun ? [...dbRuns, pendingRun.run] : dbRuns;

  if (allRuns.length === 0) {
    return {
      updatedRuns: [],
      statements: [],
      confirmationRequired: false,
      impact: {
        affectedSaleLineIds: [],
        affectedStockExitIds: [],
        affectedProductionRunIds: [],
        affectedAssemblyIds: [],
        affectedItemIds: [],
        costDelta: 0,
        requiresConfirmation: false,
      },
    };
  }

  const weights = allRuns.map((r) => r.directCost);
  const allocations = allocateLargestRemainder(toCentavos(totalSharedCost), weights);

  const changed: {
    run: ProductionRunRow;
    newAllocation: number;
    newTotalCost: number;
    isPending: boolean;
  }[] = [];
  for (let i = 0; i < allRuns.length; i++) {
    const run = allRuns[i];
    if (!run) continue;
    const newAllocation = allocations[i] ?? 0;
    const isPending = pendingRun !== undefined && run.id === pendingRun.run.id;
    if (!isPending && newAllocation === run.allocatedSessionCost) continue;
    changed.push({
      run,
      newAllocation,
      newTotalCost: run.directCost + run.indirectCost + newAllocation,
      isPending,
    });
  }

  if (changed.length === 0) {
    return {
      updatedRuns: [],
      statements: [],
      confirmationRequired: false,
      impact: {
        affectedSaleLineIds: [],
        affectedStockExitIds: [],
        affectedProductionRunIds: [],
        affectedAssemblyIds: [],
        affectedItemIds: [],
        costDelta: 0,
        requiresConfirmation: false,
      },
    };
  }

  const changedRunIds = changed.filter((c) => !c.isPending).map((c) => c.run.id);
  const consumptionRows =
    changedRunIds.length > 0
      ? await db.query.productionConsumptions.findMany({
          where: (t, { inArray }) => inArray(t.productionRunId, changedRunIds),
        })
      : [];
  const consumptionsByRun = new Map<string, ProductionConsumptionRow[]>();
  for (const row of consumptionRows) {
    const arr = consumptionsByRun.get(row.productionRunId) ?? [];
    arr.push(row);
    consumptionsByRun.set(row.productionRunId, arr);
  }
  if (pendingRun) {
    consumptionsByRun.set(pendingRun.run.id, [...pendingRun.consumptions]);
  }

  const now = nowIso();
  const changes: PendingMovementChange[] = [];
  const newMovementsByRun = new Map<string, StockMovementInput[]>();
  for (const { run, newTotalCost } of changed) {
    const consumptions = consumptionsByRun.get(run.id) ?? [];
    const outputUnitCostMc = rateFromTotal(
      toCentavos(newTotalCost),
      toMilliUnits(run.actualOutputQty),
    );
    const newMovements = await buildProductionMovementsFromConsumptions(
      db,
      run.id,
      consumptions,
      run.outputItemId,
      run.actualOutputQty,
      outputUnitCostMc,
      run.occurredAt,
      run.businessDate,
    );
    newMovementsByRun.set(run.id, newMovements);
    changes.push({ sourceEventType: "production_run", sourceEventId: run.id, newMovements });
  }

  const plan = await planCostingReplay(db, {
    trigger: {
      eventType: "session",
      eventId: sessionId,
      businessDate,
      occurredAt,
    },
    changes,
    actor,
  });

  const replayOwnedItemIds = new Set(plan.replayedItemIds);
  const touchedOutputItemIds = new Set(changed.map((c) => c.run.outputItemId));
  const changedRunIdSet = new Set(changedRunIds);

  const statements: Statement[] = [];
  const updatedRunRows: ProductionRunRow[] = [];
  let pendingRunAllocationResult: SessionCostAllocationResult["pendingRunAllocation"];

  for (const { run, newAllocation, newTotalCost, isPending } of changed) {
    updatedRunRows.push({
      ...run,
      allocatedSessionCost: newAllocation,
      totalCost: newTotalCost,
      updatedAt: now,
    });

    const newMovements = newMovementsByRun.get(run.id) ?? [];
    if (isPending) {
      pendingRunAllocationResult = {
        allocatedSessionCost: newAllocation,
        totalCost: newTotalCost,
        outputUnitCostMc: rateFromTotal(
          toCentavos(newTotalCost),
          toMilliUnits(run.actualOutputQty),
        ),
        movements: newMovements,
      };
      continue;
    }

    statements.push(
      db
        .update(productionRuns)
        .set({ allocatedSessionCost: newAllocation, totalCost: newTotalCost, updatedAt: now })
        .where(eq(productionRuns.id, run.id)),
    );
    const { statements: moveStatements } = await buildReplaceMovementsForSourceStatements(
      db,
      "production_run",
      run.id,
      newMovements,
    );
    statements.push(...moveStatements);
  }

  for (const itemId of touchedOutputItemIds) {
    if (replayOwnedItemIds.has(itemId)) continue;
    const wacMc = await computeProjectedItemWacAcrossRuns(
      db,
      itemId,
      changedRunIdSet,
      newMovementsByRun,
      now,
    );
    statements.push(db.update(items).set({ wacMc, updatedAt: now }).where(eq(items.id, itemId)));
  }

  // LAST, after the movement-replacement statements — see replay.ts's own ordering note.
  statements.push(...plan.statements);

  return {
    updatedRuns: updatedRunRows.map((row) =>
      toProductionRunDto(row, consumptionsByRun.get(row.id) ?? []),
    ),
    statements,
    confirmationRequired: plan.confirmationRequired,
    impact: plan.impact,
    pendingRunAllocation: pendingRun ? pendingRunAllocationResult : undefined,
  };
}

export async function getProductionRun(db: Db, id: string): Promise<ProductionRunDto> {
  const row = await db.query.productionRuns.findFirst({
    where: (t, { and, eq: eqOp, isNull }) => and(eqOp(t.id, id), isNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la producción.", { id });
  }
  const consumptions = await db.query.productionConsumptions.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.productionRunId, id),
  });
  return toProductionRunDto(row, consumptions);
}

/** Read query for the (later) Production screen's list — mirrors core/purchasing's listPurchases. */
export async function listProductionRuns(
  db: Db,
  filters: ListProductionRunsFilters = {},
): Promise<ListProductionRunsResult> {
  const rows = await db.query.productionRuns.findMany({
    where: (t, { and, eq: eqOp, gte, lte, isNull }) => {
      const conditions = [isNull(t.deletedAt)];
      if (filters.recipeId) conditions.push(eqOp(t.recipeId, filters.recipeId));
      if (filters.outputItemId) conditions.push(eqOp(t.outputItemId, filters.outputItemId));
      if (filters.customOrderId) conditions.push(eqOp(t.customOrderId, filters.customOrderId));
      if (filters.fromDate) conditions.push(gte(t.businessDate, filters.fromDate));
      if (filters.toDate) conditions.push(lte(t.businessDate, filters.toDate));
      return and(...conditions);
    },
    orderBy: (t, { desc }) => [desc(t.businessDate), desc(t.createdAt)],
    limit: filters.limit ?? 200,
  });

  const runIds = rows.map((r) => r.id);
  const consumptionRows =
    runIds.length > 0
      ? await db.query.productionConsumptions.findMany({
          where: (t, { inArray }) => inArray(t.productionRunId, runIds),
        })
      : [];
  const byRun = new Map<string, ProductionConsumptionRow[]>();
  for (const c of consumptionRows) {
    const arr = byRun.get(c.productionRunId) ?? [];
    arr.push(c);
    byRun.set(c.productionRunId, arr);
  }

  return {
    productionRuns: rows.map((row) => toProductionRunDto(row, byRun.get(row.id) ?? [])),
  };
}

/** Placeholder `AuditActor` for the (discarded) `planCostingReplay` audit-row statement a preview's
 * plan would otherwise build — identical precedent to purchasing.ts's `PREVIEW_ACTOR`: this
 * function never reaches `db.batch()`, so no actor is ever attributed to a change. */
const PREVIEW_ACTOR: AuditActor = "SYSTEM";

/**
 * R-5 / ADR-016's dry-run endpoint (Doc 03 §7): "what would this create/edit/delete do to costing?",
 * answered WITHOUT writing anything. Every branch calls the SAME builder the corresponding real
 * mutation calls (`buildProductionRunCreateInputs` / `buildProductionRunUpdateInputs` /
 * `buildProductionRunDeleteInputs`) and the SAME planning step, exactly like purchasing.ts's
 * `previewPurchaseImpact` — never a re-implementation that could silently drift from the real path.
 */
export async function previewProductionRunImpact(
  db: Db,
  request: ProductionRunImpactRequest,
): Promise<ReplayImpactDto> {
  if (request.op === "create") {
    const built = await buildProductionRunCreateInputs(db, request.command);
    const created = await planProductionRunCreateCostingImpact(db, built, PREVIEW_ACTOR);
    return created.impact;
  }

  if (request.op === "update") {
    const { newRow, newMovements } = await buildProductionRunUpdateInputs(
      db,
      request.id,
      request.command,
    );
    const { costingPlan } = await planProductionRunMutationCostingImpact(
      db,
      request.id,
      newRow,
      newMovements,
      PREVIEW_ACTOR,
    );
    return costingPlan.impact;
  }

  // request.op === "delete"
  const { newRow } = await buildProductionRunDeleteInputs(db, request.id);
  const { costingPlan } = await planProductionRunMutationCostingImpact(
    db,
    request.id,
    newRow,
    [],
    PREVIEW_ACTOR,
  );
  return costingPlan.impact;
}
