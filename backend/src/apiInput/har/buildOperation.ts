import { createHash } from "node:crypto";
import type {
  AnalysisIssue,
  ApiOperation,
  BodyUnavailableReason,
  Parameter,
  RequestBody,
  Response as ApiResponse,
  SchemaConstraint,
  SchemaEvidence,
} from "@apipilot/shared-domain";
import { toPlainRecord } from "../jsonSafe";
import { provenanceOf } from "./confidence";
import type { OperationGroup } from "./mergeObservations";

/**
 * Turns one merged operation into an `ApiOperation` (specs/056 FR-014 to FR-017, FR-028). Every fact
 * is labelled observed or inferred with how often it was seen; nothing that was not observed (a
 * status, field, scheme or requirement) is added, and unknown values are marked unknown.
 */

const EMPTY_SCHEMA: SchemaConstraint = { required: [], properties: {} };

const UNSUPPORTED_REASONS: ReadonlySet<BodyUnavailableReason> = new Set([
  "binary", "compressed", "undecodable-encoding", "oversized", "too-deep", "multipart-file", "not-json",
]);

const REASON_TEXT: Record<BodyUnavailableReason, string> = {
  binary: "the body is binary content",
  compressed: "the body is compressed and ApiPilot does not decompress it",
  "undecodable-encoding": "the body uses an encoding other than base64",
  oversized: "the body is larger than the analyzed body size limit",
  "too-deep": "the body is nested deeper than the supported depth",
  "multipart-file": "the multipart request includes a file part that cannot be reproduced",
  "not-json": "the body is not JSON, form or multipart data",
  missing: "a body was expected but is missing from the capture",
  empty: "the capture holds an empty body where one was sent",
  truncated: "the body in the capture is cut short",
  "invalid-json": "the body claims to be JSON but does not parse",
};

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function countSchemaNodes(schema: SchemaConstraint): number {
  let count = 1;
  for (const child of Object.values(schema.properties)) count += countSchemaNodes(child);
  if (schema.items) count += countSchemaNodes(schema.items);
  return count;
}

/** Stable, deterministic key of an operation: the first 12 hex characters of sha256(origin|METHOD|path). */
export function operationKeyOf(origin: string, method: string, path: string): string {
  return createHash("sha256").update(`${origin}|${method}|${path}`).digest("hex").slice(0, 12);
}

export interface BuiltOperation {
  operation: ApiOperation;
  issues: AnalysisIssue[];
  /** Schema nodes inferred for this operation (for the model summary). */
  schemaCount: number;
}

