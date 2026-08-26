---

description: "Task list template for feature implementation"
---

# Tasks: Application Foundation

**Input**: Design documents from `/specs/001-application-foundation/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required for user stories), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: This feature's own scope (FR-007, FR-008, User Story 3) is to establish the
testing infrastructure and prove it works, so representative test tasks are included
(not generic TDD contract tests, since there is no external business contract yet beyond
the health endpoint).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Web application monorepo (per [plan.md](./plan.md) Project Structure):

- `backend/src/`, `backend/tests/`
- `frontend/src/`, `frontend/tests/`
- `packages/shared-domain/src/`, `packages/shared-domain/tests/`
- Root: `package.json`, `tsconfig.base.json`, `README.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic monorepo structure

- [ ] T001 Create root `package.json` with npm workspaces (`backend`, `frontend`, `packages/shared-domain`) and `tsconfig.base.json` at repository root
- [ ] T002 [P] Initialize backend workspace: `backend/package.json`, `backend/tsconfig.json`, add Express + TypeScript + `@types/express` dependencies
- [ ] T003 [P] Initialize frontend workspace: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, add React 18 + Vite 5 + TypeScript dependencies
- [ ] T004 [P] Initialize shared-domain workspace: `packages/shared-domain/package.json`, `packages/shared-domain/tsconfig.json`
- [ ] T005 [P] Configure ESLint + Prettier at repository root (`.eslintrc.cjs`, `.prettierrc`) covering `backend/`, `frontend/`, `packages/shared-domain/`
- [ ] T006 Configure a root Vitest workspace config (`vitest.workspace.ts`) covering `backend/`, `frontend/` (jsdom environment), and `packages/shared-domain/`, and add Supertest + React Testing Library dev dependencies

**Checkpoint**: Monorepo installs cleanly with `npm install` (SC-001 prerequisite)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 Create `HealthStatus` shared type (`status`, `timestamp`) in `packages/shared-domain/src/index.ts` per [data-model.md](./data-model.md)
- [ ] T008 Add `packages/shared-domain` as a workspace dependency of `backend` and `frontend` (package.json `dependencies` + TS path/reference wiring) so the type is importable from both
- [ ] T009 [P] Create Express app skeleton: `backend/src/app.ts` (app + middleware wiring) and `backend/src/server.ts` (HTTP listener entry point, reads `BACKEND_PORT`)
- [ ] T010 [P] Create React app skeleton: `frontend/src/main.tsx` and a root `frontend/src/App.tsx` component
- [ ] T011 Add environment configuration: `.env.example` with `BACKEND_PORT` and `FRONTEND_DEV_PORT`, and a small config loader used by `backend/src/server.ts`
- [ ] T012 Add centralized error-handling middleware in `backend/src/app.ts` that catches unhandled errors and returns a safe JSON `5xx` response instead of a stack trace (constitution XIX, Fail Safely)
- [ ] T013 Add root `package.json` scripts: `dev` (runs backend + frontend dev servers in parallel via `concurrently`) and `test` (runs Vitest across all workspaces)

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Run the Application Locally (Priority: P1) 🎯 MVP

**Goal**: A developer can start the frontend + backend with one command, see the frontend
in a browser, and get a successful health-check response from the backend.

**Independent Test**: Clone → `npm install` → `npm run dev` → open the printed frontend URL
in a browser → confirm `GET /api/health` returns the documented shape.

### Tests for User Story 1

- [ ] T014 [P] [US1] Integration test for `GET /api/health` in `backend/tests/integration/health.test.ts` using Supertest, asserting the response shape from [contracts/health-api.md](./contracts/health-api.md) (write first; confirm it fails before T015)

### Implementation for User Story 1

- [ ] T015 [US1] Implement `GET /api/health` route in `backend/src/api/health.ts` returning a `HealthStatus` value (depends on T007, T014)
- [ ] T016 [US1] Register the health route in `backend/src/app.ts` (depends on T015)
- [ ] T017 [US1] Implement a small API client in `frontend/src/services/healthClient.ts` that calls `GET /api/health`
- [ ] T018 [US1] Display backend connection status (ok / unreachable) in `frontend/src/App.tsx` using `healthClient`
- [ ] T019 [US1] Configure a Vite dev-server proxy for `/api` in `frontend/vite.config.ts` so the frontend can reach the backend without a CORS workaround
- [ ] T020 [US1] Write the setup/startup section of root `README.md` (`npm install`, `npm run dev`, how to verify the frontend and health check) covering FR-006 and FR-012
- [ ] T021 [US1] Manually validate: run `npm run dev`, stop it, and restart it, confirming the application returns to the same working state (Acceptance Scenario 1.2)

**Checkpoint**: User Story 1 is fully functional and independently testable/demoable

---

## Phase 4: User Story 2 - Extend the Codebase With a New Feature Module (Priority: P2)

**Goal**: A developer can add a new backend endpoint and a new shared domain type without
modifying unrelated frontend/backend/shared files.

**Independent Test**: Add a second backend route and a second shared type following the
documented conventions; confirm no unrelated files needed changes.

### Tests for User Story 2

- [ ] T022 [P] [US2] Unit test for a second shared domain type (e.g., `VersionInfo`) in `packages/shared-domain/tests/unit/version-info.test.ts` (write first; confirm it fails before T024)

