# Implementation Plan: AI Provider & Local Inference Foundation

**Branch**: `004-ai-provider-local-inference` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-ai-provider-local-inference/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Establish the `AIProvider` abstraction and its local, fully-offline inference implementation
(`ApiPilot → AIProvider → Local Transformers.js Provider → Local Model`), so every future
AI-powered feature (starting with AP-005) requests inference through one framework-independent
interface and never depends on a concrete runtime. This feature delivers: the `AIProvider`
contract and structured inference request/response types (in `packages/shared-domain`); a local
provider built on Hugging Face Transformers.js (`@huggingface/transformers`, Node backend) with
model caching, a readiness state machine, a serialized request queue, a configurable per-request
timeout, and automatic-with-notice CPU fallback when an enabled accelerator is unavailable; a
deterministic mock provider for AI-dependent automated tests; a `GET /api/ai/status` readiness
endpoint; and a benchmarking/evaluation harness used to select and record the initial local
model from a shortlist of small, offline-capable, Transformers.js-compatible candidates. No
API-specific test-scenario generation or business rules are implemented here (constitution VI,
roadmap AP-004 constraints) — this feature only builds the infrastructure later features consume.

## Technical Context

**Language/Version**: TypeScript 5.x throughout, running on Node.js 20 LTS (backend) — same
stack established by AP-001/AP-002/AP-003; no new frontend runtime requirements.

**Primary Dependencies**: `@huggingface/transformers` (Transformers.js v3, running on the
Node backend via its ONNX Runtime Node execution provider) is the new dependency, confined
entirely to the local provider implementation (constitution VI, XXVIII). No new frontend
dependencies.

**Storage**: A local filesystem model cache directory only (no database); default location
is a per-user cache path (e.g., `~/.apipilot/models`), configurable via environment variable —
consistent with AP-002's "no persistence beyond what's necessary" decision and constitution
XVII.

**Testing**: Vitest for all unit tests (queue, readiness state machine, mock provider,
config loader, error-taxonomy mapping) and the benchmarking report format; Supertest for the
new `/api/ai/status` integration test. Tests that require downloading/loading the real local
model are isolated behind an explicit opt-in (a separate npm script / environment flag) so
the default `npm test` run never requires network access or a large model (constitution XXI).

**Target Platform**: Local developer machine (Windows/macOS/Linux), same as AP-001–AP-003;
CPU inference is the guaranteed baseline, with optional accelerator use only when explicitly
enabled and actually available at runtime.

**Project Type**: Web application — extends the existing `backend/`, `frontend/`, and
`packages/shared-domain` workspaces; no new workspaces are introduced. This feature is
primarily backend infrastructure; no new frontend UI is introduced (a visual AI-status
indicator is left for the feature(s) that first need it, e.g., AP-005/AP-006, to avoid
building UI ahead of a concrete need — constitution XXVII).

**Performance Goals**: Readiness state is retrievable in well under 5 seconds with no
inspection of logs or code (SC-007); the per-request inference timeout defaults to a value
generous enough for CPU-only generation on modest hardware (documented in research.md) and
is configurable.

**Constraints**: No automatic cloud fallback under any local-inference failure condition
(FR-007, SC-005); zero outbound AI-vendor network calls once the local model is cached in
local-only mode (FR-006, SC-001); inference requests are serialized through a single queue
rather than run in parallel or rejected outright (FR-018); a failed model load is never
retried automatically (FR-019); an enabled-but-unavailable accelerator falls back to CPU
automatically with a visible notice, never silently (FR-008).

