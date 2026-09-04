# Implementation Plan: End-to-End Test Generation Workflow

**Branch**: `009-e2e-test-generation-workflow` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-e2e-test-generation-workflow/spec.md`

## Summary

AP-009 turns the eight independently-built capabilities (AP-002–AP-008) into one guided,
sequenced journey — upload → analysis → API review → deterministic generation → AI enhancement →
scenario review → dependency analysis → workflow review/approval → Postman generation — so a QA
engineer never has to manually stitch screens together or lose context between them.

The approach: introduce a single backend-side orchestration record, `TestGenerationWorkflow`
(the app's first piece of server-side state — every existing endpoint today is stateless), held as
one global in-memory instance (clarified FR-018). A new API surface,
`/api/test-generation-workflow/*`, wraps the exact same pure functions the existing stateless
endpoints already call (`generateTestModel`, `enhanceTestModel`, the AP-006 review functions,
`analyzeDependencies`, `generateCollection`) so no business logic is duplicated — the new layer
only adds stage sequencing, progress tracking, a staleness cascade when an earlier decision is
revised, and an explicit AI-enhancement retry path. The existing stateless endpoints are left
completely unchanged and keep working independently.

On the frontend, a new `TestGenerationWorkflowPage` replaces the current ad hoc component nesting
(`App` → `SpecificationUploadPage` → `TestScenarioReviewPage` → `PostmanExportPanel`) — which is
exactly the kind of component-local, non-resumable orchestration this feature is meant to replace —
with one page that resumes from the backend's workflow state and renders a stage tracker plus the
active stage's view, reusing every existing presentational component. No frontend router or new
dependency is introduced anywhere in this feature.

A key scope boundary, forced by the existing AP-007/AP-008 contracts: approved integration
workflows are reviewed and retained for traceability, but are never rendered into the Postman
artifact, because that rendering is explicitly deferred by AP-007 (FR-029/030) and explicitly out
of scope for AP-008 — building it here would be new Postman-generation logic, which this spec's own
Out of Scope forbids (research.md D2).

## Technical Context

**Language/Version**: TypeScript 5.5 on Node.js 20 LTS (backend, shared-domain); React 18.3 + Vite
5.4 (frontend) — unchanged from every prior feature.

**Primary Dependencies**: None added. Reuses `generateTestModel` (AP-003),
`enhanceTestModel`/`getAIProvider` (AP-004/AP-005), `hydrateReviewWorkspace` /
`applyReviewUpdates`/`applyReviewEdit`/`beginRegeneration`/`regenerateReviewScenario`/
`applyRegeneratedScenario`/`projectApprovedTestModel` (AP-006), `analyzeDependencies` (AP-008), and
`generateCollection` (AP-007) exactly as they exist today. Reuses the existing multipart upload
pipeline (`parseYaml`, `validateSpec`, `buildApiModel`, `upload` middleware) from AP-002. Frontend
reuses `AnalysisSummary`, `OperationList`, `OperationDetail`,
`TestScenarioReviewList`/`Summary`/`Detail`/`Decision`/`Refinement`, and
`PostmanExportLimitations` unmodified.

**Storage**: A single in-memory module-level singleton, `backend/src/testGenerationWorkflow/workflowStore.ts`
(`TestGenerationWorkflow | null`) — the first server-side state this application has anywhere.
Not persisted to disk; lost on backend restart (clarified spec Assumptions, research.md D7).

**Testing**: Vitest across backend, shared-domain, and frontend workspaces, matching every prior
feature. Supertest for the new `/api/test-generation-workflow/*` routes. AI-dependent tests use the
existing deterministic mock provider; no real model download or GPU is required. A dedicated
`staleness.test.ts` and `determinism`-flavored fixture-driven end-to-end test cover the full
sequenced path (quickstart.md).

**Target Platform**: Local developer machine; one Node 20 backend process, one Vite dev server. No
distributed/session infrastructure of any kind (constitution XXVII).

**Project Type**: Web application in an npm-workspaces monorepo — this feature touches the backend,
frontend, and shared-domain workspaces (the first AP-00x feature since AP-001 to touch all three).

**Performance Goals**: No new numeric target. Every wrapped stage keeps its own existing budget
(e.g., AP-008's 200-operation/15s dependency-analysis budget) unchanged, since this feature calls
those functions without modification (research.md D11). SC-005 ("identify current stage within 5
seconds") is a UI-clarity property validated by inspection in quickstart.md, not an automated timer.

**Constraints**: Single global workflow instance, no per-browser-session isolation (FR-018).
Guided workflow is the exclusive way to reach a stage screen — no route addresses an individual
stage (FR-017). No Postman rendering of approved integration workflows (research.md D2). AI-
enhancement retry is allowed only while `scenarioReview` has not reached `complete` (FR-008a). No
network access to any API described by the specification at any point (FR-013). No specification
content, generated payloads, or AI prompts/responses in workflow-level diagnostics (FR-016).

**Scale/Scope**: One new shared-domain module (`testGenerationWorkflow.ts`, ~8 types), one new
backend area (`backend/src/testGenerationWorkflow/`, ~9 modules) plus one new route file, nine new
`/api/test-generation-workflow/*` endpoints, one new frontend page plus five new stage components
and one new client module. Two existing frontend page components and their dedicated tests are
removed as superseded (research.md D10); every other existing file in AP-002–AP-008 is untouched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Gate | Status |
| --------- | ---- | ------ |
| I. Specification Is the Source of Truth | No fabricated stage, status, or artifact | PASS — every stage's output is exactly what the wrapped AP-00x function already produces; nothing is invented |
| II. Deterministic Before AI | Sequencing/staleness logic has no AI dependency | PASS — `computeDownstreamStaleness`, stage-gating, and the store are pure/deterministic; AI is invoked only inside the unmodified `enhanceTestModel` call |
| III. AI Is an Assistant, Not the Authority | AI-enhancement outcome never silently promoted | PASS — a `skipped` outcome is recorded with its error category/message (FR-008), never presented as if AI review occurred |
| VI. AI Provider Independence | No direct inference-runtime dependency | PASS — the new layer depends only on the existing `AIProvider`/`getAIProvider`, injected the same way `enhancedTestModelsRouter` already does |
| VIII. Framework-Independent Test Model | No Postman-specific structures leak upstream | PASS — `TestGenerationWorkflow` stores domain objects (`ApiModel`, `TestModel`, `DependencyAnalysisResult`); Postman artifacts appear only as the terminal `postmanArtifact` field, produced by the unmodified generator |
| IX. Separation of Concerns | Orchestration isolated from the stages it sequences | PASS — new `backend/src/testGenerationWorkflow/` area, sibling to `testDesign/`, `dependencies/`, `postman/`, calling into them rather than absorbing their logic |
| X. Domain Model First | Stable orchestration concepts | PASS — `TestGenerationWorkflow`/`WorkflowStageId`/`StageStatus`/`WorkflowReviewDecision` are the concepts this feature is explicitly asked to define (spec Key Entities) |
| XI. Human-in-the-Loop | Every stage decision explicit | PASS — apiReview continue, scenario accept/reject/finalize, workflow approve/reject, AI-enhancement trigger/retry are all distinct user-initiated actions (FR-009); nothing auto-advances |
| XII. Quality Over Quantity | No duplicate orchestration logic | PASS — one staleness function reused by every stage-mutating endpoint (data-model.md), not reimplemented per stage |
| XIII. Provenance and Traceability | Stage outputs traceable to source stage | PASS — every artifact on `TestGenerationWorkflow` names which AP-00x function produced it; approved workflows retain their `relationshipIds` (AP-008) unchanged |
| XIV. No Silent Assumptions | Ambiguity surfaced, not guessed | PASS — an AI-unavailable stage is recorded, not hidden (FR-008); an empty approved-scenario set is refused explicitly (FR-011), not silently exported empty |
| XVI. Executable Artifacts Must Be Deterministic | Postman generation stays deterministic, AI-free | PASS — `postmanGeneration` calls the unmodified, AI-free `generateCollection`; this feature adds no new artifact-generation logic (research.md D2) |
| XVII. Security and Privacy by Design | No unnecessary persistence or leakage | PASS — the workflow store is in-memory only, cleared on restart; no specification content in diagnostics (FR-016) |
| XIX. Fail Safely | Blocked/ambiguous transitions surfaced explicitly | PASS — `stage_not_active`, `empty_approved_scenarios`, `pending_workflow_decisions`, and `workflow_in_progress` are explicit, typed refusals, never silent no-ops (contracts/test-generation-workflow-api.md) |
| XX. Observability Without Sensitive Logging | Diagnostics carry no payloads | PASS — logs carry stage id, transition outcome, and error category only, matching every wrapped feature's own logging discipline |
| XXI. Testability at Every Boundary | Each transformation independently testable | PASS — stage-gating, staleness computation, and each stage-transition endpoint are independently unit/integration-testable; AI-dependent stages use the mock provider |
| XXV. Incremental Delivery | This feature is the final MVP increment, not a rewrite | PASS — every underlying capability (AP-002–AP-008) is reused unmodified; this feature adds only sequencing and the two genuinely new decision types (workflow-review, AI-retry) its own spec requires |
| XXVI. Specification Traceability | Implementation traceable to spec/clarifications | PASS — FR-008a/FR-017/FR-018 (clarified) map directly to D6/D8–D9/D7 in research.md |
| XXVII. Prefer Simple Architecture | No speculative infrastructure | PASS — no database, no session/cookie store, no message queue, no router; a single module-level in-memory record is the entire new "infrastructure" (research.md D7) |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | Stable domain abstractions | PASS — introduces exactly the orchestration-level concepts the spec's Key Entities name, decoupled from Express/React specifics |
| XXX. Explicit Trade-offs | Trade-offs documented | PASS — recorded in research.md (no workflow-intent Postman rendering, finalize-gated staleness, single global instance, removal of superseded pages) |

**Post-Phase-1 re-check**: unchanged. The design added no dependency, no persistence beyond the one
clarified in-memory instance, and stayed entirely within the AI/review/dependency/artifact
architecture AP-004–AP-008 already established.

## Project Structure

### Documentation (this feature)

```text
specs/009-e2e-test-generation-workflow/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── test-generation-workflow-api.md
├── checklists/
│   └── requirements.md  # Built-in spec-quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── testGenerationWorkflow.ts    # WorkflowStageId, WORKFLOW_STAGE_ORDER, StageStatus,
                                   # WorkflowStageState, TestGenerationWorkflow,
                                   # WorkflowReviewState, WorkflowReviewDecision

backend/src/
├── api/
│   └── testGenerationWorkflow.ts     # /api/test-generation-workflow/* routes; thin adapter,
│                                       # mirrors the createXRouter(provider) pattern already
│                                       # used by enhancedTestModels.ts / apiDependencies.ts
└── testGenerationWorkflow/
    ├── workflowStore.ts               # The single in-memory instance (research.md D7)
    ├── workflowStages.ts              # WORKFLOW_STAGE_ORDER, per-stage entry/exit rules
    ├── startWorkflow.ts                # Upload+analysis (atomic, D4) -> new TestGenerationWorkflow
    ├── apiReviewStage.ts               # Confirmation-gate transition (D3)
    ├── deterministicGenerationStage.ts # Wraps generateTestModel
    ├── aiEnhancementStage.ts           # Wraps enhanceTestModel; skip/retry semantics (FR-008a)
    ├── scenarioReviewStage.ts          # Wraps the AP-006 review functions against the stored
    │                                   # workspace; finalize action (D6)
    ├── dependencyAnalysisStage.ts      # Wraps analyzeDependencies (auto-run on stage entry)
    ├── workflowReviewStage.ts          # New WorkflowReviewDecision handling (D5)
    ├── postmanGenerationStage.ts       # Wraps generateCollection; never attaches workflow intent (D2)
    └── staleness.ts                    # computeDownstreamStaleness(workflow, revisedStageId)

backend/tests/
├── unit/testGenerationWorkflow/       # Per-module unit tests, incl. staleness.test.ts
└── integration/testGenerationWorkflow.test.ts   # Full sequenced-path integration test (quickstart.md)

packages/shared-domain/tests/unit/
└── test-generation-workflow.test.ts   # Contract shape tests

frontend/src/
├── pages/
│   └── TestGenerationWorkflowPage.tsx     # New composition root; replaces SpecificationUploadPage
│                                            # in App.tsx (research.md D8, D10)
├── components/
│   ├── WorkflowStageTracker.tsx            # New — stage list with status (User Story 2)
│   ├── ApiReviewStage.tsx                  # New — wraps AnalysisSummary/OperationList/OperationDetail
│   ├── AiEnhancementStage.tsx              # New — trigger/skip/retry UI (User Story 4)
│   ├── ScenarioReviewStage.tsx             # New — wraps the existing TestScenarioReview* components
│   │                                        # against the new workflow-scoped client
│   ├── WorkflowReviewStage.tsx             # New — lists IntegrationWorkflows, approve/reject (D5)
│   └── PostmanGenerationStage.tsx          # New — mirrors PostmanExportPanel's structure against
│                                            # the new workflow-scoped export endpoint (D10)
└── services/
    └── testGenerationWorkflowClient.ts     # New — one client for the whole contracts/ file

# Removed (superseded, research.md D10):
frontend/src/pages/SpecificationUploadPage.tsx
frontend/src/pages/TestScenarioReviewPage.tsx
frontend/tests/unit/App.test.tsx                 # rewritten against TestGenerationWorkflowPage
frontend/tests/unit/TestScenarioReviewPage.test.tsx
```

**Structure Decision**: The existing web-application layout is used unchanged. Orchestration gets
its own top-level backend area, `backend/src/testGenerationWorkflow/`, a sibling to `testDesign/`,
`dependencies/`, and `postman/` — the same pattern AP-008 established for keeping a new pipeline
concern out of unrelated areas (constitution IX). On the frontend, one new page and five new stage
components replace the two superseded orchestrating pages; every presentational leaf component from
AP-002/AP-006/AP-007 is reused without modification, and no new frontend dependency (router or
otherwise) is introduced.

## Complexity Tracking

No Constitution Check violations require justification. The one genuinely new piece of
infrastructure — a single in-memory workflow instance — is the smallest mechanism that satisfies the
clarified FR-018/FR-014, and is explicitly sized against (not beyond) what those requirements need
(research.md D7). No new dependency, persistence layer, routing library, or distributed
infrastructure is introduced.