export function buildOperation(group: OperationGroup): BuiltOperation {
  const location = `${group.method} ${group.path}`;
  const issues: AnalysisIssue[] = [];
  let schemaCount = 0;

  // Request body shapes.
  const requestContentTypes: Record<string, SchemaConstraint> = {};
  const requestBodyEvidence: Record<string, SchemaEvidence> = {};
  for (const [contentType, inferrer] of [...group.requestEvidence].sort((a, b) => compare(a[0], b[0]))) {
    const built = inferrer.build();
    requestContentTypes[contentType] = built.schema;
    requestBodyEvidence[contentType] = built.evidence;
    schemaCount += countSchemaNodes(built.schema);
    for (const field of built.conflicts) {
      issues.push({
        kind: "conflicting-types",
        location,
        message: `Field "${field}" in the request body (${contentType}) was observed with conflicting types, so no type was inferred for it.`,
      });
    }
  }

  // Response shapes, kept separately per status.
  const responses: ApiResponse[] = [];
  const responseBodyEvidence: Record<string, Record<string, SchemaEvidence>> = {};
  for (const status of Object.keys(group.statusCounts)) {
    const count = group.statusCounts[status];
    const contentTypes: Record<string, SchemaConstraint> = {};
    const evidenceByType: Record<string, SchemaEvidence> = {};
    const inferrers = group.responseEvidence.get(status);
    for (const [contentType, inferrer] of [...(inferrers ?? [])].sort((a, b) => compare(a[0], b[0]))) {
      const built = inferrer.build();
      contentTypes[contentType] = built.schema;
      evidenceByType[contentType] = built.evidence;
      schemaCount += countSchemaNodes(built.schema);
      for (const field of built.conflicts) {
        issues.push({
          kind: "conflicting-types",
          location,
          message: `Field "${field}" in the ${status} response (${contentType}) was observed with conflicting types, so no type was inferred for it.`,
        });
      }
    }
    if (Object.keys(evidenceByType).length > 0) responseBodyEvidence[status] = evidenceByType;
    const unavailable = group.responseUnavailable.get(status);
    responses.push({
      statusCode: status,
      description: "",
      contentTypes,
      examples: group.responseExamples.has(status) ? { observed: group.responseExamples.get(status) } : {},
      provenance: provenanceOf("observed", count),
      ...(unavailable ? { bodyUnavailable: unavailable } : {}),
    });
  }

  // Parameters.
  const parameters: Parameter[] = [];
  for (const decision of [...group.parameters].sort((a, b) => a.position - b.position)) {
    const digitsOnly = decision.exampleValues.length > 0 && decision.exampleValues.every((value) => /^\d+$/.test(value));
    parameters.push({
      name: decision.name,
      location: "path",
      required: true,
      schema: { type: digitsOnly ? "integer" : "string", required: [], properties: {} },
      provenance: provenanceOf("inferred", decision.distinctValues),
    });
  }
  for (const [name, count] of Object.entries(group.queryParameterCounts)) {
    parameters.push({
      name,
      location: "query",
      required: false,
      requiredUnknown: true,
      schema: { ...EMPTY_SCHEMA },
      provenance: provenanceOf("observed", count),
    });
  }
  for (const [name, count] of Object.entries(group.headerCounts)) {
    if (name === "content-type") continue;
    parameters.push({
      name,
      location: "header",
      required: false,
      requiredUnknown: true,
      schema: { ...EMPTY_SCHEMA },
      provenance: provenanceOf("observed", count),
    });
  }

  // Request body (only when at least one body shape was seen).
  let requestBody: RequestBody | undefined;
  if (Object.keys(requestContentTypes).length > 0) {
    const bodyCount = [...group.requestBodyObservations.values()].reduce((sum, n) => sum + n, 0);
    const examples: Record<string, unknown> = {};
    group.examples.forEach((example) => {
      if (example.body !== undefined && Object.keys(examples).length < 5) examples[`observed-${Object.keys(examples).length + 1}`] = example.body;
    });
    requestBody = {
      required: false,
      requiredUnknown: true,
      contentTypes: requestContentTypes,
      provenance: provenanceOf("observed", bodyCount),
      ...(Object.keys(examples).length > 0 ? { examples } : {}),
    };
  }

  // Findings about content, grouped by direction and reason, never carrying a value.
  for (const item of group.unavailable) {
    const noun = item.count === 1 ? "body" : "bodies";
    const message = `${item.count} ${item.direction} ${noun} could not be used: ${REASON_TEXT[item.reason]}.`;
    issues.push({ kind: UNSUPPORTED_REASONS.has(item.reason) ? "unsupported-content" : "incomplete-observation", location, message });
  }
  if (group.duplicateFormFieldEntries > 0) {
    issues.push({
      kind: "incomplete-observation",
      location,
      message: `${group.duplicateFormFieldEntries} form-encoded request(s) repeated a field name; only the first value of each was kept.`,
    });
  }
  for (const ambiguous of group.ambiguous) {
    issues.push({
      kind: "ambiguous-path",
      location,
      message: `Segment ${ambiguous.position + 1} of "${group.path}" looks like an identifier but was seen with only one distinct value across ${group.observationCount} observation(s), so it was kept literal: one value is not enough evidence for a path parameter.`,
    });
  }
  if (group.credentials.length > 0) {
    const described = [...new Set(group.credentials.map((c) => `${c.kind} in ${c.location}`))].join(", ");
    issues.push({
      kind: "credential-detected",
      location,
      message: `Credentials were seen (${described}) and replaced with placeholders; no value was kept. Supply real values through an environment when you run the tests.`,
    });
  }

  const operation: ApiOperation = {
    path: group.path,
    method: group.method,
    operationId: undefined,
    parameters,
    requestBody,
    responses,
    security: [],
    tags: [],
    provenance: provenanceOf("observed", group.observationCount, issues.every((issue) => issue.kind !== "conflicting-types")),
    observed: {
      key: operationKeyOf(group.origin, group.method, group.path),
      origin: group.origin,
      observationCount: group.observationCount,
      statusCounts: group.statusCounts,
      pathParameters: group.parameters
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((decision) => ({
          name: decision.name,
          position: decision.position,
          distinctValues: decision.distinctValues,
          exampleValues: decision.exampleValues,
          provenance: provenanceOf("inferred", decision.distinctValues),
        })),
      queryParameterCounts: group.queryParameterCounts,
      headerCounts: group.headerCounts,
      requestExamples: group.examples.map(({ order: _order, ...example }) => example),
      droppedExampleCount: group.droppedExampleCount,
      requestBodyEvidence: toPlainRecord(requestBodyEvidence),
      responseBodyEvidence: toPlainRecord(responseBodyEvidence),
      unavailableBodies: group.unavailable,
      credentialsObserved: group.credentials.map((c) => ({
        location: c.location as "header" | "query" | "cookie" | "body" | "url-userinfo" | "path",
        name: c.name,
        kind: c.kind as "token" | "apiKey" | "password" | "cookie" | "session",
        observations: c.observations,
      })),
    },
  };
  return { operation, issues, schemaCount };
}
