# Block B grounding report — Presentation/Combo model

Scope: backlog KOK-121…KOK-129 and KOK-150. This is a read-only grounding artifact; it proposes no implementation and changes no product code or KB rule. Backlog source: `docs/system-design-knowledge-base/10-implementation-backlog.md:223-232`.

## Executive findings

1. The closest complete event precedent for KOK-124 is ProductionRun: one shared command contract, one core service owning validation/costing/replay/atomic batches, thin API routes, query/mutation hooks, and route/form/table/detail UI. There is no implemented production assistant tool yet. (`packages/shared/src/production-runs.ts:1-24`; `apps/worker/src/core/production/index.ts:1-26`; `apps/worker/src/api/production-runs.ts:1-30`; `apps/web/src/features/production-runs/api.ts:1-13`; `apps/web/src/routes/production.tsx:1-18`; `apps/worker/src/assistant/README.md:1-7`)
2. KOK-150 is correctly a prerequisite: replay currently has production-specific state, movement/source tests, table reads, and the `direct + indirectCost + allocatedSessionCost` formula embedded directly in `applyProductionCostCorrections`; assembly cannot reuse it unchanged because C-10 expressly forbids allocated session cost. (`apps/worker/src/core/costing/replay.ts:298-343`; `apps/worker/src/core/costing/replay.ts:555-626`; `docs/system-design-knowledge-base/03-domain-model.md:217-241`)
3. The dependency-graph half of KOK-125 really is small: `topoOrderAffectedItems(edges, seedItemIds)` is source-agnostic and `loadRecipeEdges` has one call site. Adding a second edge query/source is plausibly about three lines, but the cost cascade and frozen-consumer handling are not. (`apps/worker/src/core/costing/dependency-graph.ts:24-35`; `apps/worker/src/core/costing/dependency-graph.ts:58-61`; `apps/worker/src/core/costing/replay.ts:272-275`; `apps/worker/src/core/costing/replay.ts:536-552`)
4. The KB is already amended for Block B even though the backlog rows remain “To Do”: Doc 03 already defines AssemblyDefinition/Assembly, C-3d/C-10, extended R-2, and UC-21/22; Doc 04 already shows assembly tables/movement values and FINISHED-only sale lines. Live Drizzle schema, enums, and migrations still lack those changes. (`docs/system-design-knowledge-base/03-domain-model.md:47-55`; `docs/system-design-knowledge-base/03-domain-model.md:133-149`; `docs/system-design-knowledge-base/03-domain-model.md:217-246`; `docs/system-design-knowledge-base/03-domain-model.md:398-409`; `docs/system-design-knowledge-base/03-domain-model.md:458-463`; `docs/system-design-knowledge-base/04-data-model.md:284-290`; `docs/system-design-knowledge-base/04-data-model.md:315-328`; `docs/system-design-knowledge-base/04-data-model.md:405-425`; `packages/shared/src/enums.ts:87-98`; `apps/worker/src/db/schema.ts:474-501`)

## 1. Precedent vertical: recipes + production runs

### File/layer map

