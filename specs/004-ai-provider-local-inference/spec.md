# Feature Specification: AI Provider & Local Inference Foundation

**Feature Branch**: `004-ai-provider-local-inference`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "AP-004 — AI Provider & Local Inference Foundation"

## Clarifications

### Session 2026-08-29

- Q: When the local model is already loading or busy handling another request, how should a new inference request be handled? → A: Queue the request and process it once the current one finishes (serial processing).
- Q: Should a single inference request have a maximum wait time (timeout) after which it is treated as a failure? → A: Yes, a configurable timeout with a sensible default.
- Q: If the local model fails to load (e.g., a corrupted cache), should ApiPilot automatically retry loading it, or require explicit user action? → A: Do not auto-retry; surface the failure and require explicit user action to retry.
- Q: If a hardware accelerator is explicitly enabled in configuration but is not actually available at runtime, should ApiPilot automatically fall back to CPU inference? → A: Automatically fall back to CPU and surface a visible notice that acceleration is unavailable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run AI-Powered Features Fully Offline On the Local Machine (Priority: P1)

As a QA engineer who cannot send confidential API specifications outside my machine, I
need ApiPilot's AI capabilities to run against a model on my own machine, so I can benefit
from AI-enhanced features without any contract details leaving my machine.

**Why this priority**: Local-first AI is a foundational product commitment. Every
downstream AI-powered feature (semantic test scenarios, workflow suggestions, failure
analysis) depends on a working local inference path existing first, and it must
genuinely avoid contacting external services.

**Independent Test**: Can be fully tested by enabling local-only mode, disconnecting from
the network after the local model is cached, issuing an inference request, and confirming
it completes successfully with no outbound calls to any AI vendor.

**Acceptance Scenarios**:

1. **Given** local-only mode is enabled and the local model is already cached, **When** an
   AI-powered capability requests inference with no internet access available, **Then**
   the request completes using the local model without contacting any external service.
2. **Given** local-only mode is enabled and the local model has not yet been
   downloaded/cached, **When** inference is requested, **Then** the system clearly reports
   that the model needs to be provisioned rather than silently failing or contacting a
   cloud provider.
3. **Given** local-only mode is enabled, **When** any AI-powered request is made, **Then**
   no network call to any AI vendor occurs at any point in the request lifecycle.

---

### User Story 2 - Know Whether AI Capabilities Are Ready Before Relying on Them (Priority: P2)

As a QA engineer or developer, I want to see whether the local AI model is loaded and
healthy before I rely on AI-enhanced features, so I am not surprised by failures in the
middle of a workflow.

**Why this priority**: Once offline inference works (P1), the next most valuable thing is
visibility into its lifecycle state, since AI-enhanced features (AP-005+) will need to
check readiness before invoking inference and communicate that state to the user.

**Independent Test**: Can be tested independently by starting the application, checking
readiness before, during, and after model load, and confirming each state (not-loaded,
loading, ready, unavailable) is reported with a clear reason when applicable.

**Acceptance Scenarios**:

1. **Given** the application has just started, **When** AI readiness is checked, **Then**
   the system reports whether local inference is not-loaded, loading, ready, or
   unavailable.
2. **Given** the local model fails to load, **When** readiness is checked, **Then** a
   specific, actionable reason is shown instead of a generic failure.
3. **Given** the model finishes loading successfully after being in a loading state,
   **When** readiness is checked again, **Then** the reported state updates to ready.

---

### User Story 3 - Build and Test AI-Enhanced Features Without Depending on a Real Model (Priority: P3)

As a developer building AI-enhanced features on top of this foundation, I want a
deterministic mock AI provider available, so automated tests stay fast, reliable, and
reproducible without depending on model downloads or non-deterministic model output.

**Why this priority**: Once real inference (P1) and readiness reporting (P2) exist,
downstream feature development and its automated tests need a way to exercise
AI-dependent code paths deterministically, independent of the real model.

**Independent Test**: Can be tested independently by pointing an AI-dependent code path at
the mock provider, sending the same request twice, and confirming identical structured
output both times without any real model being loaded.

**Acceptance Scenarios**:

