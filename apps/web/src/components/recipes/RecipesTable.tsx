// SC-06 recipes table: name, output item, yield, default/active badges, replacement-basis
// theoretical cost (Doc 06 principle 4: replacement cost is the prominent figure). Row -> detail
// drawer. Mirrors PurchasesTable.tsx's structure.

import type { ItemDto, RecipeDto } from "@kokoro/shared";
import { formatMoney, formatQty, toCentavos } from "@kokoro/shared";
import { useMemo } from "react";

import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import { useItemsQuery } from "@/features/catalog/api";
import { recipesLabels } from "@/lib/i18n-recipes";

export interface RecipesTableProps {
  recipes: RecipeDto[];
  loading?: boolean;
  onRowClick?: (recipe: RecipeDto) => void;
}

export function RecipesTable({ recipes, loading, onRowClick }: RecipesTableProps) {
  // Same query key ItemPicker/RecipeForm use for their own item lookups — TanStack Query dedups
  // identical keys.
  const itemsQuery = useItemsQuery({ isActive: true });

  const itemById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  const columns: EventTableColumn<RecipeDto>[] = [
    {
      id: "name",
      header: recipesLabels.columnName,
      isRowIdentifier: true,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{row.name}</span>
          {row.isDefault ? <Badge variant="default">{recipesLabels.badgeDefault}</Badge> : null}
        </div>
      ),
    },
    {
      id: "outputItem",
      header: recipesLabels.columnOutputItem,
      cell: (row) => itemById.get(row.outputItemId)?.name ?? row.outputItemId,
    },
    {
      id: "yield",
      header: recipesLabels.columnYield,
      numeric: true,
      cell: (row) => {
        const outputItem = itemById.get(row.outputItemId);
        return outputItem ? formatQty(row.expectedYieldQty, outputItem.unit) : row.expectedYieldQty;
      },
    },
    {
      id: "costReplacement",
      header: recipesLabels.columnCostReplacement,
      numeric: true,
      cell: (row) => formatMoney(toCentavos(row.theoreticalCostReplacement.costPerOutputUnit)),
    },
    {
      id: "status",
      header: recipesLabels.columnStatus,
      cell: (row) =>
        row.isActive ? (
          <Badge variant="outline">{recipesLabels.badgeActive}</Badge>
        ) : (
          <Badge variant="muted">{recipesLabels.badgeInactive}</Badge>
        ),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={recipes}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={recipesLabels.noRecipes}
      loading={loading}
      loadingMessage={recipesLabels.loading}
    />
  );
}
