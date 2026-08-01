// Unit tests for core/costing/dependency-graph (KOK-024, Doc 03 §7 R-2/R-4).
//
// Like costing.test.ts, this module is plain synchronous DB-free math, so a plain Vitest run is
// enough — no @cloudflare/vitest-pool-workers, no D1 binding.
import { describe, expect, it } from "vitest";
import type { RecipeEdge } from "../src/core/costing/dependency-graph.js";
import { topoOrderAffectedItems } from "../src/core/costing/dependency-graph.js";

/** Asserts `before` is ordered ahead of `after` — the ONLY guarantee a topological sort makes.
 * Tests assert on relative order rather than an exact array so they pin the actual contract and do
 * not break the day tie-breaking between two independent branches changes. */
function expectOrderedBefore(order: readonly string[], before: string, after: string): void {
  const beforeIndex = order.indexOf(before);
  const afterIndex = order.indexOf(after);
  expect(beforeIndex).toBeGreaterThanOrEqual(0);
  expect(afterIndex).toBeGreaterThanOrEqual(0);
  expect(beforeIndex).toBeLessThan(afterIndex);
}

describe("topoOrderAffectedItems — single node (the state of the world until KOK-026)", () => {
  it("with no edges returns exactly the seeds, in order", () => {
    expect(topoOrderAffectedItems([], ["item-harina"])).toEqual(["item-harina"]);
    expect(topoOrderAffectedItems([], ["item-a", "item-b", "item-c"])).toEqual([
      "item-a",
      "item-b",
      "item-c",
    ]);
  });

  it("de-duplicates seeds, keeping first-seen order", () => {
    expect(topoOrderAffectedItems([], ["item-a", "item-b", "item-a"])).toEqual([
      "item-a",
      "item-b",
    ]);
  });

  it("with no seeds returns nothing, however many recipes exist", () => {
    const edges: RecipeEdge[] = [{ ingredientItemId: "item-a", outputItemId: "item-b" }];
    expect(topoOrderAffectedItems(edges, [])).toEqual([]);
  });
});

describe("topoOrderAffectedItems — chains", () => {
  // harina -> masa -> pan: a raw material, the semi-finished item made from it, and the finished
  // good made from that.
  const chain: RecipeEdge[] = [
    { ingredientItemId: "item-harina", outputItemId: "item-masa" },
    { ingredientItemId: "item-masa", outputItemId: "item-pan" },
  ];

  it("orders raw -> semi-finished -> finished from the root seed", () => {
    expect(topoOrderAffectedItems(chain, ["item-harina"])).toEqual([
      "item-harina",
      "item-masa",
      "item-pan",
    ]);
  });

  it("seeding mid-chain walks only downstream — the untouched raw material is not replayed", () => {
    expect(topoOrderAffectedItems(chain, ["item-masa"])).toEqual(["item-masa", "item-pan"]);
  });

  it("seeding the leaf returns just the leaf", () => {
    expect(topoOrderAffectedItems(chain, ["item-pan"])).toEqual(["item-pan"]);
  });

  it("is unaffected by the order the edges arrive in", () => {
    const reversed = [...chain].reverse();
    expect(topoOrderAffectedItems(reversed, ["item-harina"])).toEqual([
      "item-harina",
      "item-masa",
      "item-pan",
    ]);
  });

  it("collapses duplicate edges (the same ingredient listed twice in one recipe)", () => {
    const duplicated: RecipeEdge[] = [...chain, ...chain];
    expect(topoOrderAffectedItems(duplicated, ["item-harina"])).toEqual([
      "item-harina",
      "item-masa",
      "item-pan",
    ]);
  });
});

