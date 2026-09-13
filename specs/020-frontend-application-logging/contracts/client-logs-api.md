# API Contract: Client Log Ingestion Endpoint

AP-020 provides a small, stateless, best-effort ingestion boundary between the frontend's
structured logger and the backend's existing logging infrastructure. It accepts one Frontend Log
Entry, validates it, and writes it through `backend/src/logger.ts` under the fixed component name
`"frontend-client"`. It never returns a body a caller depends on, never authenticates the caller
beyond what the rest of the local API surface requires, and never introduces a second log store.

## `POST /api/client-logs`

Persists one frontend-originated log entry.

### Request

```json
{
  "level": "warn",
  "component": "executionClient",
  "event": "fetch_failed",
  "timestamp": "2026-09-14T10:15:00.000Z",
  "fields": {
    "operation": "startExecution",
    "errorCategory": "network_error",
    "statusCode": 502
  }
}
```

`level`, `component`, `event`, and `timestamp` are required; `fields` is optional. Any `fields`
entry whose value is not a primitive, or whose name matches the credential-shaped denylist
(`token`, `apikey`, `api_key`, `password`, `secret`, `authorization`, `credential`, `cookie` —
case-insensitive; FR-004/SC-008), is dropped rather than persisted. See
[data-model.md](../data-model.md) for the full field-by-field validation contract.

The request body is capped at a dedicated, route-scoped limit (~4–8 KB, FR-013) — independent of
and smaller than the 10 MB limit `backend/src/app.ts` applies to specification uploads. Exceeding
it is rejected before any part of the request is persisted.

### Success Response: `202 Accepted`

No response body. `202` (not `200`) signals that the entry was accepted for best-effort
persistence, matching the fire-and-forget contract the frontend logger relies on (FR-005/FR-008)
— the caller never awaits or inspects this response for control flow.

### Failure Response: `400 Bad Request`

Returned only for a structural validation failure (`level` not one of `info`/`warn`/`error`;
`component` or `event` missing/empty/non-string; `timestamp` missing/non-string). An individual
non-primitive value inside `fields` is dropped rather than causing a `400` (data-model.md).

```json
{
  "error": "invalid_client_log_entry",
  "message": "\"level\" must be one of \"info\", \"warn\", \"error\"."
}
```

### Failure Response: `413 Payload Too Large`

Returned by the existing centralized error handler (unchanged) when the request body exceeds the
route's dedicated size limit — the same `payload_too_large` shape already used for an oversized
specification upload:

```json
{
  "error": "payload_too_large",
  "message": "Request body exceeds the maximum allowed size of 8192 bytes"
}
```

### Non-goals

- No authentication/authorization beyond what already applies to the rest of the local `/api`
  surface (this is a local-first developer tool, per constitution V/XXIX; not a multi-tenant
  service).
- No response body the frontend needs to parse; a forwarding failure (network error, non-2xx,
  4xx/5xx) is handled entirely client-side as a best-effort local console notice (FR-008) and never
  retried.
- No rate-limiting, de-duplication, or batching (explicitly Out of Scope in spec.md).
