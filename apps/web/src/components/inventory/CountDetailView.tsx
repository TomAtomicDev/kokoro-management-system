// SC-08 Conteos detail/edit drawer (KOK-019, UC-10, DetailDrawer contract per Doc 06 §4). A DRAFT
// count's lines are editable — `countedQty` is PATCHed on blur (never per keystroke, see
// `handleBlur`); a COMMITTED count renders the same line list read-only. `expectedQty` is always
// read-only (it is frozen at startCount time — see core/inventory/counts.ts's header — this
// screen never lets the owner edit it).
//
// Committing goes through a two-step confirm (Dialog-in-Dialog, reusing the same Dialog primitive
// nested inside the drawer's own Dialog — same nesting pattern as ItemPicker's CreateItemDialog
// inside a parent form Dialog): any unsaved line edits are flushed to the server first (the owner
// may click "Confirmar conteo" without blurring the last field they typed into), then a variance
// summary is shown, requiring a second explicit click before `commitCount` is actually called.

import type { InventoryCountLineDto, Unit } from "@kokoro/shared";
import { formatQty } from "@kokoro/shared";
import { useEffect, useRef, useState } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCommitCount, useCount, useUpdateCountLine } from "@/features/inventory/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

export interface CountDetailViewProps {
  countId: string | null;
  /** itemId -> { name, unit }, built by the caller from useItemsQuery (see routes/inventory.tsx),
   * same lookup ExitsTable/KardexView reuse. */
  items: Map<string, { name: string; unit: Unit }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CountDetailView({ countId, items, open, onOpenChange }: CountDetailViewProps) {
  const countQuery = useCount(countId);
  const count = countQuery.data;

  const [lineInputs, setLineInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flushing, setFlushing] = useState(false);

  const updateLineMutation = useUpdateCountLine();
  const commitMutation = useCommitCount();

  // Seed local edit state from the server once per count (never on every background refetch that
  // follows our own line edits, which would otherwise stomp an in-progress keystroke in another
  // row) — guarded by a ref of the last-seeded count id rather than trimming `count` out of the
  // dependency array.
  const seededCountId = useRef<string | null>(null);
  useEffect(() => {
    if (count && seededCountId.current !== count.id) {
      setLineInputs(
        Object.fromEntries(
          count.lines.map((line) => [line.itemId, formatIntAsDecimalInput(line.countedQty, 3)]),
        ),
      );
      seededCountId.current = count.id;
      setError(null);
    }
  }, [count]);

  const isDraft = count?.status === "DRAFT";

  function effectiveCountedQty(line: InventoryCountLineDto): number {
    const raw = lineInputs[line.itemId];
    if (raw === undefined) return line.countedQty;
    const parsed = parseDecimalToInt(raw, 3);
    return parsed ?? line.countedQty;
  }

  function handleBlur(line: InventoryCountLineDto) {
    if (!count) return;
    const raw = lineInputs[line.itemId];
    if (raw === undefined) return;
    const parsed = parseDecimalToInt(raw, 3);
    if (parsed === null) {
      setLineInputs((prev) => ({
        ...prev,
        [line.itemId]: formatIntAsDecimalInput(line.countedQty, 3),
      }));
      return;
    }
    if (parsed === line.countedQty) return;
    updateLineMutation.mutate(
      { countId: count.id, itemId: line.itemId, countedQty: parsed },
      {
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : inventoryLabels.errors.generic);
          setLineInputs((prev) => ({
            ...prev,
            [line.itemId]: formatIntAsDecimalInput(line.countedQty, 3),
          }));
        },
      },
    );
  }

  async function handleOpenConfirm() {
    if (!count) return;
    setError(null);
    setFlushing(true);
    try {
      const dirty = count.lines.filter((line) => {
        const raw = lineInputs[line.itemId];
        if (raw === undefined) return false;
        const parsed = parseDecimalToInt(raw, 3);
        return parsed !== null && parsed !== line.countedQty;
      });
      await Promise.all(
        dirty.map((line) => {
          const parsed = parseDecimalToInt(lineInputs[line.itemId] as string, 3) as number;
          return updateLineMutation.mutateAsync({
            countId: count.id,
            itemId: line.itemId,
            countedQty: parsed,
          });
        }),
      );
      setConfirmOpen(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : inventoryLabels.errors.generic);
    } finally {
      setFlushing(false);
    }
  }

  async function handleCommit() {
    if (!count) return;
    setError(null);
    try {
      await commitMutation.mutateAsync(count.id);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : inventoryLabels.errors.generic);
    }
  }

  const variantLines = count
    ? count.lines
        .map((line) => ({ line, delta: effectiveCountedQty(line) - line.expectedQty }))
        .filter(({ delta }) => delta !== 0)
    : [];

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={
        count
          ? `${inventoryLabels.countDetailTitlePrefix} · ${count.businessDate}`
          : inventoryLabels.countDetailTitlePrefix
      }
      subtitle={count?.notes ?? undefined}
    >
      <div className="flex flex-col gap-3">
        {countQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">{inventoryLabels.loading}</p>
        ) : !count || count.lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{inventoryLabels.noCountLines}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>{inventoryLabels.countColumnItem}</span>
              <span className="text-right">{inventoryLabels.countColumnExpected}</span>
              <span className="text-right">{inventoryLabels.countColumnCounted}</span>
              <span className="text-right">{inventoryLabels.countColumnDelta}</span>
            </div>
            {count.lines.map((line) => {
              const info = items.get(line.itemId);
              const unit = info?.unit ?? "UNIT";
              const delta = effectiveCountedQty(line) - line.expectedQty;
              return (
                <div
                  key={line.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
                >
                  <span className="text-foreground">{info?.name ?? "—"}</span>
                  <span className="numeric-cell text-right text-muted-foreground">
                    {formatQty(line.expectedQty, unit)}
                  </span>
                  {isDraft ? (
                    <Input
                      className="w-24"
                      inputMode="decimal"
                      value={lineInputs[line.itemId] ?? ""}
                      onChange={(e) =>
                        setLineInputs((prev) => ({ ...prev, [line.itemId]: e.target.value }))
                      }
                      onBlur={() => handleBlur(line)}
                      disabled={flushing || commitMutation.isPending}
                    />
                  ) : (
                    <span className="numeric-cell text-right text-foreground">
                      {formatQty(line.countedQty, unit)}
                    </span>
                  )}
                  <span className={cn("numeric-cell text-right", delta < 0 && "text-negative")}>
                    {formatQty(delta, unit)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {error ? <p className="text-negative text-sm">{error}</p> : null}

        {isDraft && count && count.lines.length > 0 ? (
          <Button
            type="button"
            onClick={handleOpenConfirm}
            disabled={flushing || commitMutation.isPending}
          >
            {inventoryLabels.confirmCountButton}
          </Button>
        ) : null}
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        aria-label={inventoryLabels.confirmCountDialogTitle}
      >
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-foreground text-md">
            {inventoryLabels.confirmCountDialogTitle}
          </h2>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 text-sm">
          {variantLines.length === 0 ? (
            <p className="text-muted-foreground">{inventoryLabels.confirmCountNoVariance}</p>
          ) : (
            <>
              <p className="text-muted-foreground">{inventoryLabels.confirmCountSummaryIntro}</p>
              <ul className="flex flex-col gap-1.5">
                {variantLines.map(({ line, delta }) => {
                  const info = items.get(line.itemId);
                  const unit = info?.unit ?? "UNIT";
                  return (
                    <li key={line.id} className="flex items-center justify-between gap-3">
                      <span className="text-foreground">{info?.name ?? "—"}</span>
                      <span className={cn("numeric-cell", delta < 0 && "text-negative")}>
                        {formatQty(delta, unit)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmOpen(false)}
            disabled={commitMutation.isPending}
          >
            {inventoryLabels.confirmCountBack}
          </Button>
          <Button type="button" onClick={handleCommit} disabled={commitMutation.isPending}>
            {inventoryLabels.confirmCountSubmit}
          </Button>
        </div>
      </Dialog>
    </DetailDrawer>
  );
}
