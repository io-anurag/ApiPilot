---

description: "Task list for 025-local-persistence-layer"
---

# Tasks: Local Persistence Layer

**Input**: Design documents from `specs/025-local-persistence-layer/` (spec.md, plan.md, research.md, data-model.md, contracts/persistence-repositories.md, quickstart.md)

**Prerequisites**: plan.md (required), spec.md (required for user stories) — both present and in sync as of the 2026-09-16 `/speckit.clarify` session.

**Tests**: Included (not merely optional here) — this repository's engineering conventions (`.claude/CLAUDE.md` §51-52) treat tests as part of the feature, not an afterthought, and constitution XXI requires every transformation boundary to be independently testable.

**Organization**: Tasks are grouped by user story (spec.md priorities: US1 = P1, US2 = P2, US3 = P3) so each can be implemented, tested, and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1/US2/US3) — omitted for Setup, Foundational, and Polish tasks
- File paths are exact and relative to the repository root (`D:\api\ApiPilot`)

## Path Conventions

Web application layout per plan.md: `backend/src/`, `backend/tests/`, `packages/shared-domain/src/`. This feature is backend-only; no `frontend/` changes.

---

## Phase 1: Setup

**Purpose**: Bring in the one new dependency and document the new configuration variable.

- [X] T001 Add `better-sqlite3` to `dependencies` and `@types/better-sqlite3` to `devDependencies` in `backend/package.json`, then run `npm install` from the repo root so the workspace lockfile picks it up (research.md D1).
- [X] T002 [P] Document `APIPILOT_DB_PATH` in `.env.example`, immediately after the existing `AI_MODEL_CACHE_DIR` entry, following that entry's comment style (default path, what it's for) (research.md D2).

**Checkpoint**: Dependency installed, configuration documented — no code yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared connection/schema/crypto/test-isolation infrastructure every user story's repository builds on.

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [X] T003 Create `backend/src/persistence/errors.ts` with `PersistenceInitializationError` (thrown when the DB file cannot be opened or read; research.md D9).
- [X] T004 [P] Create `backend/src/persistence/config.ts` with `resolveDbPath(env = process.env)` reading `APIPILOT_DB_PATH`, falling back to `path.join(os.homedir(), ".apipilot", "apipilot.db")` — mirrors `backend/src/ai/modelConfig.ts`'s `DEFAULT_CACHE_DIR` pattern exactly (research.md D2).
- [X] T005 [P] Create `backend/src/persistence/credentialCipher.ts` with `encrypt(plaintext: string)`/`decrypt(ciphertext, iv)` using Node's built-in `node:crypto` (AES-256-GCM), generating a symmetric key file alongside the DB path on first use if absent (research.md D7).
- [X] T006 Create `backend/src/persistence/connection.ts`: a `SqliteConnection` wrapping `better-sqlite3`'s `Database`, opening the path from T004 (or an explicit path, e.g. `":memory:"`), wrapping any open failure in `PersistenceInitializationError` (T003); its `initializeSchema()` runs idempotent `CREATE TABLE IF NOT EXISTS` for `environments`, `execution_runs`, `ai_readiness_history`, and `benchmark_runs` plus their indexes, then sets `PRAGMA user_version = 1` (data-model.md, research.md D8). Export a module-level `getSharedConnection()` singleton that resolves the path via T004, opens it, and calls `initializeSchema()` once. [depends on T003, T004]
- [X] T007 [P] Create `backend/tests/setup/testDb.ts`: a `beforeEach` that opens a fresh `SqliteConnection` (T006) against `":memory:"` and replaces `getSharedConnection()`'s instance for the duration of each test, so no test ever touches a real `APIPILOT_DB_PATH` file (research.md D10). [depends on T006]
- [X] T008 Add `./tests/setup/testDb.ts` to `backend/vitest.config.ts`'s `setupFiles` array, alongside the existing `sessionTestContext.ts`. [depends on T007]
- [X] T009 Wire `backend/src/server.ts` to call `getSharedConnection()` (T006) before `createApp(...)`, catching `PersistenceInitializationError` to log an error-category-only message and `process.exit(1)`, mirroring the existing `EADDRINUSE` handling already in that file (FR-005, FR-007, FR-010, SC-004; research.md D9). [depends on T006]

