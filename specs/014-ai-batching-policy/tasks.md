---

description: "Task list for 014-ai-batching-policy"
---

# Tasks: AI Batching Policy and Run Pacing

**Input**: Design documents from `/specs/014-ai-batching-policy/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are included and **not optional here**. Constitution XXI (Testability at Every
Boundary) and XXXI (Definition of Done) require automated tests for every transformation boundary this
feature touches; AI-dependent tests use scripted fake providers so the core suite never loads a real
model.

**Organization**: Tasks are grouped by user story so each can be implemented, tested, and demonstrated
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: Which user story the task serves (US1–US5)
- Every task names an exact file path

## Path Conventions

Web-app monorepo per [plan.md](./plan.md): `backend/src/`, `backend/tests/`, `frontend/src/`,
`frontend/tests/`, `packages/shared-domain/src/`.

---

## Critical context before starting

Three findings from Phase 0 change how these tasks must be executed. Read them before picking up work.

1. **Machine quiescence governs every measurement.** An initial Phase 0 pass produced non-monotonic
   results because a second backend was running inference concurrently. Any task below that measures
   timing must first confirm no other process is running local inference.
2. **`AI_PROVIDER_MODE=mock` cannot exercise AI-success paths.** The shipped mock returns
   `{"mock": true, ...}` and can never satisfy the candidate schema. Use scripted fake providers, as
   existing tests already do.
3. **Ordering constraint for US5.** The dependency prompt projection must land *before* its batching
   change. Batching first would produce more requests that each still time out — strictly worse than
   today.

---

## Phase 1: Setup

**Purpose**: Establish a trustworthy baseline and the corpus the measurement tasks need.

- [X] T001 Confirm the baseline is green by running `npm test`, `npm run lint`, and `npm run build` from the repository root; record the passing test count so later regressions are attributable
- [X] T002 [P] Add a body-heavy OpenAPI fixture at `backend/tests/fixtures/openapi/body-heavy.yaml` with at least six operations carrying request bodies of varying size (3–10 fields, including nested objects and arrays) — Phase 0's example rule rests on n=1 evidence and needs this corpus to validate against
- [X] T003 [P] Add a known-relationships fixture at `backend/tests/fixtures/dependencies/knownRelationships.ts` exposing an ApiModel whose producer/consumer relationships are enumerated in the module, so SC-013 has a measurable target

**Checkpoint**: Baseline green, corpora available.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The work bound on batch sizing, which US1 and US5 both build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add an optional `maxOperationsPerBatch` parameter to `splitOperationsIntoBatches` in `backend/src/ai/requestBatching.ts`, grouping operations in specification order into runs of at most that size before applying the existing `budgetChars` recursive halving as an upper bound, per [contracts/batch-sizing.md](./contracts/batch-sizing.md)
- [X] T005 Preserve today's behaviour when `maxOperationsPerBatch` is omitted or non-positive in `backend/src/ai/requestBatching.ts`, so the change is additive for callers not yet migrated
- [X] T006 Add unit tests in `backend/tests/unit/ai/requestBatching.test.ts` covering: 200 operations with a bound of 1 yields exactly 200 single-operation units in specification order; every operation appears in exactly one unit; identical input yields identical unit composition across repeated calls; an operation exceeding `budgetChars` is isolated into its own unit rather than merged or dropped; omitting the bound reproduces existing behaviour

**Checkpoint**: Sizing is work-bounded and deterministic; every existing test still passes.

---

## Phase 3: User Story 1 — AI enhancement contributes scenarios (Priority: P1) 🎯 MVP

**Goal**: Enhancement returns usable AI scenarios whose count scales with specification size, where it
currently returns none at any size.

**Independent Test**: Run enhancement against `backend/tests/fixtures/openapi/valid.yaml` and confirm
AI-provenance scenarios appear in the review workspace; repeat against a larger specification and
confirm the count grows with operation count.

### Tests for User Story 1

- [X] T007 [P] [US1] Add prompt-shape tests in `backend/tests/unit/testDesign/aiScenarioPrompt.test.ts` asserting a single-operation prompt contains exactly one operation, that `existingCoverage` is scoped to that operation, and that `AI_SCENARIO_RESPONSE_VERSION` is 3
- [X] T008 [P] [US1] Add conditional-example tests in `backend/tests/unit/testDesign/aiScenarioPrompt.test.ts` asserting the worked example is present for an operation with a request body and absent for one without, per [contracts/ai-prompt-contracts-v3.md](./contracts/ai-prompt-contracts-v3.md)
- [X] T009 [P] [US1] Add tests in `backend/tests/unit/testDesign/enhanceTestModel.test.ts` using a scripted fake provider asserting: one unit per operation is requested; a failing unit does not prevent later units; scenarios from successful units are retained and the run reports `partial`
- [X] T010 [P] [US1] Add a test in `backend/tests/unit/testDesign/enhanceTestModel.test.ts` asserting deterministic scenarios are present and unchanged after total AI failure (FR-022, SC-005)
- [X] T011 [P] [US1] Add a test in `backend/tests/unit/testDesign/validateAICandidate.test.ts` asserting candidates are validated against the **full** ApiModel, not the single-operation subset sent to the model — narrowing the model's view must never narrow the validator's

### Implementation for User Story 1

- [X] T012 [US1] Change `AI_SCENARIO_MAX_OUTPUT_TOKENS` from 384 to 256 in `backend/src/testDesign/aiScenarioPrompt.ts`, documenting the measurement (192 truncates the largest-body operation; 256 gives 6 of 6; a larger allowance costs nothing on easy operations because generation stops when the document closes)
- [X] T013 [US1] Increment `AI_SCENARIO_RESPONSE_VERSION` from 2 to 3 in `backend/src/testDesign/aiScenarioPrompt.ts` with a comment recording that request *scope* changed even though structure did not (XXIII)
- [X] T014 [US1] Scope the candidate ceiling in `buildAIScenarioPrompt` in `backend/src/testDesign/aiScenarioPrompt.ts` to a single operation so total requested candidates grow with specification size (FR-003)
- [X] T015 [US1] Add the conditional worked example to `buildAIScenarioPrompt` in `backend/src/testDesign/aiScenarioPrompt.ts`, included only when the operation carries a request body, as a pure function of the operation so unit derivation stays deterministic
- [X] T016 [US1] Pass `maxOperationsPerBatch: 1` from `enhanceTestModel` in `backend/src/testDesign/enhanceTestModel.ts` to `splitOperationsIntoBatches`, sourced from configuration rather than a literal so it can be raised without a code change (research.md Decision 1)
- [X] T017 [US1] Add `AI_ENHANCEMENT_OPERATIONS_PER_UNIT` (default 1) to `backend/src/ai/modelConfig.ts` and validate it at startup in `backend/src/config.ts` alongside existing AI configuration
- [X] T018 [US1] Emit a per-unit outcome log line from `backend/src/testDesign/enhanceTestModel.ts` carrying unit index, operation count, error category, and duration — never prompt or reply content (XX). The total-failure path currently returns before `enhancement_complete` logs anything, leaving no diagnostic at all
- [X] T019 [US1] Verify against a real model on a quiescent machine that all operations of `backend/tests/fixtures/openapi/valid.yaml` produce validly shaped replies, and record the result in [quickstart.md](./quickstart.md)

**Checkpoint**: Enhancement produces AI scenarios. This alone is a shippable MVP — every remaining
story improves an experience that now has a successful outcome to improve.

---

## Phase 4: User Story 2 — Progress visible, cancellation prompt (Priority: P2)

**Goal**: A long run shows continuous progress and stops promptly, keeping what it produced.

**Independent Test**: Start a run on a multi-operation specification, observe scenarios and per-unit
progress appearing incrementally, cancel mid-run, and confirm prompt settlement with results retained.

**Dependency note**: Most of this story falls out of US1 making units plural — the streaming, progress
list, and boundary-checked cancellation already exist and were only unreachable. These tasks verify
that and close the single-unit gap.

### Tests for User Story 2

- [ ] T020 [P] [US2] Add a test in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting scenarios from each completed unit reach `reviewWorkspace` before the run finishes (FR-007, SC-003)
- [ ] T021 [P] [US2] Add a test in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting a cancellation requested during a run settles at the next unit boundary, retains scenarios already generated, and reports `cancelled` rather than a failure (FR-015)
- [ ] T022 [P] [US2] Add a test in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting cancellation during the final unit does not report the run as fully successful (spec.md edge case)
- [ ] T023 [P] [US2] Add a frontend test in `frontend/tests/unit/AiEnhancementStage.test.tsx` asserting planned and settled unit counts render for a multi-unit run, and that a single-unit run still renders sensible progress rather than nothing (FR-012)

### Implementation for User Story 2

- [ ] T024 [US2] Ensure planned unit count is fixed at run start and immutable thereafter in `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`, so a run's denominator never moves while the user watches it (data-model.md: Run plan)
- [ ] T025 [US2] Update `BatchProgressList` in `frontend/src/components/AiEnhancementStage.tsx` so a single-unit run reports planned/settled counts instead of rendering nothing, closing the gap the `totalBatches <= 1` guard leaves for single-operation specifications
- [ ] T026 [US2] Confirm no `data-testid` or accessible name relied on by `frontend/tests/unit/TestGenerationWorkflowAccessibility.test.tsx` regresses, and that progress remains announced via the existing `role="status"` live region (XXXIII)

**Checkpoint**: Runs are observable and interruptible at unit granularity.

---

## Phase 5: User Story 3 — Large specifications settle at a ceiling (Priority: P2)

**Goal**: A run works through as much as it can within a known ceiling, then stops and hands over what
it produced.

**Independent Test**: Run enhancement against a specification whose work exceeds the ceiling and
confirm it settles `partial` at the ceiling with results retained and the remainder reported as not
attempted.

### Tests for User Story 3

- [ ] T027 [P] [US3] Add tests in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting that on ceiling exhaustion no further units start, remaining units record `not-attempted`, the run settles `partial`, and every scenario from completed units is retained (FR-010, SC-006)
- [ ] T028 [P] [US3] Add a test in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting a unit already in flight when the ceiling elapses runs to completion and its result is kept — the ceiling governs what is *started*, never what is discarded (spec.md edge case)
- [ ] T029 [P] [US3] Add a test in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting a run whose work fits inside the ceiling is observably identical to one with the ceiling effectively disabled (SC-006)
- [ ] T030 [P] [US3] Add a configuration test in `backend/tests/unit/ai/requestBatching.test.ts` or a config-focused test asserting an invalid `AI_ENHANCEMENT_RUN_BUDGET_MS` is rejected at startup (FR-011)

### Implementation for User Story 3

- [ ] T031 [US3] Add `AI_ENHANCEMENT_RUN_BUDGET_MS` (default 300000) to `backend/src/ai/modelConfig.ts` and validate it at startup in `backend/src/config.ts`, per [contracts/run-budget.md](./contracts/run-budget.md)
- [ ] T032 [US3] Enforce the ceiling at unit boundaries in `backend/src/testDesign/enhanceTestModel.ts` alongside the existing cancellation check, measuring elapsed time from `generatingSince` so a one-time model load is not charged to the budget
- [ ] T033 [US3] Map ceiling exhaustion to the existing `partial` stage status with the `too-slow` explanation in `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`, introducing no new `StageStatus` member (preserving 011's outcome semantics)
- [ ] T034 [P] [US3] Extend `AiEnhancementProgress` in `packages/shared-domain/src/testGenerationWorkflow.ts` with the run budget's remaining allowance, leaving every existing field unchanged
- [ ] T035 [US3] Populate the remaining allowance from `backend/src/testGenerationWorkflow/aiEnhancementStage.ts` and render it in `frontend/src/components/AiEnhancementStage.tsx` so the user can see how much of the planned work the ceiling permits (FR-012)
- [ ] T036 [P] [US3] Document `AI_ENHANCEMENT_RUN_BUDGET_MS` in `.env.example`, including that it is distinct from `AI_INFERENCE_TIMEOUT_MS` and that at ~21s per operation the 5-minute default covers roughly 14 operations

**Checkpoint**: Large specifications degrade predictably instead of running unbounded.

---

## Phase 6: User Story 4 — Hopeless work refused, failures described honestly (Priority: P3)

**Goal**: Impossible work is refused in seconds, and failure messages reflect whether a retry could
change anything.

**Independent Test**: Configure a budget under which projected work cannot fit, request enhancement,
and confirm an immediate explained refusal with no generation attempted.

### Tests for User Story 4

- [ ] T037 [P] [US4] Add a test in `backend/tests/unit/testDesign/enhanceTestModel.test.ts` asserting a not-viable configuration refuses the run with **no call to `provider.infer`** (FR-013, SC-007)
- [ ] T038 [P] [US4] Add a test asserting the refusal explanation contains no internal category literal, no implementation constant name, and no raw millisecond value, in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` (FR-021, SC-009)
- [ ] T039 [P] [US4] Add tests in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting a total unusable-output failure is not described as intermittent and offers no retry, while a `partial` run remains retryable (FR-019, FR-020, SC-010)
- [ ] T040 [P] [US4] Add a frontend test in `frontend/tests/unit/AiEnhancementStage.test.tsx` asserting no retry control renders when `failureExplanation.retryable` is false

