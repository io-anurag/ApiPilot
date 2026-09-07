# Implementation Plan: AI Batching Policy and Run Pacing

**Branch**: `014-ai-batching-policy` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-ai-batching-policy/spec.md`

## Summary

AI-assisted work is currently divided by how much of the model's context window remains unused, which
means a realistic specification becomes one enormous request. That single request defeats the three
features built on top of it — there is nothing to stream, nothing to show progress for, nothing to
cancel between, and nothing retained when it fails — and it asks a 0.5B model to do so much that it
echoes the request back instead of answering.

This feature makes the unit of work **one operation** for scenario enhancement, reduces the output
allowance to match, adds a wall-clock ceiling for a whole run, and wires up the pre-flight viability
refusal that already exists but is called from nowhere. Dependency analysis receives the same
work-bounded sizing, but only after its prompt is reduced to a contract projection — measurement shows
batching alone cannot save it.

Phase 0 settled every open quantity by measurement rather than assumption. The headline result: **one
operation per unit at a 256-token allowance produced a validly shaped reply for 6 of 6 operations in
14.6–30.4 seconds each**, where the current configuration produces none at all. Two Phase 0 findings
contradicted the specification; both were raised for decision, resolved, and applied — the worked
example became conditional on an operation having a request body, and the unit size became a
configurable default rather than a fixed constant (see Complexity Tracking).

## Technical Context

**Language/Version**: TypeScript 5.5 on Node.js 20 LTS

**Primary Dependencies**: Express 4, React 18, Vite 5, `@huggingface/transformers` (local inference,
behind the `AIProvider` abstraction)

**Storage**: None. Workflow state is in-memory and per-process; this feature adds no persistence.

**Testing**: Vitest; Supertest for HTTP; React Testing Library for UI. AI-dependent tests use scripted
fake providers — note the shipped mock provider cannot satisfy the candidate schema, so
`AI_PROVIDER_MODE=mock` is not a substitute.

**Target Platform**: Local developer machine, CPU inference by default

**Project Type**: npm-workspaces monorepo — `backend/`, `frontend/`, `packages/shared-domain/`

**Performance Goals**: One unit completes well inside `AI_INFERENCE_TIMEOUT_MS` (measured 14.6–30.4s
against a 60s limit); first scenario visible within roughly one unit's duration; cancellation effective
within roughly one unit's duration (baseline: 56s)

**Constraints**: Local-first, no cloud fallback; deterministic scenarios never removed or blocked by any
AI outcome; unit derivation deterministic; no new `StageStatus` members; inference remains
uninterruptible once in flight (out of scope), so unit duration is the granularity of every control

**Scale/Scope**: Reference corpus 6 operations / 32 deterministic scenarios; large corpus 200
operations / 1,350 deterministic scenarios. At ~21s per operation, whole-specification enhancement is
practical to roughly 15–30 operations — see Complexity Tracking.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment | Status |
| --- | --- | --- |
| I. Specification Is the Source of Truth | Candidates still validated against the **full** `ApiModel`; narrowing the model's view never narrows the validator's | PASS |
| II. Deterministic Before AI | Deterministic baseline untouched; AI remains additive (FR-022) | PASS |
| III. AI Is an Assistant | `AI` provenance and the review gate preserved (FR-023) | PASS |
| IV. AI Output Must Be Structured and Validated | Validation pipeline unchanged; echoed replies rejected, never partially salvaged (FR-017) | PASS |
| V. Local-First AI | No provider or transport change (FR-025) | PASS |
| VI. AI Provider Independence | All work stays behind `AIProvider` | PASS |
| VII. Model Selection Is an Engineering Decision | Model deliberately unchanged; every quantity set by measurement | PASS |
| IX. Separation of Concerns | Sizing in `ai/`, orchestration in `testGenerationWorkflow/`, presentation in `frontend/` | PASS |
| XII. Quality Over Quantity | Central: useful contribution per unit time, not more requests | PASS |
| XIII. Provenance and Traceability | Unchanged | PASS |
| XIV. No Silent Assumptions | FR-034 requires disclosing relationships batching cannot see | PASS |
| XV. Conservative Dependency Inference | Projection drops the model's *view* only; validation unchanged | PASS |
| XVI. Executable Artifacts Deterministic | Artifact generation untouched | PASS |
| XVII / XVIII. Security | No new data flows, no new persistence, no secrets | PASS |
| XIX. Fail Safely | Bounded runs, partial retention, explicit refusal | PASS |
| XX. Observability | Per-unit outcomes logged by category and duration, never prompt or reply content | PASS |
| XXI. Testability at Every Boundary | Sizing is a pure function; budget and refusal testable with fakes; no real model in the core suite | PASS |
| XXII. AI Evaluation Is Part of Engineering | Phase 0 evaluated against a real corpus; SC-013 guards dependency coverage | PASS |
| XXIII. Version AI Contracts | Enhancement 2→3, dependency 1→2 | PASS |
| XXIV. Reproducibility | Unit derivation deterministic (FR-005, SC-008) | PASS |
| XXV. Incremental Delivery | Five independently testable user stories | PASS |
| XXVII. Prefer Simple Architecture | One parameter on an existing function, one config value; no new infrastructure | PASS |
| XXX. Explicit Trade-offs | Longer total runs, and the practical size limit, documented below | PASS |
| XXXII. Human Review Practical at Real Scale | **Tension** — see Complexity Tracking | JUSTIFIED |
| XXXIII. Presentation Consistent and Usable | Reuses existing progress components; no new visual language | PASS |

**Post-Phase-1 re-check**: unchanged. The design adds one function parameter, one configuration value,
one progress field, and two prompt projections. No new architectural layer, no new dependency, no new
outcome state.

## Project Structure

### Documentation (this feature)

```text
specs/014-ai-batching-policy/
├── plan.md                            # This file
├── spec.md                            # Feature specification
├── research.md                        # Phase 0 — 8 measured decisions
├── data-model.md                      # Phase 1 — entities and touched types
├── quickstart.md                      # Phase 1 — validation guide
├── contracts/
│   ├── batch-sizing.md                # splitOperationsIntoBatches contract
│   ├── run-budget.md                  # Run ceiling + pre-flight refusal
│   └── ai-prompt-contracts-v3.md      # Prompt scope and version increments
├── checklists/
│   └── requirements.md                # Spec quality checklist
└── tasks.md                           # Phase 2 — created by /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── ai/
│   │   ├── requestBatching.ts         # + maxOperationsPerBatch work bound
│   │   ├── viability.ts               # unchanged; finally called
│   │   └── modelConfig.ts             # + AI_ENHANCEMENT_RUN_BUDGET_MS
│   ├── config.ts                      # + startup validation for the new value
│   ├── testDesign/
│   │   ├── aiScenarioPrompt.ts        # 1 op/request; 256 tokens; version 3
│   │   └── enhanceTestModel.ts        # run budget; pre-flight refusal
│   ├── dependencies/
│   │   ├── aiDependencyPrompt.ts      # contract projection; version 2
│   │   └── analyzeDependencies.ts     # work-bounded sizing for this caller
│   └── testGenerationWorkflow/
│       ├── aiEnhancementStage.ts      # budget-exhaustion outcome mapping
│       └── failureExplanation.ts      # retryability correction
└── tests/
    ├── unit/{ai,testDesign,dependencies,testGenerationWorkflow}/
    └── integration/