**Checkpoint**: Foundation ready — DB opens, schema initializes, tests are isolated, corrupted-DB startup fails loudly. User story work can now begin.

---

## Phase 3: User Story 1 - Environments and credentials survive a restart (Priority: P1) 🎯 MVP

**Goal**: A saved environment (including credential-like values) survives a backend restart for as long as its owning browser session remains active.

**Independent Test**: Configure an environment, restart the backend process, reload the page in the same browser tab, and confirm the environment (including its credential value) is still present and selectable with no re-entry (spec.md Independent Test, quickstart.md §2).

### Implementation for User Story 1

- [X] T010 [P] [US1] Define the `EnvironmentRepository` interface and implement `SqliteEnvironmentRepository` in `backend/src/persistence/environmentRepository.ts` — `list`/`get`/`create`/`update`/`deleteBySession`, encrypting/decrypting `variableValues` via `credentialCipher` (T005); export a singleton built on `getSharedConnection()` (T006) (contracts/persistence-repositories.md, data-model.md `environments` table). [depends on T006, T005]
- [X] T011 [US1] Rewrite `backend/src/execution/environmentStore.ts` to delegate every exported function (`listEnvironments`, `getEnvironment`, `createEnvironment`, `updateEnvironment`) to the T010 repository, removing the in-memory `sessionEnvironments` Map entirely while preserving every existing exported function signature and error type (`DuplicateEnvironmentNameError`, `EnvironmentNotFoundError`) (research.md D4). [depends on T010]
- [X] T012 [US1] Update the `onExpire` listener in `backend/src/execution/environmentStore.ts` to call the T010 repository's `deleteBySession(sessionId)` instead of `Map.delete`, preserving today's 60-minute idle-eviction behavior unchanged. [depends on T011]
- [X] T013 [US1] Correct the stale doc comments on `Environment`/`EnvironmentTier` in `packages/shared-domain/src/execution.ts` (currently claim "no durable persistence... never written to durable storage") to reflect `specs/018-test-execution-results`'s FR-005 amendment.
- [X] T014 [US1] Update `backend/tests/unit/execution/environmentStore.test.ts` and `backend/tests/integration/execution/environments.test.ts` to cover: an environment survives a fresh connection reopen within the same session (simulating a restart), two sessions' environments remain isolated from each other, and idle-session eviction still removes an environment (T012's behavior). [depends on T011, T012, T007]
- [X] T015 [US1] Manually run quickstart.md §1 (first-run DB creation) and §2 (environment survives a restart) to validate User Story 1 end-to-end. [depends on T014]

**Checkpoint**: User Story 1 is independently functional and testable — this is the MVP slice.

---

## Phase 4: User Story 2 - Execution run history survives a restart (Priority: P2)

**Goal**: Completed and interrupted execution runs survive a backend restart, with an interrupted run clearly and diagnosably distinguished from a user-cancelled one.

**Independent Test**: Execute a set of scenarios, restart the backend, and confirm the run's history, status, and per-request results are still retrievable; separately, kill the backend mid-run and confirm the run settles as cancelled with a "backend-restart" reason rather than "user-requested" (spec.md Independent Test, quickstart.md §3-4).

### Implementation for User Story 2

