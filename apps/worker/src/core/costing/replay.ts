// core/costing — the backdated-change WAC replay planner (KOK-024 Phase C).
// Doc 03 §7 R-2/R-4/R-5 + INV-11, ADR-016. This is the module those rules describe.
//
// WHAT PROBLEM THIS SOLVES. C-1's WAC formula is INCREMENTAL: it folds each entry into a running
// average in the order the entries are applied. That is only correct if events are applied in
// chronological order. A Telegram-first capture flow breaks that assumption routinely — recording
// today's production before backdating last week's flour purchase is a normal Tuesday, not an
// exotic correction. When it happens, every kardex entry after the touched point was averaged
// against the wrong prior state, and every sale/exit that consumed the item since then froze a
// cost snapshot that is now wrong.
//
// R-4 says: do NOT go back and rewrite those frozen snapshots — a day already reported must keep
// reporting the same margin. Recompute the WAC forward, and book the aggregate difference as a
// `costing_adjustments` row dated TODAY (adjustments.ts). This module computes both halves.
//
// ONE FUNCTION, TWO CALLERS (deliberate). `planCostingReplay` serves BOTH the dry-run impact
// endpoint (R-5's confirmation preview) and the commit path. There is no second "estimate" variant
// on purpose: a preview that computed its numbers differently from the write it is previewing
// would be a lie with a UI around it. The caller decides what to do with the result — the preview
// endpoint reads `.impact` and throws the statements away; the mutation includes `.statements` in
// its own batch.
//
// ARCHITECTURAL CONSTRAINT (same as movements.ts / audit.ts / adjustments.ts): this module READS
// freely but never executes a write. It returns statements for the triggering command to include
// in ITS OWN single batch (D-3).
//
// STATEMENT ORDERING REQUIREMENT (important for callers): append these statements AFTER the
// `buildReplaceMovementsForSourceStatements` output in the batch. The `item_stock` upsert there
// recomputes `negative_since` incrementally from its own delta; the `negative_since` UPDATE built
// here is the authoritative recomputation and must land last to win. See `buildNegativeSinceFix`.

import type { AuditActor, ReplayImpactDto, StockMovementType } from "@kokoro/shared";
import { nowIso, roundHalfUpToInt } from "@kokoro/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import {
  itemStock,
  items,
  productionConsumptions,
  recipeLines,
  recipes,
  saleLines,
} from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import type { StockMovementInput } from "../inventory/types.js";
import type { CostingAdjustmentTrigger } from "./adjustments.js";
import { buildCostingAdjustmentInsert } from "./adjustments.js";
import type { RecipeEdge } from "./dependency-graph.js";
import { topoOrderAffectedItems } from "./dependency-graph.js";
import { replayWacFrom, replayWacWithTrace } from "./wac.js";

type Statement = BatchItem<"sqlite">;

/**
 * `items.wac` is a REAL cache column (ADR-011), so a replay that is logically a no-op can still
 * land a few ULPs away from the stored value purely from a different summation order. Emitting an
 * UPDATE (and an audit row) for that would be noise, so "the WAC moved" is an epsilon comparison.
 * The unit is centavos per milli-unit, i.e. 1e-9 here is a nanocentavo per gram — many orders of
 * magnitude below anything that can round differently in a real money total.
 */
const WAC_EPSILON = 1e-9;

/**
 * The movements that will exist for one source event AFTER the pending change commits.
 *
 * This is deliberately expressed as the POST-STATE rather than as a diff: it is exactly what the
 * caller is about to hand `buildReplaceMovementsForSourceStatements`, so the planner and the
 * writer can never disagree about what the kardex is going to look like. `newMovements: []` means
 * the event is being deleted (or its lines removed entirely).
 */
export interface PendingMovementChange {
  sourceEventType: string;
  sourceEventId: string;
  /** Movements that will exist for this source AFTER commit. [] means delete. */
  newMovements: StockMovementInput[];
}

export interface CostingReplayPlan {
  /** INV-11 fired: at least one affected item has kardex history after the touched point. */
  required: boolean;
  impact: ReplayImpactDto;
  /** R-5: the impact touches already-recorded sales / exits / production runs. */
  confirmationRequired: boolean;
  /** `items.wac` UPDATEs + `costing_adjustments` INSERTs + `item_stock.negative_since` fixes +
   * one `audit_log` row. Contains ZERO writes to `sale_lines` / `stock_exits` (R-4). */
  statements: Statement[];
}

