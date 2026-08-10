// core/costing ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â C-3 replacement-cost refresh planner for SEMI_FINISHED/FINISHED items (KOK-029,
// Doc 03 Ãƒâ€šÃ‚Â§4, Doc 02 Ãƒâ€šÃ‚Â§4.4). `planReplacementCostRefresh` is "build, don't execute" (D-2, mirrors
// core/jobs.ts and core/purchasing's preview/mutation split): it only READS and returns
// statements, never calling `db.batch()` itself. Two callers share it so they can never compute a
// different answer ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
//   - jobs/replacement-cost-refresh.ts, the nightly Cron Trigger job (Doc 02 Ãƒâ€šÃ‚Â§4.4): batches the
//     plan's statements together with its own `job_runs` row itself (daily-snapshot.ts's
//     precedent for why that needs to stay one job-owned batch)
//   - api/costing.ts, the on-demand recompute endpoint: calls this file's OTHER export,
//     `applyReplacementCostRefresh`, which plans AND executes ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â routes never call `db.batch()`
//     directly (D-2), so the execution step lives here instead of in the route.
//
// DEPENDENCY ORDER (a KB gap this task closes ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â flagged per CLAUDE.md "put doubt in the PR
// description" since Doc 03 Ãƒâ€šÃ‚Â§4 states the per-item formula but not the iteration order for nested
// BOMs). C-3 recomputes an item from its DEFAULT recipe's ingredients' CURRENT replacement_cost,
// and an ingredient can itself be a SEMI_FINISHED item being refreshed in this very run (a
// multi-level BOM: raw material -> semi-finished -> finished). Visiting items in dependency order ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
// every ingredient refreshed before anything made FROM it ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â lets a nested chain settle fully
// within one run instead of needing a second night to propagate. This reuses
// `topoOrderAffectedItems` (core/costing/dependency-graph.ts), the exact ordering primitive
// KOK-024 built for this same "cost flows through nested BOMs" problem on the WAC-replay side ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
// judgment call: reuse the already-tested primitive rather than hand-roll a second topological
// sort, so the two correction paths can never disagree on what "dependency order" means.

import { type MilliCentavosPerUnit, nowIso, toMilliCentavosPerUnit } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../../db/index.js";
import { items } from "../../db/schema.js";
import type { RecipeEdge } from "./dependency-graph.js";
import { topoOrderAffectedItems } from "./dependency-graph.js";

import {
  computeEffectiveReplacementCost,
  computeItemReplacementCost,
  type ReplacementCostLine,
} from "./replacement-cost.js";

type Statement = BatchItem<"sqlite">;

export interface ReplacementCostRefreshPlan {
  /** One `items` UPDATE per refreshed item ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â empty when nothing had a computable default recipe. */
  statements: Statement[];
  /** Items whose `replacement_cost` this plan recomputed, in the order they were computed
   * (dependency order ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ingredients before what's made from them). */
  refreshedItemIds: string[];
  /** Active SEMI_FINISHED/FINISHED items with NO active default recipe ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â C-3's formula has no
   * candidate to name for them, so they are left untouched rather than silently guessed at. */
  skippedItemIds: string[];
  /** The single instant stamped onto every refreshed item's `replacement_cost_updated_at` in
   * `statements` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â returned so a caller (jobs/, api/) can report the exact value it wrote instead
   * of taking a second, slightly-later `nowIso()` reading of its own. */
  refreshedAt: string;
}

interface DefaultRecipeInfo {
  expectedYieldQty: number;
  lines: readonly { itemId: string; qty: number }[];
}

/**
 * Plans (does not execute) the C-3 replacement-cost refresh for every active SEMI_FINISHED/
 * FINISHED item that has an active default recipe. See this module's header for the dependency-
 * order reasoning and the two call sites that share this planner.
 */
