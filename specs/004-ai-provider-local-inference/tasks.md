---

description: "Task list template for feature implementation"
---

# Tasks: AI Provider & Local Inference Foundation

**Input**: Design documents from `/specs/004-ai-provider-local-inference/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required for user stories), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: This feature is AI infrastructure governed by constitution XXI (Testability at
Every Boundary — every AI-dependent test path must work against a deterministic mock
without a real model), XIV (No Silent Assumptions), and III/IV (AI output must be
structured, validated, and never silently authoritative), so test tasks are included for
the queue, readiness state machine, timeout/accelerator-fallback behavior, the status
endpoint contract, the mock provider, and the benchmark report invariants, in addition to
one real-model test gated behind an explicit opt-in.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Extends the AP-001–AP-003 web application monorepo (per [plan.md](./plan.md) Project Structure):

- `backend/src/ai/`, `backend/src/ai/benchmark/`, `backend/src/api/`, `backend/tests/`
- `packages/shared-domain/src/`
- Root: `README.md`

No new frontend code is introduced by this feature (plan.md Technical Context).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the new runtime dependency and shared test fixtures needed before any AI infrastructure logic exists

- [X] T001 Add the `@huggingface/transformers` dependency to `backend/package.json` (Primary Dependencies, plan.md) and run install
- [X] T002 [P] Create `backend/tests/fixtures/ai/sampleInferenceRequests.ts`: a small set of representative `InferenceRequest` fixtures (text and json `expectedOutputFormat` variants) reused by the queue, timeout, accelerator-fallback, mock-provider, and benchmark tests

**Checkpoint**: Dependency installed and fixtures available for all later test tasks

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core domain types and shared infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Define `AIProviderMode`, `AIProvider`, `InferenceRequest`, `InferenceResponse`, `AIErrorCategory`, `ReadinessState`, `ModelConfig`, `MockProviderConfig`, `BenchmarkCandidateResult`, and `BenchmarkReport` types in `packages/shared-domain/src/aiProvider.ts` per [data-model.md](./data-model.md), and re-export them from `packages/shared-domain/src/index.ts`
- [X] T004 [P] Implement `modelConfig.ts` in `backend/src/ai/modelConfig.ts`: env-driven loader for `AI_PROVIDER_MODE` (`local`/`mock`), `AI_MODEL_ID`, `AI_MODEL_CACHE_DIR` (default `~/.apipilot/models`), `AI_INFERENCE_TIMEOUT_MS` (default `60000`), and `AI_USE_ACCELERATOR` (default `false`), mirroring the existing `backend/src/config.ts` loader convention (depends on T003)
- [X] T005 [P] Implement `errors.ts` in `backend/src/ai/errors.ts`: an `AIProviderError` helper that builds an error `InferenceResponse` from a closed `AIErrorCategory` value, used consistently by every provider implementation (depends on T003)

**Checkpoint**: Domain types and shared config/error infrastructure ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Run AI-Powered Features Fully Offline On the Local Machine (Priority: P1) 🎯 MVP

**Goal**: A local `AIProvider` implementation completes an inference request entirely on
the local machine once the model is cached, with zero required network access, serialized
request handling, a configurable timeout, and automatic-with-notice CPU fallback when an
enabled accelerator is unavailable.

**Independent Test**: Enable local-only mode, cache the model, disconnect from the
network, call `infer()`, and confirm it completes successfully with no outbound calls;
call `infer()` before the model is cached and confirm a clear, non-silent report rather
than a generic failure or a cloud-provider call.

### Tests for User Story 1

- [X] T006 [P] [US1] Unit tests for `requestQueue.ts` in `backend/tests/unit/ai/requestQueue.test.ts`: a second enqueued call does not start until the first resolves, and queued calls run in FIFO order (FR-018) (uses fixtures from T002)
- [X] T007 [P] [US1] Unit tests for `readiness.ts` in `backend/tests/unit/ai/readiness.test.ts`: verifies `not-loaded → loading → ready` and `→ unavailable` transitions, that `unavailable` always carries a non-empty `reason` (FR-004), and that a failed load never auto-transitions back to loading without an explicit retry call (FR-019)
- [X] T008 [P] [US1] Unit tests for per-request timeout behavior in `backend/tests/unit/ai/localProvider.timeout.test.ts`, using an injectable slow inference function (no real model): a call exceeding `inferenceTimeoutMs` resolves with `errorCategory: "TIMEOUT"` rather than hanging (FR-017) (uses fixtures from T002)
- [X] T009 [P] [US1] Unit tests for accelerator-fallback behavior in `backend/tests/unit/ai/localProvider.accelerator.test.ts`, using an injectable/fake accelerator-initialization function (no real hardware): when accelerator initialization throws, the provider falls back to CPU and reports `acceleratorRequested: true, acceleratorActive: false` with a non-empty reason (FR-008)
- [X] T010 [US1] Real-model integration test in `backend/tests/integration/localProvider.real.test.ts`, gated behind an explicit opt-in environment flag (e.g., only runs when `AI_TEST_REAL_MODEL=1`) so it is excluded from the default `npm test` run (constitution XXI): loads the configured model, runs one inference call, and confirms zero outbound network calls once cached (FR-002, FR-006, SC-001)

### Implementation for User Story 1

- [X] T011 [P] [US1] Implement `readiness.ts` in `backend/src/ai/readiness.ts`: a state-machine object exposing `getState()`, `markLoading()`, `markReady(modelId)`, and `markUnavailable(reason)`, enforcing that `unavailable` always carries a reason and that no method silently re-attempts a load (FR-004, FR-019) (depends on T003)
- [X] T012 [P] [US1] Implement `requestQueue.ts` in `backend/src/ai/requestQueue.ts`: a minimal in-process FIFO async queue that serializes calls to an injected async function, with no external broker (FR-018, constitution XXVII) (depends on T003)
- [X] T013 [US1] Implement `localProvider.ts` in `backend/src/ai/localProvider.ts`: wraps `@huggingface/transformers`, using `modelConfig.ts` for model id/cache dir (T004), `readiness.ts` (T011) for lifecycle state, `requestQueue.ts` (T012) to serialize `infer()` calls, an `AbortController`/`Promise.race`-based per-request timeout defaulting from config and overridable via `InferenceRequest.timeoutMs` (FR-017), and accelerator-enabled-but-unavailable → automatic CPU fallback recorded visibly in `ReadinessState` (FR-002, FR-003, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-018, FR-019) (depends on T004, T005, T011, T012)
- [X] T014 [US1] Confirm and document (inline comment) that `localProvider.ts` is the only module importing `@huggingface/transformers`, makes no network call once cached in local-only mode, and never substitutes a cloud provider on failure (FR-006, FR-007, FR-013); assert this in T010 (depends on T013)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently (MVP)

---

## Phase 4: User Story 2 - Know Whether AI Capabilities Are Ready Before Relying on Them (Priority: P2)

**Goal**: A QA engineer or developer can query the current AI readiness state (and reason,
when applicable) via a simple HTTP endpoint before relying on an AI-powered feature.

**Independent Test**: Start the application, check readiness before, during, and after
model load via `GET /api/ai/status`, and confirm each state is reported with a clear
reason when applicable.

### Tests for User Story 2

- [X] T015 [P] [US2] Integration test for `GET /api/ai/status` in `backend/tests/integration/aiStatus.test.ts` using an injected fake `AIProvider`: covers `not-loaded`, `loading`, `ready`, and `unavailable` (with a non-empty `reason`) responses matching [contracts/ai-status-api.md](./contracts/ai-status-api.md), and confirms the endpoint returns `200` (never a raw exception) even in the `unavailable` case (constitution XIX)

### Implementation for User Story 2

- [X] T016 [US2] Implement `GET /api/ai/status` route in `backend/src/api/aiStatus.ts`: calls the active `AIProvider.getReadiness()` and maps it to the response shape in [contracts/ai-status-api.md](./contracts/ai-status-api.md), catching any internal error into a `5xx` JSON response rather than throwing (constitution XIX, XX) (depends on T013)
- [X] T017 [US2] Register the `/api/ai/status` route in `backend/src/app.ts` (depends on T016)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Build and Test AI-Enhanced Features Without Depending on a Real Model (Priority: P3)

**Goal**: A deterministic mock `AIProvider` is available so AI-dependent automated tests
never need to download or load a real model, and features depending only on the
`AIProvider` abstraction can swap providers with no code changes.

**Independent Test**: Point an AI-dependent code path at the mock provider, send the same
structured input twice, and confirm identical structured output both times with no real
model loaded.

### Tests for User Story 3

- [X] T018 [P] [US3] Unit tests for `mockProvider.ts` in `backend/tests/unit/ai/mockProvider.test.ts`: identical input yields byte-identical output across repeated calls, `provider` is always `"mock"`, and no network/model-loading activity occurs (FR-011, SC-004) (uses fixtures from T002)
- [X] T019 [P] [US3] Unit test in `backend/tests/unit/ai/providerSwap.test.ts` confirming a small test harness function that only depends on the `AIProvider` interface behaves identically whether passed the mock provider or a fake local-provider stub, with zero changes to the harness function (SC-003)

### Implementation for User Story 3

- [X] T020 [US3] Implement `mockProvider.ts` in `backend/src/ai/mockProvider.ts`: derives `content` deterministically from a stable hash of `InferenceRequest.input` and `expectedOutputFormat` (research.md #8), always reports `getReadiness()` as `"ready"`, and never imports Transformers.js or touches the network (FR-011) (depends on T003, T005)
- [X] T021 [US3] Implement a provider factory in `backend/src/ai/index.ts` that selects between `localProvider.ts` and `mockProvider.ts` based on `modelConfig.ts`'s `AI_PROVIDER_MODE` (defaulting to `mock` for the test environment), and update `backend/src/api/aiStatus.ts` to use the factory instead of a hard-coded provider (FR-016) (depends on T013, T016, T020)

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently; the default `npm test` run exercises only the mock provider

---

## Phase 6: User Story 4 - Select the Initial Local Model Using Evidence (Priority: P4)

**Goal**: A benchmarking harness evaluates a shortlist of candidate local models against
representative sample workloads and records comparable metrics plus a traceable selection
rationale.

**Independent Test**: Run the harness against two or more candidate models with
representative sample inputs and confirm it reports comparable metrics for each, without
requiring any other AI-powered feature to exist.

### Tests for User Story 4

- [X] T022 [P] [US4] Unit tests for `report.ts` in `backend/tests/unit/ai/benchmark/report.test.ts`: building a `BenchmarkReport` succeeds only when `selectedModelId` matches one entry in `candidates` (data-model.md Validation Rules), and fails validation otherwise

### Implementation for User Story 4

- [X] T023 [P] [US4] Define representative sample workloads in `backend/src/ai/benchmark/workloads.ts`: a small, versioned (`workloadSetId`) set of structured/JSON-shaped generation prompts representative of future AI-enhanced features, containing no OpenAPI-specific business logic (research.md #2, FR-012)
- [X] T024 [US4] Implement `report.ts` in `backend/src/ai/benchmark/report.ts`: builds and validates a `BenchmarkReport` from a list of `BenchmarkCandidateResult`s plus a `selectedModelId` and `selectionRationale` (FR-015) (depends on T003, T022)
- [X] T025 [US4] Implement `runBenchmark.ts` in `backend/src/ai/benchmark/runBenchmark.ts`: runs the candidate shortlist from [research.md](./research.md) #2 against `workloads.ts`, measuring structured-output success rate, average latency, and peak memory per candidate, and writes the resulting `BenchmarkReport` to `specs/004-ai-provider-local-inference/benchmark-results.json` (FR-014) (depends on T004, T023, T024)
- [X] T026 [US4] Add an `ai:benchmark` npm script to `backend/package.json` that invokes `runBenchmark.ts` (depends on T025)
- [X] T027 [US4] Run the benchmarking harness once against the shortlist, set the selected model as the default `AI_MODEL_ID` in `modelConfig.ts`, and commit the resulting `benchmark-results.json` for traceability (FR-015, SC-006) (depends on T025, T026) — run 2026-09-04 after fixing two wrong Phi-3 repo ids in the shortlist (research.md #2 outcome); `onnx-community/Qwen2.5-0.5B-Instruct` confirmed as the selected default

**Checkpoint**: All four user stories should now be independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T028 [P] Add an "AI Provider & Local Inference Foundation" section to root `README.md` documenting the new environment variables, `GET /api/ai/status`, the mock-provider default for tests, and how to run `npm run ai:benchmark -w backend`
- [X] T029 [P] Add a short module-doc comment in `backend/src/ai/localProvider.ts` enumerating the logging fields used (`requestId`, `modelId`, stage, `durationMs`, `errorCategory`) and confirming no raw prompt/response content is logged by default (constitution XX)
- [ ] T030 Execute the full [quickstart.md](./quickstart.md) validation checklist end-to-end and confirm every item passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion only
- **User Story 2 (Phase 4)**: Depends on Foundational completion; its route (T016) depends on the local `AIProvider` instance introduced in US1 (T013)
- **User Story 3 (Phase 5)**: Depends on Foundational completion; T021 generalizes the provider selection introduced by US1/US2 (T013, T016) to include the mock provider
- **User Story 4 (Phase 6)**: Depends on Foundational completion (T004 for config); independent of US1-US3's runtime code paths, since it invokes candidate models directly
- **Polish (Phase 7)**: Depends on all four user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories
- **User Story 2 (P2)**: Builds on the `AIProvider` instance introduced by US1 — independently testable once its own tasks are done (its integration test uses an injected fake provider, not a real model)
- **User Story 3 (P3)**: Builds on the provider-selection point introduced by US1/US2 — independently testable once its own tasks are done
- **User Story 4 (P4)**: Independent of US1-US3; only depends on Foundational config

### Within Each User Story

- Tests before implementation (T006-T010 before T011-T014; T015 before T016-T017; T018-T019 before T020-T021; T022 before T023-T027)
- Shared/domain types before consumers
- Config/error/readiness/queue primitives before the local provider that composes them
- Story complete before moving to the next priority

### Parallel Opportunities

- T004 and T005 (Foundational) can run in parallel once T003 exists
- T006-T009 (US1 tests) can be written in parallel once T002 fixtures exist
- T011 and T012 (US1 implementation) can run in parallel once T003 exists
- T018 and T019 (US3 tests) can run in parallel with each other
- T022 (US4 test) can run in parallel with US1-US3 work
- T023 (US4 workloads) can run in parallel with US1-US3 work
- T028 and T029 in Polish can run in parallel

---

## Parallel Example: Foundational + User Story 1

```bash
# Foundational primitives, independent files:
Task: "Implement modelConfig.ts in backend/src/ai/modelConfig.ts"
Task: "Implement errors.ts in backend/src/ai/errors.ts"

# User Story 1 primitives, independent files (once T003 exists):
Task: "Implement readiness.ts in backend/src/ai/readiness.ts"
Task: "Implement requestQueue.ts in backend/src/ai/requestQueue.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Call `infer()` directly against the local provider with the
   model cached and the network disconnected, and confirm it succeeds; call it before the
   model is cached and confirm a clear, non-silent report
5. This is a demoable MVP: "ApiPilot can run AI inference entirely on the local machine,
   with zero cloud dependency"

### Incremental Delivery

1. Complete Setup + Foundational → domain types and shared config/error infrastructure ready
2. Add User Story 1 → Validate manually → Demo (MVP! local inference works offline)
3. Add User Story 2 → Validate manually → Demo (readiness is checkable via `/api/ai/status`)
4. Add User Story 3 → Validate manually → Demo (AI-dependent tests run without a real model)
5. Add User Story 4 → Validate manually → Demo (the initial model choice is evidence-based, not assumed)
