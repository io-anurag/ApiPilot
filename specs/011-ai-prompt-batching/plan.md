# Implementation Plan: Bounded AI Prompt Batching for Large Specifications

**Branch**: `011-ai-prompt-batching` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-ai-prompt-batching/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

AI-assisted dependency detection (`analyzeDependencies.ts`) and AI-assisted scenario
enhancement (`enhanceTestModel.ts`) each send the entire `ApiModel` (and, for enhancement,
the deterministic `TestModel`) as one serialized JSON prompt in a single `AIProvider.infer()`
call. For specifications large enough that this prompt exceeds the configured local model's
context window, `LocalProvider` now fails fast with a typed `INVALID_REQUEST` error (fixed
separately, see [research.md](./research.md) Decision 1), but the AI-assisted pass is still
entirely skipped for that specification — deterministic results are always returned, but AI
enhancement never runs. This plan bounds/splits the operations each pass sends across
multiple smaller, sequential AI requests ("batches") whenever the full prompt would not fit,
merges successful batches' results with the deterministic baseline exactly as today's
single-batch path already does, and reports a new `"partial"` outcome when some but not all
batches succeed — while leaving already-fitting (small) specifications completely
unaffected (FR-006).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20 LTS, ESM (`"type": "module"`)

**Primary Dependencies**: Existing `AIProvider` abstraction (`backend/src/ai/`),
`@huggingface/transformers` (only inside `LocalProvider`, unchanged), `@apipilot/shared-domain`
contracts. No new runtime dependency is introduced.

**Storage**: N/A (in-memory request/response processing only, no persistence)

**Testing**: Vitest + the existing deterministic `MockProvider` (constitution XXI); no real
model required for any test this feature adds.

**Target Platform**: Backend (Node.js Express service), consumed by the existing
`testGenerationWorkflow` orchestration and `POST /api/dependencies/analyze`-style endpoints.

**Project Type**: Web application monorepo (existing `backend/` + `frontend/` +
`packages/shared-domain/` structure). Primarily backend/shared-domain, but analysis
(`/speckit-analyze`) found that `enhanceTestModel.ts`'s `"partial"` outcome is consumed by a
non-exhaustive `=== "success"` check in `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`,
which collapses any non-success outcome into the existing `"skipped"` workflow-stage status —
TypeScript will not flag this consumer automatically. `packages/shared-domain/src/testGenerationWorkflow.ts`'s
`StageStatus` therefore also gains a `"partial"` value (applicable only to `aiEnhancement`,
mirroring `"skipped"`), and the frontend components that render that status
(`AiEnhancementStage.tsx`, `TestGenerationWorkflowPage.tsx`, `WorkflowStageTracker.tsx`) require
required, not optional, updates so a partial result is never displayed as a full skip
(FR-007, SC-003; research.md Decision 7).

**Performance Goals**: Preserve dependency detection's existing 15-second analysis budget
(`ANALYSIS_TIMEOUT_MS`, SC-005); no new overall wall-clock budget is introduced for scenario
enhancement, which has none today (see [research.md](./research.md) Decision 5).

**Constraints**: Must not add a new runtime dependency; must not couple
`analyzeDependencies.ts`/`enhanceTestModel.ts` to Transformers.js/onnxruntime specifics
(constitution VI); batching must be fully deterministic (constitution XVI, XXIV; FR-009);
automated tests must remain real-model-free (constitution XXI).