| Layer | File | Responsibility |
| --- | --- | --- |
| Shared production contract | `packages/shared/src/production-runs.ts` | Defines validated line/create/update/delete/impact/list schemas and the DTO/result shapes. Create accepts recipe, session/order links, batches, actual output, indirect cost, dates, actual lines, and replay confirmation; update aliases the full create shape. (`packages/shared/src/production-runs.ts:30-95`; `packages/shared/src/production-runs.ts:97-146`; `packages/shared/src/production-runs.ts:148-216`) |
| Drizzle persistence | `apps/worker/src/db/schema.ts` | Defines `production_runs` plus `production_consumptions`; the event stores actual output/cost totals/soft-delete timestamps while child rows freeze each consumed item’s unit cost. (`apps/worker/src/db/schema.ts:224-274`) |
| Core event service | `apps/worker/src/core/production/index.ts` | Owns defensive kind validation, frozen input costing, C-4 arithmetic, OUT/IN movement construction, output WAC, replay planning/confirmation, atomic writes, audit, update/delete/restore, reads, impact preview, and session allocation planning. (`apps/worker/src/core/production/index.ts:1-59`; `apps/worker/src/core/production/index.ts:152-197`; `apps/worker/src/core/production/index.ts:200-284`; `apps/worker/src/core/production/index.ts:294-470`; `apps/worker/src/core/production/index.ts:910-1050`; `apps/worker/src/core/production/index.ts:1154-1280`; `apps/worker/src/core/production/index.ts:1291-1405`) |
| Worker API | `apps/worker/src/api/production-runs.ts` | Parses the shared schemas and delegates list/create/get/update/delete/restore/impact to core; routes never write directly. (`apps/worker/src/api/production-runs.ts:1-24`; `apps/worker/src/api/production-runs.ts:33-71`) |
| Web transport/cache | `apps/web/src/features/production-runs/api.ts` | Supplies TanStack list/detail queries and create/update/delete/restore/impact mutations with root-key invalidation; replay-confirm orchestration is intentionally composed in UI. (`apps/web/src/features/production-runs/api.ts:1-13`; `apps/web/src/features/production-runs/api.ts:32-121`) |
| Web route composition | `apps/web/src/routes/production.tsx` | Fetches runs and active recipes, owns form/drawer selection state, and composes header actions, table, create form, and detail drawer. (`apps/web/src/routes/production.tsx:1-28`; `apps/web/src/routes/production.tsx:30-64`) |
| Web form | `apps/web/src/components/production/ProductionRunForm.tsx` | Implements create/edit form state, active-recipe selection, recipe×batches prefill, dirty-preserving recompute, actual output/consumption editing, previews, validation, and replay-confirmable edit submission. (`apps/web/src/components/production/ProductionRunForm.tsx:1-3`; `apps/web/src/components/production/ProductionRunForm.tsx:44-57`; `apps/web/src/components/production/ProductionRunForm.tsx:131-162`; `apps/web/src/components/production/ProductionRunForm.tsx:224-280`; `apps/web/src/components/production/ProductionRunForm.tsx:304-351`; `apps/web/src/components/production/ProductionRunForm.tsx:609-690`) |
| Web detail | `apps/web/src/components/production/ProductionRunDetailDrawer.tsx` | Reads the detail, renders its cost/yield/lines, opens edit mode, and handles soft-delete/undo with R-5 impact confirmation. (`apps/web/src/components/production/ProductionRunDetailDrawer.tsx:1-4`; `apps/web/src/components/production/ProductionRunDetailDrawer.tsx:50-70`; `apps/web/src/components/production/ProductionRunDetailDrawer.tsx:270-300`) |
| Web table | `apps/web/src/components/production/ProductionRunsTable.tsx` | Read-only list projection for date, recipe, batches, actual-vs-expected yield, total/unit cost, session and order, with row click into detail. (`apps/web/src/components/production/ProductionRunsTable.tsx:1-2`; `apps/web/src/components/production/ProductionRunsTable.tsx:23-50`; `apps/web/src/components/production/ProductionRunsTable.tsx:80-119`) |
| Spanish labels | `apps/web/src/lib/i18n-production.ts` | Centralizes production UI strings under the project’s Spanish-string convention. (`apps/web/src/lib/i18n-production.ts:1-116`) |
| Assistant | `apps/worker/src/assistant/README.md` only | No production assistant implementation exists: the directory contains only the README, and the production API explicitly says there is no Telegram/AI actor writing runs yet. (`apps/worker/src/assistant/README.md:1-7`; `apps/worker/src/api/production-runs.ts:28-31`) |

### Behavior KOK-124 should mirror

Production freezes actual component costs, emits one negative movement per metered consumption plus one positive output movement, computes output cost from actual output, applies C-1 only to the output, creates no financial transaction, and commits event rows, movements, output WAC, audit, and replay statements in one batch. (`apps/worker/src/core/production/index.ts:21-40`; `apps/worker/src/core/production/index.ts:236-284`; `apps/worker/src/core/production/index.ts:316-400`; `apps/worker/src/core/production/index.ts:438-469`) KOK-124 should mirror that structure but use C-10 (`direct / actual_output_qty`) with no indirect or allocated session-cost terms. (`docs/system-design-knowledge-base/03-domain-model.md:217-241`)

## 2. Costing/replay hard-coded discriminators

### Exact bare comparisons in `replay.ts`

