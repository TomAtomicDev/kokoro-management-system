// "Actualizar precio" (SC-12, KOK-036): a single-field dialog, deliberately not `ItemForm` —
// this action only ever touches `items.sale_price`, and the write it triggers (`updateItem`)
// already appends the `price_history` row in the same batch (D-3, see core/catalog/items.ts).

import {
  type MilliCentavosPerUnit,
  rateFromTotal,
  toCentavos,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUpdatePriceMutation } from "@/features/pricing/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { pricingLabels } from "@/lib/i18n-pricing";

export interface UpdatePriceDialogProps {
  itemId: string | null;
  itemName: string | null;
  currentSalePriceMc: MilliCentavosPerUnit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpdatePriceDialog({
  itemId,
  itemName,
  currentSalePriceMc,
  open,
  onOpenChange,
}: UpdatePriceDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdatePriceMutation();

  // Reset/seed whenever a different item's dialog opens — mirrors ItemDetailDrawer's
  // "reset on target change" precedent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional, seeds only on open/item change.
  useEffect(() => {
    if (!open) return;
    setValue(
      currentSalePriceMc === null
        ? ""
        : formatIntAsDecimalInput(totalCentavos(currentSalePriceMc, WHOLE_UNIT_MILLI_UNITS), 2),
    );
    setError(null);
  }, [open, itemId]);

  if (!itemId) return null;

  async function handleSave() {
    if (!itemId) return;
    const trimmed = value.trim();
    let salePriceMc: MilliCentavosPerUnit | null = null;
    if (trimmed !== "") {
      const parsed = parseDecimalToInt(trimmed, 2);
      if (parsed === null || parsed < 0) {
        setError(pricingLabels.errors.invalidPrice);
        return;
      }
      salePriceMc = rateFromTotal(toCentavos(parsed), WHOLE_UNIT_MILLI_UNITS);
    }
    setError(null);
    try {
      await mutation.mutateAsync({ id: itemId, salePriceMc });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : pricingLabels.errors.generic);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      aria-label={pricingLabels.updatePriceDialogTitle}
    >
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">
          {pricingLabels.updatePriceDialogTitle}
        </h2>
        {itemName ? <p className="text-muted-foreground text-sm">{itemName}</p> : null}
      </div>
      <div className="flex flex-col gap-3 px-5 py-4 text-sm">
        <label className="flex flex-col gap-1.5" htmlFor="update-price-value">
          <span className="font-medium text-foreground">{pricingLabels.fieldNewPrice}</span>
          <Input
            id="update-price-value"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={mutation.isPending}
          />
        </label>
        {error ? <p className="text-negative text-sm">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {pricingLabels.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={mutation.isPending}>
            {pricingLabels.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