frontend/
├── src/components/AiEnhancementStage.tsx   # remaining-allowance display
└── tests/unit/

packages/shared-domain/
└── src/testGenerationWorkflow.ts      # AiEnhancementProgress + remaining allowance
```

**Structure Decision**: The existing monorepo layout is unchanged. Every change lands in a module that
already owns the concern: sizing in `ai/requestBatching.ts`, prompt scope in the two prompt builders,
run pacing in `enhanceTestModel.ts`, outcome mapping in `aiEnhancementStage.ts`, and presentation in
the existing `AiEnhancementStage` component. No new directories.

## Implementation Sequencing

Ordered so each step is independently verifiable and no step ships a regression:

1. **Sizing parameter** (`requestBatching.ts`) — additive; omitting it preserves today's behaviour, so
   existing tests pass unchanged.
2. **Enhancement adopts 1 operation/unit, 256 tokens, version 3** — delivers US1, the P1 story, on its
   own.
3. **Run budget + configuration** — delivers US3; prevents step 2 from turning a fast failure into a
   long run.
4. **Pre-flight refusal wired in** — delivers part of US4; depends on step 2's uniform units.
5. **Retryability correction** — the rest of US4; independent of the above.
6. **Progress surfaces remaining allowance** — completes US2, which steps 1–3 have already largely
   delivered by making units plural.
7. **Dependency prompt projection (version 2), then its sizing** — delivers US5. **Must be in this
   order**: batching before projection would make dependency analysis strictly worse.

## Complexity Tracking

| Violation / Tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **XXXII (review practical at real scale)** — at ~21s/operation, whole-specification enhancement is impractical beyond roughly 15–30 operations. A 200-operation specification would need ~70 minutes for full coverage. | This feature makes AI enhancement work *at all*, where it currently produces nothing at any size. The run ceiling converts an impossible run into a useful partial one. | Larger units were measured and fail — 2 and 3 operations both truncate. A faster model is out of scope and slower on CPU. The real answer is **letting the user choose which operations to enhance**, already identified as the fast follow-up; this feature is a prerequisite for it, since selection is only useful once a per-operation request reliably succeeds. |
| **Total run time increases** — a large specification takes longer than one oversized request. | The current single request is faster only because it reliably produces nothing. | Bounded by the run ceiling, made tolerable by incremental result delivery, and made interruptible by short units. |
| **Conditional worked example** (FR-016, amended and applied) — the example is included only for operations carrying a request body, so prompt shape varies by operation. | Measured: the example costs ~6.6s on a body-less operation for no benefit, and saves ~9.1s on the one operation that actually truncates. Under the run ceiling, time is coverage. | Always-on spends ~6.6s per body-less operation, costing roughly three operations of coverage on a mixed specification under a 5-minute ceiling. Always-off leaves the truncation-prone operations without the steer that measurably helped them. Decisive cells are n=1 — validate on a body-heavy corpus, and fall back to always-on, never always-off. |
| **Unit size stated as a default rather than a constant** (Assumptions, amended and applied) — "one by default, configurable per caller" rather than "exactly one". | Two and three operations both truncate on the reference profile, but that is a property of this CPU and this 0.5B model, not of the domain. | "Exactly one" would bake today's hardware into a requirement, forcing a specification amendment to try a larger unit on a GPU or a stronger model. The measured value lives in research.md and the configuration default instead. |
| **Dependency-analysis unit size deliberately unset** | With the current prompt, every size times out, so any figure would be a guess presented as a measurement. | Set it after the projection lands, by measuring detected relationships against SC-013 — not duration. |
