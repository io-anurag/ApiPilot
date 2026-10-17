# Research: Accelerator Verification and Visibility

All measurements were taken on 2026-10-17 on one Windows 11 laptop (Intel integrated graphics; NVIDIA RTX 500 Ada, 4 GB
VRAM; 31 GB RAM), `onnxruntime-node` 1.30.0, `@huggingface/transformers` 4.3.1, greedy decoding, models loaded from the
local cache. Each configuration ran in its **own process**: an earlier comparison that ran a CPU session and then a
DirectML session in one process overstated DirectML's slowdown (3x to 5x against the 2x to 4x measured here), so no figure
below comes from a mixed-device process.

## Decision 1: Verify inside `LocalProvider`'s load path, with the pure check in its own module

**Decision**: After the accelerated engine loads, `LocalProvider.loadWithAcceleratorFallback()` runs one canary inference
and decides CPU or accelerator before it marks the provider ready. The canary's input, its pass/fail evaluation and the
result type live in a new `backend/src/ai/acceleratorVerification.ts` that imports neither the inference library nor
Express.

**Rationale**: That method already owns FR-008's load-failure fallback and the readiness transitions, so the new failure
mode extends one existing branch rather than adding a parallel one. Readiness stays `loading` until the decision, which is
FR-008 of this spec for free: `infer()` and `getInputBudget()` both await the same `enginePromise`, so no request can reach
an unverified accelerator. A separate module keeps the evaluation a pure function that is unit-testable without a provider
(constitution XXI) and keeps the provider boundary clean (constitution VI).

**Alternatives considered**:

- *Verify lazily on the first real request*: rejected. The first real request is a full enhancement batch; a failure there
  is exactly the user-visible breakage this feature removes.
- *A separate "health check" endpoint or startup job*: rejected. It adds a second place that owns device state and would
  race the lazy load (constitution XXVII).

## Decision 2: The canary is a copy-style prompt, not "return an empty list"

**Decision**: The canary sends the provider's existing JSON system prompt plus the user text
`Reply with exactly: {"candidates":[]}`, with `maxNewTokens = 12`. The expected reply is `{"candidates":[]}`.

**Rationale**: The obvious wording was measured and is unsafe. Healthy CPU, greedy decoding, two runs each:

| User text | Qwen2.5-0.5B (CPU) | Qwen3-1.7B (CPU) |
| --- | --- | --- |
| `Return an empty candidates list.` | `{}`, 1 token, **fails the shape check** | `{"candidates":[]}`, 4 tokens |
| `There are no operations to cover. Answer with the JSON object that has an empty candidates array.` | `{}`, **fails** | passes |
| `Reply with exactly: {"candidates":[]}` | `{"candidates":[]}`, 4 tokens, 0.45 s | `{"candidates":[]}`, 4 tokens, 1.4 s |
| `Output this JSON and nothing else: {"candidates":[]}` | passes, 0.52 s | passes, 1.6 s |
| `Copy this text exactly: {"candidates":[]}` | passes, 0.45 s | passes, 1.6 s |
| A one-operation scenario prompt | truncates at 32 tokens, **fails** | truncates at 32 tokens, **fails** |

The 0.5B model is the model in the user's current configuration, and on it the minimal wordings return valid JSON with no
`candidates` array. With the spec's pass rule, a healthy accelerator would have been rejected: a false fallback, which
breaks SC-003. A copy-style prompt passes on both shipped models, is byte-identical across repeats (SC-004), and needs only
4 output tokens. A realistic scenario prompt is unsuitable because it cannot finish inside a small cap and so measures
verbosity, not health.

**Alternatives considered**:

- *Run the same canary on CPU and compare replies*: the most direct test, but it loads the CPU engine as well (about 30 s
  and 6.6 GB for the default model) on every accelerated start. The spec rules out a CPU baseline, and the copy-style prompt
  makes one unnecessary on the measured models.
- *Prefill the assistant turn with `{"candidates":`*: robust, but it needs a different generation path than
  `engine.generate()`, which owns the chat template (constitution XXVII).

## Decision 3: The canary separates every measured bad configuration from every measured good one

**Decision**: Pass means the reply parses as JSON, is an object, and its `candidates` property is an array (an empty array
passes). Anything else, a timeout, or an engine error is a failure.

**Rationale**: Measured with the canary of Decision 2:

| Model / dtype | Device | Canary | Time (output tokens) |
| --- | --- | --- | --- |
| Qwen2.5-0.5B fp32 | CPU | pass | 0.45 s (4) |
| Qwen2.5-0.5B fp32 | DirectML, NVIDIA | **pass** | 1.35 s cold, 0.61 s warm (4) |
| Qwen3-1.7B fp32 | CPU | pass | 1.4 s (4) |
| Qwen3-1.7B fp32 | DirectML, NVIDIA | **fail**, garbage | 18.3 s (27) |
| Qwen2.5-0.5B fp16 | DirectML, NVIDIA | **fail**, garbage | 4.4 s (32) |
| Qwen2.5-0.5B fp16 | DirectML, Intel iGPU | **fail**, garbage | 5.8 s (26) |
| Qwen3-1.7B fp16 | DirectML, NVIDIA | **fail**, garbage | 9.3 s (25) |
| Qwen3-1.7B fp16 | DirectML, Intel iGPU | **fail**, garbage | 20.2 s (21) |

