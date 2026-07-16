import { describe, expect, it } from "vitest";

import {
  createItemCommandSchema,
  listItemsFiltersSchema,
  mergeItemsCommandSchema,
  updateItemCommandSchema,
} from "./catalog";

describe("createItemCommandSchema", () => {
  it("accepts a minimal valid RAW_MATERIAL item", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Harina",
      kind: "RAW_MATERIAL",
      category: "INGREDIENT",
      unit: "KG",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = createItemCommandSchema.safeParse({
      name: "  ",
      kind: "RAW_MATERIAL",
      category: "INGREDIENT",
      unit: "KG",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Harina",
      kind: "NOPE",
      category: "INGREDIENT",
      unit: "KG",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative salePrice", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Torta",
      kind: "FINISHED",
      category: "BAKERY",
      unit: "UNIT",
      salePrice: -100,
    });
    expect(result.success).toBe(false);
  });

  it("does not accept wac/replacementCost as input fields (derived, not user-settable)", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Harina",
      kind: "RAW_MATERIAL",
      category: "INGREDIENT",
      unit: "KG",
      wac: 999,
    });
    expect(result.success).toBe(true);
    // wac is stripped — not part of the schema's shape, so it never reaches core/.
    expect((result as { data: Record<string, unknown> }).data.wac).toBeUndefined();
  });
});

describe("updateItemCommandSchema", () => {
  it("allows a partial patch with just id + one field", () => {
    const result = updateItemCommandSchema.safeParse({ id: "item_1", notes: "Nueva nota" });
    expect(result.success).toBe(true);
  });

  it("requires an id", () => {
    const result = updateItemCommandSchema.safeParse({ notes: "x" });
    expect(result.success).toBe(false);
  });
});

describe("mergeItemsCommandSchema", () => {
  it("rejects merging an item into itself", () => {
    const result = mergeItemsCommandSchema.safeParse({
      sourceItemId: "item_1",
      targetItemId: "item_1",
    });
    expect(result.success).toBe(false);
  });

  it("accepts two distinct ids", () => {
    const result = mergeItemsCommandSchema.safeParse({
      sourceItemId: "item_1",
      targetItemId: "item_2",
    });
    expect(result.success).toBe(true);
  });
});

describe("listItemsFiltersSchema", () => {
  it("transforms the isActive query string to boolean", () => {
    expect(listItemsFiltersSchema.parse({ isActive: "true" }).isActive).toBe(true);
    expect(listItemsFiltersSchema.parse({ isActive: "false" }).isActive).toBe(false);
    expect(listItemsFiltersSchema.parse({}).isActive).toBeUndefined();
  });

  it("rejects an invalid isActive literal", () => {
    expect(listItemsFiltersSchema.safeParse({ isActive: "yes" }).success).toBe(false);
  });
});