- Consumption handoff is production-only: `movement.type === "PRODUCTION_OUT" && movement.sourceEventType === "production_run"`. (`apps/worker/src/core/costing/replay.ts:353-365`)
- Frozen cost-delta consumers are limited to `SALE_OUT` and `EXIT_OUT`: `movement.type !== "SALE_OUT" && movement.type !== "EXIT_OUT"`. An `ASSEMBLY_OUT` would currently skip this entire path silently. (`apps/worker/src/core/costing/replay.ts:368-381`)
- Production correction discovery filters `row.type === "PRODUCTION_IN" && row.sourceEventType === "production_run"`. (`apps/worker/src/core/costing/replay.ts:571-585`)
- Production correction replacement repeats the inverse test: `row.type !== "PRODUCTION_IN" || row.sourceEventType !== "production_run"`. (`apps/worker/src/core/costing/replay.ts:621-626`)
- Frozen snapshot routing branches only on `movement.type === "SALE_OUT"`; every other admitted consumer falls through to `stockExits`. (`apps/worker/src/core/costing/replay.ts:629-672`)

### Production-specific cascade internals KOK-150 must parameterize

- `replayedConsumptionCost` is keyed only by production run id and populated only from `PRODUCTION_OUT`/`production_run`. (`apps/worker/src/core/costing/replay.ts:298-303`; `apps/worker/src/core/costing/replay.ts:358-364`)
- `applyProductionCostCorrections` queries concrete `productionRuns` and `productionConsumptions` tables. (`apps/worker/src/core/costing/replay.ts:571-593`)
- Its formula is hard-coded to `direct + run.indirectCost + run.allocatedSessionCost`, then divides by `run.actualOutputQty`; assembly must instead be direct-only under C-10. (`apps/worker/src/core/costing/replay.ts:595-618`; `docs/system-design-knowledge-base/03-domain-model.md:217-241`)

### Other exhaustive movement-type enumeration sites

- Canonical shared tuple/type/schema: `STOCK_MOVEMENT_TYPES`. (`packages/shared/src/enums.ts:87-98`)
- Exact-list regression test. (`packages/shared/src/enums.test.ts:32-42`)
- Drizzle column enum and independent SQL `check()` list. (`apps/worker/src/db/schema.ts:474-501`)
- Direction exhaustiveness map: `MOVEMENT_DIRECTION`. (`apps/worker/src/core/inventory/movements.ts:27-43`)
- WAC-entry set: `WAC_ENTRY_TYPES`, currently OPENING/PURCHASE/PRODUCTION IN. (`apps/worker/src/core/costing/wac.ts:152-158`)
- Web movement labels. (`apps/web/src/lib/i18n-inventory.ts:49-58`)
- Hand-written test union in costing repair. (`apps/worker/test/costing-repair.test.ts:39-46`)
- Migration CHECK lists also embed the values, most recently migration 0011. (`apps/worker/migrations/0011_opening_in_movement_type.sql:11-24`)

The compiler protects the `Record<StockMovementType,...>` direction/label maps once the shared union changes, but not SQL checks, exact-list tests, the WAC set, replay string comparisons, or the hand-written test union. (`apps/worker/src/core/inventory/movements.ts:35-43`; `apps/web/src/lib/i18n-inventory.ts:49-58`; `packages/shared/src/enums.test.ts:32-42`; `apps/worker/src/core/costing/wac.ts:152-158`; `apps/worker/src/core/costing/replay.ts:358-368`; `apps/worker/test/costing-repair.test.ts:39-46`)

## 3. Migration precedents

### `0011_opening_in_movement_type.sql` exact pattern

1. Comment explains SQLite CHECK recreation and dependent-view ordering. (`apps/worker/migrations/0011_opening_in_movement_type.sql:1-4`)
2. `PRAGMA foreign_keys=OFF`. (`apps/worker/migrations/0011_opening_in_movement_type.sql:5`)
3. Drop five views in this order: `v_stock`, `v_kardex`, `v_price_health`, `v_waste`, `v_session_hours`. (`apps/worker/migrations/0011_opening_in_movement_type.sql:6-10`)
4. Create `__new_stock_movements` with all 11 columns, item FK, and the expanded named CHECK. (`apps/worker/migrations/0011_opening_in_movement_type.sql:11-25`)
5. Copy every column from `stock_movements` into the new table. (`apps/worker/migrations/0011_opening_in_movement_type.sql:26-29`)
6. Drop old table; rename `__new_stock_movements`. (`apps/worker/migrations/0011_opening_in_movement_type.sql:30-31`)
7. Recreate exactly two indexes: `ix_movements_item_date(item_id,business_date)` and `ix_movements_source(source_event_type,source_event_id)`. (`apps/worker/migrations/0011_opening_in_movement_type.sql:32-33`)
8. `PRAGMA foreign_keys=ON`. (`apps/worker/migrations/0011_opening_in_movement_type.sql:34`)
9. Recreate the five full view definitions in the same order. (`apps/worker/migrations/0011_opening_in_movement_type.sql:35-99`)

