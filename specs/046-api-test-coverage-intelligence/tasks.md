---

description: "Task list for API Test Coverage Intelligence (AP-046)"
---

# Tasks: API Test Coverage Intelligence

**Input**: Design documents from `/specs/046-api-test-coverage-intelligence/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/coverage-routes.md](contracts/coverage-routes.md), [quickstart.md](quickstart.md)

**Tests**: Included. The spec (section 12 of the input, FR-001 to FR-041, SC-001 to SC-011) requires automated tests for calculation, mapping and UI behaviour.

**Organization**: Grouped by user story. US1, US2 and US8 are P1; US1 is the MVP. T001 to T051 are done and reflect the first implementation; T052 to T076 are the refinement rework (Phases 11 to 14).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 to US7, matching spec.md
- Paths are repository-relative. Conventions: pure domain code in `backend/src/apiCoverage/`, thin router in `backend/src/api/`, client in `frontend/src/services/`, Tailwind v4 semantic tokens only (no hex, no arbitrary values), no `console` (use the logger), no new dependencies, no commits (leave changes for review).

**Clarified decisions in force** (spec Clarifications 2026-10-10): pending and accepted scenarios count and rejected never do, with the accepted/pending split shown; edited requests are Inconclusive; results that no longer join to a current scenario are never counted as verified and are reported as unattributed (the Stale state is kept in the contract but reserved, not produced); a review edit after a run does not invalidate evidence; unselected operations are out of scope and not gaps; view state resets on full refresh and is kept across tab switches.

---

## Phase 1: Setup

- [X] T001 Create `packages/shared-domain/src/coverage.ts` with the enumerations and entity types from data-model.md (`CoverageDimensionKind`, `CoverageState`, `ScenarioCategoryGroup`, `Priority`, `CoverageRequirement`, `CoverageMapping`, `EvidenceRef`, `CoverageMetric`, `CoverageGap`, `Recommendation`, `OperationCoverage`, `NotMeasurable`, `CoverageSnapshot`) and export it from `packages/shared-domain/src/index.ts`. Add `outOfScopeOperations: string[]` and `scenarioCounts` to `CoverageSnapshot` per the clarifications. No framework imports.
- [X] T002 [P] Create coverage test fixtures in `backend/tests/fixtures/apiCoverage/` (ApiModel fixtures: multi-method same path, path-level + operation-level parameter override, enum/numeric bounds/array items, documented 2xx/4xx/`2XX`/`default`, security-declared operation, `oneOf` and circular-ref issues; matching scenario sets and run-result sets for uploaded and guided runs).

---

## Phase 2: Foundational (blocks all user stories)

- [X] T003 [P] Write failing tests for path-level parameter merging (path-level included, operation-level overrides on `(name, in)`, specs without path-level parameters unchanged) in `backend/tests/unit/openapi/pathLevelParameters.test.ts`.
- [X] T004 Merge `pathItem.parameters` into each operation's parameters in `backend/src/openapi/buildApiModel.ts` (near the `operation.parameters` read), operation-level winning. Run existing `backend/tests/unit/openapi` and `backend/tests/unit/testDesign` suites; update only expectations that legitimately gain path-level parameter scenarios, and list each in the task notes.
- [X] T005 [P] Implement `backend/src/apiCoverage/specRevision.ts`: canonical sorted-key serialization of operations, parameters, request bodies, responses and security schemes (excluding `info.title`/`info.version`), SHA-256. Unit test `backend/tests/unit/apiCoverage/specRevision.test.ts` (stable across key order and `info` changes; changes on contract change).
- [X] T006 [P] Implement `backend/src/apiCoverage/metrics.ts`: `makeMetric(id, dimension, kind, numerator, denominator, basis)` with `percentage = denominator === 0 ? null : round1(...)`, `available`, and a `numerator <= denominator` assertion. Unit test `backend/tests/unit/apiCoverage/metrics.test.ts` covering zero denominators (never NaN/Infinity), rounding, basis retained.
- [X] T007 [P] Implement `backend/src/apiCoverage/errors.ts` (`NoActiveWorkflowError`, `RunNotFoundError`, `InvalidCoverageFilterError`).
- [X] T008 Implement `backend/src/apiCoverage/elements.ts`: `ApiModel` + `selectedOperationKeys` → `CoverageRequirement[]` with stable ids (`op:`, `param:`, `reqprop:`, `resp:`, schema-element ids), per-element `contractHash`, `applicable`, `measurable`, and `NotMeasurable[]` from `AnalysisIssue` (`oneOf`/`anyOf`/discriminator/unresolved/circular; `nullable` and `additionalProperties` noted as not retained). Unselected operations go to `outOfScopeOperations`. Unit tests `backend/tests/unit/apiCoverage/elements.test.ts` (same path different methods are separate; overridden parameter counted once; out-of-scope excluded from denominators; unsupported constructs listed with reason).
- [X] T009 Implement `backend/src/apiCoverage/classify.ts`: the six-state precedence from data-model.md as a pure function over a requirement's attributable evidence. Unit test `backend/tests/unit/apiCoverage/classify.test.ts` (each state; failure outranks pass; no evaluated relevant check → inconclusive; edited → inconclusive; not-attempted is not evidence).

**Checkpoint**: foundation ready; run `npm test -w backend` and `npm test -w packages/shared-domain`.

---

## Phase 3: User Story 1 — Specification coverage (Priority: P1) — MVP

**Goal**: Show specification coverage per operation, parameter, request schema, response code/schema and category from generated scenarios, with gaps listed; works with no execution data.

**Independent Test**: Upload a spec, generate scenarios for a subset, open Coverage: covered items match scenarios, the rest are listed as not covered, runtime shown as unavailable.

### Tests for US1

- [X] T010 [P] [US1] `backend/tests/unit/apiCoverage/scenarioMapping.test.ts`: operation with no scenario is not covered; ten scenarios on one parameter count once; `enum-positive-variant` covers the specific enum value; `required-field-*` covers the required flag; boundary rules cover min/max elements; response code covered only by exact `expectedStatusCode` match (`2XX`/`default` match only themselves); schema element covered only with a paired `status-code` + `schema-conformance` assertion; cookie parameters documented but uncovered; rejected scenarios excluded, pending included with accepted/pending counts; scenario group (positive, negative, boundary) is derived from `provenance.rule`, not the `category` field, so at-boundary variants count as boundary and each scenario belongs to exactly one group.
- [X] T011 [P] [US1] `backend/tests/integration/coverage.test.ts` (Supertest): `GET /api/coverage` 200 for spec-only (real zeros, notices), 409 `no_active_workflow` without a workflow, response never contains bodies, header values or `rawCapture`.
- [X] T012 [P] [US1] `frontend/tests/unit/apiCoverage/CoveragePage.spec.test.tsx`: metric cards show numerator, denominator and percentage; zero denominator renders "not available" (never NaN); notice text exact; no-workflow empty state with recovery link; error state is not rendered as empty coverage.

### Implementation for US1

- [X] T013 [US1] Implement `backend/src/apiCoverage/scenarioMapping.ts` per research R7 (rule id + `targetLocation`/`targetField` + assertions → requirement ids; deterministic, sorted, deduplicated; carries `source` and review state).
- [X] T014 [US1] Implement `backend/src/apiCoverage/calculateCoverage.ts` (pure orchestrator: workflow snapshot, runs, clock → `CoverageSnapshot`) for the specification dimension: metrics per data-model denominators, `OperationCoverage[]`, category groups (security `available:false` with reason), `scenarioCounts`, notices, spec-revision block.
- [X] T015 [US1] Implement `backend/src/api/coverage.ts` (`GET /api/coverage`, thin: read current workflow via `getCurrentWorkflow`, call the calculator, map typed errors to `409 no_active_workflow`, log counts/duration only) and register it in `backend/src/app.ts`.
- [X] T016 [P] [US1] Create `frontend/src/services/coverageClient.ts` (result-union convention, `createLogger`) and `frontend/src/hooks/useCoverage.ts` (explicit `loading | success | empty | no-workflow | error` and a request-sequence guard so a stale response never overwrites a newer one) with tests in `frontend/tests/unit/apiCoverage/useCoverage.test.tsx`: a slow earlier response does not overwrite a newer one (FR-035).
- [X] T017 [P] [US1] Create `frontend/src/components/apiCoverage/coverageViewModel.ts` (pure formatting: percentages, "not available", state labels and tones) and tests in `frontend/tests/unit/apiCoverage/coverageViewModel.test.ts`.
- [X] T018 [US1] Create `frontend/src/components/apiCoverage/CoverageNotice.tsx`, `MetricGroup.tsx` (reusing `StatTile`) and `CoverageBars.tsx` (SVG, `fill-chart-N`/semantic tokens, accessible counts table, separates specification, runtime and remaining gap) following `components/liveRun/LiveRunChart.tsx`.
- [X] T019 [US1] Create `frontend/src/pages/CoveragePage.tsx` (header with spec name, revision, context; notice; metric groups; breakdown; out-of-scope list; not-measurable list; recalculate action) using `Skeleton`, `EmptyState`, `ErrorState`.
- [X] T020 [US1] Register the view: add `coverage` to `EntryChoice` and `WORKFLOWS` (section `results`) in `frontend/src/components/workflowCatalog.ts`; wire the lazy import, `mount` map and rendering in `frontend/src/App.tsx`; update `EntryChooser.tsx` and `HelpDialog.tsx`; update `workflowCatalog.test`, `sectionCatalog.test`, `App.test`, `EntryChooser.test`, `paletteCommands.test` in `frontend/tests/unit/`.

**Checkpoint**: US1 works with no execution data. Run its tests plus `npm run lint`.

---

## Phase 4: User Story 2 — Runtime states (Priority: P1)

**Goal**: Distinguish generated, executed, failed, verified, inconclusive and stale using real execution evidence.

**Independent Test**: Run a subset with passes and failures; states match the evidence; failures are never "untested".

### Tests for US2

- [X] T021 [P] [US2] `backend/tests/unit/apiCoverage/evidence.test.ts`: uploaded-run join by `itemIdForScenario`, assertion kind from the exported test-name helpers; guided `ExecutionRun` join by `scenarioId` and `assertionIndex`; `not-attempted` is not evidence; edited item (`wasEdited`) → inconclusive; unjoinable results counted as `unattributedResults`; no rawCapture in output.
- [X] T022 [P] [US2] Extend `backend/tests/unit/apiCoverage/calculateCoverage.test.ts`: generated-only adds zero runtime verification; passing evaluated checks verify; failed assertion not counted as verified; executed failure not labelled untested; 200 response with no evaluated schema assertion leaves the schema inconclusive; determinism (same input twice, identical output ignoring `calculatedAt`); element ids are unchanged when an unrelated part of the specification changes and when scenario order changes (FR-034); the snapshot has no aggregate or overall score field (FR-010).
- [X] T023 [P] [US2] `frontend/tests/unit/apiCoverage/StateBadge.test.tsx`: all six states carry a text label and distinct tone (not colour only).

### Implementation for US2

- [X] T024 [US2] Implement `backend/src/apiCoverage/evidence.ts` (`EvidenceSource` for uploaded and guided runs; reads the runs of all uploaded collections in the session through the existing run repository, joins by `itemId`, and counts every unjoined result in `unattributedResults`; import test-name helpers from `backend/src/postman/` rather than copying strings; `itemIdForScenario` from `backend/src/postman/identifiers.ts`).
- [X] T025 [US2] Wire evidence and `classify` into `calculateCoverage.ts`: runtime metrics (operations verified, response codes verified, contract assertions evaluated and passed), per-requirement `CoverageState`, `lastQualifyingExecutionAt`, execution context (environment name and tier only).
- [X] T026 [P] [US2] Create `frontend/src/components/apiCoverage/StateBadge.tsx` (wraps `StatusBadge`; text + tone per state) and render runtime metric group, "generated, not executed" labelling and the failed-result links in `CoveragePage.tsx`.

**Checkpoint**: Both P1 stories working; quickstart steps 1–5.

---

## Phase 5: User Story 3 — Gaps table and prioritization (Priority: P2)

**Goal**: Sortable, filterable gaps table with documented, deterministic priority.

**Independent Test**: Filter by method, state, category, priority, missing-versus-failed and sort; rows and summary counts agree.

### Tests for US3

- [X] T027 [P] [US3] `backend/tests/unit/apiCoverage/prioritize.test.ts`: destructive and unverified outranks non-destructive with equal gaps; one underlying gap grouped once; tie-break by operation key is stable; labelled heuristic; failure history omitted rather than guessed.
- [X] T028 [P] [US3] `backend/tests/unit/apiCoverage/filterSnapshot.test.ts`: each filter, sort keys, `totals` unfiltered, summary values reflect the filtered set, invalid filter → `InvalidCoverageFilterError`.
- [X] T029 [P] [US3] `frontend/tests/unit/apiCoverage/GapsTable.test.tsx`: semantic table, sorting, filters, pagination, row actions link to scenario/result with context, filters retained across a view switch and reset on remount after refresh.

### Implementation for US3

- [X] T030 [US3] Implement `backend/src/apiCoverage/prioritize.ts` (documented weights in code and a header comment: missing runtime verification, missing specification coverage, executed failure, destructive method, declared security, contract complexity; bands High/Medium/Low) and gap grouping in `calculateCoverage.ts`.
- [X] T031 [US3] Implement `backend/src/apiCoverage/filterSnapshot.ts` and the query parsing/validation in `backend/src/api/coverage.ts` per contracts/coverage-routes.md, including mapping `InvalidCoverageFilterError` to `400 invalid_filter`.
- [X] T032 [P] [US3] Create `frontend/src/components/apiCoverage/GapFilters.tsx` and `GapsTable.tsx` (`HttpMethodBadge`, `Pagination`, monospace paths, horizontal scroll, actions) and extend `coverageClient.ts`/`useCoverage.ts` with filter parameters.

---

## Phase 6: User Story 4 — Recommended next tests (Priority: P2)

**Goal**: Ranked, traceable recommendations.

**Independent Test**: Each recommendation names operation, requirement, reason, evidence, priority rationale and action; output is identical on repeat.

- [X] T033 [P] [US4] `backend/tests/unit/apiCoverage/recommendations.test.ts`: fields complete, ordering follows prioritization, identical on repeat, every `gapId` exists, no fabricated evidence.
- [X] T034 [US4] Implement `backend/src/apiCoverage/recommendations.ts` and include `recommendations` in the snapshot.
- [X] T035 [P] [US4] Create `frontend/src/components/apiCoverage/Recommendations.tsx` and `frontend/tests/unit/apiCoverage/Recommendations.test.tsx` (actions: review scenario, generate scenario, open result).

---

## Phase 7: User Story 5 — Specification changes and repeated runs (Priority: P2)

**Goal**: Honest staleness and run selection.

**Independent Test**: Re-upload a changed spec: earlier results are reported as unattributed and none counts as verified; run twice: counts unchanged; select an older run: evaluated against it.

- [X] T036 [P] [US5] Tests in `backend/tests/unit/apiCoverage/unattributed.test.ts`: after regeneration, earlier results that join to no current scenario are never counted as verified and are reported in `unattributedResults` with the "possibly from an earlier specification" explanation; results of an unrelated collection are treated the same; a review edit after a run does not invalidate evidence and sets `scenarioEditedAfterRun`; repeated runs do not double-count; latest qualifying run per scenario is the default; `runId` selects one run; unknown `runId` → `RunNotFoundError`; the Stale state is accepted by the classifier but never produced.
- [X] T037 [US5] Implement `backend/src/apiCoverage/unattributed.ts` (unattributed-result accounting and the `scenarioEditedAfterRun` note, using `ReviewScenario.history` timestamps only if present; if absent, omit the note and record that in a comment) and the run-selection rule; surface a specific unattributed notice and `execution.runIds`/`selectedRunId`; add `runId` handling and `404 run_not_found` to `backend/src/api/coverage.ts`.
- [X] T038 [P] [US5] Add a run selector and stale/unattributed notices to `CoveragePage.tsx`; test in `frontend/tests/unit/apiCoverage/RunSelector.test.tsx`.

---

## Phase 8: User Story 6 — Navigation and export (Priority: P3)

**Goal**: Contextual links and export of the current view.

**Independent Test**: Navigate from scenario review to Coverage and back with context intact; export filtered and all views and compare with the screen.

- [X] T039 [P] [US6] `backend/tests/unit/apiCoverage/renderCoverageHtml.test.ts` and extend `backend/tests/integration/coverage.test.ts`: HTML and JSON exports match `filterSnapshot` output for `scope=filtered` and `scope=all`, include definitions and denominators, escape interpolated text, contain no secrets, correct `Content-Disposition`.
- [X] T040 [US6] Implement `backend/src/apiCoverage/renderCoverageHtml.ts` (reuse `escapeHtml` and report styling from `backend/src/externalCollections/runReportHtml.ts`; no new dependency) and `GET /api/coverage/export` in `backend/src/api/coverage.ts`.
- [X] T041 [P] [US6] Add export action to `CoveragePage.tsx` and `coverageClient.ts` (download helper following `externalCollectionsClient.ts` report download).
- [X] T042 [US6] Add contextual links: "View coverage" in `frontend/src/components/ScenarioReviewStage.tsx` and in the results area of `frontend/src/components/ExternalCollectionRunPanel.tsx`, via an `onOpenCoverage` callback in `App.tsx` following the `handleOpenChainPlan` pattern; link from Coverage to the execution workflow and scenario generation. Tests in `frontend/tests/unit/apiCoverage/CoverageNavigation.test.tsx`.

---

## Phase 9: User Story 7 — Empty, error and theme states (Priority: P3)

- [X] T043 [P] [US7] `frontend/tests/unit/apiCoverage/CoverageStates.test.tsx`: loading skeleton, empty spec, malformed or unsupported constructs (not-measurable list), missing history, incomplete evidence, API failure; each has a specific message and recovery action; no demo data anywhere.
- [X] T044 [P] [US7] `frontend/tests/unit/apiCoverage/CoverageThemes.test.tsx`: render under `data-theme="light"` and `"dark"`; assert semantic token classes only (no hex, no inline colour styles), text labels on every status, visible focus classes on interactive elements.
- [X] T045 [US7] Fix any gaps found by T043 and T044 in `frontend/src/components/apiCoverage/` and `CoveragePage.tsx`; confirm no arbitrary Tailwind values, no inline styles, and `prefers-reduced-motion` respected.

---

## Phase 10: Polish and cross-cutting

- [X] T046 [P] Performance check: unit test in `backend/tests/unit/apiCoverage/performance.test.ts` building a 500-operation fixture and asserting the calculation completes well under the 3 s budget and issues no repeated model traversal per row (SC-006), plus a frontend test in `frontend/tests/unit/apiCoverage/GapsTable.performance.test.tsx` rendering a 500-row fixture and asserting filter and sort changes apply within the 1 s budget; "usable" means the metric groups and first table page are rendered.
- [X] T047 [P] Security check: test in `backend/tests/unit/apiCoverage/redaction.test.ts` that no snapshot or export field contains header values, bodies, URL query strings, tokens, cookies or `rawCapture` for a fixture whose runs include them (FR-036).
- [X] T048 Documentation: add a Coverage section to `docs/USER_MANUAL.md` (definitions, six states, limits, refresh behaviour) and `docs/architecture.md` (calculator, evidence join, staleness, prioritization weights, unsupported constructs and unavailable dimensions); add the AP-046 entry to `specs/ROADMAP.md` and note the path-level parameter fix on the AP-002/AP-003 entries.
- [x] T049 Update the plan and data model for the clarifications (out-of-scope field, unattributed-evidence rule replacing the per-scenario staleness rules in research R4, reserved Stale state, review-edit note) in `specs/046-api-test-coverage-intelligence/plan.md`, `research.md`, `data-model.md`. Done during `/speckit-analyze` remediation, before implementation.
- [X] T050 Version bump: `npm run version:bump -- feature` (19.39.0 → 19.40.0 across root, backend, frontend, shared-domain); let npm update `package-lock.json`; record the version in the ROADMAP entry.
- [X] T051 Validate: `npm test`, `npm run lint`, `npm run build`; run quickstart.md manual steps 1–12; report honestly any step not run. Explicitly confirm the existing regression suites still pass: `backend/tests/unit/openapi`, `backend/tests/unit/testDesign`, `backend/tests/integration/testModels.test.ts`, `backend/tests/integration/execution/executionRuns.test.ts`, and the frontend `App.test`, `workflowCatalog.test` and external-collection page tests (FR-040). Do not commit; leave changes for review.

## Phase 11: Refinement foundation (blocks Phases 12 and 13)

**Context**: Reworks the already-implemented feature to the refined rules in [coverage-rules.md](coverage-rules.md) (section 15 lists ten differences from the code). Decisions D-1 and D-4 are **not** implemented here (D-2 is resolved and implemented in T063) (see [decision-log.md](decision-log.md)); D-3, D-6 and D-7 are resolved (T052). Existing tests that encode the old behaviour are updated deliberately, never weakened or disabled.

- [X] T052 [US8] Gate, no code: D-3, D-6 and D-7 are resolved (clarified 2026-10-10: strict positive-only crediting, unclassified response keys, failure outranks pass with tally). Check `specs/046-api-test-coverage-intelligence/decision-log.md` shows them resolved and that T056, T057 and T062 match; no further confirmation is needed.
- [X] T053 Extend `packages/shared-domain/src/coverage.ts` per data-model.md "Refinement deltas": `CoverageRequirement.group` (`positive | negative | boundary | unclassified`) and `source`; remove kind `scenario-category`; `CoverageCause`; `tally`; `staleReason`, `staleSince`, `reExecutionRequired`; `OperationCoverage.scenarioVerdicts` and `scenarioCount`; `CoverageSnapshot.operationCounts`, new `categoryCoverage` shape with `unclassified`, `execution.evidenceMode`, `evidenceByRun`, `environments`; assertion metric `{ passed, failed, notEvaluated }`; `CoverageFilter.gapKind` adds `insufficient | stale`. Update `packages/shared-domain/tests/unit/coverage.test.ts`. No framework imports.
- [X] T054 [P] Extend fixtures in `backend/tests/fixtures/apiCoverage/`: a mixed-outcome operation (passing happy path, failing invalid-input scenario, unexecuted boundary scenario), a happy path with passing status and failing schema check, a timeout, an unevaluated check, an edited request, a dependency-blocked request (guided `not-attempted` with `dependency-not-met`), three runs where the latest result for one scenario differs from older ones, two environments, documented `default`, `5xx` and `2XX` keys, and a scenario with an undeterminable target.

**Checkpoint**: `npm test -w packages/shared-domain` green; backend type-check shows only the expected breakage in modules reworked below.

---

## Phase 12: User Story 8 - Mixed outcomes and category coverage (Priority: P1)

**Goal**: Operation-level counts OC1 to OC5, requirement-level states judged by relevant checks only, typed failure causes, requirement-partition category coverage with runtime figures.

**Independent Test**: With the T054 mixed fixture, the operation is counted in both "with passing verification" and "with execution failures", shows no single status, exercised parameters and the success code are `verified`, only the failing scenario's requirement is `executed-failed`, the boundary requirement is `generated-not-executed`, and category state counts sum to their denominators (spec User Story 8).

### Tests for US8 (write first, expect failure)

- [X] T055 [P] [US8] `backend/tests/unit/apiCoverage/classify.test.ts`: typed `cause` for each outcome (`assertion-failed`, `transport-error`, `check-not-evaluated`, `no-relevant-check`, `request-edited`); status-check scope: passing status with failing schema check verifies status-scoped requirements and fails only `response-schema`; evidence tally counts; stale accepted with `staleReason` and `reExecutionRequired` but never produced from any fixture.
- [X] T056 [P] [US8] `backend/tests/unit/apiCoverage/scenarioMapping.test.ts`: `operation` and exercised requirements credited only by positive-group scenarios; negative and boundary scenarios still count for operation-level "with scenarios"; a boundary-invalid scenario asserting `400` credits the documented `400` and its own boundary requirement; response-code and response-schema credited by any group; undeterminable target credits only operation-level counts.
- [X] T057 [P] [US8] `backend/tests/unit/apiCoverage/categoryCoverage.test.ts`: requirements partitioned by group; per category specification covered, `verified` and every state count sum to the eligible denominator; `default`, `5xx`, `2XX` are `unclassified` and excluded from category denominators but present in response-code coverage; zero eligible requirements gives "not available" not 0%; security `available: false`; duplicate scenarios do not change any figure; declared security never changes a figure.
- [X] T058 [P] [US8] `backend/tests/unit/apiCoverage/operationCounts.test.ts`: OC1 to OC5 and invariants (`withScenarios + withNoScenarios = eligible`, passing and failing each at most `withScenarios`, scenario verdicts sum to `scenarioCount`); an operation can be in both passing and failing; transport, edited and not-evaluated scenarios are in neither; out-of-scope operations excluded from every count.
- [X] T059 [P] [US8] `backend/tests/unit/apiCoverage/runSelection.test.ts`: latest-per-scenario takes the newest attributable result and uses only runs from the newest qualifying run's environment, lists excluded runs with the reason, and discloses every contributing run; single-run mode marks absent scenarios `not-in-selected-run`; every figure derives from one snapshot (cards, categories, gaps, operations agree); `blocked-by-dependency`, `run-cancelled`, `not-reached` reported where recorded and `never-run` otherwise; infrastructure-request failure is a notice, not a requirement failure and not unattributed.

### Implementation for US8

- [X] T060 [US8] `backend/src/apiCoverage/scenarioMapping.ts`: apply crediting rules of coverage-rules.md 4.4 and check scopes of 5.2 (status-code scope for `operation`, exercised and case requirements; `operation` and exercised credited by positive-group scenarios only). Existing mapping tests that assumed `any` scope are updated with a comment citing the rule, not weakened.
- [X] T061 [US8] `backend/src/apiCoverage/elements.ts`: assign `group` per coverage-rules.md 4.3, add `source`, remove the `scenario-category` requirements, keep boundary applicability rules.
- [X] T062 [US8] `backend/src/apiCoverage/classify.ts`: return typed `cause` and `tally`; keep precedence; judge each requirement by its scope's checks only; allow `stale` input without producing it.
- [X] T063 [US8] `backend/src/apiCoverage/evidence.ts`: surface `NotAttemptedReason` from guided runs, restrict latest-per-scenario to the newest qualifying run's environment (name and tier) and return the excluded runs with a reason, record per-run evidence counts, count passed, failed and not-evaluated assertions (excluding edited and no-response results), classify infrastructure-request failures as notices.
- [X] T064 [US8] `backend/src/apiCoverage/summarize.ts` and `calculateCoverage.ts`: scenario verdicts and counts per operation, `operationCounts` (OC1 to OC5), requirement-partition `categoryCoverageFor` with spec and runtime figures and the `unclassified` line, operation state profile without a single status, `evidenceMode`/`evidenceByRun`/`environments`, assertion triple. Rename the operation metric label to "Operations with passing verification" (basis states it is not a completeness measure).

### Frontend for US8

- [X] T065 [P] [US8] `frontend/tests/unit/apiCoverage/CategoryCoverage.test.tsx` and `OperationCounts.test.tsx`: four category cards with numerator, denominator, percentage and state counts; security "Unavailable" with reason and no percentage; "not available (0 eligible)"; unclassified line; five operation counts with their labels; no single status pill on an operation row.
- [X] T066 [US8] Create `frontend/src/components/apiCoverage/CategoryCoverage.tsx` and `OperationCounts.tsx` (reuse `StatTile`, `CoverageBars`, semantic tokens only); extend `coverageViewModel.ts` with cause labels and the stale label "Stale: re-run required".
- [X] T067 [US8] `frontend/src/components/apiCoverage/GapsTable.tsx`: replace the single state column with the requirement-state profile, scenario verdict counts and membership chips; add an expandable row (`aria-expanded`) listing scenarios (verdict, run, cause) and requirements (state, cause, tally, evidence or reason, priority rationale), non-verified only unless the toggle is on. Wire into `CoveragePage.tsx`.

**Checkpoint**: Independent Test above passes; `npm test -w backend`, `-w frontend`, `npm run lint`.

---

## Phase 13: Refinement of existing stories (US2, US3, US5, US6, US7)

- [X] T068 [P] [US3] Tests then code for gap types: `backend/tests/unit/apiCoverage/filterSnapshot.test.ts` and `backend/tests/integration/coverage.test.ts` cover `gapKind=insufficient|stale`, `category=security` returning `400 category_unavailable` with the reason, state-filter keeps operations with at least one matching requirement and reports matching counts; implement in `backend/src/apiCoverage/coverageQuery.ts`, `filterSnapshot.ts`, `backend/src/api/coverage.ts`; update `contracts/coverage-routes.md` response table (already amended in planning, verify).
- [X] T069 [P] [US5] Tests then code for run-mode disclosure in `backend/src/apiCoverage/renderCoverageHtml.ts` and the JSON export: evidence mode, contributing runs and environments, out-of-scope and not-measurable lists, unattributed count; `backend/tests/unit/apiCoverage/renderCoverageHtml.test.ts` asserts figures equal the on-screen snapshot for `scope=filtered` and `scope=all` (SC-015) and still contain no secrets.
- [X] T070 [P] [US7] `frontend/src/hooks/useCoverage.ts` and `CoveragePage.tsx`: keep the last good snapshot when a recalculation fails and show the "Out-of-date snapshot" state with its time and a retry (never "stale"); show the scope label on cards, categories and recommendations; show the evidence mode and contributing runs in the header and a "combined evidence" notice when several runs contribute. Tests in `frontend/tests/unit/apiCoverage/CoverageStates.test.tsx` and `useCoverage.test.tsx`: first-load failure is the error state (not empty), later failure retains the snapshot, a slower earlier response never overwrites a newer one.
- [X] T071 [P] [US2] `frontend/src/components/apiCoverage/StateBadge.tsx` and bars: Stale has its own label, tone and bar segment, distinct from generated-not-executed; stale rows show reason and "re-run required" from the record; test in `StateBadge.test.tsx` and `CoverageThemes.test.tsx` (text labels and semantic tokens in both themes).
- [X] T072 [US3] Priority and recommendations: add "needs re-execution" and "no generated scenarios" factors, group by cause, keep ties stable; recommendations name requirement, current state with cause, evidence reference, rationale and action (adds `re-run` action text for stale); update `prioritize.ts`, `recommendations.ts` and their tests. Priority remains labelled heuristic.

---

## Phase 14: Refinement polish and validation

- [X] T073 Update every existing test that encoded the old behaviour (operation requirement credited by any scenario, `(operation, group)` category counts, free-text notes, single operation status) and list each changed test file and the rule that justifies it in the task notes at the end of this file.
- [X] T074 [P] Redaction and determinism: extend `backend/tests/unit/apiCoverage/redaction.test.ts` and `safety.test.ts` so new fields (causes, run lists, environments, stale reason) carry no header values, bodies, URLs with query strings, tokens, cookies or `rawCapture`, and identical inputs give byte-identical output apart from `calculatedAt` (SC-005); confirm the 500-operation timing test still passes with the added aggregation (SC-006).
- [X] T075 Documentation: update `docs/USER_MANUAL.md` (operation counts, category coverage, causes, run selection, out-of-date snapshot, unavailable security) and `docs/architecture.md` (check scopes, crediting rules, requirement-partition categories, stale reserved); note the behaviour change and any lowered figures in the `specs/ROADMAP.md` AP-046 entry. Version: the feature is already at 19.40.0; if it has not been released, record the rework under that version, otherwise run `npm run version:bump -- feature`. Ask the user which applies before bumping.
- [ ] T076 Validate: `npm test`, `npm run lint`, `npm run build`; walk [acceptance-checklist.md](acceptance-checklist.md) sections 1 to 12 against the running app (skipping items marked D-1, D-4) and quickstart steps 12 to 15; check the mock [mock.html](mock.html) still matches the implemented behaviour. Report honestly any item not run, including light and dark themes if no browser session is available. Do not commit; leave changes for review.

---

## Dependencies and Execution Order

- Phase 1 → Phase 2 → user stories. Phase 2 blocks everything.
- US1 (MVP) first. US2 depends on US1's calculator and route. US3 depends on US2 (states feed gaps and priority). US4 depends on US3. US5 depends on US2. US6 depends on US3 (export uses `filterSnapshot`). US7 depends on the page existing (US1) and is verified last.
- Within a story: tests first (expect failure), then pure backend modules, then route, then frontend.
- Refinement: T052 and T053 first; T054 parallel with T053. T055 to T059 (tests) before T060 to T064. T060 and T061 before T062; T063 before T064; T064 before T065 to T067 (needs the new snapshot shape). Phase 13 tasks depend on T053 and T064. T073 follows T060 to T064; T075 and T076 are last. D-1 and D-4 have no tasks by design.
- T004 depends on T003. T008 depends on T001, T004. T013 depends on T008. T014 depends on T006, T008, T013. T015 depends on T007, T014. T019 depends on T016–T018. T020 depends on T019.

## Parallel Opportunities

- Phase 2: T003, T005, T006, T007 together; then T004, T008, T009.
- US1: T010, T011, T012 together; T016, T017 together after T001.
- US2: T021, T022, T023 together.
- US3: T027, T028, T029 together; T032 parallel with T030/T031 once the contract is fixed.
- Later phases: test tasks marked [P] within each story.
- Refinement: T054 with T053; T055 to T059 together; T060 and T061 together (different files); T065 with T060 to T064 once T053 is done; T068 to T071 together after T064.

## Implementation Strategy

1. Ship Phases 1–3 (MVP): spec-only coverage visible end to end, validated by quickstart steps 1–3.
2. Add US2 (runtime evidence) — the feature's core honesty guarantee — and validate steps 4–5.
3. Add US3/US4 (actionability), then US5 (staleness and run selection), then US6/US7 and polish.
4. At every checkpoint run `npm test -w <workspace>` and `npm run lint`.


---

## Implementation notes (recorded during `/speckit-implement`, 2026-10-10)

Where the work landed differently from the task text; every requirement is still covered.

- **T008, T013, T024, T025, T037.** Unattributed-result accounting and the "edited after run" note live in `evidence.ts` and
  `calculateCoverage.ts`; no separate `unattributed.ts` / `staleness.ts` was needed. T036's cases are in
  `evidence.test.ts` and `calculateCoverage.test.ts` (`unattributed`, `scenarioEditedAfterRun`, latest-run and selected-run rules).
- **T029, T032.** The table, filters and sorting are tested through `CoveragePage.test.tsx`, plus
  `GapsTable.performance.test.tsx`; there is no separate `GapsTable.test.tsx`.
- **T035, T038, T041.** Recommendations, the run selector and the export links are covered in `CoveragePage.test.tsx`
  and `CoverageStates.test.tsx`.
- **T042.** `CoverageNavigation.test.tsx`, plus one test in `ExternalCollectionRunPanel.test.tsx`.
- **T046.** The backend timing test is in `safety.test.ts` with the redaction test (T047); the frontend half is
  `GapsTable.performance.test.tsx`.
- **Additions beyond the task list.** `coverageQuery.ts` (query validation and view description), `coverageService.ts` (reads the
  session sources, injectable for tests), `useCoverage.test.tsx`, `coverageViewModel.test.ts`, a shared-domain contract test, and
  `execution.availableRuns` so the run selector keeps every run when one is evaluated.
- **Directory name.** The repository's `.gitignore` has `**/coverage/`, so directories named `coverage` would not be committed,
  linted or scanned by Tailwind. Every directory this feature added is `apiCoverage` instead (`backend/src/apiCoverage/`,
  `frontend/src/components/apiCoverage/`, and the matching test and fixture directories); read the plan's `coverage/` paths
  that way. Found in the live browser session, where dark-mode notices were unreadable.
- **Not done, by design.** No browser session was run (no browser tool); the quickstart's manual steps 1 to 12 remain to be walked
  through, notably the light and dark theme step, which jsdom cannot verify.

---

## Implementation notes: refinement rework (recorded during `/speckit-implement`, 2026-10-10)

T052 to T075 are done; T076 is only partly done (see below). Where the work landed differently from the task text:

- **T053.** `CoverageGap` also gained `cause`, `CoverageScenarioResult` gained per-scenario `assertions` (so assertion figures
  can be restricted to a category), `OperationCoverage` gained optional `matchingRequirements`, and the check scope `status` was
  added (the scenario's status-code checks, any code). `unclassified.requirements` is a list of `{ operationKey, label }`, not a
  count; the count is its length. data-model.md describes the first shape and is superseded by `shared-domain/src/coverage.ts`.
- **T060 to T064.** `scenarioMapping.ts`, `elements.ts`, `classify.ts`, `evidence.ts`, `summarize.ts` and `calculateCoverage.ts`
  changed as planned. `operation` is credited only by positive-group scenarios, so the "Operations" specification metric is now
  the count of operations with a counted scenario (OC2), not the number of `operation` requirements covered. The operation row's
  fraction excludes the `operation` requirement. Gap ids now include the cause (`gap:<op>:<state>:<cause>`).
- **T063.** For an uploaded run the only environment signal recorded is its collection name and tier, so the D-2 restriction
  compares those. The base URL is no longer returned in `execution.environment` (a privacy improvement the old
  `evidence.test.ts` expectation encoded).
- **T068.** `category=security` is rejected as `400 category_unavailable`; `gapKind` accepts `insufficient` and `stale` (the
  latter returns no rows until D-1).
- **T072.** The scoring weights did not change: a stale gap already scored as an unverified state and an operation with no
  scenario already scored through the whole-operation gap. Gaps are now grouped by state and cause, and a stale gap recommends
  `re-run`.
- **T073, tests changed because the behaviour changed (each justified by coverage-rules.md):**
  `calculateCoverage.test.ts` (security and failed-assertion cases: the category shape; an operation with a failing and a passing
  scenario is in both counts), `elements.test.ts` (no `cat:` requirements; groups instead), `scenarioMapping.test.ts` (a
  required-field scenario no longer credits the happy path, rule 4.4), `evidence.test.ts` (`runIds` lists only runs that supplied
  evidence; environment is name and tier), `recommendations.test.ts` (gap id carries the cause), `integration/coverage.test.ts`
  (`category=security` is `category_unavailable`), and the frontend `CoveragePage.test.tsx`, `CoverageStates.test.tsx`,
  `coverageViewModel.test.ts`, `coverageFixtures.ts` (labels, six segments, new snapshot fields). No test was disabled or weakened.
- **T075.** Docs updated in `docs/USER_MANUAL.md`, `docs/architecture.md` and the ROADMAP AP-046 entry. No version bump: `HEAD`
  is 19.39.0 and 19.40.0 exists only in the uncommitted tree, so the rework is recorded under 19.40.0.
- **T076, done:** `npm test` (376 files, 3,144 tests passed, 10 skipped), `npm run lint` and `npm run build` pass; the jsdom run of
  `mock.html` was checked earlier. **Not done:** no browser session was run, so the acceptance-checklist walk against the running
  app, quickstart steps 12 to 15 and the light and dark theme check remain to be done by hand. T076 is therefore left unchecked.
- **Not implemented by design:** D-1 (the Stale state is never produced) and D-4 (security stays unavailable).