export async function planReplacementCostRefresh(db: Db): Promise<ReplacementCostRefreshPlan> {
  // Every item, regardless of kind/active status: an ingredient cost must be resolvable even when
  // the ingredient itself is RAW_MATERIAL (never refreshed here, C-3's other branch owns it,
  // core/purchasing/index.ts) or a deactivated item a recipe still references (Doc 04 Ãƒâ€šÃ‚Â§3.1 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â items
  // are soft-toggled, never deleted, so an old recipe line's FK always resolves).
  const allItemRows = await db.query.items.findMany();

  const defaultRecipeRows = await db.query.recipes.findMany({
    where: (t, { and: andOp, eq: eqOp }) => andOp(eqOp(t.isDefault, 1), eqOp(t.isActive, 1)),
  });
  const recipeIds = defaultRecipeRows.map((r) => r.id);
  const lineRows =
    recipeIds.length > 0
      ? await db.query.recipeLines.findMany({
          where: (t, { inArray: inArrayOp }) => inArrayOp(t.recipeId, recipeIds),
        })
      : [];
  const linesByRecipeId = new Map<string, { itemId: string; qty: number }[]>();
  for (const line of lineRows) {
    const arr = linesByRecipeId.get(line.recipeId) ?? [];
    arr.push({ itemId: line.itemId, qty: line.qty });
    linesByRecipeId.set(line.recipeId, arr);
  }

  // Recipes.uxDefault (db/schema.ts) is a partial unique index on (outputItemId) WHERE
  // isDefault=1 AND isActive=1 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â at most one row per output item, so this map is safely 1:1.
  const recipeByOutputItemId = new Map<string, DefaultRecipeInfo>();
  for (const recipe of defaultRecipeRows) {
    recipeByOutputItemId.set(recipe.outputItemId, {
      expectedYieldQty: recipe.expectedYieldQty,
      lines: linesByRecipeId.get(recipe.id) ?? [],
    });
  }

  // Edges point ingredient -> output (the direction cost flows), built ONLY from default-recipe
  // lines ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â so every edge target necessarily has an entry in recipeByOutputItemId (it is that very
  // recipe's own output), which is what makes the `recipe` lookup below unreachable-but-defensive
  // rather than a real gap.
  const edges: RecipeEdge[] = [];
  for (const [outputItemId, recipe] of recipeByOutputItemId) {
    for (const line of recipe.lines) {
      edges.push({ ingredientItemId: line.itemId, outputItemId });
    }
  }

  const seedItemIds: string[] = [];
  const skippedItemIds: string[] = [];
  for (const item of allItemRows) {
    if (item.isActive !== 1) continue;
    if (item.kind !== "SEMI_FINISHED" && item.kind !== "FINISHED") continue;
    if (recipeByOutputItemId.has(item.id)) {
      seedItemIds.push(item.id);
    } else {
      skippedItemIds.push(item.id);
    }
  }

  const order = topoOrderAffectedItems(edges, seedItemIds);

  const liveCost = new Map<string, MilliCentavosPerUnit>(
    allItemRows.map((row) => [
      row.id,
      computeEffectiveReplacementCost(
        toMilliCentavosPerUnit(row.replacementCostMc),
        row.replacementCostUpdatedAt,
        toMilliCentavosPerUnit(row.wacMc),
      ),
    ]),
  );
  const statements: Statement[] = [];
  const refreshedItemIds: string[] = [];
  const now = nowIso();

  for (const itemId of order) {
    const recipe = recipeByOutputItemId.get(itemId);
    if (!recipe) {
      // Unreachable: `order` is seeds plus everything reachable via edges, and every edge target
      // is by construction a key of recipeByOutputItemId (see the loop that builds `edges` above).
      continue;
    }

    const lines: ReplacementCostLine[] = recipe.lines.map((line) => ({
      qty: line.qty,
      unitCost: liveCost.get(line.itemId) ?? toMilliCentavosPerUnit(0),
    }));
    const newReplacementCost = computeItemReplacementCost(lines, recipe.expectedYieldQty);
    liveCost.set(itemId, newReplacementCost);
    refreshedItemIds.push(itemId);

    statements.push(
      db
        .update(items)
        .set({
          replacementCostMc: newReplacementCost,
          replacementCostUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(items.id, itemId)),
    );
  }

  return { statements, refreshedItemIds, skippedItemIds, refreshedAt: now };
}

/**
 * Plans AND executes the refresh in one atomic `db.batch()` (D-2/D-3): the on-demand endpoint's
 * own function, since api/ routes never call `db.batch()` directly ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â every other route delegates
 * that call to a `core/` function (e.g. `core/catalog/items.ts`'s `createItem`), and this mirrors
 * that same convention rather than being the one route file that batches statements itself.
 * jobs/replacement-cost-refresh.ts does NOT use this: it needs its own `job_runs` row inside the
 * SAME batch as the item updates (daily-snapshot.ts's precedent), which this function's fixed
 * statement list doesn't leave room for.
 */
export async function applyReplacementCostRefresh(db: Db): Promise<ReplacementCostRefreshPlan> {
  const plan = await planReplacementCostRefresh(db);
  if (plan.statements.length > 0) {
    await db.batch(plan.statements as [Statement, ...Statement[]]);
  }
  return plan;
}
