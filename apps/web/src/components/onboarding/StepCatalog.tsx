// Onboarding step 3 (KOK-020, Doc 07 step 3, Doc 04 §7's dev fixture catalog) — an editable table
// of starter items, pre-filled with the fixture list, NOT auto-committed: the owner reviews/edits/
// removes rows, then an explicit "Crear catálogo" button calls bulkCreateItems with whatever rows
// remain. Reuses `ItemFormValues`/`parseItemFormValues` from ItemForm.tsx directly (per this task's
// brief: "don't reinvent parsing rules") — each row is shaped exactly like a single ItemForm, so
// the same salePrice-scale-2/minStockQty-scale-3 parsing this codebase already trusts applies here
// unchanged, and the parser's successful `value` already matches `CreateItemCommand`'s field set
// 1:1, so it can be handed to `bulkCreateItemsCommandSchema` with zero extra mapping.

import {
  generateUuidV7,
  ITEM_CATEGORIES,
  ITEM_KINDS,
  type ItemCategory,
  type ItemKind,
  UNITS,
  type Unit,
} from "@kokoro/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  emptyItemFormValues,
  type ItemFormParsed,
  type ItemFormValues,
  parseItemFormValues,
} from "@/components/catalog/ItemForm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useBulkCreateItems } from "@/features/onboarding/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput } from "@/lib/decimal";
import { onboardingLabels } from "@/lib/i18n-onboarding";

interface FixtureItem {
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  /** Centavos (D-5) or null for "no price set". */
  salePrice: number | null;
  /** Milli-units (D-5) or null for "no alert". */
  minStockQty: number | null;
}

// Doc 04 §7's dev fixture catalog — exact field values, already in the integer domains the API
// expects.
const FIXTURE_ITEMS: FixtureItem[] = [
  {
    name: "Masa madre",
    kind: "SEMI_FINISHED",
    category: "BAKERY",
    unit: "G",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Harina",
    kind: "RAW_MATERIAL",
    category: "INGREDIENT",
    unit: "KG",
    salePrice: null,
    minStockQty: 10000,
  },
  {
    name: "Leche",
    kind: "RAW_MATERIAL",
    category: "DAIRY",
    unit: "L",
    salePrice: null,
    minStockQty: 5000,
  },
  {
    name: "Kéfir",
    kind: "RAW_MATERIAL",
    category: "DAIRY",
    unit: "L",
    salePrice: null,
    minStockQty: 2000,
  },
  {
    name: "Pan de masa madre",
    kind: "FINISHED",
    category: "BAKERY",
    unit: "UNIT",
    salePrice: 2500,
    minStockQty: null,
  },
  {
    name: "Rollos de canela",
    kind: "FINISHED",
    category: "BAKERY",
    unit: "UNIT",
    salePrice: 1800,
    minStockQty: null,
  },
  {
    name: "Cuñapés",
    kind: "FINISHED",
    category: "BAKERY",
    unit: "UNIT",
    salePrice: 1200,
    minStockQty: null,
  },
  {
    name: "Queso crema de kéfir",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "UNIT",
    salePrice: 3000,
    minStockQty: null,
  },
  {
    name: "Ghee",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "ML",
    salePrice: 4500,
    minStockQty: null,
  },
  {
    name: "Cajas",
    kind: "RAW_MATERIAL",
    category: "PACKAGING",
    unit: "UNIT",
    salePrice: null,
    minStockQty: 20000,
  },
  {
    name: "Etiquetas",
    kind: "RAW_MATERIAL",
    category: "LABEL",
    unit: "UNIT",
    salePrice: null,
    minStockQty: 50000,
  },
];

interface CatalogRow extends ItemFormValues {
  id: string;
}

function fixtureToRow(item: FixtureItem, index: number): CatalogRow {
  return {
    id: `fixture-${index}`,
    name: item.name,
    kind: item.kind,
    category: item.category,
    unit: item.unit,
    salePrice: item.salePrice === null ? "" : formatIntAsDecimalInput(item.salePrice, 2),
    minStockQty: item.minStockQty === null ? "" : formatIntAsDecimalInput(item.minStockQty, 3),
    notes: "",
  };
}

