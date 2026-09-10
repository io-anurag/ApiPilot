# Contract: Session Identity & Isolation

This is an additive amendment to
`specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md`, not a
replacement — every endpoint documented there keeps its existing request/response shape except
for the one addition in "Amended: `GET /api/test-generation-workflow`" below. Read that contract
first; this file documents only what changes.

## Cross-cutting: session cookie

Every response from any `/api/test-generation-workflow*` endpoint MAY set a `sessionId` cookie
(`Set-Cookie: sessionId=<uuid>; HttpOnly; SameSite=Lax`) the first time a given browser is seen.
Once set, the browser's subsequent requests include it automatically (same-origin — no client
code change; see plan.md Technical Context). The cookie value:

- MUST be cryptographically random and unguessable (FR-004a) — a `crypto.randomUUID()` value.
- MUST NOT be logged in full by any structured log line (research.md D6) — only an 8-character
  prefix, if a session correlator is logged at all.
- Carries no personally identifying information (FR-004) and is not tied to a login.

Every endpoint's behavior is now implicitly scoped to the calling session: "the current
workflow" in every existing contract description means "the current workflow for the calling
session," not "the one process-wide workflow" (FR-001, FR-003). This changes no endpoint's
request or response shape except the one below.

## Amended: `GET /api/test-generation-workflow`

Adds one response case to the two documented in
`specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md`.

### Success Response: `200 OK` (existing, unchanged)

```json
{ "workflow": { "id": "wf-...", "activeStageId": "scenarioReview", "stages": { "...": "..." } } }
```

The calling session has an in-progress workflow.

### Success Response: `204 No Content` (existing, unchanged)

The calling session has never started a workflow (or its own most recent workflow has not yet
been idle-evicted and no other session's workflow is visible to it).

### Success Response: `200 OK` — session expired (new, FR-007a)

```json
{ "workflow": null, "sessionExpired": true }
```

The calling session previously had an in-progress workflow, but it was discarded after 60
minutes of inactivity from that session (FR-007). Distinguishes "you had progress that expired"
from a genuinely new session's `204`. This case can only be produced starting with this
feature; no existing behavior changes for a session that has truly never started a workflow.

## Unaffected endpoints

Every other endpoint in `test-generation-workflow-api.md` (`POST
/test-generation-workflow`, `.../api-review/continue`, `.../deterministic-generation`,
`.../ai-enhancement`, `.../ai-enhancement/cancel`, `.../ai-enhancement/retry-batch`,
`.../scenario-review/decisions`, `.../scenario-review/edit`, `.../scenario-review/regenerate`,
`.../scenario-review/finalize`, `.../workflow-review/decisions`, `.../workflow-review/continue`,
`.../postman-generation`) keeps its exact existing request/response shape and status codes —
only which session's data each one reads or mutates changes, per the cross-cutting note above.
