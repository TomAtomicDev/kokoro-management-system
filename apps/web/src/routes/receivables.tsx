import {
  formatMoney,
  listReceivablesQuerySchema,
  type ReceivablesSaleDto,
  toCentavos,
} from "@kokoro/shared";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ReceivablesGroups } from "@/components/finance/ReceivablesGroups";
import { CollectPaymentDialog } from "@/components/sales/CollectPaymentDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccounts, useGroupedReceivables } from "@/features/finance/api";
import { receivablesLabels } from "@/lib/i18n-receivables";

const routeApi = getRouteApi("/_authenticated/receivables");
const summarySkeletonKeys = ["total", "debtors", "sales"] as const;
const groupSkeletonKeys = ["first", "second", "third"] as const;

function formatCount(count: number): string {
  return new Intl.NumberFormat("es-BO").format(count);
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="numeric-cell font-semibold text-foreground text-xl">{value}</span>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div
      role="status"
      aria-label={receivablesLabels.title}
      aria-busy="true"
      className="grid gap-3 sm:grid-cols-3"
    >
      {summarySkeletonKeys.map((key) => (
        <div
          key={key}
          className="flex min-h-20 flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3"
        >
          <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
          <div className="h-5 w-3/5 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function ReceivablesRoute() {
  const routeSearch = routeApi.useSearch();
  const search = listReceivablesQuerySchema.parse(routeSearch);
  const navigate = routeApi.useNavigate();
  const receivablesQuery = useGroupedReceivables(search);
  const accountsQuery = useAccounts();
  const [collectingSale, setCollectingSale] = useState<ReceivablesSaleDto | null>(null);
  const response = receivablesQuery.data;
  const summary = response?.globalSummary;
  const pagination = response?.pagination;

  useEffect(() => {
    if (pagination && pagination.totalPages > 0 && search.page > pagination.totalPages) {
      void navigate({
        search: (previous) => ({ ...previous, page: pagination.totalPages }),
        replace: true,
      });
    }
  }, [navigate, pagination, search.page]);

  function updateFilters(
    changes: Partial<Pick<typeof search, "search" | "minAgeDays" | "sortBy">>,
  ): void {
    void navigate({
      search: (previous) => ({ ...previous, ...changes, page: 1 }),
      replace: true,
    });
  }

  function updatePage(page: number): void {
    void navigate({ search: (previous) => ({ ...previous, page }) });
  }

  const selectedForCollection = collectingSale
    ? { id: collectingSale.saleId, total: collectingSale.saleTotal }
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">{receivablesLabels.title}</h1>
        <p className="text-muted-foreground text-sm">{receivablesLabels.subtitle}</p>
      </div>

      {summary ? (
        <section aria-label={receivablesLabels.title} className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label={receivablesLabels.summaryTotal}
            value={formatMoney(toCentavos(summary.receivablesTotal))}
          />
          <SummaryCard
            label={receivablesLabels.summaryDebtors}
            value={formatCount(summary.debtorCount)}
          />
          <SummaryCard
            label={receivablesLabels.summarySales}
            value={formatCount(summary.pendingSaleCount)}
          />
        </section>
      ) : receivablesQuery.isLoading ? (
        <SummarySkeleton />
      ) : null}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-end sm:p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="receivables-search" className="font-medium text-foreground text-xs">
            {receivablesLabels.searchLabel}
          </label>
          <Input
            id="receivables-search"
            type="search"
            value={search.search ?? ""}
            placeholder={receivablesLabels.searchPlaceholder}
            onChange={(event) => updateFilters({ search: event.currentTarget.value || undefined })}
          />
        </div>

        <div className="flex flex-col gap-1 sm:w-40">
          <label htmlFor="receivables-min-age" className="font-medium text-foreground text-xs">
            {receivablesLabels.minAgeLabel}
          </label>
          <Input
            id="receivables-min-age"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={search.minAgeDays === undefined ? "" : String(search.minAgeDays)}
            onChange={(event) => {
              const rawValue = event.currentTarget.value;
              const minAgeDays = rawValue === "" ? undefined : Number(rawValue);
              if (
                minAgeDays === undefined ||
                (Number.isSafeInteger(minAgeDays) && minAgeDays >= 0)
              ) {
                updateFilters({ minAgeDays });
              }
            }}
          />
          <span className="text-muted-foreground text-xs">{receivablesLabels.minAgeHelp}</span>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="font-medium text-foreground text-xs">
            {receivablesLabels.sortControlsLabel}
          </legend>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={search.sortBy === "oldest"}
              className={search.sortBy === "oldest" ? "min-h-11 bg-accent" : "min-h-11"}
              onClick={() => updateFilters({ sortBy: "oldest" })}
            >
              {receivablesLabels.sortOldest}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={search.sortBy === "highestBalance"}
              className={search.sortBy === "highestBalance" ? "min-h-11 bg-accent" : "min-h-11"}
              onClick={() => updateFilters({ sortBy: "highestBalance" })}
            >
              {receivablesLabels.sortHighestBalance}
            </Button>
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="receivables-groups-title" aria-busy={receivablesQuery.isLoading}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="receivables-groups-title" className="font-semibold text-foreground text-base">
            {receivablesLabels.groupsTitle}
          </h2>
          {pagination && pagination.totalGroups > 0 ? (
            <span className="text-muted-foreground text-xs">
              {receivablesLabels.groupCount(pagination.totalGroups)}
            </span>
          ) : null}
        </div>

        {receivablesQuery.isLoading ? (
          <div role="status" aria-label={receivablesLabels.title} className="flex flex-col gap-3">
            {groupSkeletonKeys.map((key) => (
              <div
                key={key}
                className="h-16 animate-pulse rounded-lg border border-border bg-card"
              />
            ))}
          </div>
        ) : receivablesQuery.isError && response === undefined ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4"
          >
            <p className="text-foreground text-sm">{receivablesLabels.loadError}</p>
            <Button type="button" variant="outline" onClick={() => void receivablesQuery.refetch()}>
              {receivablesLabels.retry}
            </Button>
          </div>
        ) : response?.groups.length ? (
          <>
            <ReceivablesGroups
              groups={response.groups}
              onCollect={(sale) => setCollectingSale(sale)}
            />
            {pagination && pagination.totalPages > 1 ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={search.page <= 1 || receivablesQuery.isFetching}
                  onClick={() => updatePage(search.page - 1)}
                >
                  {receivablesLabels.previousPage}
                </Button>
                <span className="numeric-cell text-muted-foreground text-sm" aria-live="polite">
                  {receivablesLabels.pageLabel(pagination.page, pagination.totalPages)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={!pagination.hasNextPage || receivablesQuery.isFetching}
                  onClick={() => updatePage(search.page + 1)}
                >
                  {receivablesLabels.nextPage}
                </Button>
              </div>
            ) : null}
          </>
        ) : summary?.pendingSaleCount === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-medium text-foreground text-sm">
              {receivablesLabels.noDebtsTitle}
            </h3>
            <p className="mt-1 text-muted-foreground text-sm">
              {receivablesLabels.noDebtsDescription}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-medium text-foreground text-sm">
              {receivablesLabels.noMatchesTitle}
            </h3>
            <p className="mt-1 text-muted-foreground text-sm">
              {receivablesLabels.noMatchesDescription}
            </p>
          </div>
        )}
      </section>

      <CollectPaymentDialog
        sale={selectedForCollection}
        outstandingAmount={collectingSale?.outstandingAmount}
        accounts={accountsQuery.data?.accounts ?? []}
        open={collectingSale !== null}
        onOpenChange={(open) => {
          if (!open) setCollectingSale(null);
        }}
      />
    </div>
  );
}
