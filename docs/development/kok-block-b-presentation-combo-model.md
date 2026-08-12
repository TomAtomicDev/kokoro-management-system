# Block B — Presentation/Combo Model

How the Presentation/Combo model (KOK-121 through KOK-129, plus the KOK-150 prerequisite refactor)
actually works, and the decisions that live only in code comments and this session's PR history
today. This is an implementation deep-dive, not a spec — for the business rules themselves see the
[System Design Knowledge Base](system-design-knowledge-base/README.md) (Doc 03 §3/§4/§7, Doc 04 new
tables) and `docs/development/acuerdos-prueba-usuario-1.md` §A-1, the source of the model and its
golden worked example ("Desayuno Kokoro").

## 1. What shipped

| Task | What it added |
| --- | --- |
| KOK-150 | Prerequisite refactor: generalized `replay.ts`'s production-only cascade into a `PRODUCING_EVENTS` registry, so assembly could register as a second cascade producer without duplicating the correction logic. |
| KOK-123 | `AssemblyDefinition` CRUD (`core/assemblies/`) — the reusable "recipe" for a presentation or combo, with cycle detection (`wouldCreateAssemblyCycle`, BFS over `componentsByOutput`). |
| KOK-124 | The Envasado/Armado event, CREATE only (`core/assembly-events/`) — C-10 costing (`computeAssemblyCost`), deliberately not yet wired into replay/edit/delete. |
| KOK-125 | Assembly joins the replay cascade as a second `PRODUCING_EVENTS` entry, plus update/delete/restore/preview mirroring production's shape. |
| KOK-126 | Sales become `FINISHED`-only — `resolveLineSnapshots` no longer accepts `PACKAGING` lines. |
| KOK-127 | Composite replacement cost: `replacement-cost-refresh.ts` follows a unified recipe-or-assembly cost source per item, assembly winning ties (C-3d). |
| KOK-128 | Optional packaging lines on stock exits (`stock_exit_packaging_lines`), with a service-level rejection when the exited item is itself an assembled presentation. |
| KOK-129 | Dev/staging + onboarding fixture: Kéfir natural a granel + its two presentations, Desayuno Kokoro combo. |

## 2. The `PRODUCING_EVENTS` registry (KOK-150)

Before this block, `applyProductionCostCorrections` in `core/costing/replay.ts` was written for
exactly one producer (production runs). Assembly needed to become a second one without forking the
cascade logic. The refactor turned the single hard-coded correction path into an array:

```ts
const PRODUCING_EVENTS: readonly ProducingEventDescriptor[] = [
  { sourceEventType: "production_run", consumingMovementType: "PRODUCTION_OUT",
    producingMovementType: "PRODUCTION_IN", correctUnitCosts: correctProductionRunUnitCosts },
  { sourceEventType: "assembly", consumingMovementType: "ASSEMBLY_OUT",
    producingMovementType: "ASSEMBLY_IN", correctUnitCosts: correctAssemblyUnitCosts },
];
```

Every place that used to say "is this a production movement?" now does
`PRODUCING_EVENTS.some(...)`. This was verified byte-identical for the production-only case before
KOK-125 added the assembly entry (`test/invariants/cross-item-cascade.test.ts` untouched, 3/3
passing both before and after).

## 3. `affectedProductionRunIds` vs `affectedAssemblyIds` (KOK-125)

The replay DTO already had `affectedProductionRunIds` for the impact-preview dialog
(`ImpactConfirmDialog.tsx`), which renders it under the Spanish label "Producción(es) afectadas".
Naively reusing that same field for assembly ids would have silently mislabeled an assembly
cascade as a production one in the UI — a real user-facing bug, not a cosmetic one.

The fix: `affectedEventIdsBySourceType: Map<string, Set<string>>` in `replay.ts`, keyed by
`sourceEventType`, dispatched into the two separate DTO fields
(`affectedProductionRunIds`/`affectedAssemblyIds`) at the boundary. Every other event-producing
service (`exits.ts`, `production/index.ts`, `purchasing/index.ts`, `sales/index.ts`) got a
mechanical `affectedAssemblyIds: []` addition to keep the DTO shape total.

## 4. C-10 vs C-4: no `allocated_session_cost` in assembly costing (KOK-124/125)

C-4 (production costing) includes `indirect_cost`/`allocated_session_cost` terms. C-10 (assembly
costing, Doc 03 §4) does not — "session shared costs are NOT allocated into assemblies," per the
agreements doc. `computeAssemblyCost` (`core/assembly-events/cost.ts`) is a straight
`direct = Σ(consumed qty × component WAC at commit time)`. When KOK-125 added assembly's edit/
delete/restore mirroring production's shape, the one deliberate divergence was NOT preserving an
`allocatedSessionCost` column on edit — there isn't one to preserve.

The cascade correction in `replay.ts` (`correctAssemblyUnitCosts`) accumulates cost directly rather
than calling `computeAssemblyCost` a second time — a rounding round-trip risk (compute once at
record time, recompute differently at cascade time) that production's own cascade avoids the same
way.

