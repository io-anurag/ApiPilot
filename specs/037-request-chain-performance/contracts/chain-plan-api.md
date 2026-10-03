# Contract: Request-Chain Plan API (`/api/chain-plans`)

**Feature**: AP-037 | **Types**: [data-model.md](../data-model.md)

**Conventions**:
- **Session.** Every route is scoped to the session cookie, as every other API is. A plan, data set
  or run of another session is `404`.
- **Bodies.** Request bodies are JSON unless stated. `PUT /:planId` accepts up to 8 MiB through a
  route-specific `express.json` limit mounted before the global one.
- **Errors.** They use the existing performance envelope, `{ error, message, …details }` with
  `error` the code, mapped in `api/chainPlanHttp.ts`. No `5xx` carries detail (CLAUDE.md §24).
  An unknown plan is `404 chain_plan_not_found`, an unknown data set `404 data_set_not_found` and an
  unknown run `404 run_not_found`.
- **Responses.** They never contain an environment value, a data set value, an extracted value or
  the script text. Only `GET …/script/download` returns script bytes, as today.

## Plans

### `GET /api/chain-plans`
`200 { plans: ChainPlanSummary[] }`, newest `updatedAt` first.
`ChainPlanSummary = { id, name, chainCount, stepCount, dataSetCount, seedSource: SeedingReport["source"]["kind"] | null, updatedAt }`.

### `POST /api/chain-plans`
Body `{ name }`. Creates an empty plan with one chain, "Chain 1", no steps, the smoke load profile
and a think time of 1,000 ms.
- `201 { plan, analysis, script: null }`.
- `422 invalid_plan { field: "name" }`.
- `409 plan_limit_exceeded` (50 plans per session).

### `POST /api/chain-plans/seed`
Body:
```json
{ "name": "Customer lifecycle",
  "source": { "kind": "specification" }
          | { "kind": "workflow" }
          | { "kind": "collection", "collectionId": "…", "orderedRequestIds": ["…"] },
  "environmentId": "…" }
```
- **Optional environment.** `environmentId` is optional. It names where literal credentials found
  while seeding are moved (research R8). Without it they are dropped and listed.
- **Source kinds.**
  - `specification` uses the session's quick test: `404 quick_test_not_found` if none.
  - `workflow` uses the guided workflow: `409 workflow_not_ready` until Postman generation is
    complete, the same gate as today's guided plan.
  - `collection`: `404 uploaded_collection_not_found`, or `400 no_requests_selected`, the codes
    the collection run and AP-036 already use.
  - Any other `source` is `422 invalid_plan { field: "source" }`.
- **Determinism.** Seeding sends nothing and runs no script. The same source and selection always
  produce the same chains and steps (FR-020).
- **Responses.**
  - `201 { plan, analysis, script: null, movedCredentials: MovedCredential[] }`. The seeding report
    is `plan.seedingReport`.
  - `409 plan_limit_exceeded`.

### `GET /api/chain-plans/:planId`
`200 { plan, analysis, script: ScriptStatus | null }`. `analysis` is computed against
`plan.targetEnvironmentId`'s value names. `404 chain_plan_not_found`.

### `PUT /api/chain-plans/:planId`
Body `{ revision, plan: ChainPlanInput }`. `ChainPlanInput` is `ChainPlan` without:
- `id`, `revision`, `fingerprint`, `createdAt`, `updatedAt` and `dataSets`;
- the derived step fields `changed` and `seedDigest`, which the server keeps and recomputes;
- `source`, which cannot be changed. A step whose id is new is `added`. A step whose id existed
  keeps its stored source.

Behaviour:
1. `409 plan_revision_conflict { current: { plan, analysis, script } }` when `revision` is not
   current. Nothing is saved.
2. The plan is validated (data-model "Validation on save"):
   - `422 invalid_plan { field }` for a plan-level field;
   - `422 invalid_step { stepId, field }`, with the reason in `message`;
   - `422 invalid_chain { chainId }`, with the reason in `message`;
   - `422 plan_limit_exceeded { limit }`;
   - `422 header_not_settable { stepId, header }` for `Host` or `Content-Length`.
3. Literal credentials are moved (R8):
   - `422 credential_needs_environment { stepId, location }`;
   - `422 credential_mixed_literal { stepId, location }`;
   - `404 environment_not_found` when the target environment no longer exists. The editor then asks
     for another.
4. The plan is saved with `revision + 1`. `changed` and `fingerprint` are recomputed. A script whose
   fingerprint differs is marked out of date (FR-032).
5. `200 { plan, analysis, script, movedCredentials }`.

Blockers never refuse a save (FR-014): they are returned in `analysis`.

### `POST /api/chain-plans/:planId/duplicate`
Body `{ name }`. Copies the plan, its seeding report and its data sets (re-encrypted copies of the
same bytes). It does not copy runs or the script. Responses: `201 { plan, analysis, script: null }`,
or `409 plan_limit_exceeded`.

### `DELETE /api/chain-plans/:planId`
Deletes the plan, its data sets and its script, and returns `204`. Runs are kept. Responses:
`409 run_in_progress` when a run of this plan is in progress, or `404`.

## Data sets

