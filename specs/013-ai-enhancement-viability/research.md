# Phase 0 Research: AI Enhancement Viability on Local CPU Inference

**Feature**: `013-ai-enhancement-viability`
**Date**: 2026-09-06

All measurements below were taken on the machine where the defect was reported: Windows 11,
CPU-only, no accelerator, `AI_PROVIDER_MODE=local`, model
`onnx-community/Qwen2.5-0.5B-Instruct`. Reproduction instructions are in
[quickstart.md](./quickstart.md).

## Measurement Baseline

Two probes were run against the real inference path before any design decision was taken.

**Probe A — full enhancement prompt** (`backend/tests/fixtures/openapi/valid.yaml`, 3 operations,
26 deterministic scenarios), using the shipped configuration `dtype=q8`:

| Metric | Value |
| --- | --- |
| Prompt | 22,095 chars / 5,845 tokens |
| Tokenizer `model_max_length` | 131,072 |
| Model `max_position_embeddings` | 32,768 |
| Engine load (warm cache) | 12.7 s |
| Generate 32 tokens | 158,354 ms |
| Generate 128 tokens | 349,366 ms |

Solving the two generation timings as `total = prefill + n x decode` yields **prefill ≈ 94 s**
and **decode ≈ 1.99 s/token**. Both runs hit their cap exactly — the model never emitted a stop
token. Sample output began `,"outputFormat":"json","outputType":"list",...`: a literal
continuation of the prompt's JSON, not an answer.

**Probe B — 2x2, prompt framing against weight precision**, deliberately using a short (52–77
token) prompt so that decode rate is measured independently of prefill cost:

| Precision | Framing | Wall time | Tokens | Rate | Stopped early | Output |
| --- | --- | --- | --- | --- | --- | --- |
| q8 | raw JSON *(shipped)* | 47,942 ms | 96 | 2.00 tok/s | no | `"Please translate this into English..."` — off-task |
| q8 | chat template | 47,674 ms | 96 | 2.01 tok/s | no | JSON shaped, but invented `name`/`age`/`occupation` |
| fp32 | raw JSON | 10,211 ms | 82 | 8.03 tok/s | yes | `,"responseType":"json"}]` fragment, then JSON — unparseable |
| **fp32** | **chat template** | **7,364 ms** | **58** | **7.88 tok/s** | **yes** | `{"candidates":[{"candidateId":"1","rationale":"Pet needs attention"}]}` — exactly the requested shape |

fp32 first-load (cold, 1.7 GB download) took 190 s; warm loads are comparable to q8.

Two independent effects, both confirmed:

- **Framing** determines whether the model performs the task and whether it can stop. Only the
  chat-templated rows produced the requested structure; only they can reach the stop token.
- **Precision** determines speed and, secondarily, quality. fp32 is **4x faster** than q8 here.

The shipped configuration is the worst cell of the four on both axes.

---

## Decision 1: Apply the tokenizer's chat template inside the local provider

**Decision**: `loadTransformersEngine()` applies `tokenizer.apply_chat_template()` with a system
message and the caller's `input` as the user message, `add_generation_prompt: true`, when the
loaded tokenizer declares a `chat_template`. Models without one receive the raw string exactly as
today. The system message is selected from the existing `InferenceRequest.expectedOutputFormat`
field (`"json"` vs `"text"`); no field is added to the contract.

**Rationale**: The defect is that an instruction-tuned model is addressed as a text-completion
model. `pipeline("text-generation")` applies a chat template only for a messages array, never for
a plain string, so the framing must be applied by whoever knows a chat template exists. That is
the provider: it loaded the tokenizer and can read `chat_template` from it. Placing it here
satisfies FR-003 for free — all four `infer()` call sites (`enhanceTestModel`,
`analyzeDependencies`, `regenerateReviewScenario`, `runBenchmark`) are corrected at once, with no
change to any of them.

`expectedOutputFormat` already exists and already means what is needed, so constitution VI (AI
Provider Independence) is preserved: callers keep expressing intent, and *how* that intent is
framed for a particular runtime stays behind the provider boundary.

