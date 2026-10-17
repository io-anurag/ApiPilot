# Data Model: Accelerator Verification and Visibility

Nothing here is persisted. Every type describes the current process's load of the local model (research Decision 8).

## Shared contract additions (`packages/shared-domain/src/aiProvider.ts`)

All additions are optional, so existing producers and consumers compile and behave unchanged.

### `ReadinessState` (existing, extended)

| Field | Type | Set when | Notes |
| --- | --- | --- | --- |
| `inferenceDevice` | `"cpu" \| "accelerator"` | the engine has loaded | Absent while `not-loaded`, `loading`, or `unavailable` before any engine loaded. `"cpu"` after an accelerator fallback. |
| `acceleratorLabel` | `string` | `inferenceDevice === "accelerator"` | Free text produced by the provider: `"DirectML"` on Windows (the only measured platform) and the generic `"Accelerator"` elsewhere. Never the inference library's device string; the contract must not name a runtime (constitution VI), and no unmeasured vendor name is reported (constitution XIV; research Decision 7). |
| `acceleratorAdapter` | `string` | never today | Reserved: the runtime exposes no adapter identity (FR-010). Reported as `null` by the status endpoint. |
| `acceleratorVerification` | `AcceleratorVerification` | an accelerated engine loaded and the canary ran | Retained in the state after a fallback to CPU so the reason is explainable. Absent in an `unavailable` state, including when the CPU load fails after a failed verification: that state carries only the load-failure `reason`, as it does today. |

Existing fields (`state`, `reason`, `modelId`, `acceleratorRequested`, `acceleratorActive`, `updatedAt`) keep their meaning
and types. `reason` carries the fallback notice while `state` is `ready`, as 004 FR-008 already does.

### `AcceleratorVerification` (new)

| Field | Type | Rules |
| --- | --- | --- |
| `outcome` | `"passed" \| "failed"` | |
| `failureCategory` | `"unusable-reply" \| "timeout" \| "inference-error"` | Present if and only if `outcome === "failed"`. |
| `durationMs` | `number` | Wall time of the canary inference (including a timed-out one, up to the bound). |
| `tokensPerSecond` | `number` | Present if and only if `outcome === "passed"`. Output tokens divided by `durationMs`, including prompt prefill; a cold single sample (research Decision 6). Finite and greater than 0. |
| `canaryVersion` | `number` | `ACCELERATOR_CANARY_VERSION`, currently `1`. |

Never contains the canary input or the reply.

## Provider-internal types (`backend/src/ai/`, not exported through the shared package)

### `TextGenerationEngine` (existing, extended; `localProvider.ts`)

| Member | Type | Purpose |
| --- | --- | --- |
| `countTokens?` | `(text: string) => number` | Token count with the model's own tokenizer, used only for the throughput figure. When absent, `tokensPerSecond` is omitted rather than estimated. |
| `dispose?` | `() => Promise<void> \| void` | Releases the engine's native resources. Called on a rejected accelerated engine before the CPU engine loads. Errors are caught and logged by category only. |

### `CanaryEvaluation` (new; `acceleratorVerification.ts`)

`{ passed: true } | { passed: false; failureCategory: "unusable-reply" }`. A pure result of `evaluateCanaryReply(content)`;
`timeout` and `inference-error` are decided by the provider, which owns time and exceptions.

### Constants (`acceleratorVerification.ts`)

| Name | Value | Meaning |
| --- | --- | --- |
| `ACCELERATOR_CANARY_VERSION` | `1` | Bump when the input, expected reply or pass rule changes. |
| `ACCELERATOR_CANARY_INPUT` | `Reply with exactly: {"candidates":[]}` | Fixed user text (research Decision 2). |
| `ACCELERATOR_CANARY_MAX_NEW_TOKENS` | `12` | Bounds the cost of a failing accelerator (research Decision 4). |

## Pass rule

`evaluateCanaryReply(content)` passes only when `JSON.parse(content)` succeeds, the value is a non-null object that is not an
array, and its `candidates` property is an array. An empty array passes. Everything else, including an empty string, `{}`,
a top-level array, `null`, and a non-array `candidates`, returns `unusable-reply`.

## State transitions (load path)

```text
not-loaded
  └─ first infer()/getInputBudget() ──► loading (acceleratorRequested = config.useAccelerator)

useAccelerator = false
  loading ──► load CPU engine ──► ready { inferenceDevice: "cpu" }                       (no canary; unchanged)

useAccelerator = true
  loading ──► load accelerated engine
        ├─ load throws ──► load CPU engine ──► ready { cpu, reason: "unavailable at runtime" }     (004 FR-008, unchanged)
        └─ loaded ──► run canary (bounded by AI_INFERENCE_TIMEOUT_MS, 12 tokens)
              ├─ passed ──► ready { inferenceDevice: "accelerator", acceleratorLabel,
              │                     acceleratorVerification { passed, tokensPerSecond } }
              └─ failed (unusable-reply | timeout | inference-error)
                    ├─ await any orphaned generation to settle, dispose accelerated engine
                    └─ load CPU engine
                          ├─ ok ──► ready { inferenceDevice: "cpu", reason: "failed verification (<category>); using CPU",
                          │                  acceleratorVerification { failed, failureCategory } }
                          └─ throws ──► (existing path) unavailable { reason }  — no automatic retry (004 FR-019)

unavailable ──(explicit retryLoad)──► not-loaded ──► the load path above, including the canary (FR-014)
```

`readiness` stays `loading` for the whole canary, so no inference request is dispatched to an unverified accelerator. The
existing FIFO queue is untouched.
