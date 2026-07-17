// Onboarding step 3 (KOK-020, Doc 07 step 3, Doc 04 §7's dev fixture catalog) — an editable table
// of starter items, pre-filled with the fixture list, NOT auto-committed: the owner reviews/edits/
// removes rows, then an explicit "Crear catálogo" button calls bulkCreateItems with whatever rows
// remain. Reuses `ItemFormValues`/`parseItemFormValues` from ItemForm.tsx directly (per this task's
// brief: "don't reinvent parsing rules") — each row is shaped exactly like a single ItemForm, so
// the same salePrice-scale-2/minStockQty-scale-3 parsing this codebase already trusts applies here
// unchanged, and `parseItemFormValues`'s output already matches `CreateItemCommand`'s field set
// 1:1, so a parsed row can be handed to `bulkCreateItemsCommandSchema` with zero extra mapping.

import {
  ITEM_CATEGORIES,
  ITEM_KINDS,
  type ItemCategory,
  type ItemKind,
  UNITS,
  type Unit,
} from "@kokoro/shared";
import { useState } from "react";

import { type ItemFormValues, parseItemFormValues } from "@/components/catalog/ItemForm";
import { Button } from "@/components/ui/button";
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
    minStockQty: 200000,
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
    minStockQty: 5000,
  },
  {
    name: "Rollos de canela",
    kind: "FINISHED",
    category: "BAKERY",
    unit: "UNIT",
    salePrice: 1800,
    minStockQty: 5000,
  },
  {
    name: "Cuñapés",
    kind: "FINISHED",
    category: "BAKERY",
    unit: "UNIT",
    salePrice: 1200,
    minStockQty: 5000,
  },
  {
    name: "Queso crema de kéfir",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "UNIT",
    salePrice: 3000,
    minStockQty: 3000,
  },
  {
    name: "Ghee",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "ML",
    salePrice: 4500,
    minStockQty: 3000,
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

export interface StepCatalogProps {
  onDone: () => void;
  onSkip: () => void;
}

export function StepCatalog({ onDone, onSkip }: StepCatalogProps) {
  const [rows, setRows] = useState<CatalogRow[]>(() => FIXTURE_ITEMS.map(fixtureToRow));
  const [error, setError] = useState<string | null>(null);

  const mutation = useBulkCreateItems();
  const disabled = mutation.isPending;

  function updateRow<K extends keyof ItemFormValues>(id: string, key: K, value: ItemFormValues[K]) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }

  async function handleSubmit() {
    setError(null);

    const parsedItems = [];
    for (const row of rows) {
      const parsed = parseItemFormValues(row);
      if (!parsed) {
        setError(`"${row.name || row.id}": ${onboardingLabels.errors.invalidAmount}`);
        return;
      }
      parsedItems.push(parsed);
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

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_1fr_1fr_auto] gap-2 border-b border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
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
              className="grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_1fr_1fr_auto] items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0"
            >
              <Input
                value={row.name}
                onChange={(e) => updateRow(row.id, "name", e.target.value)}
                disabled={disabled}
              />
              <Select
                value={row.kind}
                onChange={(e) => updateRow(row.id, "kind", e.target.value as ItemKind)}
                disabled={disabled}
              >
                {ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {onboardingLabels.kindLabels[k]}
                  </option>
                ))}
              </Select>
              <Select
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
              <Select
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
              <Input
                inputMode="decimal"
                placeholder="0.00"
                value={row.salePrice}
                onChange={(e) => updateRow(row.id, "salePrice", e.target.value)}
                disabled={disabled}
              />
              <Input
                inputMode="decimal"
                placeholder="0"
                value={row.minStockQty}
                onChange={(e) => updateRow(row.id, "minStockQty", e.target.value)}
                disabled={disabled}
              />
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
          ))}
        </div>
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
