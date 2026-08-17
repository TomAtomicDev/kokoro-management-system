// Full-page form for UC-03 "recordSale" (Doc 07 SC-03) + UC-18 edit (KOK-064). Mirrors PurchaseForm.tsx's
// structure (FormPage shell, local form state, route-mounted draft, edit-mode prefill, both branches
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
  computeMarginBasisPoints,
  formatMoney,
  nowIso,
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentStatus,
  paymentMethodForAccountType,
  rateFromTotal,
  recordSaleCommandSchema,
  SALE_NOTES_MAX_LENGTH,
  toBusinessDate,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FormPage } from "@/components/common/FormPage";
import { PaymentAccountSelect } from "@/components/common/PaymentAccountSelect";
import { PinnedSummaryFooter } from "@/components/common/PinnedSummaryFooter";
import { CustomerPicker } from "@/components/customers/CustomerPicker";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { MarginBadge } from "@/components/pricing/MarginBadge";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useItemsQuery } from "@/features/catalog/api";
import { useStock } from "@/features/inventory/api";
import { usePricingSettings } from "@/features/pricing/api";
import { useRecordSale, useUpdateSale } from "@/features/sales/api";
import {
  clearPersistentDraft,
  readPersistentDraft,
  writePersistentDraft,
} from "@/hooks/usePersistentDraft";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { hasUnsavedChanges, useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { pricingLabels } from "@/lib/i18n-pricing";
import { salesLabels } from "@/lib/i18n-sales";

export interface SaleFormProps {
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
  return {
    itemId: null,
    qty: "",
    amount: "",
  };
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

export function SaleForm({ accounts, sale }: SaleFormProps) {
  const navigate = useNavigate();
  const isEditMode = Boolean(sale);
  const draftKey = sale ? `sale:${sale.id}` : "sale:new";

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
  const initialFormStateRef = useRef<SaleFormState | null>(null);
  const initializedRef = useRef<string | null>(null);

  const currentFormState: SaleFormState = {
    paymentStatus,
    paymentMethod,
    accountId,
    customerId,
    businessDate,
    notes,
    lines,
  };
  const unsavedChangesGuard = useUnsavedChangesGuard({
    isDirty:
      initialFormStateRef.current !== null &&
      hasUnsavedChanges(initialFormStateRef.current, currentFormState),
    blockNavigation: true,
  });

  const createMutation = useRecordSale();
  const createReplay = useReplayConfirmableMutation<RecordSaleCommand, RecordSaleResult>(
    (command) => createMutation.mutateAsync(command),
    {
      onSuccess: () => {
        clearPersistentDraft(draftKey);
        unsavedChangesGuard.markClean();
        void navigate({ to: "/sales" });
      },
    },
  );
  // Called unconditionally (rules of hooks) even in create mode â€” `sale?.id` is only "" then, and
  // the mutation is never actually invoked unless `isEditMode` is true (see handleSubmit).
  const updateMutation = useUpdateSale(sale?.id ?? "");
  const editReplay = useReplayConfirmableMutation<UpdateSaleCommand, UpdateSaleResult>(
    (command) => updateMutation.mutateAsync(command),
    {
      onSuccess: () => {
        clearPersistentDraft(draftKey);
        unsavedChangesGuard.markClean();
        void navigate({ to: "/sales" });
      },
    },
  );

  const pricingSettingsQuery = usePricingSettings();

  const finishedItemsQuery = useItemsQuery({ isActive: true, kind: "FINISHED" });
  const itemsById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of finishedItemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [finishedItemsQuery.data]);

  // Current on-hand qty per item (v_stock, INV-5) â€” used for the amber "stock would go negative"
  // warning below. Unfiltered (all kinds): fine to fetch the whole table at this app's scale, same
  // precedent as PurchaseForm's unfiltered useItemsQuery for its own line lookups.
  const stockQuery = useStock();
  const onHandByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQuery.data?.stock ?? []) {
      map.set(row.itemId, toMilliUnits(row.qtyOnHand));
    }
    return map;
  }, [stockQuery.data]);

  // In edit mode, the live stock view already includes this sale's original SALE_OUT movement.
  // Add that committed quantity back before comparing the edited request so an unchanged line is
  // not charged against stock twice. A missing item in this map is a newly added line, so its
  // baseline remains the live on-hand quantity.
  const alreadyDeductedByItemId = useMemo(() => {
    const map = new Map<string, number>();
    if (!sale) return map;
    for (const line of sale.lines) {
      map.set(line.itemId, toMilliUnits((map.get(line.itemId) ?? 0) + line.qty));
    }
    return map;
  }, [sale]);

  // Reset only on the open transition (or a switch to a different sale while open) â€” `sale?.id`
  // stands in for `sale` itself so a background refetch of the SAME sale never clobbers
  // in-progress edits, mirroring PurchaseForm's identical precedent.
  useEffect(() => {
    const initializationKey = draftKey;
    if (initializedRef.current === initializationKey) {
      if (!sale && !accountId && accounts[0]) {
        setAccountId(accounts[0].id);
        setPaymentMethod(paymentMethodForAccountType(accounts[0].type));
        if (initialFormStateRef.current) {
          initialFormStateRef.current = {
            ...initialFormStateRef.current,
            accountId: accounts[0].id,
            paymentMethod: paymentMethodForAccountType(accounts[0].type),
          };
        }
      }
      return;
    }

    if (sale && sale.lines.length > 0 && finishedItemsQuery.isLoading) {
      return;
    }

    const savedDraft = readPersistentDraft<SaleFormState>(draftKey);
    let initialFormState: SaleFormState;
    if (savedDraft) {
      initialFormState = savedDraft;
    } else if (sale) {
      initialFormState = saleToFormState(sale, accounts);
    } else {
      const firstAccount = accounts[0];
      initialFormState = {
        paymentStatus: "PAID",
        paymentMethod: firstAccount
          ? paymentMethodForAccountType(firstAccount.type)
          : (PAYMENT_METHODS[0] as PaymentMethod),
        accountId: firstAccount?.id ?? "",
        customerId: null,
        businessDate: toBusinessDate(nowIso()),
        notes: "",
        lines: [emptyLine()],
      };
    }
    setPaymentStatus(initialFormState.paymentStatus);
    setPaymentMethod(initialFormState.paymentMethod);
    setAccountId(initialFormState.accountId);
    setCustomerId(initialFormState.customerId);
    setBusinessDate(initialFormState.businessDate);
    setNotes(initialFormState.notes);
    setLines(initialFormState.lines);
    initialFormStateRef.current = initialFormState;
    setError(null);
    initializedRef.current = initializationKey;
  }, [accountId, accounts, draftKey, finishedItemsQuery.isLoading, sale]);

  useEffect(() => {
    if (initializedRef.current !== draftKey) return;
    writePersistentDraft<SaleFormState>(draftKey, {
      paymentStatus,
      paymentMethod,
      accountId,
      customerId,
      businessDate,
      notes,
      lines,
    });
  }, [accountId, businessDate, customerId, draftKey, lines, notes, paymentMethod, paymentStatus]);

  const disabled = isEditMode ? editReplay.isPending : createReplay.isPending;
  const isPaid = paymentStatus === "PAID";

  /** Prefills a line's unit price from the item's catalog `salePriceMc` the moment the item changes
   * and the price field is still blank â€” editable afterward, never overwritten again (same
   * "convenience default, not sticky" rule as ProductionRunForm's recipe-line prefill). LineEditor
   * itself only forwards `itemId` to its `onChange` (see LineEditor.tsx), so the lookup happens
   * here, against the previous line at the same index, rather than inside LineEditor. */
  function handleLinesChange(nextLines: SaleLineValue[]) {
    setLines((currentLines) => {
      const withPrefill = nextLines.map((line, index) => {
        const prevItemId = currentLines[index]?.itemId ?? null;
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
      return withPrefill;
    });
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
      map.set(line.itemId, toMilliUnits((map.get(line.itemId) ?? 0) + qty));
    }
    return map;
  }, [lines]);

  const negativeStockWarnings = useMemo(() => {
    const warnings: { itemId: string; itemName: string }[] = [];
    for (const [itemId, requested] of qtyByItemId) {
      const item = itemsById.get(itemId);
      if (!item) continue;

      const onHand = onHandByItemId.get(itemId) ?? 0;
      const alreadyDeducted = isEditMode ? (alreadyDeductedByItemId.get(itemId) ?? 0) : 0;
      const baseline = toMilliUnits(onHand + alreadyDeducted);
      const remaining = toMilliUnits(baseline - requested);
      if (requested > 0 && remaining < 0) {
        warnings.push({ itemId, itemName: item.name });
      }
    }
    return warnings;
  }, [alreadyDeductedByItemId, isEditMode, itemsById, onHandByItemId, qtyByItemId]);

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

    // C-5 margin-vs-replacement-cost, live as the price is typed (KOK-036, Doc 07 SC-03) —
    // replaces the old plain-text "below replacement cost" warning with the same `MarginBadge`
    // SC-06/SC-12 use, since this is the one place in Sales where the metric genuinely matches
    // C-5's threshold (unlike SC-02's historical WAC-snapshot margin, which stays unbadged).
    // Convert the decimal-input centavos to the same `_mc` rate scale as replacementCostMc before
    // comparing; both stored rates are dimensionally identical (ADR-017).
    const marginReplacement =
      unitPrice !== null && item.replacementCostMc > 0
        ? computeMarginBasisPoints(
            rateFromTotal(toCentavos(unitPrice), WHOLE_UNIT_MILLI_UNITS),
            toMilliCentavosPerUnit(item.replacementCostMc),
          )
        : null;

    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <span className="text-muted-foreground">
          {salesLabels.lineSubtotal}:{" "}
          <span className="numeric-cell font-medium text-foreground">
            {subtotal !== null ? formatMoney(subtotal) : "—"}
          </span>
        </span>
        {unitPrice !== null && item.replacementCostMc === 0 ? (
          <span className="text-muted-foreground">{pricingLabels.costPending}</span>
        ) : marginReplacement !== null && pricingSettingsQuery.data ? (
          <MarginBadge
            pctBasisPoints={marginReplacement.pctBasisPoints}
            minMarginPct={pricingSettingsQuery.data.minMarginPct}
            className="w-fit"
          />
        ) : null}
      </div>
    );
  }

  const pageTitle = isEditMode ? salesLabels.editTitle : salesLabels.recordTitle;
  const accountName = accounts.find((account) => account.id === accountId)?.name ?? accountId;

  return (
    <>
      <FormPage
        title={pageTitle}
        backTo="/sales"
        backLabel={salesLabels.backToSales}
        footer={
          <PinnedSummaryFooter
            contentClassName="max-w-3xl px-0"
            destination={
              isPaid ? (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <PaymentAccountSelect
                    id="sf-payment-account"
                    accounts={accounts}
                    accountId={accountId}
                    label={salesLabels.fieldPaymentAccount}
                    paymentMethodLabels={salesLabels.paymentMethodLabels}
                    onChange={({ accountId: nextAccountId, paymentMethod: nextPaymentMethod }) => {
                      setAccountId(nextAccountId);
                      setPaymentMethod(nextPaymentMethod);
                    }}
                    disabled={disabled}
                  />
                  <span className="text-muted-foreground text-xs">
                    {salesLabels.deductedFromAccount(
                      formatMoney(toCentavos(totalPreview)),
                      accountName,
                    )}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">{salesLabels.paymentOnCredit}</span>
              )
            }
            total={
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-4 py-2">
                <span className="font-medium text-foreground text-sm">
                  {salesLabels.totalPreviewLabel}
                </span>
                <span className="numeric-cell font-semibold text-foreground text-lg">
                  {formatMoney(toCentavos(totalPreview))}
                </span>
              </div>
            }
            warnings={
              negativeStockWarnings.length > 0 || displayError ? (
                <>
                  {negativeStockWarnings.map((warning) => (
                    <span key={warning.itemId} className="font-medium text-warning">
                      {warning.itemName}: {salesLabels.warnings.negativeStock}
                    </span>
                  ))}
                  {displayError ? <p className="text-negative text-sm">{displayError}</p> : null}
                </>
              ) : undefined
            }
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clearPersistentDraft(draftKey);
                    unsavedChangesGuard.markClean();
                    void navigate({ to: "/sales" });
                  }}
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
              </>
            }
          />
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
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
            maxLength={SALE_NOTES_MAX_LENGTH}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground">{salesLabels.productLinesTitle}</span>
          <LineEditor
            lines={lines}
            onChange={handleLinesChange}
            createLine={emptyLine}
            disabled={disabled}
            itemKindFilter="FINISHED"
            getItemUnit={(itemId) => itemsById.get(itemId)?.unit}
            labels={{
              item: salesLabels.lineItem,
              qty: salesLabels.lineQty,
              amount: salesLabels.lineUnitPrice,
              addLine: salesLabels.addLine,
              removeLine: salesLabels.removeLine,
              amountPlaceholder: salesLabels.lineUnitPricePlaceholder,
              qtyPlaceholder: salesLabels.lineQtyPlaceholder,
            }}
            renderExtraColumns={renderLineExtra}
          />
        </div>
      </FormPage>
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