KOK-122 should copy the whole structure, changing only the movement CHECK to add `ASSEMBLY_IN`/`ASSEMBLY_OUT`; shortening the view portion would not copy the verified precedent. (`docs/system-design-knowledge-base/10-implementation-backlog.md:224`)

### `0003`/`0004` costing-adjustment pattern

Both migrations use: foreign keys OFF; create `__new_costing_adjustments` with all columns/FK and the expanded trigger CHECK; one `INSERT ... SELECT`; drop old table; rename; foreign keys ON; recreate only `ix_costing_adj_item_date`. (`apps/worker/migrations/0003_allow_session_costing_trigger.sql:1-21`; `apps/worker/migrations/0004_allow_sale_costing_trigger.sql:1-21`) Migration 0003 adds `session` and 0004 adds `sale`; KOK-122 should make the analogous forward-only addition of `assembly`. (`apps/worker/migrations/0003_allow_session_costing_trigger.sql:14`; `apps/worker/migrations/0004_allow_sale_costing_trigger.sql:14`; `docs/system-design-knowledge-base/10-implementation-backlog.md:224`)

## 4. Recipes CRUD precedent for KOK-123

### Shared schema and CRUD

The shared schema defines name/notes/yield/labor/line constraints, full-replacement update, soft active toggle, list filters, and live WAC/replacement theoretical-cost DTO fields. (`packages/shared/src/recipes.ts:18-80`; `packages/shared/src/recipes.ts:82-151`) The service validates output kinds as SEMI_FINISHED/FINISHED and input kinds as RAW_MATERIAL/SEMI_FINISHED, rejects direct self-reference, enforces active-name uniqueness, and clears competing defaults before setting a new active default. (`apps/worker/src/core/recipes/recipes.ts:43-92`; `apps/worker/src/core/recipes/recipes.ts:94-135`; `apps/worker/src/core/recipes/recipes.ts:137-190`)

Update replaces the recipe aggregate and deletes/reinserts derived child lines inside one batch; the child-row hard delete is aggregate regeneration, not business-event deletion. (`apps/worker/src/core/recipes/recipes.ts:193-274`) Deactivate/reactivate only flips `is_active`, preserves the row/lines, checks name collisions on reactivation, and clears another default if the reactivated row is stored as default. (`apps/worker/src/core/recipes/recipes.ts:277-334`)

### Cycle behavior

Recipe CRUD blocks only the direct self-reference (`line.itemId === outputItemId`) at save time. (`apps/worker/src/core/recipes/recipes.ts:43-53`; `apps/worker/src/core/recipes/recipes.ts:73-78`) It does **not** graph-walk for indirect recipe cycles; Doc 04 explicitly says deeper A↔B cycles surface later at refresh-time 409. (`docs/system-design-knowledge-base/04-data-model.md:600-609`) Therefore KOK-123 must not copy recipe cycle behavior literally: its acceptance rule expressly requires direct **and transitive** definition-cycle rejection at save time. (`docs/system-design-knowledge-base/03-domain-model.md:51`; `docs/system-design-knowledge-base/04-data-model.md:583-588`; `docs/system-design-knowledge-base/10-implementation-backlog.md:225`)

### C-3b preview

`toRecipeDto` loads all referenced items in one query, computes WAC and effective-replacement bases live, uses the pure theoretical-cost function, and returns both valuations plus margin; nothing is cached by recipe CRUD. (`apps/worker/src/core/recipes/dto.ts:30-79`; `apps/worker/src/core/recipes/dto.ts:81-116`) The pure formula is `Σ(qty × unitCost) / expectedYield`, rounded through sanctioned integer helpers, with live margin computed against sale price. (`apps/worker/src/core/recipes/theoretical-cost.ts:54-96`; `apps/worker/src/core/recipes/theoretical-cost.ts:105-123`) The form restricts outputs to SEMI_FINISHED/FINISHED and inputs to RAW_MATERIAL/SEMI_FINISHED and displays both cost bases; the detail drawer also emphasizes replacement margin. (`apps/web/src/components/recipes/RecipeForm.tsx:381-381`; `apps/web/src/components/recipes/RecipeForm.tsx:457-518`; `apps/web/src/components/recipes/RecipeDetailDrawer.tsx:157-180`)

### Route/UI shape

