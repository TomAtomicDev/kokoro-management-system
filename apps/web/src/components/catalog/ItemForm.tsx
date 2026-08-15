// Shared field set for creating/editing an Item Ã¢â‚¬â€ used by both the full Catalog screen
// (create/edit drawer) and ItemPicker's inline-create dialog, so the two flows can never drift.
// Plain controlled React state, no react-hook-form (D-10).

import type { ItemCategory, ItemKind, Unit } from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  ITEM_CATEGORIES,
  ITEM_KINDS,
  type MilliCentavosPerUnit,
  rateFromTotal,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
  UNITS,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { type ReactNode, useId, useRef } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { InfoTooltip } from "@/components/ui/tooltip";
import { formatCostRateInput, parseCostRateInput } from "@/lib/cost-rate";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { catalogLabels } from "@/lib/i18n-catalog";

export interface ItemFormValues {
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  /** Decimal string in Bs, e.g. "12.50" Ã¢â‚¬â€ empty string means "no price set". */
  salePrice: string;
  /** Decimal string in the item's own unit, e.g. "1.5" Ã¢â‚¬â€ empty string means "no alert". */
  minStockQty: string;
  /** Decimal string in Bs per whole unit for RAW_MATERIAL items marked as unmetered. */
  replacementCostMc: string;
  isUnmetered: boolean;
  notes: string;
}

export function emptyItemFormValues(defaults?: Partial<ItemFormValues>): ItemFormValues {
  const kind = defaults?.kind ?? "RAW_MATERIAL";
  return {
    name: "",
    kind,
    category: defaults?.category ?? (kind === "PACKAGING" ? "NOT_EATABLE" : "INGREDIENT"),
    unit: defaults?.unit ?? (kind === "FINISHED" || kind === "PACKAGING" ? "UNIT" : "KG"),
    salePrice: "",
    minStockQty: "",
    replacementCostMc: "",
    isUnmetered: false,
    notes: "",
  };
}

export function itemFormValuesFromDto(item: {
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  salePriceMc: MilliCentavosPerUnit | null;
  minStockQty: number | null;
  replacementCostMc: number;
  isUnmetered: boolean;
  notes: string | null;
}): ItemFormValues {
  return {
    name: item.name,
    kind: item.kind,
    category: item.category,
    unit: item.unit,
    salePrice:
      item.salePriceMc === null
        ? ""
        : formatIntAsDecimalInput(totalCentavos(item.salePriceMc, WHOLE_UNIT_MILLI_UNITS), 2),
    minStockQty: item.minStockQty === null ? "" : formatIntAsDecimalInput(item.minStockQty, 3),
    replacementCostMc: formatCostRateInput(toMilliCentavosPerUnit(item.replacementCostMc)),
    isUnmetered: item.isUnmetered,
    notes: item.notes ?? "",
  };
}

/** Parsed, integer-domain values ready to attach to a create/update command (D-5). */
export interface ItemFormParsed {
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  salePriceMc: MilliCentavosPerUnit | null;
  minStockQty: number | null;
  replacementCostMc: MilliCentavosPerUnit | null;
  isUnmetered: boolean;
  notes: string | null;
}

export type ItemFormParseResult =
  | { ok: true; value: ItemFormParsed }
  | {
      ok: false;
      field: "name" | "salePrice" | "minStockQty" | "replacementCostMc";
      code:
        | "nameRequired"
        | "salePriceInvalid"
        | "salePriceRequired"
        | "salePriceForbidden"
        | "minStockQtyInvalid"
        | "minStockQtyRequired"
        | "minStockQtyForbidden"
        | "replacementCostMcInvalid"
        | "replacementCostMcTooManyDecimals";
    };

