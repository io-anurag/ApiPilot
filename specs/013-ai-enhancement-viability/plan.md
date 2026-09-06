# Implementation Plan: AI Enhancement Viability on Local CPU Inference

**Branch**: `013-ai-enhancement-viability` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-ai-enhancement-viability/spec.md`

## Summary

The AI Enhancement stage has never succeeded on the local provider. Measurement (see
[research.md](./research.md)) shows five compounding defects, of which two are decisive: the
instruction-tuned model is addressed as a text-completion model, so it never performs the task and
can never reach its stop token; and the configured `q8` weight precision runs 4x slower than
unquantized on the target CPU. Together with a context budget computed 4x too large, a 1,024-token
output allowance never sized against measured throughput, and a prompt carrying the entire
expanded API model plus the entire deterministic baseline, the result is a run that needs roughly
34 minutes against a 5-minute budget — arithmetically impossible on the smallest realistic input.

The approach corrects the inference path at the provider boundary so all four `infer()` callers
benefit at once, shrinks the prompt to an operation-contract projection while keeping validation
against the full `ApiModel`, adds a pre-flight viability estimate that refuses in seconds rather
than after five minutes, and replaces the silent wait and internal error string with phase-aware
progress, elapsed time, cancellation, and actionable explanations.

The measured end state is the fp32 + chat-template cell of the 2x2 probe: the exact requested JSON
structure, returned in about 7 seconds, with the model stopping on its own.

## Technical Context

**Language/Version**: TypeScript 5.5, Node.js 20 LTS, ES modules

**Primary Dependencies**: `@huggingface/transformers` 4.2 (local inference, provider-internal
only), Express 4 (backend), React 19 + Vite (frontend), Tailwind CSS v4 (styling)

**Storage**: None. Workflow state is in-process and non-persistent; the only filesystem writes are
the model cache under `AI_MODEL_CACHE_DIR`.

**Testing**: Vitest (unit + integration), Supertest (HTTP contracts), React Testing Library +
jsdom (frontend). AI-dependent tests default to `MockProvider`; real-model tests remain opt-in via
`npm run test:ai-real -w backend`.

**Target Platform**: Local developer machine, CPU-only inference without a dedicated accelerator.
Windows 11 is the reference profile where the defect was measured.

**Project Type**: Web application in an npm-workspaces monorepo — `backend/`, `frontend/`,
`packages/shared-domain/`.

**Performance Goals**:
- AI enhancement completes on the Pet Store fixture within the configured inference timeout on
  CPU-only hardware (SC-001) — never previously achieved.
- An unviable run is refused within 10 s rather than after 300 s (SC-002, SC-005: ≥95% reduction).
- Cancellation returns interactive control within 5 s (SC-008).
- Prompt size reduced roughly 5-10x, cutting measured prefill from ~94 s to single digits.

**Constraints**:
- Local-only inference; no cloud or external fallback under any failure (FR-027).
- Deterministic retained scenarios and ordering for identical input (FR-028, SC-009).
- Deterministic baseline never removed, altered, or reordered by any AI outcome (FR-031, SC-010).
- Ordinary test suite must not download or execute a real model (constitution XXI).
- No new `StageStatus` member; `011` outcome semantics preserved (FR-016, FR-030).

**Scale/Scope**: Backed by measurement on 3-operation and 51-operation specifications. Touches
`packages/shared-domain` (progress/explanation contracts), `backend/src/ai/` (provider, batching,
queue), `backend/src/testDesign/` (prompt projection), `backend/src/testGenerationWorkflow/` (stage
orchestration, cancellation), `backend/src/api/` (cancel endpoint), and
`frontend/src/components/AiEnhancementStage.tsx` (phase, elapsed time, cancel, explanations).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### Initial evaluation (pre-research)

| Principle | Assessment | Verdict |
| --- | --- | --- |
| I. Specification Is the Source of Truth | Prompt slimming (FR-009) reduces what the model *sees*, raising the risk of weakening groundedness | ⚠️ Gate — must show validation still runs against the full `ApiModel` |
| II. Deterministic Before AI | Deterministic baseline must survive every new path (refusal, cancellation) | ⚠️ Gate |
| III / IV. AI as assistant, structured and validated | Validation pipeline unchanged; provenance preserved | ✅ Pass |
| V. Local-First AI | No external path introduced | ✅ Pass |
| VI. AI Provider Independence | Chat framing is a runtime concern — must not leak into domain/shared contracts | ⚠️ Gate |
| VII. Model Selection Is an Engineering Decision | Changing default `dtype` is a model-configuration decision needing evidence | ⚠️ Gate |
| XIV. No Silent Assumptions | Current unknown-capacity fallback is optimistic | ⚠️ Gate — must invert to conservative |
| XIX. Fail Safely | Current failure is visible but unactionable and wastes 5 minutes | ⚠️ Gate |
| XX. Observability Without Sensitive Logging | New diagnostics must not log prompts, responses, or spec content | ⚠️ Gate |
| XXI. Testability at Every Boundary | Pre-flight rates and cancellation must be injectable | ⚠️ Gate |
| XXIII. Version AI Contracts | Prompt bytes change materially | ⚠️ Gate — must version |
| XXIV. Reproducibility | Runtime-calibrated rates introduce machine-dependent state | ⚠️ Gate — must not affect output |
| XXVII. Prefer Simple Architecture | Cancellation could justify worker threads | ⚠️ Gate |
| XXX. Explicit Trade-offs | fp32 footprint vs speed | ⚠️ Gate — must document |
| XXXIII. Presentation Consistent and Usable | New UI states must use the existing design system | ⚠️ Gate |

No violation is unjustifiable; all fourteen gates are design constraints carried into Phase 0.

### Post-design re-evaluation (after Phase 1)

| Gate | Resolution | Verdict |
| --- | --- | --- |
| I. Source of truth | Decision 4: the model sees a projection, but `validateAICandidateSemantics` continues to run against the **full** `ApiModel`. Nothing is accepted on weaker evidence than today. | ✅ Pass |
| II. Deterministic before AI | Decisions 7, 10: refusal and cancellation route through `011`'s existing `skipped`/`partial` semantics, which already guarantee the baseline survives. Asserted by SC-010 across all five outcome paths. | ✅ Pass |
| VI. Provider independence | Decision 1: framing lives in `loadTransformersEngine()`, driven by the pre-existing `expectedOutputFormat` field. No new field on `InferenceRequest`; no ChatML marker in domain code. | ✅ Pass |
| VII. Model selection | Decision 5: `dtype` default changes only alongside a re-run benchmark recording `dtype` as a first-class dimension, replacing evidence gathered on unrepresentative prompts. | ✅ Pass |
| XIV. No silent assumptions | Decision 3: unknown capacity yields a conservative 2,048-token floor instead of "assume it fits". | ✅ Pass |
| XIX. Fail safely | Decisions 6, 9: refuse before spending the budget; explain in the user's terms; never offer a retry that cannot help. | ✅ Pass |
| XX. Logging | Decision 9: `aiErrorMessage` keeps internal detail for logs only. New logs carry category, phase, durations, token counts — never prompt or response content. | ✅ Pass |
| XXI. Testability | Decision 6: rate constants injected; tests use fixed rates. Cancellation flag is a plain injectable predicate. Pre-flight and the explanation mapping are pure functions. | ✅ Pass |
| XXIII. Version AI contracts | Decision 1: `AI_SCENARIO_RESPONSE_VERSION` incremented; prompt change recorded as a contract change. | ✅ Pass |
| XXIV. Reproducibility | Decision 6: the EWMA gates only *whether* a run is attempted. It cannot alter prompt content, validation, dedup order, or retained scenarios. SC-009 asserts identical output across runs. | ✅ Pass |
| XXVII. Simple architecture | Decision 7: worker-thread isolation explicitly **rejected** for this feature as disproportionate; two-level cancellation with a resource stop is recorded as the honest, smaller solution, with the residual limit documented. | ✅ Pass |
| XXX. Explicit trade-offs | Decision 5: fp32's ~1.7 GB vs q8's ~0.5 GB recorded, with the measurement showing the saving was a false economy. Decision 7 records the cancellation limit. | ✅ Pass |
| XXXIII. Presentation | Phase/elapsed/cancel reuse the existing `StatusBadge` and Tailwind token system; no new styling vocabulary. Accessibility (live regions for elapsed time, accessible cancel control) is a task-level requirement. | ✅ Pass |

**Result: all gates pass. No entries required in Complexity Tracking.**

The one decision that could look like a violation — superseding `012`'s FR-005, which hides
progress for single-batch runs — is a correction of that rule's premise rather than a reversal of
its intent. FR-005 assumed single-batch meant "fast enough not to need progress"; the capacity
defect (Decision 2) had silently made single-batch the *only* case, so the rule was suppressing
progress for 100% of real runs. Recorded in Decision 8 and in this feature's Dependencies.

## Project Structure

### Documentation (this feature)

```text
specs/013-ai-enhancement-viability/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 10 decisions, measured
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
├── contracts/
│   ├── ai-enhancement-cancel.md      # POST .../ai-enhancement/cancel
│   ├── ai-enhancement-progress-v2.md # Extended progress shape
│   └── failure-explanation.md        # Category → explanation mapping
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── aiProvider.ts                 # ModelDType default note; no InferenceRequest change
└── testGenerationWorkflow.ts     # AiEnhancementProgress += phase/timestamps/cancelRequested;
                                  # WorkflowStageState += failureExplanation, cancelled

