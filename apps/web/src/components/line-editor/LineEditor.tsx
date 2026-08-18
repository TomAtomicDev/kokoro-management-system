// Generic event-line editor (Doc 06 §4-adjacent, first consumer: purchases KOK-016). Deliberately
// domain-agnostic — sales (KOK-030) and recipes (KOK-025) reuse this for their own line shapes, so
// it knows nothing about money/qty scale, purchases, or "inflation signals". Each line only needs
// an item and a quantity string (both stay raw strings in local state, same convention as
// RecordTransactionDialog's `amount` state) so the CALLER decides how to parse them (purchases:
// qty scale 3 / amount scale 2 centavos-for-the-line; a future sales line might parse differently)
// — this component never calls parseDecimalToInt itself.
//
// `amount` is OPTIONAL (KOK-025): recipe lines have no per-line money, only itemId+qty. Pass
// `showAmount={false}` to hide the amount column entirely; omit it (or pass `true`) and behavior
// is unchanged from before recipes existed — purchases doesn't pass either prop.

import {
  compatibleUnitsFor,
  displayUnitLabel,
  type ItemKind,
  type QtyDisplayUnit,
  type Unit,
} from "@kokoro/shared";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { ItemPicker, type ItemPickerEligibility } from "@/components/catalog/ItemPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** Minimum shape a line editor row needs. Callers extend this with their own domain fields, if
 * any (purchases don't need to — itemId/qty/amount is the whole line). */
export interface LineEditorLine {
  itemId: string | null;
  /** Decimal input string, caller-defined scale (e.g. milli-units for a qty). */
  qty: string;
  /** Decimal input string, caller-defined scale (e.g. centavos for a line total). Omit entirely
   * for line shapes that have no per-line money (recipes) — pair with `showAmount={false}`. */
  amount?: string;
}

export interface LineEditorLabels {
  item: string;
  qty: string;
  unit?: string;
  /** Unused (and safe to omit) when the caller passes `showAmount={false}`. */
  amount?: string;
  addLine: string;
  removeLine: string;
  qtyPlaceholder?: string;
  amountPlaceholder?: string;
}

export interface LineEditorUnitSelector<T extends LineEditorLine> {
  /** The selected display unit stored by the caller, or null for a newly selected item. */
  getValue: (line: T) => QtyDisplayUnit | null;
  onChange: (index: number, unit: QtyDisplayUnit) => void;
  label: string;
  /** Overrides each option's text (default: the shared package's short abbreviation, e.g. "g").
   * Recipes pass the full Spanish label ("Gramos (g)") to match the rest of the form. */
  optionLabel?: (unit: QtyDisplayUnit) => string;
}

export interface LineEditorProps<T extends LineEditorLine> {
  lines: T[];
  onChange: (lines: T[]) => void;
  /** Builds a fresh empty row — the caller owns any domain fields beyond itemId/qty/amount, so
   * LineEditor can't construct one itself. */
  createLine: () => T;
  labels: LineEditorLabels;
  /** Render-prop slot for domain-specific per-line UI (e.g. purchases' unit-cost preview, or
   * recipes' per-line cost contribution) — composes without this component knowing what it
   * renders. */
  renderExtraColumns?: (line: T, index: number) => ReactNode;
  /** Lets a caller atomically add domain-specific resets to an item change. */
  onItemChange?: (index: number, itemId: string | null) => Partial<T> | undefined;
  disabled?: boolean;
  /** Passed straight through to each row's ItemPicker. An array means "any of these kinds"
   * (ItemPicker filters client-side since `GET /items` only accepts one `kind`). */
  itemKindFilter?: ItemKind | ItemKind[];
  /** Additional constraints passed through to each row's ItemPicker. */
  itemEligibility?: ItemPickerEligibility;
  /** Explains why no item matches itemEligibility. */
  itemEmptyMessage?: string;
  /** Resolves an item's canonical unit for the unit suffix or opt-in display-unit selector. */
  getItemUnit?: (itemId: string) => Unit | undefined;
  /** Opt in to a per-line display-unit selector. Omit to show the canonical unit suffix. */
  unitSelector?: LineEditorUnitSelector<T>;
  /** Show the amount input column. Defaults to `true` (purchases' original, unchanged behavior);
   * recipes pass `false` since a recipe line has no per-line money. */
  showAmount?: boolean;
}

export function LineEditor<T extends LineEditorLine>({
  lines,
  onChange,
  createLine,
  labels,
  renderExtraColumns,
  onItemChange,
  disabled,
  itemKindFilter,
  itemEligibility,
  itemEmptyMessage,
  getItemUnit,
  unitSelector,
  showAmount = true,
}: LineEditorProps<T>) {
  const amountLabel = labels.amount ?? "Aporte al costo";
  const [selectedItemUnits, setSelectedItemUnits] = useState<Map<string, Unit>>(() => new Map());

  // A display-unit selector shares this column with the quantity input. Give the pair enough
  // room for a readable quantity while keeping the canonical-unit suffix layout compact.
  const gridColumns = unitSelector
    ? showAmount
      ? renderExtraColumns
        ? "grid-cols-[minmax(0,1fr)_15rem_10rem_12rem_2.75rem]"
        : "grid-cols-[minmax(0,1fr)_15rem_10rem_2.75rem]"
      : renderExtraColumns
        ? "grid-cols-[minmax(0,1fr)_15rem_12rem_2.75rem]"
        : "grid-cols-[minmax(0,1fr)_15rem_2.75rem]"
    : showAmount
      ? renderExtraColumns
        ? "grid-cols-[minmax(0,1fr)_9rem_10rem_12rem_2.75rem]"
        : "grid-cols-[minmax(0,1fr)_9rem_10rem_2.75rem]"
      : renderExtraColumns
        ? "grid-cols-[minmax(0,1fr)_9rem_12rem_2.75rem]"
        : "grid-cols-[minmax(0,1fr)_9rem_2.75rem]";

  function updateLine(index: number, patch: Partial<T>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  function addLine() {
    onChange([...lines, createLine()]);
  }

  function itemUnitFor(line: T): Unit | undefined {
    if (!line.itemId) return undefined;
    return getItemUnit?.(line.itemId) ?? selectedItemUnits.get(line.itemId);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`hidden ${gridColumns} items-center gap-2 px-3 font-medium text-muted-foreground text-xs sm:grid`}
      >
        <span className="min-w-0">{labels.item}</span>
        <span className="min-w-0">{labels.qty}</span>
        {showAmount ? <span className="min-w-0">{amountLabel}</span> : null}
        {renderExtraColumns ? (
          <span className="min-w-0">{showAmount ? null : amountLabel}</span>
        ) : null}
        <span className="size-9" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div
            // Rows are ephemeral form state with no stable id until submit; values are
            // controlled by index-addressed state (not by key identity), and rows are only ever
            // appended/removed here, never reordered, so index-as-key is safe.
            // biome-ignore lint/suspicious/noArrayIndexKey: see comment above.
            key={index}
            className={`flex flex-col gap-2 rounded-md border border-border p-3 sm:grid sm:items-start ${gridColumns}`}
          >
            <div className="min-w-0">
              <ItemPicker
                value={line.itemId}
                onChange={(itemId, item) => {
                  if (item) {
                    setSelectedItemUnits((current) => {
                      if (current.get(item.id) === item.unit) return current;
                      const next = new Map(current);
                      next.set(item.id, item.unit);
                      return next;
                    });
                  }
                  const extraPatch = onItemChange?.(index, itemId);
                  updateLine(index, { itemId, ...extraPatch } as Partial<T>);
                }}
                kindFilter={itemKindFilter}
                eligibility={itemEligibility}
                emptyMessage={itemEmptyMessage}
                disabled={disabled}
                placeholder={labels.item}
              />
            </div>
            <div className="min-w-0">
              <span className="mb-1 block font-medium text-muted-foreground text-xs sm:hidden">
                {labels.qty}
              </span>
              <div className="flex min-w-0 items-center gap-1.5">
                <Input
                  className="min-w-0 flex-1"
                  inputMode="decimal"
                  aria-label={labels.qty}
                  placeholder={labels.qtyPlaceholder ?? "0"}
                  value={line.qty}
                  onChange={(event) => updateLine(index, { qty: event.target.value } as Partial<T>)}
                  disabled={disabled}
                />
                {(() => {
                  const canonicalUnit = itemUnitFor(line);
                  if (!canonicalUnit) return null;
                  if (!unitSelector) {
                    return (
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {displayUnitLabel(canonicalUnit)}
                      </span>
                    );
                  }
                  const selectedUnit = unitSelector.getValue(line) ?? canonicalUnit;
                  return (
                    <Select
                      aria-label={`${labels.qty} — ${unitSelector.label}`}
                      className="h-9 w-24 shrink-0 px-2 text-xs sm:w-28"
                      value={selectedUnit}
                      onChange={(event) =>
                        unitSelector.onChange(index, event.target.value as QtyDisplayUnit)
                      }
                      disabled={disabled}
                    >
                      {compatibleUnitsFor(canonicalUnit).map((unit) => (
                        <option key={unit} value={unit}>
                          {(unitSelector.optionLabel ?? displayUnitLabel)(unit)}
                        </option>
                      ))}
                    </Select>
                  );
                })()}
              </div>
            </div>
            {showAmount ? (
              <div className="min-w-0">
                <span className="mb-1 block font-medium text-muted-foreground text-xs sm:hidden">
                  {amountLabel}
                </span>
                <Input
                  className="min-w-0"
                  inputMode="decimal"
                  aria-label={amountLabel}
                  placeholder={labels.amountPlaceholder ?? "0.00"}
                  value={line.amount ?? ""}
                  onChange={(event) =>
                    updateLine(index, { amount: event.target.value } as Partial<T>)
                  }
                  disabled={disabled}
                />
              </div>
            ) : null}
            {renderExtraColumns ? (
              <div className="min-w-0">{renderExtraColumns(line, index)}</div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 justify-self-start sm:justify-self-center"
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
