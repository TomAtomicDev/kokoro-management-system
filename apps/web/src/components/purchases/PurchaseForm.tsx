// Dialog for UC-01 "recordPurchase" (Doc 07 SC-07). Per-line unit-cost preview against the item's
// stored replacement cost is this screen's "inflation signal" — a purchase priced meaningfully
// above what the item last cost to replace gets flagged inline as the line is entered, before the
// purchase is even submitted. Validated with the exact same `recordPurchaseCommandSchema` the API
// route parses with (D-4). No session picker — Sessions (KOK-027/Phase 2) doesn't exist yet; the
// schema's optional `sessionId` is simply never set from this form.

import type { FinancialAccountDto, ItemDto } from "@kokoro/shared";
import { formatMoney, nowIso, recordPurchaseCommandSchema, toBusinessDate } from "@kokoro/shared";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";

import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useItemsQuery } from "@/features/catalog/api";
import { uploadPurchasePhoto, useRecordPurchase } from "@/features/purchases/api";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { purchasesLabels } from "@/lib/i18n-purchases";
import { cn } from "@/lib/utils";

export interface PurchaseFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
}

interface PurchaseLineValue extends LineEditorLine {
  itemId: string | null;
  /** Milli-units decimal string (scale 3). */
  qty: string;
  /** Line-total centavos decimal string (scale 2). */
  amount: string;
}

function emptyLine(): PurchaseLineValue {
  return { itemId: null, qty: "", amount: "" };
}

/** How far above the item's stored replacement cost counts as "meaningfully higher" for the
 * inflation signal, past ordinary rounding/price noise. Judgment call — 2 percentage points. */
const INFLATION_SIGNAL_THRESHOLD = 0.02;

export function PurchaseForm({ open, onOpenChange, accounts }: PurchaseFormProps) {
  const [supplierName, setSupplierName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PurchaseLineValue[]>([emptyLine()]);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useRecordPurchase();
  const itemsQuery = useItemsQuery({ isActive: true });

  const itemsById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on the open transition.
  useEffect(() => {
    if (open) {
      setSupplierName("");
      setAccountId(accounts[0]?.id ?? "");
      setBusinessDate(toBusinessDate(nowIso()));
      setNotes("");
      setLines([emptyLine()]);
      setPhotoKey(null);
      setPhotoUploading(false);
      setPhotoError(null);
      setError(null);
    }
  }, [open]);

  const disabled = mutation.isPending || photoUploading;

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
    for (const line of lines) {
      const qty = parseDecimalToInt(line.qty, 3);
      const lineTotal = parseDecimalToInt(line.amount, 2);
      if (!line.itemId || qty === null || qty <= 0 || lineTotal === null) {
        setError(purchasesLabels.errors.invalidLine);
        return;
      }
      parsedLines.push({ itemId: line.itemId, qty, lineTotal });
    }

    const parsed = recordPurchaseCommandSchema.safeParse({
      supplierName: supplierName.trim() === "" ? undefined : supplierName.trim(),
      accountId,
      receiptPhotoKey: photoKey ?? undefined,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      occurredAt: nowIso(),
      businessDate,
      lines: parsedLines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? purchasesLabels.errors.generic);
      return;
    }

    try {
      await mutation.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : purchasesLabels.errors.generic);
    }
  }

  function renderLineExtra(line: PurchaseLineValue) {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    if (!item) return null;

    const qty = parseDecimalToInt(line.qty, 3);
    const lineTotal = parseDecimalToInt(line.amount, 2);
    if (qty === null || qty <= 0 || lineTotal === null) {
      return (
        <span className="text-subtle-foreground text-xs">{purchasesLabels.unitCostLabel}: —</span>
      );
    }

    // Centavos-per-milli-unit — the SAME scale item.replacementCost is stored in (Doc 04 §2), so
    // no ×1000 conversion is needed to compare the two; ×1000 is only applied when formatting a
    // money-per-whole-unit figure for display (mirrors ItemForm's derived-cost block).
    const unitCost = lineTotal / qty;
    const abbrev = purchasesLabels.unitAbbrev[item.unit];
    const isHigher =
      item.replacementCost > 0 &&
      unitCost > item.replacementCost * (1 + INFLATION_SIGNAL_THRESHOLD);

    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <span className="text-muted-foreground">
          {purchasesLabels.unitCostLabel}:{" "}
          <span className="numeric-cell font-medium text-foreground">
            {formatMoney(Math.round(unitCost * 1000))} / {abbrev}
          </span>
        </span>
        {item.replacementCost > 0 ? (
          <span className={cn(isHigher ? "font-medium text-warning" : "text-muted-foreground")}>
            {purchasesLabels.vsReplacementCost}:{" "}
            {formatMoney(Math.round(item.replacementCost * 1000))} / {abbrev}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={purchasesLabels.recordTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{purchasesLabels.recordTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
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

        <div className="grid grid-cols-2 gap-3">
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
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground">{purchasesLabels.linesTitle}</span>
          <LineEditor
            lines={lines}
            onChange={setLines}
            createLine={emptyLine}
            disabled={disabled}
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

        {error ? <p className="text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
        >
          {purchasesLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled || !accountId}>
          {purchasesLabels.submit}
        </Button>
      </div>
    </Dialog>
  );
}