- [X] T016 [P] [US2] Define the `ExecutionRunRepository` interface and implement `SqliteExecutionRunRepository` in `backend/src/persistence/executionRunRepository.ts` — `listBySession`/`get`/`getInProgress`/`create`/`appendResult`/`settle` (with a `cancelReason` parameter)/`requestCancel`/`deleteBySession`/`markInterruptedRunsCancelled`; export a singleton built on `getSharedConnection()` (T006) (contracts/persistence-repositories.md, data-model.md `execution_runs` table including `cancel_reason`). [depends on T006]
- [X] T017 [US2] Rewrite `backend/src/execution/executionRunStore.ts` to delegate every exported function to the T016 repository, removing the in-memory `sessionStates` Map entirely, and change `settleRun`'s signature to `settleRun(runId, status, cancelReason?)`, forwarding `cancelReason` to the repository (research.md D4, data-model.md). [depends on T016]
- [X] T018 [US2] Update the `onExpire` listener for execution runs to call the T016 repository's `deleteBySession(sessionId)` instead of `Map.delete` (mirrors T012). [depends on T017]
- [X] T019 [US2] Update `backend/src/execution/runExecution.ts`'s two user-initiated cancellation call sites (`settleRun(runId, "cancelled")` at lines 130 and 139) to pass `"user-requested"` as the cancel reason. [depends on T017]
- [X] T020 [US2] Call `markInterruptedRunsCancelled()` (T016) from `backend/src/server.ts` once at startup — after opening the connection (T009), before `app.listen` — so any run left `"in-progress"` from a prior process settles as `"cancelled"`/`"backend-restart"` (FR-008, data-model.md). [depends on T016, T009]
- [X] T021 [US2] Add the new `cancelReason?: "user-requested" | "backend-restart"` field to `ExecutionRun` in `packages/shared-domain/src/execution.ts`, documented as present only when `status === "cancelled"` (data-model.md). [depends on T016]
- [X] T022 [US2] Update `backend/tests/unit/execution/executionRunStore.test.ts` and `backend/tests/integration/execution/executionRuns.test.ts` to cover: a completed run survives a fresh connection reopen; an in-progress run found by `markInterruptedRunsCancelled()` settles as cancelled with `cancelReason: "backend-restart"`; a user-cancelled run carries `cancelReason: "user-requested"`. [depends on T019, T020, T021, T007]
- [X] T023 [US2] Manually run quickstart.md §3 (execution history survives a restart) and §4 (in-progress run marked interrupted) to validate User Story 2 end-to-end. [depends on T022]

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - AI readiness and benchmark history survive a restart (Priority: P3)

**Goal**: The AI subsystem's last known readiness state and most recent benchmark result remain visible after a restart, without the live readiness state machine ever appearing to resume a state it hasn't actually re-verified.

**Independent Test**: Reach a known readiness state (or run a benchmark), restart the backend, and confirm `GET /api/ai/status` shows the last known state/benchmark immediately, while `state` itself still starts fresh (spec.md Independent Test, quickstart.md §5).

### Implementation for User Story 3

- [X] T024 [P] [US3] Define the `AiDiagnosticsRepository` interface and implement `SqliteAiDiagnosticsRepository` in `backend/src/persistence/aiDiagnosticsRepository.ts` — `recordReadinessTransition`/`getLastKnownReadiness`/`recordBenchmarkRun`/`getLatestBenchmarkRun`; export a singleton built on `getSharedConnection()` (T006) (contracts/persistence-repositories.md, data-model.md `ai_readiness_history`/`benchmark_runs` tables). [depends on T006]
- [X] T025 [US3] Update `backend/src/ai/readiness.ts`'s `ReadinessTracker.markLoading`/`markReady`/`markUnavailable` to also call `recordReadinessTransition` (T024), leaving the existing in-memory state machine and `getState()` behavior completely unchanged (research.md D5). [depends on T024]
- [X] T026 [US3] Update `backend/src/ai/benchmark/runBenchmark.ts`'s `main()` to call `recordBenchmarkRun` (T024) with the same `BenchmarkReport` immediately after writing `benchmark-results.json`, leaving the file-writing behavior unchanged (research.md D6). [depends on T024]
- [X] T027 [US3] Update `backend/src/api/aiStatus.ts`'s `GET /api/ai/status` handler to include `lastKnownReadiness` and `latestBenchmarkRun` fields sourced from T024's repository, per the amended `specs/004-ai-provider-local-inference/contracts/ai-status-api.md` contract. [depends on T024]
- [X] T028 [US3] Update `backend/tests/unit/ai/readiness.test.ts` and `backend/tests/integration/aiStatus.test.ts` to cover: a readiness transition is recorded and retrievable as `lastKnownReadiness` without affecting the live `state`, and a recorded benchmark run appears as `latestBenchmarkRun`. [depends on T025, T026, T027, T007]
- [X] T029 [US3] Manually run quickstart.md §5 (AI readiness/benchmark history visible without re-running anything) to validate User Story 3 end-to-end. [depends on T028]

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the requirements that span all three stories rather than belonging to any one of them.

