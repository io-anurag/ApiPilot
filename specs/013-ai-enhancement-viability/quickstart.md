# Quickstart: Validating AI Enhancement Viability

**Feature**: `013-ai-enhancement-viability`

Unlike most features in this repository, this one is a **defect fix whose defining symptom only
appears with a real model**. The automated suite (mock provider) proves the logic; only the
real-model steps prove the defect is gone. Both are required.

## Prerequisites

- Repository dependencies installed (`npm install` at repo root).
- Steps 1-4 need **no** model download — they use `MockProvider` and test doubles
  (constitution XXI).
- Steps 5-7 need a real local model and are the ones that actually validate the fix.

---

## 1. Establish the baseline before changing anything

```bash
npm test
```

Record the pass count. Every existing test from `004`, `005`, `011`, and `012` must still pass at
the end — this feature corrects defects in those features' plumbing without changing their
contracts.

## 2. Model capacity is derived correctly (FR-005 - FR-008)

```bash
npm test -w backend -- tests/unit/ai/localProvider.test.ts
```

Confirm:

- Capacity resolves to `min(max_position_embeddings, model_max_length)` — with the measured values
  32,768 and 131,072, the result is **32,768**, not 131,072.
- Both sources missing yields the conservative 2,048-token floor with `isFallback: true`, never
  `undefined` (FR-006).
- `getInputBudget()` and the oversized-input guard read the *same* resolved value, so they cannot
  disagree (FR-008).

## 3. Pre-flight refuses the unviable, admits the marginal (FR-014 - FR-016)

```bash
npm test -w backend -- tests/unit/ai/viability.test.ts
```

Confirm with **injected** rates (never measured live — the estimate must be deterministic under
test):

- The measured defect refuses: 5,845 prompt tokens, 1,024 output tokens, q8 rates, 300,000 ms
  budget → projected ≈ 2,060,000 ms, ratio ≈ 6.9x, `viable: false`.
- A run projected just over budget but inside the 1.5x safety factor is **admitted**, not refused.
- A refusal yields `failureExplanation.category === "not-viable"` and the stage resolves to
  `skipped` — with **no** new `StageStatus` member (research.md Decision 10).

## 4. Failure explanations are user-facing (FR-023 - FR-026)

```bash
npm test -w backend -- tests/unit/testGenerationWorkflow/failureExplanation.test.ts
npm test -w frontend
```

Confirm:

- Every `AIErrorCategory` plus `"cancelled"` and `"not-viable"` maps to an explanation (total
  function).
- No `summary` or `nextStep` contains a category literal, error-class name, environment variable
  name, file path, model id, or bare millisecond value — asserted against a deny-list.
- `retryable` is `false` for `too-slow`, `not-viable`, and `too-large`.
- The frontend renders `summary`/`nextStep` and **never** `aiErrorMessage`.
- The frontend shows `phase`, a live elapsed timer, and a cancel control — including for a
  **single-batch** run, which `012` FR-005 previously hid entirely (use fake timers, constitution
  XXIV).

---

## 5. Real-model validation — the defect reproduction

**This is the step that proves the feature works.** It is also the step that failed as `T025` in
`012`, which is what produced this specification.

### 5a. Reproduce the original failure (optional, on the pre-fix commit)

With `AI_MODEL_DTYPE=q8` and `AI_INFERENCE_TIMEOUT_MS=300000`, upload
`backend/tests/fixtures/openapi/valid.yaml` and click "Enhance with AI". Observe the reported
symptom: about five minutes of an unchanging "Enhancing…" label, then
`errorCategory: "TIMEOUT"`, `durationMs` ≈ 300,800, stage `skipped`, HTTP `200`.

### 5b. Confirm the corrected behaviour

Set configuration per the updated `.env.example` — **leave `AI_MODEL_DTYPE` unset** (research.md
Decision 5; `q8` measured 4x slower on CPU):

```bash
npm run dev
```

Upload the same Pet Store fixture and run AI enhancement. Confirm:

- **It completes** (SC-001) — an outcome the feature has never achieved.
- The model **stops on its own** (SC-003): observed output is shorter than the allowance, not
  exactly equal to it. The pre-fix signature was hitting the cap precisely, every time.
- Generated output is the requested structure, not a continuation of the prompt's JSON. The pre-fix
  signature was output beginning with a comma, e.g. `,"outputFormat":"json"`.
- AI-derived scenarios appear in the review workspace with AI provenance intact (FR-029).
- Prompt size is reduced roughly 5-10x from the measured 22,095 characters (FR-009). **Record the
  realised figure** — the plan commits to measuring it, not assuming it.

### 5c. Confirm multi-batch behaviour is finally reachable (SC-004)

Use a specification large enough to exceed 32,768 tokens. Confirm `totalBatches > 1` and that the
per-batch progress from `012` renders. Before this fix the inflated budget (~390,000 chars) made
this unreachable for any realistic input.

## 6. Cancellation (FR-020, FR-021, SC-008, SC-011)

Start a run on a larger specification and cancel mid-run. Confirm:

- Interactive control returns within 5 s.
- The outcome reads as **cancelled**, not failed.
- Scenarios from already-succeeded batches are kept, along with any review decisions on them.
- The deterministic baseline is untouched (SC-010).
- Watch CPU: after cancelling, usage returns to baseline and a **new** run is not slowed by the
  abandoned one (SC-011, FR-017) — the contention defect from the original report.

## 7. Re-run the benchmark with evidence (FR-013, constitution VII, XXII)

```bash
npm run ai:benchmark -w backend
```

Confirm `specs/004-ai-provider-local-inference/benchmark-results.json` is regenerated with `dtype`
as a first-class dimension and workloads representative of the enhancement task. The superseded
figures (`structuredOutputSuccessRate: 0.333`, `averageLatencyMs: 12654`) were gathered on
single-sentence prompts at a 256-token cap and cannot support a decision about this workload.

Confirm the recorded results support the fp32 default rather than merely accompanying it.

---

## 8. Full validation

```bash
npm test
npm run lint
npm run build
```

All three must be clean, with no test disabled or weakened to accommodate the change
(constitution XXXI).

## Regression checklist

Behaviours from earlier features that this work must not break:

- [ ] `011` success / partial / skipped outcome semantics unchanged; no new `StageStatus` member.
- [ ] `012` `409 ai_enhancement_already_running` concurrency guard still enforced.
- [ ] `012` incremental `reviewWorkspace` population still reveals scenarios as batches succeed.
- [ ] Review decisions on early-revealed scenarios survive later batches settling.
- [ ] Deterministic scenarios never removed, altered, or reordered — across success, partial,
      refusal, cancellation, and failure (SC-010).
- [ ] Identical input yields identical retained scenarios in identical order (SC-009).
- [ ] `analyzeDependencies` and `regenerateReviewScenario` still work — they share the corrected
      inference path and should **improve**, having been on the same defective prompting path.
- [ ] No specification content, prompt, or model response is written to logs (constitution XX).
- [ ] Ordinary `npm test` still downloads no model and runs no real inference.
