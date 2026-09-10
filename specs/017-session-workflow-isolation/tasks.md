---

description: "Task list for Session-Scoped Concurrent Workflow Isolation"
---

# Tasks: Session-Scoped Concurrent Workflow Isolation

**Input**: Design documents from `specs/017-session-workflow-isolation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/session-isolation.md, quickstart.md (all present)

**Tests**: Included — this repo's constitution (XXI, Testability at Every Boundary) and
`.claude/CLAUDE.md` §51–54 require tests as part of every feature, not as an optional add-on.

**Organization**: Tasks are grouped by user story (spec.md) so each story's guarantee can be
verified independently. Note that this feature's mechanism (session identity + per-session
`workflowStore`) is built once, in Phase 2 (Foundational), because all three user stories are
different observable guarantees of that *same* mechanism rather than separable pieces of it —
Phase 2 is unusually large as a result, and Phases 3–4 are correspondingly test-only,
proving guarantees the foundational mechanism already provides. Phase 5 (US3) is the exception:
the idle-expiry *notice* (FR-007a) is new, user-visible behavior on top of the mechanism.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every description

## Path Conventions

Existing monorepo layout (`backend/src/`, `backend/tests/`, `frontend/src/`,
`frontend/tests/`) per plan.md's Project Structure — no new top-level directories.

---

## Phase 1: Setup

**Purpose**: Create the new module's home before anything is written into it.

- [X] T001 Create the `backend/src/session/` and `backend/tests/unit/session/` directories
  (plan.md Project Structure) — no new npm dependency is needed anywhere in this feature
  (research.md D1, D2: `node:async_hooks` and `node:crypto` are Node built-ins).

**Checkpoint**: Directories exist; ready for Foundational implementation.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the session-identity mechanism every user story's guarantee rests on:
`AsyncLocalStorage` context, the session registry (with idle-eviction), the cookie middleware,
and `workflowStore.ts`'s refactor to be session-keyed. Also migrates the three existing test
files that drive the workflow through several sequential requests, since they will otherwise
silently break the moment session cookies are introduced (each bare `request(app)` call
currently starts a fresh, cookie-less connection; a multi-step test needs a persistent cookie
jar across its steps once "the current workflow" means "the current *session's* workflow").

**🚨 CRITICAL**: No user story can be verified until this phase is complete and
`npm test -w backend` passes again.

- [X] T002 [P] Implement `backend/src/session/sessionContext.ts`: a `node:async_hooks`
  `AsyncLocalStorage<{ sessionId: string }>` plus a `getSessionId()` accessor that reads the
  current session id from it (research.md D1).
- [X] T003 [P] Implement `backend/src/session/sessionRegistry.ts`: a `Map<string,
  SessionRegistryEntry>` (data-model.md) with `touch(sessionId)` (create-or-refresh
  `lastActivityAt`), a lookup that reports whether an entry is a live session, absent, or an
  expired tombstone, and a `setInterval` sweep that tombstones (does not delete) any entry idle
  for over 60 minutes (research.md D3, D4). Also export a clearly-marked test-only hook to force
  an entry into the expired-tombstone state immediately, mirroring the existing test-only-hook
  convention already used by `workflowStore.ts`'s `resetStore()` — needed so tests can verify
  expiry behavior without waiting on real wall-clock time or fighting fake timers against
  supertest's own async machinery.
- [X] T004 Implement `backend/src/session/sessionMiddleware.ts`: reads the `sessionId` cookie;
  if it is absent or not a live/tombstoned entry in the registry, generates a new id with
  `crypto.randomUUID()` and sets it via `res.cookie("sessionId", id, { httpOnly: true, sameSite:
  "lax" })` (no `maxAge` — session cookie); calls `sessionRegistry`'s `touch()`; then runs the
  rest of the request inside `sessionContext`'s `AsyncLocalStorage.run()` (research.md D1, D2).
  (Depends on T002, T003.)
- [X] T005 Refactor `backend/src/testGenerationWorkflow/workflowStore.ts`: replace the two bare
  module-level variables (`currentWorkflow`, `nextWorkflowSequence`) with a `Map<sessionId, {
  currentWorkflow, nextWorkflowSequence }>` keyed by `sessionContext.getSessionId()`; every
  exported function (`getCurrentWorkflow`, `startWorkflow`, `updateStage`,
  `setAiEnhancementProgress`, `setAiEnhancementBatchOutcome`, `markAiEnhancementGenerating`,
  `requestAiEnhancementCancel`, `isAiEnhancementCancelRequested`, `advanceActiveStage`,
  `patchWorkflow`) keeps its exact existing signature and body logic, just resolving the
  session's own entry (creating one on first use) before touching it; `resetStore()` clears the
  whole map (data-model.md; research.md D1, D3). (Depends on T002.)
- [X] T006 Register `sessionMiddleware` in `backend/src/app.ts`, before the `/api` routers, so
  every request already has a resolved session by the time it reaches any route. (Depends on
  T004.)
- [X] T007 [P] Migrate `backend/tests/integration/testGenerationWorkflow.test.ts` from a fresh
  `request(app)` per call to one `request.agent(app)` created per test and reused for every step
  in that test's sequence, so its multi-step workflow scenarios keep sharing one session's
  cookie exactly as they share the (now session-scoped) global state today. (Depends on T005,
  T006.)
- [X] T008 [P] Migrate `backend/tests/integration/testGenerationWorkflowAsyncFailure.test.ts`
  the same way as T007. (Depends on T005, T006.)
- [X] T009 [P] Migrate `backend/tests/integration/testGenerationWorkflowDiagnostics.test.ts` the
  same way as T007. (Depends on T005, T006.)
- [X] T009a *(discovered during implementation)* Ten existing unit test files under
  `backend/tests/unit/testGenerationWorkflow/` call `workflowStore.ts`/a stage module directly
  with no HTTP request involved, so `getSessionId()` had no context to read. Added
  `backend/src/session/sessionContext.ts`'s `enterTestSession()` (thin wrapper over
  `AsyncLocalStorage.enterWith`) plus a new Vitest `setupFiles` entry,
  `backend/tests/setup/sessionTestContext.ts`, registered in `backend/vitest.config.ts`, giving
  every backend test its own fresh session id automatically in a global `beforeEach` — no changes
  needed to any of the ten files (research.md D1 addendum). Also discovered and fixed: `multer`'s
  upload middleware does not preserve `AsyncLocalStorage` context across its own completion
  callback, fixed via `sessionMiddleware.ts`'s new `reaffirmSession` export, inserted into the one
  affected route in `backend/src/api/testGenerationWorkflow.ts` (research.md D1 addendum).
- [X] T010 [P] Unit tests for `sessionRegistry.ts` in
  `backend/tests/unit/session/sessionRegistry.test.ts`: `touch()` creates/refreshes an entry;
  `vi.useFakeTimers()` proves the sweep tombstones an entry only after 60 idle minutes and
  leaves an active entry (one that received a request inside the window) alone; a tombstoned
  entry is reported as expired, not absent. (Depends on T003.)
- [X] T011 [P] Unit tests for `sessionMiddleware.ts` in
  `backend/tests/unit/session/sessionMiddleware.test.ts`: a request with no cookie gets a new
  `crypto.randomUUID()`-shaped id set as `httpOnly`/`sameSite=lax`; a request with an existing
  valid cookie keeps that id and does not re-issue a new one. (Depends on T004.)

**Checkpoint**: `npm test -w backend` passes in full (including T007–T011) with the store now
session-scoped. Every user story phase below builds on this.

---

## Phase 3: User Story 1 - A Team Tries ApiPilot Together Without Colliding (Priority: P1) 🎯 MVP

**Goal**: Two or more concurrent sessions each run an independent guided workflow with zero
cross-session visibility or interference (FR-001, FR-003, FR-004, FR-004a, FR-005, FR-010).

**Independent Test**: Two `supertest` agents (separate cookie jars) drive two different
specifications through several interleaved workflow steps against one running `app`; at every
step, each agent's view contains only its own data.

No new production code is required for this story — Phase 2 already provides the mechanism
(a `crypto.randomUUID()` session id, isolated per-session `workflowStore` entries, and an
unaffected shared `AIProvider`). This phase proves those guarantees hold under concurrent,
interleaved use.

- [X] T012 [US1] Create `backend/tests/integration/sessionIsolation.test.ts` with the primary
  cross-session isolation test: two `request.agent(app)` instances upload two different
  specifications and interleave requests advancing through analysis, deterministic generation,
  and a scenario-review decision; assert at each step that each agent's response reflects only
  its own specification/scenarios/decisions (FR-001, FR-003, FR-010; quickstart.md Scenario 1).
  (Depends on T006.)
- [X] T013 [US1] In the same file, add a test case: presenting a guessed/mutated `sessionId`
  cookie value (not one ever issued by the server) never returns another live session's
  workflow — it is treated as unrecognized (FR-004a, FR-010; quickstart.md Scenario 4).
  (Depends on T012.)
- [X] T014 [US1] In the same file, add a test case: two agents both reach AI enhancement (mock
  provider) around the same time; each one's response reflects only its own run's progress and
  outcome, proving the shared provider/queue is unaffected by session isolation (FR-005, FR-009;
  quickstart.md Scenario 6). (Depends on T012.)

**Checkpoint**: User Story 1 is independently verified — concurrent sessions cannot see or
affect each other.

---

## Phase 4: User Story 2 - My Own Progress Survives a Reload or a Second Tab (Priority: P2)

**Goal**: A single browser's own in-progress workflow keeps resuming across reloads and
additional tabs, unchanged from today's pre-feature behavior (FR-002).

**Independent Test**: One `request.agent(app)` starts a workflow, advances a stage, then issues
two more `GET` calls (simulating a reload and a second tab) — both return the same in-progress
workflow.

No new production code is required — Phase 2's session-keyed `Map`, looked up by the same
cookie on every request from the same browser, already provides this by construction.

- [X] T015 [US2] In `backend/tests/integration/sessionIsolation.test.ts`, add a test case: one
  `request.agent(app)` starts a workflow, advances a stage, then calls `GET
  /api/test-generation-workflow` twice more (simulating a page reload and a second tab) — each
  call returns the identical in-progress workflow at the same stage (FR-002; quickstart.md
  Scenario 2). (Depends on T012.)

**Checkpoint**: User Stories 1 and 2 both independently verified.

---

## Phase 5: User Story 3 - A Lost or New Session Starts Clean, Never on Someone Else's Data (Priority: P3)

**Goal**: A session with no recognized identity always starts with a clean "no workflow" state
(FR-006), and a session whose workflow was idle-evicted sees an explicit expiry notice instead
of an indistinguishable empty state (FR-007, FR-007a).

**Independent Test**: (a) A request with an absent/unrecognized cookie gets `204` even while
another session has an active workflow. (b) Using the registry's test-only expiry hook (T003),
an idle-evicted session's next `GET` returns `{ workflow: null, sessionExpired: true }`, and the
UI shows the expiry notice.

- [X] T016 [P] [US3] Update the `GET /api/test-generation-workflow` handler in
  `backend/src/api/testGenerationWorkflow.ts`: when the session registry reports the caller's
  entry as an expired tombstone, respond `200 { workflow: null, sessionExpired: true }` instead
  of `204`; a session with no entry at all still gets `204`, unchanged (contracts/session-isolation.md
  "Amended: GET"). (Depends on T003, T006.)
- [X] T017 [US3] Update `WorkflowOrNoneResult` and `fetchCurrentWorkflow()` in
  `frontend/src/services/testGenerationWorkflowClient.ts` to read and surface the new optional
  `sessionExpired` field (data-model.md). (Depends on T016.)
- [X] T018 [US3] Update `frontend/src/pages/TestGenerationWorkflowPage.tsx` to render an
  explicit "your previous session expired due to inactivity" notice — reusing this project's
  existing Tailwind/EmptyState presentation conventions (`.claude/CLAUDE.md` §26–43, constitution
  XXXIII) — when `sessionExpired` is `true`, visually distinct from the plain "no workflow
  started yet" empty state used for a genuinely new session (FR-007a). (Depends on T017.)
- [X] T019 [US3] In `backend/tests/integration/sessionIsolation.test.ts`, add a test case: a
  request with no `sessionId` cookie (or one never issued by the server) receives `204` even
  while a different, still-active session has an in-progress workflow (FR-006; quickstart.md
  Scenario 3). (Depends on T012.)
- [X] T020 [US3] In `backend/tests/integration/sessionIsolation.test.ts`, add a test case: start
  a workflow with one agent, use the registry's test-only expiry hook (T003) to tombstone that
  agent's session, then assert that agent's next `GET` returns `{ workflow: null, sessionExpired:
  true }` while a second, still-active agent's own workflow is completely unaffected (FR-007,
  FR-007a; quickstart.md Scenario 5). (Depends on T012, T016, T003.)
- [X] T021 [P] [US3] Add a test to the existing `TestGenerationWorkflowPage` frontend test file:
  when `fetchCurrentWorkflow()` resolves `{ ok: true, workflow: null, sessionExpired: true }`,
  the expiry notice renders; when it resolves `{ ok: true, workflow: null }` (no
  `sessionExpired`), the existing plain empty state renders instead. (Depends on T018.)

**Checkpoint**: All three user stories are independently verified. The feature is
functionally complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide validation and keeping this reversal of spec 009's FR-018 from silently
contradicting that spec for future readers (constitution XXVI, Specification Traceability).

- [X] T022 [P] Add a short forward-reference note to FR-018 in
  `specs/009-e2e-test-generation-workflow/spec.md` and to Decision D7 in
  `specs/009-e2e-test-generation-workflow/research.md`, pointing to
  `specs/017-session-workflow-isolation` as the feature that supersedes the single-global-instance
  decision, so the two specs read consistently together rather than silently disagreeing.
- [X] T023 [P] Update the Implementation Status table in `specs/ROADMAP.md` to add this feature
  (`017-session-workflow-isolation`) alongside the AP-011–AP-016 hardening entries, per this
  repo's existing convention for unnumbered hardening features.
- [X] T024 Run `npm test`, `npm run lint`, and `npm run build` from the repo root and confirm
  all three pass (`.claude/CLAUDE.md` §54; constitution XXXI, Definition of Done).
- [X] T025 Walk through `quickstart.md`'s manual validation scenarios (at minimum Scenarios 1,
  2, 3, and 6; Scenario 5 via the test-only expiry hook rather than a real 60-minute wait) to
  confirm end-to-end behavior in the running app, not just the automated suite. Done by running
  the actual backend (`tsx src/server.ts`) and driving it with `curl` using two separate cookie
  jars: confirmed two sessions each retain their own distinct workflow id/specification
  (Scenario 1), a cookie-less request gets a clean 204 while another session has an active
  workflow (Scenario 3), and a never-issued guessed cookie also gets 204, never another
  session's data (Scenario 4). Frontend UI click-through was not performed in this environment;
  Scenarios 2 (reload/second-tab) and 5 (expiry notice) remain verified only via the automated
  suite (T015, T020, T021) — a manual browser pass is recommended before considering this done
  per `.claude/CLAUDE.md`'s UI-testing guidance.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks every user story** — this is where the
  actual session mechanism and the required test-file migrations live.
- **User Stories (Phases 3–5)**: All depend on Foundational. Phases 3 and 4 have no
  implementation of their own (pure verification); Phase 5 has real implementation (T016–T018)
  plus verification.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Foundational.
- **User Story 2 (P2)**: Depends only on Foundational. Its test (T015) is appended to the same
  file User Story 1 creates (T012), so T015 depends on T012 specifically (file-ordering, not a
  functional dependency between the stories themselves).
- **User Story 3 (P3)**: Depends only on Foundational for its test cases (T019, T020, chained
  after T012 for the same file-ordering reason); T016–T018 (the new expiry-notice behavior) have
  no dependency on User Stories 1 or 2.

### Within Each User Story

- Phase 5's implementation chain is strictly ordered: backend response shape (T016) → frontend
  client type (T017) → frontend UI (T018), each depending on the previous.
- Test cases appended to `sessionIsolation.test.ts` (T013, T014, T015, T019, T020) each depend on
  T012 (which creates the file) but not on each other — order among them does not matter, only
  that T012 lands first.

### Parallel Opportunities

- T002 and T003 (Foundational) touch different new files and share no dependency — parallel.
- T007, T008, T009 (the three existing test-file migrations) touch three different files and
  share only already-complete dependencies (T005, T006) — parallel.
- T010 and T011 (Foundational unit tests) touch different new files — parallel.
- T016 (backend) can proceed in parallel with T012–T015 (a different file, and its own
  dependencies — T003, T006 — are already satisfied by the end of Foundational).
- T021 (frontend test, a different file from T016–T018) can proceed in parallel with the backend
  test cases in Phase 5 once T018 lands.
- T022 and T023 (Polish, different files) — parallel.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch the two independent new modules together:
Task: "Implement backend/src/session/sessionContext.ts (AsyncLocalStorage + getSessionId())"
Task: "Implement backend/src/session/sessionRegistry.ts (Map, touch(), idle-eviction sweep, test-only expiry hook)"

# Once T005/T006 land, migrate the three affected existing test files together:
Task: "Migrate backend/tests/integration/testGenerationWorkflow.test.ts to request.agent(app)"
Task: "Migrate backend/tests/integration/testGenerationWorkflowAsyncFailure.test.ts to request.agent(app)"
Task: "Migrate backend/tests/integration/testGenerationWorkflowDiagnostics.test.ts to request.agent(app)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational) — this is the bulk of the real
   engineering work and is not optional or skippable for any story.
2. Complete Phase 3 (User Story 1) and validate: concurrent sessions genuinely do not collide.
3. This alone resolves the motivating problem (a team demo colliding on one shared workflow)
   and is a reasonable place to pause/demo if needed.

### Incremental Delivery

1. Setup + Foundational → the mechanism exists and the full existing suite is green again.
2. Add User Story 1 → validate → this is the MVP the feature was requested for.
3. Add User Story 2 → validate → confirms no regression to the single-user experience.
4. Add User Story 3 → validate → closes the remaining safety/UX gaps (clean new sessions,
   explicit expiry notice).
5. Polish → repo-wide validation, spec cross-referencing, `ROADMAP.md` update.

### Notes

- [P] tasks touch different files and have no incomplete-task dependency between them.
- Commit after each task or logical group, consistent with `.claude/CLAUDE.md` git discipline.
- Phase 2's checkpoint (`npm test -w backend` fully green) is a hard gate — do not start any
  user story phase before it is met.
- Avoid scope creep: no task here touches AI provider internals, the review/decision domain
  logic, or any Postman generation code — those are explicitly unaffected by this feature (spec.md
  FR-005, Assumptions).
