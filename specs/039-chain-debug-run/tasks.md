# Tasks: Chain Debug Run

**Input**: Design documents from `/specs/039-chain-debug-run/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/debug-run-api.md, quickstart.md

**Tests**: Included. The project requires tests with every feature (CLAUDE.md §51), and the parity, masking and leak-scan tests are how the spec's safety requirements are proven.

**Organization**: Grouped by user story. Foundational work (types, executor core, masker) is shared, because no story may return unmasked content (FR-013, FR-014) and every story needs the same executor.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 see each step's request and response; US2 explain extractor, check and skip outcomes; US3 nothing stored, masking and reveal; US4 trigger, confirmation and safeguards
- Paths: `backend/src/performance/chain/debug/` is written `debug/` below; tests mirror it under `backend/tests/`

## Phase 1: Setup (verification before design is relied on)

**Purpose**: settle the two implementation-time checks recorded in plan.md

- [ ] T001 Read `backend/src/execution/executionSlot.ts` and `backend/src/api/chainPlans.ts:320-372`, and record in `specs/039-chain-debug-run/research.md` (R6) whether a Debug run takes the session execution slot or only refuses while one is held, with the reason
- [ ] T002 Compare `valueAtPath` and `parseCapturePath` in `packages/shared-domain/src/capturePath.ts` with the runtime's `field()` (own keys only, numeric segments need an array) in `backend/src/performance/k6/renderChainScript.ts`, and record the result in research.md (R2); decide reuse or a dedicated walker in `debug/extraction.ts`

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: contracts, executor core and masker. No user story starts before this is done.

**CRITICAL**: the masker lands here so that no later task can return unmasked content.

- [ ] T003 [P] Add the types in `packages/shared-domain/src/chainDebugRun.ts` exactly as in data-model.md (`MaskedText`, `DebugRunResult`, `DebugChainOutcome`, `DebugStepOutcome`, `DebugSkipCause`, `DebugHeader`, `DebugBody`, `DebugExtractorOutcome`, `DebugExtractorFailure`, `DebugCheckOutcome`) and export them from `packages/shared-domain/src/index.ts`
- [ ] T004 [P] Add `DebugRunInProgressError` and `DebugValueNotFoundError` to `backend/src/performance/errors.ts`
- [ ] T005 [P] Port dynamic variables to `debug/dynamicValues.ts` (twin of `dynamicValue`, `mix`, `hex` and the word lists in `CHAIN_RUNTIME`), with fixed VU 1, iteration 0 and an injected clock and run tag
- [ ] T006 [P] Implement `debug/resolveRequest.ts`: reference filling in `url`, `json` and `raw` modes, value lookup order (extracted, dynamic, data-set row 0, environment), query, header and body building (raw content type only when no content-type header, form body encoding), returning the request and the list of unresolved names
- [ ] T007 [P] Implement `debug/extraction.ts`: body and header extractors returning `DebugExtractorOutcome` with the failure codes `not-extracted-status`, `body-not-json`, `path-not-found`, `value-not-scalar`, `header-missing`; the scalar rule and case-insensitive header lookup match the runtime; plus `statusOk` with `2XX` patterns
- [ ] T008 [P] Implement `debug/checks.ts`: `field-exists`, `field-equals`, `body-contains`, `time-at-most` with a `detail` string that names the comparison and never a body value
- [ ] T009 Implement `debug/masker.ts`: collect sensitive literals (secret environment and data values as non-revealable; sensitive header values, values at sensitive JSON field names and credential-like extracted values as revealable), split the original text on each literal longest-first into `MaskedText` without reformatting it (JSON is parsed only to find values at sensitive field names, never re-serialised), truncate after masking, describe binary bodies, give every masked segment a descriptive `label` and a `valueId`, and ensure the sensitive-header set includes Authorization, Proxy-Authorization, Cookie, Set-Cookie and API-key style names (depends on T003)
- [ ] T010 [P] Unit tests for T005 in `backend/tests/unit/performance/chain/debug/dynamicValues.test.ts`: table of values against the sandbox for fixed VU, iteration, run tag and frozen clock
- [ ] T011 [P] Unit tests for T006, T007 and T008 in `backend/tests/unit/performance/chain/debug/resolveRequest.test.ts`, `extraction.test.ts`, `checks.test.ts`, including every failure code and the non-JSON, object, array, null and empty-text cases
- [ ] T012 [P] Masker corpus tests in `backend/tests/unit/performance/chain/debug/masker.test.ts` covering Authorization, Cookie, Set-Cookie and API-key headers, secret environment values and secret data columns in URL, header and body positions, credential-like extracted values, that a body with the held values substituted back is byte-identical to the original, truncation after masking, a secret value shorter than 3 characters (header and query masked, free text documented limit), and that no `text` segment ever contains a non-revealable secret (SC-003)
- [ ] T013 Parity tests in `backend/tests/unit/performance/chain/debugParity.test.ts`: run the same plan and stub responder through `backend/tests/fixtures/chain/chainSandbox.ts` and through the executor core, and assert equal built requests, extractor outcomes, check outcomes and sent or skipped steps; add the hash guard on `CHAIN_RUNTIME` that fails with a message pointing to this suite (depends on T005–T008; the full-flow cases are added in T023)

**Checkpoint**: executor pieces and masker proven against the runtime.

---

## Phase 3: User Story 1 - See what each step sent and received (Priority: P1) MVP

**Goal**: start a Debug run and read each sent step's request and response.

**Independent Test**: with a plan whose first step returns JSON, call the endpoint and see each sent step's method, resolved URL, headers, body, status, response headers, response body and duration, masked.

- [ ] T014 [P] [US1] Implement `debug/sender.ts`: the `Sender` interface and a `fetch` implementation with 30 s per-request timeout, `AbortController`, manual redirects up to 10 hops, 2 MiB read cap, and `no-response` reasons `refused`, `timeout`, `dns`, `aborted`, `error`; the host check hook is a parameter (wired in T035)
- [ ] T015 [P] [US1] Sender unit tests in `backend/tests/unit/performance/chain/debug/sender.test.ts` using a local `http` server: success, refused, timeout, redirect chain, body cap, abort
- [ ] T016 [US1] Implement `debug/runDebugRun.ts`: iterate `chainRunOrder` (setup first, then each chain once in plan order), resolve and send each step with no think time or pause, run extractors and checks, build `DebugStepOutcome` for sent steps and `DebugRunResult`, apply masker to every output field, cap the whole run at 120 s (steps not yet sent become `not-sent` with `not-reached: run-time-cap` and a note that the run was cut off, FR-025), stop on abort, and include the stop rules of T022 so a failed extractor never lets later steps run on missing values (depends on T006–T009, T014)
- [ ] T017 [US1] Add `POST /api/chain-plans/:planId/debug-runs` to `backend/src/api/chainPlans.ts` as a thin route: validate ids, load plan and environment, refuse on analysis blockers (422 `plan_has_blockers`) and on `execution_in_progress` (409), call `runDebugRun`, set `Cache-Control: no-store`; map errors in `backend/src/api/chainPlanHttp.ts`; inject the `Sender` through the existing dependency object
- [ ] T018 [US1] Integration test in `backend/tests/integration/performance/chainDebugRun.test.ts` using `chainAgent` and a fake `Sender`: happy path for a multi-step plan, no-response step shows attempted request and reason, response bodies masked, no run record or report created (FR-010), a plan edited after its script was generated is debugged as saved (no script required), and the run-time cap and per-request timeout outcomes (FR-025)
- [ ] T019 [P] [US1] Add `debugRun(planId, environmentId, signal)` to `frontend/src/services/requestChainClient.ts` returning `ChainResult<DebugRunResult>`, with abort support, and extend the error detail keys used by the client
- [ ] T020 [P] [US1] Implement `frontend/src/components/requestChain/DebugRunOutput.tsx`: one section per chain, one card per sent step with method, URL, headers and body for request and response in code blocks that scroll within their own area, status and duration, loading, empty and error states, the data-set row used per data set, the result notes (for example that think time was not waited out and that a run was cut off), bodies shown as sent and received with a truncation note and full size, Tailwind tokens, dark mode and keyboard access
- [ ] T021 [US1] Frontend tests in `frontend/tests/unit/DebugRunOutput.test.tsx` and `requestChainClient.test.ts`: renders a sent step, a no-response step, masked segments as masked text, long bodies scroll inside their container

**Checkpoint**: a Debug run returns and displays masked exchanges.

---

## Phase 4: User Story 2 - Understand extractor, check and skip outcomes (Priority: P1)

**Goal**: see why an extractor or check failed and why later steps were not sent.

**Independent Test**: run a plan whose extractor path is wrong; the failure names the reason and path, later steps show not sent with the stopping step named.

- [ ] T022 [US2] Complete the stop rules and skip causes in `debug/runDebugRun.ts` (the basic rules are part of T016): a failed extractor stops its chain; an unexpected status stops only once-per-virtual-user and setup steps; a missing environment or data value skips that step only (`missing-value`); a missing extracted name skips that step only (`missing-extracted`); a failed setup step ends the run (`setup-failed`); remaining steps become `not-sent` with `stopped-by` naming the step and reason (FR-007, FR-008)
- [ ] T023 [US2] Extend `backend/tests/unit/performance/chain/debugParity.test.ts` with the full-flow cases: failed extractor mid-chain, unexpected status on every-iteration and once-per-VU steps, missing environment value, missing extracted name, failed setup, a successful chain; assert the executor and the sandbox agree on which steps ran
- [ ] T024 [US2] Add integration cases to `backend/tests/integration/performance/chainDebugRun.test.ts`: each extractor failure code, check pass and fail with detail, every skip cause, multiple chains where one stops early and the next still runs
- [ ] T025 [P] [US2] In `frontend/src/components/requestChain/DebugRunOutput.tsx` show extractor outcomes (extracted with source, or failed with the reason in words), check outcomes with detail, expected versus received status, and not-sent cards naming the stopping step and cause; outcomes use text and an icon, never colour alone
- [ ] T026 [US2] Frontend tests in `frontend/tests/unit/DebugRunOutput.test.tsx` for every failure code wording, every skip cause, and the accessible names of outcome badges

**Checkpoint**: the original token problem is diagnosable from the output.

---

## Phase 5: User Story 3 - Debug output never becomes a stored artifact (Priority: P1)

**Goal**: nothing is persisted or logged; masked values can be revealed one at a time; secrets never reach the browser.

**Independent Test**: after a Debug run with sentinel values, no table, log or run directory contains them; a revealed value is masked again after discard; a secret has no reveal.

- [ ] T027 [US3] Implement `debug/heldValues.ts`: session-scoped in-memory map keyed by debug run id and value id, 30-minute expiry, replacement by a new Debug run for the same plan, `discard`, and a size guard; revealable values only
- [ ] T028 [US3] Hook `heldValues` into `runDebugRun.ts` and add `GET .../debug-runs/:debugRunId/values/:valueId` and `DELETE .../debug-runs/:debugRunId` in `backend/src/api/chainPlans.ts`; unknown, non-revealable, expired and discarded values all return the same 404 `debug_value_not_found`; all responses `no-store`
- [ ] T029 [US3] Add scalar-only log events `chain_debug_run_started`, `chain_debug_run_finished`, `chain_debug_run_cancelled` and `chain_debug_value_revealed` through `backend/src/logger.ts`, with plan id, counts, duration and error category only
- [ ] T030 [US3] Leak-scan integration test in `backend/tests/integration/performance/chainDebugRun.test.ts` modelled on `chainLeakScan.test.ts`: sentinel secrets, tokens, header values and body text; scan captured console output, every database table and the run directory; also assert the runs list and reports are unchanged and that a Debug run for the same plan after reload shows nothing stored (SC-002, FR-009 to FR-012)
- [ ] T031 [P] [US3] Unit tests for `heldValues` in `backend/tests/unit/performance/chain/debug/heldValues.test.ts` (expiry with injected clock, replacement, discard, session isolation) and integration tests for reveal, discard and the 404 cases
- [ ] T032 [P] [US3] Add `revealDebugValue` and `discardDebugRun` to `frontend/src/services/requestChainClient.ts`
- [ ] T033 [US3] In `DebugRunOutput.tsx` add a per-value Reveal control on revealable masked pieces (button with an accessible name that includes the label, not the value), keep the revealed value only in component state, mask again on reload or close, show no control for non-revealable pieces, and call discard when the view closes or a new run replaces it
- [ ] T034 [US3] Frontend tests for reveal, re-mask on close, no control for non-revealable pieces, and that revealed values are not written to storage or the URL

**Checkpoint**: output is transient, masked, and revealable only where allowed.

---

## Phase 6: User Story 4 - A Debug run is a real run against a real target (Priority: P2)

**Goal**: the engineer sees what the run will do and confirms; host and concurrency safeguards hold.

**Independent Test**: with a write plan the trigger names environment, tier, base URL, hosts and write steps, sends nothing before confirmation, warns about missing values, and refuses a concurrent run.

- [ ] T035 [US4] Enforce the host allow-list in `debug/runDebugRun.ts` and `debug/sender.ts`: every resolved URL and every redirect hop is checked against the plan's `hosts` plus the environment base URL origin; a violation is not requested and becomes a `host-not-allowed` skip or a reported redirect
- [ ] T036 [US4] Add the per-plan in-progress lock and, per T001's outcome, the execution-slot behaviour; a second Debug run for the same plan returns 409 `debug_run_in_progress`; abort of the request cancels in-flight sends and releases the lock and held values
- [ ] T037 [US4] Integration tests in `backend/tests/integration/performance/chainDebugRun.test.ts`: host outside the allow-list (direct and via redirect), a value substituted into a path that changes the host, concurrent Debug runs, a Debug run while a load run is active, abort mid-run releasing the lock
- [ ] T038 [P] [US4] Extract the environment, tier, base URL, hosts, data sets and write-summary blocks from `frontend/src/components/requestChain/ChainRunPanel.tsx` into `frontend/src/components/requestChain/RunTargetSummary.tsx`, and use it from `ChainRunPanel` without changing its behaviour or its existing tests
- [ ] T039 [US4] Implement `frontend/src/components/requestChain/ChainDebugPanel.tsx`: environment picker, `RunTargetSummary`, missing-value warning from the plan analysis, a statement that real requests, including writes, will be sent and nothing is stored, explicit Start and Cancel (Cancel aborts the request), `role="status"` progress text, then `DebugRunOutput`
- [ ] T040 [US4] Add the Debug run entry point in `frontend/src/components/requestChain/ChainPlanEditor.tsx` next to the run trigger, disabled with a stated reason when the plan has blockers; it never starts automatically and starting a load run never starts it
- [ ] T041 [US4] Frontend tests in `frontend/tests/unit/ChainDebugPanel.test.tsx` and the existing `ChainRunPanel.test.tsx`: trigger content, nothing sent before Start, cancel aborts, blocker reason, missing-value warning, run panel unchanged

**Checkpoint**: all four stories work together.

---

## Phase 7: Polish and cross-cutting

- [ ] T042 [P] Add a "Debug run" section to `docs/USER_MANUAL.md`: what it sends, that it sends real requests, what is masked, reveal rules, the short-secret limit, nothing stored
- [ ] T043 [P] Add the feature to `specs/ROADMAP.md` and record validation results in `specs/039-chain-debug-run/validation.md`
- [ ] T044 [P] Add an accessibility and responsive pass for `ChainDebugPanel` and `DebugRunOutput`: keyboard order, focus visibility, narrow width with horizontal scroll inside code blocks only, dark mode contrast
- [ ] T045 Confirm SC-006: add or run a test that a fixed run summary renders a byte-identical report, and that `CHAIN_RUNTIME` and the golden script fixtures are unchanged
- [ ] T046 Bump the version in the workspace `package.json` files per the project convention, without committing
- [ ] T047 Run `npm test`, `npm run lint`, `npm run build`, then the manual scenarios in `quickstart.md`, including a timed Debug run of a 10-step plan against a responsive local target that must show its output within 15 seconds (SC-005); record exact results

---

## Dependencies and Execution Order

- **Phase 1** has no dependencies and informs T017, T036.
- **Phase 2** blocks all stories. Within it, T003–T008 are parallel; T009 needs T003; tests T010–T012 follow their code; T013 follows T005–T008.
- **US1** needs Phase 2. **US2** builds on US1's orchestrator (T016). **US3** needs US1's route and masker. **US4** needs US1 for the route and panel, and T001 for T036.
- Frontend tasks T019, T020 can start once T003 exists. T038 has no backend dependency and can run any time after Phase 1.
- **Phase 7** needs all stories.

### Parallel opportunities

- Phase 2: T003, T004, T005, T006, T007, T008 together; then T010, T011, T012.
- US1: T014 with T015, and T019 with T020, while T016 is built.
- US3: T031, T032 beside T027–T029.
- US4: T038 beside T035–T037.

## Implementation Strategy

**MVP**: Phases 1, 2, 3 and 4. They answer the original problem: the exchange, the extractor failure reason and why later steps were not sent. Do not ship this without US3, because a Debug run that returns content with no leak test, no reveal rules and no discard is not safe to expose; US3 is part of the minimum shippable increment, so ship **Phases 1–5**. US4's trigger polish can follow, but its host allow-list (T035) should not be deferred.

**Incremental**: Foundation, then US1, then US2 and US3, then US4, then polish. Run the leak-scan (T030) and the parity suite (T013, T023) on every change to the executor.

## Notes

- Never run `git commit`; leave changes for review.
- The generated k6 script, `CHAIN_RUNTIME`, report modules and persistence layer must not change (T045).
- Add no dependency.
