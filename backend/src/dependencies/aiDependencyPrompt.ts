import type { ApiModel, ApiOperation, SecuritySchemeDefinition, InferenceRequest } from "@apipilot/shared-domain";
import {
  consumerFieldSchemas,
  extractConsumerFields,
  extractProducerFields,
  producerFieldSchemas,
} from "./fieldExtraction";

/**
 * Response-shape version the AI is asked to produce and `parseAIDependencyResponse` validates
 * against.
 *
 * Version 2 (specs/014-ai-batching-policy research.md Decision 6): the prompt is now an operation
 * contract projection — identity, request fields, and response fields, each with location/type —
 * rather than the raw serialized `ApiModel`. Scope determines the reply, so the contract version
 * increments rather than the change being silent (constitution XXIII).
 */
export const AI_DEPENDENCY_RESPONSE_VERSION = 2;

/**
 * Feature-specific per-request AI timeout, distinct from the global default and from
 * `ANALYSIS_TIMEOUT_MS`/`AI_DEPENDENCY_RUN_BUDGET_MS` (`analyzeDependencies.ts`), neither of which
 * this bounds (FR-033).
 *
 * 45 seconds, not the original 8: that figure predated the prompt projection (T051) and was never
 * actually achievable on the reference hardware — this codebase's own previously-measured
 * throughput seeds (`DEFAULT_PREFILL_MS_PER_TOKEN=42`, `DEFAULT_DECODE_MS_PER_TOKEN=180`) project a
 * *single*-operation unit's prefill alone at ~9.9s, before any decode time. 45s comfortably covers
 * the default 3-operation unit's measured worst case (~1,106 chars ≈ 369 prompt tokens ≈ 15.5s
 * prefill, plus `AI_DEPENDENCY_MAX_OUTPUT_TOKENS` decode ≈ 23s ≈ 38.5s total) with headroom for
 * real-world variance, per specs/014-ai-batching-policy research.md Decision 7's addendum. Serves
 * double duty as the pre-flight viability budget (`analyzeDependencies.ts`), so planning and
 * enforcement cannot disagree about what "fits."
 */
export const AI_DEPENDENCY_TIMEOUT_MS = 45_000;

/**
 * Generation bound for a dependency-analysis response (specs/014-ai-batching-policy, mirroring
 * `AI_SCENARIO_MAX_OUTPUT_TOKENS`'s reasoning). A candidate list for a 3-operation unit rarely
 * needs the generic 256-token default; keeping this smaller both caps worst-case decode time and
 * keeps the pre-flight viability projection (which uses this exact value) tight rather than
 * pessimistic. Passed to both `getInputBudget()` (so batch planning reserves this much context for
 * the output) and the request itself, so the two never disagree about how much output room exists.
 */
export const AI_DEPENDENCY_MAX_OUTPUT_TOKENS = 128;

/**
 * The contract facts one operation needs for dependency inference, and nothing else
 * (specs/014-ai-batching-policy research.md Decision 6, T051).
 *
 * The previous prompt serialized the entire raw `ApiModel` per operation — every schema,
 * description, example, tag, server and security block — measuring 4,705 characters per operation
 * (9,410 for a two-operation unit) and timing out at every unit size tried. What a producer/consumer
 * relationship actually needs is which fields exist on each side, where a request field lives, and
 * each field's type — exactly the same field lists `validateAIDependencyCandidateSemantics` already
 * validates candidates against (via `extractProducerFields`/`extractConsumerFields`), so the model's
 * narrowed view and the validator's acceptance criteria can never disagree (FR-010, constitution I).
 *
 * What is dropped here is dropped from the model's *view* only: `runOneBatch` in
 * `analyzeDependencies.ts` still validates every candidate against the full, untouched `ApiModel`,
 * so a suggestion referencing anything not in the real contract is rejected on exactly the evidence
 * it was before (T053, constitution XV).
 */
function summarizeDependencyOperation(
  operation: ApiOperation,
  securitySchemes: Record<string, SecuritySchemeDefinition>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    path: operation.path,
    method: operation.method.toUpperCase(),
  };
  if (operation.operationId) summary.operationId = operation.operationId;

  const producerSchemas = producerFieldSchemas(operation);
  const responseFields = extractProducerFields(operation).map((ref) => {
    const entry: Record<string, unknown> = { field: ref.field };
    const type = producerSchemas.get(ref.field)?.type;
    if (type) entry.type = type;
    return entry;
  });
  if (responseFields.length > 0) summary.responseFields = responseFields;

  const consumerSchemas = consumerFieldSchemas(operation);
  const requestFields = extractConsumerFields(operation, securitySchemes).map((ref) => {
    const entry: Record<string, unknown> = { field: ref.field, in: ref.location };
    const type = consumerSchemas.get(ref.field)?.type;
    if (type) entry.type = type;
    return entry;
  });
  if (requestFields.length > 0) summary.requestFields = requestFields;

  return summary;
}

/** Builds the JSON prompt string sent to the AI provider for one dependency-analysis batch. */
export function buildAIDependencyPrompt(apiModel: ApiModel): string {
  return JSON.stringify({
    responseVersion: AI_DEPENDENCY_RESPONSE_VERSION,
    task:
      "Suggest additional API dependency relationships (a producer operation's responseFields " +
      "entry feeding a consumer operation's requestFields entry) that field-name matching alone " +
      "cannot find, such as semantically related fields with dissimilar names. Do not invent " +
      "operations or fields that are not listed below.",
    operations: apiModel.operations.map((operation) =>
      summarizeDependencyOperation(operation, apiModel.securitySchemes),
    ),
    output: {
      candidates: "array of structured candidates",
      requiredFields: ["candidateId", "producer", "consumer", "rationale", "confidence"],
    },
  });
}

/** Builds the single batched inference request for one dependency-analysis run (research.md). */
export function buildAIDependencyRequest(requestId: string, apiModel: ApiModel): InferenceRequest {
  return {
    contractVersion: 1,
    requestId,
    input: buildAIDependencyPrompt(apiModel),
    expectedOutputFormat: "json",
    timeoutMs: AI_DEPENDENCY_TIMEOUT_MS,
    maxOutputTokens: AI_DEPENDENCY_MAX_OUTPUT_TOKENS,
  };
}