### `POST /api/chain-plans/:planId/data-sets`
Multipart: `file` (CSV), `name`, `mode` (`row-per-virtual-user` | `row-per-iteration`). Upload limit
5 MiB.
- **Success.** `201 { dataSet: DataSetInfo, plan, analysis, script }`.
- **Refusals.** Nothing is stored on any refusal (FR-041):
  - `413 data_set_too_large`;
  - `409 data_set_limit_exceeded` (5 per plan);
  - `422 data_set_invalid { reason, line? }`.

  `reason` is one of:
  - `not-utf8`, `no-header-row`, `field-count { expected, found }`, `unterminated-quote`;
  - `too-many-rows`, `too-many-columns`, `empty-file`;
  - `invalid-column-name { column }`, `duplicate-column { column }`,
    `column-in-other-data-set { column, dataSetName }`.

### `PUT /api/chain-plans/:planId/data-sets/:dataSetId`
Body `{ name, mode, columns: DataSetColumn[] }`. `columns` must keep the same count and order. It
renames columns and marks them secret. Responses:
- `200 { dataSet, plan, analysis, script }`;
- `422 data_set_invalid` for a bad column name, or a name duplicated within the plan.

### `PUT /api/chain-plans/:planId/data-sets/:dataSetId/file`
Multipart `file`. Replaces the content. Column names may change. Secret marks carry over by column
name. Refusals are the same as for `POST`.

### `DELETE /api/chain-plans/:planId/data-sets/:dataSetId`
`200 { plan, analysis, script }`. The removed data set's columns become unresolved names (Edge
Cases).

### `GET /api/chain-plans/:planId/data-sets/:dataSetId/preview`
`200 DataSetPreview`: the first 5 rows, with secret cells `null` (FR-045). Neither the response nor
the logs ever contain a secret column's value.

## Script

### `POST /api/chain-plans/:planId/script`
- `422 plan_has_blockers { blockers }` when the analysis has blockers.
- `200 { script: ScriptStatus }` otherwise. The script is rendered (contracts/chain-script.md) and
  kept in memory by plan id with the plan's fingerprint.

### `GET /api/chain-plans/:planId/script/download?file=script|environment-template`
These are today's semantics.
- **Template.** The environment template lists every value name with its `APIPILOT_V_<i>` variable,
  its secret flag and an empty value.
- **Data sets.** Data set values are never in either file. A plan with data sets adds the header
  `X-ApiPilot-Note: data-sets-not-included`. The download dialog states that the script reads
  `apipilot-data-<i>.json` files ApiPilot writes only at run time, and that AP-034 refuses a
  script that opens files (research R10, Open item 2).
- **Refusals.** `409 script_not_generated`, or `409 script_out_of_date`.

## Runs

### `GET /api/chain-plans/readiness`
k6 readiness, as `GET …/readiness` today.

### `POST /api/chain-plans/:planId/runs`
Body `{ environmentId }`. This is the only way a chain run starts (constitution XVII). Gates, in
order:
1. A script exists and is current: `409 script_not_generated` or `script_out_of_date`.
2. The analysis has no blockers: `422 plan_has_blockers`.
3. k6 is ready, probed now: `409 k6_unavailable`.
4. The environment exists: `404 environment_not_found`.
5. The session's one execution slot is free, shared with legacy and user-script runs:
   `409 execution_in_progress { runId }`.

On success:
- **Run record.** The run is created with:
  - `planSource: "chain"`;
  - the `ChainRunSnapshot`;
  - an encrypted copy of the plan document (R21);
  - the environment's name, tier and base URL.
- **Data set files.** They are written into the run directory after the script integrity check.
- **Response.** `200 { run: ChainRun }`.

### `GET /api/chain-plans/:planId/runs`
`200 { runs: ChainRunSummary[] }` for this plan, newest first.

### `GET /api/chain-plans/runs/:runId`
`200 { run: ChainRun }` for any chain run of the session, including one whose plan was deleted.

### `POST /api/chain-plans/runs/:runId/cancel`
`202 { run }`, as today, or `409 run_not_in_progress`.

### `GET /api/chain-plans/runs/:runId/report[?download=true]`
`200 text/html`, from `renderChainReport`. `409 run_in_progress` while the run is in progress.

### `POST /api/chain-plans/runs/:runId/restore`
Body `{ into: "plan" | "new-plan", planId?, revision? }`.
- `into: "plan"` replaces the chains, steps and settings of `planId`, which must be the run's plan,
  at `revision`. `409 plan_revision_conflict` applies as for `PUT`.
- `into: "new-plan"` creates `<name> (restored)`.

Data sets are relinked when the same id exists with the same SHA-256. Otherwise they are listed in
`dataSetsNotRestored`. The script is then generated. No run is started, and no environment value is
copied (FR-035).

`200 { plan, analysis, script, dataSetsNotRestored: { name, reason: "deleted" | "content-changed" }[] }`.

**Run again.** It is `POST /api/chain-plans/:planId/runs` with the newest ended run's environment.
The frontend offers it only when:
- the current script SHA-256 equals the run's;
- each data set's SHA-256 equals the run snapshot's;
- the environment exists;
- the slot is free.

It shows the reason otherwise (R21).

## Logging

| Event | Fields |
|---|---|
| `chain_plan_saved` | `planId`, `revision`, `chainCount`, `stepCount`, `movedCredentialCount`, `durationMs` |
| `chain_plan_seeded` | `planId`, `sourceKind`, `stepCount`, `reportItemCount` |
| `chain_data_set_stored` | `planId`, `dataSetId`, `rowCount`, `columnCount`, `sizeBytes` |
| `chain_data_set_refused` | `reason`, `line` |
| `performance_run_started` / `performance_run_settled` | existing, plus `planSource: "chain"` and `setupFailed` (boolean) |

They never contain names, URLs, header names or values, step content, column names, file names or
values (research R27).
