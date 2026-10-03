# Contract: Changes to Existing Modules and APIs

**Feature**: AP-037 | **Phase one** is additive. **Phase two** removes the items listed last.

## Phase one: additive

### Shared domain (`packages/shared-domain`)
- **New `requestChain.ts`:** the types in data-model.md, plus:
  - `parseReferences`;
  - `analyzeChainPlan`;
  - `chainRunOrder`;
  - `summarizeChainWrites`.
- **Moved unchanged into the package:**
  - `parseCapturePath` and `formatCapturePath`, from `backend/src/performance/plan/capturePath.ts`,
    which re-exports them;
  - `SUPPORTED_DYNAMIC_VARIABLES`, from `backend/src/performance/collection/dynamicValues.ts`, which
    re-exports it.
- **`performance.ts`, additive only:**
  - `PerformanceResult` optional fields (`steps[].checks`, `setupSteps`, `dataSets`,
    `tokenRefreshes.bySetupStep`);
  - `ChainRunFailureCategory` (`PerformanceRunFailureCategory | "setup-step-failed"`). Legacy runs
    never carry it.

  `PerformancePlan`, `PerformanceRun` and every legacy field are unchanged.

### Backend
- **`app.ts`:** mounts `chainPlanRouter` at `/api/chain-plans`, with an 8 MiB JSON limit before the
  global parser.
- **`persistence/connection.ts`:**
  - `chain_plans` and `chain_plan_data_sets` (`CREATE TABLE IF NOT EXISTS`);
  - `performance_runs` gains `chain_plan_id`, `plan_document_encrypted` and `plan_document_iv`
    (`ensureColumn`).
- **`persistence/performanceRunRepository.ts`:**
  - legacy list methods exclude `plan_source = 'chain'`;
  - new `createChainRun`, `getChainRun` and `listChainRuns`;
  - `checkpoint`, `settle`, `requestCancel`, `isCancelRequested` and `markInterruptedRunsCancelled`
    are unchanged and apply to both kinds.
- **`performance/report/aggregate.ts`:** `createAggregate(layout: RunLayout, …)`.
  `layoutFromPlan(plan)` gives the legacy behaviour unchanged, which the existing tests prove. It
  also handles the new metric streams (contracts/chain-script.md).
- **`performance/report/findings.ts`:** reads step labels from the layout.
- **`performance/runPerformanceTest.ts`:**
  - accepts a run of either kind;
  - writes the data set files for chain runs after the integrity check;
  - settles `setup-step-failed` (R12).
- **Exported for the seeders, unchanged:**
  - `credentialProducerOperationKeys` (`buildPlan.ts`);
  - `workflowLinks` (`buildJourneys.ts`);
  - `captureNameFor` (`convertWorkflowJourney.ts`);
  - `splitUrl` (`requestPreview.ts`).
- **`backend/scripts/perfStubTarget.ts` and `tests/fixtures/execution/customersTarget.ts`:** the
  existing `customers-auth` mode (AP-036) already serves a counting `POST /auth/token` with
  `expires_in` and `/api/v1/customers[/{id}]`. This feature adds `PERF_STUB_WRONG_ID_EVERY`,
  `PERF_STUB_SLOW_EVERY` and `PERF_STUB_SLOW_MS` for US3, plus a token-call count line. It still
  prints counts only.

### Frontend
- **`App.tsx`:** a **Performance plans** tab rendering `RequestChainPlansPage`, and a callback that
  opens a plan by id.
- **The three entry points:** `PerformanceTestingStage`, `QuickPerformancePage` and
  `ExternalCollectionRunPanel` each gain **Create request-chain plan**, which opens the seed
  dialog. The old screens are unchanged.
- **`usePerformanceRuns`:** reused for chain runs through its generic types. It is unchanged.

### Unchanged
- **Legacy plans.** The guided, quick and collection plan routes, their stores, `renderScript.ts`
  (legacy runtime and goldens), `renderHtmlReport.ts` and every legacy plan screen are unchanged.
- **Other features.** AP-034 user scripts are unchanged.

## Phase two: removals (FR-036 to FR-038)

### Routes removed
- Under `/api/test-generation-workflow/performance`, `/api/quick-performance` and
  `/api/collection-performance`:
  - `GET` and `PUT /plan`;
  - `POST /plan/reset`;
  - `GET /plan/values`;
  - `GET /plan/steps/:stepId/request`;
  - `GET /plan/removed-operation`;
  - `GET /plan/response-fields`;
  - `POST /script`;
  - `GET /script/download`;
  - `POST /runs`.
- `POST /api/collection-performance`, `GET /api/collection-performance`, `POST …/rebuild` and
  `POST …/environment`. The collection seeding route replaces them.

### Routes kept, read-only
- **Legacy runs.** `GET …/runs`, `GET …/runs/:runId`, `POST …/runs/:runId/cancel` and
  `GET …/runs/:runId/report`, under the old bases. They let legacy runs be listed and their reports
  opened (FR-037).
- **The quick upload.** `POST /api/quick-performance` and `GET /api/quick-performance` stay, as the
  quick test's upload and status. The quick test becomes a seeding source only.

### Modules removed
The module list is in research.md R24. The legacy `RUNTIME` is deleted with them. `PerformancePlan`
keeps only the fields that stored snapshots and `renderHtmlReport` read.

### Frontend removed
- **Plan screens:** `PerformancePlanScreen`, `JourneyList`, `UserJourneysPanel`, `StepBodyEditor`,
  `StepParameterEditor`, `CaptureEditor`, `BindingSourceControl` and `AddStepDialog`.
- **Collection plan components:** `OtherOperationsTable`, the `collection/` performance components
  and `CollectionPerformancePage`.
- **Old clients:** the old plan client functions.
- **Legacy runs view.** It shows legacy runs with the note: "Recorded before request-chain plans:
  you can open the report, but it cannot be run again or restored."