/** Returns a field-specific error when a value is missing or doesn't parse as a valid decimal. */
export function parseItemFormValues(values: ItemFormValues): ItemFormParseResult {
  const name = values.name.trim();
  if (name === "") return { ok: false, field: "name", code: "nameRequired" };

  let salePriceMc: MilliCentavosPerUnit | null = null;
  if (values.salePrice.trim() !== "") {
    const parsed = parseDecimalToInt(values.salePrice, 2);
    if (parsed === null) {
      return { ok: false, field: "salePrice", code: "salePriceInvalid" };
    }
    salePriceMc = rateFromTotal(toCentavos(parsed), WHOLE_UNIT_MILLI_UNITS);
  }

  let minStockQty: number | null = null;
  if (values.minStockQty.trim() !== "") {
    const parsed = parseDecimalToInt(values.minStockQty, 3);
    if (parsed === null) {
      return { ok: false, field: "minStockQty", code: "minStockQtyInvalid" };
    }
    minStockQty = parsed;
  }

  let replacementCostMc: MilliCentavosPerUnit | null = null;
  if (
    values.kind === "RAW_MATERIAL" &&
    values.isUnmetered &&
    values.replacementCostMc.trim() !== ""
  ) {
    const parsed = parseCostRateInput(values.replacementCostMc, { allowZero: true });
    if (!parsed.ok) {
      if (parsed.reason === "tooManyDecimals") {
        return {
          ok: false,
          field: "replacementCostMc",
          code: "replacementCostMcTooManyDecimals",
        };
      }
      return { ok: false, field: "replacementCostMc", code: "replacementCostMcInvalid" };
    }
    replacementCostMc = parsed.value;
  }

  if (values.kind === "FINISHED") {
    if (salePriceMc === null) {
      return { ok: false, field: "salePrice", code: "salePriceRequired" };
    }
    if (minStockQty !== null) {
      return { ok: false, field: "minStockQty", code: "minStockQtyForbidden" };
    }
  } else {
    if (salePriceMc !== null) {
      return { ok: false, field: "salePrice", code: "salePriceForbidden" };
    }
    if ((values.kind === "RAW_MATERIAL" || values.kind === "PACKAGING") && minStockQty === null) {
      return { ok: false, field: "minStockQty", code: "minStockQtyRequired" };
    }
  }

  return {
    ok: true,
    value: {
      name,
      kind: values.kind,
      category: values.category,
      unit: values.unit,
      salePriceMc,
      minStockQty,
      replacementCostMc,
      isUnmetered: values.isUnmetered,
      notes: values.notes.trim() === "" ? null : values.notes.trim(),
    },
  };
}

function Field({
  label,
  htmlFor,
  tooltip,
  children,
}: {
  label: string;
  htmlFor: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center gap-1">
        <label htmlFor={htmlFor} className="font-medium text-foreground">
          {label}
        </label>
        {tooltip ? <InfoTooltip content={tooltip} label={`Más información: ${label}`} /> : null}
      </div>
      {children}
    </div>
  );
}

/** Abbreviation for the "/ kg" style suffix on the derived cost figures below. */
const UNIT_ABBREV: Record<Unit, string> = {
  KG: "kg",
  L: "L",
  UNIT: "u",
  M: "m",
};

export interface ItemFormProps {
  values: ItemFormValues;
  onChange: (values: ItemFormValues) => void;
  /** Existing items must retain their stored category/unit when their kind changes. */
  isEditMode?: boolean;
  /**
   * Shown as a read-only "calculado" block. Both values use ADR-017's integer
   * milli-centavos-per-WHOLE-unit scale and are displayed through `totalCentavos`.
   */
  derived?: { wacMc: number; replacementCostMc: number; replacementCostUpdatedAt: string | null };
  disabled?: boolean;
}

