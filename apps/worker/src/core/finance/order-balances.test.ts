import { describe, expect, it } from "vitest";

import type { OrderFinanceProjectionRow } from "./order-balances.js";
import { projectOrderFinanceRows } from "./order-balances.js";

describe("projectOrderFinanceRows", () => {
  it("fails explicitly when a delivered order has no matching active linked sale", () => {
    const row: OrderFinanceProjectionRow = {
      order_id: "order-1",
      order_status: "DELIVERED",
      customer_id: "customer-1",
      customer_name: "Cliente",
      order_code: "PED-0001-2026",
      agreed_total: 10_000,
      additional_charge: 500,
      sale_id: "sale-1",
      active_sale_id: null,
      active_sale_order_id: null,
      active_sale_channel: null,
      active_sale_total: null,
      active_sale_occurred_at: null,
      active_sale_business_date: null,
      active_sale_code: null,
      qualifying_receipts: 0,
      order_refunds: 0,
    };

    let thrown: unknown;
    try {
      projectOrderFinanceRows([row]);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "INTERNAL",
      details: { orderId: "order-1", saleId: "sale-1" },
    });
  });
});
