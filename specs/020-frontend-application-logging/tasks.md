---

description: "Task list for Frontend Application Logging"
---

# Tasks: Frontend Application Logging

**Input**: Design documents from `/specs/020-frontend-application-logging/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/client-logs-api.md](./contracts/client-logs-api.md),
[quickstart.md](./quickstart.md)

**Tests**: Included. The spec ties SC-001, SC-003, SC-005, SC-006, and SC-007 directly to
dedicated tests, so test tasks are in scope, not optional here.

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation
and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every task names its exact file path

---

## Phase 1: Setup

No setup tasks are required. `frontend/` and `backend/` are existing npm workspaces with their
build tooling, TypeScript config, and Vitest runners already in place; this feature is purely
additive to both (plan.md's Project Structure), so there is no project initialization to perform.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one shared logger module every user story depends on. No user story can be
implemented or tested until this exists.

**⚠️ CRITICAL**: Complete this phase before starting any user story phase below.

- [X] T001 Create `frontend/src/logger.ts`: `LogLevel` (`"info"|"warn"|"error"`) and `LogFields`
  (`Record<string, string|number|boolean|undefined>`) types; `createLogger(component: string,
  options?: { now?: () => Date }): { info, warn, error }` where each method builds a Frontend Log
  Entry (`level`, `component`, `event`, `timestamp` from `options.now?.() ?? new Date()`, and
  `fields` with every non-primitive value dropped, *and* every field whose name matches the
  credential-shaped denylist — `token`/`apikey`/`api_key`/`password`/`secret`/`authorization`/
  `credential`/`cookie`, case-insensitive substring match — dropped regardless of its value, before
  use) and emits it as one JSON-shaped object via `console.log`/`console.warn`/`console.error`
  matching the level — mirroring `backend/src/logger.ts`'s one-JSON-object-per-call convention
  (data-model.md "Frontend Log Entry"/"LogFields"; FR-001, FR-002, FR-003, FR-004/SC-008,
  FR-011's clock half).
- [X] T002 Create `frontend/tests/unit/logger.test.ts` (depends on T001): assert (a) each level
  emits through the matching `console.*` method with a structured object containing `level`,
  `component`, `event`, `timestamp`, and supplied primitive fields; (b) supplying `options.now`
  produces an exact, deterministic `timestamp` (FR-011); (c) a field whose value is an object,
  array, or function is absent from the emitted entry rather than serialized (FR-003, mirroring
  `backend/tests/unit/logger.test.ts`'s console-spy style); (d) a field named e.g. `token` or
  `apiKey` (or a mixed-case/prefixed variant, e.g. `Authorization`, `userPassword`) is absent from
  the emitted entry even when its value is an ordinary string (FR-004, SC-008).

**Checkpoint**: The shared logger exists and is proven safe/deterministic — every user story below
can now build on it.

---

## Phase 3: User Story 1 - See What Went Wrong Without Reproducing It Live (Priority: P1) 🎯 MVP

**Goal**: Every existing frontend service-client module's caught errors, and every truly uncaught
exception/unhandled rejection, produce a structured console log entry through the Phase 2 logger.

**Independent Test**: Stop the backend, trigger a call in any of the seven service-client modules,
and confirm a structured console entry appears; separately, dispatch a synthetic uncaught
exception and a synthetic unhandled rejection and confirm each produces one structured console
entry — all without needing the backend-forwarding capability from User Story 2.

### Tests for User Story 1 ⚠️ write these first; confirm they fail before the matching implementation task

- [X] T003 [P] [US1] Add a test in `frontend/tests/unit/executionClient.test.ts` (new file)
  asserting every `catch` block in `frontend/src/services/executionClient.ts` calls the logger at
  `error` (or `warn`, where the caught outcome is an expected/handled one) level with an
  `operation`/`errorCategory`-shaped field set, before returning its existing typed result (FR-010).
- [X] T004 [P] [US1] Add a test in `frontend/tests/unit/healthClient.test.ts` (new file) — same
  assertion as T003, for `frontend/src/services/healthClient.ts`'s one `catch` block (FR-010).
- [X] T005 [P] [US1] Extend `frontend/tests/unit/postmanCollectionsClient.test.ts` (existing file)
  with the same logging assertion for `frontend/src/services/postmanCollectionsClient.ts`'s
  `catch` block (FR-010).
- [X] T006 [P] [US1] Extend `frontend/tests/unit/reviewsClient.test.ts` (existing file) with the
  same logging assertion for `frontend/src/services/reviewsClient.ts`'s `catch` block (FR-010).
- [X] T007 [P] [US1] Add a test in `frontend/tests/unit/specificationsClient.test.ts` (new file) —
  same assertion, for `frontend/src/services/specificationsClient.ts`'s `catch` block (FR-010).
- [X] T008 [P] [US1] Add a test in `frontend/tests/unit/testGenerationWorkflowClient.test.ts` (new
  file) — same assertion, for every `catch` block in
  `frontend/src/services/testGenerationWorkflowClient.ts` (FR-010).
- [X] T009 [P] [US1] Add a test in `frontend/tests/unit/testModelsClient.test.ts` (new file) —
  same assertion, for `frontend/src/services/testModelsClient.ts`'s `catch` block (FR-010).
- [X] T010 [P] [US1] Create `frontend/tests/unit/globalErrorHandlers.test.ts`: dispatch a synthetic
  `ErrorEvent` on `window` (simulating an uncaught exception) and a synthetic rejection-carrying
  event (simulating `unhandledrejection`) after calling `installGlobalErrorHandlers()`, and assert
  each produces exactly one `error`-level console entry via the Phase 2 logger, without an actual
  unhandled error/rejection reaching the test runner (FR-010a, SC-007).

### Implementation for User Story 1

- [X] T011 [P] [US1] In `frontend/src/services/executionClient.ts`, route every existing `catch`
  block through `createLogger("executionClient")` before it converts the error to its existing
  thrown/typed-result shape; no caught error is left un-logged (FR-010; makes T003 pass).
- [X] T012 [P] [US1] Same retrofit for `frontend/src/services/healthClient.ts` using
  `createLogger("healthClient")` (FR-010; makes T004 pass).
- [X] T013 [P] [US1] Same retrofit for `frontend/src/services/postmanCollectionsClient.ts` using
  `createLogger("postmanCollectionsClient")` (FR-010; makes T005 pass).
- [X] T014 [P] [US1] Same retrofit for `frontend/src/services/reviewsClient.ts` using
  `createLogger("reviewsClient")` (FR-010; makes T006 pass).
- [X] T015 [P] [US1] Same retrofit for `frontend/src/services/specificationsClient.ts` using
  `createLogger("specificationsClient")` (FR-010; makes T007 pass).
- [X] T016 [P] [US1] Same retrofit for `frontend/src/services/testGenerationWorkflowClient.ts`
  using `createLogger("testGenerationWorkflowClient")` (FR-010; makes T008 pass).
- [X] T017 [P] [US1] Same retrofit for `frontend/src/services/testModelsClient.ts` using
  `createLogger("testModelsClient")` (FR-010; makes T009 pass).
- [X] T018 [P] [US1] Create `frontend/src/globalErrorHandlers.ts` exporting
  `installGlobalErrorHandlers()`, which adds one `window.addEventListener("error", …)` and one
  `window.addEventListener("unhandledrejection", …)` listener, each extracting a primitive-safe
  summary (e.g. `message`, `errorCategory`, `source`/`filename`+`lineno` where available) and
  calling `createLogger("globalErrorHandlers").error(...)` (FR-010a; makes T010 pass).
- [X] T019 [US1] Call `installGlobalErrorHandlers()` once from `frontend/src/main.tsx`, before
  `ReactDOM.createRoot(...).render(...)` (depends on T018).

**Checkpoint**: User Story 1 is fully functional and independently testable — every caught
service-client error and every uncaught exception/rejection now produces a structured console
entry, with no dependency on User Story 2's backend endpoint.

---

## Phase 4: User Story 2 - Find a Frontend Error After the Browser Tab Is Gone (Priority: P2)

**Goal**: `warn`/`error`-level entries are additionally forwarded, best-effort, to a new backend
endpoint that persists them through the existing backend logger.

**Independent Test**: Trigger a service-client failure (or, after Phase 3, a global-handler
failure) with the backend running, then confirm the entry is discoverable via the backend's
console/log output (spied in tests, per `backend/tests/unit/logger.test.ts`'s existing pattern)
after the originating browser tab is gone; separately, confirm a forwarding failure with the
backend stopped never throws or blocks the UI.

### Tests for User Story 2 ⚠️ write these first; confirm they fail before the matching implementation task

- [X] T020 [P] [US2] Extend `frontend/tests/unit/logger.test.ts` (depends on T001/T002): stub
  global `fetch` (`vi.stubGlobal("fetch", …)`, matching
  `frontend/tests/unit/reviewsClient.test.ts`'s existing convention) and assert `logger.warn(...)`/
  `logger.error(...)` POST the entry to `/api/client-logs` while `logger.info(...)` never calls
  `fetch` at all (FR-005). Also assert that when the stubbed `fetch` rejects or resolves non-2xx,
  no exception escapes the logger call and at most one `console.*` notice is produced (FR-008).
- [X] T021 [P] [US2] Create `backend/tests/integration/clientLogs.test.ts` (Supertest against
  `createApp()`, matching `backend/tests/integration/health.test.ts`'s structure): a well-formed
  `POST /api/client-logs` body returns `202` and (spying on `console.warn`/`console.error` per
  `backend/tests/unit/logger.test.ts`'s pattern) produces one JSON line with
  `component: "frontend-client"`, plus `frontendComponent` and `clientTimestamp` fields carrying
  the request's original `component`/`timestamp` (FR-006; data-model.md "Persistence"). Also cover:
  a request with a missing/invalid `level`, `component`, `event`, or `timestamp` returns `400
  invalid_client_log_entry` (FR-007); a request whose `fields` includes a non-primitive value
  still returns `202` with that one field absent from the persisted line, not the whole entry
  dropped (FR-007); a request whose `fields` includes a denylisted field name (e.g. `token`) with
  an ordinary string value still returns `202` with that field absent from the persisted line
  (FR-004, SC-008 — backend half; see also T025).

### Implementation for User Story 2

- [X] T022 [US2] Extend `frontend/src/logger.ts` (Phase 2 module) so `warn`/`error` calls also POST
  the Frontend Log Entry (data-model.md wire shape) to `/api/client-logs` via `fetch`, awaited
  fire-and-forget (never blocking or throwing back to the caller); a rejected/non-2xx response
  produces at most one local `console.*` notice and is not retried (FR-005, FR-008, FR-012; makes
  the `logger.test.ts` half of T020 pass).
- [X] T023 [US2] Create `backend/src/api/clientLogs.ts`: a thin router (matching
  `backend/src/api/testModels.ts`'s validate-then-delegate shape) validating `level` (one of
  `info`/`warn`/`error`), `component` (non-empty string), `event` (non-empty string), and
  `timestamp` (string) — returning `400 invalid_client_log_entry` on failure — then persisting via
  `createLogger("frontend-client").{level}(event, { ...validFields, frontendComponent: component,
  clientTimestamp: timestamp })`, dropping (not entry-rejecting) any individual `fields` entry
  whose value is not a `string`/`number`/`boolean` *or* whose name matches the FR-004
  credential-shaped denylist (same list as T001, applied independently here as defense in depth —
  research.md Decision 7), and responding `202` with no body (FR-004, FR-006, FR-007, SC-008;
  data-model.md; makes the backend half of T021 pass).
- [X] T024 [US2] In `backend/src/app.ts`, mount `app.use("/api/client-logs", express.json({ limit:
  "8kb" }))` immediately before the existing global `app.use(express.json({ limit:
  MAX_UPLOAD_BYTES }))`, then register `app.use("/api", clientLogsRouter)` alongside the other
  routers (research.md Decision 3: the existing `entity.too.large` → `413 payload_too_large`
  mapping in the centralized error handler already covers this route without new error-handling
  code; FR-013; makes the size-limit half of T021 pass — add a `413` case to T021 exercising a body
  over 8 KB).

**Checkpoint**: User Stories 1 AND 2 both work independently — console logging needs no backend,
and backend forwarding works for any `warn`/`error` entry regardless of which caller produced it.

---

## Phase 5: User Story 3 - Never Leak Sensitive Data Through Frontend Logs (Priority: P1)

**Goal**: Prove, end-to-end, that neither the frontend logger nor the backend ingestion endpoint
can carry a non-primitive (and therefore potentially secret-shaped) field value.

**Independent Test**: Attempt to log a field containing a large/nested value and confirm only
primitive fields survive, on both the frontend console output and the backend-persisted entry.

**Note on dependencies**: Unlike US1/US2, this story is *not* independent of them — its first
acceptance scenario is already proven by Foundational task T002 (frontend-side rejection of both
non-primitive values and denylisted field names), and its second acceptance scenario requires User
Story 2's ingestion endpoint to exist (backend-side rejection). This phase adds the one assertion
not yet covered by any earlier task, rather than duplicating T002/T021.

- [X] T025 [US3] Extend `backend/tests/integration/clientLogs.test.ts` (depends on T021/T023):
  send a `fields` value containing a nested object (e.g. simulating an accidentally-attached full
  specification or prompt string) and assert the backend endpoint never executes, parses, or
  otherwise treats it as anything but a value to drop before persisting — the response is still
  `202`, and the spied console line contains none of the nested object's own keys (User Story 3
  Acceptance Scenario 2; FR-004, FR-007). Cross-reference: Acceptance Scenario 1 (frontend-side,
  covering both non-primitive values and denylisted field names) is already covered by T002; the
  backend-side denylist assertion (SC-008) is already covered by T021, not repeated here.
  Satisfied directly by T021's "drops a non-primitive field but still persists the rest of the
  entry" test case (written together with T021 rather than as a separate later pass) — verified:
  the nested object's own key (`a`) never appears in the persisted entry.

**Checkpoint**: All three user stories are independently functional; the no-fabrication/no-leak
guarantee holds across both the frontend and backend halves of the feature.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T026 [P] Run `npm test` (both workspaces), `npm run lint`, and `npm run build` from the
  repository root; all must pass with the changes from every phase above.
- [X] T027 [P] Diff `frontend/package.json`, `backend/package.json`, and `package-lock.json`
  against the pre-feature state and confirm zero new dependencies were added (FR-009, SC-004).
  Confirmed via `git diff --cached` — only a version-string bump (7.2.1 → 8.0.0, unrelated to this
  feature) touches these files; no dependency entries changed.
- [X] T028 Walk through `quickstart.md`'s four manual validation scenarios end-to-end against a
  locally running `npm run dev` instance. Backend half verified against a real running server
  (not just Supertest): `POST /api/client-logs` with a `token` field returns 202 and persists a
  `frontend-client`-tagged line in `logs/backend.log` with the credential field dropped; a
  malformed entry returns 400; an oversized (~9KB) entry returns 413; a non-POST request returns
  405. This run surfaced and fixed a real bug (see Notes) — the centralized error handler's 413
  message was hardcoded to the global 10MB limit regardless of which route's smaller limit
  actually triggered it. The frontend/browser-console half of quickstart.md (steps 1-2's console
  inspection) was not visually verified in a real browser in this environment; the equivalent
  behavior is covered by the automated frontend test suite (T002/T010/T020 spy-based assertions).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: None — no tasks.
- **Foundational (Phase 2)**: No dependencies; BLOCKS every user story (T001 → T002).
- **User Story 1 (Phase 3)**: Depends on Phase 2 only. Fully independent of US2/US3.
- **User Story 2 (Phase 4)**: Depends on Phase 2 only (extends the same `logger.ts`
  from T001/T022, not on US1's retrofit tasks). Independently testable without US1.
- **User Story 3 (Phase 5)**: Depends on Phase 2 (T002) **and** User Story 2 (T021/T023) — see the
  "Note on dependencies" above; this is the one story that is not fully independent of another.
- **Polish (Phase 6)**: Depends on every phase above being complete.

### Parallel Opportunities

- T001 has no parallel partner (it is the sole Foundational implementation task); T002 depends on
  it.
- Within User Story 1: T003–T010 (all test tasks) are mutually [P]; T011–T018 (all implementation
  tasks, seven retrofits plus the global-handler module) are mutually [P] once T001 is done; T019
  depends on T018 only.
- Within User Story 2: T020 and T021 are mutually [P]; T022 depends on T001 (not on any US1 task);
  T023 and T024 depend on each other only in the sense that T024 registers what T023 exports.
- User Story 1 and User Story 2 can be implemented concurrently by different people once Phase 2
  is done — they touch disjoint files (US1: the seven service clients + `globalErrorHandlers.ts` +
  `main.tsx`; US2: `logger.ts`'s forwarding half + the new backend route + `app.ts`).
- User Story 3 (Phase 5) must wait for both Phase 2 and Phase 4 (US2).

---

## Parallel Example: User Story 1

```bash
# All seven test tasks together:
Task: "Add logging test in frontend/tests/unit/executionClient.test.ts"
Task: "Add logging test in frontend/tests/unit/healthClient.test.ts"
Task: "Extend frontend/tests/unit/postmanCollectionsClient.test.ts with a logging assertion"
Task: "Extend frontend/tests/unit/reviewsClient.test.ts with a logging assertion"
Task: "Add logging test in frontend/tests/unit/specificationsClient.test.ts"
Task: "Add logging test in frontend/tests/unit/testGenerationWorkflowClient.test.ts"
Task: "Add logging test in frontend/tests/unit/testModelsClient.test.ts"

