// SC-04 · Orders board — /orders (UC-05…UC-08). Header: "Nuevo pedido" action; OrderBoard grouped
// by status; card click opens the read/lifecycle drawer. Mirrors routes/sales.tsx's composition.
//
// KOK-141: the quote form is its own full page (`/orders/new`) per KOK-140's pattern, not a
// dialog — mirrors routes/sales.tsx's SaleRecordRoute split. Orders have no generic "edit" (Doc 04
// §5: only guarded lifecycle transitions), so there is no OrderEditRoute counterpart.

import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  type DateRange,
  DateRangeFilter,
  getDefaultDateRange,
} from "@/components/common/DateRangeFilter";
import { OrderBoard } from "@/components/orders/OrderBoard";
import { OrderDetailDrawer } from "@/components/orders/OrderDetailDrawer";
import { QuoteOrderForm } from "@/components/orders/QuoteOrderForm";
import { buttonVariants } from "@/components/ui/button";
import { useOrders } from "@/features/orders/api";
import { ordersLabels } from "@/lib/i18n-orders";

const routeApi = getRouteApi("/_authenticated/orders");

export function OrderRecordRoute() {
  return <QuoteOrderForm />;
}

export function OrdersRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const defaults = getDefaultDateRange();
  const fromDate = search.fromDate ?? defaults.fromDate;
  const toDate = search.toDate ?? defaults.toDate;
  const ordersQuery = useOrders({ fromDate, toDate });
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  function updateDateRange(range: DateRange): void {
    void navigate({ search: (previous) => ({ ...previous, ...range }) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{ordersLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{ordersLabels.subtitle}</p>
        </div>
        <Link to="/orders/new" className={buttonVariants()}>
          {ordersLabels.actionQuote}
        </Link>
      </div>

      <DateRangeFilter fromDate={fromDate} toDate={toDate} onChange={updateDateRange} />

      <OrderBoard
        orders={ordersQuery.data?.orders ?? []}
        loading={ordersQuery.isLoading}
        onSelect={(order) => setSelectedOrderId(order.id)}
      />

      <OrderDetailDrawer
        orderId={selectedOrderId}
        open={selectedOrderId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedOrderId(null);
        }}
      />
    </div>
  );
}
