// Dialog for UC-05 "quoteOrder" (Doc 07 SC-04). Mirrors SaleForm.tsx's structure (Dialog wrapper,
// local form state, reset-on-open) minus the replay-confirmation dance — quoting writes no kardex
// movements and no money, so there's nothing R-5 could ever refuse.
//
// `agreedTotal`/`depositRequired` are both optional here (Doc 04 §3.3: "required to confirm", not
// to quote) — a quote may legitimately be opened before the price is settled.

import {
  ORDER_DESCRIPTION_MAX_LENGTH,
  ORDER_NOTES_MAX_LENGTH,
  quoteOrderCommandSchema,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { CustomerPicker } from "@/components/customers/CustomerPicker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useQuoteOrder } from "@/features/orders/api";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { ordersLabels } from "@/lib/i18n-orders";

import { emptyOrderLine, OrderLineEditor, type OrderLineValue } from "./OrderLineEditor";

export interface QuoteOrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuoteOrderForm({ open, onOpenChange }: QuoteOrderFormProps) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [agreedTotal, setAgreedTotal] = useState("");
  const [depositRequired, setDepositRequired] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryPlace, setDeliveryPlace] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OrderLineValue[]>([emptyOrderLine()]);
  const [error, setError] = useState<string | null>(null);

  const quoteMutation = useQuoteOrder();

  useEffect(() => {
    if (open) {
      setCustomerId(null);
      setDescription("");
      setAgreedTotal("");
      setDepositRequired("");
      setDeliveryDate("");
      setDeliveryPlace("");
      setNotes("");
      setLines([emptyOrderLine()]);
      setError(null);
    }
  }, [open]);

  const disabled = quoteMutation.isPending;

  async function handleSubmit() {
    setError(null);
    if (!customerId) {
      setError(ordersLabels.errors.customerRequired);
      return;
    }

    const parsedAgreedTotal =
      agreedTotal.trim() === "" ? undefined : parseDecimalToInt(agreedTotal, 2);
    if (agreedTotal.trim() !== "" && parsedAgreedTotal === null) {
      setError(ordersLabels.errors.generic);
      return;
    }
    const parsedDepositRequired =
      depositRequired.trim() === "" ? undefined : parseDecimalToInt(depositRequired, 2);
    if (depositRequired.trim() !== "" && parsedDepositRequired === null) {
      setError(ordersLabels.errors.generic);
      return;
    }

    const parsedLines: {
      itemId?: string;
      description?: string;
      qty: number;
      lineTotal?: number;
    }[] = [];
    for (const line of lines) {
      if (line.itemId === null && line.description.trim() === "") continue; // skip fully-empty rows
      const qty = parseDecimalToInt(line.qty, 3);
      if (qty === null || qty <= 0) {
        setError(ordersLabels.errors.generic);
        return;
      }
      const lineTotal =
        line.lineTotal.trim() === "" ? undefined : parseDecimalToInt(line.lineTotal, 2);
      if (line.lineTotal.trim() !== "" && lineTotal === null) {
        setError(ordersLabels.errors.generic);
        return;
      }
      parsedLines.push({
        itemId: line.itemId ?? undefined,
        description: line.description.trim() === "" ? undefined : line.description.trim(),
        qty,
        lineTotal: lineTotal ?? undefined,
      });
    }

    const parsed = quoteOrderCommandSchema.safeParse({
      customerId,
      description: description.trim(),
      agreedTotal: parsedAgreedTotal ?? undefined,
      depositRequired: parsedDepositRequired ?? undefined,
      deliveryDate: deliveryDate === "" ? undefined : deliveryDate,
      deliveryPlace: deliveryPlace.trim() === "" ? undefined : deliveryPlace.trim(),
      notes: notes.trim() === "" ? undefined : notes.trim(),
      lines: parsedLines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ordersLabels.errors.generic);
      return;
    }

    try {
      await quoteMutation.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ordersLabels.errors.generic);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={ordersLabels.quoteTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{ordersLabels.quoteTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground text-sm">{ordersLabels.fieldCustomer}</span>
          <CustomerPicker
            value={customerId}
            onChange={(id) => setCustomerId(id)}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="qo-description">
            {ordersLabels.fieldDescription}
          </label>
          <Input
            id="qo-description"
            placeholder={ordersLabels.descriptionPlaceholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            maxLength={ORDER_DESCRIPTION_MAX_LENGTH}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="qo-total">
              {ordersLabels.fieldAgreedTotal}
            </label>
            <Input
              id="qo-total"
              inputMode="decimal"
              placeholder="0.00"
              value={agreedTotal}
              onChange={(e) => setAgreedTotal(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="qo-deposit">
              {ordersLabels.fieldDepositRequired}
            </label>
            <Input
              id="qo-deposit"
              inputMode="decimal"
              placeholder="0.00"
              value={depositRequired}
              onChange={(e) => setDepositRequired(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="qo-date">
              {ordersLabels.fieldDeliveryDate}
            </label>
            <Input
              id="qo-date"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="qo-place">
              {ordersLabels.fieldDeliveryPlace}
            </label>
            <Input
              id="qo-place"
              value={deliveryPlace}
              onChange={(e) => setDeliveryPlace(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="qo-notes">
            {ordersLabels.fieldNotes}
          </label>
          <Input
            id="qo-notes"
            placeholder={ordersLabels.notesPlaceholder}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
            maxLength={ORDER_NOTES_MAX_LENGTH}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground">{ordersLabels.linesTitle}</span>
          <p className="text-muted-foreground text-xs">{ordersLabels.linesHint}</p>
          <OrderLineEditor lines={lines} onChange={setLines} disabled={disabled} />
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
          {ordersLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled || !customerId}>
          {ordersLabels.submit}
        </Button>
      </div>
    </Dialog>
  );
}
