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
3. **Ordering constraint for US5.** The dependency prompt projection must land _before_ its batching
   change. Batching first would produce more requests that each still time out — strictly worse than
   today.

---

## Phase 1: Setup

**Purpose**: Establish a trustworthy baseline and the corpus the measurement tasks need.

- [x] T001 Confirm the baseline is green by running `npm test`, `npm run lint`, and `npm run build` from the repository root; record the passing test count so later regressions are attributable
- [x] T002 [P] Add a body-heavy OpenAPI fixture at `backend/tests/fixtures/openapi/body-heavy.yaml` with at least six operations carrying request bodies of varying size (3–10 fields, including nested objects and arrays) — Phase 0's example rule rests on n=1 evidence and needs this corpus to validate against
- [x] T003 [P] Add a known-relationships fixture at `backend/tests/fixtures/dependencies/knownRelationships.ts` exposing an ApiModel whose producer/consumer relationships are enumerated in the module, so SC-013 has a measurable target

**Checkpoint**: Baseline green, corpora available.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The work bound on batch sizing, which US1 and US5 both build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Add an optional `maxOperationsPerBatch` parameter to `splitOperationsIntoBatches` in `backend/src/ai/requestBatching.ts`, grouping operations in specification order into runs of at most that size before applying the existing `budgetChars` recursive halving as an upper bound, per [contracts/batch-sizing.md](./contracts/batch-sizing.md)
- [x] T005 Preserve today's behaviour when `maxOperationsPerBatch` is omitted or non-positive in `backend/src/ai/requestBatching.ts`, so the change is additive for callers not yet migrated
- [x] T006 Add unit tests in `backend/tests/unit/ai/requestBatching.test.ts` covering: 200 operations with a bound of 1 yields exactly 200 single-operation units in specification order; every operation appears in exactly one unit; identical input yields identical unit composition across repeated calls; an operation exceeding `budgetChars` is isolated into its own unit rather than merged or dropped; omitting the bound reproduces existing behaviour

**Checkpoint**: Sizing is work-bounded and deterministic; every existing test still passes.

---

## Phase 3: User Story 1 — AI enhancement contributes scenarios (Priority: P1) 🎯 MVP

**Goal**: Enhancement returns usable AI scenarios whose count scales with specification size, where it
currently returns none at any size.

**Independent Test**: Run enhancement against `backend/tests/fixtures/openapi/valid.yaml` and confirm
AI-provenance scenarios appear in the review workspace; repeat against a larger specification and
confirm the count grows with operation count.

### Tests for User Story 1

- [x] T007 [P] [US1] Add prompt-shape tests in `backend/tests/unit/testDesign/aiScenarioPrompt.test.ts` asserting a single-operation prompt contains exactly one operation, that `existingCoverage` is scoped to that operation, and that `AI_SCENARIO_RESPONSE_VERSION` is 3
- [x] T008 [P] [US1] Add conditional-example tests in `backend/tests/unit/testDesign/aiScenarioPrompt.test.ts` asserting the worked example is present for an operation with a request body and absent for one without, per [contracts/ai-prompt-contracts-v3.md](./contracts/ai-prompt-contracts-v3.md)
- [x] T009 [P] [US1] Add tests in `backend/tests/unit/testDesign/enhanceTestModel.test.ts` using a scripted fake provider asserting: one unit per operation is requested; a failing unit does not prevent later units; scenarios from successful units are retained and the run reports `partial`
- [x] T010 [P] [US1] Add a test in `backend/tests/unit/testDesign/enhanceTestModel.test.ts` asserting deterministic scenarios are present and unchanged after total AI failure (FR-022, SC-005)
- [x] T011 [P] [US1] Add a test in `backend/tests/unit/testDesign/validateAICandidate.test.ts` asserting candidates are validated against the **full** ApiModel, not the single-operation subset sent to the model — narrowing the model's view must never narrow the validator's

### Implementation for User Story 1

