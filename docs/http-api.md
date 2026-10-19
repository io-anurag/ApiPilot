# HTTP API

Route reference for the backend. For design, see the [architecture reference](architecture.md).

The backend mounts all routes under `/api`. The browser receives an HTTP-only `sessionId` cookie; workflow endpoints operate on that session and do not take a workflow ID.

## Health and metadata

| Method | Endpoint           | Purpose                                                                                       |
| ------ | ------------------ | --------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`      | Returns `{ status: "ok", timestamp }`.                                                        |
| `GET`  | `/api/version`     | Returns the application version and commit identifier.                                        |
| `GET`  | `/api/ai/status`   | Returns readiness, model, device in use, accelerator verification and diagnostics.            |
| `POST` | `/api/client-logs` | Accepts size-limited frontend warning/error logs after credential-shaped fields are filtered. |

## Stateless/domain endpoints

| Method | Endpoint                              | Input/output                                                             |
| ------ | ------------------------------------- | ------------------------------------------------------------------------ |
| `POST` | `/api/specifications`                 | Multipart `file` (OpenAPI, HAR or API definition); returns `{ apiModel, input }`. |
| `POST` | `/api/test-models`                    | JSON `apiModel`; returns a deterministic `{ testModel }`.                |
| `POST` | `/api/test-models/enhance`            | JSON model/enhancement request; returns AI-enhanced model/progress data. |
| `POST` | `/api/test-models/reviews`            | Applies scenario review updates.                                         |
| `POST` | `/api/test-models/reviews/edit`       | Validates and applies a scenario edit.                                   |
| `POST` | `/api/test-models/reviews/regenerate` | Regenerates a review scenario through the configured provider.           |
| `POST` | `/api/api-models/dependencies`        | Analyzes API relationships and assembles workflow candidates.            |
| `POST` | `/api/test-models/postman-collection` | Generates and validates collection artifacts from approved intent.       |

## Guided workflow endpoints

| Method         | Endpoint                                                    | Purpose                                                                                                  |
| -------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET` / `POST` | `/api/test-generation-workflow`                             | Read the current session workflow, poll progress with `?progressOnly=true`, or upload/start a workflow.  |
| `DELETE`       | `/api/test-generation-workflow`                             | Discard the current session workflow; `409 ai_enhancement_running` while AI enhancement runs.            |
| `POST`         | `/api/test-generation-workflow/api-review/continue`         | Complete API review, optionally with `{ selectedOperationKeys }`; absent or empty keeps every operation. |
| `POST`         | `/api/test-generation-workflow/deterministic-generation`    | Run deterministic scenario generation.                                                                   |
| `POST`         | `/api/test-generation-workflow/ai-enhancement`              | Start optional AI enhancement.                                                                           |
| `POST`         | `/api/test-generation-workflow/ai-enhancement/cancel`       | Request cancellation at a batch boundary.                                                                |
| `POST`         | `/api/test-generation-workflow/ai-enhancement/retry-batch`  | Retry one failed batch using `{ batchIndex }`.                                                           |
| `POST`         | `/api/test-generation-workflow/scenario-review/decisions`   | Apply scenario decisions using an `updates` array.                                                       |
| `POST`         | `/api/test-generation-workflow/scenario-review/edit`        | Edit a scenario using `scenarioId`, `revision`, and `edit`.                                              |
| `POST`         | `/api/test-generation-workflow/scenario-review/regenerate`  | Regenerate one scenario.                                                                                 |
| `POST`         | `/api/test-generation-workflow/scenario-review/finalize`    | Finalize scenario review.                                                                                |
| `POST`         | `/api/test-generation-workflow/workflow-review/decisions`   | Apply workflow approval/rejection decisions.                                                             |
| `POST`         | `/api/test-generation-workflow/workflow-review/continue`    | Complete workflow review.                                                                                |
| `POST`         | `/api/test-generation-workflow/postman-generation`          | Generate approved Postman artifacts; accepts export options.                                             |
| `GET` / `POST` | `/api/test-generation-workflow/environments`                | List or create session environments.                                                                     |
| `PUT`          | `/api/test-generation-workflow/environments/:environmentId` | Update an environment.                                                                                   |
| `POST`         | `/api/test-generation-workflow/execution/start`             | Start an asynchronous run using `{ environmentId, confirmed? }`.                                         |
| `POST`         | `/api/test-generation-workflow/execution/cancel`            | Request cancellation of the active run.                                                                  |
| `GET`          | `/api/test-generation-workflow/execution/runs`              | List session run summaries.                                                                              |
| `GET`          | `/api/test-generation-workflow/execution/runs/:runId`       | Retrieve one run and its request results.                                                                |

