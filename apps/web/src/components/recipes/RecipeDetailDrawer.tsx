// Detail drawer for a single recipe (Doc 06 Â§4 DetailDrawer contract). Mirrors
// PurchaseDetailDrawer.tsx's structure, but simpler: no replay-confirmation dance, and
// deactivate/reactivate is a plain `Switch` toggle over `useSetRecipeActive` â€” same precedent as
// ItemDetailDrawer.tsx's own active toggle (recipes.ts's header comment: "recipes deactivate the
// same way items do").

import type { ItemDto } from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { useMemo, useState } from "react";

import { CalcTrace, type CalcTraceInput } from "@/components/common/CalcTrace";
import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { MarginBadge } from "@/components/pricing/MarginBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useItemsQuery } from "@/features/catalog/api";
import { useRecipeQuery, useSetRecipeActive } from "@/features/recipes/api";
import { recipesLabels } from "@/lib/i18n-recipes";

import { RecipeForm } from "./RecipeForm";

export interface RecipeDetailDrawerProps {
  recipeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecipeDetailDrawer({ recipeId, open, onOpenChange }: RecipeDetailDrawerProps) {
  const recipeQuery = useRecipeQuery(recipeId ?? undefined);
  const itemsQuery = useItemsQuery({ isActive: true });
  const setActiveMutation = useSetRecipeActive();

  const [editOpen, setEditOpen] = useState(false);

  const itemById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  if (!recipeId) return null;
  const recipe = recipeQuery.data?.recipe;
  const settings = recipeQuery.data?.settings;
  const outputItem = recipe ? itemById.get(recipe.outputItemId) : undefined;

  /** CalcTrace inputs for the cost panel below â€” mirrors RecipeForm.tsx's identical helper: one
   * row per ingredient line's contribution (qty Ã— unit cost on `basis`) plus the expected yield. */
  function buildCostTraceInputs(basis: "wac" | "replacementCostMc"): CalcTraceInput[] {
    if (!recipe) return [];
    return [
      ...recipe.lines.map((line): CalcTraceInput => {
        const item = itemById.get(line.itemId);
        // Both bases share ADR-017's milli-centavos-per-WHOLE-unit scale.
        const unitCostMc =
          basis === "wac" ? (item?.wacMc ?? null) : (item?.replacementCostMc ?? null);
        const contribution =
          unitCostMc === null
            ? toCentavos(0)
            : totalCentavos(toMilliCentavosPerUnit(unitCostMc), toMilliUnits(line.qty));
        return { label: item?.name ?? line.itemId, value: formatMoney(contribution) };
      }),
      {
        label: recipesLabels.columnYield,
        value: outputItem
          ? formatQty(recipe.expectedYieldQty, outputItem.unit)
          : String(recipe.expectedYieldQty),
      },
    ];
  }

  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={recipe?.name ?? recipesLabels.detailTitle}
        subtitle={outputItem?.name}
        entityType="recipe"
        entityId={recipe?.id}
        footer={
          recipe ? (
            <span>
              Creado {new Date(recipe.createdAt).toLocaleDateString("es-BO")} · Actualizado{" "}
              {new Date(recipe.updatedAt).toLocaleDateString("es-BO")}
            </span>
          ) : undefined
        }
      >
        {!recipe ? (
          <p className="text-muted-foreground text-sm">{recipesLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={recipe.isActive}
                  onCheckedChange={(next) =>
                    setActiveMutation.mutate({ id: recipe.id, isActive: next })
                  }
                  disabled={setActiveMutation.isPending}
                  aria-label={recipe.isActive ? recipesLabels.deactivate : recipesLabels.reactivate}
                />
                <span className="text-muted-foreground text-xs">
                  {recipe.isActive ? recipesLabels.badgeActive : recipesLabels.badgeInactive}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                {recipesLabels.edit}
              </Button>
            </div>

            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{recipesLabels.columnOutputItem}</span>
                <span className="font-medium text-foreground">
                  {outputItem?.name ?? recipe.outputItemId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{recipesLabels.columnYield}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {outputItem
                    ? formatQty(recipe.expectedYieldQty, outputItem.unit)
                    : recipe.expectedYieldQty}
                </span>
              </div>
              {recipe.estLaborMin !== null ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{recipesLabels.fieldLaborMin}</span>
                  <span className="numeric-cell font-medium text-foreground">
                    {recipe.estLaborMin}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted px-4 py-3">
              <span className="font-medium text-foreground text-sm">
                {recipesLabels.costPanelTitle}
              </span>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  {recipesLabels.costWacLabel}
                  <CalcTrace
                    formula={recipesLabels.costFormula}
                    inputs={buildCostTraceInputs("wac")}
                  />
                </span>
                <span className="numeric-cell text-foreground text-sm">
                  {formatMoney(toCentavos(recipe.theoreticalCostWac.costPerOutputUnit))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
                  {recipesLabels.costReplacementLabel}
                  <CalcTrace
                    formula={recipesLabels.costFormula}
                    inputs={buildCostTraceInputs("replacementCostMc")}
                  />
                </span>
                <span className="numeric-cell font-semibold text-foreground text-lg">
                  {formatMoney(toCentavos(recipe.theoreticalCostReplacement.costPerOutputUnit))}
                </span>
              </div>
              {recipe.theoreticalCostReplacement.margin && settings ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">{recipesLabels.marginLabel}</span>
                  <MarginBadge
                    pctBasisPoints={recipe.theoreticalCostReplacement.margin.pctBasisPoints}
                    minMarginPct={settings.minMarginPct}
                  />
                </div>
              ) : !recipe.theoreticalCostReplacement.margin && outputItem?.kind === "FINISHED" ? (
                <p className="text-muted-foreground text-xs">{recipesLabels.noSalePrice}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">{recipesLabels.detailLines}</span>
              <ul className="flex flex-col gap-2">
                {recipe.lines.map((line) => {
                  const item = itemById.get(line.itemId);
                  return (
                    <li
                      key={line.id}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                    >
                      <span className="font-medium text-foreground">
                        {item?.name ?? line.itemId}
                      </span>
                      <span className="numeric-cell text-muted-foreground text-xs">
                        {item ? formatQty(line.qty, item.unit) : line.qty}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{recipesLabels.fieldNotes}</span>
              <p className="text-muted-foreground">{recipe.notes ?? recipesLabels.noNotes}</p>
            </div>
          </div>
        )}
      </DetailDrawer>

      {recipe && settings ? (
        <RecipeForm
          open={editOpen}
          onOpenChange={setEditOpen}
          recipe={recipe}
          settings={settings}
        />
      ) : null}
    </>
  );
}
