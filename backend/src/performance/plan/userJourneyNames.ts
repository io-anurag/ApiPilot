/**
 * AP-035 name rules (specs/035-user-defined-journeys FR-026, research R8, R11). Pure.
 * - A capture name is letters, digits and underscores, does not start with a digit, and is at most
 *   64 characters (an implementation bound, so the derived script key stays small).
 * - A journey name is trimmed, 1 to 100 characters, with no control characters.
 * - A header name is an RFC 9110 token of 1 to 128 characters, stored lowercased.
 */
const CAPTURE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
export const MAX_JOURNEY_NAME_LENGTH = 100;

export function isValidCaptureName(name: unknown): name is string {
  return typeof name === "string" && CAPTURE_NAME.test(name);
}

/** The trimmed journey name, or `null` when it breaks the rule. */
export function normalizeJourneyName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_JOURNEY_NAME_LENGTH || CONTROL.test(trimmed)) return null;
  return trimmed;
}

/** The lowercased header name, or `null` when it is not an HTTP token of 1 to 128 characters. */
export function normalizeHeaderName(name: unknown): string | null {
  return typeof name === "string" && HEADER_TOKEN.test(name) ? name.toLowerCase() : null;
}
