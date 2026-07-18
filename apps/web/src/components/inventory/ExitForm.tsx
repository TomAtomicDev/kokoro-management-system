// Dialog for UC-09 "recordStockExit" (Doc 03 §3, Doc 07 SC-08 Salidas tab). Much simpler than
// PurchaseForm: a single item/qty pair, a closed reason enum, no money field at all —
// `unitCostSnapshot` is computed server-side from the item's current WAC (C-6 "invisible cost";
// see packages/shared/src/exits.ts's header comment), never entered here. No session picker for
// the same reason as PurchaseForm.tsx: Sessions (KOK-027) doesn't exist yet, so the schema's
// optional `sessionId` is simply never set from this form. Validated with the exact same
// `recordStockExitCommandSchema` the API route parses with (D-4).

import type { ItemDto } from "@kokoro/shared";
import {
  nowIso,
  recordStockExitCommandSchema,
  STOCK_EXIT_REASONS,
  type StockExitReason,
  toBusinessDate,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useRecordStockExit } from "@/features/inventory/api";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { inventoryLabels } from "@/lib/i18n-inventory";

export interface ExitFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExitForm({ open, onOpenChange }: ExitFormProps) {
  const [itemId, setItemId] = useState<string | null>(null);
  const [item, setItem] = useState<ItemDto | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<StockExitReason>(STOCK_EXIT_REASONS[0]);
  const [businessDate, setBusinessDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useRecordStockExit();

  useEffect(() => {
    if (open) {
      setItemId(null);
      setItem(null);
      setQty("");
      setReason(STOCK_EXIT_REASONS[0]);
      setBusinessDate(toBusinessDate(nowIso()));
      setNotes("");
      setError(null);
    }
  }, [open]);

  const disabled = mutation.isPending;

  async function handleSubmit() {
    setError(null);
    if (!itemId) {
      setError(inventoryLabels.errors.itemRequired);
      return;
    }
    const qtyMilliUnits = parseDecimalToInt(qty, 3);
    if (qtyMilliUnits === null || qtyMilliUnits <= 0) {
      setError(inventoryLabels.errors.invalidQty);
      return;
    }

    const parsed = recordStockExitCommandSchema.safeParse({
      itemId,
      qty: qtyMilliUnits,
      reason,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      occurredAt: nowIso(),
      businessDate,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? inventoryLabels.errors.generic);
      return;
    }

    try {
      await mutation.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : inventoryLabels.errors.generic);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={inventoryLabels.recordExitTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{inventoryLabels.recordExitTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground">{inventoryLabels.fieldItem}</span>
          <ItemPicker
            value={itemId}
            onChange={(id, selected) => {
              setItemId(id);
              setItem(selected);
            }}
            disabled={disabled}
          />
          {item ? (
            <span className="text-muted-foreground text-xs">
              {inventoryLabels.unitAbbrev[item.unit]}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="ef-qty">
              {inventoryLabels.fieldQty}
            </label>
            <Input
              id="ef-qty"
              inputMode="decimal"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="ef-reason">
              {inventoryLabels.fieldReason}
            </label>
            <Select
              id="ef-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as StockExitReason)}
              disabled={disabled}
            >
              {STOCK_EXIT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {inventoryLabels.reasonLabels[r]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="ef-date">
            {inventoryLabels.fieldDate}
          </label>
          <Input
            id="ef-date"
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="ef-notes">
            {inventoryLabels.fieldNotes}
          </label>
          <Input
            id="ef-notes"
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
        <Button type="button" onClick={handleSubmit} disabled={disabled || !itemId}>
          {inventoryLabels.submitExit}
        </Button>
      </div>
    </Dialog>
  );
}