**Alternatives considered**:

- *Add a `systemPrompt` field to `InferenceRequest`* — rejected. It pushes model-runtime framing
  concerns into a shared domain contract that both frontend and backend consume, inverting
  constitution VI, for no capability gain over `expectedOutputFormat`.
- *Chat-format inside `buildAIScenarioPrompt`* — rejected. It fixes one call site and leaves three
  on the defective path, violating FR-003, and hard-codes ChatML markers into domain code.
- *Switch to a base (non-instruct) model to match the raw-continuation prompting* — rejected.
  Probe B shows the instruct path produces exactly the required structure; abandoning it to
  preserve a defect is backwards.

**Consequence for XXIII (Version AI Contracts)**: this materially changes the bytes sent to the
model, so `AI_SCENARIO_RESPONSE_VERSION` is incremented and the change is recorded as a prompt
contract change, not a silent behaviour drift.

---

## Decision 2: Derive context window from the model config, not the tokenizer

**Decision**: `loadTransformersEngine()` resolves the context window as
`min(model.config.max_position_embeddings, tokenizer.model_max_length)`, treating a missing or
non-finite value on either side as "use the other", and both missing as `undefined`. When
`undefined`, `getInputBudget()` returns a conservative fixed floor (see Decision 3) rather than
`undefined`.

**Rationale**: The measured discrepancy is 131,072 (tokenizer) against 32,768 (model). The
tokenizer's value is an artifact of the tokenizer config and does not constrain the model's RoPE
positional range; exceeding the model value is precisely what produces the opaque Gather crash
that the existing guard in `loadTransformersEngine()` was written to prevent. Taking the minimum
is correct under either being wrong in either direction, and needs no per-model table.

Because `getInputBudget()` and the exact guard both read this one resolved value, FR-008's
"planning and enforcement cannot disagree" holds structurally rather than by convention.

**Impact**: the budget falls from ~390,000 chars to `(32768 - 1024 - 64) x 3 ≈ 95,000` chars, so
`splitOperationsIntoBatches` begins to split real specifications and the `011`/`012` batching and
progress machinery becomes reachable for the first time. Note this alone does **not** make the
Pet Store fixture multi-batch (22 KB fits in 95 KB) — Decision 4 addresses the real cost driver.

**Alternatives considered**:

- *Keep reading `model_max_length` and subtract a bigger safety margin* — rejected. The margin
  needed would be 98,304 tokens, a magic number encoding "the source is wrong" rather than fixing
  the source.
- *Hard-code known context windows per model id* — rejected. It breaks on the first unlisted
  model and duplicates information the loaded artifacts already carry.

---

## Decision 3: Conservative fallback when capacity is unknown

**Decision**: when neither config exposes a usable context window, `getInputBudget()` returns a
budget derived from a conservative floor of **2,048 tokens** rather than returning `undefined`.

**Rationale**: `undefined` currently means "unknown, assume it fits", which is an optimistic
default that FR-006 forbids. 2,048 tokens is at or below the context window of essentially every
current instruction-tuned model, so assuming it is safe; the cost of being too conservative is
extra batches, which the system already handles correctly, whereas the cost of being too
optimistic is the opaque native crash. This inverts a fail-open default into a fail-safe one, per
constitution XIX.

`MockProvider` continues to return `undefined` (no limit) unless a test fixes a value — this
decision applies to the local provider only, so no existing test's batching behaviour changes.

---

## Decision 4: Slim the enhancement prompt to an operation contract summary

**Decision**: `buildAIScenarioPrompt` sends a purpose-built projection instead of the full
`ApiModel` and full `TestModel`:

- **Per operation**: path, method, `operationId`, parameters (name, location, required, type,
  enum, and boundary constraints), request-body schema reduced to field name / type / required /
  enum / constraints, and the documented response status codes. Descriptions, examples, tags,
  server blocks, security blocks, and unreferenced component schemas are dropped.
- **Baseline**: replaced by a compact list of the category plus target field of each existing
  scenario, so the model can avoid re-proposing them, instead of the full scenario objects with
  their requests, assertions, and provenance.
