import { describe, expect, it } from "vitest";

import { parseLineQuantityToMilliUnits } from "./line-editor-quantity";

describe("parseLineQuantityToMilliUnits", () => {
  it("maps 500 g and 0.5 kg to the same canonical kilogram value", () => {
    expect(parseLineQuantityToMilliUnits("500", "G", "KG")).toBe(500);
    expect(parseLineQuantityToMilliUnits("0.5", "KG", "KG")).toBe(500);
  });

  it("uses the canonical unit when no display unit is selected", () => {
    expect(parseLineQuantityToMilliUnits("0.5", null, "KG")).toBe(500);
  });

  it("rejects invalid, non-positive, and incompatible quantities", () => {
    expect(parseLineQuantityToMilliUnits("", "G", "KG")).toBeNull();
    expect(parseLineQuantityToMilliUnits("0", "G", "KG")).toBeNull();
    expect(parseLineQuantityToMilliUnits("5", "ML", "KG")).toBeNull();
  });
});
