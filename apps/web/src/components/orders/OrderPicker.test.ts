import { describe, expect, it } from "vitest";

import { formatOrderPickerDisplay } from "./OrderPicker";

describe("formatOrderPickerDisplay", () => {
  it("leads with the order's code, then the customer, delivery date, and description", () => {
    expect(
      formatOrderPickerDisplay({
        code: "PED-0003-2026",
        customerName: "Ana Pérez",
        deliveryDate: "2026-08-25",
        description: "Desayuno para cumpleaños",
      }),
    ).toBe("PED-0003-2026 · Ana Pérez · 2026-08-25 · Desayuno para cumpleaños");
  });

  it("uses the existing picker fallbacks when customer or date is missing", () => {
    expect(
      formatOrderPickerDisplay({
        code: "PED-0004-2026",
        customerName: null,
        deliveryDate: null,
        description: "Pedido sin datos de entrega",
      }),
    ).toBe("PED-0004-2026 · (cliente eliminado) · Sin fecha · Pedido sin datos de entrega");
  });

  it("omits the code segment entirely when it's null, rather than showing an empty slot", () => {
    expect(
      formatOrderPickerDisplay({
        code: null,
        customerName: "Ana Pérez",
        deliveryDate: "2026-08-25",
        description: "Desayuno para cumpleaños",
      }),
    ).toBe("Ana Pérez · 2026-08-25 · Desayuno para cumpleaños");
  });
});
