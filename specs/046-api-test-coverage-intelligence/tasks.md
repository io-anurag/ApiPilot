---

description: "Task list for API Test Coverage Intelligence (AP-046)"
---

# Tasks: API Test Coverage Intelligence

**Input**: Design documents from `/specs/046-api-test-coverage-intelligence/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/coverage-routes.md](contracts/coverage-routes.md), [quickstart.md](quickstart.md)

**Tests**: Included. The spec (section 12 of the input, FR-001 to FR-041, SC-001 to SC-011) requires automated tests for calculation, mapping and UI behaviour.

**Organization**: Grouped by user story. US1 and US2 are both P1; US1 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 to US7, matching spec.md
- Paths are repository-relative. Conventions: pure domain code in `backend/src/coverage/`, thin router in `backend/src/api/`, client in `frontend/src/services/`, Tailwind v4 semantic tokens only (no hex, no arbitrary values), no `console` (use the logger), no new dependencies, no commits (leave changes for review).

**Clarified decisions in force** (spec Clarifications 2026-10-10): pending and accepted scenarios count and rejected never do, with the accepted/pending split shown; edited requests are Inconclusive; results that no longer join to a current scenario are never counted as verified and are reported as unattributed (the Stale state is kept in the contract but reserved, not produced); a review edit after a run does not invalidate evidence; unselected operations are out of scope and not gaps; view state resets on full refresh and is kept across tab switches.

---

## Phase 1: Setup

- [ ] T001 Create `packages/shared-domain/src/coverage.ts` with the enumerations and entity types from data-model.md (`CoverageDimensionKind`, `CoverageState`, `ScenarioCategoryGroup`, `Priority`, `CoverageRequirement`, `CoverageMapping`, `EvidenceRef`, `CoverageMetric`, `CoverageGap`, `Recommendation`, `OperationCoverage`, `NotMeasurable`, `CoverageSnapshot`) and export it from `packages/shared-domain/src/index.ts`. Add `outOfScopeOperations: string[]` and `scenarioCounts` to `CoverageSnapshot` per the clarifications. No framework imports.
- [ ] T002 [P] Create coverage test fixtures in `backend/tests/fixtures/coverage/` (ApiModel fixtures: multi-method same path, path-level + operation-level parameter override, enum/numeric bounds/array items, documented 2xx/4xx/`2XX`/`default`, security-declared operation, `oneOf` and circular-ref issues; matching scenario sets and run-result sets for uploaded and guided runs).

---

## Phase 2: Foundational (blocks all user stories)

- [ ] T003 [P] Write failing tests for path-level parameter merging (path-level included, operation-level overrides on `(name, in)`, specs without path-level parameters unchanged) in `backend/tests/unit/openapi/pathLevelParameters.test.ts`.
- [ ] T004 Merge `pathItem.parameters` into each operation's parameters in `backend/src/openapi/buildApiModel.ts` (near the `operation.parameters` read), operation-level winning. Run existing `backend/tests/unit/openapi` and `backend/tests/unit/testDesign` suites; update only expectations that legitimately gain path-level parameter scenarios, and list each in the task notes.
- [ ] T005 [P] Implement `backend/src/coverage/specRevision.ts`: canonical sorted-key serialization of operations, parameters, request bodies, responses and security schemes (excluding `info.title`/`info.version`), SHA-256. Unit test `backend/tests/unit/coverage/specRevision.test.ts` (stable across key order and `info` changes; changes on contract change).
- [ ] T006 [P] Implement `backend/src/coverage/metrics.ts`: `makeMetric(id, dimension, kind, numerator, denominator, basis)` with `percentage = denominator === 0 ? null : round1(...)`, `available`, and a `numerator <= denominator` assertion. Unit test `backend/tests/unit/coverage/metrics.test.ts` covering zero denominators (never NaN/Infinity), rounding, basis retained.
- [ ] T007 [P] Implement `backend/src/coverage/errors.ts` (`NoActiveWorkflowError`, `RunNotFoundError`, `InvalidCoverageFilterError`).
- [ ] T008 Implement `backend/src/coverage/elements.ts`: `ApiModel` + `selectedOperationKeys` → `CoverageRequirement[]` with stable ids (`op:`, `param:`, `reqprop:`, `resp:`, schema-element ids), per-element `contractHash`, `applicable`, `measurable`, and `NotMeasurable[]` from `AnalysisIssue` (`oneOf`/`anyOf`/discriminator/unresolved/circular; `nullable` and `additionalProperties` noted as not retained). Unselected operations go to `outOfScopeOperations`. Unit tests `backend/tests/unit/coverage/elements.test.ts` (same path different methods are separate; overridden parameter counted once; out-of-scope excluded from denominators; unsupported constructs listed with reason).
- [ ] T009 Implement `backend/src/coverage/classify.ts`: the six-state precedence from data-model.md as a pure function over a requirement's attributable evidence. Unit test `backend/tests/unit/coverage/classify.test.ts` (each state; failure outranks pass; no evaluated relevant check → inconclusive; edited → inconclusive; not-attempted is not evidence).

**Checkpoint**: foundation ready; run `npm test -w backend` and `npm test -w packages/shared-domain`.

---

## Phase 3: User Story 1 — Specification coverage (Priority: P1) — MVP

**Goal**: Show specification coverage per operation, parameter, request schema, response code/schema and category from generated scenarios, with gaps listed; works with no execution data.

**Independent Test**: Upload a spec, generate scenarios for a subset, open Coverage: covered items match scenarios, the rest are listed as not covered, runtime shown as unavailable.

### Tests for US1

- [ ] T010 [P] [US1] `backend/tests/unit/coverage/scenarioMapping.test.ts`: operation with no scenario is not covered; ten scenarios on one parameter count once; `enum-positive-variant` covers the specific enum value; `required-field-*` covers the required flag; boundary rules cover min/max elements; response code covered only by exact `expectedStatusCode` match (`2XX`/`default` match only themselves); schema element covered only with a paired `status-code` + `schema-conformance` assertion; cookie parameters documented but uncovered; rejected scenarios excluded, pending included with accepted/pending counts; scenario group (positive, negative, boundary) is derived from `provenance.rule`, not the `category` field, so at-boundary variants count as boundary and each scenario belongs to exactly one group.
- [ ] T011 [P] [US1] `backend/tests/integration/coverage.test.ts` (Supertest): `GET /api/coverage` 200 for spec-only (real zeros, notices), 409 `no_active_workflow` without a workflow, response never contains bodies, header values or `rawCapture`.
- [ ] T012 [P] [US1] `frontend/tests/unit/coverage/CoveragePage.spec.test.tsx`: metric cards show numerator, denominator and percentage; zero denominator renders "not available" (never NaN); notice text exact; no-workflow empty state with recovery link; error state is not rendered as empty coverage.

### Implementation for US1

- [ ] T013 [US1] Implement `backend/src/coverage/scenarioMapping.ts` per research R7 (rule id + `targetLocation`/`targetField` + assertions → requirement ids; deterministic, sorted, deduplicated; carries `source` and review state).
- [ ] T014 [US1] Implement `backend/src/coverage/calculateCoverage.ts` (pure orchestrator: workflow snapshot, runs, clock → `CoverageSnapshot`) for the specification dimension: metrics per data-model denominators, `OperationCoverage[]`, category groups (security `available:false` with reason), `scenarioCounts`, notices, spec-revision block.
- [ ] T015 [US1] Implement `backend/src/api/coverage.ts` (`GET /api/coverage`, thin: read current workflow via `getCurrentWorkflow`, call the calculator, map typed errors to `409 no_active_workflow`, log counts/duration only) and register it in `backend/src/app.ts`.
- [ ] T016 [P] [US1] Create `frontend/src/services/coverageClient.ts` (result-union convention, `createLogger`) and `frontend/src/hooks/useCoverage.ts` (explicit `loading | success | empty | no-workflow | error` and a request-sequence guard so a stale response never overwrites a newer one) with tests in `frontend/tests/unit/coverage/useCoverage.test.tsx`: a slow earlier response does not overwrite a newer one (FR-035).
- [ ] T017 [P] [US1] Create `frontend/src/components/coverage/coverageViewModel.ts` (pure formatting: percentages, "not available", state labels and tones) and tests in `frontend/tests/unit/coverage/coverageViewModel.test.ts`.
- [ ] T018 [US1] Create `frontend/src/components/coverage/CoverageNotice.tsx`, `MetricGroup.tsx` (reusing `StatTile`) and `CoverageBars.tsx` (SVG, `fill-chart-N`/semantic tokens, accessible counts table, separates specification, runtime and remaining gap) following `components/liveRun/LiveRunChart.tsx`.
- [ ] T019 [US1] Create `frontend/src/pages/CoveragePage.tsx` (header with spec name, revision, context; notice; metric groups; breakdown; out-of-scope list; not-measurable list; recalculate action) using `Skeleton`, `EmptyState`, `ErrorState`.
- [ ] T020 [US1] Register the view: add `coverage` to `EntryChoice` and `WORKFLOWS` (section `results`) in `frontend/src/components/workflowCatalog.ts`; wire the lazy import, `mount` map and rendering in `frontend/src/App.tsx`; update `EntryChooser.tsx` and `HelpDialog.tsx`; update `workflowCatalog.test`, `sectionCatalog.test`, `App.test`, `EntryChooser.test`, `paletteCommands.test` in `frontend/tests/unit/`.

**Checkpoint**: US1 works with no execution data. Run its tests plus `npm run lint`.

---

## Phase 4: User Story 2 — Runtime states (Priority: P1)

**Goal**: Distinguish generated, executed, failed, verified, inconclusive and stale using real execution evidence.

**Independent Test**: Run a subset with passes and failures; states match the evidence; failures are never "untested".

### Tests for US2

- [ ] T021 [P] [US2] `backend/tests/unit/coverage/evidence.test.ts`: uploaded-run join by `itemIdForScenario`, assertion kind from the exported test-name helpers; guided `ExecutionRun` join by `scenarioId` and `assertionIndex`; `not-attempted` is not evidence; edited item (`wasEdited`) → inconclusive; unjoinable results counted as `unattributedResults`; no rawCapture in output.
- [ ] T022 [P] [US2] Extend `backend/tests/unit/coverage/calculateCoverage.test.ts`: generated-only adds zero runtime verification; passing evaluated checks verify; failed assertion not counted as verified; executed failure not labelled untested; 200 response with no evaluated schema assertion leaves the schema inconclusive; determinism (same input twice, identical output ignoring `calculatedAt`); element ids are unchanged when an unrelated part of the specification changes and when scenario order changes (FR-034); the snapshot has no aggregate or overall score field (FR-010).
- [ ] T023 [P] [US2] `frontend/tests/unit/coverage/StateBadge.test.tsx`: all six states carry a text label and distinct tone (not colour only).

### Implementation for US2

- [ ] T024 [US2] Implement `backend/src/coverage/evidence.ts` (`EvidenceSource` for uploaded and guided runs; reads the runs of all uploaded collections in the session through the existing run repository, joins by `itemId`, and counts every unjoined result in `unattributedResults`; import test-name helpers from `backend/src/postman/` rather than copying strings; `itemIdForScenario` from `backend/src/postman/identifiers.ts`).
- [ ] T025 [US2] Wire evidence and `classify` into `calculateCoverage.ts`: runtime metrics (operations verified, response codes verified, contract assertions evaluated and passed), per-requirement `CoverageState`, `lastQualifyingExecutionAt`, execution context (environment name and tier only).
- [ ] T026 [P] [US2] Create `frontend/src/components/coverage/StateBadge.tsx` (wraps `StatusBadge`; text + tone per state) and render runtime metric group, "generated, not executed" labelling and the failed-result links in `CoveragePage.tsx`.

**Checkpoint**: Both P1 stories working; quickstart steps 1–5.

---

## Phase 5: User Story 3 — Gaps table and prioritization (Priority: P2)

**Goal**: Sortable, filterable gaps table with documented, deterministic priority.

**Independent Test**: Filter by method, state, category, priority, missing-versus-failed and sort; rows and summary counts agree.

### Tests for US3

- [ ] T027 [P] [US3] `backend/tests/unit/coverage/prioritize.test.ts`: destructive and unverified outranks non-destructive with equal gaps; one underlying gap grouped once; tie-break by operation key is stable; labelled heuristic; failure history omitted rather than guessed.
- [ ] T028 [P] [US3] `backend/tests/unit/coverage/filterSnapshot.test.ts`: each filter, sort keys, `totals` unfiltered, summary values reflect the filtered set, invalid filter → `InvalidCoverageFilterError`.
- [ ] T029 [P] [US3] `frontend/tests/unit/coverage/GapsTable.test.tsx`: semantic table, sorting, filters, pagination, row actions link to scenario/result with context, filters retained across a view switch and reset on remount after refresh.

### Implementation for US3

- [ ] T030 [US3] Implement `backend/src/coverage/prioritize.ts` (documented weights in code and a header comment: missing runtime verification, missing specification coverage, executed failure, destructive method, declared security, contract complexity; bands High/Medium/Low) and gap grouping in `calculateCoverage.ts`.
- [ ] T031 [US3] Implement `backend/src/coverage/filterSnapshot.ts` and the query parsing/validation in `backend/src/api/coverage.ts` per contracts/coverage-routes.md, including mapping `InvalidCoverageFilterError` to `400 invalid_filter`.
- [ ] T032 [P] [US3] Create `frontend/src/components/coverage/GapFilters.tsx` and `GapsTable.tsx` (`HttpMethodBadge`, `Pagination`, monospace paths, horizontal scroll, actions) and extend `coverageClient.ts`/`useCoverage.ts` with filter parameters.

---

## Phase 6: User Story 4 — Recommended next tests (Priority: P2)

**Goal**: Ranked, traceable recommendations.

**Independent Test**: Each recommendation names operation, requirement, reason, evidence, priority rationale and action; output is identical on repeat.

- [ ] T033 [P] [US4] `backend/tests/unit/coverage/recommendations.test.ts`: fields complete, ordering follows prioritization, identical on repeat, every `gapId` exists, no fabricated evidence.
- [ ] T034 [US4] Implement `backend/src/coverage/recommendations.ts` and include `recommendations` in the snapshot.
- [ ] T035 [P] [US4] Create `frontend/src/components/coverage/Recommendations.tsx` and `frontend/tests/unit/coverage/Recommendations.test.tsx` (actions: review scenario, generate scenario, open result).

---

## Phase 7: User Story 5 — Specification changes and repeated runs (Priority: P2)

**Goal**: Honest staleness and run selection.

**Independent Test**: Re-upload a changed spec: earlier results are reported as unattributed and none counts as verified; run twice: counts unchanged; select an older run: evaluated against it.

- [ ] T036 [P] [US5] Tests in `backend/tests/unit/coverage/unattributed.test.ts`: after regeneration, earlier results that join to no current scenario are never counted as verified and are reported in `unattributedResults` with the "possibly from an earlier specification" explanation; results of an unrelated collection are treated the same; a review edit after a run does not invalidate evidence and sets `scenarioEditedAfterRun`; repeated runs do not double-count; latest qualifying run per scenario is the default; `runId` selects one run; unknown `runId` → `RunNotFoundError`; the Stale state is accepted by the classifier but never produced.
- [ ] T037 [US5] Implement `backend/src/coverage/unattributed.ts` (unattributed-result accounting and the `scenarioEditedAfterRun` note, using `ReviewScenario.history` timestamps only if present; if absent, omit the note and record that in a comment) and the run-selection rule; surface a specific unattributed notice and `execution.runIds`/`selectedRunId`; add `runId` handling and `404 run_not_found` to `backend/src/api/coverage.ts`.
- [ ] T038 [P] [US5] Add a run selector and stale/unattributed notices to `CoveragePage.tsx`; test in `frontend/tests/unit/coverage/RunSelector.test.tsx`.

---

## Phase 8: User Story 6 — Navigation and export (Priority: P3)

**Goal**: Contextual links and export of the current view.

**Independent Test**: Navigate from scenario review to Coverage and back with context intact; export filtered and all views and compare with the screen.

- [ ] T039 [P] [US6] `backend/tests/unit/coverage/renderCoverageHtml.test.ts` and extend `backend/tests/integration/coverage.test.ts`: HTML and JSON exports match `filterSnapshot` output for `scope=filtered` and `scope=all`, include definitions and denominators, escape interpolated text, contain no secrets, correct `Content-Disposition`.
- [ ] T040 [US6] Implement `backend/src/coverage/renderCoverageHtml.ts` (reuse `escapeHtml` and report styling from `backend/src/externalCollections/runReportHtml.ts`; no new dependency) and `GET /api/coverage/export` in `backend/src/api/coverage.ts`.
- [ ] T041 [P] [US6] Add export action to `CoveragePage.tsx` and `coverageClient.ts` (download helper following `externalCollectionsClient.ts` report download).
- [ ] T042 [US6] Add contextual links: "View coverage" in `frontend/src/components/ScenarioReviewStage.tsx` and in the results area of `frontend/src/components/ExternalCollectionRunPanel.tsx`, via an `onOpenCoverage` callback in `App.tsx` following the `handleOpenChainPlan` pattern; link from Coverage to the execution workflow and scenario generation. Tests in `frontend/tests/unit/coverage/CoverageNavigation.test.tsx`.

---

## Phase 9: User Story 7 — Empty, error and theme states (Priority: P3)

- [ ] T043 [P] [US7] `frontend/tests/unit/coverage/CoverageStates.test.tsx`: loading skeleton, empty spec, malformed or unsupported constructs (not-measurable list), missing history, incomplete evidence, API failure; each has a specific message and recovery action; no demo data anywhere.
- [ ] T044 [P] [US7] `frontend/tests/unit/coverage/CoverageThemes.test.tsx`: render under `data-theme="light"` and `"dark"`; assert semantic token classes only (no hex, no inline colour styles), text labels on every status, visible focus classes on interactive elements.
- [ ] T045 [US7] Fix any gaps found by T043 and T044 in `frontend/src/components/coverage/` and `CoveragePage.tsx`; confirm no arbitrary Tailwind values, no inline styles, and `prefers-reduced-motion` respected.

---

## Phase 10: Polish and cross-cutting

- [ ] T046 [P] Performance check: unit test in `backend/tests/unit/coverage/performance.test.ts` building a 500-operation fixture and asserting the calculation completes well under the 3 s budget and issues no repeated model traversal per row (SC-006), plus a frontend test in `frontend/tests/unit/coverage/GapsTable.performance.test.tsx` rendering a 500-row fixture and asserting filter and sort changes apply within the 1 s budget; "usable" means the metric groups and first table page are rendered.
- [ ] T047 [P] Security check: test in `backend/tests/unit/coverage/redaction.test.ts` that no snapshot or export field contains header values, bodies, URL query strings, tokens, cookies or `rawCapture` for a fixture whose runs include them (FR-036).
- [ ] T048 Documentation: add a Coverage section to `docs/USER_MANUAL.md` (definitions, six states, limits, refresh behaviour) and `docs/architecture.md` (calculator, evidence join, staleness, prioritization weights, unsupported constructs and unavailable dimensions); add the AP-046 entry to `specs/ROADMAP.md` and note the path-level parameter fix on the AP-002/AP-003 entries.
- [x] T049 Update the plan and data model for the clarifications (out-of-scope field, unattributed-evidence rule replacing the per-scenario staleness rules in research R4, reserved Stale state, review-edit note) in `specs/046-api-test-coverage-intelligence/plan.md`, `research.md`, `data-model.md`. Done during `/speckit-analyze` remediation, before implementation.
- [ ] T050 Version bump: `npm run version:bump -- feature` (19.39.0 → 19.40.0 across root, backend, frontend, shared-domain); let npm update `package-lock.json`; record the version in the ROADMAP entry.
- [ ] T051 Validate: `npm test`, `npm run lint`, `npm run build`; run quickstart.md manual steps 1–12; report honestly any step not run. Explicitly confirm the existing regression suites still pass: `backend/tests/unit/openapi`, `backend/tests/unit/testDesign`, `backend/tests/integration/testModels.test.ts`, `backend/tests/integration/execution/executionRuns.test.ts`, and the frontend `App.test`, `workflowCatalog.test` and external-collection page tests (FR-040). Do not commit; leave changes for review.

---

## Dependencies and Execution Order

- Phase 1 → Phase 2 → user stories. Phase 2 blocks everything.
- US1 (MVP) first. US2 depends on US1's calculator and route. US3 depends on US2 (states feed gaps and priority). US4 depends on US3. US5 depends on US2. US6 depends on US3 (export uses `filterSnapshot`). US7 depends on the page existing (US1) and is verified last.
- Within a story: tests first (expect failure), then pure backend modules, then route, then frontend.
- T004 depends on T003. T008 depends on T001, T004. T013 depends on T008. T014 depends on T006, T008, T013. T015 depends on T007, T014. T019 depends on T016–T018. T020 depends on T019.

## Parallel Opportunities

- Phase 2: T003, T005, T006, T007 together; then T004, T008, T009.
- US1: T010, T011, T012 together; T016, T017 together after T001.
- US2: T021, T022, T023 together.
- US3: T027, T028, T029 together; T032 parallel with T030/T031 once the contract is fixed.
- Later phases: test tasks marked [P] within each story.

## Implementation Strategy

1. Ship Phases 1–3 (MVP): spec-only coverage visible end to end, validated by quickstart steps 1–3.
2. Add US2 (runtime evidence) — the feature's core honesty guarantee — and validate steps 4–5.
3. Add US3/US4 (actionability), then US5 (staleness and run selection), then US6/US7 and polish.
4. At every checkpoint run `npm test -w <workspace>` and `npm run lint`.