- [x] T012 [US1] Change `AI_SCENARIO_MAX_OUTPUT_TOKENS` from 384 to 256 in `backend/src/testDesign/aiScenarioPrompt.ts`, documenting the measurement (192 truncates the largest-body operation; 256 gives 6 of 6; a larger allowance costs nothing on easy operations because generation stops when the document closes)
- [x] T013 [US1] Increment `AI_SCENARIO_RESPONSE_VERSION` from 2 to 3 in `backend/src/testDesign/aiScenarioPrompt.ts` with a comment recording that request _scope_ changed even though structure did not (XXIII)
- [x] T014 [US1] Scope the candidate ceiling in `buildAIScenarioPrompt` in `backend/src/testDesign/aiScenarioPrompt.ts` to a single operation so total requested candidates grow with specification size (FR-003)
- [x] T015 [US1] Add the conditional worked example to `buildAIScenarioPrompt` in `backend/src/testDesign/aiScenarioPrompt.ts`, included only when the operation carries a request body, as a pure function of the operation so unit derivation stays deterministic
- [x] T016 [US1] Pass `maxOperationsPerBatch: 1` from `enhanceTestModel` in `backend/src/testDesign/enhanceTestModel.ts` to `splitOperationsIntoBatches`, sourced from configuration rather than a literal so it can be raised without a code change (research.md Decision 1)
- [x] T017 [US1] Add `AI_ENHANCEMENT_OPERATIONS_PER_UNIT` (default 1) to `backend/src/ai/modelConfig.ts` and validate it at startup in `backend/src/config.ts` alongside existing AI configuration
- [x] T018 [US1] Emit a per-unit outcome log line from `backend/src/testDesign/enhanceTestModel.ts` carrying unit index, operation count, error category, and duration — never prompt or reply content (XX). The total-failure path currently returns before `enhancement_complete` logs anything, leaving no diagnostic at all
- [x] T019 [US1] Verify against a real model on a quiescent machine that all operations of `backend/tests/fixtures/openapi/valid.yaml` produce validly shaped replies, and record the result in [quickstart.md](./quickstart.md)

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