export interface CostingReplayInput {
  trigger: {
    eventType: CostingAdjustmentTrigger;
    eventId: string;
    businessDate: string;
    occurredAt: string;
  };
  changes: PendingMovementChange[];
  actor: AuditActor;
}

/** A kardex row as this module manipulates it in memory: enough to sort, to replay, and to join
 * back to the frozen snapshot that a SALE_OUT / EXIT_OUT consumed. */
interface ReplayRow {
  occurredAt: string;
  createdAt: string;
  type: StockMovementType;
  qty: number;
  unitCost: number;
  sourceEventType: string;
  sourceEventId: string;
}

/** The kardex sort key. IDENTICAL to repair.ts's `asc(occurredAt), asc(createdAt)` — the two must
 * agree, or the nightly R-2 audit would "repair" the synchronous replay's correct result back to a
 * different number every night. `createdAt` is the tiebreak for movements sharing an instant (two
 * lines of one invoice): insertion order reproduces the order they actually hit the kardex. */
interface KardexPoint {
  occurredAt: string;
  createdAt: string;
}

/** Lexicographic on (occurredAt, createdAt). Both are UTC ISO-8601 from `toISOString()`, a
 * fixed-width format whose lexicographic and chronological orders coincide. */
function comparePoints(a: KardexPoint, b: KardexPoint): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

function emptyImpact(): ReplayImpactDto {
  return {
    affectedSaleLineIds: [],
    affectedStockExitIds: [],
    affectedProductionRunIds: [],
    affectedItemIds: [],
    costDelta: 0,
    requiresConfirmation: false,
  };
}

const NO_REPLAY: CostingReplayPlan = {
  required: false,
  impact: emptyImpact(),
  confirmationRequired: false,
  statements: [],
};

/**
 * Plans the WAC replay a pending create/edit/delete requires (R-2), the cost correction it implies
 * (R-4), and whether the owner must confirm it first (R-5).
 *
 * Returns `required: false` with an empty impact and zero statements for the overwhelmingly common
 * case: an event captured at or after the latest movement of every item it touches. That fast path
 * costs one indexed query per touched item and nothing else — it is on the hot path of every
 * ordinary same-day capture, so it deliberately never loads a kardex, a recipe graph, or a sale
 * line.
 */
