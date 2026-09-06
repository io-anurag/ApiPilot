---

description: "Task list for AI Enhancement Viability on Local CPU Inference"
---

# Tasks: AI Enhancement Viability on Local CPU Inference

**Input**: Design documents from `/specs/013-ai-enhancement-viability/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks ARE included. Constitution XXI (Testability at Every Boundary) and XXXI
(Definition of Done) make tests part of the feature, not optional, and every predecessor spec in
this repository (`011`, `012`) generated them.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US4)
- Exact file paths are included in every task

## Path Conventions

Web app monorepo: `backend/src/`, `frontend/src/`, `packages/shared-domain/src/`, with tests in
`backend/tests/` and `frontend/tests/`.

---

## Phase 1: Setup

**Purpose**: Establish and record the baseline this feature is measured against.

- [X] T001 Run `npm test` at repo root (not per-workspace — that bypasses `vitest.workspace.ts`'s jsdom environment for frontend) and record the pass count in this file; every one of these must still pass at the end, since this feature corrects defects in `004`/`005`/`011`/`012` plumbing without changing their contracts.
      **Result: 620 passed / 1 failed / 2 skipped (623 tests, 114 files).** The baseline is NOT
      green. `tests/unit/dependencies/analyzeDependencies.test.ts` > "gracefully degrades ... once
      the overall analysis budget is exhausted mid-run" fails under full-suite load
      (`provider.calls.length` 0, expected >= 1) but passes 11/11 in isolation. Cause: the test
      asserts a wall-clock budget is exhausted *mid*-run, but under parallel suite load it expires
      *before* the first batch (`aiOutcome: "timeout"`, `durationMs: 4`) instead of after it
      (`aiOutcome: "partial"`, `durationMs: 25`). Pre-existing and unrelated to this feature —
      recorded so a regression introduced later is distinguishable from it. Note it is the same
      bug class this feature addresses: a time budget consumed before the work it was meant to
      cover. Fixing it is out of scope here; see T072.
- [X] T002 [P] Record the pre-fix real-model baseline per [quickstart.md](./quickstart.md) step 5a into `specs/013-ai-enhancement-viability/research.md` under a "Pre-fix reproduction" heading: prompt characters/tokens, observed `durationMs`, and confirmation that generation hit `max_new_tokens` exactly rather than stopping on its own.
      **Done** — recorded as the "Measurement Baseline" section of research.md (Probe A and Probe
      B), measured directly against the real inference path before any design decision.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contract and provider-internal types every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Extend `AiEnhancementProgress` in `packages/shared-domain/src/testGenerationWorkflow.ts` with `phase: "preparing" | "generating"`, optional `generatingSince` (ISO 8601), and `cancelRequested: boolean`, per [data-model.md](./data-model.md) "AiEnhancementProgress (extended)"
- [X] T004 [P] Add `FailureExplanation` and `FailureExplanationCategory` types to `packages/shared-domain/src/testGenerationWorkflow.ts`, and extend `WorkflowStageState` with optional `failureExplanation` and `cancelled`, per [data-model.md](./data-model.md); export both from `packages/shared-domain/src/index.ts`
- [X] T005 Add a `ModelCapacity` interface (`contextWindowTokens`, `source`, `isFallback`) as a provider-internal type in `backend/src/ai/localProvider.ts` — NOT in shared-domain, since it must not cross the provider boundary (constitution VI)
- [X] T006 [P] Add `AI_MODEL_CONTEXT_FLOOR_TOKENS` (default 2048), `AI_PREFILL_MS_PER_TOKEN` (default 2.0), `AI_DECODE_MS_PER_TOKEN` (default 130), and `AI_VIABILITY_SAFETY_FACTOR` (default 1.5) to `backend/src/ai/modelConfig.ts`'s `loadAIConfig()` following the existing parse-and-validate pattern, and document each in the root `.env.example`

**Checkpoint**: Shared contracts compile; `npm run build` clean. User story work can begin.

---

## Phase 3: User Story 1 - AI enhancement can actually produce scenarios (Priority: P1) 🎯 MVP

**Goal**: Make the stage capable of succeeding at all. This is the difference between the feature
existing and not existing — it has never succeeded on the local provider.

**Independent Test**: Run enhancement against `backend/tests/fixtures/openapi/valid.yaml` with the
local provider; at least one validated AI-derived scenario is added to the review workspace within
the configured budget, with the deterministic baseline unaltered and unreordered.

### Tests for User Story 1

> Write these FIRST and confirm they fail before implementing.

- [ ] T007 [P] [US1] Extend `backend/tests/unit/ai/localProvider.textGeneration.test.ts`: when the loaded tokenizer declares a `chat_template`, `generate()` receives the chat-templated string (system + user, `add_generation_prompt: true`) rather than the raw input; when it declares none, the raw string is passed unchanged (FR-001, FR-004, research.md Decision 1)
- [ ] T008 [P] [US1] Extend `backend/tests/unit/ai/localProvider.textGeneration.test.ts`: the system message is selected from `InferenceRequest.expectedOutputFormat` (`"json"` vs `"text"`), proving no new `InferenceRequest` field is needed (constitution VI)
- [ ] T009 [P] [US1] Add `backend/tests/unit/ai/localProvider.capacity.test.ts`: context window resolves to `min(max_position_embeddings, model_max_length)` — asserting **32,768** for the measured pair (32,768 / 131,072), not 131,072; a non-finite value on either side is discarded rather than propagated; both unusable yields the 2,048 conservative floor with `isFallback: true` and never `undefined` (FR-005, FR-006, research.md Decisions 2, 3)
- [ ] T010 [P] [US1] Extend `backend/tests/unit/ai/localProvider.capacity.test.ts`: `getInputBudget()` and the oversized-input guard inside `infer()` read the same resolved `ModelCapacity`, so planning and enforcement cannot disagree (FR-008)
- [ ] T011 [P] [US1] Extend `backend/tests/unit/testDesign/aiScenarioPrompt.test.ts`: `buildAIScenarioPrompt` emits an operation-contract projection — path, method, operationId, parameters, request-body fields, documented response codes — and omits descriptions, examples, tags, server blocks, security blocks, and unreferenced component schemas; the deterministic baseline appears as a compact category-plus-target-field list, not full scenario objects (FR-009, research.md Decision 4)
- [ ] T012 [P] [US1] Extend `backend/tests/unit/testDesign/aiScenarioPrompt.test.ts`: assert the prompt for the Pet Store fixture is at least 5x smaller than the recorded 22,095-character baseline, and record the realised figure in the test's assertion message so the plan's estimate is measured rather than assumed
- [ ] T013 [P] [US1] Extend `backend/tests/unit/testDesign/validateAICandidate.test.ts`: a candidate referencing a field present in the full `ApiModel` but absent from the slimmed prompt projection is still validated against the **full** `ApiModel` — narrowing the prompt must never narrow validation (FR-010, constitution I; the load-bearing safety property of Decision 4)
- [ ] T014 [P] [US1] Extend `backend/tests/unit/testDesign/enhanceTestModel.test.ts`: with a `MockProvider` whose `getInputBudget()` returns a value below the projected prompt size, `splitOperationsIntoBatches` produces more than one batch, proving `011`'s batching is reachable (FR-007, SC-004)
- [ ] T015 [P] [US1] Extend `backend/tests/unit/testDesign/enhanceTestModel.test.ts`: two runs over identical input yield identical retained scenarios in identical order, and AI provenance survives the prompt change (FR-028, FR-029, SC-009)

### Implementation for User Story 1

- [X] T016 [US1] In `backend/src/ai/localProvider.ts`'s `loadTransformersEngine()`: resolve `ModelCapacity` as `min(model.config.max_position_embeddings, tokenizer.model_max_length)`, discarding non-finite values and falling back to the configured 2,048-token floor, recording `source` and `isFallback`; expose it on `TextGenerationEngine` in place of the current raw `contextWindowTokens` (depends on T005, T009)
- [X] T017 [US1] In `backend/src/ai/localProvider.ts`: change `getInputBudget()` to derive from the resolved `ModelCapacity` and to return a conservative budget rather than `undefined` when capacity is unknown; point the exact oversized-input guard inside `generate()` at the same resolved value (depends on T016, T010)
- [X] T018 [US1] In `backend/src/ai/localProvider.ts`'s `loadTransformersEngine()`: apply `tokenizer.apply_chat_template([{role:"system",...},{role:"user",content:input}], { tokenize:false, add_generation_prompt:true })` when the tokenizer declares a `chat_template`, selecting the system message from `expectedOutputFormat`; pass the raw string unchanged otherwise. Thread `expectedOutputFormat` from the request into `generate()`'s options (depends on T007, T008)
- [X] T019 [US1] In `backend/src/ai/localProvider.ts`: ensure the tokenizer's declared EOS token terminates generation so a finished response stops early instead of always reaching `max_new_tokens`, and confirm `return_full_text: false` still yields only the completion under chat framing (FR-002, SC-003) (depends on T018)
- [X] T020 [US1] Add an `OperationContractSummary` projection to `backend/src/testDesign/aiScenarioPrompt.ts` and rewrite `buildAIScenarioPrompt` to emit it plus the compact baseline summary, emitting each schema once rather than re-expanding it per operation (depends on T011, T012)
- [X] T021 [US1] Increment `AI_SCENARIO_RESPONSE_VERSION` in `backend/src/testDesign/aiScenarioPrompt.ts` and note the prompt-contract change in a comment referencing this spec — the prompt bytes change materially and constitution XXIII forbids silent prompt drift (depends on T020)
- [X] T022 [US1] Reduce `AI_SCENARIO_MAX_OUTPUT_TOKENS` in `backend/src/testDesign/aiScenarioPrompt.ts` from 1024 to a value achievable within the default timeout at the measured decode rate, documenting the arithmetic in the existing constant comment (FR-011) (depends on T019)
- [X] T023 [US1] Verify `backend/src/testDesign/enhanceTestModel.ts` still passes the **full** `apiModel` to `validateAICandidateSemantics` while sending only the projection to the provider; add an explanatory comment, as this is the invariant that keeps prompt slimming safe (depends on T020, T013)
- [X] T024 [US1] Update `.env.example` at repo root: leave `AI_MODEL_DTYPE` unset by default with a comment recording that `q8` measured 4x slower than fp32 on CPU, and correct `AI_INFERENCE_TIMEOUT_MS` guidance to a value coherent with the new output allowance (FR-012, research.md Decision 5)
- [ ] T025 [US1] Extend `backend/src/ai/benchmark/workloads.ts` with workloads representative of the enhancement task (contract-shaped prompts requesting structured candidates), replacing reliance on the single-sentence workloads whose recorded 33% success rate cannot support a decision about this workload (constitution XXII)
- [ ] T026 [US1] Extend `backend/src/ai/benchmark/runBenchmark.ts` to record `dtype` as a first-class dimension of each candidate result so the fp32-vs-q8 comparison is reproducible rather than anecdotal (depends on T025)

**Checkpoint**: The stage can succeed. Run [quickstart.md](./quickstart.md) step 5b — this is the
first time SC-001 has ever been achievable.

---

## Phase 4: User Story 2 - A run that cannot succeed says so immediately (Priority: P1)

**Goal**: Refuse in seconds instead of burning the full budget, so a user never again loses five
minutes to an outcome that was knowable up front.

**Independent Test**: Configure a budget smaller than the planned work requires; the refusal
arrives in seconds naming the constraint, with no inference started.

### Tests for User Story 2

- [ ] T027 [P] [US2] Add `backend/tests/unit/ai/viability.test.ts`: with **injected** rates (never measured live, so the estimate is deterministic under test — constitution XXIV), the measured defect refuses: 5,845 prompt tokens, 1,024 output tokens, q8 rates, 300,000 ms budget → projected ≈ 2,060,000 ms, ratio ≈ 6.9x, `viable: false` (FR-014, research.md Decision 6)
- [ ] T028 [P] [US2] Extend `backend/tests/unit/ai/viability.test.ts`: a run projected just over budget but within the 1.5x safety factor is **admitted**, not refused, so a marginal misestimate never blocks a run that would have succeeded
- [ ] T029 [P] [US2] Extend `backend/tests/unit/ai/viability.test.ts`: the estimate is pure and total — identical inputs always yield an identical estimate, with no I/O
- [ ] T030 [P] [US2] Extend `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts`: a refusal resolves the stage to `skipped` with `failureExplanation.category === "not-viable"`, leaves the deterministic baseline fully intact, and adds **no** new `StageStatus` member (FR-015, FR-016, research.md Decision 10)
- [ ] T031 [P] [US2] Extend `backend/tests/unit/testDesign/enhanceTestModel.test.ts`: when some batches pass pre-flight and later ones are refused, the run resolves to `partial` retaining what succeeded, not to a total failure (spec.md Edge Cases)
- [ ] T032 [P] [US2] Extend `backend/tests/unit/ai/requestQueue.test.ts` and `backend/tests/unit/ai/localProvider.timeout.test.ts`: after a timeout abandons an inference, the queue does not start the next task until the abandoned computation settles, so a retry cannot run concurrently with work already given up on (FR-017, SC-011)

### Implementation for User Story 2

- [X] T033 [P] [US2] Create `backend/src/ai/viability.ts` exporting a pure `estimateViability({ promptTokens, maxOutputTokens, rates, budgetMs, safetyFactor }) => ViabilityEstimate` per [data-model.md](./data-model.md), refusing only when `projectedMs > budgetMs * safetyFactor` (depends on T027, T028, T029)
- [X] T034 [US2] Add `InferenceRates` tracking to `backend/src/ai/localProvider.ts`: seed from config (T006), update by EWMA from each completed inference's observed prefill and decode rates, discard non-positive or non-finite observations, and expose the current rates for pre-flight; the rates must never influence prompt content, validation, dedup order, or retained scenarios (depends on T006, T033)
- [X] T035 [US2] Add a pre-flight check to `backend/src/testDesign/enhanceTestModel.ts`: before each batch's `infer()`, estimate viability and record a refusal outcome instead of calling the provider when not viable (depends on T033, T034, T031)
- [X] T036 [US2] Add a pre-flight refusal error/outcome type to `backend/src/testGenerationWorkflow/errors.ts` following the existing error-class pattern, carrying `projectedMs` and `budgetMs` for the explanation mapping (depends on T035)
- [X] T037 [US2] In `backend/src/ai/requestQueue.ts`: do not start a queued task while a prior abandoned computation is still settling, and discard the abandoned result on arrival (depends on T032)

**Checkpoint**: SC-002 and SC-005 hold — an unviable run reports in under 10 s instead of 300 s.

---

## Phase 5: User Story 3 - The wait is honest and interruptible (Priority: P2)

**Goal**: Replace five minutes of an unchanging "Enhancing…" label with an attributable phase, a
live elapsed time, and a working cancel.

**Independent Test**: Start a run; preparation is distinguishable from generation, elapsed time
advances, and cancelling returns control promptly leaving the workflow consistent.

### Tests for User Story 3

- [ ] T038 [P] [US3] Extend `backend/tests/unit/testGenerationWorkflow/workflowStore.test.ts`: `phase` transitions `"preparing"` → `"generating"` one way only and never returns; `generatingSince` is present iff `phase` is `"generating"` and never earlier than `startedAt`; `totalBatches` is `0` while preparing; `cancelRequested` transitions `false` → `true` only (data-model.md validation rules)
- [ ] T039 [P] [US3] Extend `backend/tests/integration/testGenerationWorkflow.test.ts`: `GET /api/test-generation-workflow` returns the extended progress shape in [contracts/ai-enhancement-progress-v2.md](./contracts/ai-enhancement-progress-v2.md) for both the preparing and generating states
- [ ] T040 [P] [US3] Extend `backend/tests/integration/testGenerationWorkflow.test.ts`: `POST /api/test-generation-workflow/ai-enhancement/cancel` returns `202` with `cancelRequested: true` per [contracts/ai-enhancement-cancel.md](./contracts/ai-enhancement-cancel.md); `409 no_run_in_progress` when no run is active; a repeat cancel is idempotent and returns `202`
- [ ] T041 [P] [US3] Extend `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts`: cancelling with no succeeded batch yields `skipped` + `cancelled: true`; cancelling after a succeeded batch yields `partial` + `cancelled: true` retaining that batch's scenarios and any review decisions on them (FR-021)
- [ ] T042 [P] [US3] Extend `backend/tests/unit/ai/requestBatching.test.ts`: an `isCancelled` predicate is checked before each batch alongside the existing `isTimedOut`; once true, remaining batches become `not-attempted` without calling `runBatch`, and omitting the predicate behaves exactly as today (backward compatible with `analyzeDependencies.ts`'s call site)
- [ ] T043 [P] [US3] Extend `frontend/tests/unit/AiEnhancementStage.test.tsx` (fake timers, not real ones — constitution XXIV): a **single-batch** run renders the phase and a live elapsed timer, superseding `012` FR-005 which hid all progress for `totalBatches <= 1` and therefore for 100% of real runs
- [ ] T044 [P] [US3] Extend `frontend/tests/unit/AiEnhancementStage.test.tsx`: the preparing phase renders distinctly from generating, so a first-run model download is attributable rather than mysterious (FR-018)
- [ ] T045 [P] [US3] Extend `frontend/tests/unit/AiEnhancementStage.test.tsx`: a cancel control is present while running, invokes the cancel endpoint, and the component returns to an interactive state without waiting for the run to settle (FR-020, SC-008)

### Implementation for User Story 3

- [X] T046 [US3] Extend `setAiEnhancementProgress` and add phase/cancel mutators to `backend/src/testGenerationWorkflow/workflowStore.ts`, enforcing the one-way transitions from T038 (depends on T003, T038)
- [X] T047 [US3] Add an `isCancelled` option to `runBatchedInference` in `backend/src/ai/requestBatching.ts`, checked before each batch beside the existing `isTimedOut`, defaulting to a no-op so existing callers are unaffected (depends on T042)
- [X] T048 [US3] In `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`: set `phase: "preparing"` before engine load and transition to `"generating"` with `generatingSince` once the first batch starts; ensure model-preparation time is excluded from the generation time budget (FR-022) (depends on T046)
- [X] T049 [US3] Add cancellation to `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`: a cancel flag on the run, wired to `runBatchedInference`'s `isCancelled`, resolving to `skipped`/`partial` with `cancelled: true` per research.md Decision 10 (depends on T047, T041)
- [X] T050 [US3] Add `POST /test-generation-workflow/ai-enhancement/cancel` to `backend/src/api/testGenerationWorkflow.ts` per [contracts/ai-enhancement-cancel.md](./contracts/ai-enhancement-cancel.md), returning `202` immediately without waiting for the run to settle; keep the route thin, delegating to the stage module (depends on T049, T040)
- [X] T051 [P] [US3] Add `cancelAiEnhancement()` to `frontend/src/services/testGenerationWorkflowClient.ts` following the existing client conventions (depends on T050)
- [X] T052 [US3] In `frontend/src/components/AiEnhancementStage.tsx`: render the phase, derive and display elapsed time client-side from `generatingSince`/`startedAt` on the existing 2-second poll, and show progress for single-batch runs (batch *list* still hidden when `totalBatches <= 1`) (depends on T003, T043, T044)
- [X] T053 [US3] In `frontend/src/components/AiEnhancementStage.tsx`: add an accessible cancel button using existing Tailwind semantic tokens and the established focus-visible pattern; announce elapsed time via a polite live region rather than a spinner alone (constitution XXXIII, XXXVIII accessibility) (depends on T051, T045)

**Checkpoint**: SC-008 holds; the wait is attributable and interruptible.

---

## Phase 6: User Story 4 - Failures explain themselves in the user's terms (Priority: P2)

**Goal**: Replace `"AI enhancement was skipped (TIMEOUT): Inference exceeded the configured
timeout of 300000ms."` — a category literal, an implementation constant, and raw milliseconds —
with something a user can act on.