1. **Given** an automated test exercises an AI-dependent feature, **When** the test runs,
   **Then** a mock provider is used and no real model is downloaded or loaded.
2. **Given** the mock provider is used, **When** the same structured input is sent twice,
   **Then** the same structured output is returned both times.
3. **Given** a feature depends only on the AIProvider abstraction, **When** the underlying
   provider is swapped between mock and local implementations via configuration, **Then**
   the feature's code requires no changes.

---

### User Story 4 - Select the Initial Local Model Using Evidence (Priority: P4)

As an engineer responsible for choosing the initial local model, I want a benchmarking
harness that evaluates candidate models against representative ApiPilot workloads, so the
model choice is based on measured evidence rather than assumption.

**Why this priority**: This is a one-time (or infrequent) engineering activity rather than
a runtime capability end users interact with directly, so it is valuable but least urgent
relative to the other stories, which are prerequisites for any AI-powered feature to exist
at all.

**Independent Test**: Can be tested independently by running the harness against two or
more candidate models with representative sample inputs and confirming it reports
comparable metrics for each, without requiring any other AI-powered feature to be built.

**Acceptance Scenarios**:

1. **Given** two or more candidate local models, **When** the benchmarking harness runs
   against a representative set of sample ApiPilot workloads, **Then** it reports
   comparable metrics (e.g., structured-output reliability, latency, memory consumption)
   for each candidate.
2. **Given** benchmark results for the candidates, **When** a model is selected, **Then**
   the selection criteria and metrics are recorded so the choice remains traceable and can
   be revisited later.

---

### Edge Cases

- If the local model cache is partially downloaded or corrupted, model load fails; this is
  treated as a load failure that is surfaced clearly, with no automatic retry (an explicit
  user action is required to attempt loading again).
- If an optional hardware accelerator is configured but not actually available at runtime,
  the system automatically falls back to CPU inference and surfaces a visible notice that
  acceleration is unavailable.
- If a new inference request arrives while the model is still loading or busy processing
  another request, it is queued and processed serially once the current one completes.
- If an inference request exceeds the configured timeout, it is treated as a timeout
  failure rather than left pending indefinitely.
- How does the system handle an inference request whose structured input does not conform
  to the expected request contract?
- What happens when there is insufficient disk space to cache the local model?
- How does the system behave if local-only mode is enabled but no model has ever been
  provisioned?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose a single AI provider abstraction through which all
  AI-powered features send inference requests and receive responses, so no feature
  interacts with a specific AI runtime directly.
- **FR-002**: System MUST provide a local inference provider implementation capable of
  completing an inference request entirely on the local machine, with no network access
  required once the local model is cached.
- **FR-003**: System MUST allow the local model and its storage/cache location to be
  configured without requiring code changes in features that consume the AI provider
  abstraction.
- **FR-004**: System MUST report the current readiness state of local inference (e.g.,
  not-loaded, loading, ready, unavailable) along with a reason when the state is
  unavailable or an error occurred.
- **FR-005**: System MUST cache the local model after its first successful load so that
  subsequent application starts do not require re-downloading it while offline.
- **FR-006**: System MUST support fully offline operation once the local model is cached,
  making no outbound calls to any AI vendor during inference.
- **FR-007**: System MUST NOT automatically fall back to a cloud AI provider when local
  inference fails, is unavailable, or is not configured.
- **FR-008**: System MUST perform inference on the CPU by default and MUST detect when an
  optional hardware accelerator is available, using it only when explicitly enabled by
  configuration. If an accelerator is explicitly enabled but is not actually available at
  runtime, the system MUST automatically fall back to CPU inference and surface a visible
  notice that acceleration is unavailable.
- **FR-009**: System MUST define a structured inference request/response contract that
  every AI provider implementation conforms to, independent of the underlying model or
  runtime.
- **FR-010**: System MUST surface AI inference failures (e.g., load failure, timeout,
  malformed output) as distinguishable, actionable error conditions rather than a generic
  failure.
- **FR-011**: System MUST provide a deterministic mock AI provider that returns repeatable
  structured output for a given input, for use in automated tests.
- **FR-012**: System MUST NOT implement API-specific test-scenario generation logic or API
  business rules as part of this feature; those responsibilities belong to features that
  consume the AI provider abstraction.
