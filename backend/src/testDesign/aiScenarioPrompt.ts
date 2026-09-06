import type {
  ApiModel,
  ApiOperation,
  InferenceRequest,
  SchemaConstraint,
  TestModel,
} from "@apipilot/shared-domain";

/**
 * Version 2 (specs/013-ai-enhancement-viability): the prompt is now an operation-contract
 * projection rather than the serialized `ApiModel` and `TestModel`, and is delivered through the
 * model's chat template rather than as raw text. Both materially change the bytes the model sees,
 * so the contract version is incremented rather than the change being made silently
 * (constitution XXIII — Version AI Contracts).
 */
export const AI_SCENARIO_RESPONSE_VERSION = 2;

/**
 * Generation bound for a scenario-design response, sized against measured throughput
 * (specs/013-ai-enhancement-viability FR-011).
 *
 * This was 1024, chosen so a response could not truncate mid-JSON. That reasoning was sound but
 * unbudgeted: at the ~2 tokens/second the shipped configuration actually achieved, 1024 tokens
 * needed roughly 34 minutes against a 5-minute timeout, so the stage could never complete. The
 * arithmetic now runs the other way — at the measured ~8 tokens/second of the corrected
 * configuration, 384 tokens costs roughly 48 seconds, which fits the 60-second default alongside
 * the ~2 seconds the (now 11x smaller) prompt takes to process.
 *
 * 384 rather than less because a truncated document parses as nothing at all: 256 was tried and
 * measured cutting the model off mid-JSON, wasting the entire call. Paired with the prompt's
 * "at most 3 candidates" bound, which keeps the reply inside this allowance instead of relying on
 * the cap to stop it. Fewer candidates per batch that actually arrive beat more that never do
 * (constitution XII — Quality Over Quantity).
 *
 * Passed to both `getInputBudget()` (so batch planning reserves this much context for the output)
 * and the request itself, so the two never disagree about how much output room exists.
 */
export const AI_SCENARIO_MAX_OUTPUT_TOKENS = 384;

/** Only the constraint fields that shape a test value; absent ones are omitted, not nulled. */
function summarizeSchema(schema: SchemaConstraint | undefined): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const summary: Record<string, unknown> = {};
  if (schema.type) summary.type = schema.type;
  if (schema.format) summary.format = schema.format;
  if (schema.enum) summary.enum = schema.enum;
  if (schema.minimum !== undefined) summary.minimum = schema.minimum;
  if (schema.maximum !== undefined) summary.maximum = schema.maximum;
  if (schema.pattern) summary.pattern = schema.pattern;
  if (schema.minLength !== undefined) summary.minLength = schema.minLength;
  if (schema.maxLength !== undefined) summary.maxLength = schema.maxLength;
  if (schema.minItems !== undefined) summary.minItems = schema.minItems;
  if (schema.maxItems !== undefined) summary.maxItems = schema.maxItems;
  return Object.keys(summary).length > 0 ? summary : undefined;
}

/** Request-body fields flattened one level: name, requiredness, and their own constraints. */
function summarizeBodyFields(schema: SchemaConstraint | undefined): Record<string, unknown>[] {
  if (!schema) return [];
  const required = new Set(schema.required);
  return Object.entries(schema.properties).map(([name, property]) => {
    const field: Record<string, unknown> = { name };
    if (required.has(name)) field.required = true;
    const constraints = summarizeSchema(property);
    if (constraints) Object.assign(field, constraints);
    return field;
  });
}

/**
 * The contract facts the model needs to propose a scenario, and nothing else
 * (specs/013-ai-enhancement-viability research.md Decision 4).
 *
 * The previous prompt serialized the entire dereferenced `ApiModel` — every schema, description,
 * example, tag, server and security block — plus every deterministic scenario in full. That
 * measured 22,095 characters for a three-operation specification, of which prompt processing
 * alone cost ~94 seconds. Prompt size is the dominant cost, and almost none of that material is
 * needed to suggest semantic test scenarios.
 *
 * What is dropped here is dropped from the model's *view* only: candidates are still validated
 * against the full `ApiModel` by `validateAICandidateSemantics`, so a suggestion referencing
 * anything not in the real contract is rejected on exactly the evidence it was before (FR-010,
 * constitution I).
 */
function summarizeOperation(operation: ApiOperation): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    path: operation.path,
    method: operation.method.toUpperCase(),
  };
  if (operation.operationId) summary.operationId = operation.operationId;

  if (operation.parameters.length > 0) {
    summary.parameters = operation.parameters.map((parameter) => {
      const entry: Record<string, unknown> = {
        name: parameter.name,
        in: parameter.location,
      };
      if (parameter.required) entry.required = true;
      const constraints = summarizeSchema(parameter.schema);
      if (constraints) Object.assign(entry, constraints);
      return entry;
    });
  }

  if (operation.requestBody) {
    // The first declared content type only: alternatives are near-always the same schema in a
    // different encoding, and carrying every one multiplies prompt size for no added constraint.
    const [contentType, schema] = Object.entries(operation.requestBody.contentTypes)[0] ?? [];
    const fields = summarizeBodyFields(schema);
    if (contentType && fields.length > 0) {
      summary.requestBody = { contentType, required: operation.requestBody.required, fields };
    }
  }

  // Documented status codes only — never inferred, so the model cannot be led into asserting a
  // response the specification does not declare (constitution I).
  if (operation.responses.length > 0) {
    summary.documentedResponses = operation.responses.map((response) => response.statusCode);
  }

  return summary;
}

/**
 * The deterministic baseline compressed to what the model needs in order to avoid duplicating it:
 * which category already covers which field of which operation. The full scenario objects —
 * requests, assertions, provenance — were the other half of the oversized prompt and are not
 * needed to answer "what else is worth testing?".
 */
function summarizeBaseline(testModel: TestModel): string[] {
  const seen = new Set<string>();
  for (const scenario of testModel.scenarios) {
    const target = scenario.targetField ? `:${scenario.targetField}` : "";
    seen.add(
      `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath} ${scenario.category}${target}`,
    );
  }
  return [...seen];
}

export function buildAIScenarioPrompt(apiModel: ApiModel, testModel: TestModel): string {
  return JSON.stringify({
    responseVersion: AI_SCENARIO_RESPONSE_VERSION,
    task:
      "Suggest at most 3 additional semantic API test scenarios for the operations below. Use " +
      "only fields, parameters and status codes that appear here — do not invent contract facts. " +
      "Do not repeat anything already covered by existingCoverage. Return only the JSON object.",
    operations: apiModel.operations.map(summarizeOperation),
    existingCoverage: summarizeBaseline(testModel),
    output: {
      candidates: "array of structured candidates",
      requiredFields: [
        "candidateId",
        "operationPath",
        "operationMethod",
        "category",
        "request",
        "assertions",
        "rationale",
        "confidence",
        "assumptions",
      ],
    },
  });
}

export function buildAIScenarioRequest(
  requestId: string,
  apiModel: ApiModel,
  testModel: TestModel,
): InferenceRequest {
  return {
    contractVersion: 1,
    requestId,
    input: buildAIScenarioPrompt(apiModel, testModel),
    expectedOutputFormat: "json",
    maxOutputTokens: AI_SCENARIO_MAX_OUTPUT_TOKENS,
  };
}