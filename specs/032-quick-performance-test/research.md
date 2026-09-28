# Research: Quick Performance Test from a Specification (AP-032)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-28

Each decision records what was chosen, why, and what was rejected. Facts about the existing code
were read from the repository at version 19.5.3 (commit `3e618ad`, branch `AP-032`). AP-029's
decisions are cited as "AP-029 D<n>" and live in
[specs/031-k6-performance-testing/research.md](../031-k6-performance-testing/research.md).

The spec left no `NEEDS CLARIFICATION` markers: its four clarifications of 2026-09-27 settled
coexistence with the guided workflow, the governance amendment (constitution v2.4.0), where the
write-operation visibility applies, and the credential producers. The decisions below cover the
technical unknowns that remained.

## Q1. Where the quick path lives: a standalone, session-scoped route family

**Decision**: A new route family under `/api/quick-performance`, with its state in a new
in-memory, session-scoped store (`backend/src/performance/quick/quickTestStore.ts`). It is not a
guided-workflow stage and does not read or write `TestGenerationWorkflow`.
- One quick test per session: the analyzed `ApiModel`, the generated positive scenarios, the
  plan and, once generated, the script.
- The store is a `Map<sessionId, QuickPerformanceTest>`, cleared by `onExpire` like
  `workflowStore.ts` and `scriptStore.ts`. It is not persisted, so a backend restart loses the
  quick test as it loses the guided plan (spec Edge Cases). Runs are persisted as today.

**Rationale**: This mirrors AP-026's Import & Run, which is the precedent the spec names for an
independent second entry (FR-021; AP-026 Clarifications 2026-09-20). A separate store makes
FR-021 true by construction: no code path in the quick router can reach the guided workflow's
state.

**Alternatives rejected**:
- A guided workflow started in a "quick" mode that skips stages. The stage machine, staleness
  and discard rules would all need exceptions, and a quick test would replace the user's guided
  workflow, contradicting the clarification that both coexist.
- Persisting the quick test in SQLite. The spec says it does not survive a restart, and the plan
  would then need the same care as AP-025's encrypted tables for no stated need (constitution
  XXVII).

## Q2. Sharing the plan, script and run routes between the two paths

**Decision**: Refactor `api/performanceTesting.ts` and `api/performanceRuns.ts` so that the plan,
script and run routes are registered by one function over a small source adapter:

```text
interface PerformancePlanSource {
  kind: "guided" | "quick";
  require(): PlanHandle;              // throws the path's own gate error
}
interface PlanHandle {
  context: PerformanceContext;
  plan(): PerformancePlan;            // current plan (guided: rebuilt on upstream change)
  savePlan(plan): void;
  script(): GeneratedScript | undefined;
  saveScript(script): void;
  onPlanChanged(before, after): void; // guided: complete → active on a fingerprint change; quick: nothing
  onPlanReset(plan): void;            // guided: complete → active when the script is out of date; quick: nothing
  onScriptGenerated(): void;          // guided: stage → complete; quick: nothing
}
// plus, on the handle: onOpen?(): void, called by GET /plan (guided: enterStageIfNeeded)
```

`registerPerformanceRoutes(router, base, source, deps)` registers `GET/PUT /plan`,
`POST /plan/reset`, `GET /plan/values`, `GET /plan/steps/:stepId/request`, `POST /script`,
`GET /script/download`, and then calls `registerPerformanceRunRoutes(router, deps, base, source)`
for `GET /readiness` and the run routes. The guided source wraps
`requirePostmanGenerationComplete`, `currentPlan`, `patchWorkflow`, `scriptStore` and the stage
updates exactly as they are today; the quick source wraps the quick store.

**Rationale**: Two concrete sources exist now, and every route body is identical apart from where
the plan and script are kept (constitution XXVII allows an abstraction with a present need). One
set of routes means one set of error mappings, one run-start check order and one place where the
XVII exception's conditions are enforced (FR-020 requires them unchanged).