- Schemas are emitted once and referenced, rather than re-expanded per operation as `$ref`
  dereferencing currently causes.

**Rationale**: prefill is ~94 s of the measured cost and scales with prompt size, so this is the
single largest lever on wall-clock time. The dropped material is not what the model needs: it is
asked to propose *semantic* scenarios, for which the contract shape suffices. What it must not
lose is anything used to verify groundedness — `validateAICandidateSemantics` checks a candidate's
operation, fields, and constraints against the `ApiModel`, and that validation continues to run
against the **full** `ApiModel`, not the projection. So FR-010 holds: the model may see less, but
nothing it proposes is accepted on weaker evidence than today.

Expected reduction on the Pet Store fixture is roughly 5-10x (22 KB to ~2-4 KB), taking prefill
from ~94 s to single-digit seconds. The exact factor is to be measured during implementation and
recorded, not assumed.

**Alternatives considered**:

- *One operation per request always* — rejected. It multiplies fixed per-request overhead by the
  operation count and discards the batching design from `011` rather than using it.
- *Summarise the baseline with the AI* — rejected outright: it spends the scarce resource to save
  the scarce resource, and inserts an unvalidated inference upstream of validation (constitution
  III, IV).
- *Truncate the prompt to fit* — rejected. Silent truncation mid-JSON is exactly the "silent
  assumption" constitution XIV forbids, and would corrupt groundedness unpredictably.

---

## Decision 5: Default to fp32; record the evidence; keep `dtype` configurable

**Decision**: the documented default `AI_MODEL_DTYPE` becomes **unset**, which Transformers.js
resolves to fp32 on CPU — matching the fastest, most accurate measured cell. `.env.example` gains
an explicit warning that `q8` measured 4x slower on CPU. The benchmark harness is extended to
record `dtype` as a first-class dimension so the comparison is reproducible rather than anecdotal,
and `specs/004-ai-provider-local-inference/benchmark-results.json` is regenerated with prompts
representative of the enhancement workload.

**Rationale**: constitution VII requires model decisions to be evidence-driven, and the current
`q8` setting is the clearest possible counter-example — it was chosen to reduce footprint and
instead made inference 4x slower and less accurate. The existing recorded evidence
(`structuredOutputSuccessRate: 0.333`, `averageLatencyMs: 12654`) was gathered on single-sentence
prompts at a 256-token cap and cannot support a decision about this workload; leaving it in place
while changing behaviour would violate XXII.

**Trade-off, recorded per constitution XXX**: fp32 costs ~1.7 GB of download and disk against
q8's ~0.5 GB, and more resident memory. This is accepted because the saving was measured to be a
false economy — it bought a 4x slowdown and worse structured output on the only hardware profile
the project targets. Users who need the smaller footprint retain `AI_MODEL_DTYPE=q8` and the
documentation states the cost plainly.

**Alternatives considered**:

- *Keep q8 and raise the timeout* — rejected. It preserves a setting measured to be worse on both
  axes and pushes the user experience further in the direction that caused this specification.
- *Default to q4* — rejected as unmeasured. Adopting a third precision on speculation is the exact
  practice VII prohibits; it becomes a candidate in the re-benchmark, not a default.

---

## Decision 6: Pre-flight viability estimate

**Decision**: before the first batch, compute
`projectedMs = (promptTokens x prefillMsPerToken) + (maxOutputTokens x decodeMsPerToken)` per
batch and compare the total against `inferenceTimeoutMs`. If a batch's projection exceeds its
budget, refuse before calling `infer()`.

Rate constants are **calibrated at runtime, not hard-coded**: the provider records actual
prefill and decode rates from each completed inference in an exponentially-weighted moving
average, seeded with conservative defaults measured here (2.0 ms/token prefill, 130 ms/token
decode — the fp32 figures with headroom). Seeds are configuration, not literals in domain code.

**Rationale**: FR-014 requires refusing in seconds rather than burning the budget. A projection
cannot be exact — hardware varies by an order of magnitude — but it does not need to be: it needs
to catch the case measured here, where the projection exceeds budget by ~7x. Self-calibration
means the estimate improves on the machine it is running on rather than encoding one laptop's
characteristics forever.