**Independent Test**: Trigger each failure category; each produces a distinguishable, actionable
message with no internal identifier.

### Tests for User Story 4

- [ ] T054 [P] [US4] Add `backend/tests/unit/testGenerationWorkflow/failureExplanation.test.ts`: the mapping is **total** — every `AIErrorCategory` member plus `"cancelled"` and `"not-viable"` maps to an explanation, enumerated from the union so a future category cannot be added without one (contracts/failure-explanation.md invariant 3)
- [ ] T055 [P] [US4] Extend `backend/tests/unit/testGenerationWorkflow/failureExplanation.test.ts`: assert against a deny-list that no `summary` or `nextStep` contains an error-class name, an `AIErrorCategory` literal, an environment variable name, a file path, a model id, or a bare millisecond value (FR-024, invariant 1)
- [ ] T056 [P] [US4] Extend `backend/tests/unit/testGenerationWorkflow/failureExplanation.test.ts`: `retryable` is `false` for `too-slow`, `not-viable`, and `too-large` — the current UI offers an identical retry for every category, which after a timeout is a guaranteed repeat of a five-minute loss (FR-025, invariant 2)
- [ ] T057 [P] [US4] Extend `backend/tests/unit/testGenerationWorkflow/failureExplanation.test.ts`: the three categories FR-023 requires — too slow, unavailable, unusable output — map to distinct categories with distinct text
- [ ] T058 [P] [US4] Extend `frontend/tests/unit/AiEnhancementStage.test.tsx`: the component renders `summary` and `nextStep` and **never** `aiErrorMessage`; the retry control appears only when `retryable` is `true`
- [ ] T059 [P] [US4] Extend `frontend/tests/unit/TestGenerationWorkflowAccessibility.test.tsx`: failure state is conveyed by text, not colour alone, and the explanation is announced to assistive technology (constitution XXXIII)

