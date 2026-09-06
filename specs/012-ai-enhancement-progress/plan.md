# Implementation Plan: AI Enhancement Progress Visibility

**Branch**: `012-ai-enhancement-progress` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-ai-enhancement-progress/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

`POST /api/test-generation-workflow/ai-enhancement` currently runs every AI batch
(specs/011-ai-prompt-batching) sequentially in-process and only responds once the whole run
finishes, so a specification needing several batches leaves the user watching an unchanging
"Enhancing…" label for the full duration, then seeing the success/partial/skipped outcome as
the very first signal. This plan adds live, batch-level progress — visible while a run is
still going, via the existing `GET /api/test-generation-workflow` polling endpoint the
frontend already uses — and reveals each batch's AI-derived scenarios into `reviewWorkspace`
as soon as that batch succeeds, rather than only once every batch finishes. No new HTTP
endpoint, no new transport (SSE/WebSocket), no new dependency; batching's own deterministic
computation, merge, and outcome semantics (specs/011) are unchanged — only how progress
through that existing computation is surfaced changes.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20 LTS, ESM (`"type": "module"`)

**Primary Dependencies**: Existing `AIProvider`/`requestBatching` abstractions
(`backend/src/ai/`), existing `testGenerationWorkflow` orchestration
(`backend/src/testGenerationWorkflow/`), `@apipilot/shared-domain` contracts, React (frontend
polling). No new runtime dependency is introduced (research.md Decision 1).

**Storage**: N/A — progress lives on the existing single in-memory
`TestGenerationWorkflow` singleton (`backend/src/testGenerationWorkflow/workflowStore.ts`,
"No database, no session identity"); no new persistence layer (research.md Decision 2).

**Testing**: Vitest + Supertest (backend), React Testing Library (frontend), the existing
deterministic `MockProvider`/scripted-provider test doubles already used by
`enhanceTestModel.test.ts` and `requestBatching.test.ts` (constitution XXI). No real model
required for any test this feature adds; fake timers used for polling-interval tests
(constitution XXIV — deterministic tests, no reliance on wall-clock timing).

**Target Platform**: Existing Express backend service + existing React/Vite frontend,
consumed through the existing `testGenerationWorkflow` orchestration layer.

**Project Type**: Web application monorepo (existing `backend/` + `frontend/` +
`packages/shared-domain/` structure). Touches backend (workflow orchestration, batch runner,
enhancement domain logic), shared-domain (two new types, one extended type), and frontend
(the AI enhancement stage component + its service client).

**Performance Goals**: SC-004 — a progress update within the time it takes each individual
batch to complete. A fixed 2-second client polling interval satisfies this with a wide margin
given observed real batch durations (tens of seconds to a few minutes; research.md Decision
6), at negligible added server cost (one in-memory object read per poll).

**Constraints**: Must not add a new runtime dependency or transport mechanism (constitution
XXVII); must not change batching's deterministic split, merge, dedup, or outcome semantics
(constitution XVI, XXIV; FR-004) — verified by construction, not assumption, via
`deduplicate()`'s proven first-seen-wins stability (research.md Decision 4); must not couple
`enhanceTestModel.ts`/`workflowStore.ts` together in a way that violates separation of
concerns (constitution IX) — progress/reveal side effects are applied by the workflow
orchestration layer via a callback, not inside the domain function itself; automated tests
must remain real-model-free (constitution XXI).