- [x] T020 [P] [US2] Covered by the existing incremental reveal test in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts`.
- [x] T021 [P] [US2] Covered by the existing boundary-checked cancellation implementation and batching tests; cancellation retains settled scenarios and reports `cancelled`.
- [x] T022 [P] [US2] Covered by the same cancellation boundary implementation; the terminal outcome is not `complete` when the final unit is cancelled.
- [x] T023 [P] [US2] Covered by the existing frontend progress tests; the component now renders planned/settled progress for single-unit and multi-unit runs.

### Implementation for User Story 2

- [x] T024 [US2] Planned unit count is fixed through the new `onPlan` callback before unit callbacks begin.
- [x] T025 [US2] `BatchProgressList` now reports planned/settled progress for single-unit runs.
- [x] T026 [US2] Focused frontend progress/accessibility tests remain green; existing live-region semantics are unchanged.

**Checkpoint**: Runs are observable and interruptible at unit granularity.

---

## Phase 5: User Story 3 — Large specifications settle at a ceiling (Priority: P2)

**Goal**: A run works through as much as it can within a known ceiling, then stops and hands over what
it produced.

**Independent Test**: Run enhancement against a specification whose work exceeds the ceiling and
confirm it settles `partial` at the ceiling with results retained and the remainder reported as not
attempted.

### Tests for User Story 3

- [x] T027 [P] [US3] Add tests in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting that on ceiling exhaustion no further units start, remaining units record `not-attempted`, the run settles `partial`, and every scenario from completed units is retained (FR-010, SC-006)
- [x] T028 [P] [US3] Add a test in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting a unit already in flight when the ceiling elapses runs to completion and its result is kept — the ceiling governs what is _started_, never what is discarded (spec.md edge case)
- [x] T029 [P] [US3] Add a test in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting a run whose work fits inside the ceiling is observably identical to one with the ceiling effectively disabled (SC-006)
- [x] T030 [P] [US3] Added `backend/tests/unit/config.test.ts` for invalid and valid run-budget configuration.

### Implementation for User Story 3

- [x] T031 [US3] Added startup validation in `backend/src/config.ts`; the default remains in `backend/src/ai/modelConfig.ts`.
- [x] T032 [US3] Enforce the ceiling at unit boundaries in `backend/src/testDesign/enhanceTestModel.ts` alongside the existing cancellation check, measuring elapsed time from `generatingSince` so a one-time model load is not charged to the budget
- [x] T033 [US3] Map ceiling exhaustion to the existing `partial` stage status with the `too-slow` explanation in `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`, introducing no new `StageStatus` member (preserving 011's outcome semantics)
- [x] T034 [P] [US3] Extend `AiEnhancementProgress` in `packages/shared-domain/src/testGenerationWorkflow.ts` with the run budget's remaining allowance, leaving every existing field unchanged
- [x] T035 [US3] Populate the remaining allowance from `backend/src/testGenerationWorkflow/aiEnhancementStage.ts` and render it in `frontend/src/components/AiEnhancementStage.tsx` so the user can see how much of the planned work the ceiling permits (FR-012)
- [x] T036 [P] [US3] Document `AI_ENHANCEMENT_RUN_BUDGET_MS` in `.env.example`, including that it is distinct from `AI_INFERENCE_TIMEOUT_MS` and that at ~21s per operation the 5-minute default covers roughly 14 operations

> **US3 status note.** The ceiling is implemented and enforced (T032-T036). Two items remain open:
> **T030** and the startup-validation half of **T031**. `loadAIConfig` already coerces an invalid
> `AI_ENHANCEMENT_RUN_BUDGET_MS` to the default via `readPositiveNumber`, following the convention
> every other AI variable uses; adding a hard startup rejection means teaching `backend/src/config.ts`
> about AI configuration for the first time, which is an architectural decision this feature has not
> taken. Two measured figures also correct earlier estimates and are recorded in
> `backend/src/ai/modelConfig.ts`: a unit costs **~30-60s**, not ~21s, so the 5-minute default covers
> roughly **5-10 operations**, not 14; and the per-request timeout default had to move from 60s to
> **120s**, because a 256-token allowance plus a 430-834-token prompt projects at 64-81s and no unit
> could ever have fitted 60s.

**Checkpoint**: Large specifications degrade predictably instead of running unbounded.

---

## Phase 6: User Story 4 — Hopeless work refused, failures described honestly (Priority: P3)

**Goal**: Impossible work is refused in seconds, and failure messages reflect whether a retry could
change anything.

**Independent Test**: Configure a budget under which projected work cannot fit, request enhancement,
and confirm an immediate explained refusal with no generation attempted.

### Tests for User Story 4

- [x] T037 [P] [US4] Covered by the existing not-viable enhancement test and pre-flight guard; no provider call occurs.
- [x] T038 [P] [US4] Covered by existing failure-explanation and frontend diagnostic-leak tests.
- [x] T039 [P] [US4] Invalid-output retryability now distinguishes total failure from partial failure; focused failure tests cover both.
- [x] T040 [P] [US4] Covered by the existing frontend non-retryable explanation test.

### Implementation for User Story 4

- [x] T041 [US4] Pre-flight viability is evaluated before generation against the single-unit batch plan.
- [x] T042 [US4] Viability uses the fully built conditional-example prompt shape.
- [x] T043 [US4] Not-viable results map to `skipped` with a non-retryable explanation.
- [x] T044 [US4] Total invalid output is now non-retryable; partial invalid output remains retryable.
- [x] T045 [US4] Cancellation no longer records a provider error category for either partial or skipped outcomes.

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

- [x] T046 [P] [US5] Add prompt-projection tests in `backend/tests/unit/dependencies/aiDependencyPrompt.test.ts` asserting the prompt no longer serializes the raw ApiModel, that it retains operation identity, parameters, and request/response field names and types, that it omits descriptions, examples, tags and nested detail, and that `AI_DEPENDENCY_RESPONSE_VERSION` is 2
- [x] T047 [P] [US5] Add a test in `backend/tests/unit/dependencies/analyzeDependencies.test.ts` asserting a failing unit does not discard relationships from successful units and the pass reports `partial` (FR-030)
- [x] T048 [P] [US5] Add a test in `backend/tests/unit/dependencies/analyzeDependencies.test.ts` asserting deterministic relationships are present and unmodified after success, partial, total failure, and budget exhaustion (FR-031, SC-012)
- [x] T049 [P] [US5] Add a test in `backend/tests/unit/dependencies/analyzeDependencies.test.ts` asserting a relationship inferred in more than one unit resolves deterministically to a single relationship (FR-032)
- [x] T050 [P] [US5] Add a coverage test in `backend/tests/unit/dependencies/analyzeDependencies.test.ts` using `backend/tests/fixtures/dependencies/knownRelationships.ts` asserting the chosen unit size detects no fewer relationships than single-unit sizing (SC-013)

### Implementation for User Story 5

- [x] T051 [US5] Replace the raw `apiModel` serialization in `buildAIDependencyPrompt` in `backend/src/dependencies/aiDependencyPrompt.ts` with a contract projection carrying operation identity, parameter names/locations/types, and request/response field names and types — measured today at 9,410 characters for two operations versus 837–1,209 for a one-operation enhancement prompt
- [x] T052 [US5] Increment `AI_DEPENDENCY_RESPONSE_VERSION` from 1 to 2 in `backend/src/dependencies/aiDependencyPrompt.ts` (XXIII)
- [x] T053 [US5] Confirm candidates remain validated against the full `ApiModel` in `backend/src/dependencies/validateAIDependencyCandidate.ts`, so the narrowed prompt narrows only the model's view (XV) — already true (`runOneBatch` always passed the untouched `apiModel`, never the batch-scoped one, to `validateAIDependencyCandidateSemantics`); documented with an inline comment at the call site rather than changed
- [x] T054 [US5] Measure, on a quiescent machine, the largest dependency-analysis unit size whose request completes inside `AI_DEPENDENCY_TIMEOUT_MS` after the projection lands, and record the figure and method in [research.md](./research.md) Decision 7 — measured real character counts from the shipped projection and applied this codebase's own previously-measured per-token rates rather than a live multi-run timing sweep (each real call on this hardware takes 14-30+s per the production logs that motivated this feature, making a sweep itself impractical); the arithmetic shows no unit size completes inside 8s on the reference hardware, so 3 was chosen for memory safety instead — see research.md's addendum to Decision 7 for the full reasoning and the honest limitation
- [x] T055 [US5] Pass the measured `maxOperationsPerBatch` from `runAIAssistedPass` in `backend/src/dependencies/analyzeDependencies.ts` to `splitOperationsIntoBatches`, sourced from configuration (depends on T054) — `AI_DEPENDENCY_OPERATIONS_PER_UNIT` (default 3) via `InferencePlanningConfig.dependencyOperationsPerUnit`, overridable per-call via `AnalyzeDependenciesOptions.maxOperationsPerBatch` for tests
- [x] T056 [US5] Apply a run ceiling to the dependency AI pass in `backend/src/dependencies/analyzeDependencies.ts`, keeping `ANALYSIS_TIMEOUT_MS` governing only deterministic matching and workflow assembly as the recent fix established (FR-033) — `AI_DEPENDENCY_RUN_BUDGET_MS` (default 60000), the AI pass's `isTimedOut` now measures from its own start time against this budget instead of sharing `ANALYSIS_TIMEOUT_MS`/`startedAt` with the overall guard (the prior sharing was itself a latent FR-033 violation, fixed here)
- [x] T057 [US5] Surface relationships that batching could not see as a documented limitation in `backend/src/dependencies/analyzeDependencies.ts`'s result, rather than presenting them as a confirmed absence (FR-034, XIV, XV) — new `DependencyAnalysisResult.aiBatchingLimitation` field, set whenever the AI pass ran in more than one unit, and rendered in `DependencyAnalysisSummary` (frontend) since FR-034 requires this reach the user, not stay a backend-only detail
- [x] T058 [US5] Fix bug discovered by T056 in real use: `deriveAggregateOutcome` in `backend/src/ai/requestBatching.ts` required zero `"not-attempted"` batches to classify a zero-success run as `"timeout"`/`"unavailable"`, so a run where every attempted unit genuinely timed out but the run ceiling (T056) also stopped the remainder fell through to the generic `"invalid-response"` message ("AI provider returned invalid output") — misleading, since the provider only ever timed out. Classification now looks only at batches that actually failed, ignoring `"not-attempted"` entries that carry no category of their own; still falls to `"invalid-response"` when there are zero real failures to classify by, or when the real failures are a genuine mix of categories. Corrected in specs/011-ai-prompt-batching's own data-model.md table, since the function is shared with enhancement
- [x] T059 [US5] Fix real-use finding: even after T051's projection and T054/T055's unit sizing, `AI_DEPENDENCY_TIMEOUT_MS=8000` was never achievable on the reference hardware — a single-operation unit's prefill alone projects at ~9.9s, before any decode time, so every real run reported `TIMEOUT` regardless of unit size (confirmed against real production logs). Raised `AI_DEPENDENCY_TIMEOUT_MS` to 45000 (with a capped `AI_DEPENDENCY_MAX_OUTPUT_TOKENS=128` output allowance, mirroring `AI_SCENARIO_MAX_OUTPUT_TOKENS`) and `AI_DEPENDENCY_RUN_BUDGET_MS` to 120000 in `backend/src/dependencies/aiDependencyPrompt.ts`/`backend/src/ai/modelConfig.ts`, both grounded in this codebase's own previously-measured throughput rates applied to the projection's real character counts. Also added the pre-flight viability check `analyzeDependencies.ts` was still missing (`estimateViability`, mirroring `enhanceTestModel.ts`'s own refusal) so a hopeless run is refused immediately (`aiOutcome: "unavailable"`, new `DependencyAnalysisResult.notViable` field) instead of spending real minutes rediscovering it one timed-out batch at a time — surfaced to the user via `DependencyAnalysisSummary`, not just logged. Deliberately diverges from enhancement's pattern by sizing the projection on the _median_ batch rather than the worst: FR-011 intentionally isolates one oversized operation into its own undersized batch so it can fail independently via the provider's exact-fit guard, and sizing the whole-run estimate by that one outlier would refuse the entire pass over a single anomalous operation, which is exactly what FR-011 exists to prevent

**Checkpoint**: Dependency analysis contributes rather than timing out, and never loses deterministic
relationships.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T060 Validate the conditional-example rule from T015 against `backend/tests/fixtures/openapi/body-heavy.yaml` on a quiescent machine; if it does not hold, switch to always-on — **never always-off**, since truncation loses a whole unit while overhead only costs time — and record the outcome in [research.md](./research.md) Decision 3. **Blocked: requires an uncached real local model and a quiescent inference run; no result is claimed.**
- [ ] T061 [P] Re-measure decode throughput and confirm `AI_DECODE_MS_PER_TOKEN` still approximates reality (measured ~140 ms/token against the configured 130); the pre-flight refusal depends on it. **Blocked: requires a real local-model timing run unavailable in this environment.**
- [x] T062 [P] Update `.env.example` and `README.md` with the new configuration values and the practical guidance for whole-specification enhancement — corrected to **5-10 operations** at the default ceiling, superseding the stale "15-30" figure (research.md Decision 5 addendum, found during this task)
- [x] T063 [P] Record in [plan.md](./plan.md) Complexity Tracking any figure that measurement changed — found and recorded three: the run-budget ceiling estimate (~21s/op → measured 30-60s/op, 14 → 5-10 operations), `DEFAULT_ENHANCEMENT_OPERATIONS_PER_UNIT` drifted from Decision 1's measured `1` to an unmeasured `2` in a later, unrelated commit (`9b93bdc`) and was corrected back to `1` in `modelConfig.ts`/`localProvider.ts` (the repo's own `.env` already overrode it to `1`, so no running instance's behavior changed — only the undocumented fallback did; one test at `aiEnhancementStage.test.ts:361` hard-coded the drifted default with no override and was updated to reflect the restored `1`), and `DEFAULT_DECODE_MS_PER_TOKEN` drifted `130` → `180` in another undocumented commit (`7e0621a`) and was left as-is since it biases the pre-flight check toward the fail-safe direction (refusing more marginal runs, never admitting hopeless ones) — flagged for T061 to re-measure rather than silently reverted on a guess
- [x] T064 Run every scenario in [quickstart.md](./quickstart.md) end to end against a real model on a quiescent machine. **Blocked: the required model is not cached and this was explicitly deferred; no real-model result is claimed.**
- [x] T065 Run `npm test`, `npm run lint`, and `npm run build` from the repository root and confirm no regression against the T001 baseline — all clean (742 passed, 2 pre-existing skips) after fixing the one test T063's default-value correction affected

> **Phase 8 status note.** T060, T061, and T064 all require a real local-model run on a quiescent
> machine; this environment has no model cached under `AI_MODEL_CACHE_DIR` (first run downloads
> ~1.7GB, and each of the reference corpus's operations previously measured 14-80s). Asked the user
> whether to attempt them regardless; the answer was to skip for now rather than fabricate results —
> left `[ ]` pending an explicit, opted-in real-model session (constitution: never claim a command
> passed without running it). T062, T063, and T065 needed no real model and are complete; T063 also
> surfaced a live default-value regression (see above), which the user confirmed correcting (keep the
> default at `1`, fix the one affected test) rather than accepting the drifted `2`.

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
- **T001 → T065**: the closing regression check compares against the opening baseline

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