### Implementation for User Story 4

- [ ] T041 [US4] Call `estimateViability` from `backend/src/testDesign/enhanceTestModel.ts` before generation, evaluated against a **single unit's** projected cost, and refuse the run when a unit cannot fit the per-request budget (research.md Decision 8)
- [ ] T042 [US4] Compute the viability projection against the **with-example** prompt shape in `backend/src/testDesign/enhanceTestModel.ts`, so the conditional example from T015 can never cause an under-projection on exactly the operations most at risk
- [ ] T043 [US4] Map a not-viable outcome to the existing `not-viable` branch of `explainFailure` in `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`, settling the stage `skipped` with `retryable: false`
- [ ] T044 [US4] Correct the `INVALID_RESPONSE` branch in `backend/src/testGenerationWorkflow/failureExplanation.ts` so a run where no unit succeeded is not described as intermittent and is not retryable, while a `partial` run stays retryable — the current text tells users "running enhancement again will often succeed" for a deterministically reproducible failure
- [ ] T045 [US4] Report a cancelled run's error category honestly in `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`: cancellation currently records `aiErrorCategory: "INVALID_RESPONSE"` with "AI provider returned invalid output", contradicting its own `cancelled` explanation and poisoning any log analysis

**Checkpoint**: The failure path no longer wastes the user's time or misleads them.

