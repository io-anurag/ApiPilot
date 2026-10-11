import { createHash } from "node:crypto";
import type { ApiModel } from "@apipilot/shared-domain";

/** JSON with object keys sorted, so identical content always serializes identically. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Short stable fingerprint of any JSON-like fragment (used for each requirement's `contractHash`). */
export function fragmentHash(value: unknown): string {
  return sha256(stableStringify(value)).slice(0, 16);
}

/**
 * SHA-256 of the normalized contract: operations (sorted by method and path), parameters, request
 * bodies, responses, security requirements and security schemes. `info.title`/`info.version` and
 * the analysis summary are excluded, so a version-string bump alone does not change the revision
 * while a contract change does (specs/046 research R4).
 */
export function specificationRevision(apiModel: ApiModel): string {
  const operations = [...apiModel.operations]
    .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`))
    .map((operation) => ({
      method: operation.method,
      path: operation.path,
      parameters: operation.parameters,
      requestBody: operation.requestBody,
      responses: operation.responses.map(({ statusCode, contentTypes }) => ({ statusCode, contentTypes })),
      security: operation.security,
    }));
  return sha256(stableStringify({ operations, securitySchemes: apiModel.securitySchemes }));
}
