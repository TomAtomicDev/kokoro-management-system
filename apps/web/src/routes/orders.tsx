// SC-04 · Active-order board and explicit closed-order history.

import type { CustomOrderStatus, ListOrdersFilters, OrderDto } from "@kokoro/shared";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { OrderBoard } from "@/components/orders/OrderBoard";
import { OrderDetailPage } from "@/components/orders/OrderDetailPage";
import { QuoteOrderForm } from "@/components/orders/QuoteOrderForm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOrder, useOrders } from "@/features/orders/api";
import { type OrdersHistoryFilter, ordersLabels } from "@/lib/i18n-orders";
import { filterOrdersByHistoryFilter } from "@/lib/order-history";

const routeApi = getRouteApi("/_authenticated/orders");
const editRouteApi = getRouteApi("/_authenticated/orders/$orderId/edit");
const detailRouteApi = getRouteApi("/_authenticated/orders/$orderId");

const ACTIVE_ORDER_STATUSES: CustomOrderStatus[] = [
  "QUOTING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
];
const TERMINAL_ORDER_STATUSES: CustomOrderStatus[] = ["DELIVERED", "CANCELLED"];

export function OrderRecordRoute() {
  return <QuoteOrderForm />;
}

export function OrderEditRoute() {
  const { orderId } = editRouteApi.useParams();
  const returnSearch = editRouteApi.useSearch();
  const orderQuery = useOrder(orderId);
  if (orderQuery.isLoading) {
    return <p className="text-muted-foreground text-sm">{ordersLabels.loading}</p>;
  }
  if (orderQuery.isError || !orderQuery.data) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-negative text-sm">{ordersLabels.loadError}</p>
        <Button type="button" variant="outline" onClick={() => void orderQuery.refetch()}>
          {ordersLabels.retry}
        </Button>
        <Link
          to="/orders/$orderId"
          params={{ orderId }}
          search={returnSearch}
          className={buttonVariants({ variant: "ghost" })}
        >
          {ordersLabels.detailBackToBoard}
        </Link>
      </div>
    );
  }
  if (orderQuery.data.status === "DELIVERED" || orderQuery.data.status === "CANCELLED") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">{ordersLabels.terminalOrderNotEditable}</p>
        <Link
          to="/orders/$orderId"
          params={{ orderId }}
          search={returnSearch}
          className={buttonVariants({ variant: "outline" })}
        >
          {ordersLabels.detailBackToBoard}
        </Link>
      </div>
    );
  }
  return <QuoteOrderForm order={orderQuery.data} backSearch={returnSearch} />;
}

export function OrderDetailRoute() {
  const { orderId } = detailRouteApi.useParams();
  const returnSearch = detailRouteApi.useSearch();
  const orderQuery = useOrder(orderId);
  if (orderQuery.isLoading) {
    return <p className="text-muted-foreground text-sm">{ordersLabels.loading}</p>;
  }
  if (orderQuery.isError || !orderQuery.data) {
    return (
      <div className="flex flex-col gap-3" role="alert">
        <p className="text-negative text-sm">{ordersLabels.loadError}</p>
        <Button type="button" variant="outline" onClick={() => void orderQuery.refetch()}>
          {ordersLabels.retry}
        </Button>
        <Link to="/orders" search={returnSearch} className={buttonVariants({ variant: "ghost" })}>
          {ordersLabels.backToOrders}
        </Link>
      </div>
    );
  }
  return <OrderDetailPage order={orderQuery.data} returnSearch={returnSearch} />;
}

