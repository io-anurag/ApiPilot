# Research: Guided Workflow Run Stage Status

Every question below was answered from the code at version 19.43.0. No item is left unresolved.

## D1 How an upload is linked to its workflow

- **Decision**: add an optional text field `workflowId` to `POST /api/external-collections`, store it as `sourceWorkflowId` on the uploaded collection, and keep it out of the summary returned to the browser. Validate it against the existing workflow id shape (`wf-<digits>-<digits>`); a malformed value is `400 invalid_request`.
- **Rationale**: the upload handler accepts `name`, `tier`, `requestDelayMs` and two files and ignores everything else, so a field is the smallest addition. The hand-off today only pre-fills a form (`ExternalCollectionUpload` effect on `preload`), so the upload is the first moment the link can be recorded.
- **How "the workflow's own collection" is kept honest**: the form sends the id only when both selected files are the preload's own `File` objects. Choosing a different file, or the same bytes through the file picker, sends nothing, which is the spec's hand-uploaded-copy edge case.
- **Alternatives**: link by comparing the uploaded collection's content with the workflow's artifact on each run (rejected: it breaks when the engineer edits variables or requests, which the spec says must not break the link); a separate "link" endpoint called after upload (rejected: two calls for one fact, and a window where the upload exists unlinked).

## D2 Where Import & Run completion is detected

- **Decision**: the single finalizer `settleRun` in `externalCollections/uploadedCollectionExecutionStore.ts`. When it settles a run as `completed`, it calls the workflow module with the upload id.
- **Facts**: `ExecutionRunStatus` is `in-progress | completed | cancelled`; there is no `failed`. `runUploadedCollectionExecution` never throws and settles an error mid-run as `completed`, with unattempted items appended. So the spec's "ends without being cancelled" maps to `completed`, and a user cancel is `cancelled`, which does nothing.
- **Source of the link**: the start handler already holds the uploaded collection when it launches the run (`api/externalCollections.ts`, where the run's snapshot is built). The handler passes `sourceWorkflowId` to `runUploadedCollectionExecution` as an in-memory argument, which hands it to the completion call. It is not added to the persisted run snapshot, so no stored shape changes, and deleting the upload mid-run cannot lose it.
- **Context**: the run is started fire-and-forget from a request handler inside `runWithSession`, and `settleRun` already relies on `getSessionId()`, so the workflow store is reachable from the same call without new plumbing.
- **Alternatives**: a frontend call to the existing `/execution/finish` endpoint when a run ends (rejected: it only works while Import & Run is open and mounted, and it makes the stage depend on a browser); polling run status from the workflow page (rejected: duplicates server knowledge and adds load).

## D3 Where performance completion is detected, and what "same specification" means

- **Decision**: the `settle` closure in `performance/runPerformanceTest.ts`'s `startPerformanceRun`, for any status other than `in-progress`, inside `runWithSession(sessionId, …)`.
- **Facts**: `PerformanceRunStatus` is `in-progress | completed | cancelled | failed`; the closure is the one place all of them settle. Only request-chain runs can be started today (AP-037; the code comment in `startPerformanceRun` says so). A chain run's snapshot carries `seedSource`: `{kind:"specification", filename}`, `{kind:"workflow", specificationTitle}`, `{kind:"collection", …}` or `null`.
- **Matching**: `workflow` seed equals `workflow.apiModel.info.title`; `specification` seed equals `workflow.specificationFilename`; `collection` and `null` never match. There is no workflow id or content hash in a seed, so identity is by title or file name, which the spec now states.
- **Alternatives**: add a workflow id to the seed (rejected: changes the AP-037 plan contract and its stored plans for a case title matching already covers); hash the specification into the seed (rejected for the same reason, and the workflow does not keep the raw document).

## D4 Stage transitions

- **Decision**: add `not-yet-reached -> complete` for `performanceTesting` only, alongside the existing per-stage extras in `isValidTransition`. `execution` already allows `active -> complete`.
- **Facts**: `updateStage` rejects `from === to`, so completing an already complete stage would throw `InvalidStageTransitionError`; the new module checks the current status first, which makes the operation idempotent (FR-008). `performanceTesting` is enterable once `postmanGeneration` is complete (`isStageEnterable`), and nothing makes it `active` today.
- **Alternatives**: step through `active` (rejected: two updates and a state no screen shows, and it would write `enteredAt` for a stage the user never entered).

## D5 How the hidden page learns of the change

- **Facts**: `TestGenerationWorkflowPage` calls `fetchCurrentWorkflow()` once on mount; App keeps it mounted and only toggles `hidden`. It has no polling and no visibility hook.
- **Decision**: App passes `isVisible` (started and the guided-workflow tab active). On becoming visible the page refetches and replaces its workflow when `updatedAt` differs. While visible, with the browser tab not hidden and Postman Generation complete, it repeats every 5 seconds until Execution is complete or skipped and Performance Testing is complete. Performance Testing is optional, so a workflow that never runs it keeps a slow poll only while its page is on screen; the cost is one small request per 5 seconds. A `null` response or a failed fetch leaves the screen as it is.
- **Rationale**: the run happens in another tab of the same app, so refetch-on-show covers the real flow; the short poll covers a run finishing while the page is visible (a second browser tab, or Performance open in a split view) and meets SC-004 without a push channel (XXVII).
- **Alternatives**: server-sent events or a websocket (rejected: new infrastructure for a status that changes twice per workflow); a global store lifted out of the page (rejected: a larger refactor than the problem needs).

## D6 Failure handling

- **Decision**: the two notification calls run after the run has been settled and are wrapped so an exception is logged (`stage_update_failed`, stage, workflow id, error category) and does not propagate. A run must never fail, or change status, because a stage could not be updated.
- **Rationale**: CLAUDE.md forbids swallowed errors; logging with a category is not swallowing, and the alternative, failing a finished run, would lose real results to a bookkeeping error.
