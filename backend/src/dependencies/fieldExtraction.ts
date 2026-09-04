import type {
  ApiOperation,
  FieldRef,
  SchemaConstraint,
  SecuritySchemeDefinition,
} from "@apipilot/shared-domain";
import { primaryRequestBodySchema, walkFields } from "../testDesign/requestHelpers";

const SUCCESS_STATUS_PATTERN = /^2\d\d$/;

function dedupeFieldRefs(fields: FieldRef[]): FieldRef[] {
  const seen = new Set<string>();
  const result: FieldRef[] = [];
  for (const field of fields) {
    const key = `${field.operationPath}|${field.operationMethod}|${field.field}|${field.location ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(field);
  }
  return result;
}

/**
 * Extracts candidate producer fields from an operation's 2xx response schemas only (research.md:
 * only successful responses represent real resource data worth handing off). Reuses `walkFields`
 * so a nested identifier (e.g. `user.id`) is discovered as a dotted path to the same bounded
 * depth every other feature already trusts.
 */
export function extractProducerFields(operation: ApiOperation): FieldRef[] {
  const fields: FieldRef[] = [];
  for (const response of operation.responses) {
    if (!SUCCESS_STATUS_PATTERN.test(response.statusCode)) continue;
    for (const schema of Object.values(response.contentTypes)) {
      for (const entry of walkFields(schema)) {
        fields.push({ operationPath: operation.path, operationMethod: operation.method, field: entry.path });
      }
    }
  }
  return dedupeFieldRefs(fields);
}

/**
 * Maps each producer candidate field path to its schema, for type/format lookup during matching.
 * Kept separate from `extractProducerFields` so that function's tested public shape stays a plain
 * `FieldRef` list; deterministic matching is the only consumer that needs the underlying schema.
 */
export function producerFieldSchemas(operation: ApiOperation): Map<string, SchemaConstraint> {
  const schemas = new Map<string, SchemaConstraint>();
  for (const response of operation.responses) {
    if (!SUCCESS_STATUS_PATTERN.test(response.statusCode)) continue;
    for (const contentSchema of Object.values(response.contentTypes)) {
      for (const entry of walkFields(contentSchema)) {
        if (!schemas.has(entry.path)) schemas.set(entry.path, entry.schema);
      }
    }
  }
  return schemas;
}

/** Maps each consumer candidate field path to its schema, for type/format lookup during matching. */
export function consumerFieldSchemas(operation: ApiOperation): Map<string, SchemaConstraint> {
  const schemas = new Map<string, SchemaConstraint>();
  for (const parameter of operation.parameters) {
    if (parameter.location === "cookie") continue;
    if (!schemas.has(parameter.name)) schemas.set(parameter.name, parameter.schema);
  }
  const bodySchema = primaryRequestBodySchema(operation);
  if (bodySchema) {
    for (const entry of walkFields(bodySchema)) {
      if (!schemas.has(entry.path)) schemas.set(entry.path, entry.schema);
    }
  }
  return schemas;
}

/** Whether `parameter` duplicates a declared apiKey security requirement for `operation`. */
function isSecurityCoveredParameter(
  operation: ApiOperation,
  parameterName: string,
  parameterLocation: string,
  securitySchemes: Record<string, SecuritySchemeDefinition>,
): boolean {
  return operation.security.some((requirement) =>
    requirement.schemes.some(({ name }) => {
      const scheme = securitySchemes[name];
      return scheme?.type === "apiKey" && scheme.in === parameterLocation && scheme.name === parameterName;
    }),
  );
}

/**
 * Extracts candidate consumer fields: path/query/header parameters (excluding any that duplicate
 * a declared security requirement, and cookie parameters, which this feature's confidence model
 * does not address) plus request-body fields via `walkFields`.
 */
export function extractConsumerFields(
  operation: ApiOperation,
  securitySchemes: Record<string, SecuritySchemeDefinition>,
): FieldRef[] {
  const fields: FieldRef[] = [];
  for (const parameter of operation.parameters) {
    if (parameter.location === "cookie") continue;
    if (isSecurityCoveredParameter(operation, parameter.name, parameter.location, securitySchemes)) continue;
    fields.push({
      operationPath: operation.path,
      operationMethod: operation.method,
      field: parameter.name,
      location: parameter.location,
    });
  }
  const bodySchema = primaryRequestBodySchema(operation);
  if (bodySchema) {
    for (const entry of walkFields(bodySchema)) {
      fields.push({
        operationPath: operation.path,
        operationMethod: operation.method,
        field: entry.path,
        location: "body",
      });
    }
  }
  return dedupeFieldRefs(fields);
}
