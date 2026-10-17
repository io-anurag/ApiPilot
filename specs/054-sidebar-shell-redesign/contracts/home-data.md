# Contract: Home data

Implements FR-018 to FR-021, SC-006. Every call below already exists; the feature adds no backend endpoint and changes no payload (FR-025). Home reads only while it is the visible destination, once per visit, aborts on leaving, never polls.

## Figures

| Figure | Source | Unavailable text |
|---|---|---|
| Specification coverage % | `useCoverage({}, active)` snapshot, metric `spec-operations` (`numerator` / `denominator` / `percentage`) | `no-workflow`: "Needs a specification from the Guided Workflow."; `error`: "Coverage is unavailable: {message}" |
| Runtime-verified % | same snapshot, metric `runtime-operations` | same; when no run: "No run yet" |
| Open gaps, high priority | `snapshot.totals.gaps`, gaps with `priority = "high"` | same |
| Scenarios, pending | `snapshot.context.scenarioCounts.total` and `.pending` | same |
| Coverage by area | `snapshot.categoryCoverage` (positive, negative, boundary, security); unavailable groups show their `reason` | the group's `reason` text |
| Operations by method | count of `snapshot.operations[].method`, labelled "Operations in scope" | omitted with "Needs a specification." |
| Guided Workflow tile cue, unfinished stage | `fetchCurrentWorkflow()`: `activeStageId`, `stages`; also feeds the sidebar | none (cue omitted) |
| Performance tile cue | the `performanceDraft` flag held by `App` (accurate once Performance has been opened; in-memory only) | none |
| Connection | existing `fetchHealth()` | existing three states |
| AI provider | new frontend client `fetchAiStatus()` over the existing `GET /api/ai/status`: `state`, `provider`, `reason` | "AI status unavailable" |

The AI tile shows the readiness state in words, the provider (local or mock) and, when unavailable, the reason. It never shows a model identifier, benchmark data or `lastKnownReadiness` (those are historical, not live state).

## Next steps (derived, FR-021)

In this order, each a link to where it is done, shown only when true:

1. Guided Workflow unfinished: "Continue {stage label}" -> `#/guided/<activeStageId>`.
2. `context.scenarioCounts.pending > 0`: "Review {n} pending scenarios" -> `#/guided/scenarioReview`.
3. `operationCounts.withNoScenarios > 0`: "Cover {n} operations with no generated tests" -> `#/coverage`.
4. `assertionOutcomes` failed > 0 or `operationCounts.withFailures > 0`: "Investigate {n} failing results" -> `#/coverage`.
5. Performance draft: "Finish the draft load test" -> `#/performance`.

None true: "Nothing is waiting on you." in text.

## Recent runs

Merge by `startedAt`, newest first, show 8. Ten owners are read per source.

| Source | Reads | Row |
|---|---|---|
| Import & Run | `fetchUploadedCollections()`, then `fetchUploadedCollectionRuns(id)` for the ten most recently updated | subject `uploadedCollectionSnapshot.name`, status `in-progress/completed/cancelled` |
| Performance | `listPlans()`, then `chainRunsClient(planId).fetchRuns()` for the ten most recently updated (`RECENT_RUNS_PLAN_LIMIT`) | subject = plan name from `ChainPlanSummary`, status adds `failed`; retired legacy runs are not included |
| Run k6 Script | `GET /api/user-scripts/runs` without `scriptId` (new frontend client function; the endpoint already allows it) | subject `snapshot.scriptName` |

Status words: In progress, Completed, Cancelled, Failed (Import & Run never reports Failed). A source that cannot be read is skipped and named in words ("Run k6 Script runs could not be read"); the list is empty with a text reason only when no source returned a run. A Debug run creates no run record (Performance and Run k6 Script debug services), so it never appears.

## Deep links (frontend only)

- Import & Run: existing prop `openRunRequest: { runId: string; token: number }`.
- Performance: `OpenPerformancePlanRequest` gains an optional `runId`; `PerformancePage.open(planId, runId?)` already accepts it.
- Run k6 Script: new `openRunRequest: { runId: string; token: number }` prop on `UserScriptPage`, opening the script that owns the run on its Runs & reports view.

The request is held in `App` state with a token (the pattern `importRunRequest` and `guidedStageRequest` use) and the destination address is set to the screen's address with no id in it.

## Tests

Hook tests with a stubbed `fetch`: each figure from a fixture snapshot; no-workflow and error states render a reason and no number; recent runs merge order, the 8-row cap, a failing source skipped and named, empty state; the AI client maps the three payload shapes; Home issues no request while hidden. SC-006 cross-check: the same fixture snapshot feeds both Home and the Coverage view model and the figures are asserted equal.