### Implementation for User Story 2

- [ ] T023 [US2] Add an example second backend route `GET /api/version` in `backend/src/api/version.ts` and register it in `backend/src/app.ts`, without modifying `frontend/` or existing `packages/shared-domain` exports
- [ ] T024 [US2] Add a `VersionInfo` type to `packages/shared-domain/src/index.ts` (depends on T022)
- [ ] T025 [US2] Consume `VersionInfo` from both `backend/src/api/version.ts` and a new `frontend/src/components/VersionBadge.tsx`, proving reuse without duplication (depends on T024)
- [ ] T026 [US2] Document the project structure and module boundaries (what lives in `backend/`, `frontend/`, `packages/shared-domain/`) in an "Architecture" section of root `README.md`, covering FR-004 and FR-011

**Checkpoint**: User Stories 1 AND 2 both work independently

---

## Phase 5: User Story 3 - Verify Correctness Through Automated Tests (Priority: P3)

**Goal**: The full automated test suite (backend, frontend, shared) runs from a clean
checkout and reports clear, consistent pass/fail results.

**Independent Test**: Run `npm test` from a clean checkout after `npm install`; confirm
tests execute across all three workspaces and results are stable across repeated runs.

### Implementation for User Story 3

- [ ] T027 [P] [US3] Unit test for `HealthStatus` shape/validation in `packages/shared-domain/tests/unit/health-status.test.ts`
- [ ] T028 [P] [US3] Component smoke test for `frontend/src/App.tsx` using React Testing Library in `frontend/tests/unit/App.test.tsx`
- [ ] T029 [US3] Configure the root Vitest workspace reporter so `npm test` output clearly labels pass/fail per workspace (`backend`, `frontend`, `packages/shared-domain`), satisfying FR-008
- [ ] T030 [US3] Document the `npm test` command and how to read its output in a "Testing" section of root `README.md`
- [ ] T031 [US3] Manually validate determinism: run `npm test` twice with no code changes and confirm identical pass/fail results (Acceptance Scenario 3.3)

**Checkpoint**: All user stories are independently functional, and the test suite validates them (SC-002, SC-003)

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T032 [P] Add actionable startup error handling in `backend/src/server.ts` for a port already in use and for an unsupported Node.js version, per spec Edge Cases
- [ ] T033 [P] Add a clear frontend connection-error state in `frontend/src/App.tsx` for when the backend is unreachable, per spec Edge Cases
- [ ] T034 [P] Pin the Node.js version via an `engines` field in root `package.json` and an `.nvmrc` file (Node 20 LTS)
- [ ] T035 Final pass on root `README.md` to confirm setup, startup, architecture, and testing instructions are complete and accurate (FR-012)
- [ ] T036 Execute the full [quickstart.md](./quickstart.md) validation checklist end-to-end and confirm every item passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion only
- **User Story 2 (Phase 4)**: Depends on Foundational completion only (independent of US1, though it runs after it here since P2 < P1 priority)
- **User Story 3 (Phase 5)**: Depends on Foundational completion; benefits from US1/US2 code existing to test, but its own tasks (T027-T031) are independently addable
- **Polish (Phase 6)**: Depends on all three user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories
- **User Story 2 (P2)**: No dependencies on US1; independently testable
- **User Story 3 (P3)**: No hard dependency on US1/US2 code, but its example tests are most meaningful once US1 (health endpoint) and US2 (version endpoint/shared type) exist

### Within Each User Story

- Tests before implementation (T014 before T015; T022 before T024)
- Shared/domain types before consumers
- Backend route before frontend consumption of that route
- Story complete before moving to the next priority

### Parallel Opportunities

- All Setup tasks marked [P] (T002-T005) can run in parallel
- Foundational tasks T009 and T010 can run in parallel (different workspaces)
- T014 (US1 test) can be written in parallel with T009/T010 once T007 exists
- T022 (US2 test) can run in parallel with US1 implementation tasks
- T027 and T028 (US3) can run in parallel with each other
- T032, T033, T034 in Polish can all run in parallel

---

## Parallel Example: User Story 1

```bash
# Backend and frontend skeletons can be built in parallel (Foundational):
Task: "Create Express app skeleton in backend/src/app.ts and backend/src/server.ts"
Task: "Create React app skeleton in frontend/src/main.tsx and frontend/src/App.tsx"

# Then, within User Story 1:
Task: "Integration test for GET /api/health in backend/tests/integration/health.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run `npm run dev`, confirm frontend loads and `/api/health` responds
5. This is a demoable MVP: "the ApiPilot application runs locally"

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Validate manually → Demo (MVP!)
3. Add User Story 2 → Validate manually → Demo (structure proven extensible)
4. Add User Story 3 → Run `npm test` → Demo (test suite proven reliable)
5. Polish → Final quickstart validation

### Parallel Team Strategy

With multiple developers, after Setup + Foundational are done:

- Developer A: User Story 1 (health endpoint + frontend connection)
- Developer B: User Story 2 (second endpoint + shared type)
- Developer C: User Story 3 (test infrastructure + example tests)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- No AI, persistence, or authentication tasks are included, per spec Assumptions and FR-009/FR-010
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
