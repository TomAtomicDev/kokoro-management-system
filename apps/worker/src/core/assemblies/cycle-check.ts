/**
 * BFS reachability check: starting from `candidateComponentItemIds` (the definition being
 * saved/edited, NOT yet reflected in `componentsByOutput`), can you reach `candidateOutputItemId`
 * by repeatedly expanding a component into its own active definition(s)' components?
 */
export function wouldCreateAssemblyCycle(
  componentsByOutput: ReadonlyMap<string, readonly string[]>,
  candidateOutputItemId: string,
  candidateComponentItemIds: readonly string[],
): boolean {
  const visited = new Set<string>();
  const queue: string[] = [...candidateComponentItemIds];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) continue;
    if (current === candidateOutputItemId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(componentsByOutput.get(current) ?? []));
  }
  return false;
}
