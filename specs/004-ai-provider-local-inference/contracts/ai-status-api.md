# Contract: AI Status API

**Endpoint**: `GET /api/ai/status`

**Purpose**: Lets the frontend (or any local client/tooling) check the current readiness
of local AI inference before relying on an AI-powered feature (spec FR-004; supports User
Story 2). This is the only external (HTTP) contract introduced by this feature — the
`AIProvider` abstraction itself (data-model.md) is an internal, in-process contract
consumed directly by future backend features (AP-005+), not exposed over HTTP.

## Request

- Method: `GET`
- Path: `/api/ai/status`
- Headers: none required
- Body: none

## Response — 200 OK

```json
{
  "state": "ready",
  "modelId": "onnx-community/Qwen2.5-0.5B-Instruct",
  "provider": "local",
  "acceleratorRequested": false,
  "acceleratorActive": false,
  "reason": null,
  "updatedAt": "2026-08-29T12:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|--------------|
| `state` | `"not-loaded" \| "loading" \| "ready" \| "unavailable"` | Matches `ReadinessState.state` in [data-model.md](../data-model.md) |
| `modelId` | `string \| null` | The configured/loaded model identifier, when known |
| `provider` | `"local" \| "mock"` | Which `AIProvider` implementation is active |
| `acceleratorRequested` | `boolean` | Whether configuration asked for an accelerator (FR-008) |
| `acceleratorActive` | `boolean` | Whether an accelerator is actually in use (FR-008) |
| `reason` | `string \| null` | Non-null and non-empty whenever `state` is `"unavailable"` (FR-004) |
| `updatedAt` | string (ISO-8601) | When this readiness snapshot was produced |

This response body is always `200 OK`, even when `state` is `"unavailable"` — an
unavailable *model* is not an *endpoint* failure; the endpoint itself succeeded in reporting
that state (constitution XIX, Fail Safely).

## Error Behavior

- The endpoint MUST NOT throw an unhandled exception; any internal error in producing the
  status snapshot MUST be caught and MUST result in a `5xx` JSON error response (not a raw
  stack trace), per constitution XIX and XX.
- No request body, authentication, or query parameters are accepted; unsupported methods on
  this path MUST return `405 Method Not Allowed`.
- The response MUST NOT include raw model prompts, raw inference responses, or credentials
  (constitution XX) — only the readiness fields listed above.

## Notes

- This endpoint reflects `AIProvider.getReadiness()` (data-model.md) for whichever provider
  is currently configured (`local` or `mock`); it does not itself trigger model loading.
- The shape is intentionally minimal (constitution XXVII); it MUST NOT be extended
  speculatively (e.g., adding benchmark data or inference history) ahead of a concrete need
  from a later feature.
