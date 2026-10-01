# Contract: Changes to Existing APIs and Modules (AP-034)

Each change below is additive or internal. No existing request or response shape changes.

## AP-017 / AP-032 environments (`/api/test-generation-workflow/environments`)

- `requireEnvironmentAccess()` (`api/testGenerationWorkflow.ts:166`) also passes for a session
  that holds at least one user script (spec FR-024, research R18). The refusal for any other
  session stays `409 stage_not_active`.
- Nothing else changes: the routes, encrypted storage, tiers and duplicate-name rule are the same.

## The shared execution slot

- The three copies of the in-progress check (`api/performanceRuns.ts:63`,
  `api/testGenerationWorkflow.ts:793`, `api/externalCollections.ts:467`) become one helper,
  `execution/executionSlot.ts#findExecutionInProgress()`.
- The helper also checks `user_script_runs`.
- Each start route keeps its response: `409 execution_in_progress` with `{ runId }`.
- No await is allowed between the check and the insert, as today.

## AP-029 k6 runner (`performance/k6/runner.ts`)

- `buildK6Args` and `buildChildEnv` are unchanged, and so is their pinned test.
- Two new functions sit beside them, each with its own pinned test (research R10, R11):
  - `buildUserScriptK6Args(runDir, load)`;
  - `buildUserScriptChildEnv(processEnv, mapped)`.
- `RunnerStartInput` gains an optional `args` field, so the runner can spawn either argument list.
  When `args` is absent, the current behaviour is unchanged.
- stderr handling becomes a callback the caller supplies: generated runs count lines as before,
  and user-script runs filter JSON log lines (R13).

## AP-029 generated script (`performance/k6/renderScript.ts`, AP-029 FR-022a)

- The fixed runtime changes as in research R23:
  - a `VALUE_ENV` literal table;
  - `Map` scopes and token store;
  - setup tokens passed as an array;
  - an own-field response walk;
  - a header comment pointing to AP-034.
- The script stays byte-identical for the same plan (FR-020), and the golden fixture
  `backend/tests/fixtures/performance/golden/script.js` is regenerated once.
- Unchanged: the imports, `options`, `SYSTEM_TAGS`, request tags, custom counters, checks, the
  returned `valueIndex`, the environment template and `buildK6Args`. The metrics stream and
  reports of generated runs are therefore unchanged.
- The download routes (`GET <base>/script/download`) are unchanged.

## AP-029 metrics stream and report

- `parseMetricsLine` gains an option to accept every metric name and to return `type: "Metric"`
  declarations. The default stays the current allow-list.
- `renderHtmlReport.ts` exports its existing helpers (escaping, scales, timeline SVG, phase
  table, `STYLE`, `REPORT_CSP`) for `renderUserScriptReport`. The generated-run report output is
  byte-identical (checked by the existing report tests).

## Startup (`server.ts`)

- `recoverUserScriptRunsAtStartup()` runs after the existing performance recovery.

## Frontend

- `EntryChoice` gains `"user-script"`, and `App.tsx` gains a fourth tab and page.
- `usePerformanceRuns` becomes generic, as `usePerformanceRuns<TRun, TSummary>(client)`, typed
  against a narrowed `PerformanceRunsClient`. The guided and quick callers compile unchanged.
- `ThresholdEditor` takes its scope options as a prop. The current callers pass the step options
  they use today.

## Specification pointers (spec "Relationship to prerequisite specifications")

- AP-029 FR-026 (`specs/031-k6-performance-testing/spec.md`) gains: "A user-supplied script runs
  only under AP-034 (specs/034-run-user-k6-script), never through this feature." This pointer and
  the new FR-022a were added on 2026-10-01.
- AP-032 FR-018 (`specs/032-quick-performance-test/spec.md`) gains: "AP-034 FR-024 also opens
  environments to a session that holds a stored user script."
- `specs/031-k6-performance-testing/contracts/performance-api.md` gains a pointer to
  [user-scripts-api.md](./user-scripts-api.md).
