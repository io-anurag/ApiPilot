import type { ApiModel, InferenceRequest, TestModel } from "@apipilot/shared-domain";

export const AI_SCENARIO_RESPONSE_VERSION = 1;

/**
 * Generation bound for a scenario-design response. Each candidate carries several fields
 * (request, assertions, rationale, assumptions) that make it far heavier than a single-line
 * reply — the previous unset default (256, from LocalProvider's own fallback) was enough for
 * at most one small candidate and truncated mid-JSON for anything larger, which then always
 * failed strict JSON parsing (parseAIScenarioResponse's INVALID_RESPONSE). Passed to both
 * `getInputBudget()` (so batch planning reserves this much context for the output) and the
 * request itself, so the two never disagree about how much output room exists.
 */
export const AI_SCENARIO_MAX_OUTPUT_TOKENS = 1024;

export function buildAIScenarioPrompt(apiModel: ApiModel, testModel: TestModel): string {
  return JSON.stringify({
    responseVersion: AI_SCENARIO_RESPONSE_VERSION,
    task: "Suggest semantic API test scenarios. Do not invent contract facts.",
    apiModel,
    deterministicTestModel: testModel,
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