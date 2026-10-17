---

description: "Task list for Accelerator Verification and Visibility"
---

# Tasks: Accelerator Verification and Visibility

**Input**: Design documents from `/specs/055-accelerator-canary-check/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included. Spec FR-013 and SC-008 require automated coverage that needs no model, GPU or network; the real-model case is opt-in.

**Organization**: Grouped by user story. US2 reads the throughput the US1 canary measures, so US2 builds on US1's implementation (see Dependencies). US3 is documentation only and is independent.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2 or US3 (maps to spec.md)
- Tasks that edit the same file are never marked [P]

## Path Conventions

Web application layout per plan.md: `backend/src/`, `backend/tests/`, `packages/shared-domain/src/`. `frontend/` is not touched.

**Conventions for every task below**: match the surrounding code's style and comment density; run only targeted formatting (do not run Prettier over whole files, which is what produced unrelated churn in `specs/014-ai-batching-policy/research.md` earlier); leave all changes **uncommitted** for review.

---

## Phase 1: Setup

**Purpose**: Confirm a clean starting point. No new dependency or tooling is needed.

- [X] T001 Confirm the baseline is green before changing anything: run `npm test -w backend -- tests/unit/ai tests/integration/aiStatus.test.ts`, `npm run lint` and `npm run build` from the repository root on branch `AP-055`, and note any pre-existing failure so it is not attributed to this feature.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types and plumbing that both US1 and US2 use. All additions are optional, so nothing existing breaks.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 In `packages/shared-domain/src/aiProvider.ts`, add the exported interface `AcceleratorVerification` (`outcome: "passed" | "failed"`, `failureCategory?: "unusable-reply" | "timeout" | "inference-error"`, `durationMs: number`, `tokensPerSecond?: number`, `canaryVersion: number`) and four optional fields on `ReadinessState`: `inferenceDevice?: "cpu" | "accelerator"`, `acceleratorLabel?: string`, `acceleratorAdapter?: string`, `acceleratorVerification?: AcceleratorVerification`. Doc-comment each as in [data-model.md](data-model.md) (adapter is reserved and never set today; the label is free text and must never be a runtime device string, constitution VI). Do not add any Node, Express or runtime-specific import. The package index already re-exports this file (`export * from "./aiProvider"`).
- [X] T003 In `backend/src/ai/readiness.ts`, extend the `markReady` params with optional `inferenceDevice`, `acceleratorLabel` and `acceleratorVerification` and copy them onto the new state. Leave `markLoading`, `markUnavailable`, `reset`, and `recordTransition` unchanged: persistence keeps only its existing columns (research Decision 8), so do not touch `backend/src/persistence/aiDiagnosticsRepository.ts`.
- [X] T004 In `backend/src/ai/localProvider.ts`, add two optional members to the `TextGenerationEngine` interface with doc comments: `countTokens?: (text: string) => number` (token count with the model's own tokenizer, used only for the throughput figure) and `dispose?: () => Promise<void> | void` (releases native resources; called on a rejected accelerated engine). Types only: no behavior change.
- [X] T005 Create a skeleton `backend/src/ai/acceleratorVerification.ts` exporting `ACCELERATOR_CANARY_VERSION = 1`, `ACCELERATOR_CANARY_INPUT = 'Reply with exactly: {"candidates":[]}'`, `ACCELERATOR_CANARY_MAX_NEW_TOKENS = 12` and a **stub** `evaluateCanaryReply(content: string)` that always returns `{ passed: false, failureCategory: "unusable-reply" }`. The Phase 3 test files import this module, so a real module must exist for them to fail for the right reason (missing behavior) instead of failing on module resolution; the real implementation replaces the stub in T016. Type the category from `AcceleratorVerification["failureCategory"]` in `@apipilot/shared-domain` (T002). No inference-library, Express or filesystem imports.

**Checkpoint**: `npm run build` compiles; every existing test still passes unmodified.

---

## Phase 3: User Story 1 - An unusable accelerator is detected and replaced by CPU (Priority: P1) 🎯 MVP

**Goal**: After an enabled accelerator loads, run one fixed canary; on failure, fall back to CPU with a visible reason, never to another provider.

**Independent Test**: With fake engines (accelerated engine returns garbage, CPU engine returns valid replies) and `useAccelerator: true`, trigger a load. The provider ends up ready on CPU with `acceleratorRequested: true`, `acceleratorActive: false` and a reason containing `failed verification (unusable-reply)`. No model or GPU is needed.

### Tests for User Story 1 (write first; confirm they fail before implementing)

- [X] T006 [P] [US1] Create `backend/tests/unit/ai/acceleratorVerification.test.ts` with a table-driven test of `evaluateCanaryReply` and the constants, imported from `backend/src/ai/acceleratorVerification`. Pass cases: `{"candidates":[]}`, `{"candidates":[{"rationale":"x"}]}`, and a pretty-printed `{\n  "candidates": []\n}`. `unusable-reply` cases: `""`, `"   "`, `"not json"`, `{}`, `[]`, `null`, `"text"`, `{"candidates":null}`, `{"candidates":{}}`, `{"category":"409"}`, `{"candidates":[]}\n}` (stray brace, as the fp16 0.5B model produced) and a garbage string such as `{"Trader please twots`. Assert `ACCELERATOR_CANARY_VERSION === 1`, `ACCELERATOR_CANARY_MAX_NEW_TOKENS === 12` and the exact input text `Reply with exactly: {"candidates":[]}`. Assert the function never throws.
- [X] T007 [US1] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, update the existing test "uses the accelerator when it initializes successfully": its fake engine returns `gpu:${input}`, which is not valid JSON and would now correctly fall back to CPU. Make that fake engine return `{"candidates":[]}` when `input === ACCELERATOR_CANARY_INPUT` (imported) and `gpu:${input}` otherwise, and keep its `acceleratorActive: true` assertion. Leave the first test (accelerator fails to load) unchanged.
- [X] T008 [US1] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, add a test: accelerated fake engine returns garbage for the canary, CPU fake engine answers normally. Assert after `infer()`: `status: "success"` served by the CPU engine; `getReadiness()` has `state: "ready"`, `acceleratorRequested: true`, `acceleratorActive: false`, and `reason` containing `failed verification (unusable-reply)`; the accelerated engine's `dispose` was called once; the accelerated engine received exactly one `generate` call (the canary).
- [X] T009 [US1] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, add a test for a canary timeout: `inferenceTimeoutMs: 20`, the accelerated engine's canary `generate` resolves with a valid reply only after about 60 ms. Assert the reason contains `(timeout)`, and that the CPU loader was invoked only **after** the orphaned canary generation settled (record an ordering flag in the fake).
- [X] T010 [US1] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, add a test where the accelerated engine's `generate` throws on the canary. Assert fallback to CPU with a reason containing `(inference-error)` and that the thrown message text does not appear in the readiness `reason`.
- [X] T011 [US1] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, add a test for a CPU load failure after a failed verification: the CPU loader throws. Assert `infer()` returns an error response with category `LOAD_FAILED`, readiness is `unavailable` with a non-empty reason and **no** `acceleratorVerification` (an unavailable state carries no verification result; see data-model.md), the CPU loader was called exactly once (no hidden retry), a second `infer()` returns `NOT_READY` without calling any loader, and after `retryLoad()` the next `infer()` runs the canary again on a fresh accelerated engine (spec FR-014).
- [X] T012 [US1] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, add a test that with `useAccelerator: false` the loader is called exactly once with `"cpu"`, `generate` is not called before the real request, and `acceleratorVerification` is `undefined` in the readiness state (spec FR-007).
- [X] T013 [US1] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, add a test for FR-008: the accelerated engine's canary `generate` waits on a deferred promise; start two `infer()` calls concurrently; while the canary is pending, assert `getReadiness().state === "loading"` and the accelerated engine has received only the canary. Resolve the canary with garbage and assert both requests are then answered by the CPU engine in arrival order.
- [X] T014 [US1] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, add a logging test following the `captureLogs()` pattern in `backend/tests/unit/testDesign/enhanceTestModel.regression.test.ts` (spy on `console`, parse each line as JSON). Assert exactly one `accelerator_verification` record with `outcome`, `failureCategory`, a numeric `durationMs` and `canaryVersion`, and assert the canary input text and the fake engine's reply never appear anywhere in the captured output (constitution XX).
- [X] T015 [US1] Run `npm test -w backend -- tests/unit/ai/acceleratorVerification.test.ts tests/unit/ai/localProvider.accelerator.test.ts` and confirm the red state is the right one: the files import and compile (the T005 skeleton exists); the T006 pass-case rows fail because the stub always answers `unusable-reply`; T008 to T014 fail because the provider does not run a canary yet; and T007 and the pre-existing load-failure test still pass because the provider does not yet call the canary. A failure of any other kind (module not found, a type error, a typo) means the test, not the missing behavior, is wrong: fix it before continuing.

### Implementation for User Story 1

- [X] T016 [P] [US1] Complete `backend/src/ai/acceleratorVerification.ts` by replacing the T005 stub (the constants already exist and stay unchanged) with the real `evaluateCanaryReply(content: string): { passed: true } | { passed: false; failureCategory: "unusable-reply" }` per the rule in [data-model.md](data-model.md): `JSON.parse` succeeds, the value is a non-null non-array object, and its `candidates` is an array (empty allowed). It must catch the parse error and never throw. Type the failure category from `AcceleratorVerification["failureCategory"]` in `@apipilot/shared-domain` rather than redeclaring it. Add a header comment explaining that the wording is load-bearing (two natural phrasings make a healthy 0.5B model answer `{}`; see research Decision 2) and that any change must bump the version and re-run the opt-in real-model test. No inference-library, Express or filesystem imports.
- [X] T017 [US1] In `backend/src/ai/localProvider.ts` `loadTransformersEngine()`, add `dispose: async () => { await generator.dispose(); }` to the returned engine object (the pipeline exposes `dispose()` in `@huggingface/transformers` 4.3.1, `src/pipelines/_base.js`). Keep the library import confined to this function (CLAUDE.md section 15).
- [X] T018 [US1] In `backend/src/ai/localProvider.ts`, add a private method `verifyAccelerator(engine)` on `LocalProvider`. It records the start time, calls `engine.generate(ACCELERATOR_CANARY_INPUT, { maxNewTokens: ACCELERATOR_CANARY_MAX_NEW_TOKENS, expectedOutputFormat: "json" })`, bounds it with the existing `withTimeout(..., this.config.inferenceTimeoutMs)`, and returns an `AcceleratorVerification` (`passed`, or `failed` with `unusable-reply` from `evaluateCanaryReply`, `timeout` on `TimeoutError`, `inference-error` for any other throw). On a timeout it must **await the orphaned generation's settlement**, swallowing its outcome, before returning (the 12-token cap bounds the wait; research Decision 5). It must not return, store or log the reply or the input.
- [X] T019 [US1] In `backend/src/ai/localProvider.ts` `loadWithAcceleratorFallback()`, restructure the accelerated branch so that **only** the accelerated `loadEngine(..., "gpu", ...)` call stays inside the existing `try/catch` (so a load failure keeps its current behavior and notice). After that block, call `verifyAccelerator(engine)`. If `passed`: set `acceleratorActive = true`, `markReady({ ..., acceleratorActive: true, acceleratorVerification })`, log `load_success`, return the engine. If `failed`: log one `accelerator_verification` event (fields only `modelId`, `outcome`, `failureCategory`, `durationMs`, `canaryVersion`); set `acceleratorActive = false`; call `engine.dispose?.()` inside its own try/catch that logs only `errorCategory: error.name`; load the CPU engine **outside** the accelerator `try/catch` so that a CPU load failure propagates unchanged to `runInference`'s existing handler and is not retried; then `markReady({ ..., acceleratorRequested: true, acceleratorActive: false, acceleratorVerification, reason: \`Accelerator loaded but failed verification (${failureCategory}); using CPU inference instead\` })`. Also log the event on the passed path. Readiness stays `loading` throughout (it is only set by `markReady`). Never reference any provider other than the local one.
- [X] T020 [US1] Run `npm test -w backend -- tests/unit/ai` and `npx tsc -p backend/tsconfig.json --noEmit`, then `npx eslint` on the files changed so far. Confirm T006 to T014 pass, the original load-failure test is untouched and passing, and nothing else under `backend/tests/unit/ai` regressed.
- [X] T021 [P] [US1] In `backend/tests/integration/localProvider.real.test.ts`, add an opt-in case inside the existing `describe.runIf(REAL_MODEL_ENABLED)` block: load the configured model on CPU with the exported `loadTransformersEngine(config, "cpu")`, call `engine.generate(ACCELERATOR_CANARY_INPUT, { maxNewTokens: ACCELERATOR_CANARY_MAX_NEW_TOKENS, expectedOutputFormat: "json" })`, and assert `evaluateCanaryReply(reply).passed === true`. It is the calibration guard for research Decision 2 and must stay out of the ordinary suite (`npm run test:ai-real -w backend`).

**Checkpoint**: US1 is complete and independently testable with fake engines. This is the MVP: an unusable accelerator no longer breaks batches.

---

## Phase 4: User Story 2 - A user can see the device in use and how fast it is (Priority: P2)

**Goal**: Report the device in use, the accelerator label, the (null) adapter, and the verification outcome with a coarse throughput through `GET /api/ai/status`, additively.

**Independent Test**: With fake engines, load the provider with and without the accelerator and read the status route. It shows the device kind and, for a verified accelerator, a positive throughput; every existing field is unchanged.

### Tests for User Story 2 (write first)

- [X] T022 [P] [US2] In `backend/tests/integration/aiStatus.test.ts`, leave all existing tests unmodified and add tests using the file's existing `createAiStatusRouter(provider)` fake-provider pattern: (a) a `ready` accelerated state returns `inferenceDevice: "accelerator"`, `acceleratorLabel`, `acceleratorAdapter: null` and an `acceleratorVerification` object whose `failureCategory` is `null` and `tokensPerSecond` a number; (b) a `ready` CPU state returns `inferenceDevice: "cpu"`, `acceleratorLabel: null` and `acceleratorVerification: null`; (c) a failed-verification fallback returns `outcome: "failed"`, a non-null `failureCategory`, `tokensPerSecond: null` and a non-empty `reason`; (d) a state with none of the new fields (as every existing fixture and the mock provider produce) returns all four new fields as `null`; (e) the response never contains the canary text.
- [X] T023 [US2] In `backend/tests/unit/ai/localProvider.accelerator.test.ts`, add tests: (a) a verified accelerated load with a fake engine that provides `countTokens` yields `inferenceDevice: "accelerator"`, a non-empty `acceleratorLabel`, and `acceleratorVerification.tokensPerSecond` finite and greater than 0 (use a fake `countTokens` returning 4 and fake timers or a measured nonzero duration); (b) the same load with an engine **without** `countTokens` omits `tokensPerSecond` rather than estimating it; (c) a failed verification has no `tokensPerSecond` and `inferenceDevice: "cpu"`; (d) a plain CPU load has `inferenceDevice: "cpu"` and no verification; (e) the exported `acceleratorLabelForPlatform` returns `"DirectML"` for `win32` and the neutral `"Accelerator"` for `linux`, `darwin` and any other platform (no unverified vendor or runtime name is ever reported).

### Implementation for User Story 2

- [X] T024 [US2] In `backend/src/ai/localProvider.ts`: (1) add `countTokens: (text) => generator.tokenizer.encode(text).length` to the engine returned by `loadTransformersEngine()`; (2) export a pure `acceleratorLabelForPlatform(platform: NodeJS.Platform): string` that returns `DirectML` for `win32` (the only platform where the accelerator was measured) and the neutral `Accelerator` for every other platform, because the library resolves the generic `gpu` request per platform in ways this feature has not verified (per `@huggingface/transformers` `src/backends/onnx.js`, `gpu` filters to `webgpu`, `cuda` and `dml`, so on macOS it resolves to WebGPU, not CoreML, and CUDA applies only on Linux x64); keep it beside `resolveAcceleratorDevice()`; (3) in `verifyAccelerator`, when the canary passed and `engine.countTokens` exists, set `tokensPerSecond = countTokens(reply) / (durationMs / 1000)` only if the result is finite and greater than 0 (a coarse, cold, end-to-end sample, research Decision 6; never log the reply); (4) pass `inferenceDevice` and, for an active accelerator, `acceleratorLabel: acceleratorLabelForPlatform(process.platform)` to **every** `markReady` call in `loadWithAcceleratorFallback()`: `"cpu"` on the default CPU path and on both fallback paths, `"accelerator"` when the accelerator is kept; (5) include the label in the `accelerator_verification` log event; (6) correct the doc comment above `resolveAcceleratorDevice()` (around lines 172 to 181), which says Linux and macOS resolve to CUDA and CoreML "alone": rewrite it to say only what the library source shows and that only Windows/DirectML has been measured. Comment change only; no behavior change to that function.
- [X] T025 [US2] In `backend/src/api/aiStatus.ts`, add the four fields to the 200 response, mapping absent values to `null`: `inferenceDevice: readiness.inferenceDevice ?? null`, `acceleratorLabel: readiness.acceleratorLabel ?? null`, `acceleratorAdapter: readiness.acceleratorAdapter ?? null`, and `acceleratorVerification` as an object (`outcome`, `failureCategory ?? null`, `durationMs`, `tokensPerSecond ?? null`, `canaryVersion`) or `null`. Do not change any existing field, the error body, or the 405 handling; keep the route thin (no logic beyond mapping), per [contracts/ai-status-api-amendment.md](contracts/ai-status-api-amendment.md).
- [X] T026 [US2] Run `npm test -w backend -- tests/integration/aiStatus.test.ts tests/unit/ai` and `npx tsc -p backend/tsconfig.json --noEmit`; confirm T022 and T023 pass and every pre-existing `aiStatus` test passes unmodified (SC-006).

**Checkpoint**: US1 and US2 both work; `GET /api/ai/status` shows the device, label, `null` adapter and verification outcome.

---

## Phase 5: User Story 3 - The documentation states the accelerator is experimental and often slower (Priority: P3)

**Goal**: Replace the "straightforward speed option" framing with the measured reality, and document the verification and visible fallback.

**Independent Test**: Run quickstart scenario 8: each of the three named documents says experimental, the measured comparison with its conditions, and the verification and fallback.

For every doc task below, state the measurement with its conditions, taken from [research.md](research.md): measured 2026-10-17 on one Windows laptop (Intel integrated graphics plus an NVIDIA RTX 500 Ada with 4 GB VRAM), `onnxruntime-node` 1.30.0, `@huggingface/transformers` 4.3.1, each configuration in its own process. Qwen2.5-0.5B fp32 was correct but 2x to 4x slower than CPU on real enhancement prompts; Qwen3-1.7B (the default) returned unusable output on DirectML at fp32 and fp16 on both adapters. Say that results on other machines may differ, which is why the product verifies at run time.

Two further rules for every doc task below:

1. **Give the reported throughput something to be read against.** `acceleratorVerification.tokensPerSecond` is a coarse, cold, end-to-end canary sample (it includes a roughly 80-token prompt prefill against 4 generated tokens). Include the reference rates measured the same way on the reference laptop's CPU on 2026-10-17 (research.md Decisions 2 and 6): Qwen2.5-0.5B about 8.9 tokens/s (4 tokens in 0.45 s) and Qwen3-1.7B about 2.9 tokens/s (4 tokens in 1.4 s), and for contrast the 0.5B model on DirectML as the product itself reports it, a median of about 4.0 tokens/s (range 2.2 to 4.5 over 20 loads). Say plainly that the figure is for noticing order-of-magnitude differences, not benchmarking, and that the status does not itself compare against CPU.
2. **Do not claim platform behavior that was not measured.** The existing sentences "Linux uses CUDA where available and macOS uses CoreML where available" (`docs/configuration.md`, `docs/architecture.md`, `.env.example`) are not supported by the library source: for the generic `gpu` request it filters to `webgpu`, `cuda` and `dml`, so macOS resolves to WebGPU and CUDA applies only on Linux x64. Replace them with what is known: Windows requests DirectML (measured); on Linux and macOS the library chooses per platform and ApiPilot has not measured it, so the status `acceleratorLabel` is the generic `Accelerator` there.

- [X] T027 [P] [US3] Update the `AI_USE_ACCELERATOR` comment in `.env.example` (around lines 171 to 180): mark it experimental, say it was measured slower than CPU for the shipped models, say it is verified after loading and falls back to CPU with a visible reason, and point to `GET /api/ai/status` (`inferenceDevice`, `acceleratorVerification`). Keep the value `false`. Fix the "macOS uses CoreML" sentence (around line 178) per rule 2 above. Do not change any other line (the `AI_MODEL_ID` comment must remain consistent with the code default).
- [X] T028 [P] [US3] Update `docs/configuration.md`: the `AI_USE_ACCELERATOR` table row and the paragraph after the table (around line 36), covering experimental status, the measured comparison, the post-load verification, the CPU fallback and its reason, the status fields, the CPU reference throughput (rule 1), and the corrected platform sentence (rule 2).
- [X] T029 [P] [US3] Update `docs/architecture.md` in the accelerator and fallback passages (around lines 340 to 390): describe the one-off canary, the three failure categories, that readiness stays `loading` until the device decision, the CPU fallback and the retained verification result, that the accelerator is never replaced by another provider, the measured comparison, the CPU reference throughput (rule 1), and fix the "CoreML on macOS" sentence (around line 388) per rule 2.
- [X] T030 [P] [US3] Update the `/api/ai/status` row in `docs/http-api.md` (line 13) to mention the device, accelerator label, adapter (always `null` for now) and verification fields.
- [X] T031 [P] [US3] Append an amendment note to `specs/004-ai-provider-local-inference/contracts/ai-status-api.md`, in the style of its existing "Amendment note" (025), pointing to `specs/055-accelerator-canary-check/contracts/ai-status-api-amendment.md`, naming the four additive fields and stating that no existing field changed.
- [X] T032 [P] [US3] Add a one-line "Extended by `specs/055-accelerator-canary-check` (post-load verification)" note after FR-008 in `specs/004-ai-provider-local-inference/spec.md`. Do not alter FR-008's own text.
- [X] T033 [US3] Run quickstart scenario 8 (the two `rg` commands) and confirm the three named documents and the HTTP reference satisfy it.

**Checkpoint**: All three stories are complete and documented.

---

## Phase 6: Polish and Cross-Cutting Concerns

- [X] T034 Run the full validation from the repository root: `npm test`, `npm run lint`, `npm run build` (CLAUDE.md section 54). Report each result honestly, and do not weaken any config or disable any test to pass.
- [X] T035 On a machine where an accelerator can be enabled (the reference laptop, Windows with DirectML), run quickstart scenarios 4 to 6. Record the measured `acceleratorVerification.durationMs` for the failing configuration (Qwen3-1.7B fp32 with `AI_USE_ACCELERATOR=true`) and for the healthy one (Qwen2.5-0.5B fp32). Replace the "estimate" wording in `research.md` Decision 4 and the first open item in `plan.md` with the measured figures. If the failing path exceeds 15 000 ms (SC-005), stop and revisit the 12-token cap before continuing. If no accelerator machine is available, say so explicitly in the report instead of claiming SC-005 passed.
- [X] T036 Add the roadmap entry in `specs/ROADMAP.md` after the current last numbered entry (currently `99. **AP-053 ...; version 19.56.0**`): number, `AP-055: Accelerator verification and visibility; version 19.57.0 (2026-10-17)`, a short factual summary, the measured numbers from research.md, what was not covered (Linux and macOS are unmeasured; throughput is coarse), and the version. Check first whether another branch (notably `AP-054`) has already taken the next entry number or version, and resolve the numbering at merge time rather than guessing.
- [X] T037 Bump the version with `npm run version:bump -- feature` (19.56.0 to 19.57.0 across the root, backend, frontend and shared-domain `package.json` files; the script also updates `package-lock.json`, so do not edit the lockfile by hand or run a full install). Confirm all four versions match the roadmap entry.
- [X] T038 Review the final diff against the spec, plan and checklist: only the files listed in plan.md changed; no formatter-induced churn; no `any` or new lint suppressions; no canary input or reply in any log or response; no new dependency, environment variable or frontend change; `acceleratorAdapter` is `null` in every response. Leave everything uncommitted and summarize what changed so it can be reviewed.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; **blocks all user stories**. T002 to T005 touch different files, but T003, T004 and T005 use T002's types, so run T002 first; T003, T004 and T005 can then run in parallel.
- **US1 (Phase 3)**: after Foundational.
- **US2 (Phase 4)**: after Foundational **and after US1's implementation (T018 and T019)**. Its throughput comes from the canary US1 runs, and both stories edit `localProvider.ts` and `localProvider.accelerator.test.ts`.
- **US3 (Phase 5)**: independent of the code; can start once `research.md`'s measurements are final (they are). Its wording should be checked against the final behavior at T033.
- **Polish (Phase 6)**: after the stories you intend to ship. T035 needs an accelerator machine.

### Within each story

- Tests first, confirmed failing (T015) before implementation.
- `acceleratorVerification.ts` (T016) before the provider uses it (T018, T019).
- T017, T018 and T019 all edit `backend/src/ai/localProvider.ts`: sequential.
- T024 edits `localProvider.ts` again: after T019.

### Parallel Opportunities

- T003, T004 and T005 (after T002).
- T006 and T016 (new, separate files) alongside the sequential `localProvider.accelerator.test.ts` tasks.
- T021 (real-model test) in parallel with T020.
- T022 (status test) in parallel with T023 only if two people split the two test files; both precede T024 and T025.
- All of T027 to T032 (six different files).

## Parallel Example: User Story 3

```text
Task: "Update the AI_USE_ACCELERATOR comment in .env.example"
Task: "Update docs/configuration.md"
Task: "Update docs/architecture.md"
Task: "Update the /api/ai/status row in docs/http-api.md"
Task: "Append an amendment note to specs/004-ai-provider-local-inference/contracts/ai-status-api.md"
Task: "Add an extension note after FR-008 in specs/004-ai-provider-local-inference/spec.md"
```

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 and Phase 2.
2. Phase 3 (US1), stopping at its checkpoint.
3. **Validate**: with fake engines, a garbage accelerator falls back to CPU with a visible reason, and the default configuration is unchanged. If you want the fix in users' hands before anything else, this is the shippable slice. Run T034 at that point.

### Incremental Delivery

1. Setup, Foundational, then US1 (MVP: batches stop failing).
2. Add US2 (visibility), test, validate.
3. Add US3 (documentation) alongside or after US2.
4. Polish: full validation, SC-005 measurement on an accelerator machine, roadmap, version, diff review.

## Notes

- The change is small and local. Resist adding a setting, a CPU-baseline comparison, per-vendor logic or frontend work; each is explicitly out of scope in spec.md.
- If a task's test cannot be made to fail first (T015), the test is not testing the new behavior; fix the test.
- Stop at any checkpoint to validate independently.
- Never commit: the changes stay in the working tree for review.