The API exposes list/create/get/update/set-active using only shared schemas and core calls. (`apps/worker/src/api/recipes.ts:1-58`) Web hooks expose list/detail/create/update/set-active with root invalidation. (`apps/web/src/features/recipes/api.ts:1-87`) The route composes table, create form, and detail drawer; the drawer owns activate/deactivate and opens edit. (`apps/web/src/routes/recipes.tsx:1-47`; `apps/web/src/components/recipes/RecipeDetailDrawer.tsx:1-38`; `apps/web/src/components/recipes/RecipeDetailDrawer.tsx:95-115`)

## 5. Sales FINISHED-only change (KOK-126)

The exact current gate is:

```ts
if (itemRow.kind !== "FINISHED" && itemRow.kind !== "PACKAGING") {
```

(`apps/worker/src/core/sales/index.ts:157-177`)

`recordSale` reaches it through `buildSaleCreateMovements -> resolveLineSnapshots`. (`apps/worker/src/core/sales/index.ts:195-221`; `apps/worker/src/core/sales/index.ts:300-306`) `updateSale` reaches it through `buildSaleUpdateMutationInputs -> resolveLineSnapshots`. (`apps/worker/src/core/sales/index.ts:721-746`; `apps/worker/src/core/sales/index.ts:839-858`) Preview create reuses `buildSaleCreateMovements`; preview update reuses `buildSaleUpdateMutationInputs`; preview delete has no post-state lines to validate and uses the delete builder. (`apps/worker/src/core/sales/index.ts:981-1032`)

`restoreSale` does **not** call `resolveLineSnapshots`: it loads stored lines, rebuilds `SALE_OUT` movements from their stored `unitCostSnapshotMc`, and commits them verbatim. (`apps/worker/src/core/sales/index.ts:905-923`; `apps/worker/src/core/sales/index.ts:926-970`) This confirms KOK-126 needs an explicit restore policy for legacy PACKAGING lines rather than assuming the shared create/update gate covers it. (`docs/system-design-knowledge-base/10-implementation-backlog.md:229`)

## 6. Replacement-cost rollup (KOK-127)

`computeItemReplacementCost` is definition-agnostic: it accepts only `{qty, unitCost}[]` plus expected yield, validates safe positive integers/nonnegative costs, and returns the half-up rate. It does not know about recipes or tables. (`apps/worker/src/core/costing/replacement-cost.ts:51-75`; `apps/worker/src/core/costing/replacement-cost.ts:76-100`)

The exact current 1:1 construction is:

```ts
// Recipes.uxDefault ... at most one row per output item, so this map is safely 1:1.
const recipeByOutputItemId = new Map<string, DefaultRecipeInfo>();
for (const recipe of defaultRecipeRows) {
  recipeByOutputItemId.set(recipe.outputItemId, {
    expectedYieldQty: recipe.expectedYieldQty,
    lines: linesByRecipeId.get(recipe.id) ?? [],
  });
}
```

(`apps/worker/src/core/costing/replacement-cost-refresh.ts:90-98`)

Edges are then built only from that map, seeds/skips are decided only by its membership, and the planner calls the common topological order. (`apps/worker/src/core/costing/replacement-cost-refresh.ts:100-123`) The exact “Unreachable” branch is:

```ts
if (!recipe) {
  // Unreachable: `order` is seeds plus everything reachable via edges, and every edge target
  // is by construction a key of recipeByOutputItemId (see the loop that builds `edges` above).
  continue;
}
```

(`apps/worker/src/core/costing/replacement-cost-refresh.ts:139-145`)

KOK-127 therefore belongs in `planReplacementCostRefresh`, not the math function: the planner must unify two definition sources, apply C-3d’s explicit “assembly definition wins” precedence, build combined edges, and avoid falsely skipping definition-backed items. (`docs/system-design-knowledge-base/03-domain-model.md:133-149`; `docs/system-design-knowledge-base/10-implementation-backlog.md:230`)

## 7. Stock exits (KOK-128)

The current command is single-main-item: `itemId`, positive `qty`, `reason`, optional `sessionId`/notes, dates, and replay `confirm`; update aliases that same full shape. There is no packaging-line array. (`packages/shared/src/exits.ts:21-57`; `packages/shared/src/exits.ts:59-75`) The DTO is likewise a single item/qty/frozen-cost row. (`packages/shared/src/exits.ts:128-143`)

The live Drizzle model is one `stock_exits` table with `item_id`, `qty`, reason, one frozen snapshot, session/notes/soft-delete timestamps, and no child relation/table. (`apps/worker/src/db/schema.ts:399-427`) The service freezes one item’s current WAC and builds exactly one `EXIT_OUT`, then writes the exit, movement/item-stock statements, audit, and replay statements. (`apps/worker/src/core/inventory/exits.ts:96-158`; `apps/worker/src/core/inventory/exits.ts:161-248`)