**Alternatives rejected**:
- Copying the router for the quick path. Two copies of `POST /runs` would have to be kept
  identical by review, and the run trigger is the security-relevant route.
- One router with a `?source=` query parameter. The source would then be caller-chosen on every
  request, and the guided gate could be sidestepped by a query string.

## Q3. Generating positive scenarios only (FR-004)

**Decision**: Add `generatePositiveScenarios(apiModel): TestScenario[]` to
`testDesign/generateTestModel.ts`. It runs only the three positive-category rules, in their
existing order (`positiveScenario`, `enumPositiveScenarios`, `minimalPositiveScenario`), over
every operation, then applies the existing `deduplicate`. `generateTestModel` is unchanged.
No AI provider is referenced anywhere in the quick path.

**Implementation finding (2026-09-28)**: the boundary rules (for example `numericBoundaryScenarios`)
also emit valid at-boundary variants in the `positive` category, such as
`numeric-boundary-at-maximum`. They are not generated on the quick path, because running a
boundary rule also generates its negative scenarios. Every operation still has its full
happy-path scenario, which is the one the quick ids rank lowest (Q4).

**Rationale**: FR-004 says negative categories "MUST NOT be generated", not merely filtered out.
Running the rule subset is also cheaper for large specifications. The rules and deduplication are
reused unchanged, so the scenarios are the same ones the guided workflow's test design would
produce for the same operation (constitution II, XIII).

**Alternatives rejected**: `generateTestModel` followed by a `category === "positive"` filter. It
generates every negative scenario and throws it away, which contradicts FR-004's wording.

## Q4. Deterministic scenario identifiers in the quick path (FR-005, FR-007, US1 AS4)

**Finding**: `buildScenario` assigns `randomUUID()` ids (`testDesign/scenario.ts:23`). AP-029's
choice among positive scenarios is "the lowest id" (AP-029 D4). An operation usually has several
positive scenarios (full happy path, per-enum values, minimal), so with random ids two uploads of
the same specification choose different scenarios and give different scripts. US1 AS4 and SC-004
require byte-identical output across uploads.

**Decision**: The quick path re-identifies each generated scenario with a content-derived id
before planning (`performance/quick/quickScenarioIds.ts`):

```text
q<rank>-<first 24 hex of SHA-256(canonicalJson({operationKey, rule, request, assertions}))>
```

- `rank` is the two-digit position of the scenario's generating rule in the positive rule order
  (`00` for `positive-scenario`, `01` for `enum-positive-variant`, `02` for
  `minimal-positive-scenario`). AP-029's rule, "lowest identifier among rule-generated
  scenarios", then picks the full happy-path scenario whenever it exists, which is also the most
  representative request. The choice and its reason are recorded as today (`scenarioChoice`,
  `tieBrokenByLowestId`).
- The hash includes the operation key, so ids are unique across operations; deduplication has
  already merged identical request/assertion pairs within an operation.
- `canonicalJson` and `sha256Hex` are the existing `performance/plan/identifiers.ts` helpers.

**Rationale**: It makes FR-005's fixed rule deterministic across uploads without changing the rule
or the guided workflow's scenario ids, which are persisted in review state and shipped contracts.

**Alternatives rejected**:
- Making `buildScenario` content-derived everywhere. It changes the guided workflow's scenario ids
  (AP-006 review decisions, AP-008 workflows and AP-016 Postman output all key on them), which is
  a breaking change outside this feature.
- Choosing by rule order without changing ids. It would need a second selection rule in
  `selectScenario.ts`, contradicting FR-005 ("AP-029's fixed rule").

## Q5. Credential producers start removed (FR-003a, US1 AS6)

**Decision**:
- `planAuth` already finds chained-login producers with `findCredentialProducers` and
  `buildAuthCredentialRelationships` over *all* operations (`plan/stepRequest.ts:189-208`). Its
  `TokenSource` gains `producerOperationKey` for `chained-login` sources. OAuth2 client
  credentials sources have none: their token request goes to the scheme's `tokenUrl`, which is
  not an analyzed operation, so nothing is removed for them.
