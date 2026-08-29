# Phase 1 Data Model: AI Provider & Local Inference Foundation

Types below are added to `packages/shared-domain` (framework-independent, consumed by both
`backend/` and any future frontend), consistent with constitution X (Domain Model First) and
VI/XXVIII (AI Provider Independence, Technology Is Replaceable). None of these types
reference Transformers.js, ONNX, or any other concrete runtime.

## AIProviderMode

```text
"local" | "mock"
```

Explicit, extensible discriminator (constitution XXIX). A future cloud mode (e.g.,
`"cloud"`) can be added later without changing existing consumers, but is out of scope for
this feature.

## AIProvider (interface)

The single abstraction every AI-powered feature depends on (FR-001).

| Member | Type | Notes |
|--------|------|-------|
| `mode` | `AIProviderMode` | Identifies which implementation is active |
| `getReadiness()` | `() => ReadinessState` | Synchronous snapshot of current lifecycle state (FR-004) |
| `infer(request)` | `(request: InferenceRequest) => Promise<InferenceResponse>` | Enqueues/serializes and completes a single inference request (FR-002, FR-018) |

## InferenceRequest

Structured input for a single inference call (FR-009).

| Field | Type | Notes |
|-------|------|-------|
| `contractVersion` | `1` | Fixed literal for this feature; bump when the shape changes (constitution XXIII) |
| `requestId` | `string` | Caller-supplied or generated; correlates logs/response |
| `input` | `string` | The reasoning task input (prompt/messages already flattened by the caller) |
| `expectedOutputFormat` | `"text" \| "json"` | What shape the caller expects back |
| `maxOutputTokens` | `number \| undefined` | Optional generation bound |
| `timeoutMs` | `number \| undefined` | Overrides the configured default timeout for this request only (FR-017) |

## InferenceResponse

Structured, validated output of a single inference call (FR-009, FR-010).

| Field | Type | Notes |
|-------|------|-------|
| `contractVersion` | `1` | Matches `InferenceRequest.contractVersion` |
| `requestId` | `string` | Echoes the originating request |
| `status` | `"success" \| "error"` | |
| `content` | `string \| undefined` | Present when `status: "success"` |
| `errorCategory` | `AIErrorCategory \| undefined` | Present when `status: "error"` (FR-010) |
| `errorMessage` | `string \| undefined` | Human-readable detail; never contains raw model prompts by default (constitution XX) |
| `modelId` | `string` | Identifies which model produced this response (supports future AP-005 provenance) |
| `provider` | `AIProviderMode` | Which implementation produced this response |
| `durationMs` | `number` | Wall-clock time for this request, excluding queue wait |

## AIErrorCategory

```text
"NOT_READY"
"LOAD_FAILED"
"TIMEOUT"
"INVALID_REQUEST"
"INVALID_RESPONSE"
"PROVIDER_UNAVAILABLE"
```

Closed set (research.md #9); every failure surfaced by an `AIProvider` MUST use one of
these values (FR-010).

## ReadinessState

Current lifecycle status of local inference (FR-004).

| Field | Type | Notes |
|-------|------|-------|
| `state` | `"not-loaded" \| "loading" \| "ready" \| "unavailable"` | |
| `reason` | `string \| undefined` | Required (non-empty) when `state` is `"unavailable"`; MAY be present otherwise |
| `modelId` | `string \| undefined` | Present once a model has been selected/loaded |
| `acceleratorRequested` | `boolean` | Whether configuration asked for an accelerator (FR-008) |
| `acceleratorActive` | `boolean` | Whether an accelerator is actually in use (FR-008) |
| `updatedAt` | `string` (ISO-8601) | When this snapshot was produced |

## ModelConfig

Describes which local model is selected and how it loads (FR-003).

| Field | Type | Notes |
|-------|------|-------|
| `modelId` | `string` | e.g., a Hugging Face repo id selected via the benchmarking harness |
| `cacheDir` | `string` | Defaults to `~/.apipilot/models`, overridable (`AI_MODEL_CACHE_DIR`) |
| `useAccelerator` | `boolean` | Defaults to `false` (CPU-only) |
| `inferenceTimeoutMs` | `number` | Defaults to `60000`, overridable (`AI_INFERENCE_TIMEOUT_MS`) |

## BenchmarkCandidateResult / BenchmarkReport

Recorded outcome of evaluating candidate models (FR-014, FR-015).

| Field (`BenchmarkCandidateResult`) | Type | Notes |
|-------|------|-------|
| `modelId` | `string` | |
| `structuredOutputSuccessRate` | `number` (0-1) | Fraction of sample workloads producing parseable output in the expected format |
| `averageLatencyMs` | `number` | |
| `peakMemoryMb` | `number \| undefined` | |
| `notes` | `string \| undefined` | |

| Field (`BenchmarkReport`) | Type | Notes |
|-------|------|-------|
| `runAt` | `string` (ISO-8601) | |
| `workloadSetId` | `string` | Identifies which representative sample set was used |
| `candidates` | `BenchmarkCandidateResult[]` | |
| `selectedModelId` | `string` | Must match one entry in `candidates` |
| `selectionRationale` | `string` | Human-readable justification (FR-015) |

## MockProviderConfig

| Field | Type | Notes |
|-------|------|-------|
| `modelId` | `string` | Fixed identifier (e.g., `"mock-provider"`) reported in every `InferenceResponse` |

## Validation Rules

- `InferenceRequest.input` MUST be a non-empty string; an empty or missing `input` MUST be
  rejected with `errorCategory: "INVALID_REQUEST"` before any queueing/inference occurs.
- `InferenceResponse.content` MUST be present when `status === "success"` and MUST be
  absent when `status === "error"`; the converse holds for `errorCategory`.
- `ReadinessState.reason` MUST be a non-empty string whenever `state === "unavailable"`
  (FR-004; no silent unavailability).
- `BenchmarkReport.selectedModelId` MUST equal the `modelId` of one element of
  `BenchmarkReport.candidates` (no selection without a recorded, evaluated candidate).
- Every `AIProvider` implementation (local, mock) MUST only ever produce `errorCategory`
  values from the closed `AIErrorCategory` set.
- A `local` provider's `InferenceResponse.provider` MUST always be `"local"`; a `mock`
  provider's MUST always be `"mock"` — a response's `provider` field is never spoofed by
  the caller.