- **FR-013**: System MUST prevent code outside the AI infrastructure boundary from
  depending directly on the underlying local inference runtime; other features may only
  depend on the AI provider abstraction.
- **FR-014**: System MUST provide a benchmarking/evaluation mechanism that runs candidate
  local models against a representative set of sample ApiPilot workloads and reports
  comparable metrics for each candidate.
- **FR-015**: System MUST record the criteria and metrics used to select the initial local
  model so the model choice remains traceable and can be revisited later.
- **FR-016**: System MUST support substituting at least one alternate local model or
  provider configuration without changing the code of features that depend on the AI
  provider abstraction.
- **FR-017**: System MUST enforce a configurable maximum wait time (timeout) for a single
  inference request, treating a request that exceeds it as a timeout failure.
- **FR-018**: System MUST queue a new inference request when the local model is currently
  loading or processing another request, and MUST process queued requests serially rather
  than rejecting them or running them in parallel.
- **FR-019**: System MUST NOT automatically retry loading the local model after a load
  failure; it MUST surface the failure clearly and require an explicit user action to
  attempt loading again.

### Key Entities

- **AIProvider**: The abstraction representing a source of AI inference, defined by
  capability rather than runtime; every AI-powered feature depends only on this
  abstraction.
- **Inference Request**: Structured input describing the reasoning task, expected output
  shape, and any constraints for a single inference call.
- **Inference Response**: Structured, validated output returned from an inference call,
  including success/error status and any generated content.
- **Model Configuration**: Describes which local model is selected, where it is
  stored/cached, and how it should load.
- **Readiness State**: The current lifecycle status of local inference (not-loaded,
  loading, ready, unavailable) plus a human-readable reason.
- **Mock Provider**: A deterministic stand-in implementation of the AIProvider abstraction
  used for automated testing.
- **Benchmark Result**: The recorded outcome of evaluating a candidate model against
  representative workloads, including metrics and the rationale for a selection decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Once the local model is cached and local-only mode is enabled, 100% of
  AI-powered requests exercised during offline testing complete with zero outbound network
  calls to any AI vendor.
- **SC-002**: The local AI model becomes ready for inference without requiring any cloud AI
  account, subscription, or API key to be configured.
- **SC-003**: A developer can add a new AI-powered feature that consumes the AI provider
  abstraction without writing any code that references the underlying local inference
  runtime directly.
- **SC-004**: Automated test suites for AI-dependent features run to completion without
  downloading or loading a real model, using the deterministic mock provider, and produce
  identical output across repeated runs of the same test.
- **SC-005**: Across 100% of local-inference failure scenarios exercised during testing
  (unavailable, load failure, misconfiguration), the system never silently substitutes a
  cloud provider.
- **SC-006**: The initial local model selection is supported by recorded benchmark metrics
  comparing at least two candidate models across correctness/reliability, latency, and
  resource-consumption dimensions.
- **SC-007**: A QA engineer or developer can determine the current AI readiness state
  (ready, loading, or unavailable plus reason) in under 5 seconds without inspecting logs
  or source code.

## Assumptions

- The initial local inference runtime is expected to be Hugging Face Transformers.js per
  the product roadmap, but the specific runtime is an implementation detail deferred to
  `/speckit.plan`; this specification describes required capability, not the runtime
  itself.
- Local-only mode is the default and only required operating mode for this feature;
  architectural support for an optional future cloud provider is anticipated but its
  implementation is out of scope here.
- The local model is downloaded and cached during an initial setup step that has internet
  access; fully air-gapped installation (no internet access ever) is out of scope for this
  feature.
- Hardware acceleration (e.g., GPU/WebGPU) is an optional, detected capability; CPU
  inference is the guaranteed baseline and is sufficient for this feature to be considered
  complete.
- The benchmarking/evaluation harness targets a representative sample of ApiPilot
  workloads defined during planning; exhaustive evaluation across every possible OpenAPI
  specification pattern is out of scope.
- This feature establishes AI infrastructure only; it does not generate API test scenarios
  or contain any API business rules (that responsibility belongs to AP-005 and later
  features).