function createBlankRow(): CatalogRow {
  return { id: generateUuidV7(), ...emptyItemFormValues() };
}

export interface StepCatalogProps {
  onDone: () => void;
  onSkip: () => void;
  readOnly?: boolean;
}

export function StepCatalog({ onDone, onSkip, readOnly = false }: StepCatalogProps) {
  const [rows, setRows] = useState<CatalogRow[]>(() => FIXTURE_ITEMS.map(fixtureToRow));
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    rowId: string;
    field: "name" | "salePrice" | "minStockQty";
    message: string;
  } | null>(null);

  const mutation = useBulkCreateItems();
  const disabled = mutation.isPending;

  if (readOnly) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium text-foreground text-lg">{onboardingLabels.catalogTitle}</h2>
          <p className="text-muted-foreground text-sm">{onboardingLabels.catalogBody}</p>
        </div>
        <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
          <p className="font-medium text-foreground">{onboardingLabels.alreadySaved}</p>
          <p className="text-muted-foreground">{onboardingLabels.savedCatalogBody}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/settings" className={buttonVariants({ variant: "outline" })}>
            {onboardingLabels.goToSettings}
          </Link>
          <Button type="button" onClick={onDone}>
            {onboardingLabels.continueButton}
          </Button>
        </div>
      </div>
    );
  }

  function updateRow<K extends keyof ItemFormValues>(id: string, key: K, value: ItemFormValues[K]) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    setRowError((current) => (current?.rowId === id ? null : current));
  }

  function updateRowKind(id: string, kind: ItemKind) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              kind,
              salePrice: kind === "FINISHED" ? row.salePrice : "",
              minStockQty: kind === "RAW_MATERIAL" ? row.minStockQty : "",
            }
          : row,
      ),
    );
    setRowError((current) => (current?.rowId === id ? null : current));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((row) => row.id !== id));
    setRowError((current) => (current?.rowId === id ? null : current));
  }

  function addRow() {
    setRows((prev) => [...prev, createBlankRow()]);
  }

  async function handleSubmit() {
    setError(null);
    setRowError(null);

    const parsedItems: ItemFormParsed[] = [];
    for (const row of rows) {
      const parsed = parseItemFormValues(row);
      if (!parsed.ok) {
        setRowError({
          rowId: row.id,
          field: parsed.field,
          message: onboardingLabels.errors[parsed.code],
        });
        return;
      }
      parsedItems.push(parsed.value);
    }

    try {
      await mutation.mutateAsync({ items: parsedItems });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : onboardingLabels.errors.generic);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium text-foreground text-lg">{onboardingLabels.catalogTitle}</h2>
        <p className="text-muted-foreground text-sm">{onboardingLabels.catalogBody}</p>
      </div>

      <div className="rounded-lg border border-border md:overflow-x-auto">
        <div className="md:min-w-[860px]">
          <div className="grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_1fr_1fr_4rem] gap-2 border-b border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground max-md:hidden">
            <span>{onboardingLabels.columnName}</span>
            <span>{onboardingLabels.columnKind}</span>
            <span>{onboardingLabels.columnCategory}</span>
            <span>{onboardingLabels.columnUnit}</span>
            <span>{onboardingLabels.columnSalePrice}</span>
            <span>{onboardingLabels.columnMinStock}</span>
            <span />
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_1fr_1fr_4rem] items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0 max-md:mb-3 max-md:flex max-md:flex-col max-md:items-stretch max-md:gap-3 max-md:rounded-md max-md:border max-md:bg-card max-md:p-3 max-md:last:mb-0"
            >
              <label
                className="contents max-md:flex max-md:flex-col max-md:gap-1"
                htmlFor={`catalog-${row.id}-name`}
              >
                <span className="hidden font-medium text-muted-foreground text-xs max-md:block">
                  {onboardingLabels.columnName}
                </span>
                <Input
                  id={`catalog-${row.id}-name`}
                  value={row.name}
                  onChange={(e) => updateRow(row.id, "name", e.target.value)}
                  disabled={disabled}
                />
              </label>
              <label
                className="contents max-md:flex max-md:flex-col max-md:gap-1"
                htmlFor={`catalog-${row.id}-kind`}
              >
                <span className="hidden font-medium text-muted-foreground text-xs max-md:block">
                  {onboardingLabels.columnKind}
                </span>
                <Select
                  id={`catalog-${row.id}-kind`}
                  value={row.kind}
                  onChange={(e) => updateRowKind(row.id, e.target.value as ItemKind)}
                  disabled={disabled}
                >
                  {ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {onboardingLabels.kindLabels[k]}
                    </option>
                  ))}
                </Select>
              </label>
              <label
                className="contents max-md:flex max-md:flex-col max-md:gap-1"
                htmlFor={`catalog-${row.id}-category`}
              >
                <span className="hidden font-medium text-muted-foreground text-xs max-md:block">
                  {onboardingLabels.columnCategory}
                </span>
                <Select
                  id={`catalog-${row.id}-category`}
                  value={row.category}
                  onChange={(e) => updateRow(row.id, "category", e.target.value as ItemCategory)}
                  disabled={disabled}
                >
                  {ITEM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {onboardingLabels.categoryLabels[c]}
                    </option>
                  ))}
                </Select>
              </label>
              <label
                className="contents max-md:flex max-md:flex-col max-md:gap-1"
                htmlFor={`catalog-${row.id}-unit`}
              >
                <span className="hidden font-medium text-muted-foreground text-xs max-md:block">
                  {onboardingLabels.columnUnit}
                </span>
                <Select
                  id={`catalog-${row.id}-unit`}
                  value={row.unit}
                  onChange={(e) => updateRow(row.id, "unit", e.target.value as Unit)}
                  disabled={disabled}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {onboardingLabels.unitLabels[u]}
                    </option>
                  ))}
                </Select>
              </label>
              {row.kind === "FINISHED" ? (
                <label
                  className="contents max-md:flex max-md:flex-col max-md:gap-1"
                  htmlFor={`catalog-${row.id}-sale-price`}
                >
                  <span className="hidden font-medium text-muted-foreground text-xs max-md:block">
                    {onboardingLabels.columnSalePrice}
                  </span>
                  <Input
                    id={`catalog-${row.id}-sale-price`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={row.salePrice}
                    onChange={(e) => updateRow(row.id, "salePrice", e.target.value)}
                    disabled={disabled}
                  />
                </label>
              ) : (
                <span aria-hidden="true" className="hidden md:block" />
              )}
              {row.kind === "RAW_MATERIAL" ? (
                <label
                  className="contents max-md:flex max-md:flex-col max-md:gap-1"
                  htmlFor={`catalog-${row.id}-min-stock`}
                >
                  <span className="hidden font-medium text-muted-foreground text-xs max-md:block">
                    {onboardingLabels.columnMinStock}
                  </span>
                  <Input
                    id={`catalog-${row.id}-min-stock`}
                    inputMode="decimal"
                    placeholder="0"
                    value={row.minStockQty}
                    onChange={(e) => updateRow(row.id, "minStockQty", e.target.value)}
                    disabled={disabled}
                  />
                </label>
              ) : (
                <span aria-hidden="true" className="hidden md:block" />
              )}
              <div className="max-md:flex max-md:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(row.id)}
                  disabled={disabled}
                >
                  {onboardingLabels.removeRow}
                </Button>
              </div>
              {rowError?.rowId === row.id ? (
                <p className="col-span-full text-negative text-xs max-md:w-full" role="alert">
                  {rowError.field === "name"
                    ? onboardingLabels.columnName
                    : rowError.field === "salePrice"
                      ? onboardingLabels.columnSalePrice
                      : onboardingLabels.columnMinStock}
                  : {rowError.message}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-start">
        <Button type="button" variant="outline" onClick={addRow} disabled={disabled}>
          {onboardingLabels.addRow}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{onboardingLabels.catalogEmpty}</p>
      ) : null}
      {error ? <p className="text-negative text-sm">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onSkip} disabled={disabled}>
          {onboardingLabels.skipButton}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled || rows.length === 0}>
          {onboardingLabels.submitCatalog}
        </Button>
      </div>
    </div>
  );
}
