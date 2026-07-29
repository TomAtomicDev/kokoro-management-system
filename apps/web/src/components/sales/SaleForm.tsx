// Dialog for UC-03 "recordSale" (Doc 07 SC-03) + UC-18 edit (KOK-064). Mirrors PurchaseForm.tsx's
// structure (Dialog wrapper, local form state, reset-on-open, edit-mode prefill, both branches
// wrapped in useReplayConfirmableMutation so a genuinely backdated sale â€” new or edited â€” gets the
// R-5 confirmation dance, KOK-065's pattern reused rather than re-derived). No receipt photo (sales
// never had one). Adds what purchases doesn't need: a paymentStatus toggle that conditionally
// requires method+account (mirrors `recordSaleCommandSchema`'s discriminated union, D-4), and
// two per-line warnings (stock-negative amber, INV-8; below-replacement-cost red, C-5).
//
// `updateSaleCommandSchema` is a bare alias of `recordSaleCommandSchema` (packages/shared/src/
// sales.ts) â€” like PurchaseForm, this parses both branches with the ONE schema import.
//
// `customerId` is optional and wired via CustomerPicker now that customers CRUD (KOK-032) has
// shipped. Still no session picker: no SessionPicker component exists anywhere in this codebase
// yet, so `sessionId` is simply never set from this form (same gap every other form has).

import type {
  FinancialAccountDto,
  ItemDto,
  RecordSaleCommand,
  RecordSaleResult,
  SaleDto,
  UpdateSaleCommand,
  UpdateSaleResult,
} from "@kokoro/shared";
import {
  formatMoney,
  nowIso,
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentStatus,
  rateFromTotal,
  recordSaleCommandSchema,
  toBusinessDate,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { useEffect, useMemo, useState } from "react";

import { CustomerPicker } from "@/components/customers/CustomerPicker";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useItemsQuery } from "@/features/catalog/api";
import { useStock } from "@/features/inventory/api";
import { useRecordSale, useUpdateSale } from "@/features/sales/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { salesLabels } from "@/lib/i18n-sales";

export interface SaleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
  /** Present -> edit mode: prefill from this sale and submit via `useUpdateSale`. Absent -> create
   * mode, submits via `useRecordSale`. Both branches wrapped in `useReplayConfirmableMutation`. */
  sale?: SaleDto;
}

interface SaleLineValue extends LineEditorLine {
  itemId: string | null;
  /** Milli-units decimal string (scale 3) â€” same convention as PurchaseForm's line qty. */
  qty: string;
  /** Unit price, centavos-per-WHOLE-unit decimal string (scale 2) â€” editable, prefilled from
   * `item.salePriceMc` the moment an item is picked (SC-03). Reused as `LineEditor`'s generic
   * `amount` slot; here it means "price per unit", not "line total" (purchases' meaning). */
  amount: string;
}

function emptyLine(): SaleLineValue {
  return { itemId: null, qty: "", amount: "" };
}

interface SaleFormState {
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  accountId: string;
  customerId: string | null;
  businessDate: string;
  notes: string;
  lines: SaleLineValue[];
}

/**
 * Maps a fetched `SaleDto` (KOK-064 edit mode) to the form's editable local state. Pure and
 * framework-free on purpose â€” same rationale as `purchaseToFormState` (PurchaseForm.tsx): this
 * workspace has neither jsdom nor @testing-library/react, so a plain exported function is what
 * stays unit-testable without rendering the component.
 */
export function saleToFormState(sale: SaleDto, accounts: FinancialAccountDto[]): SaleFormState {
  return {
    paymentStatus: sale.paymentStatus,
    paymentMethod: sale.paymentMethod ?? (PAYMENT_METHODS[0] as PaymentMethod),
    accountId: sale.accountId ?? accounts[0]?.id ?? "",
    customerId: sale.customerId,
    businessDate: sale.businessDate,
    notes: sale.notes ?? "",
    lines:
      sale.lines.length > 0
        ? sale.lines.map((line) => ({
            itemId: line.itemId,
            qty: formatIntAsDecimalInput(line.qty, 3),
            amount: formatIntAsDecimalInput(
              totalCentavos(line.unitPriceMc, WHOLE_UNIT_MILLI_UNITS),
              2,
            ),
          }))
        : [emptyLine()],
  };
}