The estimate must be **conservative in the direction of allowing work**: it refuses only when
projection exceeds budget by a configurable safety factor (default 1.5x), so a marginal
misestimate does not block a run that would have succeeded. A run that passes pre-flight and then
times out anyway remains handled exactly as today.

**Determinism note**: the EWMA makes projections machine- and history-dependent, which would
violate FR-028 if it could affect *output*. It cannot — it gates only whether a run is attempted,
and never changes prompt content, candidate validation, dedup order, or retained scenarios. Tests
inject fixed rates, so the decision is deterministic under test (constitution XXI, XXIV).

**Alternatives considered**:

- *Static hard-coded rate constants* — rejected. Wrong by an order of magnitude across the
  hardware range, refusing viable runs on fast machines and admitting hopeless ones on slow ones.
- *Trial generation of ~10 tokens to measure, then decide* — rejected for the first run (it costs
  a real prefill, the dominant expense) but effectively obtained free from the first completed
  batch, which is what the EWMA does.

---

## Decision 7: Cooperative cancellation with a hard resource stop

**Decision**: cancellation operates at two levels.

1. **Between batches (cooperative, precise)**: the run checks a cancellation flag before each
   batch, exactly where `isTimedOut` is already checked in `runBatchedInference`. Remaining
   batches become `not-attempted`; completed batches' scenarios are retained.
2. **Within a batch (bounded, imprecise)**: an in-flight `generate()` cannot be interrupted —
   Transformers.js exposes no abort signal and the ONNX call is synchronous native work. The user
   is released immediately (the HTTP request resolves, the UI returns to an interactive state),
   and the orphaned computation is prevented from harming the *next* run rather than being killed.

For (2), `LocalProvider` tracks in-flight generations and `RequestQueue` will not start a new task
until the previous one's underlying promise has settled, so a retry can no longer run concurrently
with abandoned work — the CPU-contention defect in FR-017. The abandoned run's result is discarded
on arrival.

**Rationale**: FR-020 requires the user to regain control promptly; FR-017 requires abandoned work
to stop competing. These are separable, and only the first is achievable instantly. Honest
partial capability beats a cancel button that claims more than it delivers (constitution XIV,
XIX). The spec's Assumptions section already anticipates this limit.

`max_new_tokens` after Decisions 1 and 4 is small enough (early stopping typically at 50-200
tokens) that the worst-case orphan window shrinks from ~34 minutes to seconds.

**Alternatives considered**:

- *Run inference in a worker thread and terminate it* — rejected for this feature. It would give
  true cancellation, but introduces a process/thread lifecycle, model reload cost per worker, and
  a substantially larger surface than the defect warrants (constitution XXVII). Recorded as a
  known limitation and a candidate follow-up.
- *`TransformerS.js` `stopping_criteria` callback* — investigated; it is evaluated between tokens
  and so would work for cancellation, but not for the prefill phase where most abandoned time is
  spent. Worth adopting as an incremental improvement inside (2); noted for tasks, not relied on.

---

## Decision 8: Extend `AiEnhancementProgress` with phase and elapsed time

**Decision**: add to `AiEnhancementProgress`:

- `phase: "preparing" | "generating"` — `"preparing"` while the engine loads, `"generating"`
  thereafter.
- `preparingSince` / `generatingSince` ISO timestamps, so the client derives elapsed time itself
  rather than the server pushing a ticking value.
- `cancelRequested: boolean`.

`012`'s FR-005 (hide progress entirely when `totalBatches <= 1`) is **superseded**: the batch
*list* stays hidden for a single batch, but phase and elapsed time are shown for every run. The
client renders elapsed time from `generatingSince` on its existing 2-second poll.

**Rationale**: FR-018/FR-019 require preparation to be distinguishable and elapsed time visible
including single-batch runs. `012` wrote FR-005 on the assumption that single-batch runs were the
fast case not needing progress; the capacity defect (Decision 2) had silently made single-batch
the *only* case, so that rule was suppressing progress for 100% of real runs. Superseding it is a
correction of a premise, and is recorded as such rather than as a reversal.