backend/src/
├── ai/
│   ├── localProvider.ts          # Decisions 1,2,3,6,7: chat template, true context window,
│   │                             #   conservative floor, rate calibration, in-flight tracking
│   ├── requestQueue.ts           # Decision 7: do not start next task while previous is orphaned
│   ├── requestBatching.ts        # Decision 6/7: pre-flight hook, isCancelled alongside isTimedOut
│   ├── viability.ts              # NEW — pure projected-duration estimate
│   └── benchmark/
│       ├── workloads.ts          # Decision 5: enhancement-representative workloads
│       └── runBenchmark.ts       # Decision 5: dtype as a benchmark dimension
├── testDesign/
│   ├── aiScenarioPrompt.ts       # Decision 4: operation-contract projection; version bump
│   └── enhanceTestModel.ts       # Wire pre-flight + cancellation; validation still on full ApiModel
├── testGenerationWorkflow/
│   ├── aiEnhancementStage.ts     # Phase reporting, cancellation, explanation on terminal states
│   ├── failureExplanation.ts     # NEW — pure (category, context) → FailureExplanation
│   ├── workflowStore.ts          # Progress phase/cancel mutators
│   └── errors.ts                 # Pre-flight refusal error type
└── api/
    └── testGenerationWorkflow.ts # NEW route: POST .../ai-enhancement/cancel