There is therefore no `stock_exit_packaging_lines` implementation yet; it exists only in the agreements/KB/backlog design. (`docs/development/acuerdos-prueba-usuario-1.md:148-153`; `docs/system-design-knowledge-base/10-implementation-backlog.md:224`; `docs/system-design-knowledge-base/10-implementation-backlog.md:231`)

## 8. Orders precedent

Orders already enforce FINISHED-only through:

```ts
if (itemRow.kind !== "FINISHED") {
  throw validationError("Un pedido solo puede entregar ítems terminados (FINISHED).", ...)
}
```

(`apps/worker/src/core/orders/index.ts:280-306`)

The guard is used while quoting/resolving lines and again at delivery before sale-line snapshots/movements are created. (`apps/worker/src/core/orders/index.ts:280-306`; `apps/worker/src/core/orders/index.ts:631-688`; `apps/worker/src/core/orders/index.ts:1041-1075`) This is the concrete precedent KOK-126 should align direct catalog sales with. (`docs/system-design-knowledge-base/10-implementation-backlog.md:229`)

## 9. Literal KB/agreement text

### Doc 03 §3 — concepts and packaging rule

Doc 03’s literal governing packaging text is:

> “a PACKAGING item is consumed by an **Assembly** event (§3 *Assembly*, C-10) — the moment it is physically applied to a product — and **never by a sale**. The governing rule is now: *a packaging item leaves inventory when it is physically used, whether or not a sale exists.*” (`docs/system-design-knowledge-base/03-domain-model.md:47`)

Its literal entity split is:

> “**Recipes are NOT widened to accept PACKAGING or FINISHED inputs (Phase 3.2, KOK-121).** A recipe answers ‘how is this food made’; how a product is presented or bundled is an **AssemblyDefinition**.” (`docs/system-design-knowledge-base/03-domain-model.md:48`)

> “The reusable template for a **presentation** (a quantity of product + its packaging: ‘Kéfir natural 500 ml’) or a **combo** (several finished presentations + outer packaging: ‘Desayuno Kokoro’). Components MAY be SEMI_FINISHED, FINISHED or PACKAGING — the one place FINISHED is a legal input. Output item is FINISHED with unit `UNIT` and its own price, stock, WAC and margin.” (`docs/system-design-knowledge-base/03-domain-model.md:51`)

> “The *Envasado/Armado* event: executes an AssemblyDefinition, moving value from components into the finished presentation/combo.” (`docs/system-design-knowledge-base/03-domain-model.md:52`)

The agreements document contains the literal four-concept table: Base product, Packaging, Presentation, Combo, with `SEMI_FINISHED/FINISHED`, `PACKAGING`, `FINISHED UNIT`, and `FINISHED UNIT` respectively. (`docs/development/acuerdos-prueba-usuario-1.md:46-53`) Its explicit qualifier is: “being unpackaged does not make a product semi-finished.” (`docs/development/acuerdos-prueba-usuario-1.md:55-57`)

### Doc 03 §4 — requested literal costing rules

> **C-3:** “for RAW_MATERIAL and PACKAGING … `replacement_cost = last purchase unit cost`, where **‘last’ means last by `business_date`, not last recorded** … For SEMI_FINISHED/FINISHED items produced by a recipe, `replacement_cost = Σ(default-recipe line qty × ingredient's effective replacement cost, C-3c) / expected_yield`, recomputed by the nightly job and on demand; cached with timestamp.” (`docs/system-design-knowledge-base/03-domain-model.md:68-87`)

> **C-3b:** “`theoretical_cost_wac = Σ(recipe line qty × ingredient wac) / expected_yield`; `theoretical_cost_replacement = Σ(recipe line qty × ingredient's effective replacement cost, C-3c) / expected_yield`. Both are computed live and returned by the recipe read APIs; neither is cached nor written to `items.wac` / `items.replacement_cost`.” (`docs/system-design-knowledge-base/03-domain-model.md:88-97`)

> **C-3c:** “`effective_replacement_cost = replacement_cost_updated_at IS NOT NULL ? replacement_cost_mc : wac_mc`” and “This is a **read-time projection only**.” (`docs/system-design-knowledge-base/03-domain-model.md:98-132`)

