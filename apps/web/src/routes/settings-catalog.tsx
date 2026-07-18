// SC-15 · Catalog — /settings/catalog (Doc 07). Items table (kind/category filters): name, unit,
// kind, category, price (FINISHED), min stock, aliases (chips, editable), active toggle, plus the
// merge-duplicates utility.

import {
  formatMoney,
  formatQty,
  ITEM_CATEGORIES,
  ITEM_KINDS,
  type ItemCategory,
  type ItemDto,
  type ItemKind,
} from "@kokoro/shared";
import { useState } from "react";

import { CreateItemDialog } from "@/components/catalog/CreateItemDialog";
import { ItemDetailDrawer } from "@/components/catalog/ItemDetailDrawer";
import { MergeItemsDialog } from "@/components/catalog/MergeItemsDialog";
import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useItemsQuery, useSetItemActiveMutation } from "@/features/catalog/api";
import { catalogLabels } from "@/lib/i18n-catalog";

type ActiveFilter = "all" | "active" | "inactive";

export function SettingsCatalogRoute() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ItemKind | "">("");
  const [category, setCategory] = useState<ItemCategory | "">("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const itemsQuery = useItemsQuery({
    kind: kind || undefined,
    category: category || undefined,
    isActive: activeFilter === "all" ? undefined : activeFilter === "active",
    search: search.trim() || undefined,
  });
  const setActiveMutation = useSetItemActiveMutation();

  const columns: EventTableColumn<ItemDto>[] = [
    {
      id: "name",
      header: catalogLabels.columnName,
      cell: (item) => (
        <button
          type="button"
          className="font-medium text-foreground hover:underline"
          onClick={() => setDetailItemId(item.id)}
        >
          {item.name}
        </button>
      ),
    },
    {
      id: "kind",
      header: catalogLabels.columnKind,
      cell: (item) => catalogLabels.kindLabels[item.kind],
    },
    {
      id: "category",
      header: catalogLabels.columnCategory,
      cell: (item) => catalogLabels.categoryLabels[item.category],
    },
    {
      id: "unit",
      header: catalogLabels.columnUnit,
      cell: (item) => catalogLabels.unitLabels[item.unit].replace(/ \(.+\)/, ""),
    },
    {
      id: "price",
      header: catalogLabels.columnPrice,
      numeric: true,
      cell: (item) => (item.salePrice === null ? "—" : formatMoney(item.salePrice)),
    },
    {
      id: "minStock",
      header: catalogLabels.columnMinStock,
      numeric: true,
      cell: (item) => (item.minStockQty === null ? "—" : formatQty(item.minStockQty, item.unit)),
    },
    {
      id: "aliases",
      header: catalogLabels.columnAliases,
      cell: (item) =>
        item.aliases.length === 0 ? (
          "—"
        ) : (
          <div className="flex flex-wrap gap-1">
            {item.aliases.map((alias) => (
              <Badge key={alias.id} variant="muted">
                {alias.alias}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      id: "active",
      header: catalogLabels.columnActive,
      cell: (item) => (
        <Switch
          checked={item.isActive}
          onCheckedChange={(next) => setActiveMutation.mutate({ id: item.id, isActive: next })}
          disabled={setActiveMutation.isPending}
          aria-label={`${catalogLabels.columnActive}: ${item.name}`}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{catalogLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{catalogLabels.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setMergeOpen(true)}>
            {catalogLabels.mergeDuplicates}
          </Button>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            {catalogLabels.newItem}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={catalogLabels.searchPlaceholder}
          className="max-w-xs"
        />
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as ItemKind | "")}
          className="w-auto"
        >
          <option value="">{catalogLabels.filterKindAll}</option>
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {catalogLabels.kindLabels[k]}
            </option>
          ))}
        </Select>
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value as ItemCategory | "")}
          className="w-auto"
        >
          <option value="">{catalogLabels.filterCategoryAll}</option>
          {ITEM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {catalogLabels.categoryLabels[c]}
            </option>
          ))}
        </Select>
        <Select
          value={activeFilter}
          onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
          className="w-auto"
        >
          <option value="active">{catalogLabels.filterActiveOnly}</option>
          <option value="inactive">{catalogLabels.filterInactiveOnly}</option>
          <option value="all">{catalogLabels.filterActiveAll}</option>
        </Select>
      </div>

      <EventTable
        columns={columns}
        rows={itemsQuery.data?.items ?? []}
        getRowId={(item) => item.id}
        onRowClick={(item) => setDetailItemId(item.id)}
        emptyMessage={catalogLabels.noItems}
        loading={itemsQuery.isLoading}
        loadingMessage={catalogLabels.loading}
      />

      <CreateItemDialog open={createOpen} onOpenChange={setCreateOpen} />
      <MergeItemsDialog open={mergeOpen} onOpenChange={setMergeOpen} />
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
