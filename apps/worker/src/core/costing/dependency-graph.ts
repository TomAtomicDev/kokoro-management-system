// core/costing — pure recipe dependency-graph ordering for correction replays (KOK-024, Doc 03 §7
// "Correction & recalculation policy" R-2/R-4).
//
// When an event is edited or deleted, the WAC of the item it touched must be replayed — but if
// that item is an INGREDIENT of a recipe, every item produced from it inherits a new output cost,
// and so on transitively (raw material -> semi-finished -> finished good). The replay therefore
// has to visit items in DEPENDENCY ORDER: an item's own WAC must be final before any item made
// FROM it is replayed, otherwise the downstream production run would be re-costed against a stale
// ingredient WAC and the whole correction would need a second pass.
//
// This module answers exactly that ordering question and nothing else. Like wac.ts, every function
// here is a plain, synchronous, DB-free computation — the caller (a future correction service) is
// responsible for loading the recipe edges out of the DB and turning the returned item ids back
// into replays. That split is what keeps the ordering logic property-testable without a D1
// binding, and it is why this file has no `Db` parameter and nothing async.
//
// NOTE on the present scope: until recipes/production ship (KOK-026) there are no edges to load,
// so real callers pass `edges: []` and get their seeds straight back — the "single-node graph"
// case. The graph machinery is written now, with the seams already correct, so that KOK-026 only
// has to supply the edge loader and not revisit the correction service's control flow.

import { conflict } from "../errors.js";

/**
 * One recipe relationship: `ingredientItemId` is consumed to produce `outputItemId`. The edge
 * points ingredient -> output, i.e. in the direction cost FLOWS, which is also the order the
 * replay must visit the two items in.
 *
 * Quantities are deliberately absent: this module decides ORDER, not cost. What each output unit
 * costs is C-3/C-4's job, computed by the production service during the replay itself.
 */
export interface RecipeEdge {
  ingredientItemId: string;
  outputItemId: string;
}

/**
 * Returns the items affected by a change to `seedItemIds`, in an order safe to replay
 * sequentially: every item appears BEFORE any item produced from it.
 *
 * Two phases:
 *  1. Reachability — a BFS forward from the seeds along ingredient -> output edges. Items that
 *     cannot be reached from any seed are untouched by this correction and never appear in the
 *     result, so a big recipe book costs nothing when a change only affects one corner of it.
 *  2. Ordering — a Kahn topological sort RESTRICTED to that reachable set. Restricting matters:
 *     in-degree is counted only over edges whose ingredient is itself reachable, otherwise a
 *     reachable item that also has some unaffected ingredient would keep a permanent in-degree
 *     from an item that is never going to be replayed, and would be mistaken for a cycle.
 *
 * Seeds are de-duplicated, preserving first-seen order; duplicate edges are collapsed so a recipe
 * listing the same ingredient on two lines does not inflate in-degree. With no edges the result is
 * exactly the (de-duplicated) seeds, in the order given.
 *
 * A cycle among the reachable items — item A made from B while B is made from A, which the recipe
 * rules forbid but a bad data import could produce — has NO valid replay order, so this throws a
 * CONFLICT `DomainError` rather than looping forever or silently emitting a partial order.
 */
export function topoOrderAffectedItems(
  edges: readonly RecipeEdge[],
  seedItemIds: readonly string[],
): string[] {
  const outputsByIngredient = new Map<string, string[]>();
  const seenEdges = new Set<string>();

  for (const edge of edges) {
    // U+0000 cannot occur in an item id, so it is an unambiguous separator for the dedupe key
    // (a plain space or dash could in principle collide with a weird id and merge two edges).
    const key = `${edge.ingredientItemId}\u0000${edge.outputItemId}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    const outputs = outputsByIngredient.get(edge.ingredientItemId);
    if (outputs === undefined) {
      outputsByIngredient.set(edge.ingredientItemId, [edge.outputItemId]);
    } else {
      outputs.push(edge.outputItemId);
    }
  }

  // Phase 1 — BFS forward from the seeds. `reachable` doubles as the visited set; because a Set
  // preserves insertion order, iterating it later gives a stable, seeds-first discovery order.
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const seed of seedItemIds) {
    if (reachable.has(seed)) continue;
    reachable.add(seed);
    queue.push(seed);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    // `noUncheckedIndexedAccess` widens this to `| undefined`; `head < queue.length` rules it out.
    if (current === undefined) continue;
    for (const output of outputsByIngredient.get(current) ?? []) {
      if (reachable.has(output)) continue;
      reachable.add(output);
      queue.push(output);
    }
  }

  // Phase 2 — Kahn over the reachable subgraph. Any edge out of a reachable ingredient necessarily
  // lands on a reachable output (that is what phase 1 just established), so filtering on the
  // ingredient alone is enough to restrict the subgraph.
  const inDegree = new Map<string, number>();
  for (const item of reachable) inDegree.set(item, 0);
  for (const ingredient of reachable) {
    for (const output of outputsByIngredient.get(ingredient) ?? []) {
      inDegree.set(output, (inDegree.get(output) ?? 0) + 1);
    }
  }

  const ready: string[] = [];
  for (const item of reachable) {
    if (inDegree.get(item) === 0) ready.push(item);
  }

  const ordered: string[] = [];
  const placed = new Set<string>();
  for (let head = 0; head < ready.length; head += 1) {
    const current = ready[head];
    // `noUncheckedIndexedAccess` widens this to `| undefined`; `head < ready.length` rules it out.
    if (current === undefined) continue;
    ordered.push(current);
    placed.add(current);
    for (const output of outputsByIngredient.get(current) ?? []) {
      const remaining = (inDegree.get(output) ?? 0) - 1;
      inDegree.set(output, remaining);
      if (remaining === 0) ready.push(output);
    }
  }

  if (ordered.length !== reachable.size) {
    // Every node Kahn could not place is part of, or downstream of, a cycle.
    const unresolved = [...reachable].filter((item) => !placed.has(item));
    throw conflict(
      "Las recetas afectadas forman un ciclo: un producto se elabora, directa o indirectamente, a partir de sí mismo. Corrige las recetas antes de recalcular costos.",
      { unresolvedItemIds: unresolved },
    );
  }

  return ordered;
}
