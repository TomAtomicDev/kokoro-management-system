// Dialog for UC-03 "recordSale" (Doc 07 SC-03). Mirrors PurchaseForm.tsx's structure (Dialog
// wrapper, local form state, reset-on-open) but drops what purchases needed that sales don't: no
// edit mode / replay-confirmation dance (KOK-030 ships CREATE + READ only — core/sales has no
// update yet, that's KOK-031), no receipt photo. Adds what purchases doesn't need: a paymentStatus
// toggle that conditionally requires method+account (mirrors `recordSaleCommandSchema`'s
// discriminated union, D-4), and two per-line warnings (stock-negative amber, INV-8;
// below-replacement-cost red, C-5).
//
// No customer/session picker: customers CRUD (KOK-032) hasn't shipped, and no SessionPicker
// component exists anywhere in this codebase yet (PurchaseForm/ProductionRunForm/ExitForm all
// note the same "Sessions doesn't have a picker" gap and simply never set the schema's optional
// `sessionId`) — so both optional fields are simply never set from this form, same precedent.

import type { FinancialAccountDto, ItemDto } from "@kokoro/shared";
import {
  formatMoney,
  mulMoneyByQty,
  nowIso,
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentStatus,
  recordSaleCommandSchema,
  toBusinessDate,
} from "@kokoro/shared";
import { useEffect, useMemo, useState } from "react";

import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useItemsQuery } from "@/features/catalog/api";
import { useStock } from "@/features/inventory/api";
import { useRecordSale } from "@/features/sales/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { salesLabels } from "@/lib/i18n-sales";

export interface SaleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
}

interface SaleLineValue extends LineEditorLine {
  itemId: string | null;
  /** Milli-units decimal string (scale 3) — same convention as PurchaseForm's line qty. */
  qty: string;
  /** Unit price, centavos-per-WHOLE-unit decimal string (scale 2) — editable, prefilled from
   * `item.salePrice` the moment an item is picked (SC-03). Reused as `LineEditor`'s generic
   * `amount` slot; here it means "price per unit", not "line total" (purchases' meaning). */
  amount: string;
}

function emptyLine(): SaleLineValue {
  return { itemId: null, qty: "", amount: "" };
}

export function SaleForm({ open, onOpenChange, accounts }: SaleFormProps) {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("PAID");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    PAYMENT_METHODS[0] as PaymentMethod,
  );
  const [accountId, setAccountId] = useState<string>("");
  const [businessDate, setBusinessDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SaleLineValue[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useRecordSale();

  const itemsQuery = useItemsQuery({ isActive: true, kind: "FINISHED" });
  const itemsById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  // Current on-hand qty per item (v_stock, INV-5) — used for the amber "stock would go negative"
  // warning below. Unfiltered (all kinds): fine to fetch the whole table at this app's scale, same
  // precedent as PurchaseForm's unfiltered useItemsQuery for its own line lookups.
  const stockQuery = useStock();
  const onHandByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQuery.data?.stock ?? []) map.set(row.itemId, row.qtyOnHand);
    return map;
  }, [stockQuery.data]);

  // Reset on the open transition only, mirroring PurchaseForm/ProductionRunForm's precedent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset-on-open precedent, see above.
  useEffect(() => {
    if (open) {
      setPaymentStatus("PAID");
      setPaymentMethod(PAYMENT_METHODS[0] as PaymentMethod);
      setAccountId(accounts[0]?.id ?? "");
      setBusinessDate(toBusinessDate(nowIso()));
      setNotes("");
      setLines([emptyLine()]);
      setError(null);
    }
  }, [open]);

  const disabled = createMutation.isPending;
  const isPaid = paymentStatus === "PAID";

  /** Prefills a line's unit price from the item's catalog `salePrice` the moment the item changes
   * and the price field is still blank — editable afterward, never overwritten again (same
   * "convenience default, not sticky" rule as ProductionRunForm's recipe-line prefill). LineEditor
   * itself only forwards `itemId` to its `onChange` (see LineEditor.tsx), so the lookup happens
   * here, against the previous line at the same index, rather than inside LineEditor. */
  function handleLinesChange(nextLines: SaleLineValue[]) {
    const withPrefill = nextLines.map((line, index) => {
      const prevItemId = lines[index]?.itemId ?? null;
      if (line.itemId && line.itemId !== prevItemId && line.amount.trim() === "") {
        const item = itemsById.get(line.itemId);
        if (item?.salePrice != null) {
          return { ...line, amount: formatIntAsDecimalInput(item.salePrice, 2) };
        }
      }
      return line;
    });
    setLines(withPrefill);
  }

  // Aggregate requested qty per item across ALL lines (a sale can list the same FINISHED item
  // twice) — INV-8's negative-stock check is about the item's post-sale balance, not any one line
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
      sum += mulMoneyByQty(unitPrice, qty);
    }
    return sum;
  }, [lines]);

  async function handleSubmit() {
    setError(null);
    if (isPaid && !accountId) {
      setError(salesLabels.errors.accountRequired);
      return;
    }

    const parsedLines: { itemId: string; qty: number; unitPrice: number }[] = [];
    for (const line of lines) {
      const qty = parseDecimalToInt(line.qty, 3);
      const unitPrice = parseDecimalToInt(line.amount, 2);
      if (!line.itemId || qty === null || qty <= 0 || unitPrice === null) {
        setError(salesLabels.errors.invalidLine);
        return;
      }
      parsedLines.push({ itemId: line.itemId, qty, unitPrice });
    }

    const commonFields = {
      notes: notes.trim() === "" ? undefined : notes.trim(),
      occurredAt: nowIso(),
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

    try {
      await createMutation.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : salesLabels.errors.generic);
    }
  }

  function renderLineExtra(line: SaleLineValue) {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    if (!item) return null;

    const qty = parseDecimalToInt(line.qty, 3);
    const unitPrice = parseDecimalToInt(line.amount, 2);
    const subtotal =
      qty !== null && qty > 0 && unitPrice !== null ? mulMoneyByQty(unitPrice, qty) : null;

    const onHand = onHandByItemId.get(item.id) ?? 0;
    const requested = qtyByItemId.get(item.id) ?? 0;
    const negativeStockWarning = requested > 0 && onHand - requested < 0;

    // unitPrice is centavos per WHOLE unit; item.replacementCost is centavos per MILLI-unit (same
    // scale as item.wac, Doc 04 §2) — divide by 1000 for a like-for-like comparison, mirroring
    // PurchaseForm's renderLineExtra which needs no such conversion because its own lineTotal/qty
    // division already lands in centavos-per-milli-unit.
    const belowReplacementWarning =
      unitPrice !== null && item.replacementCost > 0 && unitPrice / 1000 < item.replacementCost;

    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <span className="text-muted-foreground">
          {salesLabels.lineSubtotal}:{" "}
          <span className="numeric-cell font-medium text-foreground">
            {subtotal !== null ? formatMoney(subtotal) : "—"}
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={salesLabels.recordTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{salesLabels.recordTitle}</h2>
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
            {formatMoney(totalPreview)}
          </span>
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
          {salesLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled || (isPaid && !accountId)}>
          {salesLabels.submit}
        </Button>
      </div>
    </Dialog>
  );
}