export async function planCostingReplay(
  db: Db,
  input: CostingReplayInput,
): Promise<CostingReplayPlan> {
  // ---- 1. Seed item set + touched point per item -------------------------------------------
  // The touched point is the EARLIEST kardex position this change disturbs, taken across the
  // union of the movements being removed and the movements being added. Both matter: deleting a
  // week-old purchase disturbs the kardex from where that purchase WAS, and inserting a week-old
  // purchase disturbs it from where the new row WILL BE.
  const changedSources = new Set<string>();
  const touchedPoints = new Map<string, KardexPoint>();

  const noteTouched = (itemId: string, point: KardexPoint): void => {
    const current = touchedPoints.get(itemId);
    if (current === undefined || comparePoints(point, current) < 0) {
      touchedPoints.set(itemId, point);
    }
  };

  // New movements do not exist yet, so they have no `created_at`. They will be written with
  // `nowIso()` by movements.ts's `buildMovementInsert`, so that is the faithful sort key to plan
  // against — a new row backdated to last week sorts by its `occurred_at` anyway, and only ties
  // against an existing row at the SAME instant resolve by this value (correctly: last).
  const pendingCreatedAt = nowIso();

  for (const change of input.changes) {
    changedSources.add(sourceKey(change.sourceEventType, change.sourceEventId));

    const existing = await db.query.stockMovements.findMany({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(
          eqOp(t.sourceEventType, change.sourceEventType),
          eqOp(t.sourceEventId, change.sourceEventId),
        ),
    });
    for (const row of existing) {
      noteTouched(row.itemId, { occurredAt: row.occurredAt, createdAt: row.createdAt });
    }
    for (const movement of change.newMovements) {
      noteTouched(movement.itemId, {
        occurredAt: movement.occurredAt,
        createdAt: pendingCreatedAt,
      });
    }
  }

  if (touchedPoints.size === 0) {
    return NO_REPLAY;
  }

  // ---- 2. INV-11 test: does anything actually sit after the touched point? ------------------
  const seedItemIds: string[] = [];
  for (const [itemId, touched] of touchedPoints) {
    const latest = await db.query.stockMovements.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
      orderBy: (t, { desc }) => [desc(t.occurredAt), desc(t.createdAt)],
    });
    // No history at all, or the change lands at/after the last movement: C-1's incremental result
    // is already correct for this item and nothing downstream of it can have been mis-costed.
    if (latest === undefined) continue;
    if (comparePoints(touched, { occurredAt: latest.occurredAt, createdAt: latest.createdAt }) >= 0)
      continue;
    seedItemIds.push(itemId);
  }

  if (seedItemIds.length === 0) {
    return NO_REPLAY;
  }

  // ---- 3. Expand across recipe dependencies (raw -> semi-finished -> finished) --------------
  const edges = await loadRecipeEdges(db);
  const orderedItemIds = topoOrderAffectedItems(edges, seedItemIds);

  // ---- 4-7. Replay each item in dependency order -------------------------------------------
  const affectedSaleLineIds: string[] = [];
  const affectedStockExitIds: string[] = [];
  const affectedProductionRunIds = new Set<string>();
  const affectedItemIds: string[] = [];
  /** Float centavos, summed across every corrected consumption and rounded ONCE at the end. */
  let costDeltaRaw = 0;

  const wacBeforeByItem: Record<string, number> = {};
  const wacAfterByItem: Record<string, number> = {};
  const perItemDelta = new Map<
    string,
    { costDelta: number; saleLineIds: string[]; stockExitIds: string[] }
  >();
  const negativeSinceByItem = new Map<string, string | null>();
  const finalWacByItem = new Map<string, number>();

  // C-4 cascade state: for each production run, the REPLAYED cost of each input it consumed.
  // Populated when an ingredient item's kardex is replayed (the consumption shows up there as a
  // PRODUCTION_OUT), and read when the run's OUTPUT item is replayed later in dependency order.
  // That ordering is exactly what `topoOrderAffectedItems` guarantees.
  const replayedConsumptionCost = new Map<string, Map<string, number>>();

  for (const itemId of orderedItemIds) {
    const stored = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemId),
    });
    if (stored === undefined) continue;

    const rows = await loadProjectedKardex(
      db,
      itemId,
      input.changes,
      changedSources,
      pendingCreatedAt,
    );

    // A downstream item reached only through a recipe has no touched point of its own — the
    // change did not touch its kardex directly, its INPUT costs moved. Replaying it from the
    // start is the generically-correct choice (it can only be more thorough, never less) and
    // costs nothing today, since with no recipe data the item set never grows past the seeds.
    const touched = touchedPoints.get(itemId) ?? rows[0];
    const splitIndex =
      touched === undefined
        ? rows.length
        : rows.findIndex((row) => comparePoints(row, touched) >= 0);
    const cut = splitIndex < 0 ? rows.length : splitIndex;

    // Step 4: the seed state is obtained by replaying the untouched PREFIX. There is no stored
    // per-movement WAC to resume from — accepted as an O(n) prefix cost rather than a cache
    // column, which would be a third place for the WAC to be wrong.
    const seed = replayWacFrom({ onHand: 0, wac: 0 }, rows.slice(0, cut));

    // Step 7: correct the output cost of any production run whose inputs this replay moved,
    // BEFORE replaying, so C-1 folds the corrected cost in rather than the stale stored one.
    const suffix = await applyProductionCostCorrections(
      db,
      rows.slice(cut),
      replayedConsumptionCost,
      affectedProductionRunIds,
    );

    const { final, steps } = replayWacWithTrace(seed, suffix);

    // Step 5: every exit/sale in the suffix consumed at a frozen snapshot that the replay now
    // disagrees with. Read those snapshots; NEVER write them (R-4).
    const itemSaleLineIds: string[] = [];
    const itemStockExitIds: string[] = [];
    let itemDeltaRaw = 0;

    for (let i = 0; i < suffix.length; i += 1) {
      const movement = suffix[i];
      const step = steps[i];
      if (movement === undefined || step === undefined) continue;

      if (movement.type === "PRODUCTION_OUT" && movement.sourceEventType === "production_run") {
        // This consumption feeds a run whose output item is replayed later (dependency order).
        const perRun =
          replayedConsumptionCost.get(movement.sourceEventId) ?? new Map<string, number>();
        perRun.set(itemId, Math.abs(movement.qty) * step.wacBefore);
        replayedConsumptionCost.set(movement.sourceEventId, perRun);
        affectedProductionRunIds.add(movement.sourceEventId);
        continue;
      }

      if (movement.type !== "SALE_OUT" && movement.type !== "EXIT_OUT") continue;

      const frozen = await readFrozenSnapshot(db, movement, itemId);
      if (frozen === null) continue;

      if (frozen.kind === "sale_line") itemSaleLineIds.push(frozen.id);
      else itemStockExitIds.push(frozen.id);

      // Step 6: Σ (frozen − replayed) × |qty|, accumulated as a float and rounded half-up ONCE at
      // the aggregate (INV-6) — rounding per line would let dozens of sub-centavo residuals
      // compound into a visible drift. `unitCost` is centavos per milli-unit and `qty` is
      // milli-units, so the product is already centavos; no unit conversion.
      itemDeltaRaw += (frozen.unitCostSnapshot - step.wacBefore) * Math.abs(movement.qty);
    }

    const itemDelta = roundHalfUpToInt(itemDeltaRaw);
    costDeltaRaw += itemDeltaRaw;

    const wacMoved = Math.abs(final.wac - stored.wac) > WAC_EPSILON;
    if (wacMoved) {
      affectedItemIds.push(itemId);
      wacBeforeByItem[itemId] = stored.wac;
      wacAfterByItem[itemId] = final.wac;
      finalWacByItem.set(itemId, final.wac);
    }

    affectedSaleLineIds.push(...itemSaleLineIds);
    affectedStockExitIds.push(...itemStockExitIds);
    if (itemDelta !== 0) {
      perItemDelta.set(itemId, {
        costDelta: itemDelta,
        saleLineIds: itemSaleLineIds,
        stockExitIds: itemStockExitIds,
      });
    }

    // Step 9: `negative_since` is set INCREMENTALLY at write time (movements.ts), so it records
    // when the balance crossed zero in the order events were RECORDED. Reordering the kardex can
    // move — or erase — that crossing, so it is recomputed here from the projected history.
    negativeSinceByItem.set(itemId, computeNegativeSince(rows));
  }

  // ---- 8/11. Assemble statements and the impact --------------------------------------------
  const costDelta = roundHalfUpToInt(costDeltaRaw);

  // R-5: a WAC that merely moved, with no frozen consumer downstream of it, is a silent internal
  // correction with no reported number to contradict — nothing for the owner to confirm. What
  // needs her explicit acknowledgement is a correction that changes cost already booked against
  // a sale, an exit, or a production run.
  const confirmationRequired =
    affectedSaleLineIds.length > 0 ||
    affectedStockExitIds.length > 0 ||
    affectedProductionRunIds.size > 0;

  const impact: ReplayImpactDto = {
    affectedSaleLineIds,
    affectedStockExitIds,
    affectedProductionRunIds: [...affectedProductionRunIds],
    affectedItemIds,
    costDelta,
    requiresConfirmation: confirmationRequired,
  };

  const now = nowIso();
  const statements: Statement[] = [];

  for (const [itemId, wac] of finalWacByItem) {
    statements.push(db.update(items).set({ wac, updatedAt: now }).where(eq(items.id, itemId)));
  }

  for (const [itemId, entry] of perItemDelta) {
    statements.push(
      buildCostingAdjustmentInsert(db, {
        itemId,
        triggerEventType: input.trigger.eventType,
        triggerEventId: input.trigger.eventId,
        affectedSaleLineIds: entry.saleLineIds,
        affectedStockExitIds: entry.stockExitIds,
        costDelta: entry.costDelta,
      }),
    );
  }

  statements.push(...(await buildNegativeSinceFixes(db, negativeSinceByItem, now)));

  // Step 10 (deliberate omission): `item_stock.qty_on_hand` is NOT rebuilt here. Reordering
  // movements permutes the kardex but never changes Σ qty, so the on-hand total is invariant
  // under a replay; and the qty that the pending change itself adds or removes is already netted
  // by `buildReplaceMovementsForSourceStatements`. Recomputing it here would either duplicate
  // that delta or race it, depending on statement order — the flag above is recomputed precisely
  // BECAUSE it is order-dependent in a way the total is not.

  if (statements.length > 0) {
    statements.push(
      buildAuditLogInsert(db, {
        actor: input.actor,
        action: "costing_replay",
        entityType: input.trigger.eventType,
        entityId: input.trigger.eventId,
        before: { wac: wacBeforeByItem },
        after: { wac: wacAfterByItem, costDelta },
      }),
    );
  }

  return { required: true, impact, confirmationRequired, statements };
}

