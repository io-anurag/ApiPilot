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

/** Types a `RequestSortKey` literal so call sites build the key through one typed function rather than an untyped object literal. */
export function requestSortKey(key: RequestSortKey): RequestSortKey {
  return key;
}

/**
 * `positive` sorts before every other category, so the happy-path request an engineer reads
 * first is a working one rather than a deliberately invalid one (research.md: ordering rule).
 */
function categoryRank(category: string): number {
  return category === "positive" ? 0 : 1;
}

/**
 * Method priority within an endpoint: create, replace, read, then remove — reads as the CRUD
 * lifecycle of the resource rather than the alphabetical DELETE/GET/POST/PUT order the plain
 * string would give. A method outside this set (e.g. PATCH) has no defined place in that
 * lifecycle, so it sorts after all four, in code-unit order among themselves via the
 * `compareCodeUnits` tiebreaker below, keeping the ordering total rather than undefined.
 */
const METHOD_ORDER = ["POST", "PUT", "GET", "DELETE"];

function methodRank(method: string): number {
  const index = METHOD_ORDER.indexOf(method);
  return index === -1 ? METHOD_ORDER.length : index;
}

/** Orders requests by `(path, method priority, positive-before-other, category, scenario id)`. */
export function compareRequestSortKeys(a: RequestSortKey, b: RequestSortKey): number {
  return (
    compareCodeUnits(a.path, b.path) ||
    methodRank(a.method) - methodRank(b.method) ||
    compareCodeUnits(a.method, b.method) ||
    categoryRank(a.category) - categoryRank(b.category) ||
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