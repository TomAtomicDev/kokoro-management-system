// Detail drawer for a single production run (Doc 06 §4 DetailDrawer contract, SC-05). Mirrors
// PurchaseDetailDrawer.tsx's edit/delete/undo/restore composition exactly: edit navigates to
// `ProductionRunForm`'s own full page (KOK-141, `/production/$productionRunId/edit`) and closes
// the drawer, delete is a soft-delete + undo toast (Doc 06 principle 6) with the ImpactConfirmDialog
// exception for an R-5 replay-affecting delete/restore.

import type {
  DeleteProductionRunCommand,
  DeleteProductionRunResult,
  ItemDto,
  RecipeDto,
  UpdateProductionRunResult,
} from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { useItemsQuery } from "@/features/catalog/api";
import {
  useDeleteProductionRun,
  useProductionRun,
  useRestoreProductionRun,
} from "@/features/production-runs/api";
import { useRecipesQuery } from "@/features/recipes/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { productionLabels } from "@/lib/i18n-production";

export interface ProductionRunDetailDrawerProps {
  productionRunId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductionRunDetailDrawer({
  productionRunId,
  open,
  onOpenChange,
}: ProductionRunDetailDrawerProps) {
  const navigate = useNavigate();
  const productionRunQuery = useProductionRun(productionRunId ?? undefined);
  const itemsQuery = useItemsQuery({ isActive: true });
  const recipesQuery = useRecipesQuery({ isActive: true });
  const { showUndo } = useToast();

  // Frozen at the moment delete succeeds — see deleteReplay's onSuccess below. The restore mutation
  // is deliberately built from THIS, never from the live `productionRunId` prop: `onOpenChange(false)`
  // closes the drawer as part of that same onSuccess, which flips `productionRunId` to `null` on the
  // parent's next render. `useReplayConfirmableMutation`'s `mutateAsync` always calls the LATEST
  // `mutationFn` a render produced (TanStack Query re-applies options every render), so a restore
  // mutation built from the live prop would, by the time the owner actually clicks the toast's
  // "Deshacer" a moment later, close over an empty id and POST `/production-runs//restore` — a 404
  // that silently drops the undo. Reproduced live via Playwright while verifying this task.
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

  // Called unconditionally (rules of hooks) with "" when nothing is selected yet — never actually
  // invoked in that state, since the buttons that call `execute`/`confirm` only render once
  // `productionRun` (below) is loaded.
  const deleteMutation = useDeleteProductionRun(productionRunId ?? "");
  const restoreMutation = useRestoreProductionRun(pendingRestoreId ?? "");

  const restoreReplay = useReplayConfirmableMutation<
    DeleteProductionRunCommand,
    UpdateProductionRunResult
  >((command) => restoreMutation.mutateAsync(command));

  const deleteReplay = useReplayConfirmableMutation<
    DeleteProductionRunCommand,
    DeleteProductionRunResult
  >((command) => deleteMutation.mutateAsync(command), {
    onSuccess: () => {
      setPendingRestoreId(productionRunId);
      onOpenChange(false);
      showUndo({
        message: productionLabels.deletedUndo,
        actionLabel: productionLabels.undo,
        onAction: () => restoreReplay.execute({}),
      });
    },
  });

  const itemById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  const recipesById = useMemo(() => {
    const map = new Map<string, RecipeDto>();
    for (const recipe of recipesQuery.data?.recipes ?? []) map.set(recipe.id, recipe);
    return map;
  }, [recipesQuery.data]);

  if (!productionRunId) return null;
  const productionRun = productionRunQuery.data;
  const recipe = productionRun?.recipeId ? recipesById.get(productionRun.recipeId) : undefined;
  const outputItem = productionRun ? itemById.get(productionRun.outputItemId) : undefined;

  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={recipe?.name ?? productionLabels.detailTitle}
        subtitle={
          productionRun &&
          (productionRun.code
            ? `${productionRun.code} · ${productionRun.businessDate}`
            : productionRun.businessDate)
        }
        entityType="production_runs"
        entityId={productionRun?.id}
        footer={
          productionRun ? (
            <span>
              Creado {new Date(productionRun.createdAt).toLocaleDateString("es-BO")} · Actualizado{" "}
              {new Date(productionRun.updatedAt).toLocaleDateString("es-BO")}
            </span>
          ) : undefined
        }
      >
        {!productionRun ? (
          <p className="text-muted-foreground text-sm">{productionLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigate({
                    to: "/production/$productionRunId/edit",
                    params: { productionRunId: productionRun.id },
                  });
                  onOpenChange(false);
                }}
              >
                {productionLabels.edit}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => deleteReplay.execute({})}
                disabled={deleteReplay.isPending}
              >
                {productionLabels.delete}
              </Button>
            </div>

            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{productionLabels.detailRecipe}</span>
                <span className="font-medium text-foreground">
                  {recipe?.name ?? productionLabels.detailNoRecipe}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{productionLabels.detailBatches}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {productionRun.batches.toLocaleString("es-BO", { maximumFractionDigits: 3 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{productionLabels.detailOutputItem}</span>
                <span className="font-medium text-foreground">
                  {outputItem?.name ?? productionRun.outputItemId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{productionLabels.detailActualOutput}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {outputItem
                    ? formatQty(productionRun.actualOutputQty, outputItem.unit)
                    : productionRun.actualOutputQty}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{productionLabels.detailDirectCost}</span>
                <span className="numeric-cell text-foreground">
                  {formatMoney(toCentavos(productionRun.directCost))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{productionLabels.detailIndirectCost}</span>
                <span className="numeric-cell text-foreground">
                  {formatMoney(toCentavos(productionRun.indirectCost))}
                </span>
              </div>
              {productionRun.allocatedSessionCost > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {productionLabels.detailAllocatedCost}
                  </span>
                  <span className="numeric-cell text-foreground">
                    {formatMoney(toCentavos(productionRun.allocatedSessionCost))}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between border-border border-t pt-1">
                <span className="font-medium text-muted-foreground">
                  {productionLabels.detailTotalCost}
                </span>
                <span className="numeric-cell font-medium text-foreground">
                  {formatMoney(toCentavos(productionRun.totalCost))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-muted-foreground">
                  {productionLabels.detailUnitCost}
                </span>
                <span className="numeric-cell font-semibold text-foreground">
                  {formatMoney(
                    totalCentavos(
                      toMilliCentavosPerUnit(productionRun.outputUnitCostMc),
                      WHOLE_UNIT_MILLI_UNITS,
                    ),
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">{productionLabels.detailLines}</span>
              <ul className="flex flex-col gap-2">
                {productionRun.lines.map((line) => {
                  const item = itemById.get(line.itemId);
                  return (
                    <li
                      key={line.id}
                      className="flex flex-col gap-1 rounded-md border border-border px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">
                          {item?.name ?? line.itemId}
                        </span>
                        <span className="numeric-cell font-medium">
                          {item ? formatQty(line.qty, item.unit) : line.qty}
                        </span>
                      </div>
                      {item ? (
                        <div className="flex items-center justify-end text-muted-foreground text-xs">
                          <span className="numeric-cell">
                            {productionLabels.unitCostLabel}:{" "}
                            {formatMoney(
                              totalCentavos(
                                toMilliCentavosPerUnit(line.unitCostSnapshotMc),
                                WHOLE_UNIT_MILLI_UNITS,
                              ),
                            )}{" "}
                            / {productionLabels.unitAbbrev[item.unit]}
                          </span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{productionLabels.fieldNotes}</span>
              <p className="text-muted-foreground">
                {productionRun.notes ?? productionLabels.noNotes}
              </p>
            </div>
          </div>
        )}
      </DetailDrawer>

      {deleteReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={deleteReplay.pendingConfirmation.impact}
          onConfirm={deleteReplay.confirm}
          onCancel={deleteReplay.cancel}
          confirmLoading={deleteReplay.isPending}
          title={productionLabels.impactDeleteTitle}
          description={productionLabels.impactDeleteDescription}
        />
      ) : null}

      {restoreReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={restoreReplay.pendingConfirmation.impact}
          onConfirm={restoreReplay.confirm}
          onCancel={restoreReplay.cancel}
          confirmLoading={restoreReplay.isPending}
          title={productionLabels.impactRestoreTitle}
          description={productionLabels.impactRestoreDescription}
        />
      ) : null}
    </>
  );
}
