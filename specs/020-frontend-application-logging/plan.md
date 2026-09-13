# Implementation Plan: Frontend Application Logging

**Branch**: `020-frontend-application-logging` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-frontend-application-logging/spec.md`

## Summary

Give the frontend a structured logging utility (levels, timestamp, component, event, primitive
fields) that every existing service-client module logs caught errors through, add a matching
global handler for truly uncaught exceptions/unhandled rejections, and forward `warn`/`error`
entries best-effort to a new, size-limited backend endpoint that writes them through the existing
backend logger under a distinct component — so a frontend failure is recorded consistently
instead of only flashing through the UI or disappearing, without adding a dependency or a second,
less-guarded logging channel.

## Technical Context

**Language/Version**: TypeScript (frontend: React 18 + Vite; backend: Node.js 20 LTS + Express),
matching the existing workspace baseline.

**Primary Dependencies**: None added. Frontend uses the native `fetch` API and `window`
event listeners already available in the target browser environment; backend reuses the existing
Express app, `backend/src/logger.ts`, and `body-parser`/`express.json` (already a transitive
dependency of Express) — consistent with FR-009/SC-004.

**Storage**: N/A for the frontend logger (console only). Backend persists forwarded entries
through the existing `logs/backend.log` file sink (`backend/src/logger.ts`) — no new store.

**Testing**: Vitest + `@testing-library/react`/jsdom on the frontend (existing convention: `vi
.stubGlobal("fetch", …)` for network mocking, as already used in
`frontend/tests/unit/reviewsClient.test.ts` and `frontend/tests/unit/postmanCollectionsClient
.test.ts`); Vitest + Supertest on the backend, matching every existing `backend/src/api/*` route
test.

**Target Platform**: Browser (frontend logger, global handlers) and the existing local Node.js/
Express backend process (ingestion endpoint) — no new runtime target.

**Project Type**: Web application (existing `frontend/` + `backend/` npm workspaces).

**Performance Goals**: No hard throughput target — this is a low-volume diagnostic path, not a
product feature under load. The console-only path (`info`) MUST add negligible overhead (a single
synchronous `console.*` call). The backend-forwarding path (`warn`/`error`) MUST be fire-and-forget
(never awaited by caller code), so it cannot add latency to whatever operation triggered the log.

**Constraints**: Zero new npm dependencies (FR-009); client log ingestion request body capped at
~4–8 KB, independent of and smaller than the existing 10 MB spec-upload limit (FR-013); a
forwarding failure MUST NOT throw or block (FR-008); no field may carry a non-primitive value
(FR-003); nothing may leave the local machine except to the local backend process (FR-012).

**Scale/Scope**: Small, additive feature: one new frontend module (logger + global handler
wiring), one new backend route, and a retrofit of the seven existing modules under
`frontend/src/services/` (`executionClient.ts`, `healthClient.ts`, `postmanCollectionsClient.ts`,
`reviewsClient.ts`, `specificationsClient.ts`, `testGenerationWorkflowClient.ts`,
`testModelsClient.ts`) that currently catch errors without logging them (SC-001's "100% of the
existing service-client modules").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| IX. Separation of Concerns | Pass. Frontend logger is a standalone module; the backend route stays a thin `backend/src/api/*` router that validates and delegates to the existing logger — no business logic in the route beyond validation/adaptation. |
| XVII. Security and Privacy by Design / XX. Observability Without Sensitive Logging | Pass. This feature exists specifically to extend XX's guarantees to the frontend: primitive-only fields (FR-003), no secrets/specs/prompts (FR-004), a dedicated small request-size limit (FR-013), local-machine-only destination (FR-012). |
| XXI. Testability at Every Boundary | Pass. FR-011 requires an injectable time source and a mockable transport; both are satisfied using patterns already established in this codebase (see research.md). |
| XXVII. Prefer Simple Architecture | Pass. No new dependency, no new store, no new abstraction beyond one logger module and one thin route; the per-route body-size limit reuses Express's existing `entity.too.large` → 413 error mapping already present in `backend/src/app.ts`, adding no new error-handling code. |
| XIX. Fail Safely | Pass. FR-008: a forwarding failure degrades to a local console notice; it never throws or blocks the UI. |
| II. Deterministic Before AI | N/A — this feature has no AI-dependent behavior. |
| XVI. Executable Artifacts Must Be Deterministic | N/A — no test-artifact generation is involved. |

No violations identified; Complexity Tracking is not needed.

### Post-Design Re-check

Re-evaluated after Phase 1 (research.md, data-model.md, contracts/, quickstart.md): every design
decision reuses an existing pattern (backend logger, router shape, `entity.too.large` error
mapping, `vi.stubGlobal("fetch", …)` test convention) rather than introducing a new one. No new
dependency, no new store, no new cross-cutting abstraction. The gate table above still holds
unchanged; no new violation was introduced by the concrete design.

## Project Structure

### Documentation (this feature)

```text
specs/020-frontend-application-logging/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── logger.ts                    # NEW — createLogger(component), levels, primitive fields,
│   │                                 injectable clock, best-effort backend forwarding for warn/error
│   ├── globalErrorHandlers.ts       # NEW — installs window "error"/"unhandledrejection" listeners
│   │                                 that route through logger.ts (FR-010a)
│   ├── main.tsx                     # CHANGED — calls installGlobalErrorHandlers() at bootstrap
│   └── services/
│       ├── executionClient.ts        # CHANGED — catch blocks log through logger.ts (FR-010)
│       ├── healthClient.ts           # CHANGED — same
│       ├── postmanCollectionsClient.ts  # CHANGED — same
│       ├── reviewsClient.ts          # CHANGED — same
│       ├── specificationsClient.ts   # CHANGED — same
│       ├── testGenerationWorkflowClient.ts  # CHANGED — same
│       └── testModelsClient.ts       # CHANGED — same
└── tests/unit/
    ├── logger.test.ts                # NEW
    └── globalErrorHandlers.test.ts   # NEW

backend/
├── src/
│   ├── api/
│   │   └── clientLogs.ts            # NEW — thin router: validate, forward to logger.ts
│   ├── app.ts                        # CHANGED — mounts a route-scoped express.json({limit})
│   │                                 before the existing global one, then the new router
│   └── logger.ts                     # UNCHANGED — reused as-is with a new "frontend-client" component
└── tests/
    └── integration/clientLogs.test.ts   # NEW (Supertest, matching the existing health.test.ts
                                          # convention: no separate unit/api/ tests in this repo)
```

**Structure Decision**: Existing two-workspace web-application layout (`frontend/` + `backend/`)
is unchanged; this feature adds one frontend module pair, one backend route, and touches the
seven existing service-client modules plus `app.ts`/`main.tsx` wiring. No new top-level directory
or workspace is introduced.

## Complexity Tracking

*No Constitution Check violations — this section is intentionally empty.*
