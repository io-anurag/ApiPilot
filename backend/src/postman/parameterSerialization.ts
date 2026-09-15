import type { Parameter } from "@apipilot/shared-domain";

/**
 * Serializes an already-generated parameter value into URL/header text per its OpenAPI 3.x
 * `style`/`explode` (specs/022-openapi-parameter-serialization). Pure functions only — no
 * knowledge of `TestScenario`/`ApiOperation` beyond the one `Parameter` passed in.
 */

export type ParameterStyle =
  | "form"
  | "spaceDelimited"
  | "pipeDelimited"
  | "deepObject"
  | "simple"
  | "matrix"
  | "label";

/** One parameter's fully resolved serialization behavior for this export (FR-001-FR-003, Edge Cases). */
export interface ResolvedParameterStyle {
  style: ParameterStyle;
  explode: boolean;
  /** False for matrix/label/contentEncoded — callers must use the fallback+limitation path,
   *  never `serializeQueryParameter`/`serializeSimpleValue`, for such a parameter (FR-007). */
  implemented: boolean;
}

const IMPLEMENTED_QUERY_STYLES = new Set<string>(["form", "spaceDelimited", "pipeDelimited", "deepObject"]);

/**
 * Resolves a `Parameter`'s effective style/explode, applying the OpenAPI 3.x per-location default
 * (query/cookie: form/true; path/header: simple/false) when the specification declared neither
 * (spec Edge Cases). A `contentEncoded` parameter, or one declaring `matrix`/`label`, is marked
 * `implemented: false` regardless of any other value.
 */
export function resolveParameterStyle(parameter: Parameter): ResolvedParameterStyle {
  const isQueryLike = parameter.location === "query" || parameter.location === "cookie";
  const style = (parameter.style ?? (isQueryLike ? "form" : "simple")) as ParameterStyle;
  const explode = parameter.explode ?? isQueryLike;

  if (parameter.contentEncoded === true) {
    return { style, explode, implemented: false };
  }
  const implemented = isQueryLike ? IMPLEMENTED_QUERY_STYLES.has(style) : style === "simple";
  return { style, explode, implemented };
}

/** Percent-encodes one text fragment — the sole encoding primitive every other function here builds on. */
export function percentEncode(text: string): string {
  return encodeURIComponent(text);
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function encodedValue(value: unknown): string {
  return percentEncode(toText(value));
}

export interface SerializedQueryEntry {
  key: string;
  value: string;
}

/**
 * Serializes one query parameter's already-generated runtime value into the entries
 * `PostmanUrl.query` needs, per the resolved style (FR-003, FR-004). Every emitted key/value
 * piece is percent-encoded individually; the style's own structural separator (`,`, `|`, `[`/`]`,
 * repeated key) is never encoded — `spaceDelimited`'s separator is the one exception, itself
 * encoded as `%20`. Follows the value's own runtime shape (array/object/scalar), never the
 * schema's declared type (spec Edge Cases).
 */
export function serializeQueryParameter(
  name: string,
  value: unknown,
  resolved: ResolvedParameterStyle,
): SerializedQueryEntry[] {
  if (Array.isArray(value)) {
    if (resolved.explode) {
      return value.map((element) => ({ key: name, value: encodedValue(element) }));
    }
    const separator = resolved.style === "spaceDelimited" ? "%20" : resolved.style === "pipeDelimited" ? "|" : ",";
    return [{ key: name, value: value.map((element) => encodedValue(element)).join(separator) }];
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (resolved.style === "deepObject") {
      return entries.map(([property, propertyValue]) => ({
        key: `${name}[${percentEncode(property)}]`,
        value: encodedValue(propertyValue),
      }));
    }
    if (resolved.explode) {
      return entries.map(([property, propertyValue]) => ({
        key: percentEncode(property),
        value: encodedValue(propertyValue),
      }));
    }
    const flat = entries.flatMap(([property, propertyValue]) => [percentEncode(property), encodedValue(propertyValue)]);
    return [{ key: name, value: flat.join(",") }];
  }

  // A negative scenario's substituted scalar (declared array/object type violated) renders as one
  // scalar entry — serialization follows the runtime shape, never "repairs" the violation.
  return [{ key: name, value: encodedValue(value) }];
}

/**
 * Serializes one path or header parameter's value under the `simple` style (FR-005) into one
 * already-composed, percent-encoded text value — comma-joining array elements, or
 * `explode`-dependent property rendering for an object value. `simple` behaves identically for
 * path and header locations (both are its only two valid locations); path has no repeated-segment
 * form, so `explode: true` on an array still comma-joins within the one segment.
 */
export function serializeSimpleValue(value: unknown, explode: boolean): string {
  if (Array.isArray(value)) {
    return value.map((element) => encodedValue(element)).join(",");
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (explode) {
      return entries.map(([property, propertyValue]) => `${percentEncode(property)}=${encodedValue(propertyValue)}`).join(",");
    }
    return entries.flatMap(([property, propertyValue]) => [percentEncode(property), encodedValue(propertyValue)]).join(",");
  }
  return encodedValue(value);
}