> **C-3d:** “`replacement_cost = Σ(definition line qty × component's effective replacement cost, C-3c) / definition output qty`.” “An item is costed from a recipe **or** from an assembly definition, never both: if an item somehow has each, the assembly definition wins.” (`docs/system-design-knowledge-base/03-domain-model.md:133-149`)

> **C-4:** “`direct = Σ(consumed qty × consumed item's WAC at commit time)`; `total = direct + indirect_cost + allocated session shared cost (§6)`; `output unit cost = total / actual_output_qty`. Actual output absorbs shrinkage/merma automatically. Output entry updates the output item's WAC per C-1.” (`docs/system-design-knowledge-base/03-domain-model.md:152-156`)

> **C-7:** “Labor is not capitalized into product cost. Hours are tracked per session and reported as `Bs/hour = contribution / hours`.” (`docs/system-design-knowledge-base/03-domain-model.md:166-168`)

> **C-10:** “`direct = Σ(consumed qty × consumed component's WAC at commit time)`; `output unit cost = direct / actual_output_qty`.” “No cash, ever.” “Labor is not capitalized.” “Session shared costs are NOT allocated into assemblies.” (`docs/system-design-knowledge-base/03-domain-model.md:217-241`) “The output entry updates the output item's WAC per C-1 (`ASSEMBLY_IN` is an entry type). Sales of the resulting presentation freeze that full WAC.” (`docs/system-design-knowledge-base/03-domain-model.md:243-246`)

### Doc 03 §7 — requested literal replay rules

> **R-2:** “WAC and dependent costs **are** replayed synchronously, inside the triggering command's own batch, whenever a create/edit/delete lands with an `(occurred_at, created_at)` point earlier than the latest already-processed movement for an affected item.” (`docs/system-design-knowledge-base/03-domain-model.md:387-397`)

> “the dependency graph spans ACTIVE assembly definitions as well as recipes.” “the graph is now `raw material → semi-finished → finished → presentation → combo`.” (`docs/system-design-knowledge-base/03-domain-model.md:398-409`)

> **R-4:** “A replay (R-2) never rewrites an already-frozen cost snapshot (`sale_lines.unit_cost_snapshot`, `stock_exits.unit_cost_snapshot`) … Instead it books … one `costing_adjustment` row.” (`docs/system-design-knowledge-base/03-domain-model.md:411-417`)

> **R-5:** “Before committing a create/edit/delete whose replay (R-2) would touch sales, stock exits, or production runs already recorded after the touched point, the service computes — and the UI surfaces — an impact preview … and requires explicit user confirmation.” (`docs/system-design-knowledge-base/03-domain-model.md:418-422`)

### Doc 03 §9 — use cases

The full catalog remains UC-01…UC-24. (`docs/system-design-knowledge-base/03-domain-model.md:434-463`) The Block B literal additions are:

> “UC-21 | Record packing/assembly (*Envasado/Armado*: definition → adjust actuals → commit) | TG, Web | assembly.recordAssembly” (`docs/system-design-knowledge-base/03-domain-model.md:458`)

> “UC-22 | Manage presentation & combo definitions | Web | assembly.definitions.*” (`docs/system-design-knowledge-base/03-domain-model.md:459`)

### Doc 04 current normative table text

`sale_lines.item_id` is literally documented as “FINISHED ONLY (service-enforced)” with PACKAGING removed and assembly named as its consumption point. (`docs/system-design-knowledge-base/04-data-model.md:315-328`) `stock_movements.type` literally includes `ASSEMBLY_IN`/`ASSEMBLY_OUT`, defines ASSEMBLY_IN as a WAC-entry type, and states the pair sums to zero value. (`docs/system-design-knowledge-base/04-data-model.md:405-425`) `costing_adjustments.trigger_event_type` literally includes `assembly` and explains why it propagates in both directions. (`docs/system-design-knowledge-base/04-data-model.md:459-487`) These are normative future-state definitions; live code remains pre-migration. (`packages/shared/src/enums.ts:87-98`; `apps/worker/src/db/schema.ts:474-501`; `apps/worker/src/db/schema.ts:611-631`)

### Agreements §A-1 located (not missing)

The relevant document is `docs/development/acuerdos-prueba-usuario-1.md`, section “A-1. The ‘Presentación / Combo’ model and the new Envasado/Armado event.” (`docs/development/acuerdos-prueba-usuario-1.md:20-29`) It includes the four concepts, production-vs-assembly distinction, event fields, direct/actual-output costing, ASSEMBLY movements, FINISHED-only sale effect, the three stock-exit cases, metrics boundaries, and the acceptance checklist. (`docs/development/acuerdos-prueba-usuario-1.md:46-115`; `docs/development/acuerdos-prueba-usuario-1.md:117-174`; `docs/development/acuerdos-prueba-usuario-1.md:176-192`; `docs/development/acuerdos-prueba-usuario-1.md:242-274`)

