# Contract: Accelerator Verification (provider-internal)

Not exposed over HTTP; consumed only by `LocalProvider`. It is recorded as a contract because the canary's wording is
load-bearing (research Decision 2) and constitution XXIII treats such inputs as versioned assets.

## Inputs

| Item | Value |
| --- | --- |
| System message | The provider's existing JSON system message (selected through `expectedOutputFormat: "json"`). Unchanged. |
| User text | `Reply with exactly: {"candidates":[]}` |
| Decoding | Greedy (`do_sample: false`), as every inference in this provider. |
| Output cap | `12` new tokens |
| Time bound | `ModelConfig.inferenceTimeoutMs` (`AI_INFERENCE_TIMEOUT_MS`); no new setting |
| Version | `ACCELERATOR_CANARY_VERSION = 1` |

## Decision rule

| Observation | Result |
| --- | --- |
| Reply parses to an object whose `candidates` is an array (empty allowed) | `passed` |
| Reply is empty, unparseable, not an object, or has no `candidates` array | `failed` / `unusable-reply` |
| No reply within the time bound | `failed` / `timeout` |
| The engine throws | `failed` / `inference-error` |

## Obligations on the provider

1. Run the check only when `ModelConfig.useAccelerator` is true and the accelerated engine loaded. Never for the CPU path.
2. Keep readiness `loading` until the device decision is final.
3. On `passed`: mark ready with `acceleratorActive: true` and the verification result; keep the engine.
4. On `failed`: await any orphaned generation to settle, dispose the accelerated engine, load the CPU engine, mark ready with
   `acceleratorActive: false`, a non-empty `reason` naming the category, and the verification result.
5. If the CPU engine fails to load, propagate the error unchanged so the existing path marks the provider `unavailable`; no
   automatic retry (004 FR-019).
6. Never select any provider other than the local one (004 FR-007, CLAUDE.md section 17).
7. Log one `accelerator_verification` event with `modelId`, `outcome`, `failureCategory` (if any), `durationMs`,
   `canaryVersion` and the device label. Never log the input or the reply (constitution XX).
8. A user-requested retry of loading repeats the check (spec FR-014); nothing repeats it in the background.

## Obligations on the engine

- `generate()` is used as-is. `countTokens()` and `dispose()` are optional additions; an engine without them still works
  (throughput is omitted, and disposal is skipped).
- The loader remains the only module that imports the inference library (CLAUDE.md section 15).

## Change control

Changing the input text, the expected reply, the cap, or the pass rule changes behavior and MUST bump
`ACCELERATOR_CANARY_VERSION`, update `research.md` Decision 2's measurements, and re-run the opt-in real-model test on every
shipped model.
