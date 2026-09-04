# Phase 0 Research: AI Provider & Local Inference Foundation

All unknowns from the Technical Context are resolved below before Phase 1 design.

## 1. Local inference runtime and execution environment

- **Decision**: Use `@huggingface/transformers` (Transformers.js v3) running inside the
  Node.js backend process (not the browser), using its default ONNX Runtime Node execution
  provider for CPU inference.
- **Rationale**: The roadmap explicitly names Transformers.js as the initial local runtime.
  Running it in the backend (rather than the browser/frontend) keeps model files and
  inference entirely within the same local process that already handles specification
  parsing, matching "local ApiPilot → local AI inference" (constitution V) without adding a
  second runtime surface (e.g., a browser WASM/WebGPU path) before there's a concrete need
  (constitution XXVII).
- **Alternatives considered**:
  - *Browser-side inference (WebGPU/WASM in the frontend)*: rejected for now — doubles the
    runtime surface (Node + browser) for no current benefit, and complicates model caching
    (two cache locations). Left as a future option since `AIProvider` is runtime-agnostic
    (constitution VI, XXVIII).
  - *A separate local inference microservice/process*: rejected — adds distributed-system
    complexity (IPC, lifecycle management) with no current requirement for isolation
    (constitution XXVII).

## 2. Initial local model shortlist and selection approach

