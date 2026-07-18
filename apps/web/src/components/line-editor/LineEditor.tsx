// Generic event-line editor (Doc 06 §4-adjacent, first consumer: purchases KOK-016). Deliberately
// domain-agnostic — sales (KOK-030) and recipes (KOK-025) reuse this for their own line shapes, so
// it knows nothing about money/qty scale, purchases, or "inflation signals". Each line only needs
// an item, a quantity string, and an amount string; both numeric fields stay raw strings in local
// state (same convention as RecordTransactionDialog's `amount` state) so the CALLER decides how to
// parse them (purchases: qty scale 3 / amount scale 2 centavos-for-the-line; a future sales line
// might parse differently) — this component never calls parseDecimalToInt itself.

import type { ItemKind } from "@kokoro/shared";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Minimum shape a line editor row needs. Callers extend this with their own domain fields, if
 * any (purchases don't need to — itemId/qty/amount is the whole line). */
export interface LineEditorLine {
  itemId: string | null;
  /** Decimal input string, caller-defined scale (e.g. milli-units for a qty). */
  qty: string;
  /** Decimal input string, caller-defined scale (e.g. centavos for a line total). */
  amount: string;
}

export interface LineEditorLabels {
  item: string;
  qty: string;
  amount: string;
  addLine: string;
  removeLine: string;
  qtyPlaceholder?: string;
  amountPlaceholder?: string;
}

export interface LineEditorProps<T extends LineEditorLine> {
  lines: T[];
  onChange: (lines: T[]) => void;
  /** Builds a fresh empty row — the caller owns any domain fields beyond itemId/qty/amount, so
   * LineEditor can't construct one itself. */
  createLine: () => T;
  labels: LineEditorLabels;
  /** Render-prop slot for domain-specific per-line UI (e.g. purchases' unit-cost preview) —
   * composes without this component knowing what it renders. */
  renderExtraColumns?: (line: T, index: number) => ReactNode;
  disabled?: boolean;
  /** Passed straight through to each row's ItemPicker. */
  itemKindFilter?: ItemKind;
}

export function LineEditor<T extends LineEditorLine>({
  lines,
  onChange,
  createLine,
  labels,
  renderExtraColumns,
  disabled,
  itemKindFilter,
}: LineEditorProps<T>) {
  function updateLine(index: number, patch: Partial<T>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  function addLine() {
    onChange([...lines, createLine()]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div
            // Rows are ephemeral form state with no stable id until submit; values are
            // controlled by index-addressed state (not by key identity), and rows are only ever
            // appended/removed here, never reordered, so index-as-key is safe.
            // biome-ignore lint/suspicious/noArrayIndexKey: see comment above.
            key={index}
            className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start"
          >
            <div className="flex-1 sm:min-w-40">
              <ItemPicker
                value={line.itemId}
                onChange={(itemId) => updateLine(index, { itemId } as Partial<T>)}
                kindFilter={itemKindFilter}
                disabled={disabled}
                placeholder={labels.item}
              />
            </div>
            <div className="w-full sm:w-28">
              <Input
                inputMode="decimal"
                aria-label={labels.qty}
                placeholder={labels.qtyPlaceholder ?? "0"}
                value={line.qty}
                onChange={(event) => updateLine(index, { qty: event.target.value } as Partial<T>)}
                disabled={disabled}
              />
            </div>
            <div className="w-full sm:w-32">
              <Input
                inputMode="decimal"
                aria-label={labels.amount}
                placeholder={labels.amountPlaceholder ?? "0.00"}
                value={line.amount}
                onChange={(event) =>
                  updateLine(index, { amount: event.target.value } as Partial<T>)
                }
                disabled={disabled}
              />
            </div>
            {renderExtraColumns ? (
              <div className="flex-1 sm:min-w-40">{renderExtraColumns(line, index)}</div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeLine(index)}
              disabled={disabled}
              aria-label={labels.removeLine}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" onClick={addLine} disabled={disabled}>
        {labels.addLine}
      </Button>
    </div>
  );
}
