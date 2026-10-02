# Contract: Changes to Existing APIs and Modules (AP-036)

`R` references point to [research.md](../research.md).

## Shared performance routes (`api/performanceRoutes.ts`)

- **`PlanHandle.context`** is replaced by `PlanHandle.engine: PlanEngine` (R2). The guided and quick
  handles pass `openApiEngine(context)`, so their HTTP behaviour is unchanged. The six call sites move
  to the engine. All existing route tests pass unchanged.
- **`PerformancePlanSource.kind`** accepts `"collection"`.

## AP-029 generated script (`performance/k6/renderScript.ts`)

- **`renderScript(plan, context)`** keeps its signature and output. It becomes
  `renderScriptFrom(plan, scriptInputsFromContext(plan, context))` (R2).
- **The runtime changes once for every plan (R10):**
  - a `DYNAMIC` constant and its lookup in `resolve`;
  - token sources with `captures` and an optional `expected`;
  - `tokenSchemes` on steps;
  - `bodyKind: "form"`;
  - the `setup-failed` outcome on `apipilot_token_refresh`.
- **Golden fixtures** `golden/script.js` and `golden/user-journeys-script.js` are regenerated. The
  review checks that the diff holds only those changes.
- **The AP-034 script check** still passes for every golden.
- **Effect on Run again.** A run recorded before the upgrade cannot use **Run again** until its script
  is regenerated, because the bytes differ. That is AP-029's existing rule.

## AP-029 run start (`performance/runPerformanceTest.ts`)

`valueEnvironment` also sets `APIPILOT_RUN_TAG`, the first 6 hex characters of SHA-256 of the run
id, for every run. Scripts that do not read it ignore it (R9).

## AP-029 plan assembly

- **`finalizePlan` and `planFingerprint`** include `collection` (minus `review` and
  `collectionState`) when present. Plans without it keep their fingerprint (R19).
- **`planSnapshotForRun`** empties `collection.findings[].excerpt` (R16).

## AP-029 report (`performance/report/`)

- **`aggregate.ts`** reads `apipilot_token_refresh{outcome:"setup-failed"}` into
  `TokenRefreshResult.setupFailed`.
- **`renderHtmlReport.ts`:**
  - the collection provenance statement;
  - collection step labels;
  - binding and capture origins;
  - the credential-request section;
  - the "from the collection's test" status label (R16).
- **Report findings** (`findings.ts`) are unchanged. The ruleset version is unchanged.

## Persistence (`performanceRunRepository.ts`)

`toSummary` maps `plan_source = 'collection'` to `"collection"`, and anything else unknown still to
`"guided"`. There is no schema change.

## AP-026 stored collections (`externalCollections/`)

- **`POSTMAN_DYNAMIC_VARIABLES`** is exported through `isPostmanDynamicVariable`, unchanged, and is
  read by R4.
- **No route changes.** The collection is only read.

## Environments (`api/testGenerationWorkflow.ts`)

`requireEnvironmentAccess` also accepts `hasCollectionPlan()` (R17).

## Frontend (`frontend/src/`)

- **`App.tsx`:** a fifth lazy tab, `collection-performance` ("Collection Performance Test"), mounted
  when first opened. A new `onSetUpPerformanceTest(collectionId, orderedRequestIds)` callback runs
  from `ExternalCollectionsPage`.
- **`components/ExternalCollectionRunPanel.tsx`:** a **Set up a performance test** button beside
  **Start run**. It is enabled when at least one request is selected. It passes the ordered selected
  ids.
- **`services/collectionPerformanceClient.ts`** (new): `createPerformanceClient("/api/collection-performance")`
  plus `buildCollectionTest`, `fetchCollectionTest`, `rebuildCollectionTest` and
  `createEnvironmentFromCollection`.
- **`pages/CollectionPerformancePage.tsx`** (new): composes `PerformancePlanScreen`, and asks before
  replacing an existing plan.
- **`components/performance/collection/`** (new): `ConversionReview`, `CredentialRequestList`,
  `CollectionStepSource`, and `NewEnvironmentFromCollection` (R20).
- **`PerformancePlanScreen.tsx`:**
  - for `plan.source === "collection"`, it renders the collection views: Removed and Left out keyed
    by item id, the review and out-of-date pending items, and the credential list above the journey;
  - it hides AP-033's editors and AP-035's journey composer;
  - it shows capture adding for FR-019.
- **`performanceViewModel.ts` and the specification-worded labels:** a source-aware variant ("from the
  collection's test", "Not documented in a specification").

## Implementation notes (2026-10-02)

- **`PlanHandle.gate?(action)`.** Besides `engine`, a handle may have a gate that `POST /script`
  and `POST /runs` call first. The collection source uses it for `collection_plan_out_of_date` and
  `conversion_not_reviewed`, so those refusals come before the plan's own checks. The guided and
  quick handles have none.
- **k6's environment.** `buildChildEnv` (`k6/runner.ts`) passes `APIPILOT_RUN_TAG` to k6 only when
  it is 6 lowercase hex characters, beside the `APIPILOT_V_<n>` values.
- **Setup data.** k6 hands setup data to virtual users with `undefined` written as `null`. The
  runtime therefore checks a token source's values with `Array.isArray`, and the test sandbox
  (`k6Sandbox.ts`) serialises setup data the same way. A real-k6 run found this; the goldens'
  diff for it is two lines.
- **Environments gate.** `requireEnvironmentAccess` accepts `hasCollectionPlan()` from User Story
  1 on, because a run needs a target environment.
