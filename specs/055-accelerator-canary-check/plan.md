# Implementation Plan: Accelerator Verification and Visibility

**Branch**: `AP-055` (spec directory `specs/055-accelerator-canary-check`) | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/055-accelerator-canary-check/spec.md`

## Summary

When the accelerator is enabled, run one fixed, deterministic canary inference after it loads. If the reply is not a JSON
object with a `candidates` array (or the canary times out or errors), fall back to CPU, record why in the readiness reason,
and keep readiness `loading` until the decision so no request reaches an unverified device. Report the device in use, a
coarse throughput sample and the verification outcome through `GET /api/ai/status`, additively. Update the example
environment file, the configuration reference and the architecture document to call the accelerator experimental and
measured slower than CPU.

The approach is fixed by measurement, not preference (see [research.md](research.md)). The canary wording is load-bearing:
two natural phrasings make a healthy 0.5B model answer `{}`, which would be a false fallback, so the canary is a copy-style
prompt (`Reply with exactly: {"candidates":[]}`) that passes on both shipped models on CPU and fails every measured bad
accelerator configuration. A 12-token cap keeps the failing path inside the 15 s budget (measured 13.5 to 14.1 s on the reference laptop, with about 1 s of margin).

## Technical Context

**Language/Version**: TypeScript on Node.js 24 LTS (npm workspaces monorepo)

**Primary Dependencies**: No new dependencies. Existing `@huggingface/transformers` 4.3.1 (confined to `loadTransformersEngine`), Express, Vitest, Supertest

**Storage**: None. The new fields are live, in-memory readiness; the diagnostics repository keeps its existing columns (research Decision 8)

**Testing**: Vitest unit tests with fake `TextGenerationEngine`s (no model, GPU or network); Supertest for the status route; one opt-in real-model case behind `AI_TEST_REAL_MODEL`

**Target Platform**: Local backend process; verified behavior measured on Windows 11 with DirectML. Linux and macOS take the same code path but are unmeasured, and the library's per-platform device choice there is not verified (the accelerator label is the generic `Accelerator` outside Windows; research Decision 7)

**Project Type**: Web application (Express backend, React frontend, shared-domain package). This feature touches backend and shared-domain only

**Performance Goals**: Healthy accelerator adds at most about 1.4 s to first load (measured 0.6 to 1.4 s); a failing accelerator adds at most 15 s (SC-005; measured 13.5 to 14.1 s on the reference laptop, about 1 s of margin); CPU path adds 0 s

**Constraints**: Local-first; never fall back to another provider; no new environment variable; FIFO queue and readiness state machine preserved; no prompt or reply content in logs; exactly one canary inference per accelerated load

**Scale/Scope**: One canary per model load (once per process, plus once per explicit retry). One new source file, one new test file and seven modified source or test files, plus docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: unchanged.*

| Principle | Assessment |
| --- | --- |
| II. Deterministic Before AI | Pass. The canary is a runtime health check, not test generation. Its input and decoding are fixed, and the pass rule is a pure function. No deterministic generation path changes. |
| III. AI Is an Assistant | Pass. The check gates which device runs inference; it does not make AI output authoritative. |
| V. Local-First AI | Pass. No network use. The fallback target is CPU on the same machine, never another provider. The canary text contains no user data. |
| VI. AI Provider Independence | Pass, with a design consequence. The shared contract uses a neutral `cpu \| accelerator` plus free-text label (research Decision 7) instead of runtime names. The inference library stays confined to `loadTransformersEngine`. |
| XIV. No Silent Assumptions | Pass. The fallback and its reason are visible; throughput is labelled as a coarse cold sample rather than presented as a benchmark; adapter identity is `null` rather than guessed. |
| XIX. Fail Safely | Pass. A loaded-but-unusable accelerator is now surfaced instead of reported healthy; a CPU load failure still ends in `unavailable` with no automatic retry. |
| XX. Observability Without Sensitive Logging | Pass. One event with outcome, category, duration, version and label; the canary input and reply are never logged. A test asserts this. |
| XXI. Testability at Every Boundary | Pass. Pure evaluator tested alone; provider tested with fake engines; real-model coverage stays opt-in. |
| XXII. AI Evaluation | Pass. This is a sanity check, not an evaluation. The wording was validated on both shipped models and on eight accelerator configurations (research Decisions 2 and 3). |
| XXIII. Version AI Contracts | Pass. `ACCELERATOR_CANARY_VERSION`, a contract document, and an opt-in real-model regression guard. The scenario prompt is untouched. |
| XXIV. Reproducibility | Pass. Greedy decoding, fixed input, and measured repeat-identical replies. |
| XXV. Incremental Delivery | Pass. A single increment with three independently testable stories. |
| XXVII. Prefer Simple Architecture | Pass. One extra inference, no new service, setting, dependency or persistence. The adapter field has no producer yet; see Complexity Tracking. |
| XXXI. Definition of Done | Applies. Documentation, the 004 contract amendment, the roadmap entry and a version bump are in scope (see Assumptions in the spec). |

Project rules (`.claude/CLAUDE.md`): sections 15 to 20 (AI provider, local-first, readiness, explicit CPU fallback), 22 to 24
(thin routes, contracts, safe errors), 44 to 45 (types, immutability) and 54 (validation) are satisfied; no rule is waived.

## Project Structure

### Documentation (this feature)

```text
specs/055-accelerator-canary-check/
├── plan.md              # This file
├── research.md          # Phase 0: decisions with measurements
├── data-model.md        # Phase 1: contract additions, pass rule, state transitions
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── ai-status-api-amendment.md   # public: additive /api/ai/status fields
│   └── accelerator-verification.md  # provider-internal: canary input, rule, obligations
├── checklists/
│   └── requirements.md  # spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── aiProvider.ts                 # MODIFY: AcceleratorVerification; optional fields on ReadinessState

