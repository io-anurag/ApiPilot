# Feature Specification: Accelerator Verification and Visibility

**Feature Branch**: `AP-055` (the spec directory name is independent of the git branch name)

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "Accelerator verification and visibility for local AI inference (AI_USE_ACCELERATOR). Problem, measured on a Windows laptop with onnxruntime-node 1.30.0 and @huggingface/transformers 4.3.1 (DirectML): with AI_USE_ACCELERATOR=true the accelerator initializes successfully (/api/ai/status reports acceleratorActive: true) yet can silently produce unusable inference. Qwen3-1.7B (the shipped default model) returns garbage text (fp32 and fp16, on both the NVIDIA GPU and the Intel iGPU) or an empty string (fp16 on the iGPU) where CPU returns coherent JSON; Qwen2.5-0.5B fp32 is correct but 2x-4x slower than CPU on real enhancement prompts; Qwen2.5-0.5B fp16 is fast but returns off-schema JSON. Today the only accelerator safeguard (FR-008) is a fallback to CPU when the accelerator fails to LOAD, so a loaded-but-unusable accelerator is reported as healthy and batches fail or time out. Desired behavior: (1) after the accelerator loads, run one fixed deterministic canary inference (greedy decoding) and require output that parses as JSON and contains a candidates array; if the canary fails, fall back to CPU explicitly with a visible reason in the readiness state, extending FR-008; never fall back silently and never to cloud AI. (2) expose in /api/ai/status which accelerator/adapter is active and the measured throughput (tokens per second) so a user can see when the accelerator is slower than CPU would be. (3) update .env.example, docs/configuration.md and docs/architecture.md to state that the accelerator is experimental and was measured slower than CPU for the shipped models. Out of scope: making DirectML faster, choosing a DirectML adapter, fp16 support, hardcoding model or vendor denylists, and any change to the prompt or batching. Must preserve: local-first AI, the AIProvider abstraction, explicit failure with retained readiness state, FIFO queue semantics, deterministic test generation, mock-provider-by-default tests."

**Extends**: `specs/004-ai-provider-local-inference` FR-008 (accelerator fallback) and its `ai-status-api` contract.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An unusable accelerator is detected and replaced by CPU (Priority: P1)

A user enables the hardware accelerator, expecting faster local AI. On some machine and model combinations the accelerator loads without error but produces output the product cannot use (random text, an empty reply, or a reply that ignores the required structure). Today the provider still reports itself healthy, so every AI enhancement batch fails or times out and the user has no hint that the accelerator is the cause. With this feature, the provider checks the accelerator once, right after it loads, and if the check fails it switches to CPU inference on its own and says so.

**Why this priority**: This is the failure that was reported. It turns a confusing, repeatable breakage (every batch fails while status says "ready") into a working run on CPU with a clear explanation. It is the only story that changes whether AI enhancement works at all.

**Independent Test**: With a fake inference engine that returns garbage when "accelerated" and a valid reply on CPU, enable the accelerator and trigger a load. The provider ends up ready on CPU, status reports the accelerator was requested but is not active, and the status reason explains that verification failed. No real model or hardware is needed.

**Acceptance Scenarios**:

1. **Given** the accelerator is enabled and loads successfully but its verification reply is not usable, **When** the provider finishes loading, **Then** it is ready for inference on CPU, `acceleratorRequested` is true, `acceleratorActive` is false, and the status reason states that the accelerator failed verification and CPU is in use.
2. **Given** the accelerator is enabled and its verification reply is usable, **When** the provider finishes loading, **Then** the accelerator stays in use and no fallback notice is shown.
3. **Given** the accelerator is not enabled (the default), **When** the provider loads, **Then** no verification inference runs and loading time and behavior are unchanged.
4. **Given** the accelerator fails verification and the CPU engine also fails to load, **When** loading finishes, **Then** the provider is unavailable with a reason that reports the load failure, and no further attempt is made until the user explicitly asks for a retry.
5. **Given** the accelerator is enabled and inference requests arrive while verification is running, **When** verification completes, **Then** the requests are processed in arrival order on whichever device was chosen, and none is answered by an unverified accelerator.

---

### User Story 2 - A user can see which device is in use and how fast it is (Priority: P2)

A user, or a developer diagnosing slow runs, wants to know whether inference is running on CPU or an accelerator and what throughput it is getting, without reading logs. Even a verified accelerator can be slower than CPU (measured 2x to 4x slower for the shipped small model on the reference laptop), and today nothing in the product shows that. The status shows the accelerator's own throughput; the documentation supplies the CPU figure to read it against.

**Why this priority**: It does not change whether AI works, but it lets a user understand slow runs and judge whether the accelerator is worth keeping. It depends on the verification step to supply a measurement, so it follows Story 1.

