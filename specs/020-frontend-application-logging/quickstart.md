# AP-020 Quickstart Validation

This guide validates frontend structured logging: console output, backend forwarding, and the
security constraints that keep both channels free of sensitive data. Nothing in it sends data to
any external/cloud service — the only destination beyond the browser console is this repository's
own local backend process (FR-012).

## Prerequisites

- Node.js 20 LTS or newer
- npm dependencies installed from the repository root
- No AI provider, model download, or network access beyond `localhost` is required — this feature
  has no AI dependency.

## Automated Validation

From the repository root:

```powershell
npx vitest run --project frontend -- logger globalErrorHandlers executionClient healthClient postmanCollectionsClient reviewsClient specificationsClient testGenerationWorkflowClient testModelsClient
npm test --workspace @apipilot/backend -- --run clientLogs
npm run build
npm run lint
```

Expected outcomes:

- Every existing frontend service-client module's caught errors produce a structured console log
  entry (SC-001); no module is left un-instrumented.
- A simulated uncaught exception and a simulated unhandled promise rejection each produce exactly
  one structured `error`-level console entry, without an actual crash reaching the test runner
  (SC-007).
- No entry the logger emits, and no entry the backend endpoint accepts, contains a non-primitive
  field value (SC-003); a caller attempting to log an object/array/function field is rejected or
  has that field dropped, per [data-model.md](./data-model.md).
- A request to `POST /api/client-logs` exceeding its dedicated ~4–8 KB limit is rejected with `413`
  before anything is persisted (SC-006); see
  [contracts/client-logs-api.md](./contracts/client-logs-api.md).
- All new/changed tests pass without a real network call or dependence on real wall-clock timing
  (SC-005) — `fetch` is stubbed and the logger's clock is injected.
- `frontend/package.json` and `backend/package.json` gain zero new dependencies (SC-004).

## Manual Validation

### 1. See a service-client failure logged to the console

Start the application:

```powershell
npm run dev
```

Stop the backend (or block its port) while leaving the frontend running, then trigger any action
that calls a service-client module (e.g. load the review workspace, or attempt a Postman export).

Confirm in the browser console:

- One structured log entry appears (JSON-shaped fields: `level`, `component`, `event`,
  `timestamp`, plus contextual fields such as `operation`/`errorCategory`), not a bare thrown
  error or a free-form string (User Story 1).
- The UI's own existing failure messaging is unaffected — logging is additive, not a replacement
  for user-facing error handling.

### 2. Confirm a warn/error entry reaches the backend log

With the backend running, repeat the same failure-triggering action (or trigger any `warn`/
`error`-level frontend event), then close the browser tab.

Confirm:

- `backend/logs/backend.log` contains a new line with `"component":"frontend-client"`, distinct
  from backend-originated entries, carrying the original frontend component name under
  `frontendComponent` and the original client-side event time under `clientTimestamp` (User Story
  2, data-model.md's "Persistence" section).
- The entry is present even though the browser tab that produced it is now closed.

### 3. Confirm forwarding failure never breaks the UI

Stop the backend, then trigger a `warn`/`error`-level frontend event.

Confirm:

- The application continues to behave normally (no thrown error, no broken UI).
- At most one local console notice about the failed forward appears; it is not retried
  indefinitely (Edge Cases, FR-008).

### 4. Confirm no sensitive data can pass through

Attempt to log a field containing a nested object (e.g. a full specification or a prompt string)
through the logger directly (e.g. via the browser console: import and call the logger with an
object-valued field).

Confirm:

- Only primitive fields appear in the resulting console/backend entry; the non-primitive field is
  absent, never serialized as a JSON blob (User Story 3, FR-003/FR-004).