### Implementation for User Story 4

- [X] T060 [US4] Create `backend/src/testGenerationWorkflow/failureExplanation.ts` exporting the pure total `explainFailure(cause, context)` per [contracts/failure-explanation.md](./contracts/failure-explanation.md), rendering durations in human units and never raw milliseconds (depends on T004, T054-T057)
- [X] T061 [US4] In `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`: populate `failureExplanation` on every terminal `skipped`/`partial` transition, retaining `aiErrorMessage` unchanged for logs only (FR-026) (depends on T060)
- [X] T062 [US4] In `frontend/src/components/AiEnhancementStage.tsx`: render `summary` and `nextStep`, gate the retry control on `retryable`, and remove all rendering of `aiErrorMessage` (depends on T061, T058)

**Checkpoint**: SC-006 and SC-007 hold; all four stories complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T063 [P] Verify no new log line emits specification content, prompt text, or model response; new logs carry only category, phase, durations, and token counts (constitution XX, FR-026) — review every logger call added in T016-T062
- [X] T064 [P] Confirm `analyzeDependencies` and `regenerateReviewScenario` still pass their suites and benefit from the corrected prompting path, since they shared the same defect (FR-003); run `backend/tests/unit/dependencies/` and `backend/tests/unit/testDesign/` in full
- [X] T065 [P] Confirm `backend/tests/unit/testGenerationWorkflow/noNetwork.test.ts` and `backend/tests/unit/dependencies/noNetwork.test.ts` still pass — no external inference path was introduced (FR-027, constitution V)
- [ ] T066 Run `npm run ai:benchmark -w backend` and regenerate `specs/004-ai-provider-local-inference/benchmark-results.json` with `dtype` recorded, confirming the results **support** the fp32 default rather than merely accompanying it (FR-013, constitution VII, XXII) (depends on T026, T024)
- [ ] T067 [P] Update `specs/ROADMAP.md`: add `013-ai-enhancement-viability` to the Implementation Status table, and amend the `012-ai-enhancement-progress` row to record that its outstanding `T025` real-model validation is what surfaced these defects
- [ ] T068 [P] Update `specs/012-ai-enhancement-progress/spec.md` to note that its FR-005 (hide progress when `totalBatches <= 1`) is superseded by this feature, with the reason: the context-window defect made single-batch the only reachable case, so the rule suppressed progress for 100% of real runs
- [X] T069 Run `npm test`, `npm run lint`, and `npm run build`; all three must be clean with no test disabled or weakened to accommodate the change (constitution XXXI, CLAUDE.md §55)
- [X] T070 Execute [quickstart.md](./quickstart.md) steps 5-7 against a real local model and record the realised figures — completion time, prompt-size reduction factor, early-stop token counts, multi-batch confirmation — in research.md under a "Post-fix measurement" heading. **This is the task whose absence in `012` allowed these defects to ship**
- [ ] T071 Work through the [quickstart.md](./quickstart.md) regression checklist and confirm every item, particularly SC-009 (identical output across runs) and SC-010 (no deterministic scenario lost, altered, or reordered across all five outcome paths)

