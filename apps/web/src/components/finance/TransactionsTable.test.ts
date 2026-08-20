import { describe, expect, it } from "vitest";

import { formatSourceEventLabel } from "./TransactionsTable";

describe("formatSourceEventLabel", () => {
  it("combines the Spanish event type, human code, and short business date", () => {
    expect(
      formatSourceEventLabel({
        type: "purchase",
        id: "internal-purchase-uuid",
        code: "CMP-0031-2026",
        businessDate: "2026-08-12",
      }),
    ).toBe("Compra CMP-0031-2026 · 12/08");
  });

  it("does not fall back to the internal id when a legacy code is absent", () => {
    expect(
      formatSourceEventLabel({
        type: "sale",
        id: "internal-sale-uuid",
        code: null,
        businessDate: "2026-08-12",
      }),
    ).toBe("Venta · 12/08");
  });
});
