export const ORDERS_ROOT_KEY = ["orders"] as const;
export const ORDER_RECEIPTS_ROOT_KEY = [...ORDERS_ROOT_KEY, "receipt-summary"] as const;

export function orderReceiptSummaryKey(orderId: string) {
  return [...ORDER_RECEIPTS_ROOT_KEY, orderId] as const;
}