---

## Phase 7: User Story 5 — Dependency analysis paced the same way (Priority: P3)

**Goal**: The dependency-analysis AI pass contributes what it can and degrades to deterministic
relationships for anything it cannot complete.

**Independent Test**: Run dependency analysis against a real specification and confirm the AI pass
divides into more than one unit, that a failing unit does not discard others' relationships, and that
deterministic relationships survive every outcome.

**⚠️ ORDERING**: T047–T049 (projection) MUST land before T051 (sizing). Batching an unprojected prompt
produces more requests that each still time out — strictly worse than today (research.md Decision 6).

### Tests for User Story 5

- [ ] T046 [P] [US5] Add prompt-projection tests in `backend/tests/unit/dependencies/aiDependencyPrompt.test.ts` asserting the prompt no longer serializes the raw ApiModel, that it retains operation identity, parameters, and request/response field names and types, that it omits descriptions, examples, tags and nested detail, and that `AI_DEPENDENCY_RESPONSE_VERSION` is 2
- [ ] T047 [P] [US5] Add a test in `backend/tests/unit/dependencies/analyzeDependencies.test.ts` asserting a failing unit does not discard relationships from successful units and the pass reports `partial` (FR-030)
- [ ] T048 [P] [US5] Add a test in `backend/tests/unit/dependencies/analyzeDependencies.test.ts` asserting deterministic relationships are present and unmodified after success, partial, total failure, and budget exhaustion (FR-031, SC-012)
- [ ] T049 [P] [US5] Add a test in `backend/tests/unit/dependencies/analyzeDependencies.test.ts` asserting a relationship inferred in more than one unit resolves deterministically to a single relationship (FR-032)
- [ ] T050 [P] [US5] Add a coverage test in `backend/tests/unit/dependencies/analyzeDependencies.test.ts` using `backend/tests/fixtures/dependencies/knownRelationships.ts` asserting the chosen unit size detects no fewer relationships than single-unit sizing (SC-013)

