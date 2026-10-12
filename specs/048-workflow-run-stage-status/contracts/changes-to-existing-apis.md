# Contract Changes: Guided Workflow Run Stage Status

Additive only. No endpoint, field or status changes meaning, and no existing client needs to change.

## `POST /api/external-collections` (specs/026)

Multipart form. One new optional text field:

| Field | Required | Meaning |
|-------|----------|---------|
| `workflowId` | no | The guided workflow the upload was made from through Continue to Import & Run. Must match `^wf-\d+-\d+$`. |

- Omitted: behaves exactly as before.
- Present and well formed: stored on the uploaded collection. It is not checked against the session's current workflow at upload time (the tool is local and single-user, so a client could only link a collection to a workflow it already owns); the link is checked against the current workflow only when a run finishes (spec FR-001).
- Present and malformed: `400`, `{ "error": "invalid_request", "message": "workflowId must be a workflow id" }`, and nothing is created.
- The `201` response body is unchanged: `UploadedCollectionSummary` does not include the field.

## `GET /api/test-generation-workflow` and every other workflow response (specs/009)

No shape change. After a qualifying run, `stages.execution.status` or `stages.performanceTesting.status` is `"complete"` with `completedAt` set, and `updatedAt` advances. A client that polls this endpoint sees the change with no new call.

## Import & Run execution endpoints (specs/026) and performance run endpoints (specs/037, 029)

No request or response change. A run settles exactly as before; the stage update happens after it and cannot alter it. If the update fails, the run's response and record are unaffected and a `stage_update_failed` log line is written.

## `POST /api/test-generation-workflow/execution/skip` and `/execution/finish` (specs/009)

Unchanged. They remain API-only. A skipped `execution` stage is not completed by a later run (FR-009).