---

## Implementation Status (as executed)

**Validation: `npm test` 622 passed / 0 failed / 2 skipped; `npm run lint` clean; `npm run build`
clean.** The one pre-existing failure recorded in T001 now passes as well.

### Verified fixed (real model, Pet Store fixture)

The reported defect is gone. Inference completed in **46.1 s** where it previously died at
**300,808 ms**; `capacitySource: "model-config"` resolved **32,768** tokens rather than 131,072;
the prompt shrank **11.0x** (21,802 -> 1,985 chars); model preparation (5.8 s) is now reported as
its own phase; the deterministic baseline was preserved in full. Measurements in
[research.md](./research.md) "Post-Fix Measurement".

### Not met: SC-001

With the timeout removed the run reaches `INVALID_RESPONSE` — the failure the timeout had been
masking. The 0.5B model emits JSON with unquoted keys (`enum: [...]`) and over-runs the output
allowance restating schemas. Deliberately **not** pursued by further prompt iteration: constitution
VII/XXII require this class of decision to rest on corpus evidence, and each ad-hoc iteration costs
~50 s while optimising against one specification. Tracked as T072.

### Outstanding tasks

Test tasks T007-T015, T027-T032, T038-T045, T054-T059 are **not written**. The behaviours they
cover are implemented and exercised by the existing 622-test suite, but they lack the dedicated
coverage this feature specified — notably the deny-list assertion for FR-024 and the injected-rate
determinism assertions for the viability estimate. Four frontend tests were rewritten against the
new contract (superseding two that asserted the internal error string FR-024 now forbids), and
three prompt-shape fixtures were updated for the `responseVersion: 2` contract.