### Implementation for User Story 5

- [ ] T051 [US5] Replace the raw `apiModel` serialization in `buildAIDependencyPrompt` in `backend/src/dependencies/aiDependencyPrompt.ts` with a contract projection carrying operation identity, parameter names/locations/types, and request/response field names and types — measured today at 9,410 characters for two operations versus 837–1,209 for a one-operation enhancement prompt
- [ ] T052 [US5] Increment `AI_DEPENDENCY_RESPONSE_VERSION` from 1 to 2 in `backend/src/dependencies/aiDependencyPrompt.ts` (XXIII)
- [ ] T053 [US5] Confirm candidates remain validated against the full `ApiModel` in `backend/src/dependencies/validateAIDependencyCandidate.ts`, so the narrowed prompt narrows only the model's view (XV)
- [ ] T054 [US5] Measure, on a quiescent machine, the largest dependency-analysis unit size whose request completes inside `AI_DEPENDENCY_TIMEOUT_MS` after the projection lands, and record the figure and method in [research.md](./research.md) Decision 7
- [ ] T055 [US5] Pass the measured `maxOperationsPerBatch` from `runAIAssistedPass` in `backend/src/dependencies/analyzeDependencies.ts` to `splitOperationsIntoBatches`, sourced from configuration (depends on T054)
- [ ] T056 [US5] Apply a run ceiling to the dependency AI pass in `backend/src/dependencies/analyzeDependencies.ts`, keeping `ANALYSIS_TIMEOUT_MS` governing only deterministic matching and workflow assembly as the recent fix established (FR-033)
- [ ] T057 [US5] Surface relationships that batching could not see as a documented limitation in `backend/src/dependencies/analyzeDependencies.ts`'s result, rather than presenting them as a confirmed absence (FR-034, XIV, XV)

