# Contract: User Scripts API (AP-034)

Base path: `/api/user-scripts`.
- **Session.** Every route is scoped to the session cookie (existing `sessionMiddleware`).
- **Errors.** Errors use the existing `{ error, message, ...extra }` body through
  `api/performanceHttp.ts`'s `fail()`.
- **Routes stay thin.** Each route delegates to `backend/src/performance/userScript/` (see plan.md).
- **Types** are those of [data-model.md](../data-model.md).
- **What responses never contain:** environment values, k6's console output, raw `url` or `name`
  tags, or script content. The one exception is the two content routes.

## Scripts

### `GET /api/user-scripts`
- **200:** `{ scripts: UserScriptSummary[] }`, newest `updatedAt` first, ties broken by id.

### `POST /api/user-scripts/upload?name=<name>`
- **Request:** `Content-Type: application/octet-stream`, with the file's bytes as the body
  (`express.raw`, limit 1 MiB). `name` is optional; it defaults to "Uploaded script" and is
  trimmed and limited to 100 characters.
- **201:** `{ script: UserScript }`. The script needs confirmation.
- **422 `script_refused`:** `{ problems: ScriptProblem[] }`. Nothing is stored (FR-004).
- **413 `payload_too_large`:** the body is over 1 MiB (existing mapping).
- **415 `unsupported_media_type`:** the content type is not `application/octet-stream`.

### `POST /api/user-scripts`
Creates a script from the editor.
- **Request:** JSON `{ name: string, content: string }`. `content` is at most 1 MiB once encoded
  as UTF-8.
- **201 / 422 / 413:** as for upload.

### `GET /api/user-scripts/example`
- **200 `text/plain; charset=utf-8`:** ApiPilot's fixed starter script. It sends one request to
  `${__ENV.BASE_URL}/`, names the request, makes one check, and holds no credentials (FR-010).

### `GET /api/user-scripts/:id`
- **200:** `{ script: UserScript }`.
- **404 `script_not_found`.**

### `GET /api/user-scripts/:id/content`
- **200 `text/plain; charset=utf-8`:** the stored bytes. Served with
  `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

### `GET /api/user-scripts/:id/download`
- **200 `application/javascript`:** the stored bytes exactly, with
  `Content-Disposition: attachment; filename="<sanitised name>.js"` (FR-010).

### `PUT /api/user-scripts/:id/content`
Saves a new version, either from the editor or as a replacement upload (FR-016).
- **Request, either:**
  - JSON `{ content: string, baseSha256: string }` (editor save); or
  - `Content-Type: application/octet-stream` with `?baseSha256=<sha>` and the file's bytes as the
    body (replacement upload, `express.raw`, limit 1 MiB).
- **415 `unsupported_media_type`:** any other content type.
- **200:** `{ script: UserScript }`. A new SHA-256, and the confirmation is cleared (FR-016).
- **409 `script_changed`:** `baseSha256` is not the current SHA-256. Nothing is stored.
- **422 `script_refused`:** `{ problems }`. The stored version is unchanged (FR-011).

### `PATCH /api/user-scripts/:id`
- **Request:** JSON `{ name: string }`.
- **200:** `{ script }`. The confirmation is kept.

### `DELETE /api/user-scripts/:id`
- **204.** The script, its confirmation and its settings are deleted. Its runs are kept.
- **409 `run_in_progress`:** `{ runId }`.

### `POST /api/user-scripts/:id/confirmation`
- **Request:** JSON `{ sha256: string }`, the SHA-256 the confirmation dialog showed.
- **200:** `{ script }`, with `confirmation` set (FR-013 to FR-015).
- **409 `script_changed`:** the SHA-256 does not match the current content.

### `PUT /api/user-scripts/:id/settings`
- **Request:** JSON `{ mapping, removedNames, load, thresholds }`.
- **200:** `{ script }`. The confirmation is kept (FR-028).
- **400 `invalid_mapping_name`:** `{ name, reason: MappingNameRefusal }`.
- **400 `invalid_settings`:** the shape, limits or stages are invalid.
- A profile load is accepted even without a default function, so that it can be saved. The run
  trigger refuses it (FR-027).

### `GET /api/user-scripts/:id/values?environmentId=<id>`
- **200:** `{ values: MappedValueStatus[], baseUrl: string }`.
- **404 `environment_not_found`.**

## Runs

### `GET /api/user-scripts/readiness[?recheck=true]`
- **200:** `{ readiness: K6Readiness }`, from the existing probe.

### `POST /api/user-scripts/:id/runs`
- **Request:** JSON `{ environmentId: string, scriptSha256: string }`.
- **Checks,** in order, first failure returned (research R17):
  1. 404 `script_not_found`;
  2. 422 `script_refused` `{ problems }`: the stored content no longer passes the current check;
  3. 409 `script_not_confirmed`, or 409 `script_changed`;
  4. 409 `load_override_unavailable` (no default function);
  5. 409 `k6_unavailable` `{ readiness }`;
  6. 404 `environment_not_found`;
  7. 409 `execution_in_progress` `{ runId }`, shared with every run kind.
- **Route order:** fixed paths (`/upload`, `/example`, `/readiness`, `/runs…`) are registered
  before `/:id`, and `:id` is validated as a UUID, so a fixed path is never read as an id.
- **200:** `{ run: UserScriptRun }`, with status `in-progress`. Nothing runs on any other route
  (FR-020).

### `GET /api/user-scripts/runs[?scriptId=<id>]`
- **200:** `{ runs: UserScriptRunSummary[] }`, newest first.

### `GET /api/user-scripts/runs/:runId`
- **200:** `{ run: UserScriptRun }`, including `failure.k6Message` when present (FR-029).
- **404 `run_not_found`.**

### `POST /api/user-scripts/runs/:runId/cancel`
- **202:** `{ run }`.
- **409 `run_not_in_progress`.**

### `GET /api/user-scripts/runs/:runId/report[?download=true]`
- **200 `text/html`:** the self-contained report (FR-036). The download variant adds
  `Content-Disposition: attachment`.
- **409 `run_in_progress`.**

## Logging

Each route logs `request_succeeded` or `request_failed` through the existing helpers. Allowed
fields are ids, counts, sizes, rule ids, SHA-256 prefixes (12 characters) and categories. Script
names, content, hosts, mapped names, k6 messages and environment values are never logged
(FR-039, XX).

New events:
- `user_script_stored {scriptId, sizeBytes, sha256Prefix}`
- `user_script_refused {problemCount, ruleIds}`
- `user_script_confirmed {scriptId, sha256Prefix, hostCount}`
- `user_script_run_started {runId, environmentTier, loadKind}`
- `user_script_run_settled {runId, status, exitCode, stderrLineCount, consoleLineCount}`
