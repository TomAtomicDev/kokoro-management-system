// Onboarding step 3 (Doc 07 step 3): before saving, an editable table of starter items pre-filled
// from the fixture — "Crear catálogo" calls bulkCreateItems with whatever rows remain, reusing
// ItemForm.tsx's parsing so scale/validation stay identical. After saving, switches to a live
// editor over the real items (`useItemsQuery`), add/edit backed by the single-item `core/catalog`
// service (`CreateItemDialog`/`ItemDetailDrawer`), never the bulk endpoint again.

import {
  generateUuidV7,
  ITEM_CATEGORIES,
  ITEM_KINDS,
  type ItemCategory,
  type ItemKind,
  type MilliCentavosPerUnit,
  toMilliCentavosPerUnit,
  UNITS,
  type Unit,
} from "@kokoro/shared";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { CreateItemDialog } from "@/components/catalog/CreateItemDialog";
import { ItemDetailDrawer } from "@/components/catalog/ItemDetailDrawer";
import {
  emptyItemFormValues,
  type ItemFormParsed,
  type ItemFormValues,
  parseItemFormValues,
} from "@/components/catalog/ItemForm";
import { StepGuidance } from "@/components/onboarding/StepGuidance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useItemsQuery } from "@/features/catalog/api";
import { useBulkCreateItems } from "@/features/onboarding/api";
import { useSessionDraft } from "@/features/onboarding/use-session-draft";
import { ApiError } from "@/lib/api";
import { formatCostRateInput } from "@/lib/cost-rate";
import { formatIntAsDecimalInput } from "@/lib/decimal";
import { catalogLabels } from "@/lib/i18n-catalog";
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
  isUnmetered?: boolean;
  /** Milli-centavos per whole unit (D-5), matching ItemDto and the seed fixture. */
  replacementCostMc?: MilliCentavosPerUnit | null;
}

