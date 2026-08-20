// Full-page form for UC-05 "quoteOrder" (Doc 07 SC-04, KOK-141). Mirrors SaleForm.tsx's structure
// (FormPage shell, local form state, route-mounted draft) minus the replay-confirmation dance —
// quoting writes no kardex movements and no money, so there's nothing R-5 could ever refuse, and
// the footer carries no destination-account line (unlike Compra/Venta, a quote moves no cash).
//
// `agreedTotal`/`depositRequired` are both optional here (Doc 04 §3.3: "required to confirm", not
// to quote) — a quote may legitimately be started before the price is settled.

import {
  formatMoney,
  ORDER_DESCRIPTION_MAX_LENGTH,
  ORDER_NOTES_MAX_LENGTH,
  quoteOrderCommandSchema,
  toCentavos,
} from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { FormPage } from "@/components/common/FormPage";
import { PinnedSummaryFooter } from "@/components/common/PinnedSummaryFooter";
import { CustomerPicker } from "@/components/customers/CustomerPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuoteOrder } from "@/features/orders/api";
import {
  clearPersistentDraft,
  readPersistentDraft,
  writePersistentDraft,
} from "@/hooks/usePersistentDraft";
import { hasUnsavedChanges, useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { ordersLabels } from "@/lib/i18n-orders";

import { emptyOrderLine, OrderLineEditor, type OrderLineValue } from "./OrderLineEditor";

const DRAFT_KEY = "order:new";

interface QuoteOrderFormState {
  customerId: string | null;
  description: string;
  agreedTotal: string;
  depositRequired: string;
  deliveryDate: string;
  deliveryPlace: string;
  notes: string;
  lines: OrderLineValue[];
}

function defaultFormState(): QuoteOrderFormState {
  return {
    customerId: null,
    description: "",
    agreedTotal: "",
    depositRequired: "",
    deliveryDate: "",
    deliveryPlace: "",
    notes: "",
    lines: [emptyOrderLine()],
  };
}

export function QuoteOrderForm() {
  const navigate = useNavigate();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [agreedTotal, setAgreedTotal] = useState("");
  const [depositRequired, setDepositRequired] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryPlace, setDeliveryPlace] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OrderLineValue[]>([emptyOrderLine()]);
  const [error, setError] = useState<string | null>(null);
  const initialFormStateRef = useRef<QuoteOrderFormState | null>(null);
  const initializedRef = useRef(false);

  const currentFormState: QuoteOrderFormState = {
    customerId,
    description,
    agreedTotal,
    depositRequired,
    deliveryDate,
    deliveryPlace,
    notes,
    lines,
  };
  const unsavedChangesGuard = useUnsavedChangesGuard({
    isDirty:
      initialFormStateRef.current !== null &&
      hasUnsavedChanges(initialFormStateRef.current, currentFormState),
    blockNavigation: true,
  });

  const quoteMutation = useQuoteOrder();

  useEffect(() => {
    if (initializedRef.current) return;
    const savedDraft = readPersistentDraft<QuoteOrderFormState>(DRAFT_KEY);
    const initialFormState = savedDraft ?? defaultFormState();
    setCustomerId(initialFormState.customerId);
    setDescription(initialFormState.description);
    setAgreedTotal(initialFormState.agreedTotal);
    setDepositRequired(initialFormState.depositRequired);
    setDeliveryDate(initialFormState.deliveryDate);
    setDeliveryPlace(initialFormState.deliveryPlace);
    setNotes(initialFormState.notes);
    setLines(initialFormState.lines);
    initialFormStateRef.current = initialFormState;
    initializedRef.current = true;
  }, []);

  useEffect(() => {
    if (!initializedRef.current) return;
    writePersistentDraft<QuoteOrderFormState>(DRAFT_KEY, {
      customerId,
      description,
      agreedTotal,
      depositRequired,
      deliveryDate,
      deliveryPlace,
      notes,
      lines,
    });
  }, [
    agreedTotal,
    customerId,
    deliveryDate,
    deliveryPlace,
    depositRequired,
    description,
    lines,
    notes,
  ]);

  const disabled = quoteMutation.isPending;

  // Informational only — quoting moves no money (Doc 04 §3.3), so this is a live preview of what
  // the owner typed, not a value the server recomputes/enforces the way Sale/Purchase totals are.
  const linesTotalPreview = useMemo(() => {
    let sum = 0;
    for (const line of lines) {
      const lineTotal = line.lineTotal.trim() === "" ? null : parseDecimalToInt(line.lineTotal, 2);
      if (lineTotal !== null) sum += lineTotal;
    }
    return sum;
  }, [lines]);
  const parsedAgreedTotalPreview =
    agreedTotal.trim() === "" ? null : parseDecimalToInt(agreedTotal, 2);
  const totalPreview = parsedAgreedTotalPreview ?? linesTotalPreview;

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
      clearPersistentDraft(DRAFT_KEY);
      unsavedChangesGuard.markClean();
      void navigate({ to: "/orders" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ordersLabels.errors.generic);
    }
  }

  return (
    <FormPage
      title={ordersLabels.quoteTitle}
      backTo="/orders"
      backLabel={ordersLabels.backToOrders}
      footer={
        <PinnedSummaryFooter
          contentClassName="max-w-3xl px-0"
          total={
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-4 py-2">
              <span className="font-medium text-foreground text-sm">
                {ordersLabels.fieldAgreedTotal}
              </span>
              <span className="numeric-cell font-semibold text-foreground text-lg">
                {formatMoney(toCentavos(totalPreview))}
              </span>
            </div>
          }
          warnings={error ? <p className="text-negative text-sm">{error}</p> : undefined}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  clearPersistentDraft(DRAFT_KEY);
                  unsavedChangesGuard.markClean();
                  void navigate({ to: "/orders" });
                }}
                disabled={disabled}
              >
                {ordersLabels.cancel}
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={disabled || !customerId}>
                {ordersLabels.submit}
              </Button>
            </>
          }
        />
      }
    >
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
    </FormPage>
  );
}