function sourceKey(sourceEventType: string, sourceEventId: string): string {
  // U+0000 cannot occur in either field, so it is an unambiguous separator (same reasoning as
  // dependency-graph.ts's edge dedupe key).
  return `${sourceEventType}\u0000${sourceEventId}`;
}

/**
 * Loads item `itemId`'s kardex AS IT WILL BE after the pending change commits: the stored rows,
 * minus every row belonging to a source the change replaces, plus the change's new movements for
 * this item, re-sorted into kardex order.
 *
 * Projecting in memory (rather than writing then replaying) is what lets ONE function serve both
 * the dry-run preview and the commit path — the preview must see the post-state without ever
 * touching the database.
 */
async function loadProjectedKardex(
  db: Db,
  itemId: string,
  changes: readonly PendingMovementChange[],
  changedSources: ReadonlySet<string>,
  pendingCreatedAt: string,
): Promise<ReplayRow[]> {
  const stored = await db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
  });

  const rows: ReplayRow[] = stored
    .filter((row) => !changedSources.has(sourceKey(row.sourceEventType, row.sourceEventId)))
    .map((row) => ({
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      type: row.type,
      qty: row.qty,
      unitCost: row.unitCost,
      sourceEventType: row.sourceEventType,
      sourceEventId: row.sourceEventId,
    }));

  for (const change of changes) {
    for (const movement of change.newMovements) {
      if (movement.itemId !== itemId) continue;
      rows.push({
        occurredAt: movement.occurredAt,
        createdAt: pendingCreatedAt,
        type: movement.type,
        qty: movement.qty,
        unitCost: movement.unitCost,
        sourceEventType: movement.sourceEventType,
        sourceEventId: movement.sourceEventId,
      });
    }
  }

  rows.sort(comparePoints);
  return rows;
}

