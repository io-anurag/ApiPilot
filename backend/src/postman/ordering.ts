/**
 * Deterministic ordering primitives for artifact generation (research.md: ordering rule).
 *
 * `localeCompare` is deliberately never used: its result depends on the runtime's ICU data,
 * which would make the same input produce different artifacts on different machines and
 * violate reproducibility (constitution XXIV).
 */

/** Locale-independent code-unit comparison. */
export function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The ordering key for one request within a folder. */
export interface RequestSortKey {
  path: string;
  method: string;
  category: string;
  scenarioId: string;
}

export function requestSortKey(key: RequestSortKey): RequestSortKey {
  return key;
}

/** Orders requests by `(path, method, category, scenario id)`, all by code unit. */
export function compareRequestSortKeys(a: RequestSortKey, b: RequestSortKey): number {
  return (
    compareCodeUnits(a.path, b.path) ||
    compareCodeUnits(a.method, b.method) ||
    compareCodeUnits(a.category, b.category) ||
    compareCodeUnits(a.scenarioId, b.scenarioId)
  );
}

/**
 * Record entries ordered by key. Used wherever a `Record` from the approved request has to
 * become an ordered list (headers, query parameters, environment values) so that the emitted
 * order never depends on object insertion order.
 */
export function sortedEntries<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => compareCodeUnits(a, b));
}

/**
 * Serializes an artifact for delivery and comparison. Key order comes from the emitting
 * types — the generator builds each object with a fixed literal key order — rather than from
 * a re-sort, so the output is both stable and readable in the shape the format documents.
 */
export function serializeArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}