**Independent Test**: With a fake engine, load the provider with and without the accelerator and read the status. Status names the device in use and, for an accelerated load, includes the throughput measured during verification.

**Acceptance Scenarios**:

1. **Given** the provider is ready on an accelerator, **When** a client reads the AI status, **Then** it shows the kind of accelerator in use and the throughput measured during verification, in tokens per second.
2. **Given** the provider is ready on CPU, **When** a client reads the AI status, **Then** it shows CPU as the device in use and no accelerator throughput.
3. **Given** the runtime does not reveal which physical adapter is in use, **When** a client reads the status, **Then** the adapter identity is reported as not available rather than guessed.
4. **Given** a client was written against the previous status shape, **When** it reads the new status, **Then** every existing field has the same meaning and type as before.

---

### User Story 3 - The documentation states the accelerator is experimental and often slower (Priority: P3)

A person configuring ApiPilot reads the configuration reference and the example environment file. Today these present the accelerator as a straightforward speed option. After this feature they state that it is experimental, that it was measured slower than CPU for the models ApiPilot ships, under what conditions, and what the product does when verification fails.

**Why this priority**: It sets honest expectations before anyone turns the setting on, but it changes no behavior, so it ranks last.

**Independent Test**: Read the three named documents and confirm each says the accelerator is experimental, reports the measured comparison with its conditions, and describes the verification and the visible fallback.

**Acceptance Scenarios**:

1. **Given** a reader opens the example environment file, **When** they reach the accelerator setting, **Then** its comment says the setting is experimental and may be slower than CPU, and points to where the active device is shown.
2. **Given** a reader opens the configuration reference and the architecture document, **When** they read about the accelerator, **Then** both describe the verification step, the visible CPU fallback, and the measured comparison with its hardware and model conditions.

---

### Edge Cases

- **Verification does not finish in time**: it is bounded by the configured inference time limit; a timeout counts as a failed verification and triggers the CPU fallback.
- **Verification reply is valid but trivial** (for example an empty candidate list): it passes. The check detects an unusable accelerator, not a poor model, and an empty candidate list is already a valid reply in the scenario contract.
- **Accelerator verified, but real prompts run slowly**: no automatic action is taken. Measured throughput is shown so the user can decide; making the accelerator faster is out of scope.
- **User asks to retry after a failure**: verification runs again as part of the retried load, and a repeat failure falls back to CPU again with the same visible reason. There are no hidden background retries.
- **Mock provider in use**: no accelerator exists, so no verification runs, and status behaves as it does today.
- **Verification fails on a machine where the accelerator was enabled on purpose** (for example for a benchmark): the fallback still happens and is visible. The user cannot force an unusable accelerator to stay active.
- **Sensitive content**: the verification input is a fixed, non-sensitive text, and neither it nor the reply is logged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When an accelerator is explicitly enabled and loads successfully, the system MUST run exactly one verification inference on it before the provider reports itself ready for inference.
- **FR-002**: The verification input MUST be fixed and its decoding deterministic, so that the same configuration gives the same pass or fail result on every run; it MUST be bounded by the configured inference time limit and a small output limit.
- **FR-003**: The verification MUST pass only when the reply parses as a JSON object containing a `candidates` array. Any other reply (unparseable, missing the array, empty), a timeout, or an inference error MUST count as a failure.
- **FR-004**: On a failed verification the system MUST switch to CPU inference and report the provider ready with the accelerator requested but not active, and a non-empty reason saying the accelerator failed verification and CPU is in use. This extends 004 FR-008, which covered only an accelerator that fails to load.
- **FR-005**: If CPU inference cannot be loaded after a failed verification, the provider MUST report itself unavailable with a reason, retain that state, and attempt nothing further until the user explicitly asks to retry (004 FR-019).
- **FR-006**: The system MUST NOT fall back to a cloud or other external provider at any point in this flow (004 FR-007).
- **FR-007**: When the accelerator is not enabled, the system MUST NOT run a verification inference, and loading behavior MUST be unchanged. The mock provider MUST be unaffected.
- **FR-008**: Inference requests received during loading and verification MUST be queued and processed in arrival order, and the provider MUST remain in the loading state until the device decision is made.
- **FR-009**: The AI status MUST report the kind of device in use (CPU or the accelerator type) and, when an accelerator is in use, the throughput measured during verification in tokens per second. These additions MUST be optional and additive: no existing status field changes meaning or type.
- **FR-010**: The AI status MUST report the physical adapter identity only when the runtime exposes it; otherwise it MUST say the identity is not available. It MUST NOT guess or infer it.
- **FR-011**: The system MUST record the verification outcome in server diagnostics using only the outcome, a failure category, the duration, the device kind and the model identifier. It MUST NOT log the verification input or reply.
- **FR-012**: The example environment file, the configuration reference and the architecture document MUST describe the accelerator as experimental, state that it was measured slower than CPU for the shipped models along with the hardware, model and date of that measurement, describe the verification and the visible fallback, and give the CPU throughput measured the same way as a reference for reading the reported throughput figure.
- **FR-013**: The verification, the fallback and the status reporting MUST be testable without a real model, a GPU or network access, using a fake inference engine. Any test that uses a real model or accelerator MUST remain explicitly opt-in.
- **FR-014**: A user-requested retry of loading MUST repeat verification when an accelerator is enabled.

