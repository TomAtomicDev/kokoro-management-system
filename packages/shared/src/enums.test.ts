import { describe, expect, it } from "vitest";
import {
  FINANCIAL_TRANSACTION_CATEGORIES,
  ITEM_KINDS,
  STOCK_MOVEMENT_TYPES,
  UNITS,
  itemKindSchema,
  unitSchema,
} from "./enums";

describe("enums mirror Doc 04 DDL verbatim", () => {
  it("item kinds", () => {
    expect(ITEM_KINDS).toEqual(["RAW_MATERIAL", "SEMI_FINISHED", "FINISHED"]);
  });

  it("units", () => {
    expect(UNITS).toEqual(["G", "KG", "ML", "L", "UNIT"]);
  });

  it("stock movement types", () => {
    expect(STOCK_MOVEMENT_TYPES).toEqual([
      "PURCHASE_IN",
      "PRODUCTION_IN",
      "PRODUCTION_OUT",
      "SALE_OUT",
      "EXIT_OUT",
      "ADJUST",
    ]);
  });

  it("financial transaction categories (all 12)", () => {
    expect(FINANCIAL_TRANSACTION_CATEGORIES).toHaveLength(12);
    expect(FINANCIAL_TRANSACTION_CATEGORIES).toContain("OWNER_WITHDRAWAL");
    expect(FINANCIAL_TRANSACTION_CATEGORIES).toContain("DEPOSIT_REFUND");
  });

  it("zod schemas accept valid values and reject junk", () => {
    expect(unitSchema.parse("KG")).toBe("KG");
    expect(itemKindSchema.safeParse("NOPE").success).toBe(false);
  });
});
