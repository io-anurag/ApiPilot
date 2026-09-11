# Quickstart: Validating Test Execution & Results

Validates the feature end-to-end once implemented. Assumes the standard local dev setup already
documented in the repo root `README.md` (`npm install`, `npm run dev`), and a workflow that has
already reached `postmanGeneration: complete` (upload a spec, run it through analysis →
deterministic generation → AI enhancement/skip → scenario review → dependency analysis →
workflow review → Postman generation, per `specs/009-e2e-test-generation-workflow/quickstart.md`).

A simple local target API to execute against is convenient for this (any small running HTTP
server works — it does not need to implement the actual spec being tested; the point is
observing ApiPilot's execution behavior, not real API correctness).

## Prerequisites

- Backend and frontend dev servers running.
- One completed guided workflow (`postmanGeneration` stage `complete`) with at least one
  approved scenario whose operation uses a destructive method (`POST`/`PUT`/`PATCH`/`DELETE`),
  to exercise Scenario 3 below.
- A small local HTTP server to execute against — reachable at, e.g., `http://localhost:PORT`.

## Scenario 1 — Run against Local, see pass/fail results (User Story 1 / FR-006, FR-010, FR-012, FR-013)

1. Define an environment: `POST /api/test-generation-workflow/environments` with `tier: "local"`
   and `baseUrl` pointing at your local target server, supplying every variable the collection
   declares.
2. `POST /api/test-generation-workflow/execution/start` with that environment's id.
   **Expected**: `200` with `status: "in-progress"` returned promptly (not blocked until the
   whole run finishes).
3. Poll `GET /api/test-generation-workflow/execution/runs/:runId`. **Expected**: `results`
   grows across polls, in the same order as the approved collection's operations; the run
   eventually reaches `status: "completed"` with a `summary` whose counts match `results.length`.
4. Stop the local target server, start a second run. **Expected**: every request in the new run
   resolves with `outcome: "failed"`, `failureCategory: "connectivity-failure"` — never
   presented as an assertion failure.

## Scenario 2 — Environment selection is explicit and validated (User Story 2 / FR-001-FR-004)

1. Define two environments with different `baseUrl`s (e.g. "Local" and "Staging").
2. Start a run against each in turn. **Expected**: inspecting either run's results (or the
   target server's own logs) confirms requests actually reached the `baseUrl` configured for
   whichever environment was selected for that run.
3. Define a third environment omitting a variable the collection declares, then attempt to start
   a run against it. **Expected**: `400 missing_variable_values` naming the specific missing
   variable(s); no request is sent.

## Scenario 3 — Destructive/Staging confirmation guard (User Story 4 / FR-007, FR-009)

1. Define an environment with `tier: "staging"`.
2. `POST /api/test-generation-workflow/execution/start` against it with `confirmed` omitted (or
   `false`). **Expected**: `409 confirmation_required`, naming `"staging"` and listing the
   collection's destructive operations; no request is sent.
3. Resubmit the same request with `"confirmed": true`. **Expected**: the run starts normally.
4. While that run is `in-progress`, attempt a second `POST .../execution/start` (any
   environment). **Expected**: `409 execution_in_progress` naming the already-running run's id.

## Scenario 4 — Cancellation (User Story 1 acceptance scenario 5 / FR-015)

1. Define an environment with a non-zero `requestDelayMs` (e.g. `2000`) against a collection with
   several approved scenarios, and start a run.
2. Shortly after it starts (while some requests remain), `POST .../execution/cancel`.
   **Expected**: `202`; polling the run afterward shows `status: "cancelled"`, every
   already-attempted request keeps its real outcome, and every remaining request shows
   `outcome: "not-attempted"`, `notAttemptedReason: "cancelled"`.

## Scenario 5 — Run history persists for the session (User Story 5 / FR-019, FR-020)

1. Complete two runs from the scenarios above.
2. `GET /api/test-generation-workflow/execution/runs`. **Expected**: both runs are listed,
   each with its own id, environment, and summary — neither overwritten by the other.
3. `GET /api/test-generation-workflow/execution/runs/:runId` for the earlier run.
   **Expected**: its full `results` are unchanged from when it completed.

## Out of scope for this quickstart

- Workflow-step data-handoff execution (an earlier request's extracted value feeding a later
  one) — covered by `specs/016-workflow-aware-postman`'s existing rendering plus this feature's
  research.md D1/D2; validate it by using a collection with at least one approved,
  fully-rendered workflow (per that spec's quickstart) and confirming the dependent request in
  the run's results shows the extracted value was actually used, not confirmed here separately.
- Real-model AI behavior — unaffected by this feature entirely.
