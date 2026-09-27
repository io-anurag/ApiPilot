/**
 * The run-order list's per-run order (specs/028 FR-015c, specs/026 FR-019): an order for runs
 * only, kept apart from the collection's stored order. `undefined` means "the collection's own
 * order".
 */
export type RunOrder = readonly string[] | undefined;

/**
 * The requests in the run's order. Ids the collection no longer has are dropped, and requests the
 * stored order does not know yet (added after it was set) follow in the collection's own order, so
 * every current request appears exactly once.
 */
export function applyRunOrder<T extends { id: string }>(requests: readonly T[], runOrder: RunOrder): T[] {
  if (!runOrder) return [...requests];
  const byId = new Map(requests.map((request) => [request.id, request]));
  const ordered = runOrder.flatMap((id) => byId.get(id) ?? []);
  const placed = new Set(ordered.map((request) => request.id));
  return [...ordered, ...requests.filter((request) => !placed.has(request.id))];
}

/** `ids` with `id` moved to `toIndex` (clamped to the list), every other id keeping its relative order. */
export function moveRunOrderItem(ids: readonly string[], id: string, toIndex: number): string[] {
  const without = ids.filter((entry) => entry !== id);
  if (without.length === ids.length) return [...ids];
  const index = Math.max(0, Math.min(toIndex, without.length));
  return [...without.slice(0, index), id, ...without.slice(index)];
}