/**
 * Recipe edges (ingredient -> output) for the dependency ordering, one row per recipe line.
 *
 * Scoped to ACTIVE recipes. The trade-off, stated explicitly because the KB does not rule on it:
 * an inactive recipe whose past runs still cascade cost will not widen the replay set, so that
 * item's WAC stays slightly stale until the nightly R-2 consistency job (INV-5) — which ADR-016
 * keeps precisely as the backstop for what the synchronous path misses. Including inactive
 * recipes instead would risk a stale/cyclic retired recipe throwing `topoOrderAffectedItems`'
 * CONFLICT and BLOCKING an otherwise valid edit, which is the worse failure for the owner.
 */
async function loadRecipeEdges(db: Db): Promise<RecipeEdge[]> {
  return db
    .select({ ingredientItemId: recipeLines.itemId, outputItemId: recipes.outputItemId })
    .from(recipeLines)
    .innerJoin(recipes, eq(recipeLines.recipeId, recipes.id))
    .where(eq(recipes.isActive, 1));
}

/**
 * C-4 cascade (step 7). For every PRODUCTION_IN in this item's replay suffix, recomputes the
 * source run's cost from its inputs' REPLAYED WAC and substitutes the corrected output unit cost,
 * so the C-1 fold below uses the corrected number:
 *   `direct = Σ(consumed qty × consumed item's WAC)`,
 *   `total  = direct + indirect_cost + allocated session cost`,
 *   `output unit cost = total / actual_output_qty`.
 *
 * Inputs the replay moved come from `replayedConsumptionCost` (populated when the INGREDIENT item
 * was replayed earlier in dependency order); inputs the replay did not touch keep their stored
 * `production_consumptions.unit_cost_snapshot`, which is still correct for them.
 *
 * SCOPE NOTE (KOK-026): `production_runs` / `production_consumptions` exist in schema.ts, so this
 * is wired end-to-end rather than stubbed — but nothing writes production data yet, so the branch
 * is unreachable in practice today and is guarded to no-op on missing rows. KOK-026 supplies the
 * data; it should not need to revisit this control flow.
 */