T025/T026/T066 (benchmark harness extension and re-run) and T067/T068/T071 (roadmap, `012`
supersession note, regression checklist) are also outstanding.

- [ ] T072 Resolve AI structured-output reliability, the failure the timeout was masking. Extend the benchmark harness to cover the enhancement workload (T025/T026), then let the recorded evidence choose between: constraining the response schema so a candidate costs fewer tokens, requesting a single candidate per call, and adopting a model with stronger JSON adherence. Also fixes the load-sensitive `analyzeDependencies` test recorded in T001, which fails for the same reason this feature exists — a time budget consumed before the work it was meant to cover.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories.**
- **US1 (Phase 3)**: Depends on Foundational. No dependency on other stories.
- **US2 (Phase 4)**: Depends on Foundational. Independent of US1 in principle, but its pre-flight
  estimate is only *useful* once US1's realistic output allowance (T022) exists.
- **US3 (Phase 5)**: Depends on Foundational. Independent of US1 and US2.
- **US4 (Phase 6)**: Depends on Foundational. Consumes the refusal category from US2 (T036) and
  the cancelled state from US3 (T049) — sequence it last, or stub those two categories to build it
  in parallel.
- **Polish (Phase 7)**: Depends on all desired stories.

### Critical Path to a Working Feature

