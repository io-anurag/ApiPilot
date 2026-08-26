import SwaggerParser from "@apidevtools/swagger-parser";
import type { AnalysisIssue } from "@apipilot/shared-domain";
import { UnsupportedVersionError } from "./errors";

export interface ValidatedSpec {
  document: Record<string, unknown>;
  issues: AnalysisIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Safeguard against adversarially deep (non-circular) document nesting consuming
 * unbounded stack/CPU while walking the raw document (FR-006 "safety"; OWASP
 * resource-exhaustion hardening). Walking simply stops past this depth.
 */
const MAX_WALK_DEPTH = 100;

/**
 * Recursively strips external (non "#/...") $ref pointers, recording each as an
 * unresolved-ref issue. This guarantees swagger-parser never attempts to fetch an
 * external file/URL (FR-006; constitution XVII).
 */
function stripExternalRefs(node: unknown, path: string, issues: AnalysisIssue[], depth = 0): unknown {
  if (depth >= MAX_WALK_DEPTH) {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item, i) => stripExternalRefs(item, `${path}/${i}`, issues, depth + 1));
  }
  if (isPlainObject(node)) {
    if (typeof node.$ref === "string" && !node.$ref.startsWith("#/")) {
      issues.push({
        kind: "unresolved-ref",
        location: path,
        message: `External reference is not resolved: ${node.$ref}`,
      });
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key !== "$ref") rest[key] = value;
      }
      return rest;
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      result[key] = stripExternalRefs(value, `${path}/${key}`, issues, depth + 1);
    }
    return result;
  }
  return node;
}

/**
 * With `dereference.circular: "ignore"`, swagger-parser leaves the specific $ref
 * pointer that would close a cycle unresolved instead of throwing or building an
 * actual circular object graph. Any internal $ref still present after a successful
 * dereference is therefore exactly a circular reference closure point (FR-006).
 */
function detectCircularRefs(node: unknown, path: string, issues: AnalysisIssue[], depth = 0): void {
  if (depth >= MAX_WALK_DEPTH) {
    return;
  }
  if (!isPlainObject(node) && !Array.isArray(node)) {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => detectCircularRefs(item, `${path}/${i}`, issues, depth + 1));
    return;
  }
  if (typeof node.$ref === "string") {
    issues.push({
      kind: "circular-ref",
      location: path,
      message: `Circular reference chain detected: ${node.$ref}`,
    });
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    detectCircularRefs(value, `${path}/${key}`, issues, depth + 1);
  }
}

/**
 * Validates OpenAPI version (FR-003, FR-004), resolves internal $refs (FR-005), and
 * detects unresolved/circular/external refs, recording each as an issue instead of
 * rejecting the upload (FR-006).
 */
export async function validateSpec(rawDoc: unknown): Promise<ValidatedSpec> {
  if (!isPlainObject(rawDoc)) {
    throw new UnsupportedVersionError(
      "Only OpenAPI 3.x documents are supported; found: an empty or non-object document",
    );
  }

  const version = typeof rawDoc.openapi === "string" ? rawDoc.openapi : undefined;
  if (!version || !version.startsWith("3.")) {
    const found =
      version ?? (typeof rawDoc.swagger === "string" ? `Swagger ${rawDoc.swagger}` : "an unrecognized document");
    throw new UnsupportedVersionError(`Only OpenAPI 3.x documents are supported; found: ${found}`);
  }

  const issues: AnalysisIssue[] = [];
  const stripped = stripExternalRefs(rawDoc, "#", issues) as Record<string, unknown>;

  let dereferenced: unknown = stripped;
  try {
    dereferenced = await SwaggerParser.dereference(
      // swagger-parser mutates and returns the same document graph.
      stripped as unknown as Parameters<typeof SwaggerParser.dereference>[0],
      { dereference: { circular: "ignore" }, resolve: { external: false } },
    );
    detectCircularRefs(dereferenced, "#", issues);
  } catch (err) {
    issues.push({
      kind: "unresolved-ref",
      location: "#",
      message: err instanceof Error ? err.message : String(err),
    });
    dereferenced = stripped;
  }

  return { document: dereferenced as Record<string, unknown>, issues };
}