backend/src/
├── ai/
│   ├── acceleratorVerification.ts  # NEW: canary constants, evaluateCanaryReply(), failure categories
│   ├── localProvider.ts            # MODIFY: engine gains optional countTokens/dispose; canary in
│   │                               #         loadWithAcceleratorFallback(); accelerator label by platform
│   └── readiness.ts                # MODIFY: markReady() accepts the new optional fields (live only)
└── api/
    └── aiStatus.ts                 # MODIFY: map the new fields; null for absent values

backend/tests/
├── unit/ai/
│   ├── acceleratorVerification.test.ts   # NEW: pass-rule matrix
│   └── localProvider.accelerator.test.ts # MODIFY: update the fake engine; add the fallback/timeout/error/queue cases
└── integration/
    ├── aiStatus.test.ts                  # MODIFY: additive fields, mock provider nulls
    └── localProvider.real.test.ts        # MODIFY: opt-in canary-on-CPU case

docs and housekeeping
├── .env.example                          # MODIFY: accelerator comment
├── docs/configuration.md                 # MODIFY: experimental, measured comparison
├── docs/architecture.md                  # MODIFY: verification and fallback
├── docs/http-api.md                      # MODIFY: status row
├── specs/004-ai-provider-local-inference/contracts/ai-status-api.md  # MODIFY: amendment pointer
├── specs/ROADMAP.md                      # MODIFY: entry and version
└── package.json x4                       # MODIFY via `npm run version:bump -- feature` (19.56.0 -> 19.58.0: two bumps, assuming AP-054 merges first)
```

**Structure Decision**: Backend and shared-domain only. `frontend/` is untouched because nothing there reads
`/api/ai/status` (research Decision 9). The pure evaluation sits beside the provider in `backend/src/ai/` so it can be tested
without constructing a provider, and so the provider remains the only orchestration point for load, fallback and readiness.
Persistence is untouched (research Decision 8).

## Complexity Tracking

No constitution violation requires justification. Two small design costs are recorded for review:

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| `acceleratorAdapter` field with no current producer | Spec FR-010 and Story 2 scenario 3 require the status to say the adapter identity is "not available"; an explicit `null` is that statement, and a runtime that later exposes a name needs one assignment. | Omitting it leaves "not available" implicit and unobservable by a client. It is one optional field and one `?? null`; if the owner prefers omission, FR-010 and the scenario should be reworded instead. |
| Awaiting a timed-out canary before loading CPU | The runtime has no abort signal; skipping the wait lets orphaned accelerator work compete with the CPU load (same hazard as `013` FR-017). | Not waiting is simpler but unsafe on the machines this feature targets. The 12-token cap bounds the wait. |

## Open items for review

1. **SC-005 is measured and met, with a thin margin** (research Decision 4): 13.5 to 14.1 s against 15 s on the reference laptop. A slower machine could exceed it; the cap is the lever.
2. **The reported throughput is coarse and cold** (research Decision 6). If a trustworthy comparison is wanted, that is a
   different feature (it needs a CPU baseline, which the spec excludes).
3. **Adapter field**: confirm keeping `acceleratorAdapter: null` over rewording FR-010.