frontend/src/
├── components/
│   └── AiEnhancementStage.tsx    # Phase display, elapsed timer, cancel, explanation rendering
└── services/
    └── testGenerationWorkflowClient.ts  # cancelAiEnhancement()
```

**Structure Decision**: The existing monorepo layout is retained unchanged. Every modification
lands in a module that already owns the concern: inference mechanics in `backend/src/ai/`, prompt
construction in `backend/src/testDesign/`, stage orchestration in
`backend/src/testGenerationWorkflow/`, HTTP adaptation in `backend/src/api/`, presentation in
`frontend/src/components/`. Three new files are added, each a pure function module or a route,
introducing no new architectural layer.

Placing the chat-template and context-window corrections in `localProvider.ts` is the load-bearing
structural choice: it is the only module permitted to import `@huggingface/transformers`
(constitution VI), and fixing them there repairs all four `infer()` call sites — `enhanceTestModel`,
`analyzeDependencies`, `regenerateReviewScenario`, `runBenchmark` — without editing any of them.

## Implementation Phasing

Ordered so each phase is independently verifiable and the highest-value correction lands first.

| Phase | Content | Delivers | Verified by |
| --- | --- | --- | --- |
| A | Chat template, true context window, conservative floor (Decisions 1, 2, 3) | The model performs the task and stops on its own | Real-model probe; existing suite green |
| B | Prompt projection + version bump (Decision 4) | Prefill ~94 s to single digits | Prompt-size assertion; groundedness tests unchanged |
| C | dtype default + benchmark re-run (Decision 5) | 4x throughput; recorded evidence | Regenerated `benchmark-results.json` |
| D | Pre-flight viability + refusal semantics (Decisions 6, 10) | Unviable runs refused in seconds | Unit tests with injected rates |
| E | Cancellation + queue resource stop (Decision 7) | Control returned; no orphan contention | Integration test; SC-011 |
| F | Phase, elapsed time, explanations (Decisions 8, 9) | Honest wait, actionable failure | Frontend tests with fake timers |

Phases A–C target SC-001 (the feature working at all). D–F target SC-002 and SC-005 through
SC-008 (the experience). A is the minimum viable correction: on measured evidence, A plus C alone
should move a Pet Store run from impossible to roughly 7 seconds.

## Complexity Tracking

> No Constitution Check violations require justification. Table intentionally empty.

The one candidate complexity — worker-thread isolation for true mid-inference cancellation — was
evaluated in research.md Decision 7 and **rejected** as disproportionate under constitution XXVII.
Its absence is recorded as a known limitation in both research.md and the spec's Assumptions rather
than being silently accepted or silently added.
