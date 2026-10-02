import type { ApiOperation, SchemaConstraint } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";

/**
 * AP-035 FR-009 (specs/035-user-defined-journeys research R9): the response body fields the
 * specification documents for an operation's success responses, for the capture picker. Only the
 * analysis's own resolved `properties` and `items` are walked: a composed or unresolved schema
 * reaches the ApiModel as an empty constraint with an `AnalysisIssue`, so it lists nothing and no
 * field is invented. Response headers are not in the ApiModel, so none is listed. Pure.
 */
export interface DocumentedResponseField {
  /** In the capture path grammar (research R6), with `[0]` for array items. */
  path: string;
  type: string | null;
  /** The success status codes whose body documents this field, sorted. */
  statusCodes: string[];
}

export const MAX_RESPONSE_FIELD_DEPTH = 8;
export const MAX_RESPONSE_FIELDS = 300;
const SUCCESS = /^(2\d\d|2XX)$/;
const SCALAR_TYPES: ReadonlySet<string> = new Set(["string", "number", "integer", "boolean"]);

function isJsonMediaType(mediaType: string): boolean {
  const base = mediaType.split(";")[0].trim().toLowerCase();
  return base === "application/json" || base.endsWith("+json");
}

/** True when a schema can only hold a string, number or boolean, or does not say (no properties, no items). */
function isScalar(schema: SchemaConstraint): boolean {
  if (schema.type !== undefined) return SCALAR_TYPES.has(schema.type);
  return Object.keys(schema.properties).length === 0 && schema.items === undefined && schema.enum !== undefined;
}

function walk(schema: SchemaConstraint, path: string, depth: number, out: Map<string, string | null>): void {
  if (depth > MAX_RESPONSE_FIELD_DEPTH) return;
  if (path !== "" && isScalar(schema)) {
    if (!out.has(path)) out.set(path, schema.type ?? null);
    return;
  }
  if (schema.items) walk(schema.items, path === "" ? "" : `${path}[0]`, depth + 1, out);
  for (const [name, child] of Object.entries(schema.properties)) {
    // Names outside the path grammar cannot be written as a capture path, so they are not offered.
    if (!/^[A-Za-z0-9_$-]+$/.test(name)) continue;
    walk(child, path === "" ? name : `${path}.${name}`, depth + 1, out);
  }
}

export function documentedResponseFields(operation: ApiOperation): { fields: DocumentedResponseField[]; truncated: boolean } {
  const byPath = new Map<string, { type: string | null; statusCodes: Set<string> }>();
  for (const response of operation.responses) {
    if (!SUCCESS.test(response.statusCode)) continue;
    for (const [mediaType, schema] of Object.entries(response.contentTypes)) {
      if (!isJsonMediaType(mediaType)) continue;
      const found = new Map<string, string | null>();
      walk(schema, "", 0, found);
      for (const [path, type] of found) {
        const entry = byPath.get(path) ?? { type, statusCodes: new Set<string>() };
        entry.statusCodes.add(response.statusCode);
        byPath.set(path, entry);
      }
    }
  }
  const all = [...byPath.entries()]
    .map(([path, entry]) => ({ path, type: entry.type, statusCodes: [...entry.statusCodes].sort(compareCodeUnits) }))
    .sort((a, b) => compareCodeUnits(a.path, b.path));
  return { fields: all.slice(0, MAX_RESPONSE_FIELDS), truncated: all.length > MAX_RESPONSE_FIELDS };
}