export function ItemForm({
  values,
  onChange,
  derived,
  disabled,
  isEditMode = false,
}: ItemFormProps) {
  const formId = useId();
  const userSetRef = useRef({ category: false, unit: false });
  function set<K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) {
    if (!isEditMode && key === "category") userSetRef.current.category = true;
    if (!isEditMode && key === "unit") userSetRef.current.unit = true;
    onChange({ ...values, [key]: value });
  }
  function setKind(kind: ItemKind) {
    const category =
      !isEditMode && !userSetRef.current.category && kind === "PACKAGING"
        ? "NOT_EATABLE"
        : values.category;
    const unit =
      !isEditMode && !userSetRef.current.unit
        ? kind === "FINISHED" || kind === "PACKAGING"
          ? "UNIT"
          : "KG"
        : values.unit;
    onChange({
      ...values,
      kind,
      category,
      unit,
      salePrice: kind === "FINISHED" ? values.salePrice : "",
      minStockQty: kind === "FINISHED" ? "" : values.minStockQty,
      isUnmetered: kind === "RAW_MATERIAL" ? values.isUnmetered : false,
      replacementCostMc: kind === "RAW_MATERIAL" ? values.replacementCostMc : "",
    });
  }
  function setIsUnmetered(isUnmetered: boolean) {
    onChange({
      ...values,
      isUnmetered,
      minStockQty: isUnmetered ? "0" : values.minStockQty,
      replacementCostMc: isUnmetered ? values.replacementCostMc : "",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label={catalogLabels.fieldName} htmlFor={`${formId}-name`}>
        <div className="flex flex-col gap-1">
          <Input
            id={`${formId}-name`}
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            disabled={disabled}
            autoFocus
            required
            maxLength={200}
          />
          <span className="self-end text-muted-foreground text-xs">{values.name.length}/200</span>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={catalogLabels.fieldKind} htmlFor={`${formId}-kind`}>
          <Select
            id={`${formId}-kind`}
            value={values.kind}
            onChange={(e) => setKind(e.target.value as ItemKind)}
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

      {values.kind === "RAW_MATERIAL" ? (
        <div className="flex items-center gap-2 text-foreground text-sm">
          <Switch
            checked={values.isUnmetered}
            onCheckedChange={setIsUnmetered}
            disabled={disabled}
            aria-label={catalogLabels.fieldIsUnmetered}
          />
          <span>{catalogLabels.fieldIsUnmetered}</span>
          <InfoTooltip
            content={catalogLabels.tooltipFieldIsUnmetered}
            label={`Más información: ${catalogLabels.fieldIsUnmetered}`}
          />
        </div>
      ) : null}

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
        {values.kind === "FINISHED" ? (
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
        ) : null}

        {values.kind === "RAW_MATERIAL" && values.isUnmetered ? (
          <Field
            label={catalogLabels.fieldReplacementCost}
            htmlFor={`${formId}-replacement-cost`}
            tooltip={catalogLabels.tooltipFieldReplacementCost}
          >
            <div className="flex flex-col gap-1">
              <Input
                id={`${formId}-replacement-cost`}
                inputMode="decimal"
                placeholder="0.00000"
                value={values.replacementCostMc}
                onChange={(e) => set("replacementCostMc", e.target.value)}
                disabled={disabled}
                aria-describedby={`${formId}-replacement-cost-help`}
              />
              <span
                id={`${formId}-replacement-cost-help`}
                className="text-muted-foreground text-xs"
              >
                {catalogLabels.costRateHelp}
              </span>
            </div>
          </Field>
        ) : null}

        {values.kind !== "FINISHED" ? (
          <Field
            label={catalogLabels.fieldMinStock}
            htmlFor={`${formId}-min-stock`}
            tooltip={catalogLabels.tooltipFieldMinStock}
          >
            <Input
              id={`${formId}-min-stock`}
              inputMode="decimal"
              placeholder="0"
              value={values.minStockQty}
              onChange={(e) => set("minStockQty", e.target.value)}
              disabled={disabled || values.isUnmetered}
              required={values.kind === "RAW_MATERIAL" || values.kind === "PACKAGING"}
            />
          </Field>
        ) : null}
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
              {formatMoney(
                totalCentavos(toMilliCentavosPerUnit(derived.wacMc), WHOLE_UNIT_MILLI_UNITS),
              )}{" "}
              / {UNIT_ABBREV[values.unit]}
            </span>
          </div>
          {!values.isUnmetered ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {catalogLabels.replacementCostMc}{" "}
                <span className="text-xs">({catalogLabels.calculated})</span>
              </span>
              <span className="numeric-cell font-medium">
                {formatMoney(
                  totalCentavos(
                    toMilliCentavosPerUnit(derived.replacementCostMc),
                    WHOLE_UNIT_MILLI_UNITS,
                  ),
                )}{" "}
                / {UNIT_ABBREV[values.unit]}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Re-exported so callers formatting a stored qty/money value alongside this form (e.g. showing
// min stock in the item's own unit) don't need a second import for the same helper.
export { formatQty };