### Out of Scope

- Making the accelerator faster, or tuning its configuration.
- Choosing, ranking or pinning a particular accelerator adapter.
- Support for half-precision model variants.
- Hardcoded allow or deny lists of models, vendors or devices.
- Any change to the scenario prompt, batching, retry or run-budget behavior.
- Measuring a CPU baseline to compute a direct accelerator-versus-CPU comparison in the status.

### Key Entities

- **Verification result**: the outcome of the one-off accelerator check. Attributes: pass or fail; a failure category (unusable reply, timeout, inference error); duration; measured throughput in tokens per second. Produced at load time, never persisted across restarts.
- **Readiness state** (existing, extended): the provider's explicit state and reason. Gains the device kind in use and, for an accelerated load, the measured throughput. Existing fields keep their meaning.
- **Accelerator fallback notice**: the human-readable reason carried in the readiness state when CPU is in use although an accelerator was requested, distinguishing a load failure from a verification failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a configuration where the enabled accelerator fails the verification (for example the measured configurations that produce unusable output), 100% of AI enhancement runs execute on CPU, and none of their batches fail because of an unusable accelerator reply. A configuration that passes the verification but degrades on longer prompts is outside this criterion (see Assumptions).
- **SC-002**: 100% of accelerator-to-CPU fallbacks, whether from a load failure or a failed verification, are visible in the AI status with a reason, without reading server logs.
- **SC-003**: On a configuration where the accelerator produces usable replies, 0 false fallbacks occur across 20 consecutive loads.
- **SC-004**: Repeating the verification on the same configuration gives the same pass or fail result in 20 out of 20 runs.
- **SC-005**: Verification adds no more than 15 seconds to the first load on the reference laptop, including the bounded wait for an abandoned verification to finish after a timeout; the pass or fail decision is made within the configured inference time limit; and verification adds nothing when the accelerator is not enabled.
- **SC-006**: Existing consumers of the AI status continue to work unchanged: all current status fields keep their meaning, and every existing status test passes without modification.
- **SC-007**: A reader of the three named documents can state, without running the product, that the accelerator is experimental, that it was measured slower than CPU for the shipped models, and what the product does when verification fails.
- **SC-008**: The verification, fallback and status reporting are covered by automated tests that run with no model download, no accelerator hardware and no network access.

## Assumptions

- **Evidence**: all measurements were taken on 2026-10-17 on one Windows laptop (Intel integrated graphics and an NVIDIA RTX 500 Ada GPU with 4 GB of VRAM), with one runtime version pair, using real scenario-enhancement prompts. Results on other machines may differ, which is why the product verifies at run time rather than hardcoding a conclusion. The results: the shipped default model returned unusable text on every accelerator configuration tried (full and half precision, both adapters), while the small model was correct at full precision but 2x to 4x slower than CPU.
- **Pass criterion scope**: the verification detects an unusable accelerator, not a poor-quality model. A reply that is valid but empty is a pass.
- **Throughput source**: the reported throughput comes from the verification inference only. It is a single sample intended for visibility, not a benchmark, and the status does not state a comparison against CPU; the documentation lists CPU reference rates measured the same way so the figure has something to be read against.
- **Residual limit**: the verification uses a very short reply, so it cannot detect an accelerator that answers short prompts correctly but degrades on long ones. Such a configuration remains visible only through slow or failing batches, the reported throughput and the documentation.
- **Device reporting**: device kind comes from what the product asked the runtime to use. Adapter identity is reported only if the runtime exposes it, which the current runtime does not. The accelerator's descriptive label is reported only for platforms where it was measured (Windows, DirectML); on other platforms it is the generic "Accelerator", because the runtime's per-platform device choice is not verified.
- **Verification input**: the fixed verification input is versioned together with the status contract change (constitution XXIII) and is separate from the scenario prompt, which is unchanged.
- **Time bound**: verification uses the existing per-request inference time limit and adds no new configuration setting.
- **Contract amendment**: extending the AI status response is justified by this concrete need and is recorded as an amendment to the `ai-status-api` contract, as `025-local-persistence-layer` did previously.
- **Privacy**: the verification input contains no user data, so it does not change the local-first privacy position (constitution V, XX).
- **Completion practice**: following repository practice, finishing this feature includes the user manual and architecture documentation, the roadmap entry, and a version bump. Changes remain uncommitted for review.