- The plan gains a derived field, `credentialProducerOperationKeys`: the producer operation keys
  of every chained-login token source the plan uses, sorted. It is computed in both paths.
- For a quick plan only, the initial `excludedOperationKeys` is that list. The operation then
  appears in the removed list with the reason "used to acquire the run's credentials" and can be
  restored like any removal (FR-014). The guided path's initial exclusions stay empty (AP-029
  behaviour unchanged).
- The UI shows that reason for any removed operation that is in
  `credentialProducerOperationKeys`, and "Removed" for every other removal. The reason is derived
  from what the operation is, not stored, so it cannot drift.
- Excluding the producer from the journeys does not affect token acquisition, because `planAuth`
  reads `apiModel.operations`, not the journeys. Restoring it makes it an ordinary journey as
  well; the token is still acquired once in `setup()`.
- A producer whose positive scenario cannot be generated is not a token source today (it is
  skipped at `stepRequest.ts:198`), so it is not in the list; it is listed as left out with "no
  positive scenario" like any other such operation.

**Rationale**: Only the existing producers identify these operations, so nothing is guessed by
name (FR-003a, constitution XIV, XV). Logout or revoke operations are not producers and stay in the
plan, where the write summary shows them (spec Edge Cases).

## Q6. Opening environments to the quick path (FR-016 to FR-018, SC-006)

**Finding**: environments are already one set per session: `environmentRepository.ts` keys rows by
`session_id` only, and `environmentStore.ts` deletes them on session expiry. Only the three
environments routes (`GET`/`POST /test-generation-workflow/environments`,
`PUT /test-generation-workflow/environments/:environmentId`) restrict them, through the private
`requireCompletedWorkflow()` (`api/testGenerationWorkflow.ts:148-156`), which requires
`postmanGeneration` to be complete.

**Decision**:
- The three environments routes call a new `requireEnvironmentAccess()` instead: access is granted
  when the session's guided workflow has completed Postman generation **or** the session has a
  quick test. Otherwise the response is unchanged: `409 stage_not_active`. The routes, bodies,
  validation and encryption are unchanged, and the frontend keeps one `environmentsClient.ts`.
