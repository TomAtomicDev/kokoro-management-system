// Shared field set for creating/editing an Item — used by both the full Catalog screen
// (create/edit drawer) and ItemPicker's inline-create dialog, so the two flows can never drift.
// Plain controlled React state, no react-hook-form (D-10).

import type { ItemCategory, ItemKind, Unit } from "@kokoro/shared";
import { formatMoney, formatQty, ITEM_CATEGORIES, ITEM_KINDS, UNITS } from "@kokoro/shared";
import { type ReactNode, useId } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { catalogLabels } from "@/lib/i18n-catalog";

export interface ItemFormValues {
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  /** Decimal string in Bs, e.g. "12.50" — empty string means "no price set". */
  salePrice: string;
  /** Decimal string in the item's own unit, e.g. "1.5" — empty string means "no alert". */
  minStockQty: string;
  notes: string;
}

export function emptyItemFormValues(defaults?: Partial<ItemFormValues>): ItemFormValues {
  return {
    name: "",
    kind: defaults?.kind ?? "RAW_MATERIAL",
    category: defaults?.category ?? "INGREDIENT",
    unit: defaults?.unit ?? "KG",
    salePrice: "",
    minStockQty: "",
    notes: "",
  };
}

export function itemFormValuesFromDto(item: {
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  salePrice: number | null;
  minStockQty: number | null;
  notes: string | null;
}): ItemFormValues {
  return {
    name: item.name,
    kind: item.kind,
    category: item.category,
    unit: item.unit,
    salePrice: item.salePrice === null ? "" : formatIntAsDecimalInput(item.salePrice, 2),
    minStockQty: item.minStockQty === null ? "" : formatIntAsDecimalInput(item.minStockQty, 3),
    notes: item.notes ?? "",
  };
}

/** Parsed, integer-domain values ready to attach to a create/update command (D-5). */
export interface ItemFormParsed {
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  salePrice: number | null;
  minStockQty: number | null;
  notes: string | null;
}

/** Returns null for a field whose text didn't parse as a valid non-negative decimal. */
export function parseItemFormValues(values: ItemFormValues): ItemFormParsed | null {
  const name = values.name.trim();
  if (name === "") return null;

  let salePrice: number | null = null;
  if (values.salePrice.trim() !== "") {
    const parsed = parseDecimalToInt(values.salePrice, 2);
    if (parsed === null) return null;
    salePrice = parsed;
  }

  let minStockQty: number | null = null;
  if (values.minStockQty.trim() !== "") {
    const parsed = parseDecimalToInt(values.minStockQty, 3);
    if (parsed === null) return null;
    minStockQty = parsed;
  }

  return {
    name,
    kind: values.kind,
    category: values.category,
    unit: values.unit,
    salePrice,
    minStockQty,
    notes: values.notes.trim() === "" ? null : values.notes.trim(),
  };
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={htmlFor} className="font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Abbreviation for the "/ kg" style suffix on the derived cost figures below. */
const UNIT_ABBREV: Record<Unit, string> = { G: "g", KG: "kg", ML: "ml", L: "l", UNIT: "u" };

export interface ItemFormProps {
  values: ItemFormValues;
  onChange: (values: ItemFormValues) => void;
  /**
   * Shown as a read-only "calculado" block — never editable (Doc 03 C-1/C-3). `wac` and
   * `replacementCost` come off ItemDto as REAL centavos-PER-MILLI-UNIT (Doc 04 §2), so they are
   * scaled ×1000 here to show the money-per-whole-unit figure a human reads ("Bs 12,00 / kg").
   */
  derived?: { wac: number; replacementCost: number; replacementCostUpdatedAt: string | null };
  disabled?: boolean;
}

export function ItemForm({ values, onChange, derived, disabled }: ItemFormProps) {
  const formId = useId();
  function set<K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label={catalogLabels.fieldName} htmlFor={`${formId}-name`}>
        <Input
          id={`${formId}-name`}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          disabled={disabled}
          autoFocus
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={catalogLabels.fieldKind} htmlFor={`${formId}-kind`}>
          <Select
            id={`${formId}-kind`}
            value={values.kind}
            onChange={(e) => set("kind", e.target.value as ItemKind)}
            disabled={disabled}
          >
            {ITEM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {catalogLabels.kindLabels[kind]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={catalogLabels.fieldCategory} htmlFor={`${formId}-category`}>
          <Select
            id={`${formId}-category`}
            value={values.category}
            onChange={(e) => set("category", e.target.value as ItemCategory)}
            disabled={disabled}
          >
            {ITEM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {catalogLabels.categoryLabels[category]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={catalogLabels.fieldUnit} htmlFor={`${formId}-unit`}>
        <Select
          id={`${formId}-unit`}
          value={values.unit}
          onChange={(e) => set("unit", e.target.value as Unit)}
          disabled={disabled}
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {catalogLabels.unitLabels[unit]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={catalogLabels.fieldSalePrice} htmlFor={`${formId}-sale-price`}>
          <Input
            id={`${formId}-sale-price`}
            inputMode="decimal"
            placeholder="0.00"
            value={values.salePrice}
            onChange={(e) => set("salePrice", e.target.value)}
            disabled={disabled}
          />
        </Field>

        <Field label={catalogLabels.fieldMinStock} htmlFor={`${formId}-min-stock`}>
          <Input
            id={`${formId}-min-stock`}
            inputMode="decimal"
            placeholder="0"
            value={values.minStockQty}
            onChange={(e) => set("minStockQty", e.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>

      <Field label={catalogLabels.fieldNotes} htmlFor={`${formId}-notes`}>
        <textarea
          id={`${formId}-notes`}
          className="min-h-20 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          disabled={disabled}
        />
      </Field>

      {derived ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {catalogLabels.wac} <span className="text-xs">({catalogLabels.calculated})</span>
            </span>
            <span className="numeric-cell font-medium">
              {formatMoney(Math.round(derived.wac * 1000))} / {UNIT_ABBREV[values.unit]}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {catalogLabels.replacementCost}{" "}
              <span className="text-xs">({catalogLabels.calculated})</span>
            </span>
            <span className="numeric-cell font-medium">
              {formatMoney(Math.round(derived.replacementCost * 1000))} / {UNIT_ABBREV[values.unit]}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Re-exported so callers formatting a stored qty/money value alongside this form (e.g. showing
// min stock in the item's own unit) don't need a second import for the same helper.
export { formatQty };
