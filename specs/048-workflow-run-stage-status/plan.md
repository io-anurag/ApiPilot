# Implementation Plan: Guided Workflow Run Stage Status

**Branch**: `048-workflow-run-stage-status` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/048-workflow-run-stage-status/spec.md`

## Summary

A finished Import & Run run of the collection the guided workflow handed over completes the `execution` stage; a finished request-chain performance run seeded from the same specification completes the `performanceTesting` stage. The backend does this where each run settles, so the status is correct whether or not a screen is open. The guided workflow page, which stays mounted but hidden, refetches the workflow when it becomes visible and while it is visible and still waiting, so the tracker updates without a reload.

Four additive changes, no new service, status value or stage:

1. The upload accepts an optional `workflowId` and stores it on the uploaded collection (D1).
2. The Import & Run settle point tells the workflow module when a linked run completes (D2).
3. The performance run settle point tells it when a run seeded from the workflow's specification ends (D3).
4. `performanceTesting` gains one stage transition, and the page gains a visibility-driven refetch (D4, D5).

## Technical Context

**Language/Version**: TypeScript on Node.js 24 (backend, shared-domain), React + Vite (frontend)

**Primary Dependencies**: Express, multer (existing upload parsing), better-sqlite3 behind the existing repositories, Vitest, Supertest, React Testing Library. No new dependency.

**Storage**: the existing `uploaded_collections` table gains one nullable column through the existing single-column migration helper (`persistence/connection.ts`, `addColumn`). Workflow state stays in the in-memory per-session store. Session expiry already removes both.

**Testing**: Vitest unit tests for the completion rules, Supertest integration tests for the upload field and the end-to-end stage change, React Testing Library for the page refetch and the upload form.

**Target Platform**: local backend plus browser, as today.

**Project Type**: web application (backend, frontend, shared-domain workspaces).

**Performance Goals**: a settled run updates the stage in the same tick; the page shows it within 5 seconds while visible (SC-004).

**Constraints**: deterministic (FR-013); session-scoped; nothing leaves the machine; no run content copied into the workflow record (FR-015); a failure while updating a stage must never fail or alter the run that triggered it.

**Scale/Scope**: one current workflow per session; one boolean check per settled run.

## Constitution Check

*GATE: passes before research and after design. No amendment needed; no Complexity Tracking entries.*

| Principle | Result |
|-----------|--------|
| II, XVI, XXIV Deterministic, reproducible | Pass. Stage changes follow only from recorded run outcomes and recorded links; no AI, no timing. |
| IX Separation of concerns | Pass. Execution and performance modules call one workflow-side function; the workflow module does not learn how runs work. |
| XIII, XXVI Provenance, traceability | Pass. The upload records the workflow it came from; the stage records only that a qualifying run finished. |
| XVII Security and privacy | Pass. No new execution, no new network, no content copied: only a workflow id string and a status. The 2026-09-20 and 2026-09-24 exceptions are not cited or widened. |
| XVIII Secrets | Pass. Nothing secret is read or stored. |
| XIX Fail safely | Pass. A failed stage update is logged with its category and does not change the run; it is not silent. |
| XX Logging | Pass. Logs carry workflow id, stage, run id and outcome only. |
| XXI Testability | Pass. The completion rules are pure functions over (workflow, run facts). |
| XXVII Simple architecture | Pass. No queue, event bus or push channel; a visibility-driven refetch and a short poll reuse the existing client. |
| XXXIII Presentation | Pass. No new visual element; the tracker already derives from stage status. |

## Project Structure

### Documentation (this feature)

```text
specs/048-workflow-run-stage-status/
├── spec.md
├── plan.md                  # This file
├── research.md              # Phase 0
├── data-model.md            # Phase 1
├── quickstart.md            # Phase 1
├── contracts/
│   └── changes-to-existing-apis.md
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── externalCollections.ts            # sourceWorkflowId? on UploadedCollectionSet

