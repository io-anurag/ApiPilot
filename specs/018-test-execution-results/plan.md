# Implementation Plan: Test Execution & Results

**Branch**: `018-test-execution-results` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/018-test-execution-results/spec.md`

## Summary

Let a QA engineer actually run an already-approved test collection (the same `TestModel`/
`ApiModel` that already produces the AP-007/AP-016 Postman export) against a real, explicitly
selected, explicitly authorized environment, and see structured, non-sensitive pass/fail results
per request. Technical approach: reuse the existing, already-deterministic `generateCollection()`
export — populated with the selected environment's real values instead of placeholders — as the
thing that actually gets executed, running it one request at a time through `newman` (the
standard Postman collection runner) under ApiPilot's own sequencing/pacing/cancellation loop,
rather than building an independent HTTP-and-assertion engine that would duplicate logic
`backend/src/postman/assertionScripts.ts` and `workflowRendering.ts` already provide.

## Technical Context

**Language/Version**: TypeScript on Node.js 20 LTS

**Primary Dependencies**: Existing Express API, framework-independent shared-domain package,
existing Postman artifact generator (`backend/src/postman/`), existing session infrastructure
(`backend/src/session/`), Vitest, Supertest; **`newman`** (new — the standard Postman collection
runner; see research.md D1 for why this is the one new dependency the feature introduces).

**Storage**: None; environments and execution run history are in-memory, session-scoped state
(research.md D3), matching the existing no-durable-persistence model established by AP-009/
`specs/017-session-workflow-isolation`.

**Testing**: Vitest unit tests (result-mapping, ordering, pacing/cancellation logic), Supertest
integration tests against a small local Express fixture server standing in for "the target API"
(so no test depends on real external network access, per constitution XXI), TypeScript build,
repository lint.

**Target Platform**: Node.js backend and the existing React/Vite workflow client.

**Project Type**: Web application; adds a new backend-only capability (environments + execution
runs) alongside the existing in-process guided workflow, plus new frontend screens to configure
environments and view run results.

**Performance Goals**: A run over a few hundred approved scenarios (this project's own real-world
validation passes produced 692-807) must be able to complete in a practical amount of wall-clock
time when no pacing delay is configured; the feature itself adds no per-request overhead beyond
one Newman invocation and one small result-mapping step per item.

**Constraints**: Deterministic mapping from a completed Newman result to this feature's own
`RequestResult`/`FailureCategory` vocabulary (research.md D5); strictly sequential, no
concurrent requests within one run (FR-010); no raw credentials/request/response bodies in any
result or log (FR-017); no execution starts without a live, explicit user action (FR-006); no
new durable storage or external queue.

**Scale/Scope**: One in-progress execution run at a time per session (FR-008), an open-ended
number of defined environments and completed run records per session, retained only for that
session's lifetime.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Specification Is the Source of Truth | PASS | Every requirement below traces to a spec.md FR; no behavior invented beyond it. |
| II. Deterministic Before AI | PASS | No AI is involved in execution or assertion evaluation; outcomes depend only on the target's real response and the already-deterministic `Assertion` definitions. |
| VIII. Framework-Independent Test Model | PASS | `TestScenario`/`Assertion`/`TestModel` are read only, via the existing exporter; execution introduces no Postman-specific concept into those types (new types live in `execution.ts`, not `testModel.ts`). |
| IX. Separation of Concerns | PASS | New `backend/src/execution/` module, sibling to `postman/`/`testDesign/`/`dependencies/`; none of those existing modules changes. |
| X. Domain Model First | PASS (explicit decision) | `Environment`/`ExecutionRun` get their own shared-domain file and their own session-scoped store; `TestGenerationWorkflow`'s shape does not change (research.md D3). |
| XI. Human-in-the-Loop | PASS | FR-006/FR-007/FR-009 make every execution and every higher-risk execution require a distinct, explicit human action; no AI process may trigger or bypass it. |
| XVI. Executable Artifacts Must Be Deterministic | PASS | `generateCollection()` itself is unmodified and stays deterministic; this feature adds a new deterministic *consumer* of its output (given a fixed target response, the same run always yields the same categorized outcome), not a new generation path. |
| XVII. Security and Privacy by Design | PASS (explicit decisions) | FR-005: credential values live only in session-scoped `Environment` config, entered once, never hand-edited into the collection. FR-017: no raw credentials/bodies in any `RequestResult`. |
| XVIII. Secrets Must Never Be Part of Generated Artifacts | PASS | `ExecutionRun.environmentSnapshot` explicitly excludes `variableValues` (data-model.md) — a run record never carries the credential values it ran with. |
| XIX. Fail Safely | PASS | `NotAttemptedReason: "run-ended-before-reached"` is the explicit fallback so every request in a run always gets a named outcome; connectivity/timeout/could-not-evaluate are distinct, explicit categories rather than a generic failure. |
| XX. Observability Without Sensitive Logging | PASS | `AssertionOutcome.detail` is a short, non-sensitive summary by construction (research.md D5); no raw response body is ever stored or logged. |
| XXI. Testability at Every Boundary | PASS (explicit decision) | Integration tests run against a small local Express fixture standing in for the real target — no test requires real external network access; the Newman-invocation/result-mapping boundary (`mapNewmanResult.ts`) is unit-testable against constructed Newman result shapes without running Newman at all. |
| XXV. Incremental Delivery | PASS | Spec's five prioritized user stories are independently deliverable slices (run+results → environment safety → diagnostics → destructive/prod guard → history). |
| XXVII. Prefer Simple Architecture | PASS (documented trade-off) | The one new dependency (`newman`) is weighed in research.md D1 against reinventing Postman-collection execution; the sequencing/pacing/cancellation loop is a plain Node loop with an in-memory flag, no new infrastructure. |
| XXVIII. Technology Is Replaceable | PASS (explicit decision) | Newman sits behind `runExecution.ts`'s orchestration loop and `mapNewmanResult.ts`'s mapping function; a future alternative runner would replace those two internals without touching `Environment`/`ExecutionRun`/`RequestResult` or any route contract. |
| XXX. Explicit Trade-offs | PASS (documented) | research.md D1, D2, D4 each record a rejected alternative and why. |
| XXXIII. Presentation Must Be Consistent, Coherent, and Usable | Applies at implementation | New environment-configuration and run-results screens must reuse the project's existing Tailwind conventions and status/severity presentation patterns (`.claude/CLAUDE.md` §26-43) rather than introduce bespoke styling. |

No violations requiring Complexity Tracking. The one new dependency (`newman`) is addressed
above (XXVII/XXVIII) rather than in the table below, since it is not a constitution violation —
it is the standard, actively-maintained implementation of exactly what `specs/ROADMAP.md`'s
AP-017 objective already names as the intended execution path.

*Post-Phase-1 re-check*: data-model.md and contracts/execution-api.md introduce no new
principle concerns beyond the table above — `Environment`/`ExecutionRun`/`RequestResult` stay
framework-independent, the API contract follows the existing router's error-shape and polling
conventions exactly, and no additional dependency was introduced. Gate remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/018-test-execution-results/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── execution-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/shared-domain/
└── src/
    ├── execution.ts          # NEW: EnvironmentTier, Environment, ExecutionRunStatus,
    │                          #      NotAttemptedReason, FailureCategory, AssertionOutcome,
    │                          #      RequestResult, ExecutionRunSummary, ExecutionRun,
    │                          #      ExecutionConfirmationRequirement
    └── index.ts               # MODIFIED: `export * from "./execution"`

backend/
├── src/
│   ├── execution/                        # NEW module, sibling to postman/, testDesign/, dependencies/
│   │   ├── environmentStore.ts           # Session-scoped CRUD (AsyncLocalStorage-keyed Map, mirrors workflowStore.ts)
│   │   ├── executionRunStore.ts          # Session-scoped run history (same keying pattern)
│   │   ├── destructiveOperations.ts      # Derives ExecutionConfirmationRequirement from ApiModel/tier (FR-007)
│   │   ├── runExecution.ts               # Orchestration loop: ordering (reuses workflowRendering.planApprovedWorkflows),
│   │   │                                 #   pacing, cancellation check, per-item Newman invocation (research.md D2/D6)
│   │   ├── newmanRunner.ts               # Thin wrapper: runs one Postman item + carried-forward
│   │   │                                 #   collection-variable state through Newman's Node API
│   │   ├── mapNewmanResult.ts            # Newman per-item result → RequestResult/FailureCategory (research.md D5)
│   │   └── errors.ts                     # EnvironmentNotFoundError, DuplicateEnvironmentNameError,
│   │                                     #   ConfirmationRequiredError, ExecutionInProgressError,
│   │                                     #   NoRunInProgressError, RunNotFoundError, MissingVariableValuesError
│   └── api/
│       └── testGenerationWorkflow.ts     # MODIFIED: adds the environments/execution routes from
│                                         #   contracts/execution-api.md to the existing router
└── tests/
    ├── unit/execution/                   # mapNewmanResult, destructiveOperations, pacing/cancellation
    │                                     #   ordering logic — constructed inputs, no real Newman run
    ├── fixtures/execution/
    │   └── targetServer.ts               # Small local Express app used as "the target API" in
    │                                     #   integration tests (constitution XXI — no real network)
    └── integration/execution/
        ├── environments.test.ts
        └── executionRuns.test.ts         # Full start→poll→(cancel|complete) flows against targetServer.ts

frontend/
└── src/
    ├── services/
    │   └── executionClient.ts            # NEW: calls the environments/execution endpoints
    ├── components/
    │   ├── EnvironmentForm.tsx           # NEW: define/edit an Environment (tier, baseUrl, variables, pacing)
    │   └── ExecutionResultsPanel.tsx     # NEW: run summary + per-request results, failure-only filter (FR-021)
    └── pages/
        └── TestGenerationWorkflowPage.tsx # MODIFIED: renders environment selection + the confirmation
                                          #   step (FR-007) + execution/results screens once
                                          #   postmanGeneration is complete
```

**Structure Decision**: Extends the existing web-application layout (backend Express API +
React/Vite frontend + framework-agnostic shared-domain package) already used by every prior
spec. No new top-level project, service, or deployment unit is introduced — `execution/` is a
new module inside the existing backend workspace, following the same internal layout
(`{concern}/` directory of small, single-purpose files) as `postman/`, `testDesign/`,
`dependencies/`, and `session/` before it.

## Complexity Tracking

*No entries — Constitution Check above records no unjustified violations.*
