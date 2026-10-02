// Full-page form for UC-05 "quoteOrder" (Doc 07 SC-04, KOK-141). Mirrors SaleForm.tsx's structure
// (FormPage shell, local form state, route-mounted draft) minus the replay-confirmation dance —
// quoting writes no kardex movements and no money, so there's nothing R-5 could ever refuse, and
// the footer carries no destination-account line (unlike Compra/Venta, a quote moves no cash).
//
// The merchandise subtotal is optional until confirmation; the additional customer charge is
// separate from merchandise lines and never implies a payment.

import type { OrderDto } from "@kokoro/shared";
import {
  allocateAgreedTotalToOrderLines,
  calculateOrderReceiptBalance,
  formatMoney,
  ORDER_DESCRIPTION_MAX_LENGTH,
  ORDER_NOTES_MAX_LENGTH,
  quoteOrderCommandSchema,
  toCentavos,
  updateOrderCommandSchema,
} from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { FormPage } from "@/components/common/FormPage";
import { PinnedSummaryFooter } from "@/components/common/PinnedSummaryFooter";
import { CustomerPicker } from "@/components/customers/CustomerPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOrderReceiptSummary, useQuoteOrder, useUpdateOrder } from "@/features/orders/api";
import {
  clearPersistentDraft,
  readPersistentDraft,
  writePersistentDraft,
} from "@/hooks/usePersistentDraft";
import { hasUnsavedChanges, useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { ordersLabels } from "@/lib/i18n-orders";

import { emptyOrderLine, OrderLineEditor, type OrderLineValue } from "./OrderLineEditor";

const DRAFT_KEY = "order:new";

interface QuoteOrderFormState {
  customerId: string | null;
  description: string;
  agreedTotal: string;
  additionalCharge: string;
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
    additionalCharge: "0",
    deliveryDate: "",
    deliveryPlace: "",
    notes: "",
    lines: [emptyOrderLine()],
  };
}

function formStateFromOrder(order: OrderDto): QuoteOrderFormState {
  return {
    customerId: order.customerId,
    description: order.description,
    agreedTotal: order.agreedTotal === null ? "" : formatIntAsDecimalInput(order.agreedTotal, 2),
    additionalCharge: formatIntAsDecimalInput(order.additionalCharge, 2),
    deliveryDate: order.deliveryDate ?? "",
    deliveryPlace: order.deliveryPlace ?? "",
    notes: order.notes ?? "",
    lines:
      order.lines.length === 0
        ? []
        : order.lines.map((line) => ({
            itemId: line.itemId,
            description: line.description ?? "",
            qty: formatIntAsDecimalInput(line.qty, 3),
            lineTotal: line.lineTotal === null ? "" : formatIntAsDecimalInput(line.lineTotal, 2),
          })),
  };
}

