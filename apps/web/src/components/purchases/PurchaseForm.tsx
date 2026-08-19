// Full-page form for UC-01 "recordPurchase" (Doc 07 SC-07). Per-line unit-cost preview against the item's
// stored replacement cost is this screen's "inflation signal" â€” a purchase priced meaningfully
// above what the item last cost to replace gets flagged inline as the line is entered, before the
// purchase is even submitted. Validated with the exact same `recordPurchaseCommandSchema` the API
// route parses with (D-4). No session picker â€” Sessions (KOK-027/Phase 2) doesn't exist yet; the
// schema's optional `sessionId` is simply never set from this form.

import type {
  FinancialAccountDto,
  ItemDto,
  PurchaseDto,
  QtyDisplayUnit,
  RecordPurchaseCommand,
  RecordPurchaseResult,
  UpdatePurchaseCommand,
  UpdatePurchaseResult,
} from "@kokoro/shared";
import {
  defaultDisplayUnitFor,
  formatMoney,
  nowIso,
  PURCHASE_NOTES_MAX_LENGTH,
  rateFromTotal,
  recordPurchaseCommandSchema,
  toBusinessDate,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { FormPage } from "@/components/common/FormPage";
import { PinnedSummaryFooter } from "@/components/common/PinnedSummaryFooter";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { parseLineQuantityToMilliUnits } from "@/components/line-editor/line-editor-quantity";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useItemsQuery } from "@/features/catalog/api";
import {
  uploadPurchasePhoto,
  useRecordPurchase,
  useUpdatePurchase,
} from "@/features/purchases/api";
import {
  clearPersistentDraft,
  readPersistentDraft,
  writePersistentDraft,
} from "@/hooks/usePersistentDraft";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { hasUnsavedChanges, useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { purchasesLabels } from "@/lib/i18n-purchases";
import { cn } from "@/lib/utils";

export interface PurchaseFormProps {
  accounts: FinancialAccountDto[];
  /** Present -> edit mode: prefill from this purchase and submit via `useUpdatePurchase`. Absent ->
   * create mode, submits via `useRecordPurchase`. Both branches are wrapped in
   * `useReplayConfirmableMutation` (KOK-065 closed the create-path dead end left by KOK-024) so a
   * genuinely backdated purchase â€” new or edited â€” gets the same R-5 confirmation dance. */
  purchase?: PurchaseDto;
  /** Create mode only: threaded into the create command's `sessionId`; ignored in edit mode. */
  preselectedSessionId?: string;
}

interface PurchaseLineValue extends LineEditorLine {
  itemId: string | null;
  /** Milli-units decimal string (scale 3). */
  qty: string;
  /** Line-total centavos decimal string (scale 2). */
  amount: string;
  unit: QtyDisplayUnit | null;
}

function emptyLine(): PurchaseLineValue {
  return { itemId: null, qty: "", amount: "", unit: null };
}

interface PurchaseFormState {
  supplierName: string;
  accountId: string;
  businessDate: string;
  notes: string;
  lines: PurchaseLineValue[];
  photoKey: string | null;
}

/**
 * Maps a fetched `PurchaseDto` (KOK-024 Phase G edit mode) to the form's editable local state.
 * Pure and framework-free on purpose â€” same rationale as `extractReplayConfirmation` /
 * `runConfirmableMutation` (useReplayConfirmableMutation.ts's header): this workspace has neither
 * jsdom nor @testing-library/react, so a plain exported function is what stays unit-testable
 * without rendering the component.
 */
export function purchaseToFormState(purchase: PurchaseDto): PurchaseFormState {
  return {
    supplierName: purchase.supplierName ?? "",
    accountId: purchase.accountId,
    businessDate: purchase.businessDate,
    notes: purchase.notes ?? "",
    lines:
      purchase.lines.length > 0
        ? purchase.lines.map((line) => ({
            itemId: line.itemId,
            qty: formatIntAsDecimalInput(line.qty, 3),
            amount: formatIntAsDecimalInput(line.lineTotal, 2),
            unit: null,
          }))
        : [emptyLine()],
    photoKey: purchase.receiptPhotoKey,
  };
}

/** How far above the item's stored replacement cost counts as "meaningfully higher" for the
 * inflation signal, past ordinary rounding/price noise. Judgment call â€” 2 percentage points. */
const INFLATION_SIGNAL_THRESHOLD = 0.02;

export function PurchaseForm({ accounts, purchase, preselectedSessionId }: PurchaseFormProps) {
  const navigate = useNavigate();
  const isEditMode = Boolean(purchase);
  const draftKey = purchase
    ? `purchase:${purchase.id}`
    : `purchase:new:${preselectedSessionId ?? "none"}`;

  const [supplierName, setSupplierName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PurchaseLineValue[]>([emptyLine()]);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialFormStateRef = useRef<PurchaseFormState | null>(null);
  const currentFormState: PurchaseFormState = {
    supplierName,
    accountId,
    businessDate,
    notes,
    lines,
    photoKey,
  };
  const unsavedChangesGuard = useUnsavedChangesGuard({
    isDirty:
      initialFormStateRef.current !== null &&
      hasUnsavedChanges(initialFormStateRef.current, currentFormState),
    blockNavigation: true,
  });

  const createMutation = useRecordPurchase();
  const createReplay = useReplayConfirmableMutation<RecordPurchaseCommand, RecordPurchaseResult>(
    (command) => createMutation.mutateAsync(command),
    {
      onSuccess: () => {
        clearPersistentDraft(draftKey);
        unsavedChangesGuard.markClean();
        void navigate({ to: "/purchases" });
      },
    },
  );
  // Called unconditionally (rules of hooks) even in create mode â€” `purchase?.id` is only "" then,
  // and the mutation is never actually invoked unless `isEditMode` is true (see handleSubmit).
  const updateMutation = useUpdatePurchase(purchase?.id ?? "");
  const editReplay = useReplayConfirmableMutation<UpdatePurchaseCommand, UpdatePurchaseResult>(
    (command) => updateMutation.mutateAsync(command),
    {
      onSuccess: () => {
        clearPersistentDraft(draftKey);
        unsavedChangesGuard.markClean();
        void navigate({ to: "/purchases" });
      },
    },
  );

  const itemsQuery = useItemsQuery({ isActive: true });

  const itemsById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  // Reset only on the open transition (or a switch to a different purchase while open) â€”
  // `purchase?.id` stands in for `purchase` itself so a background refetch of the SAME purchase
  // (e.g. window refocus) never clobbers in-progress edits; `accounts` is deliberately excluded
  // the same way it always was.
  const initializedRef = useRef<string | null>(null);

  // Route-mounted forms initialize once per record, so refetches cannot clobber in-progress edits.
  useEffect(() => {
    const initializationKey = draftKey;
    if (initializedRef.current === initializationKey) {
      if (!purchase && !accountId && accounts[0]) {
        setAccountId(accounts[0].id);
        if (initialFormStateRef.current) {
          initialFormStateRef.current = {
            ...initialFormStateRef.current,
            accountId: accounts[0].id,
          };
        }
      }
      return;
    }
    const savedDraft = readPersistentDraft<PurchaseFormState>(draftKey);
    let initialFormState: PurchaseFormState;
    if (savedDraft) {
      initialFormState = savedDraft;
    } else if (purchase) {
      initialFormState = purchaseToFormState(purchase);
    } else {
      initialFormState = {
        supplierName: "",
        accountId: accounts[0]?.id ?? "",
        businessDate: toBusinessDate(nowIso()),
        notes: "",
        lines: [emptyLine()],
        photoKey: null,
      };
    }
    setSupplierName(initialFormState.supplierName);
    setAccountId(initialFormState.accountId);
    setBusinessDate(initialFormState.businessDate);
    setNotes(initialFormState.notes);
    setLines(initialFormState.lines);
    setPhotoKey(initialFormState.photoKey);
    initialFormStateRef.current = initialFormState;
    setPhotoUploading(false);
    setPhotoError(null);
    setError(null);
    initializedRef.current = initializationKey;
  }, [accountId, accounts, draftKey, purchase]);

  useEffect(() => {
    if (initializedRef.current !== draftKey) return;
    writePersistentDraft<PurchaseFormState>(draftKey, {
      supplierName,
      accountId,
      businessDate,
      notes,
      lines,
      photoKey,
    });
  }, [accountId, businessDate, draftKey, lines, notes, photoKey, supplierName]);

  const disabled = (isEditMode ? editReplay.isPending : createReplay.isPending) || photoUploading;

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError(null);
    try {
      const { key } = await uploadPurchasePhoto(file);
      setPhotoKey(key);
    } catch (err) {
      setPhotoKey(null);
      setPhotoError(
        err instanceof ApiError ? err.message : purchasesLabels.errors.photoUploadFailed,
      );
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!accountId) {
      setError(purchasesLabels.errors.accountRequired);
      return;
    }

    const parsedLines: { itemId: string; qty: number; lineTotal: number }[] = [];
    const lastEnteredLineIndex = lines.reduce(
      (lastIndex, line, index) =>
        !line.itemId && line.qty.trim() === "" && line.amount.trim() === "" ? lastIndex : index,
      -1,
    );

    for (const [index, line] of lines.entries()) {
      // A trailing untouched row is the editor's affordance for adding another line, not an
      // invalid purchase line. Empty rows in the middle still identify the missing item below.
      if (index > lastEnteredLineIndex) continue;

      const lineNumber = index + 1;
      const qtyText = line.qty.trim();
      const lineTotalText = line.amount.trim();
      if (!line.itemId) {
        setError(purchasesLabels.errors.lineIncomplete(lineNumber, purchasesLabels.lineItem));
        return;
      }
      if (qtyText === "") {
        setError(purchasesLabels.errors.lineIncomplete(lineNumber, purchasesLabels.lineQty));
        return;
      }
      if (lineTotalText === "") {
        setError(purchasesLabels.errors.lineIncomplete(lineNumber, purchasesLabels.lineTotal));
        return;
      }

      const item = line.itemId ? itemsById.get(line.itemId) : undefined;
      const qty = item ? parseLineQuantityToMilliUnits(line.qty, line.unit, item.unit) : null;
      const lineTotal = parseDecimalToInt(line.amount, 2);
      if (qty === null || qty <= 0) {
        setError(purchasesLabels.errors.lineInvalidValue(lineNumber, purchasesLabels.lineQty));
        return;
      }
      if (lineTotal === null) {
        setError(purchasesLabels.errors.lineInvalidValue(lineNumber, purchasesLabels.lineTotal));
        return;
      }
      parsedLines.push({ itemId: line.itemId, qty, lineTotal });
    }

    const parsed = recordPurchaseCommandSchema.safeParse({
      sessionId: purchase ? undefined : preselectedSessionId,
      supplierName: supplierName.trim() === "" ? undefined : supplierName.trim(),
      accountId,
      receiptPhotoKey: photoKey ?? undefined,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      // Edit mode keeps the purchase's original instant â€” there's no UI field to change it, and
      // an edit re-stamping `occurredAt` to "now" would rewrite when the purchase actually
      // happened every time the owner fixes a typo. Create mode is unchanged: "now" is the moment
      // the purchase is first recorded.
      occurredAt: purchase ? purchase.occurredAt : nowIso(),
      businessDate,
      lines: parsedLines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? purchasesLabels.errors.generic);
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
        : purchasesLabels.errors.generic
      : null);

  function renderLineExtra(line: PurchaseLineValue) {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    if (!item) return null;

    const qty = item ? parseLineQuantityToMilliUnits(line.qty, line.unit, item.unit) : null;
    const lineTotal = parseDecimalToInt(line.amount, 2);
    if (qty === null || qty <= 0 || lineTotal === null) {
      return (
        <span className="text-subtle-foreground text-xs">{purchasesLabels.unitCostLabel}: —</span>
      );
    }

    // Milli-centavos per WHOLE unit — the SAME scale `item.replacementCostMc` is stored in
    // (Doc 04 §2, ADR-017), so the two compare directly. Conversion happens only at the display
    // boundary, via `totalCentavos` (mirrors ItemForm's derived-cost block).
    const unitCost = rateFromTotal(toCentavos(lineTotal), toMilliUnits(qty));
    const abbrev = purchasesLabels.unitAbbrev[item.unit];
    const isHigher =
      item.replacementCostMc > 0 &&
      unitCost > item.replacementCostMc * (1 + INFLATION_SIGNAL_THRESHOLD);

    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <span className="text-muted-foreground">
          {purchasesLabels.unitCostLabel}:{" "}
          <span className="numeric-cell font-medium text-foreground">
            {formatMoney(totalCentavos(unitCost, WHOLE_UNIT_MILLI_UNITS))} / {abbrev}
          </span>
        </span>
        {item.replacementCostMc > 0 ? (
          <span className={cn(isHigher ? "font-medium text-warning" : "text-muted-foreground")}>
            {purchasesLabels.vsReplacementCost}:{" "}
            {formatMoney(
              totalCentavos(toMilliCentavosPerUnit(item.replacementCostMc), WHOLE_UNIT_MILLI_UNITS),
            )}{" "}
            / {abbrev}
          </span>
        ) : null}
      </div>
    );
  }

  const pageTitle = isEditMode ? purchasesLabels.editTitle : purchasesLabels.recordTitle;
  const totalPreview = lines.reduce((total, line) => {
    const lineTotal = parseDecimalToInt(line.amount, 2);
    return lineTotal !== null && lineTotal >= 0 ? total + lineTotal : total;
  }, 0);
  const accountName = accounts.find((account) => account.id === accountId)?.name ?? accountId;

  return (
    <>
      <FormPage
        title={pageTitle}
        backTo="/purchases"
        backLabel={purchasesLabels.backToPurchases}
        footer={
          <PinnedSummaryFooter
            contentClassName="max-w-3xl px-0"
            destination={
              <span className="text-muted-foreground text-xs">
                {purchasesLabels.deductedFromAccount(
                  formatMoney(toCentavos(totalPreview)),
                  accountName,
                )}
              </span>
            }
            total={
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-4 py-2">
                <span className="font-medium text-foreground text-sm">
                  {purchasesLabels.totalPreviewLabel}
                </span>
                <span className="numeric-cell font-semibold text-foreground text-lg">
                  {formatMoney(toCentavos(totalPreview))}
                </span>
              </div>
            }
            warnings={
              displayError ? <p className="text-negative text-sm">{displayError}</p> : undefined
            }
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clearPersistentDraft(draftKey);
                    unsavedChangesGuard.markClean();
                    void navigate({ to: "/purchases" });
                  }}
                  disabled={disabled}
                >
                  {purchasesLabels.cancel}
                </Button>
                <Button type="button" onClick={handleSubmit} disabled={disabled || !accountId}>
                  {isEditMode ? purchasesLabels.save : purchasesLabels.submit}
                </Button>
              </>
            }
          />
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="pf-supplier">
              {purchasesLabels.fieldSupplier}
            </label>
            <Input
              id="pf-supplier"
              placeholder={purchasesLabels.supplierPlaceholder}
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              disabled={disabled}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="pf-account">
              {purchasesLabels.fieldAccount}
            </label>
            <Select
              id="pf-account"
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="pf-date">
              {purchasesLabels.fieldDate}
            </label>
            <Input
              id="pf-date"
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="pf-photo">
              {purchasesLabels.fieldPhoto}
            </label>
            <Input
              id="pf-photo"
              type="file"
              accept="image/*,application/pdf"
              onChange={handlePhotoChange}
              disabled={disabled}
            />
            {photoUploading ? (
              <span className="text-muted-foreground text-xs">
                {purchasesLabels.photoUploading}
              </span>
            ) : photoKey ? (
              <span className="text-positive text-xs">{purchasesLabels.photoReady}</span>
            ) : null}
            {photoError ? <span className="text-negative text-xs">{photoError}</span> : null}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="pf-notes">
            {purchasesLabels.fieldNotes}
          </label>
          <Input
            id="pf-notes"
            placeholder={purchasesLabels.notesPlaceholder}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
            maxLength={PURCHASE_NOTES_MAX_LENGTH}
          />
          {notes.length >= PURCHASE_NOTES_MAX_LENGTH * 0.8 ? (
            <span className="text-muted-foreground text-xs" aria-live="polite">
              {purchasesLabels.charactersRemaining(
                Math.max(0, PURCHASE_NOTES_MAX_LENGTH - notes.length),
              )}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground">{purchasesLabels.linesTitle}</span>
          <LineEditor
            lines={lines}
            onChange={setLines}
            createLine={emptyLine}
            disabled={disabled}
            itemEligibility={{ isUnmetered: false }}
            itemEmptyMessage={purchasesLabels.itemPickerEmpty}
            getItemUnit={(itemId) => itemsById.get(itemId)?.unit}
            unitSelector={{
              getValue: (line) => line.unit,
              onChange: (index, unit) =>
                setLines((currentLines) =>
                  currentLines.map((line, lineIndex) =>
                    lineIndex === index ? { ...line, unit } : line,
                  ),
                ),
              label: purchasesLabels.unit,
            }}
            onItemChange={(_index, itemId) => {
              const item = itemId ? itemsById.get(itemId) : undefined;
              return { qty: "", unit: item ? defaultDisplayUnitFor(item.unit) : null };
            }}
            labels={{
              item: purchasesLabels.lineItem,
              qty: purchasesLabels.lineQty,
              amount: purchasesLabels.lineTotal,
              addLine: purchasesLabels.addLine,
              removeLine: purchasesLabels.removeLine,
              amountPlaceholder: "0.00",
              qtyPlaceholder: "0",
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
          title={purchasesLabels.impactEditTitle}
          description={purchasesLabels.impactEditDescription}
          confirmLabel={purchasesLabels.save}
        />
      ) : null}
      {!isEditMode && createReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={createReplay.pendingConfirmation.impact}
          onConfirm={createReplay.confirm}
          onCancel={createReplay.cancel}
          confirmLoading={createReplay.isPending}
          title={purchasesLabels.impactCreateTitle}
          description={purchasesLabels.impactCreateDescription}
          confirmLabel={purchasesLabels.submit}
        />
      ) : null}
    </>
  );
}
