# Implementation Plan: Presentation System & Review Scalability

**Branch**: `010-presentation-review-scalability` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-presentation-review-scalability/spec.md`

## Summary

AP-010 closes the two gaps a real end-to-end usability pass against a production specification (51
operations, 371 generated scenarios, 8 detected dependency workflows) exposed in the AP-009 guided
workflow: every stage renders as unstyled default markup, and Scenario Review / Workflow Review
support only one-at-a-time decisions, making full review at real scale impractical (constitution
XXXII, XXXIII).

The approach is presentation-and-interaction-only, reusing everything AP-002–AP-009 already built
(research.md D2–D4): introduce Tailwind CSS v4 into the frontend build for the first time (research.md
D1 — verified nothing in the repo uses it yet) via the official Vite plugin and CSS-first `@theme`
tokens, and apply it uniformly across the 18 components the live guided workflow renders. Add
manual multi-select and filter-scoped bulk accept/reject to Scenario Review and manual multi-select
bulk approve/reject to Workflow Review, both built entirely on top of the array-accepting decision
endpoints AP-009 already exposes — verified end to end that no backend, shared-domain, or client
function signature change is needed (research.md D2). A confirmation step (FR-011) and a
client-side batching mechanism for genuine progress feedback at scale (FR-020, research.md D5) are
the only new interaction logic. The duplicate "AI enhancement was skipped" banner is resolved by
removing the non-actionable copy and keeping the one with the retry action (research.md D6).

## Technical Context

**Language/Version**: TypeScript 5.5 on Node.js 20 LTS (backend, shared-domain, unchanged); React
18.3 + Vite 5.4 (frontend, unchanged) — same as every prior feature.

**Primary Dependencies**: NEW — `tailwindcss` (v4) and `@tailwindcss/vite` (the official Vite
integration), added to `frontend/package.json`. This is the first feature to introduce Tailwind into
the build (research.md D1 — verified zero existing Tailwind config/dependency/`className` usage
anywhere in the repo today). No other new dependency anywhere in the stack. All bulk-decision logic
reuses `applyScenarioDecisions` and `recordWorkflowDecisions` from
`frontend/src/services/testGenerationWorkflowClient.ts` (AP-009) exactly as they exist — both
already accept arrays (research.md D2).

**Storage**: N/A — no persisted state is added. Bulk selection and confirmation/progress state are
transient React component state (data-model.md), never part of the backend's in-memory
`TestGenerationWorkflow` singleton (research.md D7).

**Testing**: Vitest + React Testing Library on the frontend workspace only (no backend or
shared-domain test changes — research.md D2/D4 confirm no backend behavior changes). No new test
dependency; accessibility is verified with RTL role/keyboard queries, following the existing
`TestGenerationWorkflowAccessibility.test.tsx` / `TestScenarioReviewAccessibility.test.tsx` pattern
rather than introducing an axe-based library.

**Target Platform**: Local developer machine; unchanged from every prior feature.

**Project Type**: Web application in an npm-workspaces monorepo — this feature touches the
`frontend/` workspace only. It is the first AP-00x feature since AP-001 to touch zero backend and
zero shared-domain code.

**Performance Goals**: No new numeric backend budget (nothing server-side changes). The
user-observable target is FR-020/SC-008: a bulk decision at the observed real-world scale (~371
scenarios / several dozen workflows) shows genuine incremental progress rather than a single
opaque wait, achieved by client-side batching of calls to the existing endpoints (research.md D5) —
not a new server-side performance requirement.

**Constraints**: No new frontend styling framework or component library (CLAUDE.md §26,
constitution XXVIII) — Tailwind is the project's already-chosen direction, only now actually wired
in. No change to `ReviewUpdateRequest`, `ReviewUpdateOutcome`, `WorkflowDecisionInput`, or any other
shared-domain type (FR-018). Existing `data-testid` attributes relied on by current passing tests
are preserved unless a test is intentionally and visibly updated alongside the component it covers.
Bulk actions must resolve to the same per-item decision records the existing single-item actions
already produce (spec Assumptions) — no new decision semantics.

**Scale/Scope**: One new stylesheet (`frontend/src/index.css`) plus `@theme` tokens; Tailwind
utility classes applied across 18 existing components (styling only, no behavior change) in the live
guided-workflow tree; 3 dead, already-unreached components excluded from scope (research.md D8).
Five new small, reusable frontend modules (a confirmation component, a bulk-batching hook, and three
shared badge components — `HttpMethodBadge`, `StatusBadge`, `ProvenanceBadge` — added so FR-002's
cross-screen consistency is enforced by shared code rather than by per-file convention, per
`/speckit-analyze` finding U1); bulk-selection and bulk-action UI added to 2 existing stage
components (`TestScenarioReviewList.tsx`/`ScenarioReviewStage.tsx`, `WorkflowReviewStage.tsx`); one
existing component (`WorkflowStageTracker.tsx`) loses ~5 lines (the duplicate banner).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Gate | Status |
| --------- | ---- | ------ |
| I. Specification Is the Source of Truth | No fabricated status, decision outcome, or artifact | PASS — every status/decision shown is exactly what the existing `TestGenerationWorkflow`/review data already carries; only its presentation changes |
| VIII. Framework-Independent Test Model | No Postman-specific structure introduced | PASS — no TestModel/artifact-generation code is touched |
| IX. Separation of Concerns | Presentation change stays in the frontend layer | PASS — zero backend or shared-domain files touched (research.md D2/D4); bulk logic lives in frontend components/hooks, not routes |
| X. Domain Model First | No speculative domain concept added | PASS — "Bulk Review Selection" is explicitly kept as transient UI state, not promoted onto `TestGenerationWorkflow` (research.md D7, data-model.md) |
| XI. Human-in-the-Loop | Bulk actions remain explicit, reviewable decisions | PASS — a bulk action still requires an explicit trigger plus a separate confirmation step (FR-011) before any decision is recorded; per-scenario/per-workflow decision records are unchanged (FR-010) |
| XIII. Test Provenance and Traceability | Decision history unaffected | PASS — bulk actions produce the same `ReviewDecision`/`WorkflowReviewDecision` history entries a single decision would (FR-010); no new record shape |
| XIV. No Silent Assumptions | No hidden bulk effect | PASS — FR-011's mandatory confirmation-with-count step exists specifically so a bulk action's scope is never applied without the QA engineer seeing it first |
| XIX. Fail Safely | Partial bulk failure is surfaced | PASS — FR-012; scenario failures use the existing `ReviewUpdateOutcome.finding` (research.md D3), workflow failures are reported per whole chunk rather than hidden (research.md D4) |
| XXI. Testability at Every Boundary | New logic independently testable | PASS — the batching hook and confirmation component are pure/isolated enough for direct RTL/unit tests; no AI dependency, so no mock-provider concern applies here |
| XXV. Incremental Delivery | Scoped, bounded increment | PASS — reuses AP-002–AP-009 entirely unmodified; this feature's own boundary (roadmap AP-010) explicitly excludes touching generation/AI/dependency logic |
| XXVI. Specification Traceability | FRs map to spec/clarifications | PASS — FR-011/FR-019/FR-020 map directly to the three clarification-session answers recorded in spec.md |
| XXVII. Prefer Simple Architecture | No speculative infrastructure | PASS — explicitly rejected SSE/WebSocket/new backend endpoints in favor of client-side batching against the existing endpoint (research.md D5); no new dependency beyond Tailwind itself |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | Presentation technology change only | PASS — Tailwind adoption is precisely the kind of replaceable-technology decision XXVIII anticipates; no domain abstraction (`TestScenario`, `IntegrationWorkflow`, `AIProvider`, etc.) is touched |
| XXX. Explicit Trade-offs | Trade-offs documented | PASS — research.md D4 (atomic workflow endpoint retained) and D5 (client batching vs. real backend progress) both record the trade-off and why the simpler option was chosen |
| XXXI. Definition of Done | Cross-references XXXII/XXXIII | PASS — this feature's entire purpose is to bring every existing review/presentation screen up to XXXII/XXXIII, which is the explicit trigger recorded in the constitution's own Sync Impact Report |
| XXXII. Human Review Must Remain Practical at Real Scale | Bulk/grouped decision actions added | PASS — this is the feature's primary purpose (User Stories 1–2) |
| XXXIII. Presentation Must Be Consistent, Coherent, and Usable | Uniform visual/interaction system | PASS — this is the feature's primary purpose (User Story 3) |

No violations. Principles governing AI behavior, dependency inference, artifact determinism, and
local-first inference (II–VII, XV–XVIII, XX, XXII–XXIV, XXIX) are not implicated — this feature adds
no AI, dependency-analysis, or artifact-generation logic and touches no code in those areas.

**Post-Phase-1 re-check**: Unchanged. Phase 1 design (data-model.md, contracts/bulk-review-actions.md)
confirmed no new backend endpoint, shared-domain type, or persisted field is needed; every gate above
still holds.

## Project Structure

### Documentation (this feature)

```text
specs/010-presentation-review-scalability/
├── plan.md                          # This file
├── research.md                      # Phase 0 output
├── data-model.md                    # Phase 1 output
├── quickstart.md                    # Phase 1 output
├── contracts/
│   └── bulk-review-actions.md       # Phase 1 output — reused-endpoint usage contract (no new API)
├── checklists/
│   └── requirements.md              # Built-in spec-quality checklist
└── tasks.md                         # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
frontend/
├── package.json                       # + tailwindcss, @tailwindcss/vite (research.md D1)
├── vite.config.ts                     # + @tailwindcss/vite plugin registration
└── src/
    ├── index.css                      # NEW — @import "tailwindcss"; + @theme design tokens
    ├── main.tsx                       # + import "./index.css"
    ├── App.tsx                        # Styling only
    ├── pages/
    │   └── TestGenerationWorkflowPage.tsx   # Styling only
    ├── hooks/
    │   └── useBulkDecision.ts          # NEW — batches calls to an existing decision endpoint,
    │                                     # tracks {total, processed, succeeded, failed, status}
    │                                     # (data-model.md: Bulk Decision Run; research.md D5)
    └── components/
        ├── ConfirmDialog.tsx            # NEW — shared bulk-action confirmation (count + optional
        │                                  # shared reason), used by Scenario Review and Workflow
        │                                  # Review bulk actions (FR-011)
        ├── HttpMethodBadge.tsx           # NEW — single source of truth for HTTP-method visual
        │                                  # treatment, imported by OperationList/OperationDetail/
        │                                  # TestScenarioReviewList (FR-002; post-/speckit-analyze
        │                                  # finding U1)
        ├── StatusBadge.tsx               # NEW — single source of truth for stage-status/severity/
        │                                  # decision-state visual treatment, imported by
        │                                  # WorkflowStageTracker/TestScenarioReviewList/Detail/
        │                                  # WorkflowReviewStage (FR-002, FR-016; finding U1)
        ├── ProvenanceBadge.tsx           # NEW — single source of truth for provenance visual
        │                                  # treatment, imported by TestScenarioReviewList/Detail
        │                                  # (FR-002; finding U1)
        ├── VersionBadge.tsx              # Styling only
        ├── WorkflowStageTracker.tsx       # Styling; removes duplicate skip banner (FR-013, D6)
        ├── ApiReviewStage.tsx             # Styling only
        ├── AnalysisSummary.tsx            # Styling only
        ├── OperationList.tsx              # Styling only
        ├── OperationDetail.tsx            # Styling only
        ├── AiEnhancementStage.tsx         # Styling only; keeps the (now sole) skip banner
        ├── ScenarioReviewStage.tsx        # Styling + wires bulk handlers to useBulkDecision/ConfirmDialog
        ├── TestScenarioReviewSummary.tsx  # Styling only
        ├── TestScenarioReviewList.tsx     # Styling + manual multi-select, filter-scoped bulk
        │                                   # triggers, clears selection on filter change (FR-004,
        │                                   # FR-005, FR-019)
        ├── TestScenarioReviewDetail.tsx    # Styling only
        ├── TestScenarioReviewDecision.tsx  # Styling only (single-item action unchanged, FR-006)
        ├── TestScenarioReviewRefinement.tsx# Styling only
        ├── WorkflowReviewStage.tsx         # Styling + manual multi-select, bulk approve/reject
        │                                   # triggers (FR-008, FR-009)
        ├── PostmanGenerationStage.tsx      # Styling only
        └── PostmanExportLimitations.tsx    # Styling only

