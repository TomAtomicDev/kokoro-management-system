import type { PurchaseDto } from "@kokoro/shared";
import { describe, expect, it } from "vitest";

import { purchaseToFormState } from "./PurchaseForm";

// `purchaseToFormState` is the PurchaseDto -> form-initial-state mapper PurchaseForm's edit mode
// (KOK-024 Phase G) seeds its local state from. Exercised as a plain function, same rationale as
// useReplayConfirmableMutation.test.ts: this workspace has neither jsdom nor
// @testing-library/react installed, and D-10 forbids adding either just to render the form in a
// test, so this pure mapper is the load-bearing coverage for "did edit mode prefill correctly".

function purchase(overrides: Partial<PurchaseDto> = {}): PurchaseDto {
  return {
    id: "purchase-1",
    occurredAt: "2026-07-01T12:00:00.000Z",
    businessDate: "2026-07-01",
    supplierName: "Proveedor Uno",
    sessionId: null,
    accountId: "account-1",
    total: 1500,
    receiptPhotoKey: "receipts/abc.jpg",
    notes: "Compra semanal",
    lines: [
      { id: "line-1", itemId: "item-1", qty: 2000, lineTotal: 1000 },
      { id: "line-2", itemId: "item-2", qty: 500, lineTotal: 500 },
    ],
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("purchaseToFormState", () => {
  it("maps every scalar field straight through", () => {
    const state = purchaseToFormState(purchase());

    expect(state.supplierName).toBe("Proveedor Uno");
    expect(state.accountId).toBe("account-1");
    expect(state.businessDate).toBe("2026-07-01");
    expect(state.notes).toBe("Compra semanal");
    expect(state.photoKey).toBe("receipts/abc.jpg");
  });

  it("converts each line's qty/lineTotal integers into decimal-string form fields at the right scale", () => {
    const state = purchaseToFormState(purchase());

    // qty is milli-units (scale 3): 2000 -> "2", 500 -> "0.5".
    // lineTotal is centavos (scale 2): 1000 -> "10", 500 -> "5".
    expect(state.lines).toEqual([
      { itemId: "item-1", qty: "2", amount: "10" },
      { itemId: "item-2", qty: "0.5", amount: "5" },
    ]);
  });

  it("falls back to null supplierName/notes as empty strings, matching the create-mode empty state", () => {
    const state = purchaseToFormState(purchase({ supplierName: null, notes: null }));

    expect(state.supplierName).toBe("");
    expect(state.notes).toBe("");
  });

  it("falls back to a single empty line when the purchase somehow has none", () => {
    const state = purchaseToFormState(purchase({ lines: [] }));

    expect(state.lines).toEqual([{ itemId: null, qty: "", amount: "" }]);
  });

  it("passes a null receiptPhotoKey through unchanged", () => {
    const state = purchaseToFormState(purchase({ receiptPhotoKey: null }));

    expect(state.photoKey).toBeNull();
  });
});