Deriving elapsed time client-side from a timestamp keeps the server's state a pure function of run
progress — no per-second mutation, no new endpoint, and the existing poll and concurrency guard
are untouched.

**Alternatives considered**:

- *Server-sent events / WebSocket for progress* — rejected. The 2-second poll from `012` already
  satisfies the requirement; a transport change is unrelated scope (constitution XXVII).
- *Server sends `elapsedMs`* — rejected. It makes every poll response differ, defeats caching, and
  ties displayed smoothness to poll frequency.

---

## Decision 9: Separate user-facing explanation from internal diagnostics

**Decision**: introduce a pure mapping from `(AIErrorCategory, context)` to a
`FailureExplanation { category, summary, nextStep }` in the backend domain layer, surfaced on the
workflow stage alongside the existing `aiErrorCategory`. `aiErrorMessage` retains the internal
string for logs and is **no longer rendered** by the frontend, which renders `summary` and
`nextStep`.

Mapping (FR-023's three required categories plus the pre-flight refusal):

| Category | Summary | Next step |
| --- | --- | --- |
| `TIMEOUT` | The local model was too slow to finish this on this machine. | Try a smaller specification, or see the setup notes on making local inference faster. |
| pre-flight refusal | This specification needs more time than the current limit allows. | States the projected time against the configured limit and what to change. |
| `NOT_READY`, `LOAD_FAILED`, `PROVIDER_UNAVAILABLE` | The local AI model isn't available right now. | Names the readiness reason in plain language; offers retry only when retry could plausibly differ. |
| `INVALID_RESPONSE` | The model replied with output that couldn't be used. | Retry is genuinely worth offering here. |
| `INVALID_REQUEST` | Part of this specification is too large for the model to process. | Names the offending operation. |
| cancelled | Cancelled before it finished. | Any scenarios already generated have been kept. |

**Rationale**: FR-024 forbids leaking internals, and the reported message
(`"Inference exceeded the configured timeout of 300000ms"`) leaks an implementation constant while
offering no action. FR-025 additionally forbids offering a retry that cannot help — the current UI
offers "Retry AI enhancement" identically for every category, which after a TIMEOUT under
unchanged conditions is a guaranteed repeat. The mapping is a pure function, so it is directly
unit-testable (constitution XXI), and keeping the internal string for logs preserves diagnostics
under constitution XX.

**Alternatives considered**:

- *Map to user-facing text in the frontend* — rejected. It would duplicate domain knowledge about
  error semantics into the presentation layer (constitution IX, X) and diverge across surfaces.
- *Replace `aiErrorMessage` outright* — rejected. It would delete diagnostic information that logs
  and support depend on; the two are additive.

---

## Decision 10: Cancellation introduces no new terminal stage status

**Decision**: a cancelled run resolves to the existing `skipped` (nothing retained) or `partial`
(something retained) statuses, distinguished by a `cancelled: true` marker on the stage rather
than by a new `StageStatus` member.

**Rationale**: FR-016 and FR-030 require `011`'s outcome semantics to be preserved. `StageStatus`
is consumed by the workflow store's transition validator, the API contract, the frontend, and
several test suites; adding a member would force every consumer to handle it and would change a
shared contract for a distinction that is presentational. A boolean marker carries exactly the
information FR-021 needs — "report cancelled distinctly from failed" — at the display layer where
that distinction matters.

**Alternatives considered**:

- *Add `"cancelled"` to `StageStatus`* — rejected as a breaking shared-contract change
  (constitution: prefer additive), disproportionate to the need.
- *Reuse `skipped` with no marker* — rejected. It fails FR-021: the user could not tell their own
  cancellation apart from a model failure.

---

## Resolved Unknowns

| Unknown from Technical Context | Resolution |
| --- | --- |
| Why the model never stops early | No chat template applied; ChatML stop token `<\|im_end\|>` unreachable (Decision 1, measured) |
| Whether the default model must be replaced | No — fp32 + chat template produced the exact requested structure in ~7 s (Decision 5, measured) |
| True context window source | `min(max_position_embeddings, model_max_length)` (Decision 2, measured discrepancy 32,768 vs 131,072) |
| Generation-rate constants for pre-flight | Runtime EWMA seeded from measured fp32 rates (Decision 6) |
| Whether in-flight inference can be cancelled | No; cooperative between batches, resource-stop within (Decision 7) |
| How to show elapsed time without server churn | Client derives from server timestamps on the existing poll (Decision 8) |
| Whether cancellation needs a new stage status | No (Decision 10) |

## Known Limitations Carried Forward

- Cancellation cannot interrupt an in-flight native computation; the user is released immediately
  but a short orphan window remains (Decision 7). True cancellation requires worker-thread
  isolation, deliberately deferred.
- The pre-flight estimate is an approximation and will occasionally admit a run that then times
  out. That path remains handled by the existing timeout behaviour, now with an actionable message.
- fp32 increases model download and memory footprint (Decision 5), an explicitly accepted trade.

---

## Post-Fix Measurement (T070)

Measured on the same machine and fixture as the baseline above, after implementing Decisions
1-5 and 8-10, with `AI_MODEL_DTYPE` unset (fp32) and `AI_INFERENCE_TIMEOUT_MS=60000`.

| Metric | Before | After |
| --- | --- | --- |
| Context window resolved | 131,072 (tokenizer) | **32,768** (`capacitySource: "model-config"`) |
| Prompt size | 22,095 chars / 5,845 tokens | **1,985 chars / ~522 tokens (11.0x smaller)** |
| Model preparation | folded into an undifferentiated wait | **5.8 s, reported as its own phase** |
| Inference outcome | `TIMEOUT` at 300,808 ms | **`inference_success` at 46,097 ms** |
| Deterministic baseline | preserved | **preserved (26/26 scenarios, verified)** |
| Automated suite | 620 passed / 1 failed | **622 passed / 0 failed** |

**The reported defect is fixed and verified**: the stage no longer times out. Inference completes
in well under its budget, on the specification and hardware where it previously could not complete
at all.

### Remaining defect, now visible: structured-output reliability

With the timeout removed, the run reaches a different failure — `INVALID_RESPONSE`, 0 candidates
retained. The timeout was previously masking it. Raw output captured directly from the provider
shows two independent causes:

1. **Malformed JSON.** The model emits unquoted object keys, e.g.
   `{"name": "status", "type": "string", enum: ["available", ...]}`. This is not valid JSON at any
   length and no output allowance fixes it.
2. **Truncation.** At 256 tokens the reply was cut mid-document; raising to 384 and bounding the
   request to "at most 3 candidates" moved the cut but did not eliminate it, because the model
   spends ~150 tokens per candidate restating request-body schemas it was given.

Two repairs were made and are worth keeping regardless: markdown code fences are now stripped
before parsing (the model reliably wraps JSON in ```json despite being told not to, and unwrapping
discards no content), and an absent `responseVersion` is treated as current rather than rejected.
Neither is sufficient on its own.

**This is not a regression and not a new problem.** It is the structured-output reliability that
`specs/004-ai-provider-local-inference/benchmark-results.json` already recorded for this model as
`structuredOutputSuccessRate: 0.333`, measured on far simpler prompts. The timeout defect meant it
had never been reachable in practice.

**It is deliberately not fixed by further prompt iteration.** Constitution VII and XXII require
model and model-configuration decisions to rest on evidence gathered against a representative
corpus, not on ad-hoc tuning: each iteration here costs ~50 seconds and optimises against a single
specification, which is precisely the practice those principles exist to prevent. The path forward
is T025/T026/T066 — extend the benchmark harness to cover this workload and record `dtype` and
candidate-schema variants — and to let that evidence decide between constraining the response
schema further (fewer fields per candidate), requesting one candidate per call, and adopting a
model with stronger JSON adherence.

Tracked as **T072**. Success criterion SC-001 is therefore **not yet met**; SC-002 through SC-005
and SC-009 through SC-011 are met or are covered by passing tests.
