import { describe, expect, it } from "vitest";

import {
  listAssemblyDefinitionsFiltersSchema,
  recordAssemblyDefinitionCommandSchema,
  setAssemblyDefinitionActiveCommandSchema,
} from "./assembly-definitions.js";

describe("recordAssemblyDefinitionCommandSchema", () => {
  const valid = {
    name: "Kéfir natural 500 ml",
    outputItemId: "finished_1",
    outputQty: 1000,
    lines: [{ itemId: "bottle_1", qty: 1000 }],
  };

  it("accepts a minimal definition and defaults isDefault to false", () => {
    expect(recordAssemblyDefinitionCommandSchema.parse(valid)).toMatchObject({
      ...valid,
      isDefault: false,
    });
  });

  it("trims the name and rejects blank names", () => {
    expect(recordAssemblyDefinitionCommandSchema.parse({ ...valid, name: "  Combo  " }).name).toBe(
      "Combo",
    );
    expect(recordAssemblyDefinitionCommandSchema.safeParse({ ...valid, name: "   " }).success).toBe(
      false,
    );
  });

  it("rejects a missing line, non-positive quantities, and fractional quantities", () => {
    expect(recordAssemblyDefinitionCommandSchema.safeParse({ ...valid, lines: [] }).success).toBe(
      false,
    );
    expect(
      recordAssemblyDefinitionCommandSchema.safeParse({ ...valid, outputQty: 0 }).success,
    ).toBe(false);
    expect(
      recordAssemblyDefinitionCommandSchema.safeParse({
        ...valid,
        lines: [{ itemId: "bottle_1", qty: 0.5 }],
      }).success,
    ).toBe(false);
  });
});

describe("assembly-definition filter and active schemas", () => {
  it("transforms isActive query strings", () => {
    expect(listAssemblyDefinitionsFiltersSchema.parse({ isActive: "true" }).isActive).toBe(true);
    expect(listAssemblyDefinitionsFiltersSchema.parse({ isActive: "false" }).isActive).toBe(false);
    expect(listAssemblyDefinitionsFiltersSchema.parse({}).isActive).toBeUndefined();
  });

  it("requires an id and boolean for active changes", () => {
    expect(
      setAssemblyDefinitionActiveCommandSchema.safeParse({ id: "def_1", isActive: false }).success,
    ).toBe(true);
    expect(
      setAssemblyDefinitionActiveCommandSchema.safeParse({ id: "", isActive: false }).success,
    ).toBe(false);
    expect(
      setAssemblyDefinitionActiveCommandSchema.safeParse({ id: "def_1", isActive: "false" })
        .success,
    ).toBe(false);
  });
});
