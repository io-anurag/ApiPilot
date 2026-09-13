# Phase 1 Data Model: Frontend Application Logging

## LogLevel

`"info" | "warn" | "error"` — identical vocabulary to the existing backend `LogLevel`
(`backend/src/logger.ts`), reused rather than redefined, per constitution XXVIII (stable domain
vocabulary over reinventing one).

## LogFields (frontend)

`Record<string, string | number | boolean | undefined>` — structurally identical to the backend's
existing `LogFields` type. A caller may only pass primitive values; anything else is dropped at
runtime before the entry is emitted or forwarded (research.md Decision 5), regardless of what
TypeScript's structural typing would otherwise allow through a loosely-typed call site.

## Frontend Log Entry

The record the frontend logger constructs for every `logger.<level>(event, fields?)` call.

| Field | Type | Notes |
|---|---|---|
| `level` | `LogLevel` | Which of `info`/`warn`/`error` was called. |
| `component` | `string` | Fixed at `createLogger(component)` construction time (e.g. `"executionClient"`, `"globalErrorHandlers"`). Never per-call. |
| `event` | `string` | The caller-supplied event name (e.g. `"fetch_failed"`, `"uncaught_exception"`). |
| `timestamp` | `string` (ISO 8601) | Produced by the logger's clock (`Date` by default, injectable per FR-011/research.md Decision 1). |
| `fields` | `LogFields` | Optional; runtime-filtered to primitives only (FR-003). |

**Console emission** (FR-002): serialized as one structured object per call (not a free-form
string), via the console method matching level (`console.error`/`console.warn`/`console.log`),
mirroring the backend logger's one-JSON-line-per-entry convention.

**Forwarding** (FR-005): only `warn`- and `error`-level entries are POSTed to the backend ingestion
endpoint; `info`-level entries never leave the browser console.

## Client Log Ingestion Request (wire shape)

The JSON body the frontend POSTs to the backend endpoint for a `warn`/`error` entry:

```jsonc
{
  "level": "warn",              // "warn" | "error" only (info is never forwarded)
  "component": "executionClient",
  "event": "fetch_failed",
  "timestamp": "2026-09-14T10:15:00.000Z",  // the entry's original, client-side timestamp
  "fields": {                   // optional; primitives only
    "operation": "startExecution",
    "errorCategory": "network_error",
    "statusCode": 502
  }
}
```

## Client Log Ingestion Endpoint (backend)

Persists one Frontend Log Entry via the existing `backend/src/logger.ts`.

**Validation (FR-007)**:
- `level` MUST be exactly one of `"info" | "warn" | "error"`; otherwise the request is rejected
  (400) — the entry's shape is unusable if the level itself is malformed.
- `component` and `event` MUST both be non-empty strings; otherwise the request is rejected (400).
- `timestamp` MUST be a string; otherwise the request is rejected (400). (Parseability as a valid
  date is not re-validated server-side beyond that — a malformed-but-string timestamp is stored
  as-is rather than blocking an otherwise-diagnosable entry.)
- `fields`, if present, MUST be a plain object. Any individual field whose value is not a
  `string`/`number`/`boolean` is **dropped** (not the whole entry) before persisting — a single bad
  field must not discard an otherwise-useful diagnostic entry (FR-007's "reject or drop" is
  satisfied at the field level here; the entry-level fields above are stricter because the entry is
  meaningless without them).
- The whole request body MUST NOT exceed the route's own ~4–8 KB limit (FR-013); Express's
  `entity.too.large` body-parser error is handled entirely by the existing centralized error
  handler (research.md Decision 3) — no new validation code for this specific rule.

**Persistence**: The route calls `createLogger("frontend-client").{level}(event, mergedFields)`
where `mergedFields` is the request's validated `fields` object plus two entry-identifying values
the router adds itself: `frontendComponent` (the request's own `component` value) and
`clientTimestamp` (the request's own `timestamp` value). This is necessary because the existing
`backend/src/logger.ts` `Logger` interface always stamps its own server-receipt-time `timestamp`
and always tags the line with the `component` the logger was constructed with — reusing it as-is
(rather than modifying its contract) means the *persisted* log line's top-level `component` is
always the fixed string `"frontend-client"` (satisfying FR-006's "distinct component name") and its
top-level `timestamp` is the server's receipt time, while the original frontend module name and
the original client-side event time are preserved as `frontendComponent`/`clientTimestamp` fields
instead of being lost.

**Response**: `202 Accepted` with an empty body on success (fire-and-forget by design — the
frontend caller does not need or await a body); `400` with a structured `{ error, message }` body
for a structural validation failure; `413` (via the existing centralized error handler) when the
request exceeds the size limit.

## Relationships

```text
Frontend service-client catch block ──▶ logger.error(event, fields)
window "error"/"unhandledrejection"  ──▶ logger.error(event, fields)
                                              │
                                              ├─▶ console.<level>(...)                (always)
                                              └─▶ POST /api/client-logs (warn/error)   (best-effort)
                                                        │
                                                        ▼
                                          backend/src/api/clientLogs.ts (validate)
                                                        │
                                                        ▼
                                     createLogger("frontend-client").<level>(event, fields)
                                                        │
                                                        ▼
                                          console + logs/backend.log (existing sink)
```

No new persistent store, no state transitions, no identity/uniqueness rules — every entry is
independent and append-only, consistent with the existing backend logger's model.
