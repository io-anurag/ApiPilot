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
  "updatedAt": "2026-08-29T12:00:00.000Z",
  "lastKnownReadiness": {
    "state": "unavailable",
    "reason": "Model download failed: ENOTFOUND",
    "modelId": "onnx-community/Qwen2.5-0.5B-Instruct",
    "updatedAt": "2026-09-15T08:00:00.000Z"
  },
  "latestBenchmarkRun": {
    "runAt": "2026-08-20T00:00:00.000Z",
    "selectedModelId": "onnx-community/Qwen2.5-0.5B-Instruct",
    "selectionRationale": "Highest structured-output success rate (100%) among evaluated candidates..."
  }
}
```

| Field | Type | Description |
|-------|------|--------------|
| `state` | `"not-loaded" \| "loading" \| "ready" \| "unavailable"` | Matches `ReadinessState.state` in [data-model.md](../data-model.md). Always reflects a real, in-process load attempt — never resumed from persisted history. |
| `modelId` | `string \| null` | The configured/loaded model identifier, when known |
| `provider` | `"local" \| "mock"` | Which `AIProvider` implementation is active |
| `acceleratorRequested` | `boolean` | Whether configuration asked for an accelerator (FR-008) |
| `acceleratorActive` | `boolean` | Whether an accelerator is actually in use (FR-008) |
| `reason` | `string \| null` | Non-null and non-empty whenever `state` is `"unavailable"` (FR-004) |
| `updatedAt` | string (ISO-8601) | When this readiness snapshot was produced |
| `lastKnownReadiness` | object \| `null` | *(Added by `specs/025-local-persistence-layer`)* The most recent readiness transition persisted before this process started, for historical/diagnostic display only (e.g. "last time this ran, loading failed for reason X"). `null` when no history has been recorded yet. Distinct from `state` above — never used to skip a real load attempt. |
| `latestBenchmarkRun` | object \| `null` | *(Added by `specs/025-local-persistence-layer`)* Summary of the most recent `npm run ai:benchmark` run recorded to durable storage. `null` when no benchmark has ever been run. |

**Amendment note**: this endpoint's original contract (below, unchanged) said the shape "MUST
NOT be extended speculatively... ahead of a concrete need from a later feature."
`specs/025-local-persistence-layer` is that concrete need — it persists AI readiness/benchmark
history and surfaces it here rather than requiring a second endpoint for a closely related
concern (constitution XXVII). The two new fields are additive and optional; no existing field
changed meaning.

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
- The shape was originally intentionally minimal (constitution XXVII) and was not to be
  extended speculatively ahead of a concrete need. `specs/025-local-persistence-layer` is that
  concrete need (see the Amendment note above) and added `lastKnownReadiness` and
  `latestBenchmarkRun`; any further extension still requires the same bar — a real feature
  need, not speculation.
