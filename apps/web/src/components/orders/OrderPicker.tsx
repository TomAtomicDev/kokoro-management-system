import type { OrderDto } from "@kokoro/shared";
import { X } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { useOrder, useOrders } from "@/features/orders/api";
import { ordersLabels } from "@/lib/i18n-orders";

export interface OrderPickerProps {
  value: string | null;
  onChange: (orderId: string | null, order: OrderDto | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function formatOrderPickerDisplay(
  order: Pick<OrderDto, "code" | "customerName" | "deliveryDate" | "description">,
): string {
  return [
    order.code,
    order.customerName ?? ordersLabels.orderPickerDeletedCustomer,
    order.deliveryDate ?? ordersLabels.noDeliveryDate,
    order.description,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export function OrderPicker(props: OrderPickerProps): JSX.Element {
  const { value, onChange, placeholder, disabled } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const ordersQuery = useOrders({ excludeStatuses: ["DELIVERED", "CANCELLED"] });
  const orders = ordersQuery.data?.orders ?? [];
  // KOK-137: resolved via its OWN query, not `orders.find(...)` — a run/assembly's existing link
  // can point at an order that's since gone DELIVERED/CANCELLED (excluded from `orders` above),
  // and it must still render instead of silently showing blank (same reason CustomerPicker fetches
  // its selection with a separate useCustomerQuery(value) rather than searching its own list).
  const selectedOrderQuery = useOrder(value ?? undefined);
  const selectedOrder = selectedOrderQuery.data ?? null;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const trimmedQuery = query.trim().toLowerCase();
  const results = orders.filter((order) => {
    if (trimmedQuery === "") return true;
    return [order.code, order.customerName, order.description].some((field) =>
      field?.toLowerCase().includes(trimmedQuery),
    );
  });
  const displayValue = open ? query : selectedOrder ? formatOrderPickerDisplay(selectedOrder) : "";

  function selectOrder(order: OrderDto): void {
    onChange(order.id, order);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        <Input
          id="linked-order-picker"
          value={displayValue}
          className="truncate"
          placeholder={placeholder ?? ordersLabels.orderPickerPlaceholder}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => setQuery(event.target.value)}
        />

        {open ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-muted-foreground text-sm">
                {ordersLabels.orderPickerEmpty}
              </p>
            ) : (
              <ul>
                {results.map((order) => (
                  <li key={order.id}>
                    <button
                      type="button"
                      className="flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => selectOrder(order)}
                    >
                      <span className="w-full truncate font-medium text-foreground">
                        {order.customerName ?? ordersLabels.orderPickerDeletedCustomer}
                      </span>
                      <span className="w-full truncate text-muted-foreground text-xs">
                        {order.code ? `${order.code} · ` : ""}
                        {order.deliveryDate ?? ordersLabels.noDeliveryDate}
                      </span>
                      {order.description ? (
                        <span className="w-full truncate text-foreground text-xs">
                          {order.description}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {value !== null && !disabled ? (
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={ordersLabels.orderPickerNone}
          title={ordersLabels.orderPickerNone}
          onClick={() => onChange(null, null)}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