- `requireCompletedWorkflow()` itself, and every functional-execution route that uses it, is
  unchanged (FR-018: the guided workflow's own requirements do not change).
- The quick path's `GET /plan/values` and `POST /runs` read environments through
  `environmentStore.getEnvironment`, as the guided routes do.

**Rationale**: FR-017 asks for one set, and the data is already one set; only the gate needed
widening, and only by the one new condition FR-018 allows. This supersedes AP-029 D1's decision
not to widen the gate, as the spec states.

**Alternatives rejected**:
- A second environments route family for the quick path. It would duplicate validation and invite
  the two sets to drift, against FR-017.
- Keying environments by source. It would split what users expect to be one set.

## Q7. Removing the guided scope toggle (FR-022, FR-023, US4)

**Decision**:
- Remove `PerformanceScope` and `PerformancePlan.scope` from `shared-domain`, `scope` from
  `PlanChoices` and from the plan fingerprint, and the radio group from the stage.
- `operationsInScope(context)` returns the operations in `context.selectedOperationKeys` when it is
  set, and every analyzed operation otherwise. The quick context never sets it, so a quick plan
  covers every operation (FR-003).
- `omitted` is computed only over those operations, so operations outside the selection are never
  listed as left out (FR-023, SC-005).
- `PUT /plan` with a `scope` field returns `400 invalid_request` ("The operations in scope follow
  the API review selection."). Failing explicitly, rather than ignoring the field, surfaces a stale
  client at once (constitution XIX).
- The guided stage states how to include other operations: widen the selection in API review and
  regenerate, or use the quick performance test (FR-023).
- Runs already recorded keep `scope` inside their stored `planSnapshot`. Nothing reads it (the
  report does not), so no migration is needed.

## Q8. The step request preview (FR-008, US1 AS7)

**Decision**:
- A new read-only route on both paths, `GET <base>/plan/steps/:stepId/request`, returns a
  `StepRequestPreview` (data-model.md) derived on demand.
- It is built from the same `BuiltStepRequest` the script renderer uses. The step-request inputs
  `renderScript` computes (workflow substitutions and unique-value tokens) move into one exported
  function, `stepRequestFor(plan, context, auth, stepId)`, which both the renderer and the preview
  call, so the preview is by construction what the script sends.
- Each `{{name}}` reference is classified: an environment value (with `secret` from the builders'
  secret names), a workflow variable with its producing step (guided only), a per-iteration unique
  value (AP-029 D13), or a credential acquired by the plan's token source. Generated values are
  shown as text. Values from environments are never read, so no secret value can appear.
- The preview is not part of `PerformancePlan`. The plan is snapshotted unencrypted into
  `performance_runs.plan_snapshot`, whose design rests on holding no bodies (AP-029 D20); keeping
  the preview out keeps that true and keeps plan responses small at 100+ operations.

**Alternatives rejected**: embedding each step's request in the plan (bodies stored unencrypted in
every run row, and larger plan responses on every edit).

## Q9. The write-operation summary and effect markers (FR-009 to FR-012a, SC-002)

**Decision**: A pure function in `packages/shared-domain/src/performance.ts`,
`summarizeWriteOperations(journeys): WriteOperationSummary`, with a new `WRITE_EFFECT_LABELS`
constant beside it (`POST` "Creates", `PUT` "Replaces", `PATCH` "Updates", `DELETE` "Deletes").
- It counts distinct operation keys, not steps. An operation used by two guided workflow journeys
  is one write operation sent in two places; its entry lists both step ids.
- Per-method counts are in the fixed order POST, PUT, PATCH, DELETE, and each operation is listed
  in plan order.
- The frontend recomputes it from the plan on every render, above the journeys and next to the run
  trigger, and it is never stored (spec Key Entities). A plan with no write operation renders "This
  plan sends only read requests" (FR-012).
- Both places list every write operation by method and path, and neither ever collapses that list.
  The constitution's 2026-09-27 extension of XVII conditions a quick run on every write operation
  being listed on the plan and at the run trigger, and SC-002 requires them to be readable without
  expanding a section. At the trigger the list may sit in a scrollable box of bounded height, but
  every entry stays rendered.
- Shared-domain already holds pure helpers (`toOperationKey`, `aggregateLimitations`), so the rule
  that maps a method to its effect has one definition for the plan screen, the run panel and tests.

**Alternatives rejected**: a server-computed field on the plan. It would enter the fingerprint or
need an exclusion, for a value fully derived from fields already sent.

## Q10. Bulk removal (FR-014, SC-003)

**Decision**: "Remove all <METHOD> operations", offered for every HTTP method present in the
journeys (GET included, as FR-014 says "one HTTP method"), and "Remove all write operations",
compute the new `excludedOperationKeys` on the client from the plan and send one `PUT /plan`. The server validates
the keys as today. No route is added. Each removal is one request, so the plan, the removed list
and the summary update together, and the change is announced through the existing live region.

**Rationale**: The existing contract already replaces the whole list in one call and is validated
atomically (`planUpdate.ts`). A server-side "remove by method" would duplicate that.

## Q11. Lists at scale (FR-024, US5)

**Decision**: One new component, `CountedOperationList`, used for the left-out list, the removed
list, the write-operation lists (with collapsing turned off, per Q9) and the "steps that need an
expected status" list. Each row shows
the `HttpMethodBadge`, the path in monospace, and the reason or a restore action. A list of more
than ten entries renders collapsed as a native `<details>`/`<summary>` whose summary reads
"<n> operations left out" (or removed); ten or fewer render open. Rows in the needs-status list
move focus to the step's expected-status editor.

**Rationale**: `<details>` is keyboard- and screen-reader-accessible without script, and the
count is visible collapsed (constitution XXXII, XXXIII). The name avoids the existing
`OperationList.tsx`, which is API review's selectable list.

## Q12. Recording where a plan came from (FR-013, US3 AS3)

**Decision**:
- `PerformancePlan` gains `source: "guided" | "quick"`, part of the fingerprint. The report's
  provenance section, rendered from `run.planSnapshot`, adds for a quick plan: "Plan built by the
  quick performance test from generated positive scenarios that were not reviewed." Snapshots
  recorded before this feature have no `source` and are read as `guided`.
- `PerformanceRun` gains `planSource`, stored in a new `performance_runs.plan_source` column added
  with the existing idempotent `ensureColumn` helper (`TEXT NOT NULL DEFAULT 'guided'`), so older
  rows are guided runs.
- Each path's `GET /runs` lists only its own source's runs. Run-by-id routes (`GET`, cancel,
  report) accept any run of the session, as today.

**Rationale**: The plan field drives the UI copy and the report; the column lets run lists filter
without parsing snapshots.

## Q13. Where the quick script is kept

**Decision**: In the quick test's own store entry, next to its plan, as the same `GeneratedScript`
type. The guided `scriptStore.ts` stays bound to the workflow id. Replacing the quick test replaces
its script. A run already started keeps running, because `startPerformanceRun` holds the script it
was given and checks the file it wrote (AP-029 D8).

## Q14. Replacing a quick test and coexistence (FR-021, FR-025)

**Decision**:
- `POST /api/quick-performance` returns `409 quick_test_exists` when the session already has a
  quick test, unless `?replaceExisting=true`. The frontend asks for confirmation with the existing
  `ConfirmDialog` and resends with the flag. Runs and reports are kept, because they live in
  `performance_runs`, not in the quick test.
- Replacement is allowed while a quick run is in progress; the run continues and stays visible and
  cancellable by id.
- Nothing in the quick path calls `discardCurrentWorkflow`, `startWorkflowFromUpload` or any
  `workflowStore` function, and nothing in the guided path calls the quick store. A test asserts
  both directions (FR-021).
- "Back to start" returns to the entry chooser and keeps the quick page mounted, like Import & Run
  (`App.tsx` pattern).

## Q15. Specification upload and analysis (FR-002)

**Decision**: The quick upload route uses the existing `upload.single("file")` middleware
(`uploadMiddleware.ts`, 10 MiB) and `reaffirmSession`, then calls the same pipeline functions as
`startWorkflowFromUpload`: `parseYaml`, `validateSpec`, `buildApiModel`. `InvalidYamlError`,
`UnsupportedVersionError` and `LIMIT_FILE_SIZE` go to the centralized handler in `app.ts`, so the
status codes and bodies are the guided upload's. A missing file is `400 invalid_yaml` with the
guided route's message. No quick test is stored unless all three steps succeed.

**Alternatives rejected**: extracting a shared `analyzeSpecification` helper. It would change the
guided upload path for no behavioural gain; the three calls are the reuse unit and are already
called the same way by `POST /api/specifications`.

## Q16. Frontend structure

**Decision**:
- **Entry**: `EntryChooser` gains a third choice, `"quick-performance"`, labelled "Quick performance
  test", with FR-001's one sentence. `App.tsx` gains a third tab and a `QuickPerformancePage`
  mounted behind `hidden` like the other two. As with Import & Run, the tab bar is visible on it.
- **Shared plan screen**: the body of `PerformanceTestingStage` moves into `PerformancePlanScreen`,
  which takes a `PerformanceClient` and the path's framing (title, lead text, scope note).
  `performanceTestingClient.ts` becomes `createPerformanceClient(base)`, with the current named
  exports kept as the guided instance so other imports do not change.
  `PerformanceRunPanel` and `PerformanceReportFrame` take the client as a prop.
- **Guided stage**: renders `PerformancePlanScreen` with the FR-023 note in place of the scope
  toggle.
- **Quick page**: an upload panel (file input with the same accepted types and error messages as
  the guided upload), then `PerformancePlanScreen` with a banner stating that the scenarios were
  generated and not reviewed, and that requests are not chained (spec Edge Cases). With no
  journeys, it shows `EmptyState` ("Nothing can be load-tested"), the left-out list and "Back to
  start".
- **New components**: `WriteOperationSummary` (plan and run-trigger variants), `CountedOperationList`,
  `StepRequestPreview` (an `aria-expanded` disclosure button per step in `JourneyList`, loaded on first open), and a text
  effect marker beside each write step's `HttpMethodBadge`.
- **Clients**: `quickPerformanceClient.ts` for upload and `GET /api/quick-performance`, plus
  `createPerformanceClient("/api/quick-performance")` for the plan and run routes.

Styling uses the existing Tailwind tokens and AP-027 components; the write summary uses the
`warning` semantic tokens and always carries text, never colour alone (FR-010, constitution
XXXIII).

## Q17. Logging (constitution XX)

**Decision**: New metadata-only events:

| Event | Fields |
|---|---|
| `quick_performance_test_created` | operation count, journey count, left-out count, credential-producer count, replaced (boolean) |
| `quick_performance_upload_failed` | error category |

Existing events (`performance_plan_built`, `performance_script_generated`,
`performance_run_started`, …) gain a `planSource` field. No event carries a filename, path, value,
body or specification content.

## Q18. Testing

**Decision**:
- **Unit (backend)**: positive-only generation (no negative category produced); quick scenario ids
  (stable across two generations, rank ordering, uniqueness); credential-producer detection and the
  quick default exclusion, with a login-secured fixture (US1 AS6); scope removal (selection
  honoured, nothing outside it omitted, `scope` rejected); `stepRequestFor` shared by renderer and
  preview; preview value classification and a seeded-secret scan; `summarizeWriteOperations`
  (distinct keys, method order, no writes).
- **Integration (backend, Supertest, fake runner)**: quick upload success and each upload error;
  `409 quick_test_exists` and replacement; two uploads of the same specification with the same
  edits give byte-identical script and template downloads (SC-004); environment access with neither,
  quick only and guided only (SC-006); cross-path environment visibility (US3 AS2); the shared slot
  across functional, uploaded, guided performance and quick runs (US3 AS4); `planSource` on runs
  and in the report; run lists filtered by source; FR-021 isolation in both directions.
- **Frontend (RTL)**: the third entry; upload to plan with no review stage; write summary in plan
  and run panel, markers, bulk removal and restore updating the summary; collapsed lists over ten
  entries; preview never showing a secret; guided stage without the toggle and with the FR-023
  note.
- **Opt-in real k6**: the existing `npm run test:k6-real -w backend` gains one quick-path run
  against the stub target. It is not part of `npm test`.

## Q19. Delivery: version, documentation, governance

**Decision**:
- A feature release: the workspace version goes from 19.5.3 to 19.6.0 in the root and all three
  workspace `package.json` files, with the lockfile updated through npm.
- `docs/USER_MANUAL.md`: a new section for the quick performance test after §4 (Import & Run), and
  §3.11 updated for the removed toggle, the write summary, the preview and the lists.
  `docs/architecture.md`: the k6 section gains the plan-source adapter, the quick store and the
  environment-access gate.
- `specs/031-k6-performance-testing/contracts/performance-api.md` gets a note that `scope` was
  removed and the preview route added by AP-032, pointing to this feature's contract.
  `specs/ROADMAP.md` records AP-032's status.
- No new environment variable and no new dependency.