**Scale/Scope**: Single local user, one backend process, one `AIProvider` instance per
process. The benchmarking harness is a manually/CI-invoked offline tool, not part of the
runtime request path, and evaluates a small shortlist of candidate models (not an open-ended
search) against a representative sample workload set defined in this feature.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Specification Is the Source of Truth | N/A | This feature does not parse or reason about OpenAPI specifications |
| II. Deterministic Before AI | PASS | This feature is AI infrastructure, not a substitute for deterministic logic elsewhere; it introduces no AI-based test-scenario or business-rule logic (FR-012) |
| III. AI Is an Assistant, Not the Authority | PASS | Every `InferenceResponse` is explicitly `success`/`error` with a `modelId`/`provider`, never silently presented as authoritative (data-model.md) |
| IV. AI Output Must Be Structured and Validated | PASS | FR-009 defines one structured request/response contract for every provider; malformed output is surfaced via `INVALID_RESPONSE`, never silently passed through (FR-010) |
| V. Local-First AI | PASS | FR-002, FR-005, FR-006 — local provider completes inference and caches the model with zero required network access once cached |
| VI. AI Provider Independence | PASS | `AIProvider`/`InferenceRequest`/`InferenceResponse` live in `packages/shared-domain`; only `backend/src/ai/localProvider.ts` imports Transformers.js (FR-001, FR-013) |
| VII. Model Selection Is an Engineering Decision | PASS | research.md documents a multi-dimension shortlist evaluation (FR-014, FR-015); the benchmarking harness is part of this feature's scope, not assumed away |
| VIII. Framework-Independent Test Model | N/A | No `TestModel`/`TestScenario` changes in this feature |
| IX. Separation of Concerns | PASS | Provider abstraction, local provider, mock provider, request queue, readiness state, and benchmarking harness are separate modules under `backend/src/ai/` |
| X. Domain Model First | PASS | `AIProvider`, `InferenceRequest`, `InferenceResponse`, `ReadinessState`, `ModelConfig`, `BenchmarkReport` are added to `packages/shared-domain`, framework-independent |
| XI. Human-in-the-Loop | N/A | No scenario review surface in this feature (AP-006) |
| XII. Quality Over Quantity | N/A | No test-scenario generation in this feature |
| XIII. Test Provenance and Traceability | PASS (partial) | `InferenceResponse.modelId`/`provider` gives later features (AP-005) the identity data needed to attach `AI` provenance; this feature does not itself produce test scenarios |
| XIV. No Silent Assumptions | PASS | Readiness always exposes a `reason` (FR-004); no auto-retry on load failure (FR-019); accelerator fallback is visible, not silent (FR-008) |
| XV. API Dependency Inference Must Be Conservative | N/A | No dependency inference in this feature (AP-008) |
| XVI. Executable Artifacts Must Be Deterministic | N/A | No artifact generation in this feature |
| XVII. Security and Privacy by Design | PASS | Model cache is local-filesystem only; local-only mode makes no outbound calls (FR-006); no new file-upload surface |
| XVIII. Secrets Must Never Be Part of Generated Artifacts | N/A | No artifact generation in this feature |
| XIX. Fail Safely | PASS | Timeout, load-failure, and invalid-response conditions are all surfaced as explicit error categories rather than fabricated success (FR-010, FR-017, FR-019) |
| XX. Observability Without Sensitive Logging | PASS | Logging design uses `requestId`, `modelId`, processing stage, duration, and error category; raw prompts/responses are never logged by default (research.md) |
| XXI. Testability at Every Boundary | PASS | Mock provider (FR-011) lets AI-dependent tests run without a real model; real-model tests are isolated behind an explicit opt-in, not part of the default suite |
| XXII. AI Evaluation Is Part of Engineering | PASS | The benchmarking harness (FR-014) measures structured-output reliability, latency, and resource use across candidates, not just "returns valid JSON" |
| XXIII. Version AI Contracts | PASS | `InferenceRequest`/`InferenceResponse`/`ModelConfig` carry an explicit `contractVersion`; changes to this shape are a reviewable, versioned diff (data-model.md) |
| XXIV. Reproducibility | PASS | Mock provider output is deterministic for a given input (FR-011, SC-004); local-provider responses record `modelId` and inference parameters for reproducibility tracking |
| XXV. Incremental Delivery | PASS | Fourth increment in the roadmap sequence (Local AI Infrastructure), independently testable without any AI-generated test scenario feature existing yet |
| XXVI. Specification Traceability | PASS | This plan traces to spec.md, which traces to roadmap AP-004 and the constitution |
| XXVII. Prefer Simple Architecture | PASS | In-process serial queue (no external broker), local filesystem cache (no new DB), one established library (Transformers.js) rather than a custom runtime |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | PASS | `AIProvider` is the stable abstraction; Transformers.js is replaceable behind `localProvider.ts` without touching any consumer (FR-013) |
| XXIX. Local-First Does Not Mean Local-Only Forever | PASS | `AIProviderMode` (`"local" \| "mock"`) is an explicit, extensible discriminator; no silent local→cloud switch exists because no cloud provider exists yet (FR-007) |
| XXX. Explicit Trade-offs | PASS | research.md documents the model-size-vs-latency, serial-queue-vs-parallelism, and timeout-value trade-offs explicitly |
| XXXI. Definition of Done | PASS (governance) | Applies at implementation/convergence time; tracked via quickstart.md's validation checklist |

