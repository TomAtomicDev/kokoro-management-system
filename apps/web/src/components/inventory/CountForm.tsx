// Dialog for UC-10 "startCount" (Doc 03 §3, Doc 07 SC-08 Conteos tab). Optional kind/category
// scope filters — the server ALWAYS additionally restricts to isActive items regardless of these
// filters (see core/inventory/counts.ts's startCount header), so this form doesn't need its own
// active-item awareness. On success, hands the new count's id back to the caller so it can
// immediately open the detail/edit drawer instead of leaving the owner to re-click into the list.
// Validated with the exact same `startCountCommandSchema` the API route parses with (D-4).

import {
  ITEM_CATEGORIES,
  ITEM_KINDS,
  type ItemCategory,
  type ItemKind,
  nowIso,
  startCountCommandSchema,
  toBusinessDate,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useStartCount } from "@/features/inventory/api";
import { ApiError } from "@/lib/api";
import { inventoryLabels } from "@/lib/i18n-inventory";

export interface CountFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (countId: string) => void;
}

export function CountForm({ open, onOpenChange, onStarted }: CountFormProps) {
  const [kind, setKind] = useState<ItemKind | "">("");
  const [category, setCategory] = useState<ItemCategory | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useStartCount();

  useEffect(() => {
    if (open) {
      setKind("");
      setCategory("");
      setNotes("");
      setError(null);
    }
  }, [open]);

  const disabled = mutation.isPending;

  async function handleSubmit() {
    setError(null);

    const parsed = startCountCommandSchema.safeParse({
      kind: kind || undefined,
      category: category || undefined,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      occurredAt: nowIso(),
      businessDate: toBusinessDate(nowIso()),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? inventoryLabels.errors.generic);
      return;
    }

    try {
      const result = await mutation.mutateAsync(parsed.data);
      onOpenChange(false);
      onStarted(result.count.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : inventoryLabels.errors.generic);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={inventoryLabels.startCountTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{inventoryLabels.startCountTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="cf-kind">
              {inventoryLabels.fieldCountKind}
            </label>
            <Select
              id="cf-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ItemKind | "")}
              disabled={disabled}
            >
              <option value="">{inventoryLabels.filterKindAll}</option>
              {ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {inventoryLabels.kindLabels[k]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="cf-category">
              {inventoryLabels.fieldCountCategory}
            </label>
            <Select
              id="cf-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ItemCategory | "")}
              disabled={disabled}
            >
              <option value="">{inventoryLabels.filterCategoryAll}</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {inventoryLabels.categoryLabels[c]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="cf-notes">
            {inventoryLabels.fieldNotes}
          </label>
          <Input
            id="cf-notes"
            placeholder={inventoryLabels.notesPlaceholder}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
          />
        </div>

        {error ? <p className="text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
        >
          {inventoryLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled}>
          {inventoryLabels.startCountSubmit}
        </Button>
      </div>
    </Dialog>
  );
}
