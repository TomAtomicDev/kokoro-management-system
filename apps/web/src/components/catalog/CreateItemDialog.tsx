// Standalone "create item" dialog, factored out of ItemPicker so both the picker's inline-create
// flow and the Catalog screen's own "Nuevo ítem" button share one implementation.

import type { ItemDto, ItemKind } from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCreateItemMutation } from "@/features/catalog/api";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { ApiError } from "@/lib/api";
import { catalogLabels } from "@/lib/i18n-catalog";

import {
  emptyItemFormValues,
  ITEM_FORM_FIELD_ORDER,
  ItemForm,
  type ItemFormValues,
  parseItemFormValues,
  validateItemFormFields,
} from "./ItemForm";

export interface CreateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  kindFilter?: ItemKind;
  onCreated?: (item: ItemDto) => void;
}

export function CreateItemDialog({
  open,
  onOpenChange,
  initialName = "",
  kindFilter,
  onCreated,
}: CreateItemDialogProps) {
  const [values, setValues] = useState<ItemFormValues>(() =>
    emptyItemFormValues({ kind: kindFilter }),
  );
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateItemMutation();
  const validation = useFieldValidation();

  // Re-seeds only on the open transition (not on every initialName keystroke while it's open) —
  // the user should be able to keep editing the pre-filled name once the dialog is up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional, see comment above.
  useEffect(() => {
    if (open) {
      setValues({ ...emptyItemFormValues({ kind: kindFilter }), name: initialName });
      setError(null);
      validation.reset();
    }
  }, [open]);

  async function handleCreate() {
    const canSubmit = validation.attemptSubmit(
      validateItemFormFields(values),
      ITEM_FORM_FIELD_ORDER,
    );
    if (!canSubmit) return;

    const parsed = parseItemFormValues(values);
    if (!parsed.ok) {
      setError(catalogLabels.errors[parsed.code]);
      return;
    }
    try {
      const created = await createMutation.mutateAsync(parsed.value);
      onCreated?.(created);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : catalogLabels.errors.generic);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={catalogLabels.createTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{catalogLabels.createTitle}</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <ItemForm
          values={values}
          onChange={setValues}
          disabled={createMutation.isPending}
          validation={validation}
        />
        {error ? <p className="mt-2 text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={createMutation.isPending}
        >
          {catalogLabels.cancel}
        </Button>
        <Button type="button" onClick={handleCreate} disabled={createMutation.isPending}>
          {catalogLabels.create}
        </Button>
      </div>
    </Dialog>
  );
}
