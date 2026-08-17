import { describe, expect, it } from "vitest";

import { hasUnsavedChanges, serializeFormSnapshot } from "./useUnsavedChangesGuard";

describe("form snapshot comparison", () => {
  it("treats values with different object key order as equal", () => {
    expect(serializeFormSnapshot({ notes: "", accountId: "account-1" })).toBe(
      serializeFormSnapshot({ accountId: "account-1", notes: "" }),
    );
    expect(
      hasUnsavedChanges(
        { notes: "", accountId: "account-1" },
        { accountId: "account-1", notes: "" },
      ),
    ).toBe(false);
  });

  it("marks a changed value dirty and a retyped original value clean", () => {
    const initial = { notes: "Compra semanal", lines: [{ itemId: "item-1", qty: "2" }] };
    expect(hasUnsavedChanges(initial, { ...initial, notes: "Compra nueva" })).toBe(true);
    expect(
      hasUnsavedChanges(initial, {
        notes: "Compra semanal",
        lines: [{ itemId: "item-1", qty: "2" }],
      }),
    ).toBe(false);
  });
});
