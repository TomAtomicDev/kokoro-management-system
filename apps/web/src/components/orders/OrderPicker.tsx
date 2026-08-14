import type { OrderDto } from "@kokoro/shared";
import { X } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { useOrders } from "@/features/orders/api";
import { ordersLabels } from "@/lib/i18n-orders";

export interface OrderPickerProps {
  value: string | null;
  onChange: (orderId: string | null, order: OrderDto | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function OrderPicker(props: OrderPickerProps): JSX.Element {
  const { value, onChange, placeholder, disabled } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const ordersQuery = useOrders({ excludeStatuses: ["DELIVERED", "CANCELLED"] });
  const orders = ordersQuery.data?.orders ?? [];
  const selectedOrder = orders.find((order) => order.id === value) ?? null;

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
    return [order.customerName, order.description].some((field) =>
      field?.toLowerCase().includes(trimmedQuery),
    );
  });
  const displayValue = open
    ? query
    : (selectedOrder?.customerName ?? selectedOrder?.description ?? "");

  function selectOrder(order: OrderDto): void {
    onChange(order.id, order);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5">
      <div className="relative flex-1">
        <Input
          id="linked-order-picker"
          value={displayValue}
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
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => selectOrder(order)}
                    >
                      <span className="text-foreground">
                        {order.customerName ?? ordersLabels.orderPickerDeletedCustomer}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {order.deliveryDate ?? ordersLabels.noDeliveryDate}
                      </span>
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
