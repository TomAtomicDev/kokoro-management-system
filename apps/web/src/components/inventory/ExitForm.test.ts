import type { StockExitDto } from "@kokoro/shared";
import { describe, expect, it } from "vitest";

import {
  exitFormInitialState,
  hasActiveAssemblyDefinition,
  packagingLinesFromDefaultDefinition,
} from "./ExitForm";

// `exitFormInitialState` is the (absent -> blank create state) / (StockExitDto -> edit-mode
// prefill) mapper ExitForm's local state is seeded from. Exercised as a plain function, same
// rationale as useReplayConfirmableMutation.test.ts / PurchaseForm.test.ts: this workspace has
// neither jsdom nor @testing-library/react installed, and D-10 forbids adding either just to
// render the form in a test, so this pure mapper is the load-bearing coverage for "did edit mode
// prefill correctly" and "does create mode still default to today's blank form".

function exit(overrides: Partial<StockExitDto> = {}): StockExitDto {
  return {
    id: "exit-1",
    occurredAt: "2026-07-01T12:00:00.000Z",
    businessDate: "2026-07-01",
    itemId: "item-1",
    qty: 1500,
    reason: "WASTE",
    unitCostSnapshotMc: 200_000_000,
    packagingLines: [],
    sessionId: null,
    code: null,
    notes: "Se cayó al piso",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("exitFormInitialState", () => {
  it("(create mode, no exit) defaults to a blank form dated today", () => {
    const state = exitFormInitialState(null, () => "2026-07-19T08:00:00.000Z");

    expect(state).toEqual({
      itemId: null,
      qty: "",
      reason: "WASTE",
      businessDate: "2026-07-19",
      notes: "",
      packagingLines: [],
    });
  });

  it("(create mode, undefined exit) behaves the same as null", () => {
    const state = exitFormInitialState(undefined, () => "2026-07-19T08:00:00.000Z");
    expect(state.itemId).toBeNull();
    expect(state.businessDate).toBe("2026-07-19");
  });

  it("(edit mode) maps every scalar field straight through", () => {
    const state = exitFormInitialState(exit());

    expect(state.itemId).toBe("item-1");
    expect(state.reason).toBe("WASTE");
    expect(state.businessDate).toBe("2026-07-01");
    expect(state.notes).toBe("Se cayó al piso");
  });

  it("(edit mode) prefills packaging lines with decimal quantities", () => {
    const state = exitFormInitialState(
      exit({
        packagingLines: [
          { id: "line-1", itemId: "bag-1", qty: 2500, unitCostSnapshotMc: 1_000_000 },
        ],
      }),
    );

    expect(state.packagingLines).toEqual([{ itemId: "bag-1", qty: "2.5" }]);
  });

  it("(edit mode) converts qty's milli-unit integer into a decimal-string form field", () => {
    // qty is milli-units (scale 3): 1500 -> "1.5".
    const state = exitFormInitialState(exit({ qty: 1500 }));
    expect(state.qty).toBe("1.5");
  });

  it("(edit mode) falls back to an empty string for null notes", () => {
    const state = exitFormInitialState(exit({ notes: null }));
    expect(state.notes).toBe("");
  });

  it("(edit mode) never reads the injected clock — the exit's own businessDate wins", () => {
    const state = exitFormInitialState(exit({ businessDate: "2020-01-01" }), () => {
      throw new Error("nowIsoFn must not be called in edit mode");
    });
    expect(state.businessDate).toBe("2020-01-01");
  });
});

describe("hasActiveAssemblyDefinition", () => {
  it("treats an active non-default definition as an assembled presentation", () => {
    expect(hasActiveAssemblyDefinition([{ isActive: true, isDefault: false }])).toBe(true);
  });

  it("does not treat missing or inactive definitions as an assembled presentation", () => {
    expect(hasActiveAssemblyDefinition(undefined)).toBe(false);
    expect(hasActiveAssemblyDefinition([{ isActive: false, isDefault: true }])).toBe(false);
  });
});

describe("packagingLinesFromDefaultDefinition", () => {
  it("prefills only packaging components from the active default definition", () => {
    const lines = packagingLinesFromDefaultDefinition(
      "bulk-product",
      500,
      [
        {
          isActive: true,
          isDefault: true,
          outputQty: 1000,
          lines: [
            { itemId: "bulk-product", qty: 1000 },
            { itemId: "bag-1", qty: 2500 },
          ],
        },
      ],
      new Set(["bag-1"]),
    );

    expect(lines).toEqual([{ itemId: "bag-1", qty: "1.25" }]);
  });

  it("defaults to no lines when no unique active default definition applies", () => {
    expect(
      packagingLinesFromDefaultDefinition(
        "bulk-product",
        1000,
        [
          {
            isActive: true,
            isDefault: false,
            outputQty: 1000,
            lines: [
              { itemId: "bulk-product", qty: 1000 },
              { itemId: "bag-1", qty: 1000 },
            ],
          },
          {
            isActive: false,
            isDefault: true,
            outputQty: 1000,
            lines: [
              { itemId: "bulk-product", qty: 1000 },
              { itemId: "bag-2", qty: 1000 },
            ],
          },
        ],
        new Set(["bag-1", "bag-2"]),
      ),
    ).toEqual([]);
    expect(
      packagingLinesFromDefaultDefinition("bulk-product", 1000, undefined, new Set(["bag-1"])),
    ).toEqual([]);
  });

  it("does not guess when multiple default definitions use the same product", () => {
    const definition = {
      isActive: true,
      isDefault: true,
      outputQty: 1000,
      lines: [
        { itemId: "bulk-product", qty: 1000 },
        { itemId: "bag-1", qty: 1000 },
      ],
    };

    expect(
      packagingLinesFromDefaultDefinition(
        "bulk-product",
        1000,
        [definition, { ...definition, lines: [{ itemId: "bulk-product", qty: 500 }] }],
        new Set(["bag-1"]),
      ),
    ).toEqual([]);
  });
});