The one slow-but-correct configuration (0.5B fp32 on DirectML, 2x to 4x slower than CPU on real prompts) passes, as it
should: the canary detects an unusable accelerator, not a slow one. Slowness is surfaced through Decision 6.

**Failure categories** are the spec's three: `unusable-reply` (unparseable, wrong shape, empty), `timeout`,
`inference-error`.

## Decision 4: Cap the canary at 12 output tokens, which is what keeps the failing path under 15 s

**Decision**: `maxNewTokens = 12`. The valid reply is 4 tokens on both shipped models; a pretty-printed variant is about
10, so 12 leaves slack without letting a broken accelerator run long.

**Rationale**: A broken accelerator emits garbage until the cap, so the cap sets the cost of the failing path. The measured
failing rates were 0.68 s per token (Qwen3 fp32, DirectML) and about 1 s per token (Qwen3 fp16, iGPU). At the 32 tokens of
the first experiment the failing path cost 18 to 20 s, over SC-005's 15 s.

**Measured with the final code** (2026-10-17, reference laptop, real `LocalProvider`, fresh process per load):
three loads of Qwen3-1.7B fp32 on DirectML, the failing configuration, took **13.5, 13.9 and 14.1 s** to verify and
ended ready on CPU with `unusable-reply`. That is inside SC-005's 15 s, but with only about 1 s of margin: this
was higher than the 8 to 13 s this decision first estimated, because prefill and the first accelerated run add to
the 12 garbage tokens. The cap cannot be raised without breaking the budget on this machine; if a tighter budget
is ever wanted, lowering it is the lever, bounded below by the roughly 10 tokens a pretty-printed valid reply
needs. Healthy configuration: 20 loads of Qwen2.5-0.5B fp32 on DirectML all passed (0 false fallbacks, SC-003;
20 of 20 identical outcomes, SC-004), verification 0.9 to 1.8 s (median 1.65 s).

**Alternatives considered**: a stopping criterion that ends generation at the first token that cannot begin a valid reply.
Rejected: `engine.generate()` exposes none, and the cap already bounds the cost.

## Decision 5: Wait for a timed-out canary to settle, and dispose the rejected engine, before loading CPU

**Decision**: If the canary times out, its generation cannot be aborted (the runtime exposes no abort signal; see
`specs/013-ai-enhancement-viability` research Decision 7). The provider awaits that generation's settlement, swallowing its
outcome, before loading the CPU engine. The 12-token cap bounds the wait. Whether the canary failed or timed out, the
rejected engine is then released via an optional `dispose()` on `TextGenerationEngine`, backed by the pipeline's own
`dispose()`, before the CPU engine loads.

**Rationale**: Without the wait, orphaned accelerator work competes with the CPU engine load, the same hazard
`013` FR-017 closed for inference. Without disposal, the failed accelerated model stays resident while the CPU copy loads;
for the default model that is two copies of 6.6 GB. `pipeline.dispose()` exists in `@huggingface/transformers` 4.3.1
(`src/pipelines/_base.js`).

**Alternatives considered**: relying on garbage collection. Rejected: the sessions hold native memory that the JS heap does
not account for.

## Decision 6: Throughput is one coarse, end-to-end sample, labelled as such

**Decision**: `tokensPerSecond` = output tokens (counted with the model's own tokenizer through an optional
`countTokens()` on the engine) divided by the canary's wall time, including prompt prefill. It is reported only when
verification passed and the accelerator is in use. The status field is documented as a coarse canary sample, not a
benchmark.

**Rationale**: It meets FR-009 with no extra inference. It has two known biases, both recorded rather than hidden
(constitution XIV): it includes an 80-token prefill against only 4 generated tokens, and it is a cold run. The same
DirectML configuration measured 1.35 s cold against 0.61 s warm, so the reported figure can read about half the steady
state. It is good enough to show an order of magnitude and to notice that a verified accelerator is not obviously faster.

**Reading the figure.** On its own, `3.0` tokens/s means little, and the status deliberately does not compare against CPU
(that would need a CPU baseline, which the spec excludes). The documentation therefore lists reference rates measured the
same way (4 output tokens over the whole canary, including an 80-token prefill) on the reference laptop on 2026-10-17:

| Configuration | End-to-end canary rate |
| --- | --- |
| Qwen2.5-0.5B, CPU | about 8.9 tokens/s (4 tokens in 0.45 s) |
| Qwen3-1.7B, CPU | about 2.9 tokens/s (4 tokens in 1.4 s) |
| Qwen2.5-0.5B, DirectML, as the product reports it (20 loads) | median about 4.0 tokens/s, range 2.2 to 4.5 (0.9 to 1.8 s) |

A reader who sees roughly 4 tokens/s on the 0.5B model can therefore tell it is well below the CPU reference, even though
the check passed.

