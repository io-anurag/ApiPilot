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

/** Validates an AI candidate's structural shape independent of the ApiModel: field types (via `isCandidateShape`), category support, non-empty rationale, and a confidence in [0,1]. Returns one finding per problem, or an empty array when the candidate is well-formed. */
export function validateAICandidateShape(value: unknown): AIValidationFinding[] {
  const candidateId =
    isRecord(value) && typeof value.candidateId === "string"
      ? value.candidateId
      : "unknown";
  const findings: AIValidationFinding[] = [];
  if (!isCandidateShape(value)) {
    findings.push({
      code: "invalid-shape",
      message: "Candidate does not match the supported structure",
      candidateId,
      executable: false,
    });
    return findings;
  }
  if (!SUPPORTED_AI_CATEGORIES.includes(value.category)) {
    findings.push({
      code: "unsupported-category",
      message: "Candidate category is not supported",
      candidateId,
      path: "category",
      executable: false,
    });
  }
  if (value.rationale.trim().length === 0) {
    findings.push({
      code: "missing-rationale",
      message: "Candidate rationale must be non-empty",
      candidateId,
      path: "rationale",
      executable: false,
    });
  }
  if (
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    findings.push({
      code: "low-confidence",
      message: "Candidate confidence must be between 0 and 1",
      candidateId,
      path: "confidence",
      executable: false,
    });
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
  const allowedParameters = new Map(
    operation.parameters.map((parameter) => [
      parameter.location,
      new Set(
        operation.parameters
          .filter((item) => item.location === parameter.location)
          .map((item) => item.name),
      ),
    ]),
  );
  const requestParameters: ["path" | "query" | "header", Record<string, unknown>][] = [
    ["path", candidate.request.pathParameters],
    ["query", candidate.request.queryParameters],
    ["header", candidate.request.headers],
  ];
  for (const [location, values] of requestParameters) {
    for (const name of Object.keys(values)) {
      if (!allowedParameters.get(location)?.has(name)) {
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
  if (bodySchema && isRecord(candidate.request.body)) {
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
  value: Record<string, unknown>,
  schema: SchemaConstraint,
  path: string,
  candidateId: string,
  findings: AIValidationFinding[],
): void {
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
    if (isRecord(nestedValue)) {
      addUnknownBodyFields(
        nestedValue,
        childSchema,
        `${path}.${key}`,
        candidateId,
        findings,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
