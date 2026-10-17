# Quickstart: Validating Accelerator Verification

Scenarios 1 to 3 and 7 run anywhere. Scenarios 4 to 6 need a machine where an accelerator can be enabled; the measurements in
`research.md` came from a Windows laptop with DirectML. Contracts: [ai-status-api-amendment](contracts/ai-status-api-amendment.md),
[accelerator-verification](contracts/accelerator-verification.md). Types: [data-model](data-model.md).

## Prerequisites

- Node.js 24 and `npm install` at the repository root.
- For scenarios 3 to 6, the configured model downloaded to `AI_MODEL_CACHE_DIR` (the default model is about 6.6 GB).

## 1. Automated checks (no model, no GPU, no network)

```bash
npm test -w backend -- tests/unit/ai/acceleratorVerification.test.ts tests/unit/ai/localProvider.accelerator.test.ts tests/integration/aiStatus.test.ts
npm test
npm run lint
npm run build
```

Expected: all pass. The new cases cover the pass rule (including `{}`, a top-level array, `null`, an empty string and a
non-array `candidates`), accelerator garbage falling back to CPU, a healthy accelerator staying active with a throughput
figure, a canary timeout waiting for the orphaned generation, an engine error, a CPU load failing after a failed
verification (unavailable, no automatic retry, retry repeats the canary), the accelerator being off (no canary), requests
queued during verification being answered in arrival order, the failed engine being disposed, and no canary input or reply
appearing in logs.

## 2. Status contract

```bash
npm test -w backend -- tests/integration/aiStatus.test.ts
```

Expected: the existing assertions pass unmodified; the new assertions show `inferenceDevice`, `acceleratorLabel`,
`acceleratorAdapter` and `acceleratorVerification` present with the documented types, and all `null` for the mock provider.

## 3. The canary passes on CPU for the configured model (opt-in, real model)

```bash
npm run test:ai-real -w backend
```

Expected: the added case passes for `AI_MODEL_ID` (measured: 0.45 s on Qwen2.5-0.5B, 1.4 s on Qwen3-1.7B). Run it for each
shipped model whenever the canary text changes.

## 4. A broken accelerator falls back, visibly (needs an accelerator)

```bash
# .env: AI_USE_ACCELERATOR=true  AI_MODEL_ID=onnx-community/Qwen3-1.7B-ONNX
npm run dev
# trigger a model load (start an AI enhancement from the UI), then:
curl http://127.0.0.1:4000/api/ai/status
```

Expected, on the reference laptop: `state: "ready"`, `acceleratorRequested: true`, `acceleratorActive: false`,
`inferenceDevice: "cpu"`, a `reason` containing `failed verification (unusable-reply)`, and
`acceleratorVerification.outcome: "failed"`. The enhancement then produces coherent output on CPU. The server log shows one
`accelerator_verification` line with `outcome`, `failureCategory`, `durationMs`, and no prompt or reply text.

## 5. The failing path stays within the latency budget (SC-005)

Using scenario 4's configuration, read `acceleratorVerification.durationMs`. Expected: at most 15 000 ms
(measured on the reference laptop with the 12-token cap: 13.5 to 14.1 s). If it is higher, the cap or the budget needs revisiting before this
feature is accepted.

## 6. A healthy accelerator is kept (needs an accelerator)

```bash
# .env: AI_USE_ACCELERATOR=true  AI_MODEL_ID=onnx-community/Qwen2.5-0.5B-Instruct
```

Trigger a load and read the status. Expected: `acceleratorActive: true`, `inferenceDevice: "accelerator"`,
`acceleratorLabel` set, `acceleratorVerification.outcome: "passed"` with a numeric `tokensPerSecond`, no fallback notice.
Repeat the restart-and-load cycle 20 times: 0 fallbacks (SC-003) and the same outcome every time (SC-004). This
configuration is correct but measured 2x to 4x slower than CPU on real prompts; the figure in the status is the visible hint.

## 7. Nothing changes by default

```bash
# .env: AI_USE_ACCELERATOR=false (or unset)
```

Trigger a load. Expected: no `accelerator_verification` log line, `acceleratorVerification: null`, `inferenceDevice: "cpu"`,
and no change in load time against the previous build.

## 8. Documentation (SC-007)

```bash
rg -n "experimental" .env.example docs/configuration.md docs/architecture.md
rg -n "acceleratorVerification|inferenceDevice" docs/http-api.md specs/004-ai-provider-local-inference/contracts/ai-status-api.md
```

Then confirm no unsupported platform claim remains:

```bash
rg -n "CoreML" .env.example docs backend/src/ai/localProvider.ts
```

Expected: no sentence says macOS or Linux uses a specific accelerator as fact; any mention says it is unmeasured or describes what the library source shows.

Expected for the first two commands: each of the three named documents says the accelerator is experimental, states the measured comparison with its
hardware, model and date, and describes the verification and the visible fallback; the HTTP reference and the 004 contract
mention the new fields.