# All seven retrofits together, once the tests above exist and fail:
Task: "Retrofit frontend/src/services/executionClient.ts to log caught errors"
Task: "Retrofit frontend/src/services/healthClient.ts to log caught errors"
Task: "Retrofit frontend/src/services/postmanCollectionsClient.ts to log caught errors"
Task: "Retrofit frontend/src/services/reviewsClient.ts to log caught errors"
Task: "Retrofit frontend/src/services/specificationsClient.ts to log caught errors"
Task: "Retrofit frontend/src/services/testGenerationWorkflowClient.ts to log caught errors"
Task: "Retrofit frontend/src/services/testModelsClient.ts to log caught errors"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001–T002).
2. Complete Phase 3: User Story 1 (T003–T019).
3. **STOP and VALIDATE**: every service-client failure and every uncaught error/rejection now
   produces a structured console entry — demonstrable and shippable without touching the backend.

### Incremental Delivery

1. Foundational → User Story 1 (console logging, MVP) → validate.
2. Add User Story 2 (backend forwarding) → validate independently (does not require US1's specific
   retrofits — any `warn`/`error` call already forwards).
3. Add User Story 3 (leak-proofing verification) → validate — this one depends on US2 being done.
4. Phase 6 Polish.

## Notes

- [P] tasks touch different files with no unfinished dependency between them.
- Each service-client retrofit (T011–T017) is a small, mechanical, independent change — safe to
  parallelize across files or across people.
- Tests are written to fail first per task pairing (e.g., T003 before T011); commit after each
  task or logical group.
- Avoid combining two service-client retrofits into one commit/PR unless intentionally batching —
  keeping them separate preserves the "no unrelated files changed" discipline this project expects.
- T028's manual verification against a real running server found that `backend/src/app.ts`'s
  centralized `entity.too.large` error handler hardcoded its message to `MAX_UPLOAD_BYTES`
  regardless of which route's body-parser limit actually triggered the rejection — harmless before
  this feature (only one JSON size limit existed), but wrong once a second, smaller limit
  (T024) existed. Fixed by reading the triggering error's own `.limit` property instead. Covered by
  a new regression assertion in `backend/tests/integration/clientLogs.test.ts` (T021).
