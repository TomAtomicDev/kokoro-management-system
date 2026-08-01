// SC-04 · Orders board — /orders (UC-05…UC-08). Header: "Nuevo pedido" action; OrderBoard grouped
// by status; card click opens the read/lifecycle drawer. Mirrors routes/sales.tsx's composition.

import { useState } from "react";

import { OrderBoard } from "@/components/orders/OrderBoard";
import { OrderDetailDrawer } from "@/components/orders/OrderDetailDrawer";
import { QuoteOrderForm } from "@/components/orders/QuoteOrderForm";
import { Button } from "@/components/ui/button";
import { useOrders } from "@/features/orders/api";
import { ordersLabels } from "@/lib/i18n-orders";

export function OrdersRoute() {
  const ordersQuery = useOrders();
  const [formOpen, setFormOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{ordersLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{ordersLabels.subtitle}</p>
        </div>
        <Button type="button" onClick={() => setFormOpen(true)}>
          {ordersLabels.actionQuote}
        </Button>
      </div>

      <OrderBoard
        orders={ordersQuery.data?.orders ?? []}
        loading={ordersQuery.isLoading}
        onSelect={(order) => setSelectedOrderId(order.id)}
      />

      <QuoteOrderForm open={formOpen} onOpenChange={setFormOpen} />
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
