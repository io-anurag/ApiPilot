import type {
  AIValidationFinding,
  AIScenarioCandidate,
  ApiModel,
  SchemaConstraint,
  ScenarioCategory,
} from "@apipilot/shared-domain";
import { SCENARIO_CATEGORIES } from "@apipilot/shared-domain";
import { isCandidateShape } from "./parseAIScenarioResponse";
import { primaryRequestBodySchema, walkFields } from "./requestHelpers";

/**
 * Re-exported from shared-domain, where the vocabulary now lives so the AI prompt can enumerate the
 * same list without importing this module — which would close a cycle through
 * `parseAIScenarioResponse` (specs/014-ai-batching-policy).
 */
export const SUPPORTED_AI_CATEGORIES: readonly ScenarioCategory[] = SCENARIO_CATEGORIES;

/**
 * Validates an AI candidate's structural shape independent of the ApiModel: a non-empty string
 * `candidateId` (`invalid-candidate-id`), a numeric `confidence` (`invalid-confidence`), the other
 * field types (`invalid-shape`), category support, a non-empty rationale, and a confidence inside the
 * documented inclusive bound [0, 1] (`low-confidence`). Returns one finding per problem, or an empty
 * array when the candidate is well-formed.
 *
 * Confidence policy (specs/005 FR-014): the bound is the only rule. No minimum threshold is applied,
 * because the specification defines none; a candidate whose confidence is missing, not a number, or
 * outside [0, 1] is rejected, and any other confidence is retained as the model's own claim in the
 * candidate's AI provenance, never promoted to specification truth. Uniqueness of `candidateId` is
 * enforced across the whole run by the enhancement pipeline (`duplicate`), which sees every response.
 */
export function validateAICandidateShape(value: unknown): AIValidationFinding[] {
  const record = isRecord(value) ? value : undefined;
  const hasValidId =
    typeof record?.candidateId === "string" && record.candidateId.trim().length > 0;
  const hasNumericConfidence = typeof record?.confidence === "number";
  const candidateId = typeof record?.candidateId === "string" ? record.candidateId : "unknown";
  const findings: AIValidationFinding[] = [];
  if (record && !hasValidId) {
    findings.push({
      code: "invalid-candidate-id",
      message: "Candidate ID must be a non-empty string",
      candidateId,
      path: "candidateId",
      executable: false,
    });
  }
  if (record && !hasNumericConfidence) {
    findings.push({
      code: "invalid-confidence",
      message: "Candidate confidence must be a number between 0 and 1",
      candidateId,
      path: "confidence",
      executable: false,
    });
  }
  // Probe the remaining structure with the two fields reported above neutralised, so each defect is
  // reported once under its specific code rather than also as a generic invalid-shape.
  const probe = record
    ? {
        ...record,
        candidateId: hasValidId ? record.candidateId : "unknown",
        confidence: hasNumericConfidence ? record.confidence : 0,
      }
    : value;
  if (!isCandidateShape(probe)) {
    findings.push({
      code: "invalid-shape",
      message: "Candidate does not match the supported structure",
      candidateId,
      executable: false,
    });
    return findings;
  }
  const candidate = probe;
  if (!SUPPORTED_AI_CATEGORIES.includes(candidate.category)) {
    findings.push({
      code: "unsupported-category",
      message: "Candidate category is not supported",
      candidateId,
      path: "category",
      executable: false,
    });
  }
  if (candidate.rationale.trim().length === 0) {
    findings.push({
      code: "missing-rationale",
      message: "Candidate rationale must be non-empty",
      candidateId,
      path: "rationale",
      executable: false,
    });
  }
  if (
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    findings.push({
      code: "low-confidence",
      message: "Candidate confidence must be between 0 and 1",
      candidateId,
      path: "confidence",
      executable: false,
    });
  }
  findings.push(...validateCandidateStructure(candidate, candidateId));
  return findings;
}

const ASSERTION_TYPES = ["status-code", "schema-conformance"];

/**
 * Checks the nested structure `isCandidateShape` leaves unchecked, so semantic validation can rely on
 * it without throwing on a malformed provider response: the three request parameter maps, every
 * assertion (a supported type carrying the content that type needs), and string-only assumptions.
 */
function validateCandidateStructure(
  candidate: AIScenarioCandidate,
  candidateId: string,
): AIValidationFinding[] {
  const findings: AIValidationFinding[] = [];
  const invalid = (path: string, message: string): void => {
    findings.push({ code: "invalid-shape", message, candidateId, path, executable: false });
  };
  for (const key of ["pathParameters", "queryParameters", "headers"] as const) {
    if (!isRecord(candidate.request[key])) {
      invalid(`request.${key}`, `Candidate request.${key} must be an object`);
    }
  }
  candidate.assertions.forEach((assertion: unknown, index) => {
    const path = `assertions[${index}]`;
    if (!isRecord(assertion) || !ASSERTION_TYPES.includes(String(assertion.type))) {
      invalid(path, "Candidate assertion must be a supported assertion type");
    } else if (
      assertion.type === "status-code" &&
      (typeof assertion.expectedStatusCode !== "string" ||
        assertion.expectedStatusCode.length === 0)
    ) {
      invalid(path, "Candidate status-code assertion requires expectedStatusCode");
    } else if (assertion.type === "schema-conformance" && !isRecord(assertion.expectedSchema)) {
      invalid(path, "Candidate schema-conformance assertion requires expectedSchema");
    }
  });
  if (!candidate.assumptions.every((assumption) => typeof assumption === "string")) {
    invalid("assumptions", "Candidate assumptions must all be strings");
  }
  return findings;
}

