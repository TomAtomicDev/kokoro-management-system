import { describe, expect, it } from "vitest";

import { wouldCreateAssemblyCycle } from "./cycle-check.js";

describe("wouldCreateAssemblyCycle", () => {
  it("detects a direct self-reference", () => {
    expect(wouldCreateAssemblyCycle(new Map(), "A", ["A"])).toBe(true);
  });

  it("detects a transitive A contains B, B contains A cycle", () => {
    expect(wouldCreateAssemblyCycle(new Map([["B", ["A"]]]), "A", ["B"])).toBe(true);
  });

  it("allows a non-cyclical multi-level chain", () => {
    const graph = new Map<string, readonly string[]>([
      ["B", ["C"]],
      ["C", ["leaf"]],
    ]);
    expect(wouldCreateAssemblyCycle(graph, "A", ["B"])).toBe(false);
  });
});