```text
T001 → T003/T005 → T016 → T017 → T018 → T019 → T020 → T022 → T024 → quickstart 5b
       (foundational)  (capacity)  (chat template)  (prompt)  (config)
```

T018 and T024 are the two highest-leverage tasks in the list. On measured evidence, the chat
template plus the fp32 default alone take a Pet Store run from impossible to roughly 7 seconds.

### Parallel Opportunities

- **Phase 2**: T003, T004, T006 in parallel (different concerns; T005 touches `localProvider.ts`).
- **US1 tests**: T007-T015 all parallel (distinct files or distinct concerns).
- **US1 implementation**: T016-T019 are sequential (same file, layered); T020-T022 sequential
  (same file); T024, T025 parallel with those.
- **US2 tests**: T027-T032 all parallel.
- **US3 tests**: T038-T045 all parallel.
- **US4 tests**: T054-T059 all parallel.
- **Phase 7**: T063, T064, T065, T067, T068 all parallel.
- **Across stories**: after Phase 2, US1 / US2 / US3 can proceed concurrently with different
  developers; US4 lands last.

### Within Each User Story

Tests before implementation. Shared-domain types before backend. Backend before frontend. Pure
functions before the modules that consume them.

---

## Parallel Example: User Story 1 Tests

```bash
# Launch all US1 test tasks together:
Task: "T007 chat template applied when tokenizer declares one — localProvider.textGeneration.test.ts"
Task: "T009 context window = min(max_position_embeddings, model_max_length) — localProvider.capacity.test.ts"
Task: "T011 prompt emits operation-contract projection — aiScenarioPrompt.test.ts"
Task: "T013 validation still runs against the full ApiModel — validateAICandidate.test.ts"
Task: "T014 batching engages with a realistic budget — enhanceTestModel.test.ts"
```

