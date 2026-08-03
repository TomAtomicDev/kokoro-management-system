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
      minStockQty: 0,
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

  it("rejects a negative salePriceMc", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Torta",
      kind: "FINISHED",
      category: "BAKERY",
      unit: "UNIT",
      salePriceMc: -100,
    });
    expect(result.success).toBe(false);
  });

  it.each([
    {
      kind: "RAW_MATERIAL" as const,
      salePriceMc: null,
      minStockQty: 0,
    },
    {
      kind: "SEMI_FINISHED" as const,
      salePriceMc: null,
      minStockQty: null,
    },
    {
      kind: "FINISHED" as const,
      salePriceMc: 1,
      minStockQty: null,
    },
  ])("accepts the valid sale-price/min-stock combination for $kind", (fields) => {
    const result = createItemCommandSchema.safeParse({
      name: "Ítem válido",
      category: "INGREDIENT",
      unit: "KG",
      ...fields,
    });

    expect(result.success).toBe(true);
  });

  it.each([
    {
      kind: "RAW_MATERIAL" as const,
      salePriceMc: 1,
      minStockQty: 0,
      field: "salePriceMc",
    },
    {
      kind: "RAW_MATERIAL" as const,
      salePriceMc: null,
      field: "minStockQty",
    },
    {
      kind: "SEMI_FINISHED" as const,
      salePriceMc: 1,
      minStockQty: null,
      field: "salePriceMc",
    },
    {
      kind: "SEMI_FINISHED" as const,
      salePriceMc: null,
      minStockQty: 1,
      field: "minStockQty",
    },
    {
      kind: "FINISHED" as const,
      salePriceMc: null,
      minStockQty: null,
      field: "salePriceMc",
    },
    {
      kind: "FINISHED" as const,
      salePriceMc: 1,
      minStockQty: 1,
      field: "minStockQty",
    },
  ])("rejects an invalid $kind field combination at $field", (fields) => {
    const result = createItemCommandSchema.safeParse({
      name: "Ítem inválido",
      category: "INGREDIENT",
      unit: "KG",
      ...fields,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === fields.field)).toBe(true);
    }
  });

  it("does not accept wac/replacementCostMc as input fields (derived, not user-settable)", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Harina",
      kind: "RAW_MATERIAL",
      category: "INGREDIENT",
      unit: "KG",
      minStockQty: 0,
      wac: 999,
    });
    expect(result.success).toBe(true);
    // wac is stripped â€” not part of the schema's shape, so it never reaches core/.
    expect((result as { data: Record<string, unknown> }).data.wac).toBeUndefined();
  });
});

describe("updateItemCommandSchema", () => {
  it("allows a partial patch with just id + one field", () => {
    const result = updateItemCommandSchema.safeParse({ id: "item_1", notes: "Nueva nota" });
    expect(result.success).toBe(true);
  });

  it("skips kind-exclusive validation when kind is omitted", () => {
    const result = updateItemCommandSchema.safeParse({ id: "item_1", salePriceMc: 100 });

    expect(result.success).toBe(true);
  });

  it("applies kind-exclusive validation when kind is present", () => {
    const result = updateItemCommandSchema.safeParse({
      id: "item_1",
      kind: "FINISHED",
      salePriceMc: 100,
      minStockQty: 0,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["minStockQty"]);
    }
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
