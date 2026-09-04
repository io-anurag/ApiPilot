/** Discriminates which AIProvider implementation is active (constitution XXIX). */
export type AIProviderMode = "local" | "mock";

/** Closed set of distinguishable AI inference failure categories (FR-010). */
export type AIErrorCategory =
  | "NOT_READY"
  | "LOAD_FAILED"
  | "TIMEOUT"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "PROVIDER_UNAVAILABLE";

/** Structured input for a single inference call (FR-009). */
export interface InferenceRequest {
  contractVersion: 1;
  requestId: string;
  input: string;
  expectedOutputFormat: "text" | "json";
  maxOutputTokens?: number;
  /** Overrides the configured default timeout for this request only (FR-017). */
  timeoutMs?: number;
}

/** Structured, validated output of a single inference call (FR-009, FR-010). */
export interface InferenceResponse {
  contractVersion: 1;
  requestId: string;
  status: "success" | "error";
  content?: string;
  errorCategory?: AIErrorCategory;
  errorMessage?: string;
  modelId: string;
  provider: AIProviderMode;
  durationMs: number;
}

/** Current lifecycle status of local inference (FR-004). */
export interface ReadinessState {
  state: "not-loaded" | "loading" | "ready" | "unavailable";
  /** Required (non-empty) when state is "unavailable"; MAY be present otherwise. */
  reason?: string;
  modelId?: string;
  acceleratorRequested: boolean;
  acceleratorActive: boolean;
  updatedAt: string;
}

/**
 * Closed set of ONNX weight quantizations Transformers.js can load (mirrors that
 * library's `DataType` union). Left unset, Transformers.js chooses fp32 on CPU, which is
 * appropriate for small models but downloads/runs an impractically large file for a
 * multi-billion-parameter model — `dtype` lets `ModelConfig` pin a lighter quantization
 * per model instead of the harness/provider silently accepting whatever fp32 costs.
 */
export type ModelDType =
  "fp32" | "fp16" | "q8" | "int8" | "uint8" | "q4" | "q4f16" | "bnb4";

/** Describes which local model is selected and how it loads (FR-003). */
export interface ModelConfig {
  modelId: string;
  cacheDir: string;
  useAccelerator: boolean;
  inferenceTimeoutMs: number;
  /** ONNX weight quantization to load; omitted defers to Transformers.js's own default. */
  dtype?: ModelDType;
}

/** The single abstraction every AI-powered feature depends on (FR-001). */
export interface AIProvider {
  mode: AIProviderMode;
  getReadiness(): ReadinessState;
  infer(request: InferenceRequest): Promise<InferenceResponse>;
  /**
   * Maximum number of characters of serialized InferenceRequest.input this provider can
   * safely accept for the given output budget, or undefined if it has no meaningful limit
   * (e.g. MockProvider). A conservative estimate, not an exact count — see
   * specs/011-ai-prompt-batching/research.md Decision 1/2. Callers use this only to plan
   * batches; LocalProvider's existing exact-token guard inside infer() remains the
   * authoritative fits/doesn't-fit check.
   */
  getInputBudget(maxOutputTokens?: number): Promise<number | undefined>;
}

/** Fixed configuration for the deterministic mock provider (FR-011). */
export interface MockProviderConfig {
  modelId: string;
  /**
   * Test-only fixed value for `getInputBudget()`, letting unit tests exercise real
   * multi-batch splitting without a real model (specs/011-ai-prompt-batching/data-model.md;
   * constitution XXI). Omitted means "no limit", matching production MockProvider behavior.
   */
  inputBudgetCharsOverride?: number;
}

/** Recorded outcome of evaluating one candidate model against sample workloads (FR-014). */
export interface BenchmarkCandidateResult {
  modelId: string;
  /** Fraction (0-1) of sample workloads producing parseable output in the expected format. */
  structuredOutputSuccessRate: number;
  averageLatencyMs: number;
  peakMemoryMb?: number;
  notes?: string;
}

/** Traceable record of a model-selection decision (FR-015). */
export interface BenchmarkReport {
  runAt: string;
  workloadSetId: string;
  candidates: BenchmarkCandidateResult[];
  /** Must match one entry in `candidates`. */
  selectedModelId: string;
  selectionRationale: string;
}
