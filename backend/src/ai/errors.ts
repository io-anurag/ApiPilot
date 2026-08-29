import type { AIErrorCategory, InferenceResponse } from "@apipilot/shared-domain";

/** Builds a structured error InferenceResponse for a closed AIErrorCategory (FR-010). */
export function buildErrorResponse(params: {
  requestId: string;
  errorCategory: AIErrorCategory;
  errorMessage: string;
  modelId: string;
  provider: InferenceResponse["provider"];
  durationMs: number;
}): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: params.requestId,
    status: "error",
    errorCategory: params.errorCategory,
    errorMessage: params.errorMessage,
    modelId: params.modelId,
    provider: params.provider,
    durationMs: params.durationMs,
  };
}

/** Thrown internally to short-circuit an in-flight inference call with a known category. */
export class AIProviderError extends Error {
  readonly category: AIErrorCategory;

  constructor(category: AIErrorCategory, message: string) {
    super(message);
    this.name = "AIProviderError";
    this.category = category;
  }
}
