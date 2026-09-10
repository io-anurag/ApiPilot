# Implementation Plan: Session-Scoped Concurrent Workflow Isolation

**Branch**: `017-session-workflow-isolation` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-session-workflow-isolation/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Today, `backend/src/testGenerationWorkflow/workflowStore.ts` holds exactly one
`TestGenerationWorkflow` in a module-level variable, shared by every HTTP client
(`specs/009-e2e-test-generation-workflow` FR-018). This feature partitions that state by
browser session so concurrent users no longer collide, while changing as little of the
existing call surface as possible: a new Express middleware assigns each browser an
unguessable session identifier via a cookie and runs the rest of the request inside a
`node:async_hooks` `AsyncLocalStorage` context; `workflowStore.ts` is refactored internally to
index its state by the session id read from that context instead of a single variable, so
every existing exported function keeps its exact signature and every calling route/stage
module (`api/testGenerationWorkflow.ts` and the eight `testGenerationWorkflow/*Stage.ts`
modules) requires no changes at all. A periodic in-process sweep evicts sessions idle for over
60 minutes (FR-007), and the workflow GET endpoint gains one small additive response case
(`{ workflow: null, sessionExpired: true }`) so a returning, idle-evicted session sees an
explicit notice instead of an indistinguishable empty state (FR-007a).

## Technical Context

**Language/Version**: TypeScript on Node.js 20 LTS (existing baseline, unchanged)

