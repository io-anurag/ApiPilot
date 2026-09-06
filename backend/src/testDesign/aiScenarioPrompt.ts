import { SCENARIO_CATEGORIES } from "@apipilot/shared-domain";
import type {
  ApiModel,
  ApiOperation,
  InferenceRequest,
  SchemaConstraint,
  TestModel,
} from "@apipilot/shared-domain";

/**
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
export const AI_SCENARIO_RESPONSE_VERSION = 3;

/**
 * Generation bound for a scenario-design response, sized against measured throughput
 * (specs/014-ai-batching-policy research.md Decision 2).
 *
 * 256 covers a single operation's reply. Measured across the six operations of a real
 * springdoc-style specification: a 192-token allowance produced a valid reply for five of them and
 * truncated on the one with the largest request body (four fields); 256 produced a valid reply for
 * all six, 14.6–30.4 seconds each, comfortably inside the 60-second per-request default.
 *
 * A larger allowance costs nothing on operations that do not need it — the same easy operation
 * measured 14.6s at 192 and 14.3s at 320 — because generation stops when the document closes. The
 * allowance is a cap, not a price, so 256 buys coverage of body-heavy operations without penalising
 * the common case. 320 was also valid but bought nothing on this corpus while moving the worst case
 * closer to the timeout.
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
 * Two rather than more because a reply that arrives beats a longer one that truncates
 * (constitution XII — Quality Over Quantity).
 */
export const AI_SCENARIO_MAX_CANDIDATES_PER_OPERATION = 2;

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

/**
 * Most fields a request body declares, before the list stops paying for itself.
 *
 * Prompt tokens cost ~42ms each before generation begins (research.md Decision 10), and a request
 * that asks for at most two scenarios cannot use forty fields. Truncation is deterministic —
 * declaration order — so the same specification always sends the same fields (SC-008).
 */
const MAX_BODY_FIELDS_SHOWN = 12;

/** Most already-covered field names listed per category, bounded for the same reason. */
const MAX_COVERED_FIELDS_SHOWN = 8;

/** Request-body fields flattened one level: name, requiredness, and their own constraints. */
function summarizeBodyFields(schema: SchemaConstraint | undefined): Record<string, unknown>[] {
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
function summarizeBaseline(testModel: TestModel): Record<string, Record<string, string[]>> {
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
const WORKED_EXAMPLE = {
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
      request: { pathParameters: { itemId: "not-a-uuid" }, queryParameters: {}, headers: {} },
      assertions: [{ type: "status-code", expectedStatusCode: "400" }],
      rationale: "An invalid identifier should be rejected before any lookup.",
      confidence: 0.8,
      assumptions: [],
    },
  ],
} as const;

/**
 * Whether this request's operations warrant the worked example.
 *
 * Attached for operations carrying a request body — the ones whose replies are longest and where
 * truncation is the observed failure — and omitted otherwise. Measured on paired runs of the same
 * operation: on the body-less operation the example cost ~6.6s and changed nothing (17.1s/17.3s
 * without, 23.9s with); on the four-field-body operation that truncates first it *saved* ~9.1s
 * (30.4s without, 21.2s with), by steering the model toward a more compact reply.
 *
 * Applying it unconditionally would spend that ~6.6s on every body-less operation for no measured
 * benefit, and under the run budget (FR-009) time spent is coverage lost.
 *
 * A pure function of the operations, so unit derivation stays reproducible (SC-008).
 */
function needsWorkedExample(operations: readonly ApiOperation[]): boolean {
  return operations.some((operation) => operation.requestBody !== undefined);
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

export function buildAIScenarioPrompt(apiModel: ApiModel, testModel: TestModel): string {
  const operations = apiModel.operations;
  const candidateCeiling = Math.max(
    1,
    operations.length * AI_SCENARIO_MAX_CANDIDATES_PER_OPERATION,
  );
  const subject = operations.length === 1 ? "the operation" : "the operations";

  // Every field below is paid for at ~42ms per prompt token before the model emits anything
  // (research.md Decision 10), so each one has to earn its place. The worked example doubles as the
  // output-shape specification: showing one correct candidate is materially cheaper than describing
  // the same structure in prose, and was measured to be at least as effective.
  return JSON.stringify({
    v: AI_SCENARIO_RESPONSE_VERSION,
    task:
      `Suggest at most ${candidateCeiling} more test scenarios for ${subject} below. ` +
      "Use only fields, parameters and status codes shown. Do not repeat existingCoverage. " +
      "Reply with only a JSON object: {\"candidates\":[...]} shaped exactly like the example.",
    operations: operations.map(summarizeOperation),
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
    example: WORKED_EXAMPLE,
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