/** Validates an AI candidate against the ApiModel it claims to target: the operation, parameter/body field references, and assertion status codes/schemas must all exist in the specification. Returns one finding per unsupported reference, or an empty array when everything resolves. */
export function validateAICandidateSemantics(
  candidate: AIScenarioCandidate,
  apiModel: ApiModel,
): AIValidationFinding[] {
  const findings: AIValidationFinding[] = [];
  const operation = apiModel.operations.find(
    (item) =>
      item.path === candidate.operationPath &&
      item.method.toUpperCase() === candidate.operationMethod.toUpperCase(),
  );
  if (!operation) {
    const pathExists = apiModel.operations.some(
      (item) => item.path === candidate.operationPath,
    );
    findings.push({
      code: pathExists ? "method-not-found" : "operation-not-found",
      message: "Candidate references an unknown API operation",
      candidateId: candidate.candidateId,
      path: "operationPath",
      executable: false,
    });
    return findings;
  }
  if (candidate.targetLocation && candidate.targetLocation !== "body") {
    const parameter = operation.parameters.find(
      (item) =>
        item.location === candidate.targetLocation && item.name === candidate.targetField,
    );
    if (!parameter)
      findings.push({
        code: "field-not-found",
        message: "Candidate references an unknown operation parameter",
        candidateId: candidate.candidateId,
        path: "targetField",
        executable: false,
      });
  } else if (candidate.targetLocation === "body") {
    const bodySchema = primaryRequestBodySchema(operation);
    const bodyFieldExists = Boolean(
      bodySchema &&
      candidate.targetField &&
      [...walkFields(bodySchema)].some((field) => field.path === candidate.targetField),
    );
    if (!bodyFieldExists) {
      findings.push({
        code: "field-not-found",
        message: "Candidate references an unknown request-body field",
        candidateId: candidate.candidateId,
        path: "targetField",
        executable: false,
      });
    }
  }
  if (candidate.targetField && !candidate.targetLocation) {
    findings.push({
      code: "field-not-found",
      message: "Candidate targetField requires a targetLocation",
      candidateId: candidate.candidateId,
      path: "targetLocation",
      executable: false,
    });
  }
  // HTTP header names are case-insensitive; every other location is matched exactly.
  const parameterKey = (location: string, name: string): string =>
    `${location}:${location === "header" ? name.toLowerCase() : name}`;
  const allowedParameters = new Set(
    operation.parameters.map((parameter) => parameterKey(parameter.location, parameter.name)),
  );
  const requestParameters: ["path" | "query" | "header", Record<string, unknown>][] = [
    ["path", candidate.request.pathParameters],
    ["query", candidate.request.queryParameters],
    ["header", candidate.request.headers],
  ];
  for (const [location, values] of requestParameters) {
    for (const name of Object.keys(values)) {
      if (!allowedParameters.has(parameterKey(location, name))) {
        findings.push({
          code: "field-not-found",
          message: `Candidate request references an unknown ${location} parameter`,
          candidateId: candidate.candidateId,
          path: `request.${location}Parameters.${name}`,
          executable: false,
        });
      }
    }
  }
  const bodySchema = primaryRequestBodySchema(operation);
  if (bodySchema) {
    addUnknownBodyFields(
      candidate.request.body,
      bodySchema,
      "request.body",
      candidate.candidateId,
      findings,
    );
  }
  for (const assertion of candidate.assertions) {
    if (
      assertion.expectedStatusCode &&
      !operation.responses.some(
        (response) => response.statusCode === assertion.expectedStatusCode,
      )
    ) {
      findings.push({
        code: "undocumented-status-code",
        message: "Candidate assertion uses an undocumented status code",
        candidateId: candidate.candidateId,
        path: "assertions",
        executable: false,
      });
    }
    if (assertion.expectedSchema) {
      const response = operation.responses.find(
        (item) => item.statusCode === assertion.expectedStatusCode,
      );
      const documentedSchemas = response ? Object.values(response.contentTypes) : [];
      if (
        !documentedSchemas.some(
          (schema) => JSON.stringify(schema) === JSON.stringify(assertion.expectedSchema),
        )
      ) {
        findings.push({
          code: "schema-not-found",
          message: "Candidate assertion uses an undocumented response schema",
          candidateId: candidate.candidateId,
          path: "assertions.expectedSchema",
          executable: false,
        });
      }
    }
  }
  return findings;
}

function addUnknownBodyFields(
  value: unknown,
  schema: SchemaConstraint,
  path: string,
  candidateId: string,
  findings: AIValidationFinding[],
): void {
  if (Array.isArray(value)) {
    if (schema.items) {
      const itemSchema = schema.items;
      value.forEach((item, index) =>
        addUnknownBodyFields(item, itemSchema, `${path}[${index}]`, candidateId, findings),
      );
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nestedValue] of Object.entries(value)) {
    const childSchema = schema.properties[key];
    if (!childSchema) {
      findings.push({
        code: "field-not-found",
        message: "Candidate request references an unknown request-body field",
        candidateId,
        path: `${path}.${key}`,
        executable: false,
      });
      continue;
    }
    addUnknownBodyFields(nestedValue, childSchema, `${path}.${key}`, candidateId, findings);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
