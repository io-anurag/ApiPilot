import type { ApiOperation, GeneratedRequest, SchemaConstraint } from "@apipilot/shared-domain";
import { conformantValue } from "./valueGenerators";

/** Mirrors buildApiModel.ts's MAX_SCHEMA_DEPTH safeguard for this feature's own recursive traversal (T037). */
export const MAX_TRAVERSAL_DEPTH = 50;

/** One named, recursively-discovered request-body field. */
export interface FieldEntry {
  path: string;
  schema: SchemaConstraint;
  required: boolean;
}

/** Recursively walks object-typed schema properties, yielding every nested field path (e.g. "address.zipCode"). */
export function* walkFields(
  schema: SchemaConstraint,
  basePath = "",
  depth = 0,
): Generator<FieldEntry> {
  if (depth >= MAX_TRAVERSAL_DEPTH) return;
  for (const [name, childSchema] of Object.entries(schema.properties)) {
    const path = basePath ? `${basePath}.${name}` : name;
    const required = schema.required.includes(name);
    yield { path, schema: childSchema, required };
    if (childSchema.type === "object" || Object.keys(childSchema.properties).length > 0) {
      yield* walkFields(childSchema, path, depth + 1);
    }
  }
}

/** Picks the request body content-type schema to generate values from (prefers application/json). */
export function primaryRequestBodySchema(operation: ApiOperation): SchemaConstraint | undefined {
  const contentTypes = operation.requestBody?.contentTypes;
  if (!contentTypes) return undefined;
  return contentTypes["application/json"] ?? Object.values(contentTypes)[0];
}

/** Builds a fully specification-conformant request for `operation` (used as the base for every mutation). */
export function buildConformantRequest(operation: ApiOperation): GeneratedRequest {
  const request: GeneratedRequest = { pathParameters: {}, queryParameters: {}, headers: {} };
  for (const parameter of operation.parameters) {
    const value = conformantValue(parameter.schema);
    if (parameter.location === "path") request.pathParameters[parameter.name] = value;
    else if (parameter.location === "query") request.queryParameters[parameter.name] = value;
    else if (parameter.location === "header") request.headers[parameter.name] = value;
  }
  const bodySchema = primaryRequestBodySchema(operation);
  if (bodySchema) request.body = conformantValue(bodySchema);
  return request;
}

/** Deep-clones a GeneratedRequest so rule modules can mutate a single field without affecting the base. */
export function cloneRequest(request: GeneratedRequest): GeneratedRequest {
  return structuredClone(request);
}

/** Sets the value at a dotted path inside `body`, creating intermediate objects as needed. */
export function setAtPath(body: unknown, path: string, value: unknown): unknown {
  const segments = path.split(".");
  const root: Record<string, unknown> = typeof body === "object" && body !== null ? { ...(body as object) } : {};
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = cursor[segment];
    cursor[segment] = typeof next === "object" && next !== null ? { ...(next as object) } : {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1) as string] = value;
  return root;
}

/** Deletes the value at a dotted path inside `body`, leaving other fields untouched. */
export function deleteAtPath(body: unknown, path: string): unknown {
  const segments = path.split(".");
  const root: Record<string, unknown> = typeof body === "object" && body !== null ? { ...(body as object) } : {};
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = cursor[segment];
    if (typeof next !== "object" || next === null) return root;
    cursor[segment] = { ...(next as object) };
    cursor = cursor[segment] as Record<string, unknown>;
  }
  delete cursor[segments.at(-1) as string];
  return root;
}
