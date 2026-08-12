// SC-08 Â· Inventory â€” /inventory. Header + a hand-rolled tab switcher (Stock / Salidas / Conteos,
// no tabs primitive exists in components/ui yet and none is added for this â€” same "hand-rolled
// now, upgrade later if a second consumer justifies a dependency" call as EventTable's header
// comment). Stock (KOK-017 frontend), Salidas (KOK-018 frontend), and Conteos (KOK-019 frontend)
// all have real content.

import { ITEM_KINDS, type ItemDto, type ItemKind, type StockRowDto } from "@kokoro/shared";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  type DateRange,
  DateRangeFilter,
  getDefaultDateRange,
} from "@/components/common/DateRangeFilter";
import { CountDetailView } from "@/components/inventory/CountDetailView";
import { CountForm } from "@/components/inventory/CountForm";
import { CountsTable } from "@/components/inventory/CountsTable";
import { ExitDetailDrawer } from "@/components/inventory/ExitDetailDrawer";
import { ExitForm } from "@/components/inventory/ExitForm";
import { ExitsTable } from "@/components/inventory/ExitsTable";
import { KardexView } from "@/components/inventory/KardexView";
import { StockTable } from "@/components/inventory/StockTable";
import { WasteSummaryCard } from "@/components/inventory/WasteSummaryCard";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useItemsQuery } from "@/features/catalog/api";
import {
  useCounts,
  useRefreshReplacementCosts,
  useStock,
  useStockExits,
} from "@/features/inventory/api";
import { ApiError } from "@/lib/api";
import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

type InventoryTab = "stock" | "salidas" | "conteos";

const routeApi = getRouteApi("/_authenticated/inventory");

const TABS: { id: InventoryTab; label: string }[] = [
  { id: "stock", label: inventoryLabels.tabStock },
  { id: "salidas", label: inventoryLabels.tabSalidas },
  { id: "conteos", label: inventoryLabels.tabConteos },
];

