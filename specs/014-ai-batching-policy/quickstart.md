# Quickstart: Validating AI Batching Policy and Run Pacing

**Feature**: `014-ai-batching-policy` | **Date**: 2026-09-06

How to prove this feature works end to end. Details of *what* changes live in
[contracts/](./contracts/) and [data-model.md](./data-model.md); this document is the run guide.

## Prerequisites

- Node.js 20+, dependencies installed (`npm install` at the repository root).
- For real-model scenarios: the default model cached under `AI_MODEL_CACHE_DIR` (defaults to
  `~/.apipilot/models`). First run downloads roughly 1.7 GB.
- A specification to test against. The reference corpus is a springdoc-style 6-operation document; any
  OpenAPI 3.x file with request bodies and documented error responses works.

> **Machine quiescence matters.** Every timing below assumes no other process is running local
> inference. During Phase 0 a second backend on the same machine inflated measurements by roughly
> 2.5x and made them non-monotonic. Before timing anything, confirm no other Node process is burning
> CPU — on Windows, sample a candidate process twice a few seconds apart and check the CPU delta is
> zero.

## Fast validation (no model required)

Run first — these cover sizing, budget, and outcome logic with the mock provider.

```bash
npm test                    # full suite
npm run lint
npm run build
```

Targeted:

```bash
npx vitest run --root backend backend/tests/unit/ai/requestBatching.test.ts
npx vitest run --root backend backend/tests/unit/testGenerationWorkflow/
npx vitest run --root backend backend/tests/unit/dependencies/
```

**Expected**: all pass, including new coverage for unit sizing determinism, run-budget exhaustion,
pre-flight refusal, and retained results on partial outcomes.

Note the shipped mock provider returns `{"mock": true, ...}` and can never satisfy the candidate
schema, so AI-success paths need a scripted fake provider (as existing tests already use) rather than
`AI_PROVIDER_MODE=mock`.

## Scenario 1 — Enhancement contributes scenarios (US1, SC-001, SC-002)

```bash
npm run dev
```

Upload a specification, continue past API review, generate the baseline, run **Enhance with AI**.

**Expected**:
- Scenarios with `AI` provenance appear in the review workspace — where today the run ends
  `INVALID_RESPONSE` with none.
- Every AI scenario references an operation, field, and status code present in the specification.
- All deterministic scenarios remain present and unchanged.
- Against the 6-operation reference corpus, all 6 operations yield a validly shaped reply.
- On a substantially larger specification, the count of AI suggestions grows with operation count.

**Baseline for comparison**: before this feature, a 6-operation specification produced 0 AI scenarios
after ~57s; a 200-operation specification could produce at most 6.

## Scenario 2 — Progress is visible, cancellation is prompt (US2, SC-003, SC-004)

Start a run on a specification with more than a handful of operations.

**Expected**:
- The per-unit progress list is visible — not hidden, as it is today when everything is one unit.
- The first AI scenario appears within roughly one unit's duration (target well under 30s), not only
  at the end of the run.
- **Cancel** settles within roughly one unit's duration. Baseline: 56s measured today when cancelling
  4s into a run.
- Scenarios generated before cancelling are retained, and the outcome reads as cancelled, not failed.

## Scenario 3 — A large specification settles at the ceiling (US3, SC-006)

Use a specification whose operation count clearly exceeds the run budget — at ~21s per operation, a
5-minute default covers roughly 14.

```bash
AI_ENHANCEMENT_RUN_BUDGET_MS=60000 npm run dev   # shorten to make this quick to observe
```

**Expected**: the run settles `partial` at the ceiling; completed units' scenarios are retained;
remaining units report as not attempted; the user is told how much of the planned work completed.

## Scenario 4 — Hopeless work is refused up front (US4, SC-007, SC-009)

```bash
AI_INFERENCE_TIMEOUT_MS=2000 npm run dev
```

**Expected**: enhancement is refused within seconds with no generation attempted; the message gives
projected versus allowed time in human-readable form ("about 30 seconds", not `30000ms`); no retry
action is offered; deterministic scenarios are untouched.

Also confirm a repeatable unusable-output failure is not described as intermittent and offers no
retry.

## Scenario 5 — Dependency analysis (US5, SC-011, SC-012, SC-013)

Accept at least one scenario and **Finalize Review** to trigger dependency analysis.

**Expected**:
- Its AI pass divides into more than one unit — today it is always exactly one.
- A failing unit does not discard other units' relationships; the pass reports `partial`.
- Deterministic relationships are present after every outcome.
- Finalizing never terminates the backend. (The crash was fixed separately; this is a regression
  guard, since dependency analysis is where it surfaced.)

**Coverage check (SC-013)** — the acceptance test for the dependency unit size. Against a
specification with *known* relationships, confirm the chosen unit size detects no fewer relationships
than single-unit sizing would if that request succeeded. A unit size that is fast but detects less is
a regression. Set the unit size from this measurement, not from duration.

## Reproducibility check (SC-008)

Run enhancement twice against an unchanged specification and confirm identical unit composition,
count, and order. Scenario *content* is already deterministic; this confirms the new sizing is too.

> Unrelated known defect: deterministic scenario IDs are random UUIDs, so exported Postman
> collections are not byte-stable across runs. That is out of scope here — do not treat it as a
> failure of this feature.

## Measuring on other hardware

Phase 0 figures come from one CPU profile. To recalibrate:

1. Confirm the machine is quiet.
2. Time single-operation requests across every operation in a real specification.
3. Check the output allowance covers the operation with the largest request body — that is what
   truncates first.
4. Set `AI_ENHANCEMENT_RUN_BUDGET_MS` from the measured mean and how long users will wait.
5. Verify `AI_DECODE_MS_PER_TOKEN` still approximates reality; the pre-flight refusal depends on it
   (measured ~140 ms/token against the configured 130).