**Primary Dependencies**: Express 4 (existing); Node built-ins only for the new behavior —
`node:crypto` (`randomUUID()` for FR-004a's unguessable session identifier) and
`node:async_hooks` (`AsyncLocalStorage` to carry the session id through the existing call
chain without changing any function signature). No new npm dependency is introduced.

**Storage**: N/A — in-memory only, per FR-008 (unchanged from today's single-instance
behavior; a session's state is an entry in a `Map`, not a database row)

**Testing**: Vitest + Supertest (backend, existing) — `supertest`'s `request.agent(app)`
maintains a cookie jar per instance, which is exactly the mechanism needed to test two
independent "browsers" concurrently against one `app`. React Testing Library (frontend,
existing) for the new session-expired notice.

**Target Platform**: Existing local Express backend + Vite dev server topology, unchanged.
Session cookies flow through Vite's existing `/api` proxy transparently — the browser only
ever talks to the Vite dev-server origin, so no CORS/cross-origin cookie configuration is
introduced (verified against `frontend/vite.config.ts`'s existing `server.proxy` config).

**Project Type**: Web application (existing `backend/` + `frontend/` + `packages/shared-domain/`
workspace structure, unchanged)

**Performance Goals**: Session lookup/assignment must add no perceptible latency to any
existing workflow request — a single `Map` get/set is O(1), consistent with SC-002 ("no change
in behavior" for the single-user case).

**Constraints**: In-memory only, no new persistence layer (FR-008); 60-minute idle-session
eviction (FR-007); small-team scale — comfortably up to ~20 concurrent sessions, no explicit
capacity cap beyond idle-eviction (per Clarifications).

**Scale/Scope**: ~20 concurrent browser sessions (small-team/demo scale, per Clarifications);
one in-process backend, no horizontal scaling in this feature's scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Specification Is the Source of Truth | PASS | Unaffected — no API-model/contract-fabrication behavior touched. |
| II. Deterministic Before AI | PASS | Purely infrastructural; no AI involved. |
| V–VII. Local-First AI / Provider Independence / Model Selection | PASS | FR-005 keeps the AI provider's readiness state and inference queue global/shared, explicitly unaffected by session isolation. |
| VIII. Framework-Independent Test Model | PASS | `TestGenerationWorkflow`'s shape is unchanged (spec Key Entities); only how many instances exist and which requests may reach one changes. |
| IX. Separation of Concerns | PASS | The session boundary lives in one middleware + `workflowStore.ts`'s internals; the `AsyncLocalStorage` approach means none of the eight stage modules or the route file needs to change, so this concern stays fully isolated from test-generation logic. |
| X. Domain Model First | PASS (explicit decision) | "Session" is deliberately kept out of `packages/shared-domain` — it is HTTP-transport infrastructure (a cookie/identifier), not a cross-layer business concept the frontend needs to model, beyond the one additive `sessionExpired` boolean on the existing workflow-fetch response. See research.md. |
| XVII. Security and Privacy by Design | PASS (explicit decisions) | FR-004a requires a cryptographically random, unguessable session id (`crypto.randomUUID()`, ~122 bits of entropy); the cookie is set `httpOnly` (not readable by page JS) and `sameSite=lax` (reduces cross-site request forgery exposure); no new persistence; no PII collected (FR-004). |
| XIX. Fail Safely | PASS | FR-007a surfaces idle-eviction explicitly (`sessionExpired: true`) instead of letting it look like an ordinary empty state. |
| XX. Observability Without Sensitive Logging | PASS (explicit decision) | The session id is effectively a bearer credential for that session's workflow data once issued; logs MUST NOT record it in full (a log reader could otherwise replay it to access a live session). Structured logs use a short, non-reversible prefix (first 8 hex chars) for correlation instead of the full id. See research.md. |
| XXI. Testability at Every Boundary | PASS | Session isolation is independently testable via two `supertest` agents (each maintaining its own cookie jar) issuing concurrent requests against one `app` instance; idle-eviction is testable with `vi.useFakeTimers()`, consistent with existing Vitest usage elsewhere in the repo. |
| XXVII. Prefer Simple Architecture | PASS | `AsyncLocalStorage` + an in-memory `Map` + one `setInterval` sweep — all Node built-ins, zero new dependencies, no new service/infrastructure. |
| XXVIII. Technology Is Replaceable | PASS | The session-keyed store is an implementation detail fully behind `workflowStore.ts`'s existing function-based API; swapping it later (e.g. for a shared cache) would not require touching any caller. |
| XXX. Explicit Trade-offs | PASS (documented) | Cookie-based session identity was chosen over a client-supplied header/token for the smallest change to existing `fetch` call sites (same-origin cookies are sent automatically, no client code change needed); this ties session identity to one browser profile, not a portable device-independent login, which the spec's Assumptions section already accepts as in-scope behavior. |
| XXXIII. Presentation Must Be Consistent, Coherent, and Usable | Applies at implementation | The new "session expired" notice (FR-007a) must reuse the project's existing Tailwind/EmptyState presentation conventions (`.claude/CLAUDE.md` §26–43) rather than introducing bespoke styling. |

No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/017-session-workflow-isolation/
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
│   ├── session/
│   │   ├── sessionContext.ts        # AsyncLocalStorage<{ sessionId: string }> + accessor (new)
│   │   ├── sessionMiddleware.ts     # Express middleware: cookie read/issue, runs request in context (new)
│   │   └── sessionRegistry.ts       # Map<sessionId, { lastActivityAt, expired }>, idle-eviction sweep (new)
│   ├── testGenerationWorkflow/
│   │   ├── workflowStore.ts         # MODIFIED: index state by sessionId from sessionContext instead of one module-level variable; exported function signatures unchanged
│   │   └── (all *Stage.ts modules)  # UNCHANGED — they only call workflowStore's existing exports
│   ├── api/
│   │   └── testGenerationWorkflow.ts # MODIFIED: GET handler's "no workflow" branch gains the sessionExpired case; every other route unchanged
│   └── app.ts                       # MODIFIED: registers the session middleware before the routers
└── tests/
    ├── unit/session/                 # sessionRegistry idle-eviction, sessionContext plumbing (new)
    └── integration/
        └── sessionIsolation.test.ts  # two supertest agents run concurrent workflows without collision (new)

frontend/
├── src/
│   ├── services/testGenerationWorkflowClient.ts # MODIFIED: WorkflowOrNoneResult gains optional sessionExpired
│   └── pages/TestGenerationWorkflowPage.tsx      # MODIFIED: renders the "session expired" notice on that response shape
└── tests/
    └── (TestGenerationWorkflowPage test)         # MODIFIED: covers the new notice
```

**Structure Decision**: Existing `backend/` + `frontend/` + `packages/shared-domain/` workspace
layout is unchanged. A new `backend/src/session/` module is added as the sole home of the
session-identity/eviction infrastructure, kept deliberately separate from
`testGenerationWorkflow/` (which owns workflow domain logic, not transport-level session
identity — Separation of Concerns, IX). No `packages/shared-domain/` change beyond the one
additive `sessionExpired?: boolean` field already implied by FR-007a, since "Session" itself is
not a cross-layer domain concept (see Constitution Check, X, and research.md).

## Complexity Tracking

*No Constitution Check violations — this section is intentionally empty.*