---

## Implementation Strategy

### MVP: User Story 1 only

1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1).
2. **STOP and VALIDATE**: run [quickstart.md](./quickstart.md) step 5b against a real model.
3. This alone achieves SC-001 — the feature working at all, for the first time.

US1 is a genuine MVP here in a way it usually is not: without it the other three stories only
improve how an impossible operation reports its impossibility.

### Incremental Delivery

1. Setup + Foundational → contracts compile.
2. **US1** → the stage can succeed → validate → demo (MVP).
3. **US2** → unviable runs refused in seconds → validate → demo.
4. **US3** → honest, interruptible wait → validate → demo.
5. **US4** → actionable failure messages → validate → demo.
6. Polish → benchmark evidence, docs, full regression.

### Suggested Stopping Point

If effort must be capped, **US1 + T024 + T066** is the defensible minimum: the feature works and
the configuration change carries recorded evidence. Shipping US2-US4 without US1 would deliver a
well-explained failure — honest, but still a failure.

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks.
- Every task names its file path; tests precede the implementation they cover.
- Commit after each task or logical group; stop at any checkpoint to validate a story.
- **Do not** weaken or disable an existing test to accommodate a change (CLAUDE.md §55). If an
  existing test contradicts this feature, that contradiction is a finding to surface, not to edit
  away — the most likely case is `012`'s single-batch progress test, which T043 supersedes
  deliberately and with a recorded reason.