export function SaleForm({ open, onOpenChange, accounts, sale }: SaleFormProps) {
  const isEditMode = Boolean(sale);

  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("PAID");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    PAYMENT_METHODS[0] as PaymentMethod,
  );
  const [accountId, setAccountId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SaleLineValue[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useRecordSale();
  const createReplay = useReplayConfirmableMutation<RecordSaleCommand, RecordSaleResult>(
    (command) => createMutation.mutateAsync(command),
    { onSuccess: () => onOpenChange(false) },
  );
  // Called unconditionally (rules of hooks) even in create mode â€” `sale?.id` is only "" then, and
  // the mutation is never actually invoked unless `isEditMode` is true (see handleSubmit).
  const updateMutation = useUpdateSale(sale?.id ?? "");
  const editReplay = useReplayConfirmableMutation<UpdateSaleCommand, UpdateSaleResult>(
    (command) => updateMutation.mutateAsync(command),
    { onSuccess: () => onOpenChange(false) },
  );

  const itemsQuery = useItemsQuery({ isActive: true, kind: "FINISHED" });
  const itemsById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  // Current on-hand qty per item (v_stock, INV-5) â€” used for the amber "stock would go negative"
  // warning below. Unfiltered (all kinds): fine to fetch the whole table at this app's scale, same
  // precedent as PurchaseForm's unfiltered useItemsQuery for its own line lookups.
  const stockQuery = useStock();
  const onHandByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQuery.data?.stock ?? []) map.set(row.itemId, row.qtyOnHand);
    return map;
  }, [stockQuery.data]);

  // Reset only on the open transition (or a switch to a different sale while open) â€” `sale?.id`
  // stands in for `sale` itself so a background refetch of the SAME sale never clobbers
  // in-progress edits, mirroring PurchaseForm's identical precedent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset-on-open precedent, see above.
  useEffect(() => {
    if (open) {
      if (sale) {
        const initial = saleToFormState(sale, accounts);
        setPaymentStatus(initial.paymentStatus);
        setPaymentMethod(initial.paymentMethod);
        setAccountId(initial.accountId);
        setCustomerId(initial.customerId);
        setBusinessDate(initial.businessDate);
        setNotes(initial.notes);
        setLines(initial.lines);
      } else {
        setPaymentStatus("PAID");
        setPaymentMethod(PAYMENT_METHODS[0] as PaymentMethod);
        setAccountId(accounts[0]?.id ?? "");
        setCustomerId(null);
        setBusinessDate(toBusinessDate(nowIso()));
        setNotes("");
        setLines([emptyLine()]);
      }
      setError(null);
    }
  }, [open, sale?.id]);

  const disabled = isEditMode ? editReplay.isPending : createReplay.isPending;
  const isPaid = paymentStatus === "PAID";

  /** Prefills a line's unit price from the item's catalog `salePriceMc` the moment the item changes
   * and the price field is still blank â€” editable afterward, never overwritten again (same
   * "convenience default, not sticky" rule as ProductionRunForm's recipe-line prefill). LineEditor
   * itself only forwards `itemId` to its `onChange` (see LineEditor.tsx), so the lookup happens
   * here, against the previous line at the same index, rather than inside LineEditor. */
  function handleLinesChange(nextLines: SaleLineValue[]) {
    const withPrefill = nextLines.map((line, index) => {
      const prevItemId = lines[index]?.itemId ?? null;
      if (line.itemId && line.itemId !== prevItemId && line.amount.trim() === "") {
        const item = itemsById.get(line.itemId);
        if (item?.salePriceMc != null) {
          return {
            ...line,
            amount: formatIntAsDecimalInput(
              totalCentavos(item.salePriceMc, WHOLE_UNIT_MILLI_UNITS),
              2,
            ),
          };
        }
      }
      return line;
    });
    setLines(withPrefill);
  }

  // Aggregate requested qty per item across ALL lines (a sale can list the same FINISHED item
  // twice) â€” INV-8's negative-stock check is about the item's post-sale balance, not any one line
  // in isolation.
  const qtyByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      if (!line.itemId) continue;
      const qty = parseDecimalToInt(line.qty, 3);
      if (qty === null || qty <= 0) continue;
      map.set(line.itemId, (map.get(line.itemId) ?? 0) + qty);
    }
    return map;
  }, [lines]);

  const totalPreview = useMemo(() => {
    let sum = 0;
    for (const line of lines) {
      const qty = parseDecimalToInt(line.qty, 3);
      const unitPrice = parseDecimalToInt(line.amount, 2);
      if (qty === null || qty <= 0 || unitPrice === null) continue;
      sum += totalCentavos(
        rateFromTotal(toCentavos(unitPrice), WHOLE_UNIT_MILLI_UNITS),
        toMilliUnits(qty),
      );
    }
    return sum;
  }, [lines]);

  async function handleSubmit() {
    setError(null);
    if (isPaid && !accountId) {
      setError(salesLabels.errors.accountRequired);
      return;
    }

    const parsedLines: { itemId: string; qty: number; unitPriceMc: number }[] = [];
    for (const line of lines) {
      const qty = parseDecimalToInt(line.qty, 3);
      const unitPrice = parseDecimalToInt(line.amount, 2);
      if (!line.itemId || qty === null || qty <= 0 || unitPrice === null) {
        setError(salesLabels.errors.invalidLine);
        return;
      }
      parsedLines.push({
        itemId: line.itemId,
        qty,
        unitPriceMc: rateFromTotal(toCentavos(unitPrice), WHOLE_UNIT_MILLI_UNITS),
      });
    }

    const commonFields = {
      customerId: customerId ?? undefined,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      // Edit mode keeps the sale's original instant â€” there's no UI field to change it, and an
      // edit re-stamping `occurredAt` to "now" would rewrite when the sale actually happened every
      // time the owner fixes an unrelated typo (mirrors PurchaseForm's identical precedent).
      occurredAt: sale ? sale.occurredAt : nowIso(),
      businessDate,
      lines: parsedLines,
    };

    const commandInput = isPaid
      ? { paymentStatus: "PAID" as const, paymentMethod, accountId, ...commonFields }
      : { paymentStatus: "ON_CREDIT" as const, ...commonFields };

    const parsed = recordSaleCommandSchema.safeParse(commandInput);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? salesLabels.errors.generic);
      return;
    }

    if (isEditMode) {
      editReplay.execute(parsed.data);
      return;
    }

    createReplay.execute(parsed.data);
  }

  /** Combines client-side validation errors (`error` state) with a genuine (non-confirmation)
   * failure surfaced by `editReplay`/`createReplay` â€” the confirmation case is captured into
   * their own `pendingConfirmation` instead and never reaches here (see
   * useReplayConfirmableMutation.ts's header). */
  const activeReplay = isEditMode ? editReplay : createReplay;
  const displayError =
    error ??
    (activeReplay.error
      ? activeReplay.error instanceof ApiError
        ? activeReplay.error.message
        : salesLabels.errors.generic
      : null);

  function renderLineExtra(line: SaleLineValue) {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    if (!item) return null;

    const qty = parseDecimalToInt(line.qty, 3);
    const unitPrice = parseDecimalToInt(line.amount, 2);
    const subtotal =
      qty !== null && qty > 0 && unitPrice !== null
        ? totalCentavos(
            rateFromTotal(toCentavos(unitPrice), WHOLE_UNIT_MILLI_UNITS),
            toMilliUnits(qty),
          )
        : null;

    const onHand = onHandByItemId.get(item.id) ?? 0;
    const requested = qtyByItemId.get(item.id) ?? 0;
    const negativeStockWarning = requested > 0 && onHand - requested < 0;

    // Convert the decimal-input centavos to the same `_mc` rate scale as replacementCostMc before
    // comparing; both stored rates are dimensionally identical (ADR-017).
    const belowReplacementWarning =
      unitPrice !== null &&
      item.replacementCostMc > 0 &&
      rateFromTotal(toCentavos(unitPrice), WHOLE_UNIT_MILLI_UNITS) <
        toMilliCentavosPerUnit(item.replacementCostMc);

    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <span className="text-muted-foreground">
          {salesLabels.lineSubtotal}:{" "}
          <span className="numeric-cell font-medium text-foreground">
            {subtotal !== null ? formatMoney(subtotal) : "â€”"}
          </span>
        </span>
        {negativeStockWarning ? (
          <span className="font-medium text-warning">{salesLabels.warnings.negativeStock}</span>
        ) : null}
        {belowReplacementWarning ? (
          <span className="font-medium text-negative">
            {salesLabels.warnings.belowReplacementCost}
          </span>
        ) : null}
      </div>
    );
  }

  const dialogTitle = isEditMode ? salesLabels.editTitle : salesLabels.recordTitle;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} aria-label={dialogTitle}>
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-foreground text-md">{dialogTitle}</h2>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="sf-status">
                {salesLabels.fieldPaymentStatus}
              </label>
              <Select
                id="sf-status"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                disabled={disabled}
              >
                <option value="PAID">{salesLabels.paymentStatusLabels.PAID}</option>
                <option value="ON_CREDIT">{salesLabels.paymentStatusLabels.ON_CREDIT}</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="sf-date">
                {salesLabels.fieldDate}
              </label>
              <Input
                id="sf-date"
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-foreground text-sm">{salesLabels.fieldCustomer}</span>
            <CustomerPicker
              value={customerId}
              onChange={(id) => setCustomerId(id)}
              disabled={disabled}
            />
          </div>

          {isPaid ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground" htmlFor="sf-method">
                  {salesLabels.fieldPaymentMethod}
                </label>
                <Select
                  id="sf-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  disabled={disabled}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {salesLabels.paymentMethodLabels[method]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground" htmlFor="sf-account">
                  {salesLabels.fieldAccount}
                </label>
                <Select
                  id="sf-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={disabled}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="sf-notes">
              {salesLabels.fieldNotes}
            </label>
            <Input
              id="sf-notes"
              placeholder={salesLabels.notesPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-foreground">{salesLabels.linesTitle}</span>
            <LineEditor
              lines={lines}
              onChange={handleLinesChange}
              createLine={emptyLine}
              disabled={disabled}
              itemKindFilter="FINISHED"
              labels={{
                item: salesLabels.lineItem,
                qty: salesLabels.lineQty,
                amount: salesLabels.lineUnitPrice,
                addLine: salesLabels.addLine,
                removeLine: salesLabels.removeLine,
                amountPlaceholder: "0.00",
                qtyPlaceholder: "0",
              }}
              renderExtraColumns={renderLineExtra}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted px-4 py-3">
            <span className="font-medium text-foreground text-sm">
              {salesLabels.totalPreviewLabel}
            </span>
            <span className="numeric-cell font-semibold text-foreground text-lg">
              {formatMoney(toCentavos(totalPreview))}
            </span>
          </div>

          {displayError ? <p className="text-negative text-sm">{displayError}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={disabled}
          >
            {salesLabels.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={disabled || (isPaid && !accountId)}
          >
            {isEditMode ? salesLabels.save : salesLabels.submit}
          </Button>
        </div>
      </Dialog>
      {isEditMode && editReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={editReplay.pendingConfirmation.impact}
          onConfirm={editReplay.confirm}
          onCancel={editReplay.cancel}
          confirmLoading={editReplay.isPending}
          title={salesLabels.impactEditTitle}
          description={salesLabels.impactEditDescription}
          confirmLabel={salesLabels.save}
        />
      ) : null}
      {!isEditMode && createReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={createReplay.pendingConfirmation.impact}
          onConfirm={createReplay.confirm}
          onCancel={createReplay.cancel}
          confirmLoading={createReplay.isPending}
          title={salesLabels.impactCreateTitle}
          description={salesLabels.impactCreateDescription}
          confirmLabel={salesLabels.submit}
        />
      ) : null}
    </>
  );
}