function TabSwitcher({
  active,
  onChange,
}: {
  active: InventoryTab;
  onChange: (tab: InventoryTab) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-border border-b">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function InventoryRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const defaults = getDefaultDateRange();
  const fromDate = search.fromDate ?? defaults.fromDate;
  const toDate = search.toDate ?? defaults.toDate;
  const tab: InventoryTab = search.tab ?? "stock";
  const kind = search.kind ?? "";
  const lowStockOnly = search.lowStockOnly ?? false;
  const negativeOnly = search.negativeOnly ?? false;
  const [selected, setSelected] = useState<StockRowDto | null>(null);
  const [exitFormOpen, setExitFormOpen] = useState(false);
  const [selectedExitId, setSelectedExitId] = useState<string | null>(null);
  const [countFormOpen, setCountFormOpen] = useState(false);
  const [selectedCountId, setSelectedCountId] = useState<string | null>(null);

  const stockQuery = useStock({
    kind: kind || undefined,
    lowStockOnly: lowStockOnly || undefined,
    negativeOnly: negativeOnly || undefined,
  });

  const toast = useToast();
  const refreshReplacementCostsMutation = useRefreshReplacementCosts();
  function handleRefreshReplacementCosts() {
    refreshReplacementCostsMutation.mutate(undefined, {
      onSuccess: (result) => {
        toast.show({
          message: inventoryLabels.replacementCostMcRefreshSuccess(result.refreshedItemIds.length),
        });
      },
      onError: (err) => {
        toast.show({
          message: err instanceof ApiError ? err.message : inventoryLabels.errors.generic,
        });
      },
    });
  }

  // No `isActive` filter: exits can reference an item that was later deactivated, and the
  // Salidas table must still resolve its name/unit correctly for historical rows.
  const itemsQuery = useItemsQuery({});
  const exitsQuery = useStockExits({ fromDate, toDate });
  const countsQuery = useCounts({});

  function updateDateRange(range: DateRange): void {
    void navigate({ search: (previous) => ({ ...previous, ...range }) });
  }

  function updateTab(nextTab: InventoryTab): void {
    void navigate({ search: (previous) => ({ ...previous, tab: nextTab }) });
  }

  function updateStockFilters(filters: {
    kind?: ItemKind;
    lowStockOnly?: boolean;
    negativeOnly?: boolean;
  }): void {
    void navigate({ search: (previous) => ({ ...previous, ...filters }) });
  }

  const itemLookup = useMemo(() => {
    const map = new Map<string, { name: string; unit: ItemDto["unit"] }>();
    for (const item of itemsQuery.data?.items ?? []) {
      map.set(item.id, { name: item.name, unit: item.unit });
    }
    return map;
  }, [itemsQuery.data]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">{inventoryLabels.title}</h1>
        <p className="text-muted-foreground text-sm">{inventoryLabels.subtitle}</p>
      </div>

      <TabSwitcher active={tab} onChange={updateTab} />

      {tab === "stock" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <Select
              value={kind}
              onChange={(event) => {
                const nextKind = event.target.value as ItemKind | "";
                updateStockFilters({ kind: nextKind || undefined });
              }}
              className="w-auto"
            >
              <option value="">{inventoryLabels.filterKindAll}</option>
              {ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {inventoryLabels.kindLabels[k]}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Switch
                checked={lowStockOnly}
                onCheckedChange={(checked) =>
                  updateStockFilters({ lowStockOnly: checked || undefined })
                }
                aria-label={inventoryLabels.filterLowStockOnly}
              />
              <span>{inventoryLabels.filterLowStockOnly}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Switch
                checked={negativeOnly}
                onCheckedChange={(checked) =>
                  updateStockFilters({ negativeOnly: checked || undefined })
                }
                aria-label={inventoryLabels.filterNegativeOnly}
              />
              <span>{inventoryLabels.filterNegativeOnly}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={handleRefreshReplacementCosts}
              disabled={refreshReplacementCostsMutation.isPending}
            >
              {inventoryLabels.refreshReplacementCostsButton}
            </Button>
          </div>

          <StockTable
            rows={stockQuery.data?.stock ?? []}
            loading={stockQuery.isLoading}
            onRowClick={setSelected}
          />

          <KardexView
            itemId={selected?.itemId ?? null}
            itemName={selected?.name ?? null}
            open={selected !== null}
            onOpenChange={(open) => {
              if (!open) setSelected(null);
            }}
          />
        </div>
      ) : tab === "salidas" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <DateRangeFilter fromDate={fromDate} toDate={toDate} onChange={updateDateRange} />
            <WasteSummaryCard dateRange={{ fromDate, toDate }} />
            <Button type="button" onClick={() => setExitFormOpen(true)}>
              {inventoryLabels.recordExitButton}
            </Button>
          </div>

          <ExitsTable
            rows={exitsQuery.data?.exits ?? []}
            items={itemLookup}
            loading={exitsQuery.isLoading}
            onRowClick={(row) => setSelectedExitId(row.id)}
          />

          <ExitForm open={exitFormOpen} onOpenChange={setExitFormOpen} />

          <ExitDetailDrawer
            exitId={selectedExitId}
            open={selectedExitId !== null}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setSelectedExitId(null);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button type="button" onClick={() => setCountFormOpen(true)}>
              {inventoryLabels.newCountButton}
            </Button>
          </div>

          <CountsTable
            rows={countsQuery.data?.counts ?? []}
            loading={countsQuery.isLoading}
            onRowClick={(row) => setSelectedCountId(row.id)}
          />

          <CountForm
            open={countFormOpen}
            onOpenChange={setCountFormOpen}
            onStarted={(id) => setSelectedCountId(id)}
          />

          <CountDetailView
            countId={selectedCountId}
            items={itemLookup}
            open={selectedCountId !== null}
            onOpenChange={(open) => {
              if (!open) setSelectedCountId(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
