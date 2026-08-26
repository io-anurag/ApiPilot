# Contract: Health Check API

**Endpoint**: `GET /api/health`

**Purpose**: Lets the frontend (or any local client) confirm the backend service is
running correctly (spec FR-002, FR-003; supports User Story 1).

## Request

- Method: `GET`
- Path: `/api/health`
- Headers: none required
- Body: none

## Response — 200 OK

```json
{
  "status": "ok",
  "timestamp": "2026-08-26T12:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"ok"` | Fixed literal for this foundation; matches the `HealthStatus` shared type in [data-model.md](../data-model.md) |
| `timestamp` | string (ISO-8601) | Server time the response was generated |

## Error Behavior

- The endpoint MUST NOT throw an unhandled exception; any internal error MUST be caught
  and MUST result in a `5xx` JSON error response (not a raw stack trace), per constitution
  XIX (Fail Safely) and XX (Observability Without Sensitive Logging).
- No request body, authentication, or query parameters are accepted; unsupported methods
  on this path MUST return `405 Method Not Allowed`.

## Notes

- This is the only external contract introduced by this feature. Later specs (AP-002+)
  will add their own contracts (e.g., specification upload) without modifying this one.
- The shape is intentionally minimal; it MUST NOT be extended speculatively ahead of a
  concrete need (constitution XXVII, Prefer Simple Architecture).
