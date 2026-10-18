import { SCENARIO_CATEGORIES } from "@apipilot/shared-domain";
import type {
  ApiModel,
  ApiOperation,
  InferenceRequest,
  SchemaConstraint,
  TestModel,
} from "@apipilot/shared-domain";

/**
 * 2026-10-18 (specs/056 AP-056), no version change. A prompt built for operations that did not come
 * from an OpenAPI document (observed in a capture, or declared in an API definition) carries one more
 * key, `provenanceNote`, saying that the listed statuses are observed or declared and not documented
 * guarantees. The key is absent for an OpenAPI model, so that prompt is byte-identical and the contract
 * version stays 5 (a snapshot test pins the OpenAPI text). The task wording is untouched, because the
 * models were measured sensitive to what the task says and where (see the notes in the task below).
 *
 * Version 5 (specs/013 T071 follow-up), two changes. An operation with no parameters and no request body
 * no longer gets an empty `allowedTargets` list and an instruction to pick from it: it is told to leave
 * out the target and shown an example without one, built from its own path and method. And a request to
 * regenerate a scenario now says "replacement" rather than "one more" (`AIScenarioPurpose`). The prompt
 * is unchanged for every enhancement request of an operation that has targets.
 *
 * Version 4 (specs/013-ai-enhancement-viability T072): the instructions and the worked example
 * changed, not the reply structure. Measured on six operations against the default 0.5B model and
 * Qwen3-1.7B, the version 3 prompt let both answer `{"candidates":[]}` for every operation, and a
 * forced answer copied the example's `400` where the operation documents other codes. So the task now
 * asks for exactly one candidate and says an empty list is not an answer, lists `allowedTargets`, and
 * the example's status code is one the operation documents. See the "Version 4" tests.
 *
 * Version 3 (specs/014-ai-batching-policy): the prompt's *structure* is unchanged from version 2,
 * but its *scope* is not — a request now covers a single operation rather than every operation that
 * fit the context window, the candidate ceiling is expressed per operation, and a worked example is
 * attached for operations carrying a request body. Scope is what determines the reply, so the
 * contract version increments rather than the change being made silently
 * (constitution XXIII — Version AI Contracts).
 *
 * Version 2 (specs/013-ai-enhancement-viability) made the prompt an operation-contract projection
 * rather than the serialized `ApiModel` and `TestModel`, delivered through the model's chat template
 * rather than as raw text.
 */
export const AI_SCENARIO_RESPONSE_VERSION = 5;

/**
 * Generation bound for a scenario-design response, sized against measured throughput
 * (specs/014-ai-batching-policy research.md Decision 2).
 *
 * The measured single-operation allowance is 256 tokens. At 192, body-heavy responses truncate
 * before closing their JSON document (research.md Decision 2). A shorter cap is not a latency fix:
 * an incomplete response is rejected and a retry repeats the inference work.
 *
 * This was 384 when a request covered every operation that fit the context window. That is no longer
 * what a request is: sizing work by operation (research.md Decision 1) is what makes the reply short
 * enough to finish, and the allowance follows the work rather than the context window.
 *
 * Passed to both `getInputBudget()` (so batch planning reserves this much context for the output)
 * and the request itself, so the two never disagree about how much output room exists.
 */
export const AI_SCENARIO_MAX_OUTPUT_TOKENS = 256;

/**
 * Candidates requested per operation, rather than per request (FR-003).
 *
 * Expressing the ceiling per operation is what makes total AI contribution grow with specification
 * size. The previous "at most 3 per request" bound did the opposite: because request count was
 * governed by context capacity, a 200-operation specification produced two requests and could yield
 * at most six AI scenarios against 1,350 deterministic ones — proportionally *less* help the larger
 * the specification got.
 *
 * One rather than more because a reply that arrives beats a longer one that truncates. The local
 * 0.5B model can spend the full output allowance describing two candidates for a body-heavy
 * operation, leaving the enclosing JSON document incomplete and causing the whole batch to be
 * rejected (constitution XII — Quality Over Quantity).
 */
export const AI_SCENARIO_MAX_CANDIDATES_PER_OPERATION = 1;

