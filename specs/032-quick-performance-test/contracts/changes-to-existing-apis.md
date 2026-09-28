# Contract Changes to Existing APIs (AP-032)

AP-032 changes three shipped contracts. Each change is stated with the requirement that makes it
intentional (constitution XXVI; CLAUDE.md §23).

## 1. AP-029 performance API (`/api/test-generation-workflow/performance`)

Source contract: [specs/031 contracts/performance-api.md](../../031-k6-performance-testing/contracts/performance-api.md).

| Change | Before | After | Requirement |
|---|---|---|---|
| `PerformancePlan.scope` | `"selection" \| "all"` in every plan response | Removed | FR-022 |
| `PUT /plan` `scope` field | Accepted | `400 invalid_request` | FR-022, research Q7 |
| Operations in scope | Chosen by `scope` | The API review selection, or every operation when none | FR-022 |
| `plan.omitted` | Could list operations outside the selection (`scope: "all"`) | Only operations in scope | FR-023, SC-005 |
| `PerformancePlan.source` | Absent | `"guided"` | FR-013 |
| `PerformancePlan.credentialProducerOperationKeys` | Absent | Added (derived) | FR-003a, FR-024 |
| `GET /plan/steps/:stepId/request` | Absent | Added (see the quick contract) | FR-008, FR-012a |
| `GET /plan/removed-operation?operationKey=` | Absent | Added 2026-09-28 (see the quick contract) | FR-024a |
| `PerformanceRun.planSource`, `PerformanceRunSummary.planSource` | Absent | `"guided"` for runs from this path and for every run recorded before AP-032 | FR-013 |
| `GET /runs` | Every performance run of the session | Only `planSource: "guided"` runs | research Q12 |

Unchanged: the stage gate (`409 postman_generation_incomplete`), every other route, body, error
and check order, and the stage transitions.

## 2. AP-017 environments routes (`/api/test-generation-workflow/environments`)

Routes: `GET /environments`, `POST /environments`, `PUT /environments/:environmentId`.

| Change | Before | After | Requirement |
|---|---|---|---|
| Access condition | The guided workflow's `postmanGeneration` is `complete` | That, **or** the session has a quick test | FR-016, FR-018 |

Unchanged: the refusal when neither holds (`409 stage_not_active`), request and response bodies,
validation, tiers, encryption (AP-025), and session scoping. Environments remain one set per
session, visible from both paths (FR-017). The functional-execution routes keep their own
requirement that `postmanGeneration` is complete.

## 3. Execution-slot checks

`POST /api/test-generation-workflow/execution/start` and the uploaded-collection execution start
route already treat any performance run in progress as occupying the slot
(`getPerformanceInProgressRun`). A quick run is a performance run in the same table, so no change
is needed; a test covers it (US3 AS4).

## 4. Frontend entry chooser (UI contract)

The start screen offers three entries: the guided workflow, "Import & Run Collection" and "Quick
performance test", the last with the sentence "Load-tests every operation of an uploaded
specification with generated requests that no one reviews." (FR-001). The top-level tabs gain
"Quick Performance Test".