**Scale/Scope**: Touches `packages/shared-domain/src/testGenerationWorkflow.ts` (new
`AiEnhancementProgress`/`BatchProgress` types, `WorkflowStageState.progress`),
`backend/src/ai/requestBatching.ts` (two new optional callbacks),
`backend/src/testDesign/enhanceTestModel.ts` (new optional `onBatchComplete` callback,
incremental dedup pass), `backend/src/testGenerationWorkflow/workflowStore.ts` (new
progress-only setter, not a status transition), `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`
(concurrency guard, progress/reveal wiring), `backend/src/api/testGenerationWorkflow.ts` (new
`409 ai_enhancement_already_running` case — no new route), and one existing frontend file
(`frontend/src/components/AiEnhancementStage.tsx`), plus their existing test suites.
`frontend/src/services/testGenerationWorkflowClient.ts` needs no change — its existing
`fetchCurrentWorkflow()` already returns the whole workflow and is reused as-is for polling.
`analyzeDependencies.ts` is explicitly untouched (FR-011).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| II. Deterministic Before AI | No change to what is computed deterministically vs. by AI; this feature only reports progress through existing computation | PASS |
| VI. AI Provider Independence | New callbacks (`onBatchStart`/`onBatchSettled`/`onBatchComplete`) carry only batch index/total/outcome/scenarios — no tokenizer, runtime, or provider-specific type crosses the `AIProvider` boundary | PASS |
| IX. Separation of Concerns | `enhanceTestModel.ts` reports *what changed* via callback; `workflowStore`/`reviewWorkspace` mutation stays in the workflow orchestration layer (`aiEnhancementStage.ts`), not inside the domain function | PASS |
| XI. Human-in-the-Loop | Progressive reveal makes scenarios reviewable sooner, not less reviewable; FR-012 explicitly guards that a user's decision on an early-revealed scenario is never discarded by a later batch | PASS |
| XIII. Test Provenance and Traceability | No change to per-scenario provenance fields; only when a scenario becomes visible changes, not its origin/rationale/confidence | PASS |
| XVI. Executable Artifacts Must Be Deterministic | Progress reporting and incremental reveal are read-side effects of the existing deterministic batch/merge computation, not a new source of non-determinism | PASS |
| XIX. Fail Safely | FR-008's concurrency guard closes a latent gap (two concurrent runs racing to mutate the same workflow) rather than introducing a new failure mode | PASS |
| XX. Observability Without Sensitive Logging | Progress fields exposed to the client are limited to batch counts/status/error category (FR-010) — no prompts, responses, or specification content | PASS |
| XXI. Testability at Every Boundary | New callbacks are exercised with the existing `MockProvider`/scripted test doubles; no real model needed | PASS |
| XXIV. Reproducibility | Incremental dedup is proven (research.md Decision 4) to produce identical retained-scenario identities to today's one-shot final dedup, for the same deterministic batch order | PASS |
| XXVII. Prefer Simple Architecture | Reuses the existing `GET /api/test-generation-workflow` poll target and the existing in-memory workflow singleton instead of introducing SSE/WebSocket/a new persistence layer (research.md Decisions 1-2) | PASS |
| XXX. Explicit Trade-offs | FR-007's ephemeral-progress choice (not resumable across a fully closed/reopened session in a hypothetical multi-session future) is documented as a deliberate, user-confirmed scope boundary in spec.md's Assumptions, not hidden | PASS |
| XXXIII. Presentation Must Be Consistent, Coherent, and Usable | New progress UI in `AiEnhancementStage.tsx` (batch counts, per-batch status) reuses the project's existing Tailwind/status-badge/loading-state conventions (CLAUDE.md §26-43) rather than introducing ad hoc markup | PASS |

No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/012-ai-enhancement-progress/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── testGenerationWorkflow.ts   # + BatchProgress, AiEnhancementProgress; WorkflowStageState.progress (optional)

backend/src/ai/
└── requestBatching.ts          # + onBatchStart/onBatchSettled optional callbacks on runBatchedInference's options

backend/src/testDesign/
└── enhanceTestModel.ts         # + onBatchComplete optional callback; per-batch incremental dedup pass (research.md Decision 4)

backend/src/testGenerationWorkflow/
├── workflowStore.ts            # + setAiEnhancementProgress() helper (not a status transition)
└── aiEnhancementStage.ts       # concurrency guard (FR-008); wires onBatchComplete to progress + incremental reviewWorkspace reveal

backend/src/api/
└── testGenerationWorkflow.ts   # ai-enhancement route: new 409 ai_enhancement_already_running case; GET route unchanged (progress rides the existing response)

frontend/src/services/
└── testGenerationWorkflowClient.ts   # runAiEnhancement() unchanged; frontend polls existing fetchCurrentWorkflow()

frontend/src/components/
└── AiEnhancementStage.tsx      # polls workflow status while running; renders per-batch progress; single-batch runs unchanged (FR-005)

backend/tests/unit/
├── ai/requestBatching.test.ts                        # extended: onBatchStart/onBatchSettled ordering and payloads
├── testDesign/enhanceTestModel.test.ts                # extended: onBatchComplete payloads, incremental-dedup stability (FR-012)
└── testGenerationWorkflow/aiEnhancementStage.test.ts   # extended: concurrency guard, progress lifecycle, incremental reviewWorkspace growth

backend/tests/integration/
└── testGenerationWorkflow.test.ts (or equivalent)      # extended: GET response includes progress per contracts/ai-enhancement-progress.md

frontend/tests/unit/
└── AiEnhancementStage.test.tsx                         # extended: polling behavior, per-batch rendering, single-batch regression (FR-005)
```

**Structure Decision**: Existing `backend/` + `frontend/` + `packages/shared-domain/` layout
is reused as-is; no new top-level project, service, package, or HTTP endpoint is introduced.
All new logic lives inside module boundaries this feature's own dependencies already own
(`backend/src/ai/`, `backend/src/testDesign/`, `backend/src/testGenerationWorkflow/`) —
mirroring specs/011-ai-prompt-batching's own structural approach.

## Complexity Tracking

> No Constitution Check violations were identified; this table is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| — | — | — |