/** Only the constraint fields that shape a test value; absent ones are omitted, not nulled. */
function summarizeSchema(
  schema: SchemaConstraint | undefined,
): Record<string, unknown> | undefined {
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

/**
 * Most fields a request body declares, before the list stops paying for itself.
 *
 * Prompt tokens cost ~42ms each before generation begins (research.md Decision 10), and a request
 * that asks for at most one scenario cannot use forty fields. Truncation is deterministic —
 * declaration order — so the same specification always sends the same fields (SC-008).
 */
const MAX_BODY_FIELDS_SHOWN = 12;

/** Most already-covered field names listed per category, bounded for the same reason. */
const MAX_COVERED_FIELDS_SHOWN = 8;

/** Request-body fields flattened one level: name, requiredness, and their own constraints. */
function summarizeBodyFields(
  schema: SchemaConstraint | undefined,
): Record<string, unknown>[] {
  if (!schema) return [];
  const required = new Set(schema.required);
  return Object.entries(schema.properties)
    .slice(0, MAX_BODY_FIELDS_SHOWN)
    .map(([name, property]) => {
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
    const [contentType, schema] =
      Object.entries(operation.requestBody.contentTypes)[0] ?? [];
    const fields = summarizeBodyFields(schema);
    if (contentType && fields.length > 0) {
      summary.requestBody = {
        contentType,
        required: operation.requestBody.required,
        fields,
      };
    }
  }

  // Documented status codes only — never inferred, so the model cannot be led into asserting a
  // response the specification does not declare (constitution I).
  if (operation.responses.length > 0) {
    summary.documentedResponses = operation.responses.map(
      (response) => response.statusCode,
    );
  }

  return summary;
}

/**
 * The deterministic baseline compressed to what the model needs in order to avoid duplicating it:
 * which category already covers which field of which operation. The full scenario objects —
 * requests, assertions, provenance — were the other half of the oversized prompt and are not
 * needed to answer "what else is worth testing?".
 *
 * Nested by operation and then category, rather than one flat string per scenario. The flat form
 * repeated the operation label and the category on every entry, which at one operation per unit is
 * pure repetition: for a ten-field request body it measured 48 entries and 2,165 characters — 47% of
 * the whole prompt, and enough on its own to push a single-operation request past the per-request
 * timeout on a real specification. The information conveyed is identical (specs/014-ai-batching-policy).
 *
 * Deterministic: operations and categories are emitted in first-seen order over a stable scenario
 * list, and field lists preserve that order, so the same input always produces the same bytes (SC-008).
 */
function summarizeBaseline(
  testModel: TestModel,
): Record<string, Record<string, string[]>> {
  const byOperation: Record<string, Record<string, string[]>> = {};
  for (const scenario of testModel.scenarios) {
    const operationKey = `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}`;
    const byCategory = (byOperation[operationKey] ??= {});
    const fields = (byCategory[scenario.category] ??= []);
    // A scenario with no target field covers the operation as a whole (e.g. `positive`), so the
    // category key alone carries the fact and there is nothing to list.
    if (
      scenario.targetField &&
      !fields.includes(scenario.targetField) &&
      fields.length < MAX_COVERED_FIELDS_SHOWN
    ) {
      fields.push(scenario.targetField);
    }
  }
  return byOperation;
}

/**
 * One worked input→output pair, attached only to requests whose operation carries a request body
 * (specs/014-ai-batching-policy research.md Decision 3, FR-016).
 *
 * Deliberately about an operation unrelated to any real specification, so it demonstrates the reply
 * *shape* without suggesting contract facts the model might carry into its answer.
 */
function workedExampleFor(operations: readonly ApiOperation[]) {
  if (allowedTargetsFor(operations).length === 0)
    return workedExampleWithoutTarget(operations);
  return {
    candidates: [
      {
        candidateId: "c1",
        operationPath: "/items/{itemId}",
        operationMethod: "GET",
        // Must be drawn from `categories` — an invented category is rejected outright, which was the
        // single largest source of discarded candidates observed against the default model.
        category: "invalid-format",
        targetLocation: "path",
        targetField: "itemId",
        // The request is always these three keyed objects, plus `body` when the operation takes one.
        // Demonstrating that is what stopped the model inventing flat shapes like {"limit":5}.
        request: {
          pathParameters: { itemId: "not-a-uuid" },
          queryParameters: {},
          headers: {},
        },
        assertions: exampleAssertions(operations),
        rationale: "An invalid identifier should be rejected before any lookup.",
        confidence: 0.8,
        assumptions: [],
      },
    ],
  };
}

/**
 * The example for an operation that takes no parameters and no request body. The targeted example
 * shows a path parameter, which such an operation does not have, and the model copied it whole
 * (`/items/{itemId}`) instead of writing a candidate for the operation it was given. This one has no
 * target and empty request objects, and carries the operation's own path and method: for an operation
 * with no inputs those are the only contract facts there are, so there is nothing wrong to carry over,
 * unlike the unrelated operation the targeted example uses. An instruction to use the operation's own
 * path instead of the example's was tried and made the model return no candidate at all.
 */
function workedExampleWithoutTarget(operations: readonly ApiOperation[]) {
  return {
    candidates: [
      {
        candidateId: "c1",
        operationPath: operations[0]?.path ?? "/",
        operationMethod: operations[0]?.method.toUpperCase() ?? "GET",
        category: "positive",
        request: { pathParameters: {}, queryParameters: {}, headers: {} },
        assertions: exampleAssertions(operations),
        rationale:
          "A repeated request should be handled the way the specification documents.",
        confidence: 0.7,
        assumptions: [],
      },
    ],
  };
}

/**
 * The status code the worked example asserts. A model copies the example, so the example must only
 * ever show a code the operation in the same request documents: a fixed `400` was copied onto
 * operations documenting only `201` and `409` and the candidate was rejected as
 * `undocumented-status-code` (constitution I — never fabricate expected codes). Prefers the first
 * documented client error, since the example is a negative scenario; otherwise the first documented
 * code; and no assertion at all when the operation documents none.
 */
function exampleAssertions(operations: readonly ApiOperation[]) {
  const codes = operations[0]?.responses.map((response) => response.statusCode) ?? [];
  const code = codes.find((candidate) => candidate.startsWith("4")) ?? codes[0];
  return code ? [{ type: "status-code", expectedStatusCode: code }] : [];
}

/**
 * The status codes the operations in a request document, once each in first-seen order. Without an
 * explicit list the model asserted the `400` it expects of any invalid input even where the
 * operation documents `404` and `204` (measured: 2 of 6 workloads); with the list, 5 of 6 were
 * usable. Documented codes only, never inferred (constitution I).
 */
function allowedStatusCodesFor(operations: readonly ApiOperation[]): string[] {
  return [
    ...new Set(
      operations.flatMap((operation) =>
        operation.responses.map((response) => response.statusCode),
      ),
    ),
  ];
}

/**
 * Every (location, field) pair a candidate may target, in declaration order: each parameter by its
 * location and each summarised body field as `body`. Stated explicitly because the model otherwise
 * targets fields the operation does not have (a path `orderId` on `POST /orders`).
 */
function allowedTargetsFor(operations: readonly ApiOperation[]) {
  return operations.flatMap((operation) => {
    const summary = summarizeOperation(operation) as {
      parameters?: { name: string; in: string }[];
      requestBody?: { fields: { name: string }[] };
    };
    return [
      ...(summary.parameters ?? []).map((parameter) => ({
        targetLocation: parameter.in,
        targetField: parameter.name,
      })),
      ...(summary.requestBody?.fields ?? []).map((field) => ({
        targetLocation: "body",
        targetField: field.name,
      })),
    ];
  });
}

/**
 * The deterministic baseline entries belonging to `operations`.
 *
 * Scoped here rather than trusted to the caller so a request can never be told about coverage for an
 * operation it cannot see — which would spend prompt tokens on context the model cannot act on, and
 * at one operation per request is most of the baseline.
 */
function baselineForOperations(
  testModel: TestModel,
  operations: readonly ApiOperation[],
): TestModel {
  const keys = new Set(
    operations.map((operation) => `${operation.method.toUpperCase()} ${operation.path}`),
  );
  return {
    scenarios: testModel.scenarios.filter((scenario) =>
      keys.has(`${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}`),
    ),
  };
}

/**
 * What the request is for. `enhance` asks for something extra beyond the deterministic coverage;
 * `replace` asks for a different scenario to stand in for the one a reviewer wants regenerated. They
 * differ only in the task's wording (specs/013 T071 follow-up): given the enhancement wording ("one
 * more scenario, prefer something not already covered"), the default model returned no candidate for
 * an operation with little left to add, which for a replacement is a failed regeneration. Measured on
 * seven operations: 1 usable replacement with the enhancement wording, 3 with this one.
 */
export type AIScenarioPurpose = "enhance" | "replace";

/** The one sentence added to a prompt for operations that are observed or declared, not documented. */
export const PROVENANCE_NOTE =
  "These operations come from captured or declared traffic; listed statuses are observed or declared, not documented guarantees.";

export function buildAIScenarioPrompt(
  apiModel: ApiModel,
  testModel: TestModel,
  purpose: AIScenarioPurpose = "enhance",
): string {
  const operations = apiModel.operations;
  const candidateCeiling = Math.max(
    1,
    operations.length * AI_SCENARIO_MAX_CANDIDATES_PER_OPERATION,
  );
  const subject = operations.length === 1 ? "the operation" : "the operations";
  const allowedStatusCodes = allowedStatusCodesFor(operations);
  const allowedTargets = allowedTargetsFor(operations);
  const fromInferredInput = operations.some(
    (operation) => operation.provenance !== undefined && operation.provenance.origin !== "documented",
  );

  // Every field below is paid for at ~42ms per prompt token before the model emits anything
  // (research.md Decision 10), so each one has to earn its place. The worked example doubles as the
  // output-shape specification: showing one correct candidate is materially cheaper than describing
  // the same structure in prose, and was measured to be at least as effective.
  return JSON.stringify({
    responseVersion: AI_SCENARIO_RESPONSE_VERSION,
    task:
      (purpose === "replace"
        ? `Write exactly ${candidateCeiling} replacement test ${candidateCeiling === 1 ? "scenario" : "scenarios"} for ${subject} below. `
        : `Suggest exactly ${candidateCeiling} more test ${candidateCeiling === 1 ? "scenario" : "scenarios"} for ${subject} below. `) +
      "You must return that many candidates; never return an empty list. " +
      "Use only fields, parameters and status codes shown. " +
      // An operation with no parameters and no request body has no target to aim at. Telling the model
      // to choose a pair from an empty list left it nothing it was permitted to do, and it answered
      // `{"candidates":[]}` for every such operation (measured: 0 of 2), so that case says what to do
      // instead of pointing at a list that is not there.
      (allowedTargets.length > 0
        ? "targetLocation and targetField must be one pair from allowedTargets, and every key in request " +
          "must come from allowedTargets. "
        : "This operation takes no parameters or request body: leave out targetLocation and targetField " +
          "and send empty request objects. ") +
      (purpose === "replace"
        ? "It must be a different scenario from the one in existingCoverage. "
        : "Prefer something existingCoverage does not already cover. ") +
      'Reply with only a JSON object: {"candidates":[...]} shaped exactly like the example.' +
      // Last sentence of the task, and `allowedStatusCodes` the last key below: measured against
      // Qwen3-1.7B, the identical instruction placed mid-task scored 2 to 3 of 6 workloads usable and
      // placed last scored 5 of 6. Small models weight what they read last.
      (allowedStatusCodes.length > 0
        ? " expectedStatusCode must be one of allowedStatusCodes."
        : ""),
    // Only for operations that are not from an OpenAPI document (specs/056 FR-039); absent otherwise.
    ...(fromInferredInput
      ? { provenanceNote: PROVENANCE_NOTE }
      : {}),
    operations: operations.map(summarizeOperation),
    ...(allowedTargets.length > 0 ? { allowedTargets } : {}),
    existingCoverage: summarizeBaseline(baselineForOperations(testModel, operations)),
    // The closed category vocabulary. Measured against the default model: with the categories
    // absent, every candidate it produced invented one ("Positive Response", "Invalid Request
    // Type", "invalid-request") and was rejected as `unsupported-category` — five of five, on a
    // run where the model otherwise produced perfectly well-formed documents. A validator can only
    // reject an invented value; the prompt is the only place that can prevent it being invented
    // (constitution I — the model must not be left to guess contract vocabulary).
    categories: SCENARIO_CATEGORIES,
    // Attached unconditionally now. The conditional rule (research.md Decision 3) rested on the
    // example being redundant for body-less operations, which the first real-model run disproved:
    // without it the model invented flat request shapes (`{"limit":5,"page":1}`) on exactly those
    // operations. Since it also replaces the prose output specification it previously sat alongside,
    // attaching it always is now *cheaper* than the alternative it removes.
    example: workedExampleFor(operations),
    ...(allowedStatusCodes.length > 0 ? { allowedStatusCodes } : {}),
  });
}

export function buildAIScenarioRequest(
  requestId: string,
  apiModel: ApiModel,
  testModel: TestModel,
  purpose: AIScenarioPurpose = "enhance",
): InferenceRequest {
  return {
    contractVersion: 1,
    requestId,
    input: buildAIScenarioPrompt(apiModel, testModel, purpose),
    expectedOutputFormat: "json",
    maxOutputTokens: AI_SCENARIO_MAX_OUTPUT_TOKENS,
  };
}
