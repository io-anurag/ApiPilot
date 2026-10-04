# Implementation Plan: Chain Debug Run

**Branch**: `039-chain-debug-run` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/039-chain-debug-run/spec.md`

## Summary

An engineer-triggered Debug run executes every chain of a saved request-chain plan once, in-process, and returns each step's masked request, response, extractor outcomes, check outcomes and not-sent causes to the UI only. Nothing is persisted or logged. Requests are sent by an in-process TypeScript executor that mirrors the k6 runtime's step logic, held to it by sandbox parity tests (research R1, R2). Masking is server-side and segment-based, with per-value reveal for values that came from the target and no reveal for secrets the engineer supplied (R5). The load-run report and stored results are unchanged.

## Technical Context

**Language/Version**: TypeScript, Node.js 24 LTS (global `fetch`, `AbortController`)

**Primary Dependencies**: none new. Existing: Express, Vitest, Supertest, React, Tailwind CSS v4, React Testing Library

**Storage**: none. In-memory reveal store with 30-minute expiry (data-model.md); no database, file or run directory

**Testing**: Vitest unit (executor pieces, masker), parity tests against `chainSandbox`, Supertest integration (routes, leak scan), React Testing Library (panel, output, reveal)

**Target Platform**: local ApiPilot backend plus browser UI (Windows, macOS, Linux)

**Project Type**: web application (npm workspaces monorepo)

**Performance Goals**: 10-step plan against a responsive target returns within 15 s (SC-005); masking linear in output size

**Constraints**: no request or response content, header value, extracted value or environment value persisted or logged (FR-009, FR-011, FR-012); secrets never sent to the browser (FR-015b); per-request timeout 30 s, whole-run cap 120 s; response read cap 2 MiB; display cap 64 KiB; redirects followed up to 10 hops with a host check per hop; load-run reports byte-identical (SC-006)

**Scale/Scope**: plans within `CHAIN_PLAN_LIMITS`; one Debug run per plan at a time

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I Specification is the source of truth | Spec 039 with clarifications; the spec was corrected where research found the runtime differs (R3). |
| II Deterministic before AI; III–VII, XXII–XXIII AI | No AI. |
| IX Separation of concerns, XXVII Prefer simple architecture | Pure modules under `backend/src/performance/chain/debug/`, thin routes, no new dependency, no new store technology. |
| X Domain model first | Types in `shared-domain` first (data-model.md). |
| XI Human in the loop | One explicit confirmation listing environment, tier, base URL, hosts and write steps before anything is sent. |
| XVI, XXIV Deterministic, reproducible | Same plan, environment and responses give the same output apart from durations. Dynamic variables use fixed VU 1, iteration 0. |
| XVII Security and privacy | No generated script executed on the server (R1). Local-only. Output exists only for the view; secrets masked on the server and never sent to the browser. Host allow-list enforced after substitution and on redirects. |
| XVIII Secrets never in artifacts | Nothing is persisted. |
| XIX Fail safely | Missing values, unreachable targets and failed extractors are shown with a cause, never hidden or defaulted. |
| XX Observability without sensitive logging | Scalar-only log fields, category-only errors; leak-scan test. |
| XXI Testability at every boundary | `Sender` injected; masker, resolver, extractors, checks are independently testable. |
| XXXIII Presentation consistent and usable | Reuses existing components and tokens; accessible, responsive, dark mode. |

**Result**: no violations. Complexity Tracking not needed.

**Post-design re-check**: unchanged. The twin executor is the one accepted duplication of logic; it is justified in R1 and bounded by parity tests and a runtime-drift guard.

## Project Structure

### Documentation (this feature)

```text
specs/039-chain-debug-run/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── debug-run-api.md
├── checklists/
│   └── requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── chainDebugRun.ts                   # new: MaskedText, DebugRunResult, outcome unions (exported from index)

backend/src/performance/chain/debug/   # new directory
├── runDebugRun.ts                     # orchestrator: setup, chains, stop rules, caps, cancellation
├── resolveRequest.ts                  # reference filling and request building (twin of fill/resolve/build)
├── dynamicValues.ts                   # dynamic variables (twin of dynamicValue/mix/lists)
├── extraction.ts                      # extractors with failure reasons; statusOk
├── checks.ts                          # check evaluation (twin of passes)
├── masker.ts                          # sensitive-literal collection and segment splitting
├── heldValues.ts                      # in-memory reveal store with expiry
└── sender.ts                          # Sender interface and fetch implementation (manual redirects, caps)

backend/src/api/chainPlans.ts          # + three thin routes (POST/GET/DELETE); no logic
backend/src/api/chainPlanHttp.ts       # + error mapping for new typed errors
backend/src/performance/errors.ts      # + DebugRunInProgressError, DebugValueNotFoundError

backend/tests/
├── unit/performance/chain/debug/      # resolver, dynamic values, extraction, checks, masker, heldValues, sender
├── unit/performance/chain/debugParity.test.ts   # sandbox vs executor; CHAIN_RUNTIME drift guard
└── integration/performance/chainDebugRun.test.ts  # routes, error mapping, leak scan

frontend/src/
├── services/requestChainClient.ts     # + debugRun, revealDebugValue, discardDebugRun; error detail keys
├── components/requestChain/
│   ├── ChainDebugPanel.tsx            # trigger summary + start/cancel + output host
│   ├── DebugRunOutput.tsx             # per-chain sections, step cards, outcomes, reveal
│   └── RunTargetSummary.tsx           # extracted from ChainRunPanel so both panels share it
└── components/requestChain/ChainPlanEditor.tsx    # + Debug run entry point

frontend/tests/unit/                   # ChainDebugPanel, DebugRunOutput, client tests
docs/USER_MANUAL.md                    # Debug run section; masking and reveal limits
specs/ROADMAP.md                       # feature entry
```

**Structure Decision**: the executor is a new `debug/` folder beside the existing chain modules, importing shared helpers (`chainRunOrder`, `analyzeChainPlan`, `parseReferences`, capture-path helpers) from shared-domain. Routes stay thin and sit in the existing chain plans router. The generated k6 script, `CHAIN_RUNTIME`, the report modules and the persistence layer are not modified.

## Phases and Delivery Order

1. **Contracts**: shared-domain types and exports.
2. **Executor core (no I/O)**: resolver, dynamic values, extraction, checks, with parity tests against the sandbox.
3. **Masker and held values**, with the masking corpus tests.
4. **Sender and orchestrator**: host checks, redirects, caps, cancellation, stop rules.
5. **Routes and error mapping**, leak-scan integration test.
6. **Frontend**: client, shared target summary, panel, output, reveal; accessibility and dark mode.
7. **Docs, roadmap and version bump** per project convention; full validation.

Phases 1–2 deliver User Story 2's logic, 3–5 deliver Stories 1 and 3 on the API, 6 completes the UI and Story 4's trigger.

## Risks

| Risk | Mitigation |
|---|---|
| The twin drifts from the runtime | Parity tests plus a `CHAIN_RUNTIME` hash guard that fails and points to the parity suite. |
| `valueAtPath` differs from the runtime's `field()` (own keys, array rule) | Verify first (task); write a dedicated walker if they differ rather than change shared behaviour. |
| A secret shorter than 3 characters in free text | Documented limit; still masked in headers and URL. |
| Debug run overlaps a load run on one target | Refused while a run is in progress; slot integration decided in implementation. |
| First in-process outbound client in the backend | One small `Sender` with host checks, timeouts, size caps and manual redirects, fully injected in tests. |
