# Implementation Plan: AI Enhancement Batch Retry

**Branch**: `015-ai-batch-retry` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-ai-batch-retry/spec.md`

## Summary

Today, if one batch fails in an otherwise-successful AI Enhancement run, the only recovery is
"Retry AI enhancement," which reprocesses every operation in the specification again — including
every batch that already succeeded. That happens because per-batch results
(`AiEnhancementProgress`/`BatchProgress`) are deliberately cleared the instant a run settles
(specs/012), so nothing about which batch failed, or why, survives to be retried individually.

The approach adds a persisted, per-batch outcome record (`BatchOutcomeRecord`) that survives past
settling, pins each batch's exact operation set at the moment it first runs (so a later retry can
never silently drift onto a different set of operations), and exposes one new endpoint that reruns
a single batch through the same request-build/validate/dedupe pipeline `enhanceTestModel` already
uses — extracted once so there is exactly one implementation of "run one batch," not two. A
successful retry appends its scenarios into the live review workspace exactly as a normal run's
incremental reveal already does; the AI Enhancement stage's aggregate status is recomputed from all
batches' current outcomes after every retry, so a run can reach "Complete" purely through retries
without ever redoing already-successful work.

No new `StageStatus`, no new state-machine transition, and no new persistence layer are introduced
— the feature adds one field to the existing in-memory `TestGenerationWorkflow` record and reuses
every retryability/explanation rule specs/011-014 already established.

## Technical Context

**Language/Version**: TypeScript 5.5, Node.js 20 LTS, ES modules

**Primary Dependencies**: Express 4 (backend), React 19 + Vite (frontend), Tailwind CSS v4
(styling). No new dependency — the feature is entirely new orchestration logic over the existing
`AIProvider` abstraction; it does not touch `@huggingface/transformers` or introduce any provider
concern of its own.

**Storage**: None. Batch outcome records live only on the existing single, in-process,
non-persistent `TestGenerationWorkflow` record (`workflowStore.ts`) — no database, no new file, no
change to the existing model-cache-only filesystem footprint.

**Testing**: Vitest (unit + integration), Supertest (HTTP contract for the new route), React
Testing Library + jsdom (per-batch retry controls). This feature is orchestration logic, not
inference quality — `MockProvider` covers every scenario in quickstart.md; no real-model test is
needed (unlike `013`, which was specifically a real-model defect fix).

**Target Platform**: Unchanged — local developer machine, Express backend, browser frontend.

**Project Type**: Web application in the existing npm-workspaces monorepo (`backend/`, `frontend/`,
`packages/shared-domain/`). No new project or service.

**Performance Goals**: A batch retry's cost is bounded by one batch's own inference call (SC-001)
— never the whole run. No new latency target beyond what `013`/`014` already establish per request;
this feature changes *what* gets re-run, not how fast any single request runs.

**Constraints**:
- No new `StageStatus` member or state-machine transition (FR-006, FR-012 — research.md Decision 3).
- Deterministic scenarios and their ordering are never affected by any batch retry outcome,
  success or failure (FR-009).
- A batch's operations are pinned at the run that first produced it and never recomputed from live
  configuration on retry (FR-008 — research.md Decision 2).
- No new persistence: batch outcome records live and die with the same in-memory workflow
  everything else already does (spec.md Assumptions).
- Ordinary `npm test` must not download or execute a real model (constitution XXI).

**Scale/Scope**: Touches `packages/shared-domain` (new `BatchOutcomeRecord` type,
`WorkflowStageState.batchOutcomes`, `AIProvenance.aiBatchIndex`), `backend/src/testDesign/
enhanceTestModel.ts` (extract `retryOneBatch`), `backend/src/testGenerationWorkflow/`
(`aiEnhancementStage.ts` new `retryAiEnhancementBatch()`, `workflowStore.ts` new batch-outcome
mutator and aggregate-status recompute), `backend/src/api/testGenerationWorkflow.ts` (one new
route), and `frontend/src/components/AiEnhancementStage.tsx` plus
`testGenerationWorkflowClient.ts` (per-batch retry control and client call).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### Initial evaluation (pre-research)

| Principle | Assessment | Verdict |
| --- | --- | --- |
| I. Specification Is the Source of Truth | A retried batch's candidates must be validated against the same full `ApiModel` as any other batch, not a narrowed view | ⚠️ Gate |
| II. Deterministic Before AI | `workflow.deterministicTestModel` and its scenarios must be structurally unreachable from the retry path | ⚠️ Gate |
| VI. AI Provider Independence | The extracted single-batch function must take `AIProvider` as a parameter, not import an inference runtime | ⚠️ Gate |
| IX. Separation of Concerns | The new route must stay thin; all retry logic belongs in the stage/testDesign modules | ⚠️ Gate |
| X. Domain Model First | `BatchOutcomeRecord` and the `AIProvenance` extension must live in `packages/shared-domain`, not duplicated per-side | ⚠️ Gate |
| XI. Human-in-the-Loop | Review decisions already recorded on other batches' scenarios must be provably untouched by a retry | ⚠️ Gate |
| XIII. Test Provenance and Traceability | A retried batch's scenarios need a traceable link back to their batch | ⚠️ Gate |
| XIV. No Silent Assumptions | Batch composition must not silently shift between the original run and a later retry if configuration changes | ⚠️ Gate |
| XIX. Fail Safely | Every ineligible retry (already succeeded, non-retryable, wrong stage, concurrent run) must fail with a distinct, structured error — never a silent no-op | ⚠️ Gate |
| XX. Observability Without Sensitive Logging | New per-batch-retry log lines must carry categories/durations only, never prompt or response content | ⚠️ Gate |
| XXI. Testability at Every Boundary | The single-batch retry function must be unit-testable against `MockProvider` alone | ⚠️ Gate |
| XXIV. Reproducibility | Everything deterministic in the retry path (operation selection, dedupe, merge order) must stay reproducible even though the AI provider's own output may vary between attempts | ⚠️ Gate |
| XXVII. Prefer Simple Architecture | Must not introduce a new store, queue, or persistence layer for a feature scoped to one in-memory workflow | ⚠️ Gate |
| XXXII. Human Review Must Remain Practical at Real Scale | Unclear whether a one-at-a-time retry control (FR-011) needs a bulk counterpart the way scenario/dependency/workflow review does | ⚠️ Gate — needs explicit applicability assessment |
| XXXIII. Presentation Must Be Consistent, Coherent, and Usable | New per-batch retry controls must reuse the existing `StatusBadge`/button vocabulary, not introduce a new visual pattern | ⚠️ Gate |

No violation is unjustifiable; all fifteen gates are design constraints carried into Phase 0/1.

### Post-design re-evaluation (after Phase 1)

| Gate | Resolution | Verdict |
| --- | --- | --- |
| I. Source of truth | Decision 5: `retryOneBatch` reuses `runOneBatch`'s existing call to `validateAICandidateSemantics(candidate, apiModel)` unchanged — the full `ApiModel`, never a projection scoped to the retried batch. | ✅ Pass |
| II. Deterministic before AI | Decision 5/6: `retryOneBatch`'s signature takes `testModel` only for dedupe scoping (read-only) and never touches `workflow.deterministicTestModel`; the merge path (Decision 6) only ever appends to `reviewWorkspace.scenarios`, never rewrites it. | ✅ Pass |
| VI. Provider independence | Decision 5: `retryOneBatch(operations, apiModel, testModel, provider, requestId)` takes `provider: AIProvider`; no new import of `@huggingface/transformers` anywhere outside the existing `localProvider.ts` boundary. | ✅ Pass |
| IX. Separation of concerns | Decision 9: the new route is a validate → delegate → map-to-HTTP handler matching `.../ai-enhancement/cancel`'s existing shape exactly; `retryAiEnhancementBatch()` in `aiEnhancementStage.ts` owns all orchestration. | ✅ Pass |
| X. Domain model first | data-model.md: `BatchOutcomeRecord` in `packages/shared-domain/src/testGenerationWorkflow.ts`; `AIProvenance.aiBatchIndex` in `packages/shared-domain/src/testModel.ts`. Both are the single cross-layer definition backend and frontend share. | ✅ Pass |
| XI. Human-in-the-loop | Decision 6: the exact-scenario-ID-dedup merge path already used for incremental reveal (`newlyAddedReviewScenarios`) only ever adds entries whose ID is not already present — structurally incapable of touching an existing `ReviewScenario`'s `state`/`revision`/`history`. | ✅ Pass |
| XIII. Provenance and traceability | data-model.md: `AIProvenance.aiBatchIndex` set by `retryOneBatch`'s call into `candidateToScenario`, giving every AI-derived scenario a traceable batch origin from this feature onward. | ✅ Pass |
| XIV. No silent assumptions | Decision 2: `BatchOutcomeRecord.operationKeys` is pinned once, at the run that first produced the batch, and looked up (never recomputed) on retry — an explicit, inspectable record rather than an assumption that configuration hasn't changed. | ✅ Pass |
| XIX. Fail safely | contracts/ai-enhancement-retry-batch.md: four distinct, structured responses (`404 batch_not_found`, `409 batch_not_retryable`, `409 stage_not_active`, `409 ai_enhancement_already_running`) cover every ineligible case named in spec.md's Edge Cases — no case falls through to a silent no-op. | ✅ Pass |
| XX. Logging | Task-level obligation: per-batch-retry log lines (mirroring `enhanceTestModel.ts`'s existing `unit_settled`/`enhancement_complete` calls) carry batch index, status, and error category only — never prompt or response content. Recorded here so implementation tasks inherit it explicitly. | ✅ Pass (implementation-time obligation) |
| XXI. Testability | Decision 5: `retryOneBatch` is a plain exported function taking `provider: AIProvider`, directly callable with `MockProvider` in unit tests — no real model required anywhere in quickstart.md. | ✅ Pass |
| XXIV. Reproducibility | Decision 6: the dedupe/merge fold is the same stable, first-seen-wins algorithm already relied on for reproducibility elsewhere; only the AI provider's own reply may vary between a batch's original attempt and its retry, which constitution XXIV already treats as expected AI variability, not a reproducibility defect. | ✅ Pass |
| XXVII. Simple architecture | Decision 1: one new field (`batchOutcomes`) on an existing record. Decision 8: reuses the existing `progress`-presence concurrency signal. No new store, queue, or service introduced anywhere in the design. | ✅ Pass |
| XXX. Explicit trade-offs | spec.md Assumptions (carried through unchanged): no cross-batch content-similarity dedupe, no per-attempt retry history — both explicitly recorded as known, deliberate limitations rather than silently accepted gaps. | ✅ Pass |
| XXXII. Review practicality at scale | Assessed explicitly, not glossed over: batch retry is a corrective action on a failed *processing step*, not an accept/reject/approve decision over reviewable *content* the way scenario, dependency, and workflow review are — XXXII's bulk-action requirement targets exactly that latter kind of interface. FR-011 already requires one distinct control per eligible batch (never a single all-or-nothing action), which is the correct granularity for a corrective action a user chooses individually. No user story or FR in spec.md asks for a "retry all eligible batches" bulk action, and work-bounded batching (`014`) keeps typical batch counts modest, so the common case (a handful of batches failing from one transient cause) does not resemble the review-scale problem XXXII addresses. **Recorded as a known, deliberate scope boundary** (Complexity Tracking below) rather than silently assumed: if real usage shows many batches routinely failing together, a bulk retry action should be added as a follow-up feature, at which point XXXII would apply directly. | ✅ Pass (limitation recorded) |
| XXXIII. Presentation | Task-level obligation: per-batch retry controls reuse the existing `StatusBadge`/`BUTTON_STYLES` vocabulary already used throughout `AiEnhancementStage.tsx` and `WorkflowReviewStage.tsx`'s per-item action buttons — no new component family. | ✅ Pass (implementation-time obligation) |

**Result: all gates pass. One entry recorded in Complexity Tracking below for auditability — not
because it is a violation, but because XXXII's applicability was a genuinely close call worth an
explicit paper trail rather than a silent judgment call.**

## Project Structure

### Documentation (this feature)

```text
specs/015-ai-batch-retry/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 9 decisions
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
├── contracts/
│   └── ai-enhancement-retry-batch.md   # POST .../ai-enhancement/retry-batch
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── testGenerationWorkflow.ts   # BatchOutcomeRecord (new); WorkflowStageState += batchOutcomes
└── testModel.ts                # AIProvenance += aiBatchIndex

