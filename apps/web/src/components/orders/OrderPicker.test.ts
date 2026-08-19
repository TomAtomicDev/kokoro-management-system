import { describe, expect, it } from "vitest";

import { formatOrderPickerDisplay } from "./OrderPicker";

describe("formatOrderPickerDisplay", () => {
  it("keeps the customer, delivery date, and description visible in the collapsed value", () => {
    expect(
      formatOrderPickerDisplay({
        customerName: "Ana Pérez",
        deliveryDate: "2026-08-25",
        description: "Desayuno para cumpleaños",
      }),
    ).toBe("Ana Pérez · 2026-08-25 · Desayuno para cumpleaños");
  });

  it("uses the existing picker fallbacks when customer or date is missing", () => {
    expect(
      formatOrderPickerDisplay({
        customerName: null,
        deliveryDate: null,
        description: "Pedido sin datos de entrega",
      }),
    ).toBe("(cliente eliminado) · Sin fecha · Pedido sin datos de entrega");
  });
});