**Alternatives considered**:

- *Run the canary twice and report the warm run*: contradicts FR-001's "exactly one" for a modest gain.
- *Report the provider's existing observed-rate estimate*: it is character-based and measures real traffic, not the
  device; mixing it in would make the field mean two things.
- *Report nothing derived and let users read duration*: does not meet FR-009.

## Decision 7: Keep runtime names out of the shared contract (constitution VI)

**Decision**: `ReadinessState` gains `inferenceDevice: "cpu" | "accelerator"`, an optional free-text
`acceleratorLabel` (for example `"DirectML"`) produced behind the provider boundary, an optional `acceleratorAdapter`, and
an optional `acceleratorVerification` object. The status response adds the matching fields. The label is produced in the
provider, never exposes the library's device string, and is limited to what was measured: `"DirectML"` on Windows and the
generic `"Accelerator"` everywhere else. A platform-to-vendor mapping (Linux CUDA, macOS CoreML) was considered and
rejected: the existing claim in `docs/configuration.md` is not supported by the library source. For the generic `gpu`
request `@huggingface/transformers` filters to `webgpu`, `cuda` and `dml` (`src/backends/onnx.js`), so macOS resolves to
WebGPU, not CoreML, and CUDA applies only on Linux x64. Reporting an unmeasured name would present an inference as fact
(constitution XIV). The platform-claim errors in the docs and the `resolveAcceleratorDevice()` comment are corrected as
part of this feature (tasks T024, T027 to T029).

**Rationale**: Constitution VI says the domain layer must not depend on ONNX Runtime, WebGPU or a specific inference
technology. A union of `"dml" | "cuda" | "coreml"` in `shared-domain` would put runtime vocabulary into the canonical
contract; a neutral enum plus an opaque label gives the user the same information.

**Adapter identity (FR-010)**: the runtime exposes no adapter name, so `acceleratorAdapter` is never populated today and
the status reports `null`. The field exists so that the spec's "reported as not available" is a real, honest value and a
future runtime that does expose a name needs one assignment. It is the only field with no current producer; see
Complexity Tracking.

## Decision 8: Live status only; no persistence change

**Decision**: The new readiness fields are in-memory. `ReadinessTracker` still records transitions to the diagnostics
repository, but only the existing columns.

**Rationale**: `aiDiagnosticsRepository` stores readiness in fixed columns (`state`, `reason`, model, the two accelerator
flags), and `lastKnownReadiness` is documented as historical only. Verification results describe the current process's load
and are meaningless after a restart (the spec's Verification result entity is "never persisted across restarts"), so a
schema migration would add cost for no consumer.

## Decision 9: No new configuration, no frontend change

**Decision**: The canary has no environment variable. Its time bound is the existing `AI_INFERENCE_TIMEOUT_MS`. The
frontend is untouched.

**Rationale**: Nothing under `frontend/src` reads `/api/ai/status` or either accelerator field (searched), so the spec's
"visible in status" is satisfied by the API, which is also how the fallback in 004 FR-008 is visible today. The spec
forbids a new setting, and a tunable canary would invite exactly the per-machine tuning the verification replaces.

## Decision 10: Existing tests that enable the accelerator must change; nothing else does

**Decision**: Only `backend/tests/unit/ai/localProvider.accelerator.test.ts` enables `useAccelerator: true` with a fake
engine. Its second test returns `gpu:<input>` from `generate`, which is not JSON, so under the new behavior it would
correctly fall back. That test's fake engine is updated to answer the canary. Every other test, including the
`aiStatus.test.ts` integration tests, passes unmodified (SC-006).

**Rationale**: Searched for `useAccelerator: true` and `AI_USE_ACCELERATOR` under `backend/tests` and `backend/src`. The
real-model tests only read the variable from the environment and are opt-in.

## Decision 11: Version the canary, and guard its calibration with an opt-in real-model test

**Decision**: The canary carries `ACCELERATOR_CANARY_VERSION = 1`, recorded in the verification result and the log line.
`backend/tests/integration/localProvider.real.test.ts` gains an opt-in case that runs the canary on CPU against the
configured model and asserts it passes.

**Rationale**: Constitution XXIII treats prompts that change behavior as versioned assets. The measurements in Decision 2
show the wording is load-bearing: two natural phrasings fail on a shipped model. The opt-in test is the regression guard
for it, and it stays out of the ordinary suite (constitution XXI, CLAUDE.md section 16).

## Residual risks

- **False fallback on a future model** that does not follow the copy instruction: the fallback is visible and safe (CPU),
  and the real-model test would catch it for the configured model.
- **A verified accelerator that is still slow or poor on real prompts** (0.5B fp32 on DirectML is correct but slower):
  intentionally not acted on; Decision 6's figure and the documentation address it.
- **GPU numerical nondeterminism across runs**: greedy decoding with a 4-token expected reply made repeats identical in
  every measurement, but this was not checked across driver versions.
- **Measurements are from one machine.** That is why the product verifies at run time instead of encoding a conclusion, and
  why the documentation states the conditions of the measurement.
