import { MAX_PATH_PARAMETER_VALUES, PATH_PARAM_MIN_DISTINCT } from "../limits";

/**
 * Path parameter inference (specs/056 FR-013, clarification 2026-10-18, research R14). A segment is a
 * path parameter only where the capture shows at least two distinct identifier-like values at that
 * position across paths that are otherwise the same pattern. A single value, or a segment that is not
 * identifier-like, stays literal; a lone identifier-like value is reported as ambiguous.
 */

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_24 = /^[0-9a-fA-F]{24}$/;
const HEX_8_PLUS = /^[0-9a-fA-F]{8,}$/;
const ULID = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MIXED_TOKEN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{12,}$/;

/** Identifier-like: digits, UUID, 24 or 8+ hex, ULID, an ISO date, or a 12+ character token mixing letters and digits. */
export function isIdentifierLike(segment: string): boolean {
  if (segment === "") return false;
  return (
    /^\d+$/.test(segment) ||
    UUID.test(segment) ||
    HEX_24.test(segment) ||
    HEX_8_PLUS.test(segment) ||
    ULID.test(segment) ||
    ISO_DATE.test(segment) ||
    MIXED_TOKEN.test(segment)
  );
}

/** Deterministic English singular of a path word (`categories` to `category`, `users` to `user`). */
function singular(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && /(sses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function safeName(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9]+(.)?/g, (_m, next: string | undefined) => (next ? next.toUpperCase() : ""));
  return cleaned === "" ? "" : /^\d/.test(cleaned) ? `p${cleaned}` : cleaned;
}

export interface PathInput {
  origin: string;
  method: string;
  /** Normalized path, starting with `/`. */
  path: string;
}

export interface InferredParameter {
  name: string;
  /** Zero-based segment position. */
  position: number;
  distinctValues: number;
  /** Up to 10 observed values in first-seen order. */
  exampleValues: string[];
}

export interface AmbiguousSegment {
  position: number;
  /** Observations (entries) that carried the lone identifier-like value. */
  observations: number;
}

export interface InferredPath {
  /** The pattern as segments, with `{name}` for parameters. */
  pattern: string;
  parameters: InferredParameter[];
  ambiguous: AmbiguousSegment[];
  /** The concrete segment values for this exact observed path, by parameter name. */
  valuesByParameter: Record<string, string>;
}

/** The key under which `inferPathPatterns` reports a path. */
export function pathKey(origin: string, method: string, path: string): string {
  return `${origin}\u0000${method}\u0000${path}`;
}

/**
 * Infers a pattern for every distinct `(origin, method, path)` in `inputs`. `inputs` may repeat a path
 * (one per observation); the number of repeats is the observation count used for ambiguity reports.
 */
export function inferPathPatterns(inputs: readonly PathInput[]): Map<string, InferredPath> {
  const observations = new Map<string, number>();
  const groups = new Map<string, { segmentCount: number; paths: string[][] }>();
  const seen = new Set<string>();

  for (const input of inputs) {
    const key = pathKey(input.origin, input.method, input.path);
    observations.set(key, (observations.get(key) ?? 0) + 1);
    if (seen.has(key)) continue;
    seen.add(key);
    const segments = input.path.split("/").slice(1);
    const skeleton = JSON.stringify([
      input.origin,
      input.method,
      segments.map((segment) => (isIdentifierLike(segment) ? "*" : segment)),
    ]);
    const group = groups.get(skeleton) ?? { segmentCount: segments.length, paths: [] };
    group.paths.push(segments);
    groups.set(skeleton, group);
  }

  const result = new Map<string, InferredPath>();
  for (const [skeletonKey, group] of groups) {
    const [origin, method] = JSON.parse(skeletonKey) as [string, string, string[]];
    const first = group.paths[0];
    const wildcardPositions = first.map((segment, position) => (isIdentifierLike(segment) ? position : -1)).filter((p) => p >= 0);

    // Distinct values and per-value observation counts for each wildcard position.
    const parameterPositions: number[] = [];
    const valuesAt = new Map<number, string[]>();
    for (const position of wildcardPositions) {
      const values: string[] = [];
      for (const segments of group.paths) if (!values.includes(segments[position])) values.push(segments[position]);
      valuesAt.set(position, values);
      if (values.length >= PATH_PARAM_MIN_DISTINCT) parameterPositions.push(position);
    }

    // Names, left to right: singular of the preceding literal segment plus `Id`, else `id`; numeric suffix on collision.
    const names = new Map<number, string>();
    const used = new Set<string>();
    for (const position of parameterPositions) {
      const previous = position > 0 ? first[position - 1] : undefined;
      const previousIsLiteral = previous !== undefined && !isIdentifierLike(previous);
      const stem = previousIsLiteral ? safeName(singular(previous.toLowerCase())) : "";
      const base = stem === "" ? "id" : `${stem}Id`;
      let name = base;
      for (let n = 2; used.has(name); n += 1) name = `${base}${n}`;
      used.add(name);
      names.set(position, name);
    }

    for (const segments of group.paths) {
      const pattern = segments.map((segment, position) => (names.has(position) ? `{${names.get(position)}}` : segment));
      const valuesByParameter: Record<string, string> = {};
      for (const [position, name] of names) valuesByParameter[name] = segments[position];
      const concretePath = `/${segments.join("/")}`;
      const ambiguous: AmbiguousSegment[] = [];
      for (const position of wildcardPositions) {
        if (names.has(position)) continue;
        ambiguous.push({ position, observations: observations.get(pathKey(origin, method, concretePath)) ?? 1 });
      }
      result.set(pathKey(origin, method, concretePath), {
        pattern: `/${pattern.join("/")}`,
        parameters: [...names.entries()].map(([position, name]) => ({
          name,
          position,
          distinctValues: valuesAt.get(position)?.length ?? 0,
          exampleValues: (valuesAt.get(position) ?? []).slice(0, MAX_PATH_PARAMETER_VALUES),
        })),
        ambiguous,
        valuesByParameter,
      });
    }
  }
  return result;
}
