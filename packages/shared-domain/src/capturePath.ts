import type { BodyPathSegment } from "./performance";

/**
 * AP-035 FR-008 (specs/035-user-defined-journeys research R6): the closed grammar of a response or
 * request body field path, `field(.field | [n])*`. A field is one or more of `A-Z a-z 0-9 _ - $`,
 * `n` a non-negative integer of at most 6 digits. Wildcards, filters, expressions, quotes and code
 * are refused with the position of the first character that breaks the grammar, so a path can only
 * ever reach the script as a list of strings and integers (FR-018). Pure.
 *
 * AP-037 (specs/037-request-chain-performance research R3): moved here unchanged from the backend,
 * so the request-chain editor and the server validate extractor and check paths with one grammar.
 */
export const MAX_CAPTURE_PATH_LENGTH = 256;
export const MAX_CAPTURE_PATH_SEGMENTS = 16;
const MAX_INDEX_DIGITS = 6;
const FIELD_CHAR = /[A-Za-z0-9_$-]/;
const DIGIT = /[0-9]/;

export type CapturePathResult = { ok: true; segments: BodyPathSegment[]; path: string } | { ok: false; position: number; reason: string };

export function parseCapturePath(text: string): CapturePathResult {
  if (text.length === 0) return { ok: false, position: 0, reason: "A field path cannot be empty." };
  if (text.length > MAX_CAPTURE_PATH_LENGTH) {
    return { ok: false, position: MAX_CAPTURE_PATH_LENGTH, reason: `A field path is at most ${MAX_CAPTURE_PATH_LENGTH} characters.` };
  }
  const segments: BodyPathSegment[] = [];
  let index = 0;
  let expectField = true;
  while (index < text.length) {
    const char = text[index];
    if (char === "[") {
      if (segments.length === 0) return { ok: false, position: index, reason: "A field path starts with a field name." };
      let end = index + 1;
      while (end < text.length && DIGIT.test(text[end])) end += 1;
      const digits = text.slice(index + 1, end);
      if (digits.length === 0 || text[end] !== "]") {
        return { ok: false, position: end, reason: "An array position is written [n], with n a number; wildcards and filters are not accepted." };
      }
      if (digits.length > MAX_INDEX_DIGITS) return { ok: false, position: index + 1, reason: `An array position has at most ${MAX_INDEX_DIGITS} digits.` };
      segments.push({ index: Number(digits) });
      index = end + 1;
      expectField = false;
    } else if (char === ".") {
      if (segments.length === 0 || expectField) return { ok: false, position: index, reason: "Each part of a field path needs a name." };
      index += 1;
      expectField = true;
    } else if (FIELD_CHAR.test(char)) {
      if (!expectField) return { ok: false, position: index, reason: "Separate field names with a dot." };
      let end = index;
      while (end < text.length && FIELD_CHAR.test(text[end])) end += 1;
      segments.push({ field: text.slice(index, end) });
      index = end;
      expectField = false;
    } else {
      return { ok: false, position: index, reason: "A field path holds only field names and array positions such as items[0].id." };
    }
    if (segments.length > MAX_CAPTURE_PATH_SEGMENTS) {
      return { ok: false, position: index, reason: `A field path has at most ${MAX_CAPTURE_PATH_SEGMENTS} parts.` };
    }
  }
  if (expectField) return { ok: false, position: text.length, reason: "A field path cannot end with a dot." };
  return { ok: true, segments, path: formatCapturePath(segments) };
}

/** The canonical text of a path, as `parseCapturePath` accepts it. */
export function formatCapturePath(segments: readonly BodyPathSegment[]): string {
  return segments.map((segment, index) => ("index" in segment ? `[${segment.index}]` : index === 0 ? segment.field : `.${segment.field}`)).join("");
}

/** The value at `segments` in `value`, or `undefined`. Fields read own properties of a non-array object. */
export function valueAtPath(value: unknown, segments: readonly BodyPathSegment[]): unknown {
  let current = value;
  for (const segment of segments) {
    if ("index" in segment) {
      if (!Array.isArray(current) || segment.index >= current.length) return undefined;
      current = current[segment.index];
    } else {
      if (current === null || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment.field)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment.field];
    }
  }
  return current;
}

/** A copy of `value` with the existing field at `segments` replaced, or `value` unchanged when the field is absent. */
export function withValueAtPath(value: unknown, segments: readonly BodyPathSegment[], replacement: unknown): unknown {
  if (segments.length === 0) return replacement;
  const [head, ...rest] = segments;
  if ("index" in head) {
    if (!Array.isArray(value) || head.index >= value.length) return value;
    const copy = [...value];
    copy[head.index] = withValueAtPath(copy[head.index], rest, replacement);
    return copy;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, head.field)) return value;
  const record = { ...(value as Record<string, unknown>) };
  record[head.field] = withValueAtPath(record[head.field], rest, replacement);
  return record;
}
