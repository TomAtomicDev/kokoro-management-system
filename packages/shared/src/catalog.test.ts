import fc from "fast-check";
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

  it("accepts every positive integer opening quantity/cost pair (KOK-145)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        (openingQty, openingUnitCostMc) => {
          const result = createItemCommandSchema.safeParse({
            name: "Harina con stock inicial",
            kind: "RAW_MATERIAL",
            category: "INGREDIENT",
            unit: "KG",
            minStockQty: 0,
            openingQty,
            openingUnitCostMc,
          });
          expect(result.success).toBe(true);
        },
      ),
    );
  });

  it("requires both opening fields and rejects non-positive opening values", () => {
    const base = {
      name: "Harina con stock inicial",
      kind: "RAW_MATERIAL" as const,
      category: "INGREDIENT" as const,
      unit: "KG" as const,
      minStockQty: 0,
    };
    expect(createItemCommandSchema.safeParse({ ...base, openingQty: 1 }).success).toBe(false);
    expect(
      createItemCommandSchema.safeParse({ ...base, openingQty: 0, openingUnitCostMc: 1 }).success,
    ).toBe(false);
    expect(
      createItemCommandSchema.safeParse({ ...base, openingQty: 1, openingUnitCostMc: 0 }).success,
    ).toBe(false);
    expect(
      createItemCommandSchema.safeParse({
        ...base,
        isUnmetered: true,
        openingQty: 1,
        openingUnitCostMc: 1,
      }).success,
    ).toBe(false);
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

  it("accepts a SEMI_FINISHED item with a low-stock threshold", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Masa madre activada",
      kind: "SEMI_FINISHED",
      category: "BAKERY",
      unit: "KG",
      minStockQty: 1500,
    });

    expect(result.success).toBe(true);
  });

  it("accepts a SEMI_FINISHED item without a low-stock threshold", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Masa madre refrigerada",
      kind: "SEMI_FINISHED",
      category: "BAKERY",
      unit: "KG",
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

  it("does not accept wac as an input field (derived, not user-settable)", () => {
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

  it("accepts replacementCostMc for an isUnmetered RAW_MATERIAL item (Doc 03 C-9)", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Agua",
      kind: "RAW_MATERIAL",
      category: "INGREDIENT",
      unit: "L",
      minStockQty: 0,
      isUnmetered: true,
      replacementCostMc: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects replacementCostMc for a metered RAW_MATERIAL item", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Harina",
      kind: "RAW_MATERIAL",
      category: "INGREDIENT",
      unit: "KG",
      minStockQty: 0,
      replacementCostMc: 5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "replacementCostMc")).toBe(true);
    }
  });

  it("rejects replacementCostMc for a non-RAW_MATERIAL kind even if isUnmetered were true", () => {
    const result = createItemCommandSchema.safeParse({
      name: "Bolsa",
      kind: "PACKAGING",
      category: "NOT_EATABLE",
      unit: "UNIT",
      minStockQty: 0,
      replacementCostMc: 5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "replacementCostMc")).toBe(true);
    }
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