export function OrdersRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const view = search.ordersView ?? "active";
  const historyFilter = search.historyFilter ?? "all";
  const isHistory = view === "history";
  const selectedOrderId = search.open ?? null;

  const detailSearch = useMemo(
    () => ({
      ordersView: view,
      historyFilter,
      fromDate: search.fromDate,
      toDate: search.toDate,
    }),
    [historyFilter, search.fromDate, search.toDate, view],
  );

  // Compatibility for existing `/orders?open=<id>` bookmarks (SC-04/KOK-203). Replace the old
  // drawer URL so browser Back returns to the board state from which it was opened.
  useEffect(() => {
    if (!selectedOrderId) return;
    void navigate({
      to: "/orders/$orderId",
      params: { orderId: selectedOrderId },
      search: detailSearch,
      replace: true,
    });
  }, [detailSearch, navigate, selectedOrderId]);

  const listFilters: ListOrdersFilters = {
    ...(isHistory
      ? historyFilter === "cancelled"
        ? { status: "CANCELLED" as const }
        : historyFilter === "all"
          ? { excludeStatuses: ACTIVE_ORDER_STATUSES }
          : { status: "DELIVERED" as const }
      : { excludeStatuses: TERMINAL_ORDER_STATUSES }),
    ...(isHistory && search.fromDate ? { fromDate: search.fromDate } : {}),
    ...(isHistory && search.toDate ? { toDate: search.toDate } : {}),
  };
  const ordersQuery = useOrders(listFilters);
  const orders = ordersQuery.data?.orders ?? [];
  const visibleOrders: OrderDto[] = isHistory
    ? filterOrdersByHistoryFilter(orders, historyFilter)
    : orders;

  function setView(nextView: "active" | "history"): void {
    void navigate({
      search: (previous) => ({
        ...previous,
        ordersView: nextView,
        ...(nextView === "active" ? { fromDate: undefined, toDate: undefined } : {}),
      }),
    });
  }

  function setHistoryFilter(nextFilter: OrdersHistoryFilter): void {
    void navigate({ search: (previous) => ({ ...previous, historyFilter: nextFilter }) });
  }

  function setCreationDate(bound: "fromDate" | "toDate", value: string): void {
    let nextFromDate = bound === "fromDate" ? value : (search.fromDate ?? "");
    let nextToDate = bound === "toDate" ? value : (search.toDate ?? "");
    if (nextFromDate && nextToDate && nextFromDate > nextToDate) {
      if (bound === "fromDate") nextToDate = nextFromDate;
      else nextFromDate = nextToDate;
    }

    void navigate({
      search: (previous) => ({
        ...previous,
        fromDate: nextFromDate || undefined,
        toDate: nextToDate || undefined,
      }),
    });
  }

  function clearCreationDate(): void {
    void navigate({
      search: (previous) => ({ ...previous, fromDate: undefined, toDate: undefined }),
    });
  }

  if (selectedOrderId) {
    return <p className="text-muted-foreground text-sm">{ordersLabels.loading}</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{ordersLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{ordersLabels.subtitle}</p>
        </div>
        <Link to="/orders/new" className={buttonVariants()}>
          {ordersLabels.actionQuote}
        </Link>
      </div>

      <fieldset className="flex min-w-0 flex-wrap gap-2">
        <legend className="sr-only">{ordersLabels.viewNavigation}</legend>
        <Button
          type="button"
          variant={isHistory ? "outline" : "default"}
          aria-pressed={!isHistory}
          onClick={() => setView("active")}
        >
          {ordersLabels.viewActive}
        </Button>
        <Button
          type="button"
          variant={isHistory ? "default" : "outline"}
          aria-pressed={isHistory}
          onClick={() => setView("history")}
        >
          {ordersLabels.viewHistory}
        </Button>
      </fieldset>

      {isHistory ? (
        <div className="flex min-w-0 flex-col gap-3">
          <fieldset className="flex min-w-0 flex-wrap gap-2">
            <legend className="sr-only">{ordersLabels.historyFilterNavigation}</legend>
            {(Object.keys(ordersLabels.historyFilters) as OrdersHistoryFilter[]).map((filter) => (
              <Button
                key={filter}
                type="button"
                size="sm"
                variant={historyFilter === filter ? "secondary" : "outline"}
                aria-pressed={historyFilter === filter}
                onClick={() => setHistoryFilter(filter)}
              >
                {ordersLabels.historyFilters[filter]}
              </Button>
            ))}
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="font-medium text-foreground text-xs">
              {ordersLabels.creationDate}
            </legend>
            <div className="flex flex-wrap items-end gap-3">
              <label
                htmlFor="orders-created-from"
                className="flex flex-col gap-1 font-medium text-foreground text-xs"
              >
                {ordersLabels.dateFrom}
                <Input
                  id="orders-created-from"
                  type="date"
                  value={search.fromDate ?? ""}
                  max={search.toDate}
                  onChange={(event) => setCreationDate("fromDate", event.currentTarget.value)}
                  className="w-auto"
                />
              </label>
              <label
                htmlFor="orders-created-to"
                className="flex flex-col gap-1 font-medium text-foreground text-xs"
              >
                {ordersLabels.dateTo}
                <Input
                  id="orders-created-to"
                  type="date"
                  value={search.toDate ?? ""}
                  min={search.fromDate}
                  onChange={(event) => setCreationDate("toDate", event.currentTarget.value)}
                  className="w-auto"
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearCreationDate}
                disabled={!search.fromDate && !search.toDate}
              >
                {ordersLabels.clearCreationDate}
              </Button>
            </div>
          </fieldset>
        </div>
      ) : null}

      <OrderBoard
        orders={visibleOrders}
        view={view}
        historyFilter={historyFilter}
        loading={ordersQuery.isLoading}
        error={ordersQuery.isError}
        onRetry={() => void ordersQuery.refetch()}
        onSelect={(order) =>
          void navigate({
            to: "/orders/$orderId",
            params: { orderId: order.id },
            search: detailSearch,
          })
        }
      />
    </div>
  );
}
