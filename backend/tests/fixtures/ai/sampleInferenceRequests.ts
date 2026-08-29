import type { InferenceRequest } from "@apipilot/shared-domain";

export const TEXT_INFERENCE_REQUEST: InferenceRequest = {
  contractVersion: 1,
  requestId: "req-text-1",
  input: "Summarize the purpose of API testing in one sentence.",
  expectedOutputFormat: "text",
};

export const JSON_INFERENCE_REQUEST: InferenceRequest = {
  contractVersion: 1,
  requestId: "req-json-1",
  input: "Return a JSON object with a single boolean field named ok.",
  expectedOutputFormat: "json",
};