- **Decision**: The benchmarking harness (FR-014) ships as part of this feature and
  evaluates a shortlist of small, Apache-2.0/permissively-licensed, Transformers.js-
  compatible instruction-following models against a representative sample workload set
  (structured/JSON-shaped generation prompts representative of what AP-005 will eventually
  need, without containing any OpenAPI-specific business logic). The shortlist evaluated
  first is:
  1. `onnx-community/Qwen2.5-0.5B-Instruct` — smallest candidate; fastest CPU startup/latency.
  2. `Xenova/LaMini-Flan-T5-248M` — very small, instruction-tuned, sequence-to-sequence
     baseline for lightweight structured output.
  3. `onnx-community/Phi-3-mini-4k-instruct-ONNX` — larger, higher quality-ceiling candidate
     used to measure the latency/memory cost of materially better output quality. (The repo
     id originally recorded here, `onnx-community/Phi-3-mini-4k-instruct`, does not exist on
     Hugging Face and made this candidate silently fail to load in every benchmark run prior
     to 2026-09-04; corrected to the real `-ONNX`-suffixed repo.)
  4. `onnx-community/Phi-3-mini-128k-instruct-ONNX` (loaded at `dtype: "q4"`, ~2.5GB, rather
     than Transformers.js's fp32-on-CPU default of ~16GB) — added after production
     AI-enhancement calls on large `ApiModel`/`TestModel` prompts exceeded
     Qwen2.5-0.5B-Instruct's 32768-token context window; MIT-licensed, evaluated for
     whether its 128k context window resolves oversized-prompt failures without an
     unacceptable latency/memory cost (shortlist extension anticipated by this section's
     original wording).
  - **Outcome (2026-09-04)**: with the repo-id bug fixed, `Phi-3-mini-4k-instruct-ONNX`
    (q4) matched Qwen2.5-0.5B-Instruct's 33% structured-output success rate but averaged
    **322,868ms/request — ~25x Qwen's 12,654ms** on the same CPU;
    `Phi-3-mini-128k-instruct-ONNX` (q4) failed every workload by exceeding the 120s
    per-request timeout (durations of 560s/122s/129s) before producing any output. A
    larger context window is moot if the model cannot complete a request inside any
    reasonable budget: this disqualifies the Phi-3-mini family for interactive CPU
    inference in this environment on latency grounds, independent of context-window size.
    `onnx-community/Qwen2.5-0.5B-Instruct` remains the selected default (see
    `benchmark-results.json`); resolving oversized-prompt failures instead requires
    bounding what `enhanceTestModel`/`analyzeDependencies` send in the request body, which
    is a separate, spec-level change.
  - Metrics captured per candidate (FR-014, constitution VII, XXII): structured-output
    success rate (does the output parse as the requested shape), average/95th-percentile
    latency, peak memory, model size on disk, and startup/load time.
  - The model with the best structured-output reliability that also meets a CPU-latency
    budget suitable for interactive use is selected by default; the harness records the
    metrics and rationale (FR-015) in a `BenchmarkReport` (data-model.md) so the decision is
    traceable and revisitable (constitution XXX) rather than hard-coded as an unexamined
    assumption.
- **Rationale**: Constitution VII requires evidence-driven model selection using
  representative workloads, not the largest/newest model by default. A fixed shortlist of
  small, CPU-feasible, permissively-licensed candidates keeps the evaluation scope bounded
  (constitution XXVII) while still producing real, recorded evidence rather than an
  assumption.
- **Alternatives considered**:
  - *Pick one model without benchmarking*: rejected — directly conflicts with constitution
    VII and the roadmap's explicit instruction to evaluate models during planning/
    implementation using representative workloads.
  - *Evaluate an open-ended/unbounded set of models*: rejected — unbounded evaluation scope
    conflicts with constitution XXVII (prefer simple, bounded scope) and delays shipping the
    foundation; the shortlist can be extended later using the same harness.

## 3. Model cache location and offline behavior

- **Decision**: Default cache directory is `~/.apipilot/models` (a per-user path derived
  from `os.homedir()`), overridable via an `AI_MODEL_CACHE_DIR` environment variable. The
  local provider configures Transformers.js to use this directory and never attempts a
  network fetch when local-only mode is active and the model is already cached.
- **Rationale**: A per-user, well-known path needs no new dependency (Node's built-in `os`/
  `path` modules are sufficient — constitution XXVII) and is trivially discoverable/
  clearable by a user without special tooling.
- **Alternatives considered**:
  - *A dependency like `env-paths` for OS-specific cache directories*: rejected — the extra
    dependency isn't justified for a single, simple path (constitution XXVII); can be
    revisited if genuine cross-platform cache-location issues surface.
  - *Project-local cache directory (inside the repo)*: rejected — conflates a large,
    machine-specific binary cache with source control; a per-user home-directory path keeps
    the repository clean.

## 4. Concurrency model for inference requests

- **Decision** (per `/speckit-clarify`): A single in-process, in-memory async queue
  (`requestQueue.ts`) serializes inference requests; a new request is enqueued and awaits
  its turn rather than being rejected or run in parallel (FR-018).
- **Rationale**: A single local model instance on CPU cannot usefully serve fully parallel
  requests; a simple FIFO queue (no external broker, no worker pool) is the smallest
  mechanism that satisfies the clarified requirement (constitution XXVII).
- **Alternatives considered**: Rejecting concurrent requests outright (worse UX, no
  benefit over queuing for a single local user) and true parallel execution via worker
  threads (added complexity with no benefit for a single CPU-bound model instance) were
  both rejected per the clarification answer.

## 5. Per-request timeout

- **Decision**: A configurable timeout (`AI_INFERENCE_TIMEOUT_MS`, default `60000` — 60
  seconds) wraps each `infer()` call using `AbortController`/`Promise.race`; exceeding it
  yields an `InferenceResponse` with `errorCategory: "TIMEOUT"` (FR-017).
- **Rationale**: CPU-only generation for even small models can take tens of seconds on
  modest hardware; 60 seconds is a generous default that avoids false-positive timeouts on
  typical developer machines while still bounding worst-case wait time, and remains
  operator-configurable per the clarification answer.
- **Alternatives considered**: A fixed, non-configurable timeout was rejected by the
  clarification answer; no timeout at all was rejected because it could hang the serial
  queue indefinitely for every subsequent queued request.

## 6. Accelerator detection and fallback

- **Decision**: When `useAccelerator` is enabled in `ModelConfig`, the local provider
  attempts to initialize Transformers.js with an accelerated execution provider first; if
  initialization fails or throws, it automatically retries with the CPU execution provider
  and records `acceleratorRequested: true, acceleratorActive: false` plus a visible
  `reason` in `ReadinessState` (FR-008). CPU is always the default when `useAccelerator` is
  not enabled.
- **Rationale**: Per the clarification answer, an unavailable-but-configured accelerator
  must not block inference outright; it must fall back to the guaranteed CPU baseline while
  remaining visible (not silent), satisfying constitution XIV.
- **Alternatives considered**: Failing with an `unavailable` state instead of falling back
  was rejected by the clarification answer; falling back silently (no recorded notice) was
  rejected as it would violate "No Silent Assumptions" (constitution XIV).

## 7. Structured inference request/response contract and validation

- **Decision**: Plain, hand-written TypeScript interfaces (`InferenceRequest`,
  `InferenceResponse`) plus hand-written type-guard validation functions, consistent with
  the existing codebase convention (e.g., `openapi/validateSpec.ts`'s manual, typed
  extraction/validation rather than a schema-validation library). No new validation
  dependency (e.g., `zod`/`ajv`) is introduced.
- **Rationale**: The existing codebase already validates structured data by hand with
  explicit TypeScript types and presence checks; matching this convention avoids
  introducing a second validation paradigm for no added benefit (constitution XXVII).
- **Alternatives considered**: Adding `zod` or `ajv` for request/response validation was
  considered but rejected — the request/response shapes are simple enough that hand-written
  guards are equally clear, and the codebase has no existing precedent for a schema library.

## 8. Mock provider design

- **Decision**: The mock provider derives its `content` deterministically from a stable
  hash of the `InferenceRequest.input` (and any `expectedOutputFormat`), so the same input
  always yields byte-identical output (FR-011, SC-004), with no randomness and no real model
  loaded.
- **Rationale**: Deterministic, input-derived output (rather than a fixed canned string)
  lets AI-dependent tests assert on request/response correlation without needing a real
  model, satisfying constitution XXI and XXIV.
- **Alternatives considered**: A single fixed canned response regardless of input was
  rejected — it would not let tests verify that different requests are handled distinctly.

## 9. Error taxonomy

- **Decision**: `AIErrorCategory` is a closed set: `"NOT_READY"`, `"LOAD_FAILED"`,
  `"TIMEOUT"`, `"INVALID_REQUEST"`, `"INVALID_RESPONSE"`, `"PROVIDER_UNAVAILABLE"` (FR-010).
- **Rationale**: A small, closed, distinguishable set covers every failure mode identified
  in spec.md's Edge Cases while remaining simple to test exhaustively (constitution XXI).
- **Alternatives considered**: Free-form string error messages only (no category) were
  rejected — they aren't reliably distinguishable/actionable by calling code (FR-010).

## 10. Logging approach

- **Decision**: Log lines emitted by the AI infrastructure include `requestId`, `modelId`,
  processing stage (`queued`/`loading`/`inferring`/`completed`/`failed`), `durationMs`, and
  `errorCategory` where applicable. Raw prompt/response content is never logged by default.
- **Rationale**: Directly satisfies constitution XX (Observability Without Sensitive
  Logging), matching the diagnostic fields it explicitly recommends.
- **Alternatives considered**: Logging full request/response content for easier local
  debugging was rejected as a default — it would violate constitution XX; a future,
  explicitly-opt-in verbose/debug mode could be added later if a concrete need arises.