// Doc 04 §7's dev fixture catalog — exact field values, already in the integer domains the API
// expects.
const FIXTURE_ITEMS: FixtureItem[] = [
  {
    name: "Masa madre refrigerada",
    kind: "SEMI_FINISHED",
    category: "BAKERY",
    unit: "KG",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Masa madre activada",
    kind: "SEMI_FINISHED",
    category: "BAKERY",
    unit: "KG",
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
    // Doc 03 C-9's canonical isUnmetered example: a metered utility, not purchased stock. The
    // Bs 0.005/L replacement cost matches seed-fixtures.sql's item_agua row exactly.
    name: "Agua",
    kind: "RAW_MATERIAL",
    category: "INGREDIENT",
    unit: "L",
    salePrice: null,
    minStockQty: 0,
    isUnmetered: true,
    replacementCostMc: toMilliCentavosPerUnit(231),
  },
  {
    name: "Sal",
    kind: "RAW_MATERIAL",
    category: "INGREDIENT",
    unit: "KG",
    salePrice: null,
    minStockQty: 0,
  },
  {
    name: "Pan blanco pequeño",
    kind: "FINISHED",
    category: "BAKERY",
    unit: "UNIT",
    salePrice: null,
    minStockQty: null,
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
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Rollos de canela",
    kind: "FINISHED",
    category: "BAKERY",
    unit: "UNIT",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Cuñapés",
    kind: "FINISHED",
    category: "BAKERY",
    unit: "UNIT",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Queso crema de kéfir",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "UNIT",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Ghee",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "L",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Kéfir natural a granel",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "L",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Kéfir natural 500 ml",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "UNIT",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Kéfir natural 1 L",
    kind: "FINISHED",
    category: "DAIRY",
    unit: "UNIT",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Desayuno Kokoro",
    kind: "FINISHED",
    category: "OTHER",
    unit: "UNIT",
    salePrice: null,
    minStockQty: null,
  },
  {
    name: "Cajas",
    kind: "PACKAGING",
    category: "NOT_EATABLE",
    unit: "UNIT",
    salePrice: null,
    minStockQty: 20000,
  },
  {
    name: "Etiquetas",
    kind: "PACKAGING",
    category: "NOT_EATABLE",
    unit: "UNIT",
    salePrice: null,
    minStockQty: 50000,
  },
  {
    name: "Botella de kéfir 500 ml",
    kind: "PACKAGING",
    category: "NOT_EATABLE",
    unit: "UNIT",
    salePrice: null,
    minStockQty: 500,
  },
  {
    name: "Botella de kéfir 1 L",
    kind: "PACKAGING",
    category: "NOT_EATABLE",
    unit: "UNIT",
    salePrice: null,
    minStockQty: 300,
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
    replacementCostMc:
      item.replacementCostMc === undefined || item.replacementCostMc === null
        ? ""
        : formatCostRateInput(item.replacementCostMc),
    isUnmetered: item.isUnmetered ?? false,
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
  const [rows, setRows] = useSessionDraft<CatalogRow[]>(
    "catalog-rows",
    FIXTURE_ITEMS.map(fixtureToRow),
  );
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    rowId: string;
    field: "name" | "salePrice" | "minStockQty" | "replacementCostMc";
    message: string;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const itemsQuery = useItemsQuery();
  const mutation = useBulkCreateItems();
  const disabled = mutation.isPending;

  if (readOnly) {
    const items = itemsQuery.data?.items ?? [];

    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium text-foreground text-lg">{onboardingLabels.catalogTitle}</h2>
          <p className="text-muted-foreground text-sm">{onboardingLabels.savedCatalogBody}</p>
        </div>
        <StepGuidance
          what={onboardingLabels.catalogGuidanceWhat}
          why={onboardingLabels.catalogGuidanceWhy}
          where={onboardingLabels.catalogGuidanceWhere}
        />
        <div className="rounded-md border border-border bg-muted">
          <div className="flex flex-wrap items-center justify-between gap-2 border-border border-b px-4 py-3">
            <h3 className="font-medium text-foreground text-sm">
              {onboardingLabels.catalogSavedTitle}
            </h3>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
              {catalogLabels.newItem}
            </Button>
          </div>
          {itemsQuery.isLoading ? (
            <p className="px-4 py-3 text-muted-foreground text-sm">
              {onboardingLabels.catalogSavedLoading}
            </p>
          ) : itemsQuery.isError ? (
            <p className="px-4 py-3 text-negative text-sm" role="alert">
              {onboardingLabels.catalogSavedError}
            </p>
          ) : items.length === 0 ? (
            <p className="px-4 py-3 text-muted-foreground text-sm">
              {onboardingLabels.catalogSavedEmpty}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm">{item.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
                      <span>{onboardingLabels.kindLabels[item.kind]}</span>
                      <span>{onboardingLabels.categoryLabels[item.category]}</span>
                      <span>{onboardingLabels.unitLabels[item.unit]}</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDetailItemId(item.id)}
                    aria-label={catalogLabels.editTitle}
                  >
                    {catalogLabels.editTitle}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onDone}>
            {onboardingLabels.continueButton}
          </Button>
        </div>
        <CreateItemDialog open={createOpen} onOpenChange={setCreateOpen} />
        <ItemDetailDrawer
          itemId={detailItemId}
          open={detailItemId !== null}
          onOpenChange={(open) => {
            if (!open) setDetailItemId(null);
          }}
        />
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
              minStockQty: kind === "RAW_MATERIAL" || kind === "PACKAGING" ? row.minStockQty : "",
              isUnmetered: kind === "RAW_MATERIAL" ? row.isUnmetered : false,
              replacementCostMc: kind === "RAW_MATERIAL" ? row.replacementCostMc : "",
            }
          : row,
      ),
    );
    setRowError((current) => (current?.rowId === id ? null : current));
  }

  function updateRowIsUnmetered(id: string, isUnmetered: boolean) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              isUnmetered,
              minStockQty: isUnmetered ? "0" : row.minStockQty,
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
      if (
        parsed.value.kind === "FINISHED" &&
        (parsed.value.salePriceMc === null || parsed.value.salePriceMc <= 0)
      ) {
        setRowError({
          rowId: row.id,
          field: "salePrice",
          message: onboardingLabels.errors.salePriceRequired,
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
        <p id="catalog-cost-rate-help" className="text-muted-foreground text-xs">
          {onboardingLabels.costRateHelp}
        </p>
      </div>

      <StepGuidance
        what={onboardingLabels.catalogGuidanceWhat}
        why={onboardingLabels.catalogGuidanceWhy}
        where={onboardingLabels.catalogGuidanceWhere}
      />

      <div className="rounded-lg border border-border md:overflow-x-auto">
        <div className="md:min-w-[860px]">
          <div className="sticky top-0 z-10 grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_1fr_1fr_1fr_1fr_4rem] gap-2 border-b border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground max-md:hidden">
            <span>{onboardingLabels.columnName}</span>
            <span>{onboardingLabels.columnKind}</span>
            <span>{onboardingLabels.columnCategory}</span>
            <span>{onboardingLabels.columnUnit}</span>
            <span>{onboardingLabels.columnSalePrice}</span>
            <span>{onboardingLabels.columnMinStock}</span>
            <span>{onboardingLabels.columnIsUnmetered}</span>
            <span>{onboardingLabels.columnReplacementCost}</span>
            <span />
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_1fr_1fr_1fr_1fr_4rem] items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0 max-md:mb-3 max-md:flex max-md:flex-col max-md:items-stretch max-md:gap-3 max-md:rounded-md max-md:border max-md:bg-card max-md:p-3 max-md:last:mb-0"
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
              {row.kind === "RAW_MATERIAL" || row.kind === "PACKAGING" ? (
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
                    disabled={disabled || row.isUnmetered}
                  />
                </label>
              ) : (
                <span aria-hidden="true" className="hidden md:block" />
              )}
              {row.kind === "RAW_MATERIAL" ? (
                <div className="flex items-center gap-2 text-foreground text-sm max-md:justify-between">
                  <span className="hidden font-medium text-muted-foreground text-xs max-md:block">
                    {onboardingLabels.columnIsUnmetered}
                  </span>
                  <Switch
                    checked={row.isUnmetered}
                    onCheckedChange={(checked) => updateRowIsUnmetered(row.id, checked)}
                    disabled={disabled}
                    aria-label={onboardingLabels.columnIsUnmetered}
                  />
                </div>
              ) : (
                <span aria-hidden="true" className="hidden md:block" />
              )}
              {row.kind === "RAW_MATERIAL" && row.isUnmetered ? (
                <label
                  className="flex flex-col gap-1"
                  htmlFor={`catalog-${row.id}-replacement-cost`}
                >
                  <span className="hidden font-medium text-muted-foreground text-xs max-md:block">
                    {onboardingLabels.columnReplacementCost}
                  </span>
                  <Input
                    id={`catalog-${row.id}-replacement-cost`}
                    inputMode="decimal"
                    placeholder="0.00000"
                    value={row.replacementCostMc}
                    onChange={(e) => updateRow(row.id, "replacementCostMc", e.target.value)}
                    disabled={disabled}
                    aria-describedby="catalog-cost-rate-help"
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
                      : rowError.field === "minStockQty"
                        ? onboardingLabels.columnMinStock
                        : onboardingLabels.columnReplacementCost}
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
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onSkip}
          disabled={disabled}
          aria-label={onboardingLabels.skipButton}
          title={onboardingLabels.skipButton}
        >
          <ChevronRight />
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled || rows.length === 0}>
          {onboardingLabels.submitCatalog}
        </Button>
      </div>
    </div>
  );
}