frontend/tests/unit/
├── ConfirmDialog.test.tsx                      # NEW
├── useBulkDecision.test.tsx                    # NEW
├── TestScenarioReviewList.test.tsx              # NEW — bulk selection/trigger behavior
├── WorkflowReviewStage.test.tsx                  # NEW — bulk selection/trigger behavior
├── WorkflowStageTracker.test.tsx                 # Updated — duplicate-banner assertion removed
├── TestGenerationWorkflowAccessibility.test.tsx  # Updated — keyboard bulk-selection coverage
└── TestScenarioReviewAccessibility.test.tsx      # Updated — keyboard bulk-selection coverage

# Explicitly out of scope (research.md D8 — dead, already-unreached by the live guided workflow):
# frontend/src/components/PostmanExportPanel.tsx, TestScenarioList.tsx, TestScenarioDetail.tsx
# and their dedicated tests.

# Not touched by this feature:
# backend/**, packages/shared-domain/** — verified in research.md D2/D3/D4 that every bulk-decision
# need is already met by existing endpoints/types.
```

**Structure Decision**: The existing web-application layout is used unchanged, and this feature is
scoped entirely to `frontend/src/` (plus its own tests) — the first AP-00x feature to require zero
backend or shared-domain changes, since AP-009 already made both target endpoints array-accepting
(research.md D2). A small `hooks/` directory is introduced (this codebase's first custom React hook)
specifically because the same batching/progress logic is needed identically by both Scenario Review
and Workflow Review bulk actions — genuine reuse, not speculative abstraction (constitution XXVII).

## Complexity Tracking

No Constitution Check violations require justification. The two new frontend modules
(`useBulkDecision`, `ConfirmDialog`) are each used by both bulk-review screens this feature adds, so
neither is a single-use abstraction; the client-side batching approach (research.md D5) was chosen
specifically to avoid introducing new backend infrastructure.
