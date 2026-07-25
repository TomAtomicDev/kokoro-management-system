// Line editor for a custom order's QUOTING-time lines (KOK-034, Doc 04 §3.3 `custom_order_lines`).
// Deliberately NOT the generic `LineEditor` (components/line-editor/LineEditor.tsx): an order line's
// shape is different enough to warrant its own component — `itemId` is nullable with `description`
// as its free-text alternative (a one-off creation may have no catalog item yet), and the money
// column is an OPTIONAL `lineTotal` PIN (a share of `agreedTotal`, left blank to let the
// largest-remainder split decide) rather than a required per-unit price. Reusing `LineEditor` would
// mean bolting a description field and an optional-amount mode onto a component whose contract
// assumes neither.

import { X } from "lucide-react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ordersLabels } from "@/lib/i18n-orders";

export interface OrderLineValue {
  itemId: string | null;
  /** Free-text alternative to `itemId` — required by the schema when `itemId` is null. */
  description: string;
  /** Milli-units decimal string (scale 3), same convention as every other line editor. */
  qty: string;
  /** Centavos decimal string (scale 2). Blank means "let the delivery-time split decide". */
  lineTotal: string;
}

export function emptyOrderLine(): OrderLineValue {
  return { itemId: null, description: "", qty: "1", lineTotal: "" };
}

export interface OrderLineEditorProps {
  lines: OrderLineValue[];
  onChange: (lines: OrderLineValue[]) => void;
  disabled?: boolean;
}

export function OrderLineEditor({ lines, onChange, disabled }: OrderLineEditorProps) {
  function updateLine(index: number, patch: Partial<OrderLineValue>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  function addLine() {
    onChange([...lines, emptyOrderLine()]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div
            // Rows are ephemeral form state addressed by index, never reordered — same precedent as
            // LineEditor.tsx's identical comment.
            // biome-ignore lint/suspicious/noArrayIndexKey: see comment above.
            key={index}
            className="flex flex-col gap-2 rounded-md border border-border p-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="flex-1 sm:min-w-40">
                <ItemPicker
                  value={line.itemId}
                  onChange={(itemId) => updateLine(index, { itemId })}
                  kindFilter="FINISHED"
                  disabled={disabled}
                  placeholder={ordersLabels.lineItem}
                />
              </div>
              <div className="w-full sm:w-24">
                <Input
                  inputMode="decimal"
                  aria-label={ordersLabels.lineQty}
                  placeholder="1"
                  value={line.qty}
                  onChange={(event) => updateLine(index, { qty: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="w-full sm:w-36">
                <Input
                  inputMode="decimal"
                  aria-label={ordersLabels.lineLineTotal}
                  placeholder="0.00"
                  value={line.lineTotal}
                  onChange={(event) => updateLine(index, { lineTotal: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeLine(index)}
                disabled={disabled}
                aria-label={ordersLabels.removeLine}
              >
                <X className="size-4" />
              </Button>
            </div>
            {line.itemId === null ? (
              <Input
                aria-label={ordersLabels.lineDescription}
                placeholder={ordersLabels.lineDescriptionPlaceholder}
                value={line.description}
                onChange={(event) => updateLine(index, { description: event.target.value })}
                disabled={disabled}
              />
            ) : null}
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" onClick={addLine} disabled={disabled}>
        {ordersLabels.addLine}
      </Button>
    </div>
  );
}
