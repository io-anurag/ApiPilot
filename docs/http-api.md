# HTTP API

Route reference for the backend. For design, see the [architecture reference](architecture.md).

The backend mounts all routes under `/api`. The browser receives an HTTP-only `sessionId` cookie; workflow endpoints operate on that session and do not take a workflow ID.

## Health and metadata

| Method | Endpoint           | Purpose                                                                                       |
| ------ | ------------------ | --------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`      | Returns `{ status: "ok", timestamp }`.                                                        |
| `GET`  | `/api/version`     | Returns the application version and commit identifier.                                        |
| `GET`  | `/api/ai/status`   | Returns provider readiness, model/accelerator information, and persisted diagnostics.         |
| `POST` | `/api/client-logs` | Accepts size-limited frontend warning/error logs after credential-shaped fields are filtered. |

## Stateless/domain endpoints

| Method | Endpoint                              | Input/output                                                             |
| ------ | ------------------------------------- | ------------------------------------------------------------------------ |
| `POST` | `/api/specifications`                 | Multipart `file`; returns `{ apiModel }`.                                |
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