async function applyProductionCostCorrections(
  db: Db,
  suffix: readonly ReplayRow[],
  replayedConsumptionCost: ReadonlyMap<string, Map<string, number>>,
  affectedProductionRunIds: Set<string>,
): Promise<ReplayRow[]> {
  const runIds = [
    ...new Set(
      suffix
        .filter((row) => row.type === "PRODUCTION_IN" && row.sourceEventType === "production_run")
        .map((row) => row.sourceEventId),
    ),
  ].filter((runId) => replayedConsumptionCost.has(runId));

  if (runIds.length === 0) return [...suffix];

  const runs = await db.query.productionRuns.findMany({
    where: (t, { inArray: inArrayOp }) => inArrayOp(t.id, runIds),
  });
  const consumptions = await db
    .select()
    .from(productionConsumptions)
    .where(inArray(productionConsumptions.productionRunId, runIds));

  const correctedUnitCost = new Map<string, number>();
  for (const run of runs) {
    if (run.actualOutputQty <= 0) continue;
    const replayed = replayedConsumptionCost.get(run.id);
    let direct = 0;
    for (const consumption of consumptions) {
      if (consumption.productionRunId !== run.id) continue;
      direct += replayed?.get(consumption.itemId) ?? consumption.qty * consumption.unitCostSnapshot;
    }
    const total = direct + run.indirectCost + run.allocatedSessionCost;
    correctedUnitCost.set(run.id, total / run.actualOutputQty);
    affectedProductionRunIds.add(run.id);
  }

  return suffix.map((row) => {
    if (row.type !== "PRODUCTION_IN" || row.sourceEventType !== "production_run") return row;
    const corrected = correctedUnitCost.get(row.sourceEventId);
    if (corrected === undefined) return row;
    return { ...row, unitCost: corrected };
  });
}

type FrozenSnapshot =
  | { kind: "sale_line"; id: string; unitCostSnapshot: number }
  | { kind: "stock_exit"; id: string; unitCostSnapshot: number };

/**
 * READ-ONLY (R-4) join from an exit movement back to the row that froze its cost snapshot.
 *
 * `stock_movements` carries no line-level foreign key (INV-9 keeps the kardex source reference
 * deliberately loose), so a SALE_OUT resolves by `(sale_id, item_id)` — a sale has at most one
 * line per item, so that pair identifies the line. Returns null rather than throwing when the row
 * is missing: a movement whose source event was hard-deleted by some earlier data repair should
 * not make an unrelated edit unsaveable, and it contributes nothing to `cost_delta` anyway.
 */
async function readFrozenSnapshot(
  db: Db,
  movement: ReplayRow,
  itemId: string,
): Promise<FrozenSnapshot | null> {
  if (movement.type === "SALE_OUT") {
    const line = await db
      .select({ id: saleLines.id, unitCostSnapshot: saleLines.unitCostSnapshot })
      .from(saleLines)
      .where(and(eq(saleLines.saleId, movement.sourceEventId), eq(saleLines.itemId, itemId)))
      .limit(1);
    const row = line[0];
    return row === undefined
      ? null
      : { kind: "sale_line", id: row.id, unitCostSnapshot: row.unitCostSnapshot };
  }

  const exit = await db.query.stockExits.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, movement.sourceEventId),
  });
  return exit === undefined
    ? null
    : { kind: "stock_exit", id: exit.id, unitCostSnapshot: exit.unitCostSnapshot };
}

/**
 * INV-8's flag, recomputed from the projected kardex: the instant the balance entered the negative
 * streak it is STILL in at the end of history, or null if it ends non-negative.
 *
 * Note the deliberate difference from the incremental writer (movements.ts), which stamps the
 * WRITE instant because at write time that is the only moment it knows. A recomputation has the
 * whole history in hand and can name the movement that actually took the balance negative, which
 * is the more honest value for the "negative since ..." alert the owner sees.
 */
function computeNegativeSince(rows: readonly ReplayRow[]): string | null {
  let onHand = 0;
  let streakStart: string | null = null;
  for (const row of rows) {
    const before = onHand;
    onHand += row.qty;
    if (onHand < 0 && before >= 0) streakStart = row.occurredAt;
    else if (onHand >= 0) streakStart = null;
  }
  return onHand < 0 ? streakStart : null;
}

/** One `item_stock` UPDATE per item whose recomputed `negative_since` disagrees with the stored
 * one. Touches only that column (plus `updated_at`) — never `qty_on_hand`, see step 10. */
async function buildNegativeSinceFixes(
  db: Db,
  negativeSinceByItem: ReadonlyMap<string, string | null>,
  now: string,
): Promise<Statement[]> {
  const itemIds = [...negativeSinceByItem.keys()];
  if (itemIds.length === 0) return [];

  const stored = await db.select().from(itemStock).where(inArray(itemStock.itemId, itemIds));
  const storedById = new Map(stored.map((row) => [row.itemId, row.negativeSince]));

  const statements: Statement[] = [];
  for (const [itemId, negativeSince] of negativeSinceByItem) {
    if (!storedById.has(itemId)) continue;
    if (storedById.get(itemId) === negativeSince) continue;
    statements.push(
      db
        .update(itemStock)
        .set({ negativeSince, updatedAt: now })
        .where(eq(itemStock.itemId, itemId)),
    );
  }
  return statements;
}
