# Implementation Plan: Application Foundation

**Branch**: `001-application-foundation` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-application-foundation/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Establish the local ApiPilot web application: a React/TypeScript frontend, a Node.js/
TypeScript backend API layer, and a shared domain package, all managed in a single npm
workspaces monorepo with a unified test runner. The backend exposes a basic health-check
endpoint the frontend calls to confirm connectivity. No AI functionality, persistence,
authentication, or OpenAPI-specific logic is included — this feature only establishes the
runnable, testable, extensible foundation that AP-002 onward will build on.

## Technical Context

**Language/Version**: TypeScript 5.x throughout, running on Node.js 20 LTS (backend) and
compiled to ES2022 for the browser bundle (frontend)

**Primary Dependencies**: Express 4.x (backend HTTP API), React 18 + Vite 5 (frontend
app/dev server), npm workspaces (monorepo management) — no additional framework-level
dependencies beyond these

**Storage**: N/A — the backend is stateless for this foundation; no database or file
persistence is required

**Testing**: Vitest as the single test runner for backend, frontend, and shared packages;
Supertest for backend HTTP integration tests; React Testing Library for frontend component
smoke tests

**Target Platform**: Local developer machine (Windows/macOS/Linux) running Node.js 20 LTS;
frontend targets evergreen browsers (Chrome, Edge, Firefox)

**Project Type**: Web application — frontend + backend + shared domain package monorepo

**Performance Goals**: Not performance-critical at this stage; dev servers ready in under
5 seconds, health-check endpoint responds in under 100ms locally

**Constraints**: Must run entirely offline/local with zero cloud or AI dependencies
(FR-009, FR-010); must support a single documented startup command (FR-006); must not
require a database or external account to run

**Scale/Scope**: Single local developer/user; one frontend app, one backend service, one
shared domain package — explicitly excludes auth, persistence, deployment, and AI (see
spec Assumptions)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Specification Is the Source of Truth | N/A | No OpenAPI/contract processing exists yet; introduced in AP-002 |
| II. Deterministic Before AI | PASS | This feature is 100% deterministic infrastructure; no AI involved |
| III–VII. AI provider / local-first / provider independence | N/A | No AI functionality in scope (spec FR-009); `AIProvider` abstraction is introduced in AP-004 |
| VIII. Framework-Independent Test Model | N/A | `TestModel` does not exist until AP-003 |
| IX. Separation of Concerns | PASS | `backend/`, `frontend/`, and `packages/shared-domain/` are separate workspaces with distinct responsibilities and no cross-boundary imports |
| X. Domain Model First | PASS | `packages/shared-domain` is established now as the seam future domain models (`ApiModel`, `TestModel`, etc.) will occupy, consumed by both frontend and backend |
| XVII. Security and Privacy by Design | PASS | No secrets, no file upload, no persistence; backend only serves local requests |
| XXI. Testability at Every Boundary | PASS | Vitest covers backend, frontend, and shared packages independently; no model dependency required to run the suite |
| XXVII. Prefer Simple Architecture | PASS | npm workspaces only (no Nx/Turborepo/Lerna); Express and React are minimal, mature, widely-adopted choices; no distributed infra introduced |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | PASS | Express/React/Vite/Vitest are isolated behind `backend/`, `frontend/` boundaries; `shared-domain` holds framework-agnostic types |
| XXV. Incremental Delivery | PASS | This is the first increment in the roadmap's incremental sequence and has an independently testable/demonstrable outcome |

**Initial Constitution Check: PASS** — no violations; Complexity Tracking is empty.

**Post-Design Constitution Check (after Phase 1)**: PASS — `data-model.md` introduces only
the `HealthStatus` shared type (no framework coupling), `contracts/health-api.md` defines a
minimal, non-speculative endpoint, and `quickstart.md` requires no AI/cloud credentials.
No new violations were introduced by the Phase 1 design; Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-application-foundation/
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
│   ├── api/            # HTTP routes (e.g., health check)
│   ├── app.ts          # Express app wiring (routes, middleware)
│   └── server.ts       # Entry point: starts the HTTP listener
└── tests/
    ├── unit/
    └── integration/     # Supertest-driven HTTP tests

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   ├── services/        # API client calling the backend
│   └── main.tsx
└── tests/
    └── unit/             # React Testing Library smoke tests

packages/
└── shared-domain/
    ├── src/
    │   └── index.ts      # Shared types (e.g., HealthStatus) reused by backend + frontend
    └── tests/
        └── unit/

package.json               # npm workspaces root (backend, frontend, packages/*)
tsconfig.base.json          # Shared TypeScript compiler options
README.md                   # Setup, startup, and test-running instructions
```

**Structure Decision**: Web application layout (frontend + backend), extended with a
`packages/shared-domain` workspace so domain types can be shared without duplication
(constitution X, Domain Model First). npm workspaces was chosen over Nx/Turborepo/pnpm
because it ships with Node/npm and needs no additional tooling, consistent with
constitution XXVII (Prefer Simple Architecture).

## Complexity Tracking

> No Constitution Check violations were identified for this feature; this table is
> intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