The worked example is present and literal: ten packed loaves cost Bs 13/u, five ghee jars Bs 18/u, ten Kéfir 500 ml bottles Bs 5.70/u; five Desayunos cost Bs 203.50 total/Bs 40.70 each; one Bs 60 sale freezes Bs 40.70 and yields 32.17% historical margin; Bs 44.50 replacement cost yields 25.83% and must alert. (`docs/development/acuerdos-prueba-usuario-1.md:194-240`)

## 10. Dependency graph verification

Signature, verbatim:

```ts
export function topoOrderAffectedItems(
  edges: readonly RecipeEdge[],
  seedItemIds: readonly string[],
): string[]
```

(`apps/worker/src/core/costing/dependency-graph.ts:58-61`)

`RecipeEdge` contains only `ingredientItemId` and `outputItemId`; quantities/source type are intentionally absent because this module orders cost flow only. (`apps/worker/src/core/costing/dependency-graph.ts:24-35`) The single `loadRecipeEdges` call is immediately before `topoOrderAffectedItems` inside `planCostingReplay`. (`apps/worker/src/core/costing/replay.ts:272-275`) The loader itself performs one active-recipe join and has no producer-specific behavior beyond its query source. (`apps/worker/src/core/costing/replay.ts:536-552`)

Verdict: the backlog’s “graph half is three lines” claim is credible if it means merging assembly-definition edge rows into this existing array; no signature/algorithm change is required. (`docs/system-design-knowledge-base/10-implementation-backlog.md:228`; `apps/worker/src/core/costing/dependency-graph.ts:58-78`) It does **not** reduce KOK-125 overall to three lines, because the replay cascade and snapshot/delta paths remain production/sale/exit specific as documented in §2 above. (`apps/worker/src/core/costing/replay.ts:298-368`; `apps/worker/src/core/costing/replay.ts:555-672`)

## Planning implications for the nine sequential PRs

- Treat the KB text as already carrying the Block B normative model and reconcile backlog status before creating a redundant KOK-121 amendment; do not silently rewrite the already-present rules. (`docs/system-design-knowledge-base/03-domain-model.md:47-55`; `docs/system-design-knowledge-base/03-domain-model.md:133-149`; `docs/system-design-knowledge-base/03-domain-model.md:217-246`; `docs/system-design-knowledge-base/04-data-model.md:315-328`; `docs/system-design-knowledge-base/10-implementation-backlog.md:223`)
- KOK-122 must update every enumeration/check site listed in §2, not just the migration and shared tuple. (`docs/system-design-knowledge-base/10-implementation-backlog.md:224`)
- KOK-123 may reuse recipe module shape, soft activation, and dual live preview, but must add save-time transitive graph validation rather than copy recipe’s direct-only validation. (`apps/worker/src/core/recipes/recipes.ts:43-92`; `docs/system-design-knowledge-base/04-data-model.md:583-609`)
- Land KOK-150 before KOK-125 and preserve production as the only producer in that refactor; assembly registration then becomes additive and testable. (`docs/system-design-knowledge-base/10-implementation-backlog.md:227-228`)
- Decide KOK-126 restore behavior explicitly because the current restore path bypasses line-kind resolution. (`apps/worker/src/core/sales/index.ts:926-970`; `docs/system-design-knowledge-base/10-implementation-backlog.md:229`)
- KOK-127 should preserve the pure math and replace the planner’s recipe-only ownership/map/skip assumptions with explicit C-3d precedence. (`apps/worker/src/core/costing/replacement-cost.ts:65-100`; `apps/worker/src/core/costing/replacement-cost-refresh.ts:90-167`; `docs/system-design-knowledge-base/03-domain-model.md:133-149`)
- KOK-128 is a real aggregate extension: shared contract, DTO, service builders for create/update/delete/restore/replay, persistence relation, and UI must all learn optional packaging lines; no child-table implementation exists to reuse today. (`packages/shared/src/exits.ts:38-75`; `apps/worker/src/db/schema.ts:399-427`; `apps/worker/src/core/inventory/exits.ts:96-248`; `docs/development/acuerdos-prueba-usuario-1.md:137-161`)
