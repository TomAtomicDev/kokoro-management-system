// Merge-duplicates utility (Doc 07 SC-15): pick the duplicate and the item to keep, re-points
// aliases one-way, deactivates the duplicate. See apps/worker/src/core/catalog/merge.ts for what
// actually gets re-pointed today.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useMergeItemsMutation } from "@/features/catalog/api";
import { ApiError } from "@/lib/api";
import { catalogLabels } from "@/lib/i18n-catalog";

import { ItemPicker } from "./ItemPicker";

export interface MergeItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeItemsDialog({ open, onOpenChange }: MergeItemsDialogProps) {
  const [sourceItemId, setSourceItemId] = useState<string | null>(null);
  const [targetItemId, setTargetItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mergeMutation = useMergeItemsMutation();

  function reset() {
    setSourceItemId(null);
    setTargetItemId(null);
    setError(null);
  }

  async function handleMerge() {
    if (!sourceItemId || !targetItemId) return;
    if (sourceItemId === targetItemId) {
      setError(catalogLabels.mergeSameItemError);
      return;
    }
    try {
      await mergeMutation.mutateAsync({ sourceItemId, targetItemId });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : catalogLabels.errors.generic);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      aria-label={catalogLabels.mergeTitle}
    >
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{catalogLabels.mergeTitle}</h2>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="text-muted-foreground text-sm">{catalogLabels.mergeHelp}</p>

        {/* ItemPicker is a composite widget, not a single form control, so this uses a plain
            <span> as a visual label rather than <label> (which lint/a11y/noLabelWithoutControl
            correctly flags without a real htmlFor/id association). */}
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">{catalogLabels.mergeSourceLabel}</span>
          <ItemPicker
            value={sourceItemId}
            onChange={(id) => setSourceItemId(id)}
            allowCreate={false}
          />
        </div>

        <div className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">{catalogLabels.mergeTargetLabel}</span>
          <ItemPicker
            value={targetItemId}
            onChange={(id) => setTargetItemId(id)}
            allowCreate={false}
          />
        </div>

        {error ? <p className="text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={mergeMutation.isPending}
        >
          {catalogLabels.cancel}
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={handleMerge}
          disabled={!sourceItemId || !targetItemId || mergeMutation.isPending}
        >
          {catalogLabels.mergeConfirm}
        </Button>
      </div>
    </Dialog>
  );
}
