import type { CustomOrderStatus } from "@kokoro/shared";

interface OrderStatusStyle {
  border: string;
  text: string;
}

export const orderStatusStyles: Record<CustomOrderStatus, OrderStatusStyle> = {
  QUOTING: { border: "border-muted-foreground", text: "text-muted-foreground" },
  CONFIRMED: { border: "border-warning", text: "text-warning" },
  IN_PRODUCTION: { border: "border-primary", text: "text-primary" },
  READY: { border: "border-positive", text: "text-positive" },
  DELIVERED: { border: "border-positive", text: "text-positive" },
  CANCELLED: { border: "border-negative", text: "text-negative" },
};
