import { createHash } from "node:crypto";
import type {
  AIProvider,
  AIProviderMode,
  InferenceRequest,
  InferenceResponse,
  MockProviderConfig,
  ReadinessState,
} from "@apipilot/shared-domain";
import { buildErrorResponse } from "./errors";

const DEFAULT_MOCK_MODEL_ID = "mock-provider";

/**
 * Deterministic AIProvider stand-in for automated tests (FR-011). Never loads a real
 * model and never touches the network — always reports "ready".
 */
export class MockProvider implements AIProvider {
  readonly mode: AIProviderMode = "mock";
  private readonly modelId: string;
  private readonly inputBudgetCharsOverride: number | undefined;

  constructor(config: MockProviderConfig = { modelId: DEFAULT_MOCK_MODEL_ID }) {
    this.modelId = config.modelId;
    this.inputBudgetCharsOverride = config.inputBudgetCharsOverride;
  }

  getReadiness(): ReadinessState {
    return {
      state: "ready",
      modelId: this.modelId,
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date().toISOString(),
    };
  }

  /** No limit by default; tests can fix a small budget via MockProviderConfig (FR-011). */
  async getInputBudget(): Promise<number | undefined> {
    return this.inputBudgetCharsOverride;
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const startedAt = Date.now();

    if (!request.input || request.input.trim().length === 0) {
      return buildErrorResponse({
        requestId: request.requestId,
        errorCategory: "INVALID_REQUEST",
        errorMessage: "InferenceRequest.input must be a non-empty string",
        modelId: this.modelId,
        provider: this.mode,
        durationMs: Date.now() - startedAt,
      });
    }

    return {
      contractVersion: 1,
      requestId: request.requestId,
      status: "success",
      content: deriveDeterministicContent(request),
      modelId: this.modelId,
      provider: this.mode,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Stable hash of input + expectedOutputFormat, so identical requests always produce identical output. */
function deriveDeterministicContent(request: InferenceRequest): string {
  const digest = createHash("sha256")
    .update(`${request.expectedOutputFormat}:${request.input}`)
    .digest("hex")
    .slice(0, 32);

  if (request.expectedOutputFormat === "json") {
    return JSON.stringify({ mock: true, hash: digest });
  }
  return `mock-response-${digest}`;
}