**Initial Constitution Check: PASS** — no violations; Complexity Tracking is empty.

**Post-Design Constitution Check (after Phase 1)**: PASS — `data-model.md` defines only
framework-independent types (`AIProvider`, `InferenceRequest`, `InferenceResponse`,
`ReadinessState`, `ModelConfig`, `BenchmarkReport`) with no Transformers.js/ONNX/runtime
concept leaking into them (constitution VI, XXVIII); `contracts/ai-status-api.md` defines a
single, minimal, non-speculative endpoint that surfaces `ReadinessState` only; and
`quickstart.md` requires no cloud AI account or credentials, matching SC-002. No new
violations were introduced by the Phase 1 design; Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/004-ai-provider-local-inference/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── api/
│   │   └── aiStatus.ts            # GET /api/ai/status (readiness endpoint)
│   ├── ai/
│   │   ├── modelConfig.ts         # env-driven config loader (model id, cache dir, timeout, accelerator flag)
│   │   ├── readiness.ts           # readiness state machine (not-loaded/loading/ready/unavailable)
│   │   ├── requestQueue.ts        # serial in-process inference queue (FR-018)
│   │   ├── errors.ts              # AIErrorCategory + typed AIProviderError
│   │   ├── localProvider.ts       # Transformers.js-backed AIProvider implementation
│   │   ├── mockProvider.ts        # deterministic AIProvider implementation for tests
│   │   └── benchmark/
│   │       ├── runBenchmark.ts    # harness entry point (manually/CI invoked, not runtime path)
│   │       ├── workloads.ts       # representative sample workload fixtures
│   │       └── report.ts          # BenchmarkReport builder/writer
│   └── app.ts                     # existing Express app, extended with the ai-status route
└── tests/
    ├── unit/
    │   └── ai/                    # one test file per module above (queue, readiness, mock, config, errors)
    └── integration/
        └── aiStatus.test.ts       # Supertest: GET /api/ai/status using the mock provider

packages/
└── shared-domain/
    └── src/
        └── aiProvider.ts   # AIProvider, InferenceRequest, InferenceResponse, ReadinessState,
                             # ModelConfig, AIProviderMode, AIErrorCategory, BenchmarkReport types
```

**Structure Decision**: Extends the existing AP-001–AP-003 web application layout — no new
workspaces. All AI infrastructure is isolated in a new `backend/src/ai/` module (constitution
IX); only `localProvider.ts` imports Transformers.js, keeping the abstraction independent of
the runtime (constitution VI, XXVIII). Framework-independent contract types are added to
`packages/shared-domain` (constitution X) so any future frontend AI-status UI can reuse them
without duplication. No new frontend code is introduced by this feature (see Technical
Context); a visual indicator is deferred to the feature that first needs one.

## Complexity Tracking

> No Constitution Check violations were identified for this feature; this table is
> intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