The environment and execution endpoints above are retained as an API-only path (`specs/018` Clarifications 2026-09-23); the current UI runs generated collections through the external collection endpoints below after the hand-off.

## Input formats and upload errors

`POST /api/specifications` and the upload at `POST /api/test-generation-workflow` take the same multipart `file` field and
decide what it is from its content, never its name: OpenAPI 3.x (YAML or JSON), a HAR capture (JSON with a `log` object), an
ApiPilot API definition (JSON with `"format": "apipilot.api-definition"`), or a Postman collection (recognized and
redirected, never imported). A JSON file must match exactly one of these. The accepted formats are described in the
[user manual](USER_MANUAL.md#31-upload) and [API definition format](api-definition-format.md).

**Response.** A successful upload returns the normalized model and the detected format:

- `POST /api/specifications` returns `{ apiModel, input }`.
- `POST /api/test-generation-workflow` returns `{ workflow }`, where `workflow.input` is the same descriptor.
- `input` is `{ format, label, filename }` with `format` one of `openapi-yaml`, `openapi-json`, `har`, `api-definition`. It is
  also present on every later read of the workflow. `filename` is shown, never used to decide anything.

The model is the same `ApiModel` for every format; the following fields are additive and absent for an OpenAPI upload:

| Where | Field | Meaning |
|---|---|---|
| `ApiModel` | `importReport` | HAR only: `counts` (`total`, `imported`, `excluded`, `malformed`, `operations`; `imported + excluded + malformed = total`), `exclusions` (by reason, with up to 20 redacted samples each), `malformedEntries`, `origins`, `normalization`, `credentialUrlCount` and `credentialUrlEntries` (position and host, never the user name or password), `limitsApplied`, and `harVersion` and `creator` when present. |
| `ApiModel` | `dependencyHints` | HAR and definition: proposed producer and consumer fields, each `observed` (with `matchCount`) or `declared` (with `verified`). |
| `ApiModel` | `declaredBaseUrl` | Definition only. Informational; never used as an execution target. |
| `ApiOperation` | `provenance`, `observed`, `description` | Origin of the operation (`declared`, `observed`), what the capture showed for it, and a declared description. |
| `Parameter`, `RequestBody`, `Response` | `provenance`, `requiredUnknown`, `examples`, `bodyUnavailable` | Origin per fact, requiredness that is not a fact, declared or observed examples (credentials replaced), and why a body could not be used. |
| `TestScenario` | `evidence` | Origin, observation count, derivation (`observed-example`, `inference-derived`, `declared-example`) and a one-sentence summary. |
| `Assertion` | `basis` | `declared` or `observed`; absent means documented. |
| `TestGenerationWorkflow` | `generationNotes` | Operations that produced no scenario, each with the reason. |

`provenance.origin` is one of `documented` (absent for OpenAPI), `declared`, `observed`, `inferred`; observed and inferred
facts carry `observationCount` and `confidence` (`high`, `medium`, `low`). No field of the model, the report, a log line or an
error ever holds a credential value.

**Errors.** Every rejection is a JSON object with an `error` code and a `message`; the message never echoes content from
the uploaded document beyond field names, a position or a count. Nothing is imported and an existing workflow is untouched.

| Status | `error` | Cause | Extra fields |
|---|---|---|---|
| 400 | `invalid_yaml` | Non-JSON content that is not valid YAML. | |
| 400 | `unsupported_version` | OpenAPI that is not 3.x (including Swagger 2.0 as JSON). | |
| 400 | `invalid_json` | Content that starts like JSON but does not parse. | |
| 400 | `unrecognized_input_format` | A JSON object with no format marker. | |
| 400 | `ambiguous_input_format` | A JSON object with markers of more than one format. | |
| 400 | `postman_collection_detected` | A Postman collection. | `redirectTo: "import-run-collection"` |
| 400 | `invalid_har` | A `log` object with no usable `entries`. | |
| 400 | `no_operations_derived` | A HAR from which no operation can be derived. | `report` (`counts`, `exclusions`, `malformedEntries`) |
| 400 | `invalid_definition` | A definition that breaks version 1. | `problems`: every violation as `"<JSON Pointer>: <message>"` (at most 100, then a line with the number left out) |
| 413 | `input_limit_exceeded` | A configurable or fixed limit below. | `limit`, `maximum` |
| 413 | `file_too_large` | Over the 10 MB upload limit. | |

**Limits.** `INPUT_HAR_MAX_ENTRIES`, `INPUT_MAX_BODY_BYTES` and `INPUT_MAX_JSON_DEPTH` are read at start-up and can be set in
the environment ([Configuration](configuration.md)); a non-positive or non-numeric value stops start-up with a message
naming the variable. The others are fixed.

| Limit | Value | Setting | When exceeded |
|---|---|---|---|
| Upload size | 10 MB | fixed | `413 file_too_large` |
| Entries in a HAR | 5,000 | `INPUT_HAR_MAX_ENTRIES` | `413 input_limit_exceeded` |
| JSON nesting depth | 128 | `INPUT_MAX_JSON_DEPTH` | `413 input_limit_exceeded` |
| Size of one analyzed body | 1 MiB | `INPUT_MAX_BODY_BYTES` | Body skipped, listed in `importReport.limitsApplied` |
| Operations derived from one capture | 2,000 | fixed | `413 input_limit_exceeded` |
| Nesting depth inside an embedded body | 32 | fixed | Body skipped, listed in `importReport.limitsApplied` |
| Request examples kept per operation | 5 | fixed | Counted in `droppedExampleCount` |
| Values listed for a path parameter | 10 | fixed | The rest are counted in `distinctValues` |
| Analysis issues listed per kind | 200 | fixed | One summary issue for the rest |
| Operations in a definition | 2,000 | fixed | `invalid_definition` |
| Problems listed for a definition | 100 | fixed | A final line gives the number left out |

## Legacy performance run endpoints

AP-037 phase two (19.19.0) retired the guided, quick and collection performance plans, with their plan, script and run-start routes. Runs recorded from them stay readable, read only, under their old bases `/api/test-generation-workflow/performance`, `/api/quick-performance` and `/api/collection-performance` (`specs/037-request-chain-performance/contracts/changes-to-existing-apis.md`):

| Method | Endpoint                | Purpose                                                                             |
| ------ | ----------------------- | ----------------------------------------------------------------------------------- |
| `GET`  | `/runs`, `/runs/:runId` | List that source's runs, or read any run of the session with its result.            |
| `POST` | `/runs/:runId/cancel`   | Stop a run still settling (`202`).                                                  |
| `GET`  | `/runs/:runId/report`   | The report exactly as rendered before; `?download=true` adds `Content-Disposition`. |

The quick test keeps its upload, now a seeding source for request-chain plans, under `/api/quick-performance`:

| Method | Endpoint | Purpose                                                                                            |
| ------ | -------- | -------------------------------------------------------------------------------------------------- |
| `POST` | `/`      | Upload a specification (multipart `file`); `409 quick_test_exists` unless `?replaceExisting=true`. |
| `GET`  | `/`      | The session's quick test: its specification summary.                                               |

## Run k6 Script endpoints

Under `/api/user-scripts` (`specs/034-run-user-k6-script/contracts/user-scripts-api.md`). No specification or guided workflow is required. A run starts only on `POST /:id/runs`, after the script's exact content was confirmed.

| Method            | Endpoint                                | Purpose                                                                                                       |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET`             | `/`                                     | The session's scripts.                                                                                        |
| `POST`            | `/upload?name=`                         | Upload a script as `application/octet-stream` (at most 1 MiB); `422 script_refused` with each reason by line. |
| `POST`            | `/`                                     | Create a script from the editor (`{ name, content }`).                                                        |
| `GET`             | `/example`                              | ApiPilot's fixed starter script.                                                                              |
| `GET`             | `/:id`, `/:id/content`, `/:id/download` | The script with its check result, settings and confirmation; its text; its exact bytes.                       |
| `PUT`             | `/:id/content`                          | A new version (JSON from the editor, or octet-stream with `?baseSha256=`); clears the confirmation.           |
| `PATCH`, `DELETE` | `/:id`                                  | Rename (keeps the confirmation); delete (runs are kept).                                                      |
| `POST`            | `/:id/confirmation`                     | Confirm `{ sha256 }`, the content shown.                                                                      |
| `PUT`             | `/:id/settings`                         | Mapping, load choice and thresholds (names only).                                                             |
| `GET`             | `/:id/values?environmentId=`            | Which mapped values the environment has, never the values.                                                    |
| `GET`             | `/readiness`                            | k6 readiness.                                                                                                 |
| `POST`            | `/:id/runs`                             | Start a run on `{ environmentId, scriptSha256 }`.                                                             |
| `POST`            | `/:id/debug-runs`                       | A one-shot Debug run on `{ environmentId, scriptSha256 }` (AP-053): one virtual user, one iteration, answers with every request and response, masked, when it ends; abort the request to cancel. Nothing is stored. `409` as a run, plus `debug_run_in_progress`. |
| `GET`, `DELETE`   | `/:id/debug-runs/:debugRunId[/values/:valueId]` | Reveal one masked value (`404 debug_value_not_found` for an environment value, an expired or discarded one); discard what the server held (`204`). |
| `GET`             | `/runs[?scriptId=]`, `/runs/:runId`     | Runs, or one run with progress, result and, for a failed start, k6's message.                                 |
| `POST`            | `/runs/:runId/cancel`                   | Stop a run in progress (`202`).                                                                               |
| `GET`             | `/runs/:runId/report`                   | The self-contained HTML report; `?download=true` adds `Content-Disposition`.                                  |

## Request-chain plan endpoints

Under `/api/chain-plans` (`specs/037-request-chain-performance/contracts/chain-plan-api.md`). Plans are saved whole with an optimistic revision; a run starts only on `POST /:planId/runs` and shares the session's one execution slot.

| Method                 | Endpoint                                                     | Purpose                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`, `POST`          | `/`                                                          | The session's plans; create an empty plan (`{ name }`).                                                                                    |
| `POST`                 | `/seed`                                                      | Seed a plan once from `specification`, `workflow` or `collection` (with the requests in run order).                                        |
| `GET`, `PUT`, `DELETE` | `/:planId`                                                   | The plan with its analysis and script status; save `{ revision, plan }` (`409 plan_revision_conflict` when stale); delete (runs are kept). |
| `POST`                 | `/:planId/duplicate`                                         | Copy the plan and its data sets.                                                                                                           |
| `POST`                 | `/:planId/data-sets`                                         | Add a CSV data set (multipart, at most 5 MiB); `422 data_set_invalid` with the reason and line.                                            |
| `PUT`, `DELETE`        | `/:planId/data-sets/:id`, `/:id/file`                        | Rename, change the mode or mark columns secret; replace the file; remove.                                                                  |
| `GET`                  | `/:planId/data-sets/:id/preview`                             | The first rows, secret cells hidden.                                                                                                       |
| `POST`                 | `/:planId/script`                                            | Generate the script (`422 plan_has_blockers`).                                                                                             |
| `GET`                  | `/:planId/script/download?file=script\|environment-template` | Download either file.                                                                                                                      |
| `GET`                  | `/readiness`                                                 | k6 readiness.                                                                                                                              |
| `POST`, `GET`          | `/:planId/runs`                                              | Start a run on `{ environmentId }`; list this plan's runs.                                                                                 |
| `GET`                  | `/runs/:runId`                                               | One chain run with progress and result.                                                                                                    |
| `POST`                 | `/runs/:runId/cancel`, `/runs/:runId/restore`                | Stop a run in progress (`202`); restore its chains and steps into the plan or a new plan.                                                  |
| `GET`                  | `/runs/:runId/report`                                        | The self-contained HTML report; `?download=true` adds `Content-Disposition`.                                                               |

## Security Lab endpoints

Under `/api/security-lab` (`specs/057-security-lab-v1/contracts/security-lab-api.md`). Routes are scoped by the session cookie and by an owner cookie, `apipilotOwner` (`HttpOnly`, `SameSite=Lax`, 400 days), which only these routes issue or read; no id appears in a URL, header or body. Lists are paginated (`page`, `pageSize`, at most 100) and return `total`. Routes marked **M** need a loaded specification and answer `409 no_specification` without one; every other route reads retained work and works without it, and scenario replies then carry `specificationNotLoaded: true`. A run starts only on `POST /runs`, after a preview, and only with the confirmation the preview calls for.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/categories` | The registry: the eleven categories with support level, whether each can be generated or run, prerequisites and the taxonomy edition with each id and its relation (`primary` or `related`). |
| `GET` | `/analysis` **M** | The specification analysis: effective security per operation and the classified observations. Deterministic; covers every operation. |
| `GET`, `PUT` | `/settings` | The sensitive field names you configured (at most 100, names only, retained). |
| `GET` | `/scope` **M** | The default generation scope: `{ mode: "selection" \| "all", selectedCount, totalCount }`. |
| `POST` | `/scenarios/generate` **M** | Deterministic generation. Body `{ scope?, categories?, profileId? }`; `scope` defaults to the guided workflow's selection. Returns the applied scope, counts created, kept and versioned, rejected and capped scenarios and notes. `409 retention_limit_reached` at the cap. |
| `POST` | `/scenarios/suggest` **M** | Optional AI suggestions, stored as drafts. Body `{ operationKeys?, categories? }`; returns `{ accepted, rejected, model, ignored }`. `503 ai_unavailable` with the readiness reason when no model is usable. |
| `GET` | `/scenarios`, `/scenarios/ids`, `/scenarios/:id` | List with filters (`q`, `operation`, `category`, `severity`, `reviewState`, `executionStatus`, `flag`, `profileId`); the ids and current versions a filter matches (capped at 5,000); one scenario with its versions, approvals, flags and prerequisites. |
| `PATCH` | `/scenarios/:id` **M** | Edit with `{ expectedVersion, changes, note? }`. `409 stale_version`, `409 scenario_rejected`, `422 scenario_invalid` with each violation as a JSON Pointer. |
| `POST` | `/scenarios/review` | `{ action, items: [{ id, version }], reason?, destructiveConfirmations? }`. Items are explicit; a filter is never accepted. Replies `{ applied, refused }` with a reason code per item. Submit, approve and reopen need the specification. |
| `GET`, `POST` | `/profiles` | List with `valid` and `problems`; create (`201`). `422 profile_invalid` carries each violation by code. |
| `PUT`, `DELETE` | `/profiles/:id` | Replace; delete (`204`, `409 profile_in_use` while a run uses it). |
| `POST` | `/profiles/:id/check` | Re-validate and resolve the base URL under the destination policy **without sending a request**. |
| `PUT`, `GET` | `/profiles/:id/credentials` | Write-only `{ identity, scheme, kind, value }` (`204`; an empty value clears it). `GET` returns which credentials are set, never a value. |
| `GET`, `POST`, `PUT` | `/environments`, `/environments/:environmentId` | The session's target environments as `{ id, name, tier, baseUrl }`, never variable values. |
| `POST` | `/runs/preview` **M** | Validates what a run would and sends nothing. Returns the summary and a `planDigest`. `422 run_plan_invalid`. |
| `POST` | `/runs` **M** | Start (`202`). Body repeats the preview's input and adds `planDigest` and `confirmation { targetName, targetBaseUrl, authorizationAttested, destructiveScenarioIds }`. `409 plan_changed`, `409 confirmation_required`, `409 execution_in_progress`, `422 run_plan_invalid`. |
| `GET` | `/runs`, `/runs/:id` | Summaries; one run with outcomes, observed summaries and cleanup results. `?evidence=true&scenarioId=` adds the redacted evidence, `available: false` once the session has expired. |
| `POST` | `/runs/:id/cancel` | Request cancellation (`202`); `409 no_run_in_progress`. |
| `GET`, `PATCH` | `/findings`, `/findings/:id` | List (filters `severity`, `status`, `category`, `operation`, `runId`, `assessment`, `unreviewed`) and read one finding. `PATCH` takes `{ status?, severity?, acknowledgeOccurrences?, note }`; a note is required for a status or severity change (`422 invalid_finding_update`). Findings are created only by a run, never by a route. |
| `GET` | `/findings/:id/occurrences/:resultId/evidence` | The redacted evidence of one occurrence, `{ available, records }`. |
| `GET` | `/overview` | Counts that each open a matching list, scope, latest run and untested high-priority operations. |
| `GET` | `/report?format=html\|json&runIds=` | The assessment as an attachment (`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`). `409 nothing_to_report`. Needs no specification. |
| `GET` | `/export/postman` **M** | The approved scenarios as `{ collection, environment, readme, validation, limitations, summary, excluded }`. Optional `baseUrl` and `collectionName`. `409 no_approved_scenarios`, `422 export_failed`. |
| `GET`, `DELETE` | `/data`, `/assessments/:assessmentKey`, `/data` | What is retained and what goes with the session; delete one assessment (body `{ confirm: "<label>" }`) or everything (`{ confirm: "DELETE ALL" }`), `204`. `409 execution_in_progress`, `422 confirmation_mismatch`, `404 assessment_not_found`. |

Errors are `{ error, message, ...details }` with no stack, path or secret. The codes are `no_specification`, `invalid_request`, `category_not_generatable`, `scenario_not_found`, `stale_version`, `scenario_invalid`, `scenario_rejected`, `invalid_transition`, `destructive_confirmation_required`, `not_executable_content`, `profile_invalid`, `profile_in_use`, `run_plan_invalid`, `plan_changed`, `confirmation_required`, `execution_in_progress`, `no_run_in_progress`, `run_not_found`, `finding_not_found`, `invalid_finding_update`, `ai_unavailable`, `nothing_to_report`, `no_approved_scenarios`, `export_failed`, `retention_limit_reached`, `assessment_not_found` and `confirmation_mismatch`; an unexpected failure is a safe `500 internal_server_error`. While a Security Lab run is in progress, `execution/start` and every other run-start route answer `409 execution_in_progress`, and the reverse.

## External collection endpoints

Mounted independently of the guided-workflow routes above — no active workflow is required for any endpoint below.

| Method   | Endpoint                                                                                    | Purpose                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/external-collections`                                                                 | Multipart `name`, `tier`, `collection` file, `environment` file; returns the created summary.                                                                                                                                                                                                                                                 |
| `GET`    | `/api/external-collections`                                                                 | Lists the session's uploaded collections (never `variableValues` or the raw collection body).                                                                                                                                                                                                                                                 |
| `DELETE` | `/api/external-collections/:id`                                                             | Removes an uploaded collection; past runs against it are unaffected.                                                                                                                                                                                                                                                                          |
| `GET`    | `/api/external-collections/:id/collection`                                                  | Returns the collection/variable editor's read model: folder/request tree, per-request raw and resolved form, and variable bindings.                                                                                                                                                                                                           |
| `PUT`    | `/api/external-collections/:id/variables`                                                   | Saves variable value overrides into the environment's stored values.                                                                                                                                                                                                                                                                          |
| `PUT`    | `/api/external-collections/:id/requests/:requestId`                                         | Saves a persisted override of one request's method/URL/headers/body/test script.                                                                                                                                                                                                                                                              |
| `POST`   | `/api/external-collections/:id/items`                                                       | Adds a new request or folder.                                                                                                                                                                                                                                                                                                                 |
| `DELETE` | `/api/external-collections/:id/items/:itemId`                                               | Deletes a request or folder (and everything nested within a deleted folder).                                                                                                                                                                                                                                                                  |
| `PUT`    | `/api/external-collections/:id/items/:itemId/rename`                                        | Renames a request or folder.                                                                                                                                                                                                                                                                                                                  |
| `PUT`    | `/api/external-collections/:id/containers/:containerId/order`                               | Reorders requests/folders within their containing folder or the collection root.                                                                                                                                                                                                                                                              |
| `POST`   | `/api/external-collections/:id/items/:itemId/move`                                          | Moves a request or folder into another folder or the collection root, carrying its inherited auth and the scripts of the folders it leaves.                                                                                                                                                                                                   |
| `POST`   | `/api/external-collections/:id/execution/start`                                             | Starts a run using `{ confirmed?, selectedRequestIds? }`; two independent confirmation gates may apply in sequence, and an optional request-ID subset runs only those requests. Unresolved variables do not refuse the run.                                                                                                                   |
| `POST`   | `/api/external-collections/:id/execution/cancel`                                            | Requests cancellation of the active run.                                                                                                                                                                                                                                                                                                      |
| `GET`    | `/api/external-collections/:id/execution/runs`                                              | Lists this collection's run summaries.                                                                                                                                                                                                                                                                                                        |
| `GET`    | `/api/external-collections/:id/execution/runs/:runId`                                       | Retrieves one run and its per-request results, independent of the collection's own lifecycle.                                                                                                                                                                                                                                                 |
| `POST`   | `/api/external-collections/:id/execution/runs/:runId/results/:resultIndex/failure-analysis` | Classifies one failed result by rule and asks the configured AI provider to explain it. Returns `200` with `analyzed` (stored; its explanation may be unavailable) or `kept-previous` (the new explanation failed, so the stored one was kept); a result that did not fail, or an analysis already in progress in the session, returns `409`. |
| `GET`    | `/api/external-collections/:id/execution/runs/:runId/failure-analyses`                      | Lists the run's stored analyses, ordered by result index.                                                                                                                                                                                                                                                                                     |
| `GET`    | `/api/failure-analysis/in-progress`                                                         | Returns the session's analysis in progress and its phase, or `204` when there is none.                                                                                                                                                                                                                                                        |

Common contract failures use JSON such as `{ error, message }`. Invalid uploads return `400`; oversized uploads return `413`; stage conflicts, confirmation requirements, duplicate resources, and active-run conflicts return `409`; missing resources return `404`; unexpected failures return a safe `500` without stack traces or raw internal details.

The authoritative request and response shapes are the TypeScript contracts in `packages/shared-domain/src/` and the feature contracts under `specs/*/contracts/`.