## 5. C-3d precedence: assembly wins over recipe (KOK-127)

An item may in principle have both a recipe (producing it via production) and an assembly
definition (producing it via Envasado/Armado) — Doc 03 §4's C-3d rule is explicit: "an item is
costed from a recipe or an assembly definition, never both: if an item somehow has each, the
assembly definition wins." `replacement-cost-refresh.ts` builds a single
`costSourceByOutputItemId: Map<string, CostSource>` and **overwrites** on the assembly pass after
the recipe pass — an explicit design choice, not a reliance on `Map` insertion order (the backlog
itself warned against that ambiguity). The dependency graph (`edges`) is rebuilt from that unified
map only, not a union of both raw sources — this deliberately differs from `replay.ts`'s cascade,
which does union both (a cascade needs to know about every possible producer that could be
disturbed; a cost refresh needs to know only the one that actually wins).

## 6. `restoreSale` refuses legacy `PACKAGING` lines (KOK-126)

Narrowing `resolveLineSnapshots` to `FINISHED`-only breaks nothing for new sales, but a sale
recorded before this block could have a stored `PACKAGING` line. Reprocessing that line through the
narrowed path on restore would either crash or silently misvalue it. The decision (orchestrator
call, not KB-mandated): `restoreSale` refuses outright —

> "No se puede restaurar esta venta: contiene una línea de empaque, que ya no se vende directamente
> bajo el modelo de presentaciones y combos."

This preserves R-4's "restore = undo exactly" invariant rather than inventing a migration path for
what should be a genuinely rare case (a sale from before this block, deleted, then restored after
it). No bulk-fix or backfill was built for existing PACKAGING sale-line data — out of scope, and the
KB doesn't ask for one.

## 7. Stock-exit packaging: service-level rejection, not just a hidden UI section (KOK-128)

An assembled presentation's own WAC already includes every packaging component assembled into it
(C-10). Accepting packaging lines on an exit of that item would double-deduct — once inside the
presentation's WAC, again as a separate `EXIT_OUT` line. `assertPackagingLinesAllowed` enforces this
in `core/inventory/exits.ts` itself (D-2: never trust the UI alone), checked on both create and
update (including the case where an edit changes `item_id` to a now-assembled item). Packaging
lines are children of the exit's own `EXIT_OUT` `sourceEventId`, not a second event, and follow the
same frozen-vs-fresh edit policy as the main item, matched item-by-item using the same
first-available-first-matched loop shape as production's/assembly's own consumption-line edit
policy.

## 8. KOK-129 fixture: two different things named "Kéfir"

The backlog phrasing ("reclassify Kéfir natural a granel as the bulk base") reads as if it meant
renaming the existing `item_kefir` row. That row is `RAW_MATERIAL`, aliased `"kefir grains"`, and
is consumed as an ingredient by `recipe_queso_kefir`. `core/recipes/recipes.ts`'s
`validateRecipeItemKinds` requires every recipe ingredient to be `RAW_MATERIAL` or `SEMI_FINISHED`
— never `FINISHED`. Reclassifying `item_kefir` to `FINISHED` (required for it to be usable as an
assembly-definition component) would have left `recipe_queso_kefir` in a state the recipe service
itself would refuse to ever re-save.

The fixture instead adds a **new**, separate item (`item_kefir_granel`, "Kéfir natural a granel")
for the bulk beverage, leaving `item_kefir` (the grains/culture) and `recipe_queso_kefir` completely
untouched. These are genuinely different business objects — kefir grains ferment milk into the
kefir beverage — so this is a correctness fix hiding inside what read like a rename, not a scope
deviation. Similarly, Desayuno Kokoro's assembly definition consumes the existing
`item_pan_masa_madre` and `item_ghee` `FINISHED` items directly rather than giving them their own
presentation layer — the backlog scoped this fixture to Kéfir + Desayuno Kokoro only, and a combo
may consume any `FINISHED` item, not only ones that are themselves assembly outputs.

## 9. Known pre-existing gap, deliberately not fixed here

`pnpm run check`'s `guard:scales` step (`scripts/check-scale-literals.mjs`, D-5's automated
enforcement) fails on `apps/worker/src/core/inventory/waste.ts:45` — a bare `1000000` literal in a
raw SQL aggregate (`SUM(CAST(ROUND(qty * unit_cost_snapshot_mc / 1000000.0) AS INTEGER))`). This
file is untouched by Block B (last modified in the earlier Block A commit) and the guard fails
identically on `develop`'s own HEAD with no Block B changes applied. Every file this block actually
touched or added passes the same guard cleanly (`node scripts/check-scale-literals.mjs` reports
exactly this one, pre-existing violation). Fixing `waste.ts` was left alone rather than folded in
silently — it's a real D-5 gap worth its own follow-up task, but not one this block introduced or
should absorb into its scope.
