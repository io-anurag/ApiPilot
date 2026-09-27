import type { ApiOperation, SchemaConstraint } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { primaryRequestBodySchema } from "../../testDesign/requestHelpers";

/**
 * FR-016 (specs/031-k6-performance-testing research D13): the body fields made unique per virtual
 * user and iteration. Only string fields declared `format: email` or `format: uuid` in a POST
 * request body qualify. OpenAPI has no uniqueness keyword, and guessing further (for example from
 * field names) would be a silent assumption (constitution XIV).
 */
export interface UniqueFieldCandidate {
  fieldPath: string;
  format: "email" | "uuid";
}

function walk(schema: SchemaConstraint, prefix: string, out: UniqueFieldCandidate[]): void {
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const fieldPath = prefix ? `${prefix}.${name}` : name;
    if (property.type === "string" && (property.format === "email" || property.format === "uuid")) {
      out.push({ fieldPath, format: property.format });
    }
    if (property.type === "object" || Object.keys(property.properties ?? {}).length > 0) walk(property, fieldPath, out);
  }
}

function hasField(body: unknown, fieldPath: string): boolean {
  let current: unknown = body;
  for (const part of fieldPath.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current) || !(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string";
}

/** The operation's unique-value fields that the scenario's body actually carries, in code-unit order. */
export function uniqueValueCandidates(operation: ApiOperation, scenarioBody: unknown): UniqueFieldCandidate[] {
  if (operation.method.toUpperCase() !== "POST") return [];
  const schema = primaryRequestBodySchema(operation);
  if (!schema) return [];
  const out: UniqueFieldCandidate[] = [];
  walk(schema, "", out);
  return out
    .filter((candidate) => hasField(scenarioBody, candidate.fieldPath))
    .sort((a, b) => compareCodeUnits(a.fieldPath, b.fieldPath));
}