describe("topoOrderAffectedItems — diamond", () => {
  // leche -> {crema, mantequilla} -> postre. Both middle items must precede the shared output, and
  // the shared output must appear exactly once even though two paths reach it.
  const diamond: RecipeEdge[] = [
    { ingredientItemId: "item-leche", outputItemId: "item-crema" },
    { ingredientItemId: "item-leche", outputItemId: "item-mantequilla" },
    { ingredientItemId: "item-crema", outputItemId: "item-postre" },
    { ingredientItemId: "item-mantequilla", outputItemId: "item-postre" },
  ];

  it("visits each affected item exactly once, respecting both paths", () => {
    const order = topoOrderAffectedItems(diamond, ["item-leche"]);

    expect([...order].sort()).toEqual([
      "item-crema",
      "item-leche",
      "item-mantequilla",
      "item-postre",
    ]);
    expectOrderedBefore(order, "item-leche", "item-crema");
    expectOrderedBefore(order, "item-leche", "item-mantequilla");
    expectOrderedBefore(order, "item-crema", "item-postre");
    expectOrderedBefore(order, "item-mantequilla", "item-postre");
  });

  it("restricts in-degree to the reachable set: seeding one branch still emits the shared output", () => {
    // Seeding only `crema` leaves `mantequilla` — the other ingredient of `postre` — unaffected and
    // therefore never replayed. `postre` must NOT be held back waiting on it, or the correction
    // would silently drop the one item whose cost actually changed.
    const order = topoOrderAffectedItems(diamond, ["item-crema"]);
    expect(order).toEqual(["item-crema", "item-postre"]);
  });
});

describe("topoOrderAffectedItems — disconnected seeds", () => {
  const edges: RecipeEdge[] = [
    { ingredientItemId: "item-harina", outputItemId: "item-pan" },
    { ingredientItemId: "item-leche", outputItemId: "item-queso" },
  ];

  it("a seed with no edges at all is still returned", () => {
    expect(topoOrderAffectedItems(edges, ["item-sal"])).toEqual(["item-sal"]);
  });

  it("handles two independent components in one call", () => {
    const order = topoOrderAffectedItems(edges, ["item-harina", "item-leche"]);
    expect([...order].sort()).toEqual(["item-harina", "item-leche", "item-pan", "item-queso"]);
    expectOrderedBefore(order, "item-harina", "item-pan");
    expectOrderedBefore(order, "item-leche", "item-queso");
  });

  it("mixes a connected seed and an isolated one", () => {
    const order = topoOrderAffectedItems(edges, ["item-harina", "item-sal"]);
    expect([...order].sort()).toEqual(["item-harina", "item-pan", "item-sal"]);
    expectOrderedBefore(order, "item-harina", "item-pan");
  });
});

describe("topoOrderAffectedItems — cycles throw instead of looping forever", () => {
  function expectConflict(fn: () => unknown): unknown {
    let caught: unknown;
    try {
      fn();
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: "CONFLICT" });
    // D-9: the user-facing string is Spanish and non-empty.
    expect((caught as { message_es: string }).message_es.length).toBeGreaterThan(0);
    return caught;
  }

  it("throws a CONFLICT DomainError on a two-item cycle", () => {
    const cyclic: RecipeEdge[] = [
      { ingredientItemId: "item-a", outputItemId: "item-b" },
      { ingredientItemId: "item-b", outputItemId: "item-a" },
    ];
    const caught = expectConflict(() => topoOrderAffectedItems(cyclic, ["item-a"]));
    expect(caught).toMatchObject({ details: { unresolvedItemIds: expect.any(Array) } });
  });

  it("throws on a self-referencing item (a recipe listing its own output as an ingredient)", () => {
    expectConflict(() =>
      topoOrderAffectedItems([{ ingredientItemId: "item-a", outputItemId: "item-a" }], ["item-a"]),
    );
  });

  it("throws on a longer cycle reached downstream of an acyclic seed", () => {
    const cyclic: RecipeEdge[] = [
      { ingredientItemId: "item-seed", outputItemId: "item-a" },
      { ingredientItemId: "item-a", outputItemId: "item-b" },
      { ingredientItemId: "item-b", outputItemId: "item-c" },
      { ingredientItemId: "item-c", outputItemId: "item-a" },
    ];
    expectConflict(() => topoOrderAffectedItems(cyclic, ["item-seed"]));
  });

  it("does NOT throw when a cycle exists but is unreachable from the seeds", () => {
    const edges: RecipeEdge[] = [
      { ingredientItemId: "item-x", outputItemId: "item-y" },
      { ingredientItemId: "item-y", outputItemId: "item-x" },
      { ingredientItemId: "item-harina", outputItemId: "item-pan" },
    ];
    expect(topoOrderAffectedItems(edges, ["item-harina"])).toEqual(["item-harina", "item-pan"]);
  });
});