backend/src/
├── testDesign/
│   └── enhanceTestModel.ts     # Extract retryOneBatch(); enhanceTestModel calls it internally
├── testGenerationWorkflow/
│   ├── aiEnhancementStage.ts   # NEW retryAiEnhancementBatch(); record batchOutcomes as batches
│   │                           #   settle during a normal run too, so retry data exists even for
│   │                           #   a run that never gets retried
│   ├── workflowStore.ts        # NEW batch-outcome mutator + aggregate-status recompute helper
│   └── errors.ts                # NEW error types: BatchNotFoundError, BatchNotRetryableError
└── api/
    └── testGenerationWorkflow.ts   # NEW route: POST .../ai-enhancement/retry-batch

frontend/src/
├── components/
│   └── AiEnhancementStage.tsx   # Per-batch retry control for each retryable batch outcome
└── services/
    └── testGenerationWorkflowClient.ts   # retryAiEnhancementBatch(batchIndex)
```

**Structure Decision**: The existing monorepo layout and module boundaries are retained unchanged.
Every modification lands in a module that already owns the concern: single-batch inference
mechanics stay in `backend/src/testDesign/enhanceTestModel.ts` (which already owns per-batch
processing), stage orchestration and state mutation stay in `backend/src/testGenerationWorkflow/`,
HTTP adaptation stays in `backend/src/api/`, presentation stays in `frontend/src/components/`. Two
new error types are added to the existing `errors.ts` alongside `AiEnhancementAlreadyRunningError`
et al.; no new architectural layer, service, or package is introduced.

Recording `batchOutcomes` as batches settle during an *ordinary* run (not only building it
retroactively when a retry is requested) is the load-bearing structural choice: it means
`runAiEnhancement`'s existing `onBatchComplete` callback in `aiEnhancementStage.ts` is the single
place batch outcomes are ever written, whether the run is a first attempt, a whole-stage retry, or
(new) a single-batch retry — avoiding a second, parallel bookkeeping path that could drift from the
first.

## Complexity Tracking

> Recorded for auditability. Not a rejected or unresolved violation — see the XXXII row in the
> post-design Constitution Check above for the full reasoning.

| Decision | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Per-batch-only retry control, no bulk "retry all eligible batches" action (XXXII) | Matches the spec's actual scope (FR-011, one control per batch) and the common failure pattern (a handful of batches, one transient cause) | A bulk action was not rejected as *wrong* — it was out of scope for this spec (no user story or FR requests it) and would be speculative infrastructure for a scale this feature has no evidence of yet (constitution XXVII); adding it now would be building ahead of a demonstrated need rather than in response to one |
