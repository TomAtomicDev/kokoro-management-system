// Standalone "create item" dialog, factored out of ItemPicker so both the picker's inline-create
// flow and the Catalog screen's own "Nuevo ítem" button share one implementation.

import type { ItemDto, ItemKind } from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCreateItemMutation } from "@/features/catalog/api";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { ApiError } from "@/lib/api";
import { parseCostRateInput } from "@/lib/cost-rate";
import { parseDecimalToInt } from "@/lib/decimal";
import { catalogLabels } from "@/lib/i18n-catalog";

import {
  emptyItemFormValues,
  ITEM_FORM_FIELD_ORDER,
  ItemForm,
  type ItemFormValues,
  type OpeningStockFormValues,
  parseItemFormValues,
  validateItemFormFields,
} from "./ItemForm";

export interface CreateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  kindFilter?: ItemKind;
  allowOpeningStock?: boolean;
  onCreated?: (item: ItemDto) => void;
}

export function CreateItemDialog({
  open,
  onOpenChange,
  initialName = "",
  kindFilter,
  allowOpeningStock = false,
  onCreated,
}: CreateItemDialogProps) {
  const [values, setValues] = useState<ItemFormValues>(() =>
    emptyItemFormValues({ kind: kindFilter }),
  );
  const [openingStock, setOpeningStock] = useState<OpeningStockFormValues>({
    enabled: false,
    qty: "",
    unitCost: "",
  });
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateItemMutation();
  const validation = useFieldValidation();

  // Re-seeds only on the open transition (not on every initialName keystroke while it's open) —
  // the user should be able to keep editing the pre-filled name once the dialog is up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional, see comment above.
  useEffect(() => {
    if (open) {
      setValues({ ...emptyItemFormValues({ kind: kindFilter }), name: initialName });
      setOpeningStock({ enabled: false, qty: "", unitCost: "" });
      setError(null);
      validation.reset();
    }
  }, [open]);

  function openingFieldErrors(): {
    qty?: string;
    unitCost?: string;
  } {
    if (!allowOpeningStock || !openingStock.enabled || values.isUnmetered) return {};

    const errors: { qty?: string; unitCost?: string } = {};
    const qty = parseDecimalToInt(openingStock.qty, 3);
    if (qty === null || qty <= 0) {
      errors.qty =
        openingStock.qty.trim() === ""
          ? catalogLabels.errors.openingQtyRequired
          : catalogLabels.errors.openingQtyInvalid;
    }

    const unitCost = parseCostRateInput(openingStock.unitCost);
    if (!unitCost.ok) {
      errors.unitCost =
        unitCost.reason === "empty"
          ? catalogLabels.errors.openingUnitCostRequired
          : unitCost.reason === "tooManyDecimals"
            ? catalogLabels.errors.openingUnitCostTooManyDecimals
            : unitCost.reason === "notPositive"
              ? catalogLabels.errors.openingUnitCostNotPositive
              : catalogLabels.errors.openingUnitCostInvalid;
    }
    return errors;
  }

  async function handleCreate() {
    const openingErrors = openingFieldErrors();
    const canSubmit = validation.attemptSubmit(
      {
        ...validateItemFormFields(values),
        openingQty: openingErrors.qty,
        openingUnitCost: openingErrors.unitCost,
      },
      [...ITEM_FORM_FIELD_ORDER, "openingQty", "openingUnitCost"],
    );
    if (!canSubmit) return;

    const parsed = parseItemFormValues(values);
    if (!parsed.ok) {
      setError(catalogLabels.errors[parsed.code]);
      return;
    }
    const hasOpeningStock = allowOpeningStock && openingStock.enabled && !values.isUnmetered;
    const openingQty = hasOpeningStock ? parseDecimalToInt(openingStock.qty, 3) : null;
    const openingUnitCost = hasOpeningStock ? parseCostRateInput(openingStock.unitCost) : null;
    let openingCommand: { openingQty?: number; openingUnitCostMc?: number } = {};
    if (hasOpeningStock) {
      if (
        openingQty === null ||
        openingUnitCost === null ||
        !openingUnitCost.ok ||
        openingQty <= 0
      ) {
        return;
      }
      openingCommand = { openingQty, openingUnitCostMc: openingUnitCost.value };
    }
    try {
      const created = await createMutation.mutateAsync({
        ...parsed.value,
        ...openingCommand,
      });
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
          allowOpeningStock={allowOpeningStock}
          openingStock={openingStock}
          onOpeningStockChange={setOpeningStock}
          openingStockErrors={
            validation.submitted
              ? openingFieldErrors()
              : {
                  qty: validation.isVisible("openingQty") ? openingFieldErrors().qty : undefined,
                  unitCost: validation.isVisible("openingUnitCost")
                    ? openingFieldErrors().unitCost
                    : undefined,
                }
          }
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
