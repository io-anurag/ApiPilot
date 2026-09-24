import { createHash } from "node:crypto";
import type {
  FailureEvidence,
  InferenceRequest,
  SpecificationContext,
  SpecificationContextUnavailableReason,
} from "@apipilot/shared-domain";

/**
 * Versioned prompt for AP-031 failure analysis (specs/030-ai-failure-analysis research D6, D7,
 * D8; constitution XXIII). The feature owns its system instruction and sends it through
 * `InferenceRequest.systemPrompt`, so the provider stays free of feature rules.
 */

/**
 * Bump whenever the system prompt, task, allowed causes or worked examples change (research D7).
 * v2 (2026-09-23): three contrasting examples and a decision guide replaced v1's single example,
 * which the evaluation showed the default model copying verbatim (specs/030 evaluation.md).
 */
export const FAILURE_ANALYSIS_RESPONSE_VERSION = 2;
/** Fits a 400-character summary and three short steps; about 46 s of decode at default planning rates (research D8). */
export const FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS = 256;
/** Below this the model itself rates its cause as less likely than not (research D7). */
export const FAILURE_ANALYSIS_MIN_CONFIDENCE = 0.5;

export const FAILURE_ANALYSIS_SYSTEM_PROMPT =
  "You analyze why one API test request failed. Your entire response must be one complete valid " +
  "JSON object, starting with { and ending with }, with no markdown, backticks or commentary. Use " +
  "only the numbered evidence you are given and cite it by id. Never invent evidence ids, values, " +
  'endpoints or status codes. If the evidence does not support a cause, use "insufficient-evidence".';

const TASK =
  "Name the most likely cause of the failed request below, using only its evidence. The examples " +
  "only show the answer format for other failures; do not copy their cause or confidence. Give " +
  "confidence from 0 to 1 that reflects how strongly the evidence supports the cause, a summary " +
  "under 300 characters, the evidence ids you relied on, and 1 to 3 short investigation steps.";

/** Each description doubles as the decision guide for choosing between causes. */
const ALLOWED_CAUSES = {
  "specification-mismatch":
    "a response was received but it differs from what the specification or tests expect: a " +
    "different status code, a missing or wrong field, or a wrong content type",
  "environment-issue":
    "no response was received (connection refused, timeout), or the environment rejected the " +
    "request: wrong base URL, gateway error, invalid or missing credentials (401/403)",
  "downstream-service-issue":
    "the API itself responded, but the response says another service it depends on failed or is " +
    "unavailable (for example a 503, or a 500 whose body names another service)",
  "insufficient-evidence":
    "the evidence is too thin to tell, for example only a status code or a failed test with no detail",
} as const;

const WORKED_EXAMPLES = [
  {
    evidence: [
      { id: "E1", text: "Response status 200" },
      { id: "E2", text: 'Test "Status code is 201" failed: expected 201 but got 200' },
    ],
    answer: {
      responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION,
      cause: "specification-mismatch",
      confidence: 0.7,
      summary: "The API returned 200 where its tests and contract expect 201 for a create.",
      evidenceIds: ["E1", "E2"],
      steps: ["Compare the implemented status code with the documented 201 response."],
    },
  },
  {
    evidence: [
      { id: "E1", text: "Response status 503" },
      { id: "E2", text: 'Response body: {"error":"billing-service did not respond"}' },
    ],
    answer: {
      responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION,
      cause: "downstream-service-issue",
      confidence: 0.85,
      summary: "The API responded but reports that billing-service, which it depends on, did not respond.",
      evidenceIds: ["E2"],
      steps: ["Check the health of billing-service.", "Retry once it is available."],
    },
  },
  {
    evidence: [{ id: "E1", text: 'Test "Check response" failed' }],
    answer: {
      responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION,
      cause: "insufficient-evidence",
      confidence: 0.2,
      summary: "Only a failed test name was recorded, with no status, detail or body to explain it.",
      evidenceIds: ["E1"],
      steps: [],
    },
  },
];

/**
 * SHA-256 of the fixed prompt text. A unit test recomputes it, so changing the prompt without also
 * bumping `FAILURE_ANALYSIS_RESPONSE_VERSION` and updating this value fails the build — keeping the
 * `responseVersion` recorded in provenance an exact identifier of the prompt (constitution XXIII).
 */
export const FAILURE_ANALYSIS_PROMPT_FINGERPRINT =
  "948a397a94c1d4ddebe2c0be93ca1b732d883d02cdd385bfb13c489d51589462";

export function computeFailureAnalysisPromptFingerprint(): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        systemPrompt: FAILURE_ANALYSIS_SYSTEM_PROMPT,
        task: TASK,
        allowedCauses: ALLOWED_CAUSES,
        examples: WORKED_EXAMPLES,
      }),
    )
    .digest("hex");
}

const UNAVAILABLE_NOTE: Record<SpecificationContextUnavailableReason, string> = {
  "no-request-identity": "No specification context: this result was recorded before request identity was tracked.",
  "no-generated-collection": "No specification context: the session has no generated collection.",
  "not-generated-by-current-workflow":
    "No specification context: this request was not generated by the current guided workflow.",
  "no-originating-scenario": "No specification context: this request has no originating test scenario.",
};

function specificationContextNote(context: SpecificationContext): string {
  if (context.status === "unavailable") return UNAVAILABLE_NOTE[context.reason];
  return `Generated from ${context.operationMethod.toUpperCase()} ${context.operationPath}, scenario "${context.scenarioName}".`;
}

export interface FailureAnalysisPromptInput {
  requestMethod: string;
  requestName: string;
  evidence: readonly FailureEvidence[];
  specificationContext: SpecificationContext;
}

export function buildFailureAnalysisPrompt(input: FailureAnalysisPromptInput): string {
  return JSON.stringify({
    responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION,
    task: TASK,
    request: { method: input.requestMethod.toUpperCase(), name: input.requestName },
    evidence: input.evidence.map((item) => ({ id: item.id, text: item.text })),
    specificationContextNote: specificationContextNote(input.specificationContext),
    allowedCauses: ALLOWED_CAUSES,
    examples: WORKED_EXAMPLES,
  });
}

/** Content-derived request id, as AP-005 does (`enhanceTestModel.ts`): never random (constitution XXIV). */
export function buildFailureAnalysisRequest(prompt: string): InferenceRequest {
  return {
    contractVersion: 1,
    requestId: `failure-${createHash("sha256").update(prompt).digest("hex").slice(0, 24)}`,
    input: prompt,
    expectedOutputFormat: "json",
    maxOutputTokens: FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS,
    systemPrompt: FAILURE_ANALYSIS_SYSTEM_PROMPT,
  };
}
