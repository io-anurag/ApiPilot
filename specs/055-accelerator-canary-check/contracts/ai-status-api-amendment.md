# Contract Amendment: AI Status API

**Endpoint**: `GET /api/ai/status` (unchanged path, method and status codes)

**Amends**: `specs/004-ai-provider-local-inference/contracts/ai-status-api.md`

That contract says the response "MUST NOT be extended speculatively ahead of a concrete need". The need here is concrete: 004
FR-008 made an accelerator fallback visible only when the accelerator failed to *load*, and a measured loaded-but-unusable
accelerator was reported as healthy (`specs/055-accelerator-canary-check/spec.md`, FR-009 and FR-010). Like
`specs/025-local-persistence-layer`, this amendment is additive and optional.

## Response additions (200 OK)

```json
{
  "state": "ready",
  "modelId": "onnx-community/Qwen2.5-0.5B-Instruct",
  "provider": "local",
  "acceleratorRequested": true,
  "acceleratorActive": true,
  "reason": null,
  "updatedAt": "2026-10-17T12:15:02.050Z",

  "inferenceDevice": "accelerator",
  "acceleratorLabel": "DirectML",
  "acceleratorAdapter": null,
  "acceleratorVerification": {
    "outcome": "passed",
    "failureCategory": null,
    "durationMs": 1348,
    "tokensPerSecond": 3.0,
    "canaryVersion": 1
  },

  "lastKnownReadiness": null,
  "latestBenchmarkRun": null
}
```

After a failed verification the same request returns:

```json
{
  "state": "ready",
  "acceleratorRequested": true,
  "acceleratorActive": false,
  "reason": "Accelerator loaded but failed verification (unusable-reply); using CPU inference instead",
  "inferenceDevice": "cpu",
  "acceleratorLabel": null,
  "acceleratorAdapter": null,
  "acceleratorVerification": {
    "outcome": "failed",
    "failureCategory": "unusable-reply",
    "durationMs": 9120,
    "tokensPerSecond": null,
    "canaryVersion": 1
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `inferenceDevice` | `"cpu" \| "accelerator" \| null` | The device the loaded engine runs on. `null` until an engine has loaded. |
| `acceleratorLabel` | `string \| null` | Descriptive name of the accelerator in use: `"DirectML"` on Windows (the only measured platform), the generic `"Accelerator"` on other platforms. `null` unless `inferenceDevice` is `"accelerator"`. Informational text, not a stable enum. |
| `acceleratorAdapter` | `string \| null` | The physical adapter, only when the runtime exposes it. Always `null` with the current runtime; a client must not treat `null` as "no accelerator". |
| `acceleratorVerification` | object \| `null` | The one-off post-load check. `null` when the accelerator was not requested, the accelerated engine failed to load, or the provider is the mock. |
| `acceleratorVerification.outcome` | `"passed" \| "failed"` | |
| `acceleratorVerification.failureCategory` | `"unusable-reply" \| "timeout" \| "inference-error" \| null` | Non-null if and only if `outcome` is `"failed"`. |
| `acceleratorVerification.durationMs` | number | Wall time of the check. |
| `acceleratorVerification.tokensPerSecond` | number \| `null` | Non-null if and only if `outcome` is `"passed"`. A coarse, cold, single sample including prompt prefill; for noticing order-of-magnitude differences, not for benchmarking. |
| `acceleratorVerification.canaryVersion` | number | Version of the fixed check input (currently `1`). |

## Behavior

- Every existing field keeps its meaning and type (spec SC-006). The new fields are additive, and a client that ignores them
  is unaffected.
- `reason` is non-null whenever the provider is `ready` on CPU although an accelerator was requested, for either cause (the
  existing "unavailable at runtime" text, or the verification text above). It is also non-null whenever `state` is
  `unavailable`, as before.
- When the provider is `unavailable` (including a CPU load failure after a failed verification), `acceleratorVerification`,
  `inferenceDevice` and `acceleratorLabel` are `null`; the `reason` carries the load failure.
- `provider: "mock"` returns `inferenceDevice: null`, `acceleratorLabel: null`, `acceleratorAdapter: null` and
  `acceleratorVerification: null`.
- The response is still always `200 OK`, still triggers no model load, and still never contains the canary input, any model
  reply, a prompt, or a credential.
- Errors, `405` handling, and the `5xx` safe-body rule are unchanged.

## Compatibility

Additive only. No field is renamed, retyped or removed, so no existing consumer needs to change. Nothing under
`frontend/src` consumes this endpoint today (searched).
