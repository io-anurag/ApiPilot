import type { ApiModel, ApiOperation, SchemaConstraint } from "@apipilot/shared-domain";
import { hash16 } from "../canonical";
import { walkProperties } from "./sensitivity";

/**
 * A per-operation fingerprint of what a scenario depends on (specs/057 research R3): the effective requirement and how
 * it was reached, the schemes involved, `deprecated`, the property flags (`readOnly`, `writeOnly`, `format: password`)
 * of the request and response schemas, and the operation's request and response **contract** (its parameters, request
 * body and documented responses), because an input-validation scenario is wrong if a field it violates changes. The
 * coverage revision ignores several of these. Hashing per operation, not for the whole specification, keeps an
 * unrelated edit from invalidating every approval. Descriptions, tags and examples are not part of it.
 */

type Flag = [path: string, readOnly: boolean, writeOnly: boolean, password: boolean];

function flagsOf(schemas: SchemaConstraint[]): Flag[] {
  const flags: Flag[] = [];
  for (const schema of schemas) {
    for (const property of walkProperties(schema)) {
      const { readOnly, writeOnly, format } = property.constraint;
      if (readOnly === true || writeOnly === true || format === "password") {
        flags.push([property.path, readOnly === true, writeOnly === true, format === "password"]);
      }
    }
  }
  return flags.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function securityBasisHash(apiModel: ApiModel, operation: ApiOperation): string {
  const schemeNames = [...new Set(operation.security.flatMap((entry) => entry.schemes.map((scheme) => scheme.name)))].sort();
  return hash16({
    source: operation.securitySource ?? null,
    security: operation.security,
    root: operation.securitySource === "root" ? (apiModel.rootSecurity ?? null) : null,
    deprecated: operation.deprecated ?? null,
    schemes: schemeNames.map((name) => {
      const definition = apiModel.securitySchemes[name];
      return [name, definition?.type ?? null, definition?.scheme ?? null, definition?.in ?? null, definition?.name ?? null];
    }),
    contract: {
      parameters: operation.parameters,
      requestBody: operation.requestBody ? { required: operation.requestBody.required, contentTypes: operation.requestBody.contentTypes } : null,
      responses: operation.responses.map((response) => [response.statusCode, response.contentTypes]),
    },
    request: flagsOf(Object.values(operation.requestBody?.contentTypes ?? {})),
    responses: flagsOf(operation.responses.flatMap((response) => Object.values(response.contentTypes))),
  });
}

/** Basis hashes by operation key (`"METHOD /path"`). */
export function basisHashes(apiModel: ApiModel): Map<string, string> {
  return new Map(
    apiModel.operations.map((operation) => [`${operation.method.toUpperCase()} ${operation.path}`, securityBasisHash(apiModel, operation)]),
  );
}
