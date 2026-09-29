import { isIPv4, isIPv6 } from "node:net";
import type { BodyMismatch, BodyMismatchRule, SchemaConstraint } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { MAX_TRAVERSAL_DEPTH } from "../../testDesign/requestHelpers";
import { canonicalJson } from "./identifiers";

/**
 * AP-033 FR-005 (specs/033-edit-step-request-body research R7): how an edited JSON body differs
 * from the operation's request schema, in plain words. Warnings only; nothing here blocks a save or
 * a script.
 *
 * Only what the schema declares is checked: required properties, type, enum, the formats the
 * rule-based generator already knows, and numeric, length and item bounds. A specification's
 * `pattern` is never evaluated (a regular expression from an upload, run on engineer text, is a
 * ReDoS risk), and unknown properties are not reported (OpenAPI allows them unless it says
 * otherwise). A value that is exactly one `{{name}}` reference is filled at run time and never
 * reported. The format checks below are fixed, linear and ApiPilot's own.
 */

const ONLY_REFERENCE = /^\{\{[^{}]+\}\}$/;

/** A value that is exactly one `{{name}}` reference, filled in at run time. */
export function isOnlyReference(value: unknown): value is string {
  return typeof value === "string" && ONLY_REFERENCE.test(value);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HOST_LABEL = /^[A-Za-z0-9-]{1,63}$/;
const WHITESPACE = /\s/;

function isEmail(value: string): boolean {
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@") || WHITESPACE.test(value)) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

function isHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  return value.split(".").every((label) => HOST_LABEL.test(label) && !label.startsWith("-") && !label.endsWith("-"));
}

function isUri(value: string): boolean {
  try {
    return new URL(value).protocol.length > 1;
  } catch {
    return false;
  }
}

const FORMAT_CHECKS: Readonly<Record<string, (value: string) => boolean>> = {
  email: isEmail,
  uuid: (value) => UUID.test(value),
  date: (value) => DATE.test(value),
  "date-time": (value) => DATE_TIME.test(value),
  uri: isUri,
  hostname: isHostname,
  ipv4: (value) => isIPv4(value),
  ipv6: (value) => isIPv6(value),
  byte: (value) => BASE64.test(value),
};

type JsonType = "integer" | "number" | "string" | "boolean" | "array" | "object" | "null";

const ARTICLE: Readonly<Record<JsonType, string>> = {
  integer: "an integer",
  number: "a number",
  string: "a string",
  boolean: "a boolean",
  array: "an array",
  object: "an object",
  null: "null",
};

function typeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

function matchesType(declared: string, actual: JsonType): boolean {
  if (declared === "number") return actual === "number" || actual === "integer";
  return declared === actual;
}

function subject(fieldPath: string): string {
  return fieldPath === "" ? "The body" : `\`${fieldPath}\``;
}

function childPath(fieldPath: string, name: string): string {
  return fieldPath === "" ? name : `${fieldPath}.${name}`;
}

class Collector {
  readonly found: BodyMismatch[] = [];

  add(fieldPath: string, rule: BodyMismatchRule, message: string): void {
    this.found.push({ fieldPath, rule, message });
  }
}

/** A lower or upper bound check: `value` and `limit` compared, with the message's wording. */
function bound(out: Collector, fieldPath: string, rule: BodyMismatchRule, value: number, limit: number | undefined, below: boolean, text: string): void {
  if (limit !== undefined && (below ? value < limit : value > limit)) out.add(fieldPath, rule, `${subject(fieldPath)} ${text} ${limit}.`);
}

function checkNumber(schema: SchemaConstraint, value: number, fieldPath: string, out: Collector): void {
  bound(out, fieldPath, "minimum", value, schema.minimum, true, "is below the documented minimum of");
  bound(out, fieldPath, "maximum", value, schema.maximum, false, "is above the documented maximum of");
}

function checkString(schema: SchemaConstraint, value: string, fieldPath: string, out: Collector): void {
  const length = [...value].length;
  bound(out, fieldPath, "minLength", length, schema.minLength, true, "is shorter than the documented minimum length of");
  bound(out, fieldPath, "maxLength", length, schema.maxLength, false, "is longer than the documented maximum length of");
  const check = schema.format ? FORMAT_CHECKS[schema.format] : undefined;
  if (check && !check(value)) out.add(fieldPath, "format", `${subject(fieldPath)} is not a valid ${schema.format}.`);
}

function checkArray(schema: SchemaConstraint, value: unknown[], fieldPath: string, depth: number, out: Collector): void {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    out.add(fieldPath, "minItems", `${subject(fieldPath)} has fewer than the documented minimum of ${schema.minItems} items.`);
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    out.add(fieldPath, "maxItems", `${subject(fieldPath)} has more than the documented maximum of ${schema.maxItems} items.`);
  }
  const items = schema.items;
  if (items) value.forEach((item, index) => walk(items, item, `${fieldPath}[${index}]`, depth + 1, out));
}

function checkObject(schema: SchemaConstraint, record: Record<string, unknown>, fieldPath: string, depth: number, out: Collector): void {
  for (const name of schema.required) {
    const path = childPath(fieldPath, name);
    if (record[name] === undefined) out.add(path, "required", `${subject(path)} is required by the specification and missing.`);
  }
  for (const [name, child] of Object.entries(schema.properties)) {
    if (record[name] !== undefined) walk(child, record[name], childPath(fieldPath, name), depth + 1, out);
  }
}

function walk(schema: SchemaConstraint, value: unknown, fieldPath: string, depth: number, out: Collector): void {
  if (depth >= MAX_TRAVERSAL_DEPTH) return;
  if (isOnlyReference(value)) return;
  const actual = typeOf(value);
  if (schema.type !== undefined && !matchesType(schema.type, actual)) {
    const expected = ARTICLE[schema.type as JsonType] ?? schema.type;
    out.add(fieldPath, "type", `${subject(fieldPath)} should be ${expected}, not ${ARTICLE[actual]}.`);
    return;
  }
  if (schema.enum && !schema.enum.some((option) => canonicalJson(option) === canonicalJson(value))) {
    out.add(fieldPath, "enum", `${subject(fieldPath)} is not one of the documented values.`);
  }
  if (typeof value === "number") checkNumber(schema, value, fieldPath, out);
  else if (typeof value === "string") checkString(schema, value, fieldPath, out);
  else if (Array.isArray(value)) checkArray(schema, value, fieldPath, depth, out);
  else if (actual === "object") checkObject(schema, value as Record<string, unknown>, fieldPath, depth, out);
}

/** Every mismatch, in code-unit order of field path; stops at `MAX_TRAVERSAL_DEPTH`. */
export function bodySchemaMismatches(schema: SchemaConstraint, value: unknown): BodyMismatch[] {
  const out = new Collector();
  walk(schema, value, "", 0, out);
  return out.found.sort((a, b) => compareCodeUnits(a.fieldPath, b.fieldPath));
}