backend/src/
├── api/externalCollections.ts        # accept and validate the optional workflowId field
├── persistence/
│   ├── connection.ts                 # add source_workflow_id column (addColumn)
│   └── uploadedCollectionRepository.ts  # read/write the column
├── externalCollections/
│   ├── uploadedCollectionStore.ts    # carry sourceWorkflowId through createUploadedCollection
│   └── uploadedCollectionExecutionStore.ts  # settleRun: notify on "completed"
├── performance/runPerformanceTest.ts # settle: notify on any final state
└── testGenerationWorkflow/
    ├── runCompletion.ts              # NEW: completeExecutionForUpload, completePerformanceForRun (pure rules + apply)
    └── workflowStore.ts              # performanceTesting: not-yet-reached -> complete

frontend/src/
├── services/importPreload.ts         # ImportPreload carries workflowId
├── App.tsx                           # pass workflow id into the preload; pass visibility to the page
├── components/ExternalCollectionUpload.tsx  # send workflowId only for the preload's own files
├── services/externalCollectionsClient.ts    # createUploadedCollection accepts workflowId
└── pages/TestGenerationWorkflowPage.tsx     # isVisible prop; refetch on visible and while waiting

backend/tests/ and frontend/tests/    # beside the units above
```

**Structure Decision**: the existing web-application layout. The new rules live in one new workflow-side module so the two run modules each add a single call and stay unaware of stage names.

## Design Decisions

Full reasoning is in [research.md](research.md); the decisions are:

- **D1 Link an upload to its workflow.** `workflowId` is an optional text field of the existing multipart upload. The form sends it only when the selected collection and environment files are the preload's own File objects, so a hand-picked copy is never linked (spec edge case).
- **D2 Execution.** The run's settle point (`settleRun` in `uploadedCollectionExecutionStore.ts`, reached from `runUploadedCollectionExecution`) calls `completeExecutionForUpload` when it settles a run as `completed`. That function receives the upload's `sourceWorkflowId` from the run's start (captured when the run is launched, so a later deletion of the upload does not lose it), compares it with the session's current workflow id, and moves `execution` from `active` to `complete`. Any other stage status is left alone (a skip stays a skip, FR-009). The store's `completed` status already includes runs that stopped on an error after starting, which is the spec's "ends without being cancelled"; `cancelled` does nothing.
- **D3 Performance.** The only runs that can start today are request-chain runs (AP-037 retired the older plans), so `settle` in `startPerformanceRun` calls `completePerformanceForRun` for any status other than `in-progress`. A chain run counts when its snapshot's seed source is `{ kind: "workflow", specificationTitle }` equal to the current workflow's specification title, or `{ kind: "specification", filename }` equal to its `specificationFilename`. It needs `postmanGeneration` complete and moves `performanceTesting` to `complete`; an already complete stage is untouched. This runs inside `runWithSession(sessionId, …)` because the settle path is not guaranteed a request context.
- **D4 Stage model.** `performanceTesting` gains `not-yet-reached -> complete`. It has no screen that makes it `active`, so a two-step path would invent an Active state nobody sees.
- **D5 Freshness.** `TestGenerationWorkflowPage` receives `isVisible` from App. When it turns true the page refetches the current workflow and replaces its state if `updatedAt` differs. While visible and the browser tab is not hidden, and Postman Generation is complete, it repeats every 5 seconds until Execution is complete or skipped and Performance Testing is complete. A `null` response changes nothing.

## Risks

- **Identity by name.** A specification seed is matched by file name and a workflow seed by title, so two different documents sharing one would match (spec Assumptions). Accepted: the recorded seed holds nothing more precise, and adding a content hash would widen the plan contract (specs/037).
- **Legacy plans.** Retired AP-029/032/033/036 plans are not handled, per the constitution's rule that they gain no capability.
- **Settle path context.** The Import & Run settle already runs inside a request context; the performance one is wrapped explicitly. Both are covered by tests that settle a run outside a request.
- **Regenerated collection.** A run of an earlier upload still completes Execution; staleness after regeneration follows the existing rules (spec Edge Cases).

## Complexity Tracking

No constitution violations to justify.
