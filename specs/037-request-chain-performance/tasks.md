---

description: "Task list for AP-037 Request-Chain Performance Plans"
---

# Tasks: Request-Chain Performance Plans (AP-037)

**Input**: Design documents from `specs/037-request-chain-performance/`

**Prerequisites**:
- [plan.md](./plan.md)
- [spec.md](./spec.md) (FR-001 to FR-047, SC-001 to SC-009, Clarifications 2026-10-02 and
  2026-10-03)
- [research.md](./research.md) (R1 to R27)
- [data-model.md](./data-model.md)
- [contracts/chain-plan-api.md](./contracts/chain-plan-api.md)
- [contracts/chain-script.md](./contracts/chain-script.md)
- [contracts/changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md)
- [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution XXI and XXXI make automated tests part of done, and research R25
defines the test plan. Write each story's tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story. Phase one is US1, US2, US3, US4 and US6, in
priority order. Phase two is US5, the retirement of the old plans (FR-036 to FR-038), which must not
start until phase one passes on every entry point.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (a different file, and no dependency on an incomplete task).
- **[Story]**: the user story the task belongs to (US1 to US6).
- Paths are relative to the repository root. Workspaces are `backend/`, `frontend/` and
  `packages/shared-domain/`.

## Standing rules for every task

- **Governance.** Constitution v2.8.0 (commit `d0873c3`, merged to `main`) covers request-chain
  plans under XVII's 2026-09-24 exception. Phase two (US5) needs the further amendment
  TODO(XVII_LEGACY_PLAN_TEXT) first (Phase 9 gate).
- **Commits.** Do not commit. The user reviews the diff and commits it.
- **Scope.**
  - No AI anywhere in this feature (FR-038).
  - No new dependency or environment variable. `multer`, `postman-collection`, `acorn` and the
    AP-025 credential cipher are already present. CSV parsing is our own code (R14).
- **Phase one leaves the old plans untouched.** The guided, quick and collection plans,
  `backend/src/performance/k6/renderScript.ts` (`RUNTIME`) and the goldens `script.js`,
  `user-journeys-script.js` and `collection-script.js` must be byte-identical at the end of phase
  one (R1, R10).
- **Data, never code (FR-016, FR-030).**
  - Step content, statuses, extractors, checks and data set column names reach the script only
    inside JSON data constants.
  - `CHAIN_RUNTIME` in `backend/src/performance/k6/renderChainScript.ts` is one fixed text for
    every plan.
  - No expression, pattern, filter or function is ever accepted from a plan.
- **No values anywhere (FR-027, FR-028, FR-044, XVIII).** No environment value, extracted value,
  data set value or literal credential may enter any of these:
  - the plan document, the script or the environment template;
  - the run snapshot or the report;
  - an API response, except the data set preview's non-secret cells;
  - the logs.
- **Never log** plan names, step content, URLs, header names or values, column names, file names or
  values. Logs carry ids, counts, sizes, codes and durations (R27, contract Logging).
- **Ordering.** Never use `localeCompare`; use `compareCodeUnits` from
  `backend/src/postman/ordering.ts`. The same plan gives a byte-identical script. The same seed
  source and selection give the same plan (FR-020, FR-030).
- **Nothing guessed (XIV, XV).**
  - Seeding uses only documented statuses, approved workflows and the collection's own setters.
  - Outside seeding, ApiPilot never creates an extractor or a reference.
- **Frontend.**
  - Tailwind v4 with AP-027 tokens only. No inline styles and no new UI library.
  - Every state is shown in text, not colour alone.
  - Keyboard access and visible focus.
  - HTTP calls only in `frontend/src/services/requestChainClient.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Governance record, measurement baseline, fixtures and test harness extensions.

- [X] T001 Create `specs/037-request-chain-performance/validation.md` with:
  - a "Governance" section recording that constitution v2.8.0 (`d0873c3`) is merged to `main` and
    covers AP-037, and that phase two needs TODO(XVII_LEGACY_PLAN_TEXT);
  - an empty "Validation runs" section for T092 and T093.
- [X] T002 [P] Add `scripts/count-performance-lines.mjs`. It counts non-test `.ts` and
  `.tsx` lines (as `wc -l` counts them) over plan.md's "SC-006 measured set", prints a per-area table and a total, and
  ignores missing paths. Run it now and record the baseline (expected 16,110) in
  `specs/037-request-chain-performance/validation.md` under "SC-006".
- [X] T003 [P] Add fixtures under `backend/tests/fixtures/chain/`:
  - `weak-spec.yaml`: placeholder examples, `POST /customers` documented `200`, the wrong path
    `/customer/{customerId}`, no token endpoint, and a `format: password` field;
  - `customers.csv`: 50 rows, header `tenant_id,first_name,last_name,email,username,password`;
  - `logins.csv`: 10 rows;
  - refusal files: `bad-short-row.csv` (line 7 has 5 fields), `bad-no-header.csv` (empty),
    `bad-not-utf8.csv`, `bad-duplicate-column.csv`, `bad-column-name.csv` (`first name`),
    `bad-unterminated-quote.csv`, and a 51-column file;
  - `chainPlans.ts`: builders `chainPlan()`, `chain()`, `step()`, and `customerLifecyclePlan()`,
    the seven US1 steps.
- [X] T004 [P] Extend `backend/tests/fixtures/execution/customersTarget.ts` and
  `backend/scripts/perfStubTarget.ts` (`customers-auth` mode):
  - `PERF_STUB_WRONG_ID_EVERY=<n>` returns a wrong `id` on every n-th `GET /api/v1/customers/{id}`;
  - `PERF_STUB_SLOW_EVERY=<n>` with `PERF_STUB_SLOW_MS` delays every n-th response;
  - a printed token-call count line.

  It still prints counts only, never ids or tokens. Update the header comment with an AP-037
  paragraph.
- [X] T005 [P] Extend `backend/tests/fixtures/performance/k6Sandbox.ts`:
  - `k6/execution`: `vu.idInTest`, `scenario.iterationInTest` (a global counter across sandbox
    virtual users), and `test.abort(reason)`, which throws a sentinel the sandbox records;
  - `k6/data` `SharedArray`, which calls its factory once;
  - an `open(path)` that reads from a `files` map passed in sandbox options, and fails the test for
    any other path;
  - recording of `Counter.add` calls with their tags.

  Keep every existing behaviour, so the existing renderScript and collectionScript tests still pass.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts and analysis, storage, saving with credential moves, the plan CRUD API,
the client, and the plans page. These block every story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Move `parseCapturePath`, `formatCapturePath` and their types from
  `backend/src/performance/plan/capturePath.ts` into `packages/shared-domain/src/capturePath.ts`,
  unchanged. Export them from `packages/shared-domain/src/index.ts`, and make the backend file
  re-export them so every AP-035 import keeps working. `backend/tests/unit/performance/capturePath.test.ts`
  must pass unchanged.
- [X] T007 [P] Move `SUPPORTED_DYNAMIC_VARIABLES` from
  `backend/src/performance/collection/dynamicValues.ts` into
  `packages/shared-domain/src/dynamicVariables.ts`, exported from the index, with the backend
  re-exporting it. The AP-036 tests pass unchanged.
- [X] T008 Add `packages/shared-domain/src/requestChain.ts` with every type in data-model.md "Plan",
  "Data sets", "Analysis", "Credential moves" and "Run snapshot and run". In
  `packages/shared-domain/src/performance.ts`, add only these, all optional:
  - `StepResult.checks?`;
  - `PerformanceResult.setupSteps?`;
  - `PerformanceResult.dataSets?`;
  - `tokenRefreshes.bySetupStep?`;
  - `ChainRunFailureCategory = PerformanceRunFailureCategory | "setup-step-failed"`, the one name used
    for it everywhere.

  Export everything from the index. `PerformancePlan` and `PerformanceRun` are unchanged.
- [X] T009 [P] Write `packages/shared-domain/tests/unit/requestChain.test.ts`, first:
  - **`parseReferences`:** names, the 13 dynamic variables, an unsupported `{{$x}}`, `{{a b}}`, a
    lone `{{`.
  - **`chainRunOrder`:** setup steps first in plan order, then iteration positions.
  - **`analyzeChainPlan`:**
    - a use before extraction, within a chain and across chains;
    - a per-virtual-user extractor before an every-iteration use;
    - a setup step using an iteration value (blocked), a data set column (allowed, first row) and
      an earlier setup extraction (allowed);
    - `host-from-variable`, `invalid-url` and `missing-expected-status`;
    - `empty-chain`, and a chain of only setup steps, which is a notice;
    - `extracted-more-than-once`, `column-shadows-environment` and `data-set-unused`;
    - required values with secret, provided or `null`, and steps;
    - hosts with `{{baseUrl}}` first, then literal origins in plan order.
  - **`summarizeChainWrites`:** per step, POST/PUT/PATCH/DELETE counts.
  - **Performance:** 1,000 steps analysed in under 10 ms (median of 5 runs).
- [X] T010 Implement `parseReferences`, `chainRunOrder`, `analyzeChainPlan` and
  `summarizeChainWrites` in `packages/shared-domain/src/requestChain.ts` (R3, R5 to R7). They are
  pure, with no I/O and no values, and take `AnalysisContext` (names only). T009 passes.
- [X] T011 [P] In `backend/src/persistence/connection.ts`:
  - add `chain_plans` and `chain_plan_data_sets` exactly as data-model.md "Storage", with
    `CREATE TABLE IF NOT EXISTS` and session indexes;
  - add `chain_plan_id`, `plan_document_encrypted` and `plan_document_iv` to `performance_runs` via
    `ensureColumn`;
  - comment the AP-037 reasoning (encrypted document; names only in plain columns).
- [X] T012 [P] Write `backend/tests/unit/persistence/chainPlanRepository.test.ts` (`:memory:`), then
  implement `backend/src/persistence/chainPlanRepository.ts`:
  - `list(sessionId)` (summaries without decrypting), `get`, and `create`;
  - `save(sessionId, plan, expectedRevision)`, which returns a conflict result rather than
    overwriting;
  - `delete` and `deleteBySession`.

  The document is encrypted with the credential cipher. The test asserts that the raw row bytes do
  not contain a step URL or a header value.
- [X] T013 [P] Write `backend/tests/unit/persistence/performanceRunRepository.chain.test.ts`, then
  extend `backend/src/persistence/performanceRunRepository.ts`:
  - `createChainRun(sessionId, run, planDocument)` encrypts the plan copy;
  - `getChainRun`, `listChainRuns(sessionId, planId)` and `getChainRunPlanDocument(sessionId, runId)`;
  - legacy `listBySession` and `listBySessionAndSource` exclude `plan_source = 'chain'`;
  - `planSourceOf` maps `chain` for chain rows only;
  - `checkpoint`, `settle`, `requestCancel` and `markInterruptedRunsCancelled` work on chain rows
    unchanged.

  Existing repository tests pass.
- [X] T014 [P] Write `backend/tests/unit/performance/chain/savePlan.test.ts`, first:
  - **Validation:** each `invalid_step` field (method, a URL with `?` or `#`, header name, `Host` or
    `Content-Length`, reference grammar, field path, `time-at-most` range) and every R26 limit
    (`plan_limit_exceeded` naming it);
  - **Ids:** new step ids become `added`; stored sources are kept whatever the client sends;
  - **Digest:** `changed` is recomputed from the seed digest, and an edit back to the seeded content
    clears it;
  - **Fingerprint:** it changes with step content, load profile, thresholds and data set structure,
    and not with name, seeding report, target environment, `changed` or source;
  - **Counters:** ids are never reused after a delete.
- [X] T015 Implement `backend/src/performance/chain/savePlan.ts`, with
  `normalizeAndValidate(input, stored)`, `stepDigest(step)`, `planFingerprint(plan)` and the limits
  of R26, so that T014 passes. Use canonical JSON with fixed key order, and `sha256Hex` from
  `backend/src/performance/plan/identifiers.ts`.
- [X] T016 [P] Write `backend/tests/unit/performance/chain/literalCredentials.test.ts`, first:
  - **Values moved:** `Authorization: Bearer abc` becomes `Bearer {{authorization_s2}}`;
    `Authorization: abc` moves whole; `Cookie: a=b` moves whole; `Proxy-Authorization` is covered.
  - **Values left alone:** `Bearer {{token}}`.
  - **Mixed:** `Bearer abc{{x}}` gives `credential_mixed_literal`.
  - **Password fields:** a `passwordFields` path with a literal string moves; one holding exactly
    `{{name}}` does not. A body that is not JSON after reference placeholders is left as it is.
  - **Naming:** deterministic, with `_2` added when the name is taken in the environment or the plan.
  - **No target environment:** `credential_needs_environment`, and nothing is written.
  - **Result:** `secretNames` gains the name, and `movedCredentials` lists the step, location, name
    and environment name.
- [X] T017 Implement `backend/src/performance/chain/literalCredentials.ts` (R8). It writes moved
  values through `backend/src/execution/environmentStore.ts`, encrypted at rest as today, before
  the plan is stored. T016 passes.
- [X] T018 Implement `backend/src/performance/chain/chainPlanStore.ts`:
  - session-scoped `listPlans`, `createEmptyPlan`, `getPlan`, `savePlan(revision, input)`,
    `duplicatePlan` and `deletePlan`;
  - `savePlan` runs T015, then T017, then the repository, and returns
    `{ plan, analysis, script, movedCredentials }`, using `analyzeChainPlan` with the target
    environment's value names;
  - a limit of 50 plans per session;
  - `onExpire` cleanup, as `backend/src/performance/performanceRunStore.ts` does.

  Extend `backend/src/performance/scriptStore.ts` with `getChainScript(planId)`,
  `saveChainScript(planId, script)` and `deleteChainScript(planId)`, in memory, with the
  fingerprint and SHA-256.
- [X] T019 [P] Add the chain error classes to `backend/src/performance/errors.ts`:
  - `ChainPlanNotFoundError`, `PlanRevisionConflictError` (carrying the current view),
    `InvalidStepError`, `InvalidChainError`, `PlanLimitExceededError`, `HeaderNotSettableError`;
  - `CredentialNeedsEnvironmentError`, `CredentialMixedLiteralError`;
  - `PlanHasBlockersError`.

  Add `backend/src/api/chainPlanHttp.ts`, mapping each one to the status and code in
  contracts/chain-plan-api.md, with safe messages and no detail on a `5xx`.
- [X] T020 [P] Write `backend/tests/integration/performance/chainPlanRoutes.test.ts` (Supertest),
  first, covering:
  - `GET /api/chain-plans`, `POST /api/chain-plans`, `GET /:planId`, `PUT /:planId`,
    `POST /:planId/duplicate` and `DELETE /:planId`;
  - a revision conflict returns the current plan;
  - each refusal code;
  - `credential_needs_environment`;
  - a `movedCredentials` response;
  - a plan of another session is `404`;
  - an 8 MiB body is accepted and 8 MiB plus 1 is refused;
  - no response contains the moved literal.
- [X] T021 Implement `backend/src/api/chainPlans.ts` (plan CRUD routes per contract) and mount it
  in `backend/src/app.ts` at `/api/chain-plans`, with `express.json({ limit: 8 MiB })` before the
  global parser. Log `chain_plan_saved` with ids and counts only. T020 passes.
- [X] T022 [P] Write `frontend/tests/unit/requestChainClient.test.ts` with `stubFetch`, then add
  `frontend/src/services/requestChainClient.ts`. It has every function in
  contracts/chain-plan-api.md:
  - plans: `listPlans`, `createPlan`, `seedPlan`, `fetchPlan`, `savePlan`, `duplicatePlan`,
    `deletePlan`;
  - data sets: `uploadDataSet`, `updateDataSet`, `replaceDataSetFile`, `deleteDataSet`,
    `fetchDataSetPreview`;
  - script: `generateScript`, `scriptDownloadUrl`;
  - runs: `fetchReadiness`, `startRun`, `fetchRuns`, `fetchRun`, `cancelRun`, `fetchReport`,
    `reportDownloadUrl`, `restoreRun`.

  Error results carry the contract's codes and details.
- [X] T023 Add `frontend/src/pages/RequestChainPlansPage.tsx` and a **Performance plans** tab in
  `frontend/src/App.tsx` `TABS`, with an `openChainPlan(planId)` callback.
  - The page lists plans: name, chains, steps, data sets, seed source and updated time.
  - Actions are **New plan** (a `PromptDialog` for the name), **Open**, **Duplicate** and **Delete**
    (a `ConfirmDialog`).
  - It handles the loading, empty and error states.
  - **Open** renders a placeholder for the editor until T046.

  Write `frontend/tests/unit/RequestChainPlansPage.test.tsx` first.

**Checkpoint**: Plans can be created, listed, saved with credential moves and analysis, and deleted.

---

## Phase 3: User Story 1 - Build the customer journey as a request chain (Priority: P1) 🎯 MVP

**Goal**: An engineer builds chains of concrete steps by hand, with `{{name}}` suggestions,
extractors, runs settings and think time. ApiPilot generates a deterministic script and runs it,
and the run can be reported, run again or restored.

**Independent Test**: Against the stub in `customers-auth` mode, build the seven-step chain by hand
(no specification, no collection), generate the script, and run 2 virtual users × 3 iterations.
- The token endpoint was called once, and every later request carried the token.
- Each PUT, GET, PATCH and DELETE used its own virtual user's id from the same iteration.
- No 404 was returned.
- The same plan generates a byte-identical script twice.

### Tests for User Story 1 ⚠️

- [X] T024 [P] [US1] Write `backend/tests/unit/performance/chain/renderChainScript.test.ts`:
  - `customerLifecyclePlan()` renders identically ten times and equals a new golden
    `backend/tests/fixtures/performance/golden/chain-script.js`;
  - a plan without data sets passes `checkUserScript` (`backend/src/performance/userScript/checkUserScript.ts`);
  - the imports are exactly those in contracts/chain-script.md;
  - `VALUE_ENV` is sorted;
  - dynamic occurrences are rewritten in plan order;
  - field paths are pre-parsed;
  - the environment template lists every required value with its secret flag and an empty value;
  - no environment value, plan name or seeding report text appears;
  - the legacy goldens are untouched.
- [X] T025 [P] [US1] Write `backend/tests/unit/performance/chain/chainRuntime.test.ts` using the
  extended `k6Sandbox`. Each case gives exact expected values:
  - **Setup:** a setup step runs once in `setup()` and its value is shared by every virtual user;
  - **Per virtual user:** a once-per-virtual-user step runs on the first iteration only, and is
    retried on the next iteration after a failure;
  - **Iteration scope:** values are cleared each iteration, so no stale value is used;
  - **Latest write wins:** a later extractor of the same name replaces the value;
  - **Extractors:** attempted only on an expected status; empty, non-scalar and missing values fail;
    a header extractor is case-insensitive and unsplit;
  - **Cut short:** a failed extractor cuts the rest of the chain short, with `apipilot_cut_short`
    and `not_attempted` `cut-short`, and the next chain still runs;
  - **Missing data:** a missing environment value counts `apipilot_missing_data` and sends nothing;
    a step whose extracted name is absent is `not_attempted` `dependency`;
  - **Encoding:** URL references are encoded except `baseUrl`; query rows are encoded; the JSON body
    fill escapes; form fields are encoded; a headers-list `Content-Type` wins over the body's;
  - **Think time:** after each sent step, the step's own or the default;
  - **Setup failure:** an unexpected status, a failed extractor or missing data in setup records
    `apipilot_setup` `failed` with its reason and calls `exec.test.abort`;
  - **Refresh:** a setup step with `expires_in` refreshes per virtual user at 0.70 to 0.80 of the
    lifetime, tagged `token-refresh`; one with no lifetime never refreshes.
- [X] T026 [P] [US1] Write `backend/tests/unit/performance/report/runLayout.test.ts`:
  - `layoutFromPlan` gives inputs equal to today's, so every existing
    `backend/tests/unit/performance/aggregate.test.ts` case passes unchanged through the layout;
  - `layoutFromChainSnapshot` maps chains to journeys and setup steps;
  - a chain aggregate from an NDJSON fixture excludes setup and refresh samples from load figures,
    records setup outcome and latency, extractor counts, chains cut short by extractor, and refresh
    counts and bucket offsets by setup step (FR-040);
  - a chain run whose setup step stated no lifetime, followed by 401s, gives the
    `authentication-after-expiry` finding saying the lifetime was not stated (Edge Cases).
- [X] T027 [P] [US1] Write `backend/tests/unit/performance/report/renderChainReport.test.ts`:
  - per-chain and per-step figures;
  - setup steps with outcome and latency;
  - each step's source label and **Changed** or **Added by you**;
  - the statement that step content is authored by the engineer and not verified by ApiPilot,
    rendered from `snapshot.contentNotice`;
  - steps identified by name, method and path template only;
  - no body, header value or query value from the plan copy appears.
- [X] T028 [P] [US1] Extend `backend/tests/integration/performance/chainPlanRoutes.test.ts` (fake
  runner) for the script and runs routes:
  - `plan_has_blockers`, `script_not_generated` and `script_out_of_date`;
  - `k6_unavailable`, `environment_not_found` and `execution_in_progress`, shared with a legacy
    in-progress run;
  - the run is created with a `ChainRunSnapshot` and an encrypted plan copy;
  - cancel, the report (`409` while in progress), the runs list for the plan, and a run whose plan
    was deleted still readable;
  - a setup failure settles as `setup-step-failed` with the step and reason in `result.setupSteps`;
  - restore `into: plan` (revision checked) and `into: new-plan` regenerate the script and start no
    run.
- [X] T029 [P] [US1] Write `frontend/tests/unit/ReferenceField.test.tsx`:
  - typing `{{` opens a listbox offering earlier extracted names in run order, environment names,
    data set columns and dynamic variables;
  - arrow keys, Enter and Escape work, with `aria-activedescendant`;
  - the insertion completes `}}`;
  - there are no suggestions outside `{{`.
- [X] T030 [P] [US1] Write `frontend/tests/unit/ChainPlanEditor.test.tsx`:
  - add a chain, rename it, reorder and duplicate it, and delete it with confirmation;
  - add a step, set method, URL, query rows (a pasted `?a=b` splits into rows), headers, raw and
    form bodies, extractors (body path or header) and runs setting;
  - move a step to another chain; reordering is never refused;
  - the issues panel lists `use-before-extraction` and jumps to the step;
  - `Host` is refused with its reason;
  - a `movedCredentials` notice is announced in the live region;
  - `credential_needs_environment` asks for an environment;
  - `plan_revision_conflict` reloads and announces it;
  - the plan shows "Steps are authored by you and not verified by ApiPilot" as text
    (constitution XVII).
- [X] T031 [P] [US1] Write `frontend/tests/unit/ChainRunPanel.test.tsx`:
  - the trigger names the environment by name, tier and base URL, and lists chains with step
    counts, write steps per step, and hosts;
  - start, progress, cancel and the report frame;
  - **Run again** is offered only when the script SHA-256 matches and the environment exists, and
    otherwise shows the reason;
  - restore offers "into this plan" or "as a new plan" and never starts a run.

### Implementation for User Story 1

- [X] T032 [P] [US1] Implement `backend/src/performance/chain/runSnapshot.ts`:
  `chainRunSnapshot(plan, analysis)` per data-model.md.
  - `pathTemplate` is the URL with no query.
  - Check entries carry kind, path and `maxMs` only.
  - Sources have no `passwordFields`.
  - `contentNotice` is `"user-authored-unverified"` (constitution XVII).
  - There is no value and no content.
- [X] T033 [US1] Implement `backend/src/performance/k6/renderChainScript.ts`:
  - `renderChainScript(plan, analysis)` returns `{ script, environmentTemplate, valueIndex }`;
  - the tables are `VALUE_ENV`, `THINK_TIME_S`, `DYNAMIC`, `SETUP_STEPS` and `CHAINS`, per
    contracts/chain-script.md, with `needs`, `uses` and `refreshFrom` computed from the analysis;
  - `CHAIN_RUNTIME` implements R5, R11, R12 and R13 with the AP-036 dynamic generator text copied
    in;
  - checks are the `status` check only until US3.

  It stays within AP-034's checked subset (Maps, `const` tables, own-field walks). T024 and T025
  (except the data set and check cases) pass. Do not modify `renderScript.ts`.
- [X] T034 [US1] Add `backend/src/performance/report/runLayout.ts`, with `RunLayout`,
  `layoutFromPlan` and `layoutFromChainSnapshot`.
  - Change `createAggregate` in `backend/src/performance/report/aggregate.ts` to take a
    `RunLayout`, and handle the `apipilot_setup` stream, setup and refresh samples by `setup_step`,
    and `apipilot_token_refresh` by `setup_step`.
  - Change `backend/src/performance/report/findings.ts` to read labels from the layout.
  - Update legacy callers to pass `layoutFromPlan(run.planSnapshot)`.

  T026 and every existing aggregate and findings test pass.
- [X] T035 [US1] Extend `backend/src/performance/runPerformanceTest.ts` to accept a chain run
  (`planSource: "chain"`):
  - build the layout from its snapshot;
  - settle `failed` / `setup-step-failed` when a failed `apipilot_setup` point was seen, or when
    exit code 108 arrives with none, with reason `unknown` (R12);
  - `withReportFields` evaluates thresholds and findings from the layout.

  Legacy runs behave exactly as before. The existing run tests pass.
- [X] T036 [US1] Implement `backend/src/performance/report/renderChainReport.ts` (R20). It reuses
  the exported helpers of `renderHtmlReport.ts` and does not modify `renderHtmlReport`. T027 passes.
- [X] T037 [US1] Add the script and runs routes to `backend/src/api/chainPlans.ts`:
  - `POST /:planId/script` and `GET /:planId/script/download`;
  - `GET /readiness`;
  - `POST /:planId/runs`, with the gates in contract order, the snapshot from T032, the plan copy
    via `createChainRun`, and `findExecutionInProgress` for the slot;
  - `GET /:planId/runs`, `GET /runs/:runId`, `POST /runs/:runId/cancel` and
    `GET /runs/:runId/report`.

  `DELETE /:planId` refuses `run_in_progress`. Log events as the contract states. T028 (except
  restore) passes.
- [X] T038 [US1] Implement `backend/src/performance/chain/restore.ts` and
  `POST /api/chain-plans/runs/:runId/restore` (R21, FR-035). Restore:
  1. decrypts the run's plan copy;
  2. replaces the plan's chains, steps and settings at the given revision, or creates
     `<name> (restored)`;
  3. relinks data sets by id and SHA-256, otherwise lists them in `dataSetsNotRestored`;
  4. generates the script.

  It starts no run and copies no environment value. T028 restore cases pass.
- [X] T039 [P] [US1] Add `frontend/src/components/requestChain/ReferenceField.tsx`: an input or
  textarea following the ARIA combobox pattern on `{{` (FR-005), with suggestions passed in as
  props. T029 passes.
- [X] T040 [P] [US1] Add `frontend/src/components/requestChain/KeyValueRows.tsx`: an accessible
  table of name and value rows (add, remove, reorder) using `ReferenceField` for values, and an
  optional refusal per name for `Host` and `Content-Length`.
- [X] T041 [P] [US1] Add `frontend/src/components/requestChain/BodyEditor.tsx`:
  - a choice of none, raw or form;
  - for raw, a content-type field with common choices and a monospace `ReferenceField` textarea,
    with a 256 KiB limit shown;
  - for form, `KeyValueRows`.
- [X] T042 [P] [US1] Add `frontend/src/components/requestChain/ExtractorRows.tsx`: a name, a
  source (a body field path validated with the shared `parseCapturePath`, or a header name), and a
  limit of 10.
- [X] T043 [US1] Add `frontend/src/components/requestChain/StepEditor.tsx`, with these sections:
  - **Request:** a method select with `HttpMethodBadge`, a URL `ReferenceField` that splits a
    pasted query into rows, query and header `KeyValueRows`, and `BodyEditor`;
  - **Extract:** `ExtractorRows`;
  - **Settings:** runs (radio group: Every iteration, Once per virtual user, Once before load),
    think time (blank means the plan default), and expected statuses as a validated, comma-separated
    input. *(Done differently from the first draft: `ExpectedStatusEditor` is typed to the legacy
    `PerformanceStep`, so it was not moved; phase two deletes it.)*

  It saves on blur, add, remove and move.
- [X] T044 [P] [US1] Add `frontend/src/components/requestChain/ChainTree.tsx`:
  - chains with step counts, collapsible, each step with method badge, name and runs marker;
  - buttons to add, rename, move up and down, duplicate and delete chains and steps, plus "Move to
    chain…";
  - selection by keyboard;
  - an "empty chain" note.
- [X] T045 [P] [US1] Add `frontend/src/components/requestChain/PlanIssues.tsx`:
  - blockers and notices from `analyzeChainPlan`, each with text and a "Go to step" button;
  - required values (secret, provided or not);
  - hosts;
  - names extracted more than once.
- [X] T046 [US1] Add `frontend/src/components/requestChain/ChainPlanEditor.tsx`:
  - a two-pane layout, `ChainTree` beside `StepEditor`, stacking below `md`;
  - plan settings: name, target environment via `EnvironmentPicker`, `LoadProfileEditor`, default
    think time, and `ThresholdEditor` with step scopes;
  - `PlanIssues`, and the script item (generate, out of date, downloads);
  - `analyzeChainPlan` runs locally on each edit, and the server response is authoritative after
    save;
  - revision conflicts and credential refusals are handled;
  - a standing notice at the top of the plan: "Steps are authored by you and not verified by
    ApiPilot" (constitution XVII).

  Wire it into `RequestChainPlansPage` **Open**. T030 passes.
- [X] T047 [US1] Add `frontend/src/components/requestChain/ChainRunPanel.tsx`:
  - the run trigger lists the environment (name, tier, base URL), chains with step counts, write
    steps via `WriteOperationSummary` fed by `summarizeChainWrites`, and hosts, and states that load
    comes from this machine;
  - the runs list and polling through `usePerformanceRuns`, cancel, and `PerformanceReportFrame`;
  - **Run again** with its reasons, and restore.

  T031 passes.
- [X] T048 [US1] Add opt-in real-k6 case 1 to
  `backend/tests/integration/performance.k6.real.test.ts`: the US1 chain against the
  `customers-auth` stub, 10 virtual users × 3 iterations (SC-003). Assert:
  - one token call;
  - every customer request authorised;
  - no 404. Each iteration's DELETE removes its id, so a reused, stale or another virtual user's id
    would give a 404 (SC-003);
  - the run's snapshot, result and logs contain no id the stub issued;
  - a byte-identical script on regeneration.

  Also add case 2: `PERF_STUB_TOKEN_STATUS=401`. It ends `setup-step-failed` naming step 1, with
  no customer request sent.

**Checkpoint**: US1 is fully usable from an empty plan. This is the MVP.

---

## Phase 4: User Story 2 - Start from the specification, then fix its dummy data (Priority: P1)

**Goal**: A plan is seeded from the uploaded specification as a first draft. Every part of every
step can be corrected without validation against the specification. Each step shows its seed
operation and whether it was changed.

**Independent Test**: Seed from `weak-spec.yaml`, then make the US2 edits (body, `201`, a token step
added at the top, path corrected, `X-Tenant-Id` added, steps moved and deleted). Run against a stub
implementing the real API.
- Every request is sent exactly as edited.
- Nothing is reverted after a reload or after seeding another plan.
- The report marks each changed step with its seed operation.

### Tests for User Story 2 ⚠️

- [X] T049 [P] [US2] Write `backend/tests/unit/performance/chain/seed/toChainStep.test.ts`:
  - a `RequestTemplate` splits into URL and query;
  - headers are copied;
  - a json body becomes raw `application/json`, and form becomes fields;
  - `{{apipilot_unique_N}}` becomes `{{$guid}}` (uuid) or `{{$randomEmail}}` (email);
  - bearer becomes `Authorization: Bearer {{token}}`;
  - an apikey becomes a header or query row;
  - basic with literals is encoded and handed to the credential mover; basic with references
    becomes `Basic {{<scheme>_basic}}` plus a `basic-auth-encoded-value` report item.
- [X] T050 [P] [US2] Write `backend/tests/unit/performance/chain/seed/seedFromSpecification.test.ts`
  on `backend/tests/fixtures/openapi/quick-performance.yaml` and `weak-spec.yaml`:
  - one single-step chain per operation, in specification order, named `METHOD /path`;
  - login producers are left out (AP-032 FR-003a), and token sources become **Once before load**
    steps in a first chain "Credentials", with an extractor;
  - documented success statuses are used;
  - `passwordFields` are recorded;
  - an operation with no positive scenario becomes a `no-positive-scenario` report item;
  - seeding twice gives a deep-equal plan (FR-020);
  - nothing is sent, and no script is run.
- [X] T051 [P] [US2] Extend `backend/tests/integration/performance/chainPlanRoutes.test.ts`:
  - `POST /api/chain-plans/seed` `{ source: { kind: "specification" } }`, with
    `quick_test_not_found` when there is no quick test;
  - with `environmentId`, a literal is moved and `literal-credential-moved` is reported; without
    one, it is dropped and `literal-credential-dropped` is reported;
  - edit every step part and save, then assert the stored steps equal what was entered, with no
    schema or status warning (FR-026);
  - `changed` is true for edited steps and `added` for a new step;
  - re-uploading a different specification and seeding again leaves the first plan unchanged.
- [X] T052 [P] [US2] Write `frontend/tests/unit/SeedPlanDialog.test.tsx` and
  `frontend/tests/unit/SeedingReportView.test.tsx`:
  - the dialog asks for a name and an optional environment, explaining that literal credentials
    move there;
  - the report groups items by kind with their source labels and stays reachable from the plan;
  - the editor shows each step's source label and **Changed** or **Added by you** as text.

### Implementation for User Story 2

- [X] T053 [US2] Export `credentialProducerOperationKeys` from
  `backend/src/performance/plan/buildPlan.ts`, without changing behaviour. *(`splitUrl` was not
  needed: `toChainStep.ts` splits the query itself, keeping the text as the builder wrote it.)*
- [X] T054 [US2] Implement `backend/src/performance/chain/seed/toChainStep.ts` (R15), so that T049
  passes.
- [X] T055 [US2] Implement `backend/src/performance/chain/seed/seedFromSpecification.ts`. It uses
  `quickTestStore`, `selectPerformanceScenario`, `planAuth`, `buildStepRequest`,
  `prefillExpectedStatuses` and `uniqueValueCandidates`, and builds the `SeedingReport`. Ids come
  from plan counters, and `seedDigest` is set per step. T050 passes.
- [X] T056 [US2] Add `POST /api/chain-plans/seed` to `backend/src/api/chainPlans.ts` for the
  `specification` source:
  - it runs the seeder and the credential mover with the optional environment;
  - it stores the plan and logs `chain_plan_seeded`.

  The route must accept the `workflow` and `collection` kinds as `422 unsupported_seed_source`
  until T074. T051 passes.
- [X] T057 [P] [US2] Add `frontend/src/components/requestChain/SeedPlanDialog.tsx` and
  `frontend/src/components/requestChain/SeedingReportView.tsx`, and show the source label and
  **Changed** or **Added by you** in `StepEditor` and `ChainTree`.
- [X] T058 [US2] Add **Create request-chain plan** to `frontend/src/pages/QuickPerformancePage.tsx`,
  beside the existing plan screen, which is unchanged. It opens `SeedPlanDialog` and calls
  `openChainPlan` on success. T052 passes.

**Checkpoint**: US1 and US2 both work. Specification-seeded plans are fully editable.

---

## Phase 5: User Story 3 - Checks beyond the status code (Priority: P2)

**Goal**: Steps carry four kinds of data-only checks, counted per check and separately from
unexpected statuses. A failed check never stops extractors or the chain.

**Independent Test**: Run a load profile with `PERF_STUB_WRONG_ID_EVERY=10` and
`PERF_STUB_SLOW_EVERY=5`.
- Each check's failure count matches the stub's behaviour within the run's counts.
- Failed checks are reported apart from unexpected statuses.

### Tests for User Story 3 ⚠️

- [X] T059 [P] [US3] Extend `backend/tests/unit/performance/chain/chainRuntime.test.ts`:
  - `field-exists` passes for a present `null`;
  - `field-equals` covers text, number and boolean with strict types, and `{{name}}` resolved to
    text;
  - `body-contains`;
  - `time-at-most` uses `timings.duration`;
  - a non-JSON response fails the JSON checks while `body-contains` and time checks still apply;
  - `apipilot_check` counters are recorded;
  - a failed check does not stop extractors or the chain.

  Extend `renderChainScript.test.ts`: checks are rendered as data and the golden is regenerated.
- [X] T060 [P] [US3] Extend `backend/tests/unit/performance/report/runLayout.test.ts` and
  `renderChainReport.test.ts`:
  - per-check passed and failed counts in `steps[].checks`;
  - check labels show kind and path, and a reference name only when the expected value is exactly
    one `{{name}}`;
  - no literal expected value or `body-contains` text appears.
- [X] T061 [P] [US3] Write `frontend/tests/unit/CheckRows.test.tsx`:
  - add each of the four kinds;
  - validation of path, type and range;
  - a limit of 10;
  - keyboard operation.

### Implementation for User Story 3

- [X] T062 [US3] *(Built into the runtime from the start in T033; the golden already carries checks.)* Extend `CHAIN_RUNTIME` and the `CHAINS` table in
  `backend/src/performance/k6/renderChainScript.ts` with check evaluation and `apipilot_check`.
  Choose `responseType` `text` when a step has extractors or body checks. Regenerate
  `backend/tests/fixtures/performance/golden/chain-script.js`. T059 passes.
- [X] T063 [US3] Handle `apipilot_check` in `backend/src/performance/report/aggregate.ts` (into
  `StepResult.checks`), and render check rows in
  `backend/src/performance/report/renderChainReport.ts`. T060 passes.
- [X] T064 [US3] Add `frontend/src/components/requestChain/CheckRows.tsx` and a **Checks** section
  in `StepEditor.tsx`. T061 passes.
- [X] T065 [US3] Add opt-in real-k6 case 4 to `backend/tests/integration/performance.k6.real.test.ts`:
  the GET-one checks with the wrong-id and slow switches. Assert the failure counts are within
  tolerance of the configured rates, and that check failures are kept apart from unexpected
  statuses.

**Checkpoint**: Checks are counted and reported.

---

## Phase 6: User Story 4 - Seed from a Postman collection or the guided workflow (Priority: P2)

**Goal**: Import & Run Collection and the guided Performance Testing stage each seed a plan once.
The collection gives one chain per top-level folder, with extractors, statuses and auth headers.
The workflow gives one chain per approved workflow. Nothing is run, and later source changes do not
change the plan.

**Independent Test**: Seed from a fixture collection with two folders, an extracting test script, a
status assertion, a pre-request script and folder-level bearer auth.
- There are two chains, in run order.
- The extractor, expected status and `Authorization` header are on the right steps.
- The seeding report lists the pre-request script with its request.
- Editing the collection afterwards does not change the plan.

### Tests for User Story 4 ⚠️

- [X] T066 [P] [US4] Write `backend/tests/unit/performance/chain/seed/seedFromCollection.test.ts` on
  `backend/tests/fixtures/collections/apifoundry.postman_collection.json` and a new two-folder
  fixture `backend/tests/fixtures/chain/two-folders.postman_collection.json`:
  - chains per top-level folder, with the root as one chain, ordered by the first selected request;
  - steps in the selected order;
  - `{{name}}` and `{{$guid}}` kept literally;
  - inherited bearer, basic and apikey written as rows;
  - recognised setters become extractors, and status assertions become expected statuses;
  - auth-only producers become **Once before load** steps;
  - report items for pre-request scripts, unrecognised statements, unsupported dynamic variables and
    left-out requests;
  - deterministic, with no script executed (spy on `postman-sandbox` and the http client).
- [X] T067 [P] [US4] Write `backend/tests/unit/performance/chain/seed/seedFromWorkflow.test.ts` on
  the existing guided fixtures in `backend/tests/fixtures/performance/context.ts`:
  - one chain per approved workflow, in position order, then single-step chains for the other
    operations in scope;
  - workflow variables become extractors (`parseCapturePath(producerField)`), with consumers
    referencing `{{name}}`;
  - auth consumers are dropped in favour of credential steps;
  - a workflow with a missing candidate falls back to single-step chains, with a `workflow-fallback`
    report item;
  - names are unique within the plan;
  - deterministic.
- [X] T068 [P] [US4] Extend `backend/tests/integration/performance/chainPlanRoutes.test.ts`:
  - seed `workflow`, with `workflow_not_ready` before Postman generation completes;
  - seed `collection`, with `collection_not_found` and `no_requests_selected`;
  - after seeding, editing the stored collection or changing workflow approvals leaves the plan
    byte-identical (FR-026).
- [X] T069 [P] [US4] Write `frontend/tests/unit/ChainSeedEntryPoints.test.tsx`: **Create
  request-chain plan** in `PerformanceTestingStage` and in `ExternalCollectionRunPanel` (with the
  selected ordered request ids) opens `SeedPlanDialog`, seeds, and switches to the Performance plans
  tab with the new plan open.

### Implementation for User Story 4

- [X] T070 [US4] *(Not needed: the workflow seeder reuses `buildPlan` and `stepRequestFor`, which
  already give each step's request, consumed values and captures, so `workflowLinks` and
  `captureNameFor` stay private.)*
- [X] T071 [US4] Implement `backend/src/performance/chain/seed/seedFromCollection.ts` (R17). It
  uses `readCollectionRequests`, `recognizeScript`, `convertedCaptures`, `intersectStatuses`,
  `classifyCredentialRequests` and `effectiveAuth` from `backend/src/performance/collection/`. It
  does not use `templateOf`. T066 passes.
- [X] T072 [US4] Implement `backend/src/performance/chain/seed/seedFromWorkflow.ts` (R16), using
  `contextFromWorkflow`, `buildJourneys` logic, `stepWiringOf`, `buildStepRequest` and
  `toChainStep`, with R15's credential steps. T067 passes.
- [X] T073 [US4] Extend the seeding report kinds handled by
  `frontend/src/components/requestChain/SeedingReportView.tsx` for collection and workflow items,
  each showing its request or workflow label and line where present.
- [X] T074 [US4] Enable the `workflow` and `collection` sources in `POST /api/chain-plans/seed`
  (`backend/src/api/chainPlans.ts`), with the gates and codes in the contract. T068 passes.
- [X] T075 [US4] Add **Create request-chain plan** to
  `frontend/src/components/performance/PerformanceTestingStage.tsx` and to
  `frontend/src/components/ExternalCollectionRunPanel.tsx`, passing `orderedSelectedIds`. Route the
  result through `frontend/src/App.tsx` (`openChainPlan`) and forward it in
  `frontend/src/pages/ExternalCollectionsPage.tsx`. The old actions are unchanged. T069 passes.

**Checkpoint**: All three entry points seed request-chain plans (FR-020).

---

## Phase 7: User Story 6 - Real test data from a CSV data set (Priority: P2)

**Goal**: The engineer uploads CSV data sets whose columns are `{{name}}` values, taken one row per
virtual user or the next row per iteration. Data set values are encrypted at rest, reach k6 only at
run time, and are never shown, logged or reported.

**Independent Test**: Upload a 50-row CSV with a secret column in **Next row per iteration** mode.
Run 5 virtual users × 20 iterations against a recording stub.
- Rows are used in order, wrapping after row 50.
- The secret column appears in no plan, script, template, snapshot, report or log.
- The script is byte-identical whatever the file's content.

### Tests for User Story 6 ⚠️

- [X] T076 [P] [US6] Write `backend/tests/unit/performance/chain/csv.test.ts`:
  - RFC 4180 quoting with `""`, CRLF and LF, and BOM stripping;
  - an empty cell is empty text;
  - every refusal reason with its line: `not-utf8`, `no-header-row`, `field-count` (expected and
    found), `unterminated-quote`, `too-many-rows`, `too-many-columns`, `empty-file`,
    `invalid-column-name`, `duplicate-column`;
  - the 5 MiB, 100,000-row and 50-column limits;
  - 5 MiB parsed in under 2 s.
- [X] T077 [P] [US6] Write `backend/tests/unit/persistence/chainPlanDataSetRepository.test.ts`
  (`:memory:`):
  - the content is encrypted, and the raw row has no cell value;
  - columns, row count, size and SHA-256 are plain;
  - delete removes the data set, and so do the plan's delete and the session's delete.

  Also write `backend/tests/integration/performance/chainPlanRestart.test.ts` (FR-039, SC-008). It
  opens a file-backed database and key file in a temporary directory, and creates a plan with two
  chains, steps, a seeding report and a data set. It then closes the connection, reopens it with
  the same key file, and asserts that the plan, data set metadata and decrypted content are
  deep-equal. The script status is "not generated".
- [X] T078 [P] [US6] Extend `backend/tests/unit/performance/chain/chainRuntime.test.ts` and
  `renderChainScript.test.ts`:
  - **Script:** `DATA_SETS` and `SharedArray` / `open("./apipilot-data-<i>.json")` are emitted only
    with data sets; two different files give a byte-identical script (FR-047); `checkUserScript`
    refuses a data-set script, as expected (FR-047 clarification).
  - **Row per virtual user:** row `(idInTest - 1) % n`, kept for the virtual user's run.
  - **Row per iteration:** row `iterationInTest % n`.
  - **Setup steps:** use row 0.
  - **Counters:** `apipilot_data` `take` and `wrap` are counted.
  - **Resolution:** extracted first, then the data set column, then the environment.
- [X] T079 [P] [US6] Extend `backend/tests/integration/performance/chainPlanRoutes.test.ts`:
  - **Upload:** succeeds; refusals with reason and line leave nothing stored; `413` and the
    5-per-plan limit apply; a column used in another data set is refused on add, rename and
    replace.
  - **Edits:** mark secret, rename, change mode, replace the file (secret marks kept by name), and
    delete (columns become unresolved).
  - **Preview:** 5 rows with secret cells `null`.
  - **Runs:** the trigger data lists data sets with row counts; the run snapshot has name, mode,
    columns, row count and SHA-256 and no value; `apipilot-data-<i>.json` is written after the
    integrity check with mode 0600, and is gone after the run settles.
  - **Download:** carries `X-ApiPilot-Note: data-sets-not-included`.
  - **Run again:** unavailable after a file replace (SHA-256 changed).
- [X] T080 [P] [US6] Write `backend/tests/integration/performance/chainLeakScan.test.ts` (SC-005,
  FR-028). Run a plan through the fake runner with four sentinels:
  - a secret token moved from a literal header;
  - a secret data set cell;
  - a response field the plan extracts by name (`customer_id`), fed through the fake runner's
    stream;
  - a request body text.

  Assert that no sentinel value appears in:
  - the raw `chain_plans` and `chain_plan_data_sets` rows (all encrypted), or the run's snapshot
    and result;
  - the environment template and the report HTML;
  - any API response other than the plan's own body text, which the engineer typed, in `GET` and
    `PUT /:planId`;
  - the captured logs.
- [X] T081 [P] [US6] Write `frontend/tests/unit/DataSetsPanel.test.tsx`:
  - upload with name and mode, and a refusal showing the reason and line;
  - the columns, secret toggles, row count and steps using each column;
  - the preview shows "hidden" for secret cells;
  - replace, and remove with confirmation;
  - the run trigger lists data sets with row counts.

### Implementation for User Story 6

- [X] T082 [US6] Implement `backend/src/performance/chain/csv.ts` (R14). T076 passes.
- [X] T083 [US6] Implement `backend/src/persistence/chainPlanDataSetRepository.ts`, and in
  `backend/src/performance/chain/dataSets.ts`:
  - `addDataSet`, `updateDataSet`, `replaceDataSetFile`, `removeDataSet` and `previewDataSet`;
  - `writeRunCopies(planId, runDir)`.

  Each change updates `ChainPlan.dataSets` metadata, the fingerprint and the analysis. Log
  `chain_data_set_stored` and `chain_data_set_refused` without values. T077 passes.
- [X] T084 [US6] Add the data set routes to `backend/src/api/chainPlans.ts`, using `multer` memory
  storage with the 5 MiB limit and mapping refusals per the contract. Include
  `X-ApiPilot-Note: data-sets-not-included` on script download for plans with data sets.
- [X] T085 [US6] Extend the chain pipeline for data sets:
  - `renderChainScript.ts`: `DATA_SETS`, the `SharedArray` loaders, row selection via
    `k6/execution`, data set resolution in `resolve`, and `apipilot_data`. Regenerate the golden
    with a data-set variant `chain-script-data.js`.
  - `runSnapshot.ts`: data sets in the snapshot.
  - `runPerformanceTest.ts`: call `writeRunCopies` after the integrity check, for chain runs only.
  - `aggregate.ts` and `renderChainReport.ts`: `dataSets` takes, rows used and wrapped, and a note
    on each setup step that used a data set's first row (Edge Cases).
  - The routes: **Run again** data in the run list includes each data set's current SHA-256 match.

  T078 to T080 pass.
- [X] T086 [US6] Add `frontend/src/components/requestChain/DataSetsPanel.tsx` to
  `ChainPlanEditor`.
  - Add the data set columns to `ReferenceField` suggestions.
  - List data sets in `ChainRunPanel`'s trigger.
  - Add the download note explaining that the script reads files ApiPilot writes at run time and
    cannot run in Run k6 Script.

  T081 passes.
- [X] T087 [US6] Add opt-in real-k6 case 3 to `backend/tests/integration/performance.k6.real.test.ts`:
  `customers.csv` in row-per-iteration mode with 5 virtual users × 20 iterations. Assert the stub
  received `first_name` values in file order with wrap after row 50, the report shows 100 takes,
  50 rows used and wrapped, and the run directory is removed.

**Checkpoint**: Phase one is complete: US1, US2, US3, US4 and US6 work beside the old plans.

---

## Phase 8: Polish & Cross-Cutting Concerns (phase one release)

**Purpose**: Documentation, version and validation for phase one. Run this before Phase 9.

- [X] T088 [P] Document the feature in `docs/USER_MANUAL.md` (a new section on request-chain plans:
  plans, chains, steps, references, runs settings, extractors, checks, seeding, data sets,
  credentials moved, Run again and restore, limits), `docs/architecture.md` (chain package,
  runtime, tables, run layout) and `README.md` (a feature line).
- [X] T089 [P] Update `specs/ROADMAP.md`:
  - add an AP-037 row (phase one status) and a Next Actions entry, following the AP-036 pattern;
  - annotate AP-029 FR-022a (data sets) and FR-024a (data set SHA-256 for Run again);
  - annotate AP-036 FR-025 (superseded by saved plans).
- [X] T090 Run `npm run version:bump -- feature` (19.17.0 → 19.18.0). It updates the 4
  `package.json` files and `package-lock.json`. Do not edit the lockfile by hand.
- [X] T091 Security self-review of the diff. Record findings in `validation.md`. Check:
  - every new route is session-scoped;
  - the multer limits;
  - the run copy is mode 0600 and removed;
  - no value in logs (grep the new logger calls);
  - the report sandboxed iframe is unchanged;
  - `CHAIN_RUNTIME` has no plan-dependent text.
- [X] T092 After the version bump, run `npm test`, `npm run lint` and `npm run build` at the root,
  and `npm run test:k6-real -w backend` (cases 1 to 4). Record each command and its outcome, exactly
  as run and including failures, in `specs/037-request-chain-performance/validation.md`. Confirm the
  legacy goldens are byte-identical (`git diff --stat backend/tests/fixtures/performance/golden/`).
- [X] T093 Walk through `specs/037-request-chain-performance/quickstart.md` scenarios 1 to 9 in the
  browser and record each outcome in `validation.md`, with the elapsed time for scenario 1
  (SC-001). If this cannot be done, say so there, and do not mark the feature Implemented in the
  ROADMAP (constitution XXXI).

---

## Phase 9: User Story 5 - One plan model everywhere (Priority: P3, phase two)

**Goal**: The old derived plans, their overlays and their screens are removed. Every entry point
opens a request-chain plan. Old runs' reports render exactly as before, without **Run again** or
restore.

**Independent Test**: Record a run from each old plan source (guided, quick, collection), then
complete phase two.
- Each old report renders byte-identical.
- No screen offers the retired controls.
- All three entry points open request-chain plans.

**Gate**: Do not start until Phase 8's phase-one validation (T092, T093) has passed, and the
following hold:
- **SC-006 measured:** run `scripts/count-performance-lines.mjs` at the end of phase one and record
  the result in `validation.md`. If the projected total is above 8,055, report the gap and agree a
  revised target with the user before continuing (Clarification 2026-10-03). Never cut required
  behaviour to meet it. *(Done 2026-10-03: 22,357 measured, about 12,500 to 13,500 projected;
  target agreed at 13,000.)*
- **Constitution amended:** TODO(XVII_LEGACY_PLAN_TEXT) has been carried out through
  `/speckit-constitution` (a MAJOR bump), approved and merged. *(Done: v3.0.0, commit `a5e020a`,
  merged to `main` in PR #59.)*
- **Done (2026-10-03):** T093, by a scripted Playwright walkthrough of scenarios 1 to 9 through the
  real UI, accepted by the user as the walkthrough (`validation.md`).

### Tests for User Story 5 ⚠️

- [ ] T094 [P] [US5] Before any removal, write
  `backend/tests/unit/performance/report/legacyReportGolden.test.ts`. It renders guided, quick
  (AP-032), user-journey (AP-035) and collection (AP-036) runs from stored-run fixtures with
  `renderHtmlReport`, and pins the HTML as goldens under
  `backend/tests/fixtures/performance/golden/reports/` (SC-007).
- [ ] T095 [P] [US5] Write `backend/tests/integration/performance/legacyRunsReadOnly.test.ts` and
  `frontend/tests/unit/LegacyRunsView.test.tsx`:
  - legacy runs list, open and report under their old bases;
  - the removed routes return `404`;
  - **Run again** and restore are not offered, and the view says "Recorded before request-chain
    plans: you can open the report, but it cannot be run again or restored" (FR-037).

### Implementation for User Story 5

- [ ] T096 [US5] Remove the legacy plan routes listed in
  contracts/changes-to-existing-apis.md "Phase two" from these files, keeping the legacy runs' read
  routes and the quick upload:
  - `backend/src/api/performanceRoutes.ts`, `performanceTesting.ts`, `quickPerformance.ts`,
    `collectionPerformance.ts` and `performanceRuns.ts`;
  - `backend/src/app.ts`.

  `POST /api/quick-performance` now only stores the specification for seeding.
- [ ] T097 [US5] Delete the backend modules in research.md R24 "Removed" and their tests. Delete
  `RUNTIME` and `renderScriptFrom` from `backend/src/performance/k6/renderScript.ts`, then the file
  itself if nothing else uses it.
  - Keep the seeding inputs listed in R24 "Kept".
  - Trim `PerformancePlan` and the legacy types in `packages/shared-domain/src/performance.ts` to
    what stored snapshots and `renderHtmlReport` read.
  - `npm run build` and the remaining tests must pass, including T094.
- [ ] T098 [US5] Remove the frontend legacy plan screens and clients listed in
  contracts/changes-to-existing-apis.md "Frontend removed".
  - Make `PerformanceTestingStage`, `QuickPerformancePage` and the collection action offer
    seeding plus the plans already seeded from that source (US5).
  - Show legacy runs read-only with the FR-037 note.
  - Remove the old tests that covered deleted code. T095 passes.
- [ ] T099 [US5] Run `scripts/count-performance-lines.mjs` and record the result against the agreed
  SC-006 target in `specs/037-request-chain-performance/validation.md`. Bump the version with
  `npm run version:bump -- feature` for phase two, and update `docs/USER_MANUAL.md`,
  `docs/architecture.md` and `specs/ROADMAP.md` for the retirement.

**Checkpoint**: One plan model remains, and legacy reports are unchanged.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. It blocks every story.
- **US1 (Phase 3)**: depends on Foundational. It is the MVP and adds the runtime, run pipeline,
  report, editor and run panel that later stories extend.
- **US2 (Phase 4)**: depends on Foundational and on US1's editor (T043 to T046) for showing
  provenance. Its seeder work (T053 to T056) can start right after Foundational.
- **US3 (Phase 5)**: depends on US1 (runtime T033, aggregate T034, report T036, `StepEditor` T043).
- **US4 (Phase 6)**: depends on US2 (`toChainStep` T054, the seed route T056, `SeedPlanDialog`
  T057).
- **US6 (Phase 7)**: depends on US1 (runtime, run pipeline, editor, run panel).
- **Polish (Phase 8)**: depends on US1, US2, US3, US4 and US6. It releases phase one.
- **US5 (Phase 9)**: depends on Phase 8, the SC-006 checkpoint and the constitution amendment.

### Within Each Story

- Tests are written first and must fail.
- The order is: pure modules, then the renderer and aggregate, then routes, then frontend
  components, then wiring.
- The files `renderChainScript.ts`, `chainRuntime.test.ts`, `aggregate.ts`,
  `renderChainReport.ts`, `chainPlans.ts` and `StepEditor.tsx` are touched by several stories.
  Run those tasks in story order, never in parallel with each other.

### Parallel Opportunities

- **Setup:** T002 to T005.
- **Foundational:**
  - T007, T009, T011, T012, T013, T014, T016, T019, T020 and T022 run in parallel once T006 and
    T008 are done.
  - Then T010, T015, T017, T018, T021 and T023, as their tests allow.
- **US1:** tests T024 to T031 together. Then T032, plus T039 to T042, T044 and T045 (frontend
  leaves), in parallel with the backend tasks T033 to T038.
- **US3, US4 and US6** can proceed in parallel after US1 (and US2 for US4) by different people, except
  for the shared files above.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "Write renderChainScript.test.ts (golden, ×10, AP-034 check)"
Task: "Write chainRuntime.test.ts with the extended k6Sandbox"
Task: "Write runLayout.test.ts and renderChainReport.test.ts"
Task: "Write ReferenceField, ChainPlanEditor and ChainRunPanel frontend tests"

# Then backend and frontend leaves in parallel:
Task: "Implement runSnapshot.ts"                       # backend
Task: "Implement renderChainScript.ts"                 # backend
Task: "Add ReferenceField.tsx, KeyValueRows.tsx, BodyEditor.tsx, ExtractorRows.tsx"   # frontend
Task: "Add ChainTree.tsx and PlanIssues.tsx"            # frontend
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup), then Phase 2 (Foundational).
2. Phase 3 (US1): a hand-built chain, generated and run, with Run again and restore.
3. **Stop and validate:** quickstart scenario 1, real-k6 cases 1 and 2.

### Incremental Delivery (phase one)

1. US2: seed from the specification and fix it (quickstart 2, 3).
2. US3: checks (quickstart 4).
3. US4: seed from collection and workflow (quickstart 6).
4. US6: data sets (quickstart 7), then restart persistence (quickstart 8) and Run again (quickstart 9).
5. Phase 8: documentation, version 19.18.0, and validation. Phase one ships with the old plans
   still present.

### Phase two

Only after the gate in Phase 9: the legacy report goldens first (T094), then removal, then the
SC-006 measurement against the agreed target.

---

## Notes

- [P] tasks are different files with no dependencies on incomplete tasks.
- The story label maps each task to spec.md's user stories for traceability.
- Stop at each checkpoint and validate the story on its own.
- Do not commit; leave changes for the user's review.
