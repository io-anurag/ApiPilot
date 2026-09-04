# Research: Presentation System & Review Scalability

**Input**: [spec.md](./spec.md) · **Constitution**: `.specify/memory/constitution.md` v2.1.0

This feature has no `NEEDS CLARIFICATION` markers in the spec (all three clarification-session
answers are already encoded in spec.md's `## Clarifications`). This document instead records the
architectural decisions needed to satisfy the spec using the smallest change to the existing
codebase, verified by reading the current implementation rather than assumed.

## D1: Tailwind CSS v4 is being introduced into the build for the first time

**Finding**: Verified by inspection — `frontend/package.json` has no `tailwindcss` dependency, no
`tailwind.config.*` or `postcss.config.*` file exists anywhere in the repo, `frontend/vite.config.ts`
has no Tailwind plugin, and every single component under `frontend/src/components/` and
`frontend/src/pages/` has zero `className` usages (`grep -c className` returns `0` for all 18 files
in the live guided-workflow tree). CLAUDE.md §26–27 already documents the intended Tailwind v4
conventions ("preserve ... when frontend styling is introduced or migrated"), anticipating that no
feature had introduced it yet.

**Decision**: Add `tailwindcss` and `@tailwindcss/vite` (the official Vite integration, per
CLAUDE.md §26) as frontend dependencies. Create one new file, `frontend/src/index.css`, containing
`@import "tailwindcss";` followed by a `@theme` block defining this feature's design tokens
(`brand`, `success`, `warning`, `danger`, `info`, `surface`, `background`, `muted`, `border`,
per CLAUDE.md §29). Register the plugin in `frontend/vite.config.ts` and import the stylesheet once
in `frontend/src/main.tsx`. No `tailwind.config.js` is created (CLAUDE.md §27, CSS-first
configuration only).

**Rationale**: This is exactly the "official Vite integration" and "CSS-first `@theme`
configuration" CLAUDE.md §26–27 mandates; it is additive (no existing build step is replaced) and
touches no domain code.

**Alternatives considered**: A component library (Chakra, MUI, Ant Design) — explicitly forbidden
(CLAUDE.md §26, constitution XXVIII "Technology Is Replaceable" is not an invitation to pick a new
one without cause). Hand-written CSS Modules — rejected because the project has already chosen
Tailwind as its styling direction; introducing CSS Modules now would create two competing styling
systems in the same codebase.

## D2: Bulk decisions reuse the existing array-accepting endpoints unchanged

**Finding**: Verified by reading `backend/src/api/testGenerationWorkflow.ts` and
`frontend/src/services/testGenerationWorkflowClient.ts` — both
`POST /api/test-generation-workflow/scenario-review/decisions` (body: `{ updates:
ReviewUpdateRequest[] }`) and `POST /api/test-generation-workflow/workflow-review/decisions` (body:
`{ decisions: WorkflowDecisionInput[] }`) already accept arrays end-to-end, including their
frontend client functions (`applyScenarioDecisions`, `recordWorkflowDecisions`). The current UI
(`ScenarioReviewStage.tsx`, `WorkflowReviewStage.tsx`) only ever calls them with a one-element array.

**Decision**: No backend route, shared-domain type, or client function signature changes. The new
bulk UI computes the target set (filter-matched scenarios, or a manual multi-selection) and passes
the resulting multi-element array to the exact same, already-existing client functions.

**Rationale**: Directly satisfies the spec's Assumption that this feature "reuses the presentation
system ... it does not alter domain contracts" and FR-018; also the smallest possible change
(constitution XXVII, Prefer Simple Architecture).

**Alternatives considered**: A new `/bulk` endpoint variant — rejected; the existing endpoints are
already bulk-capable, so a parallel endpoint would be pure duplication (CLAUDE.md §59, "prefer
extending an existing abstraction over creating a parallel one").

## D3: Scenario bulk partial-failure reporting reuses the existing per-item outcome array

**Finding**: `packages/shared-domain/src/testScenarioReview.ts` already defines
`ReviewUpdateOutcome { scenarioId; applied; revision; state; finding? }`, and
`applyScenarioDecisions` already returns `{ workflow, outcomes: ReviewUpdateOutcome[] }` — one
outcome per submitted item, each independently `applied` or carrying a `finding` (e.g.
`stale-revision`). `ScenarioReviewStage.tsx` already reads a single outcome out of this array for
one-item submissions.

**Decision**: FR-012 ("report how many items succeeded / failed") for scenario bulk actions is
satisfied by aggregating the existing `outcomes` array client-side (`count(applied) succeeded`,
`count(!applied) failed`, surfacing each failed item's `finding.message`). No backend change.

**Rationale**: The exact data FR-012 needs already exists per item; this is a pure presentation
aggregation.

## D4: Workflow bulk decisions stay atomic; no new per-item outcome contract is added

**Finding**: `backend/src/testGenerationWorkflow/workflowReviewStage.ts`'s `recordWorkflowDecisions`
validates every `workflowId` in the incoming array against the known discovered-workflow set
*before* applying any of them, throwing `UnknownWorkflowIdError` (mapped to a single `400`) if any
is unrecognized — it is all-or-nothing, and `WorkflowReviewDecision` carries no revision/staleness
concept the way `ReviewDecision` does for scenarios (there is no concurrent edit/regenerate action
for workflows — confirmed by `WorkflowReviewStage.tsx`'s own comment, "no edit/regenerate concept
for workflows"). Because the bulk UI only ever submits ids it just rendered from the same
`dependencyAnalysis.workflows` list the backend validates against, an `unknown_workflow_id` rejection
cannot occur in normal operation — it would indicate a bug, not a legitimate mid-review conflict.

**Decision**: Leave `recordWorkflowDecisions` and its route unchanged. The bulk workflow-review UI
treats the single response as one unit: on success, every selected workflow succeeded; on failure,
the confirmation is reported as failed for the whole batch (FR-012's "how many succeeded/failed"
degenerates to "0 succeeded, N failed" in the one abnormal case), without inventing a new per-item
outcomes array that nothing in the domain currently produces or needs.

**Rationale**: Building a new outcomes contract for a failure mode that cannot occur through normal
UI-driven use would be speculative infrastructure (constitution XXVII) and would touch domain code
this feature's constraints say to leave alone (FR-018).

**Alternatives considered**: Add a `WorkflowDecisionOutcome[]` mirroring `ReviewUpdateOutcome` —
rejected as unjustified scope given D4's finding.

## D5: Real progress feedback via client-side batching, not new backend infrastructure

**Finding**: Both decision endpoints process their entire input array synchronously, in-memory, in
one request; there is no existing job queue, SSE, or WebSocket channel anywhere in the backend
(confirmed: `backend/src/api/` has no such mechanism), and constitution XXVII forbids introducing
one without a concrete, already-justified need. A single request applying even 371 items completes
in-process almost instantly — there is no genuine multi-second server-side operation to report
progress on if the whole array is sent in one call.

**Decision**: To make FR-020/SC-008's "visible progress" genuine rather than a fabricated
animation, the frontend submits a large bulk action (above a small fixed batch size, decided during
implementation) as a sequence of calls to the *same, unmodified* array-accepting endpoint,
sub-dividing the target set into ordered chunks and updating a visible "`X` of `N` applied" indicator
between chunks. Below the batch-size threshold, one call is made and only the existing generic
loading state (FR-003) is shown — consistent with the "near-instant" acceptance criterion for small
selections implied by the spec's Assumptions.

**Rationale**: This reuses the existing endpoint with zero backend changes, reports real (not
simulated) progress, and avoids introducing streaming infrastructure disproportionate to a
presentation-scope feature (constitution XXVII, XXX — trade-off explicitly recorded here).

**Alternatives considered**: Server-Sent Events or a WebSocket progress channel — rejected, new
infrastructure with no other consumer in the product. An indeterminate spinner with no real
progress — rejected, does not satisfy the clarified requirement that progress be visible while a
large batch is applied, and would misrepresent a multi-request client-driven process as a single
fast one.

## D6: Duplicate "AI enhancement skipped" banner — keep the actionable one

**Finding**: `TestGenerationWorkflowPage.tsx` renders `WorkflowStageTracker` unconditionally
whenever a workflow exists, and `WorkflowStageTracker.tsx` unconditionally renders a
`workflow-ai-unavailable` status line whenever `workflow.stages.aiEnhancement.status === "skipped"`
— regardless of which stage the QA engineer is currently viewing. Separately,
`TestGenerationWorkflowPage.tsx` also renders `<AiEnhancementStage skipped .../>` specifically while
`displayStageId === "scenarioReview"`, which shows the same message *plus* the only "Retry AI
enhancement" action available anywhere in the UI.

**Decision**: Remove the `workflow-ai-unavailable` block from `WorkflowStageTracker.tsx`. Keep
`AiEnhancementStage`'s skip banner as the sole surface for this notice.

**Rationale**: `AiEnhancementStage`'s version is the actionable one (it is the only place the retry
action lives) and is correctly scoped to disappear once the QA engineer moves past scenario review,
whereas the tracker's copy would otherwise keep repeating a now-stale, non-actionable notice on
every later stage (dependency analysis, workflow review, Postman export) for the rest of the
session. `WorkflowStageTracker`'s stated purpose (per its own doc comment) is per-stage status, not
stage-specific actionable messaging.

## D7: Bulk selection state is transient UI state, not part of `TestGenerationWorkflow`

**Decision**: Manual multi-selections and the derived filter-matched bulk set live in local React
component state inside `TestScenarioReviewList.tsx` / `WorkflowReviewStage.tsx` (or a small shared
hook, see data-model.md), never sent to or stored by the backend as their own record, and cleared on
filter change (FR-019) or navigation away from the stage.

**Rationale**: Matches the spec's Key Entity definition of "Bulk Review Selection" as existing only
for the duration of applying one action, and avoids adding a new field to the `TestGenerationWorkflow`
domain type for something that is purely a review-time UI convenience (constitution X, Domain Model
First — only concepts with business meaning belong on the domain model).

## D8: Dead, already-unreached components are out of this feature's styling scope

**Finding**: `frontend/src/components/PostmanExportPanel.tsx`, `TestScenarioList.tsx`, and
`TestScenarioDetail.tsx` are not imported by `TestGenerationWorkflowPage.tsx` or any component it
renders (confirmed by import search) — they are unstyled leftovers from before AP-009 consolidated
the guided workflow, referenced only by their own now-orphaned test files.

**Decision**: These three components (and their dedicated tests) are excluded from this feature's
scope. Removing genuinely dead code is a separate, unrelated cleanup and is not part of "Presentation
System & Review Scalability."

**Rationale**: CLAUDE.md §58/§65 — avoid unrelated refactoring and keep the diff reviewable against
this feature's own boundary.

## Summary of resolved unknowns

| Area | Resolution |
|---|---|
| Styling technology | Tailwind CSS v4, official Vite plugin, CSS-first `@theme` (D1) |
| Bulk decision transport | Existing array-accepting endpoints, unchanged (D2) |
| Scenario partial-failure reporting | Existing `ReviewUpdateOutcome[]`, aggregated client-side (D3) |
| Workflow partial-failure reporting | Existing atomic endpoint retained; no new outcome contract (D4) |
| Bulk progress feedback | Client-side batching against the existing endpoint (D5) |
| Duplicate skip banner | Remove `WorkflowStageTracker`'s copy, keep `AiEnhancementStage`'s (D6) |
| Bulk selection persistence | Transient UI state only (D7) |
| Styling scope boundary | Live guided-workflow tree only; dead components excluded (D8) |