export function QuoteOrderForm({
  order,
  backSearch,
}: {
  order?: OrderDto;
  backSearch?: Record<string, unknown>;
}) {
  const isEdit = order !== undefined;
  const navigate = useNavigate();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [agreedTotal, setAgreedTotal] = useState("");
  const [additionalCharge, setAdditionalCharge] = useState("0");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryPlace, setDeliveryPlace] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OrderLineValue[]>([emptyOrderLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const initialFormStateRef = useRef<QuoteOrderFormState | null>(null);
  const expectedUpdatedAtRef = useRef(order?.updatedAt ?? null);
  const initializedRef = useRef(false);

  const currentFormState: QuoteOrderFormState = {
    customerId,
    description,
    agreedTotal,
    additionalCharge,
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
  const updateMutation = useUpdateOrder(order?.id ?? "");
  const receiptSummaryQuery = useOrderReceiptSummary(order?.id);

  useEffect(() => {
    if (initializedRef.current) return;
    const savedDraft = order ? null : readPersistentDraft<QuoteOrderFormState>(DRAFT_KEY);
    const defaultState = defaultFormState();
    const initialFormState = order
      ? formStateFromOrder(order)
      : savedDraft
        ? { ...defaultState, ...savedDraft, additionalCharge: savedDraft.additionalCharge ?? "0" }
        : defaultState;
    setCustomerId(initialFormState.customerId);
    setDescription(initialFormState.description);
    setAgreedTotal(initialFormState.agreedTotal);
    setAdditionalCharge(initialFormState.additionalCharge);
    setDeliveryDate(initialFormState.deliveryDate);
    setDeliveryPlace(initialFormState.deliveryPlace);
    setNotes(initialFormState.notes);
    setLines(initialFormState.lines);
    initialFormStateRef.current = initialFormState;
    initializedRef.current = true;
  }, [order]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (!order) {
      writePersistentDraft<QuoteOrderFormState>(DRAFT_KEY, {
        customerId,
        description,
        agreedTotal,
        additionalCharge,
        deliveryDate,
        deliveryPlace,
        notes,
        lines,
      });
    }
  }, [
    additionalCharge,
    agreedTotal,
    customerId,
    deliveryDate,
    deliveryPlace,
    description,
    lines,
    notes,
    order,
  ]);

  const disabled = quoteMutation.isPending || updateMutation.isPending;
  const parsedAgreedTotalPreview =
    agreedTotal.trim() === "" ? null : parseDecimalToInt(agreedTotal, 2);
  const parsedAdditionalChargePreview =
    additionalCharge.trim() === "" ? 0 : parseDecimalToInt(additionalCharge, 2);
  const qualifyingReceipts = receiptSummaryQuery.data?.qualifyingReceipts ?? 0;
  const receiptBalancePreview =
    parsedAdditionalChargePreview === null || (isEdit && receiptSummaryQuery.data === undefined)
      ? null
      : (() => {
          try {
            return calculateOrderReceiptBalance(
              parsedAgreedTotalPreview,
              parsedAdditionalChargePreview,
              qualifyingReceipts,
            );
          } catch {
            return null;
          }
        })();
  const customerAmountOutOfRange =
    parsedAgreedTotalPreview !== null &&
    parsedAdditionalChargePreview !== null &&
    (!isEdit || receiptSummaryQuery.data !== undefined) &&
    receiptBalancePreview === null;
  const customerLocked = receiptSummaryQuery.data?.hasEverQualifyingReceipt ?? false;
  const customerPickerDisabled =
    disabled ||
    (isEdit &&
      (receiptSummaryQuery.isLoading ||
        receiptSummaryQuery.isFetching ||
        receiptSummaryQuery.isError ||
        customerLocked));

  async function handleSubmit() {
    setError(null);
    setSaved(false);
    if (!customerId) {
      setError(ordersLabels.errors.customerRequired);
      return;
    }

    const parsedAgreedTotal = agreedTotal.trim() === "" ? null : parseDecimalToInt(agreedTotal, 2);
    if (agreedTotal.trim() !== "" && parsedAgreedTotal === null) {
      setError(ordersLabels.errors.generic);
      return;
    }
    if (parsedAgreedTotal !== null && parsedAgreedTotal < 0) {
      setError(ordersLabels.errors.generic);
      return;
    }
    if (isEdit && order.status !== "QUOTING" && parsedAgreedTotal === null) {
      setError(ordersLabels.errors.agreedTotalRequired);
      return;
    }
    const parsedAdditionalCharge =
      additionalCharge.trim() === "" ? 0 : parseDecimalToInt(additionalCharge, 2);
    if (parsedAdditionalCharge === null || parsedAdditionalCharge < 0) {
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

    if (
      parsedAgreedTotal !== null &&
      parsedLines.length > 0 &&
      allocateAgreedTotalToOrderLines(
        toCentavos(parsedAgreedTotal),
        parsedLines.map((line) => ({ qty: line.qty, lineTotal: line.lineTotal })),
      ) === null
    ) {
      setError(ordersLabels.errors.linesNotAllocatable);
      return;
    }

    try {
      if (isEdit) {
        const parsed = updateOrderCommandSchema.safeParse({
          expectedUpdatedAt: expectedUpdatedAtRef.current ?? order.updatedAt,
          customerId,
          description: description.trim(),
          agreedTotal: parsedAgreedTotal,
          additionalCharge: parsedAdditionalCharge,
          deliveryDate: deliveryDate === "" ? null : deliveryDate,
          deliveryPlace: deliveryPlace.trim() === "" ? null : deliveryPlace.trim(),
          notes: notes.trim() === "" ? null : notes.trim(),
          lines: parsedLines.map((line) => ({
            itemId: line.itemId ?? null,
            description: line.description ?? null,
            qty: line.qty,
            lineTotal: line.lineTotal ?? null,
          })),
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? ordersLabels.errors.generic);
          return;
        }

        const result = await updateMutation.mutateAsync(parsed.data);
        const nextState = formStateFromOrder(result.order);
        expectedUpdatedAtRef.current = result.order.updatedAt;
        initialFormStateRef.current = nextState;
        setCustomerId(nextState.customerId);
        setDescription(nextState.description);
        setAgreedTotal(nextState.agreedTotal);
        setAdditionalCharge(nextState.additionalCharge);
        setDeliveryDate(nextState.deliveryDate);
        setDeliveryPlace(nextState.deliveryPlace);
        setNotes(nextState.notes);
        setLines(nextState.lines);
        await receiptSummaryQuery.refetch();
        unsavedChangesGuard.markClean();
        setSaved(true);
      } else {
        const parsed = quoteOrderCommandSchema.safeParse({
          customerId,
          description: description.trim(),
          agreedTotal: parsedAgreedTotal ?? undefined,
          additionalCharge: parsedAdditionalCharge,
          deliveryDate: deliveryDate === "" ? undefined : deliveryDate,
          deliveryPlace: deliveryPlace.trim() === "" ? undefined : deliveryPlace.trim(),
          notes: notes.trim() === "" ? undefined : notes.trim(),
          lines: parsedLines,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? ordersLabels.errors.generic);
          return;
        }
        await quoteMutation.mutateAsync(parsed.data);
        clearPersistentDraft(DRAFT_KEY);
        unsavedChangesGuard.markClean();
        void navigate({ to: "/orders" });
      }
    } catch (err) {
      if (!(err instanceof ApiError)) setError(ordersLabels.errors.generic);
    }
  }

  return (
    <FormPage
      title={isEdit ? ordersLabels.editTitle : ordersLabels.quoteTitle}
      backTo="/orders"
      backLabel={ordersLabels.backToOrders}
      backSearch={backSearch}
      footer={
        <PinnedSummaryFooter
          contentClassName="max-w-3xl px-0"
          total={
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-4 py-2">
              <span className="font-medium text-foreground text-sm">
                {ordersLabels.customerAmount}
              </span>
              <span className="numeric-cell font-semibold text-foreground text-lg">
                {receiptBalancePreview?.customerAmount !== null &&
                receiptBalancePreview?.customerAmount !== undefined
                  ? formatMoney(toCentavos(receiptBalancePreview.customerAmount))
                  : customerAmountOutOfRange
                    ? ordersLabels.customerAmountOutOfRange
                    : isEdit && receiptSummaryQuery.isLoading
                      ? ordersLabels.receiptSummaryLoading
                      : ordersLabels.noAgreedTotal}
              </span>
            </div>
          }
          warnings={
            error ? (
              <p className="text-negative text-sm">{error}</p>
            ) : saved ? (
              <p className="text-positive text-sm">{ordersLabels.saved}</p>
            ) : undefined
          }
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!isEdit) clearPersistentDraft(DRAFT_KEY);
                  unsavedChangesGuard.markClean();
                  void navigate(
                    backSearch ? { to: "/orders", search: backSearch } : { to: "/orders" },
                  );
                }}
                disabled={disabled}
              >
                {ordersLabels.cancel}
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={disabled || !customerId}>
                {isEdit ? ordersLabels.save : ordersLabels.submit}
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
          onChange={(id) => {
            setCustomerId(id);
            setSaved(false);
          }}
          disabled={customerPickerDisabled}
        />
        {isEdit && customerLocked ? (
          <p className="text-muted-foreground text-xs">{ordersLabels.customerLocked}</p>
        ) : null}
        {isEdit && receiptSummaryQuery.isError ? (
          <div className="flex items-center gap-2 text-negative text-xs">
            <span>{ordersLabels.receiptSummaryError}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void receiptSummaryQuery.refetch()}
            >
              {ordersLabels.retry}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-foreground" htmlFor="qo-description">
          {ordersLabels.fieldDescription}
        </label>
        <Input
          id="qo-description"
          placeholder={ordersLabels.descriptionPlaceholder}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(false);
          }}
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
            onChange={(e) => {
              setAgreedTotal(e.target.value);
              setSaved(false);
            }}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="qo-additional-charge">
            {ordersLabels.fieldAdditionalCharge}
          </label>
          <Input
            id="qo-additional-charge"
            inputMode="decimal"
            placeholder="0.00"
            value={additionalCharge}
            onChange={(e) => {
              setAdditionalCharge(e.target.value);
              setSaved(false);
            }}
            disabled={disabled}
          />
        </div>
      </div>

      {isEdit ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{ordersLabels.qualifyingReceipts}</span>
            <span className="numeric-cell font-medium text-foreground">
              {receiptSummaryQuery.data
                ? formatMoney(toCentavos(receiptSummaryQuery.data.qualifyingReceipts))
                : receiptSummaryQuery.isLoading
                  ? ordersLabels.receiptSummaryLoading
                  : "—"}
            </span>
          </div>
          {receiptBalancePreview?.expected !== null &&
          receiptBalancePreview?.expected !== undefined ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{ordersLabels.draftExpectedBalance}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {formatMoney(toCentavos(receiptBalancePreview.expected))}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{ordersLabels.draftExcess}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {formatMoney(toCentavos(receiptBalancePreview.excess ?? 0))}
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-xs">
              {customerAmountOutOfRange
                ? ordersLabels.customerAmountOutOfRange
                : isEdit && receiptSummaryQuery.isLoading
                  ? ordersLabels.receiptSummaryLoading
                  : isEdit && receiptSummaryQuery.isError
                    ? ordersLabels.receiptSummaryError
                    : ordersLabels.receiptPreviewNoAgreement}
            </p>
          )}
          <p className="text-muted-foreground text-xs">{ordersLabels.receiptPreviewInfo}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="qo-date">
            {ordersLabels.fieldDeliveryDate}
          </label>
          <Input
            id="qo-date"
            type="date"
            value={deliveryDate}
            onChange={(e) => {
              setDeliveryDate(e.target.value);
              setSaved(false);
            }}
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
            onChange={(e) => {
              setDeliveryPlace(e.target.value);
              setSaved(false);
            }}
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
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          disabled={disabled}
          maxLength={ORDER_NOTES_MAX_LENGTH}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-foreground">{ordersLabels.linesTitle}</span>
        <p className="text-muted-foreground text-xs">{ordersLabels.linesHint}</p>
        <OrderLineEditor
          lines={lines}
          onChange={(nextLines) => {
            setLines(nextLines);
            setSaved(false);
          }}
          disabled={disabled}
        />
      </div>
    </FormPage>
  );
}