**Scale/Scope**: Touches `packages/shared-domain/src/aiProvider.ts`,
`packages/shared-domain/src/aiScenarioDesign.ts`, `packages/shared-domain/src/apiDependency.ts`,
`packages/shared-domain/src/testGenerationWorkflow.ts`, `backend/src/ai/localProvider.ts`,
`backend/src/ai/mockProvider.ts`, a new `backend/src/ai/requestBatching.ts` module,
`backend/src/dependencies/analyzeDependencies.ts`, `backend/src/testDesign/enhanceTestModel.ts`,
`backend/src/testGenerationWorkflow/aiEnhancementStage.ts`, and three existing frontend files
(`frontend/src/components/AiEnhancementStage.tsx`, `frontend/src/components/WorkflowStageTracker.tsx`,
`frontend/src/pages/TestGenerationWorkflowPage.tsx`), plus their existing test suites.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Check                                                                                                                                                                                                 | Status |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| II. Deterministic Before AI                     | Batch splitting itself is pure/deterministic; only the AI-assisted (already-optional) pass is affected                                                                                                | PASS   |
| VI. AI Provider Independence                    | New `AIProvider.getInputBudget()` capability returns a plain character count, not a token count or any Transformers.js/onnxruntime type — the domain layer still never depends on tokenizer internals | PASS   |
| IX. Separation of Concerns                      | Batch-splitting logic lives in a new shared `backend/src/ai/` module, not inside `analyzeDependencies.ts`/`enhanceTestModel.ts` bodies or inside `LocalProvider`                                      | PASS   |
| XIII. Test Provenance and Traceability          | Existing per-candidate provenance (source, rationale, confidence) is unchanged; batching only changes how many requests produce those candidates                                                      | PASS   |
| XVI. Executable Artifacts Must Be Deterministic | Batch membership/order is a pure function of `(operations, budget)` — no randomness, no wall-clock-dependent grouping                                                                                 | PASS   |
| XIX. Fail Safely                                | A batch that still doesn't fit (e.g., one oversized operation) fails via the existing typed `INVALID_REQUEST` path and is skipped, not silently dropped or fabricated                                 | PASS   |
| XXI. Testability at Every Boundary              | `MockProvider` gains a test-only configurable budget so batching logic is exercised without a real model                                                                                              | PASS   |
| XXIV. Reproducibility                           | FR-009/SC-004 require identical batch grouping across repeated runs for the same input+provider                                                                                                       | PASS   |
| XXVII. Prefer Simple Architecture               | Deterministic recursive-halving split chosen over a general bin-packing algorithm or a new distributed/queueing layer (see research.md Decision 3)                                                    | PASS   |
| XXX. Explicit Trade-offs                        | The AI-assisted pass can only detect relationships/scenarios _within_ a batch, not across batch boundaries; documented as an explicit, accepted trade-off in research.md Decision 4, not hidden       | PASS   |

No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/011-ai-prompt-batching/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── aiProvider.ts              # + AIProvider.getInputBudget(), unchanged ModelConfig/InferenceRequest/Response
├── aiScenarioDesign.ts         # AIProviderOutcome gains "partial"
└── apiDependency.ts            # DependencyAIOutcome gains "partial"

backend/src/ai/
├── requestBatching.ts          # NEW: splitOperationsIntoBatches() + runBatchedInference() helpers
├── localProvider.ts            # + getInputBudget() (derives a character budget from tokenizer.model_max_length)
├── mockProvider.ts              # + getInputBudget() (undefined by default; test-only configurable override)
└── errors.ts                    # unchanged

backend/src/dependencies/
└── analyzeDependencies.ts       # runAIAssistedPass() batches via requestBatching.ts, aggregates per-batch outcomes

backend/src/testDesign/
└── enhanceTestModel.ts          # AI request/merge loop batches via requestBatching.ts, aggregates per-batch outcomes

backend/src/testGenerationWorkflow/
└── aiEnhancementStage.ts        # runAiEnhancement() gains a 3-way branch: success/partial/skipped (was success/else)

frontend/src/components/
├── AiEnhancementStage.tsx       # boolean `skipped` prop becomes a tri-state status prop
└── WorkflowStageTracker.tsx     # Record<StageStatus, ...> maps gain a "partial" entry

frontend/src/pages/
└── TestGenerationWorkflowPage.tsx  # `=== "skipped"` check extended to also render for "partial"

backend/tests/unit/
├── ai/requestBatching.test.ts               # NEW
├── dependencies/analyzeDependencies.test.ts  # extended: multi-batch, partial-outcome cases
├── testDesign/enhanceTestModel.test.ts       # extended: multi-batch, partial-outcome cases
└── testGenerationWorkflow/aiEnhancementStage.test.ts  # extended: "partial" surfaces as a distinct stage status

frontend/tests/unit/
├── AiEnhancementStage.test.tsx        # extended: tri-state status rendering
├── WorkflowStageTracker.test.tsx      # extended: "partial" chip/tone/label
└── TestGenerationWorkflowPage.test.tsx  # extended: partial-status banner rendering
```

**Structure Decision**: Existing `backend/` + `packages/shared-domain/` layout is reused
as-is (Option 2 / web-application monorepo, already established by this repository); no new
top-level project, service, or package is introduced. All new logic lives inside the
existing `backend/src/ai/` module boundary that already owns the `AIProvider` abstraction.

## Complexity Tracking

> No Constitution Check violations were identified; this table is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| —         | —          | —                                    |
