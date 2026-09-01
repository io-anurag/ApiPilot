import type { ApiModel, InferenceRequest, TestModel } from "@apipilot/shared-domain";

export const AI_SCENARIO_RESPONSE_VERSION = 1;

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
  };
}