- [X] T030 [P] Manually run quickstart.md §6 (corrupted DB file fails startup explicitly, FR-007) and confirm the process exits non-zero without deleting or altering the corrupted file.
- [X] T031 [P] Manually run quickstart.md §7 (automated tests never touch the real DB file, FR-011) by deleting `%USERPROFILE%\.apipilot\apipilot.db` and confirming `npm test -w backend` still passes with no new file created.
- [X] T032 [P] Review every new/modified file under `backend/src/persistence/` and its call sites for constitution XX compliance — confirm no `createLogger(...)` call ever receives raw SQL, a file path, or a credential value (SC-006).
- [X] T033 Run `npm test`, `npm run lint`, and `npm run build` from the repository root and fix any failures.
- [X] T034 Re-read `packages/shared-domain/src/execution.ts` and `specs/004-ai-provider-local-inference/contracts/ai-status-api.md` end-to-end to confirm no other stale "non-durable"/"not extended" claims were missed beyond the ones already corrected in T013/T021/T027.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001 must land before T006 can `import "better-sqlite3"`). BLOCKS all user stories.
- **User Stories (Phase 3-5)**: All depend on Foundational (T003-T009) completion. Independent of each other — can proceed in parallel or in priority order (US1 → US2 → US3).
- **Polish (Phase 6)**: Depends on all three user stories being complete (T030/T031 validate cross-cutting FR-007/FR-011 that only make sense once every story's writes exist; T033 runs the full suite).

### User Story Dependencies

- **US1 (P1)**: No dependency on US2/US3 — touches only `environmentStore.ts`/`environmentRepository.ts`.
- **US2 (P2)**: No dependency on US1's implementation, though T020 shares `server.ts` with T009 (sequential edits to the same file, not a functional dependency).
- **US3 (P3)**: No dependency on US1/US2 — touches only `ai/` files.

### Within Each User Story

- Repository implementation (e.g. T010/T016/T024) before the store/module that delegates to it.
- `onExpire`/call-site updates after the store rewrite they depend on.
- Shared-domain doc/type corrections can happen any time after the repository exists (grouped with each story for traceability).
- Tests after the behavior they cover exists.
- Quickstart validation last, as the story's final checkpoint.

### Parallel Opportunities

- T004 and T005 (Foundational) can run in parallel — different files, no shared dependency.
- Once Foundational (T003-T009) is complete, T010 (US1), T016 (US2), and T024 (US3) can start in parallel — three different repository files, each depending only on T006.
- T030, T031, and T032 (Polish) can run in parallel.

---

## Parallel Example: Foundational → Story Kickoff

```bash
# After T003-T009 complete, three developers can start their story's repository in parallel:
Task: "Implement SqliteEnvironmentRepository in backend/src/persistence/environmentRepository.ts"
Task: "Implement SqliteExecutionRunRepository in backend/src/persistence/executionRunRepository.ts"
Task: "Implement SqliteAiDiagnosticsRepository in backend/src/persistence/aiDiagnosticsRepository.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T009) — CRITICAL, blocks all stories
3. Complete Phase 3: User Story 1 (T010-T015)
4. **STOP and VALIDATE**: run quickstart.md §1-2 independently
5. This is a demoable MVP: environments/credentials now survive a restart

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add User Story 1 → validate independently → demo (MVP)
3. Add User Story 2 → validate independently → demo
4. Add User Story 3 → validate independently → demo
5. Polish (T030-T034) once all three stories are in

### Parallel Team Strategy

With three developers: complete Setup + Foundational together, then one developer per story (T010-T015 / T016-T023 / T024-T029) in parallel — the only shared-file friction is `backend/src/server.ts` (T009 then T020), which is a small, sequential, non-conflicting addition.

---

## Notes

- [P] tasks touch different files and have no incomplete dependency.
- [US1]/[US2]/[US3] labels map each task to its user story for traceability back to spec.md.
- Every "MODIFIED" file listed in plan.md's Project Structure is covered by exactly one task above.
- Commit after each task or logical group; verify `npm test -w backend` still passes at every checkpoint.