**Checkpoint**: Dependency analysis contributes rather than timing out, and never loses deterministic
relationships.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T058 Validate the conditional-example rule from T015 against `backend/tests/fixtures/openapi/body-heavy.yaml` on a quiescent machine; if it does not hold, switch to always-on — **never always-off**, since truncation loses a whole unit while overhead only costs time — and record the outcome in [research.md](./research.md) Decision 3
- [ ] T059 [P] Re-measure decode throughput and confirm `AI_DECODE_MS_PER_TOKEN` still approximates reality (measured ~140 ms/token against the configured 130); the pre-flight refusal depends on it
- [ ] T060 [P] Update `.env.example` and `README.md` with the new configuration values and the practical guidance that whole-specification enhancement is practical to roughly 15–30 operations at the default ceiling
- [ ] T061 [P] Record in [plan.md](./plan.md) Complexity Tracking any figure that measurement changed, so the next feature inherits evidence rather than assumptions
- [ ] T062 Run every scenario in [quickstart.md](./quickstart.md) end to end against a real model on a quiescent machine
- [ ] T063 Run `npm test`, `npm run lint`, and `npm run build` from the repository root and confirm no regression against the T001 baseline

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — **blocks all user stories**
- **US1 (Phase 3)**: Depends on Foundational. No dependency on other stories
- **US2 (Phase 4)**: Depends on Foundational; most acceptance criteria only become observable once US1 makes units plural
- **US3 (Phase 5)**: Depends on Foundational. Independent of US2
- **US4 (Phase 6)**: Depends on Foundational; T041's single-unit projection assumes US1's uniform unit sizing
- **US5 (Phase 7)**: Depends on Foundational only — fully independent of US1–US4
- **Polish (Phase 8)**: Depends on the stories being delivered

### Critical orderings

- **T004 → everything**: the sizing parameter is the foundation
- **T015 → T042**: the conditional example must exist before the viability projection can account for it
- **T051, T052 → T054 → T055**: projection, then measurement, then sizing. Reversing this makes dependency analysis worse
- **T054 → T050**: the coverage test needs the chosen size
- **T001 → T063**: the closing regression check compares against the opening baseline

### Parallel Opportunities

- T002 and T003 in parallel (different fixture files)
- All tests within a story marked [P] in parallel (different assertions, mostly different files)
- **US1, US3, and US5 can be worked in parallel by different people** once Phase 2 completes — they touch disjoint modules (`testDesign/`, `modelConfig.ts`+`aiEnhancementStage.ts`, `dependencies/`)
- US2 and US4 are best sequenced after US1, since both observe behaviour US1 creates

---

## Parallel Example: after Phase 2

```bash
# Three developers, disjoint modules:
Developer A: US1 — backend/src/testDesign/
Developer B: US3 — backend/src/ai/modelConfig.ts, backend/src/testGenerationWorkflow/
Developer C: US5 — backend/src/dependencies/
```

```bash
# Within US1, all tests first, in parallel:
Task: "T007 prompt-shape tests in backend/tests/unit/testDesign/aiScenarioPrompt.test.ts"
Task: "T009 batching tests in backend/tests/unit/testDesign/enhanceTestModel.test.ts"
Task: "T011 full-model validation test in backend/tests/unit/testDesign/validateAICandidate.test.ts"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 US1
2. **STOP and VALIDATE**: run enhancement against a real specification and confirm AI scenarios appear
3. This is genuinely shippable on its own: it turns a feature that produces nothing into one that
   produces usable output

### Incremental delivery

1. Setup + Foundational → sizing is work-bounded
2. **US1** → enhancement works (MVP)
3. **US3** → large specifications bounded rather than endless — pair with US1 before exposing to large specs
4. **US2** → the run becomes observable and interruptible
5. **US4** → the failure path stops wasting time
6. **US5** → dependency analysis joins in

US3 is listed before US2 in delivery order despite equal priority: US1 makes runs long, and a bounded
long run matters more than a well-reported one.

---

## Notes

- Commit after each task or logical group
- Every timing task requires a quiescent machine — contended figures look authoritative and are worse
  than none
- AI-dependent tests use scripted fake providers; `AI_PROVIDER_MODE=mock` cannot exercise success paths
- No task introduces a new `StageStatus`, a new dependency, or a new architectural layer
- Out of scope throughout: operation selection, changing the default model, moving inference off the
  main thread, and the unrelated defects listed in [spec.md](./spec.md) Out of Scope
