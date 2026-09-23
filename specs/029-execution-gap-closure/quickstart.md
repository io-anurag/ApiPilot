# Quickstart: Test Execution Gap Closure

How to check that the three corrected behaviors work. It relies on the field definitions in
[data-model.md](data-model.md) and the response shapes in
[contracts/execution-api-delta.md](contracts/execution-api-delta.md), which are not repeated here.

## Prerequisites

- Node.js 20 and `npm install` run at the repository root.
- No network access, model download, or AI provider is needed. Every scenario runs against the
  local `TargetServer` fixture (`backend/tests/fixtures/execution/targetServer.ts`) or a local
  target you start yourself.

## Automated validation

```bash
npm test -w backend -- tests/unit/execution tests/unit/postman tests/integration/execution
npm test
npm run lint
npm run build
```

Expected: every test passes. Among the existing tests, only those that assert the old FR-007
over-confirmation or check the exact shape of a result should need updating (spec.md SC-006).
The `generateCollection()` determinism and golden tests in `tests/unit/postman/` must pass
without changes, which shows the exported artifact is unchanged (research.md D1).

## Scenario 1: dependent step is withheld (User Story 1)

1. Set up an approved two-step workflow: `POST /orders` produces `id`, which
   `GET /orders/{orderId}` consumes. Point it at a target where `POST /orders` returns `500`.
2. Start a run and poll `GET /api/test-generation-workflow/execution/runs/:runId` until the run
   finishes.
3. **Expected**: the target received no `GET /orders/...` request. The GET's result is
   `not-attempted` with reason `"dependency-not-met"`, and `unmetDependencies` names the POST's
   `scenarioId`. Standalone requests in the same run have their normal outcomes.
4. Make `POST /orders` return `201` with an `id` and run again. **Expected**: the GET is sent
   with that id, as before this feature.
5. Make `POST /orders` return `201` with an `id` but a body that breaks the documented schema.
   **Expected**: the POST fails with `assertion-failed`, and the GET is still sent (FR-001).
6. Repeat step 1 with an automatic chain (AP-019, an unresolved path parameter filled from a
   producer), and get the same result. Repeat it with an auth-credential chain (AP-023, a login
   operation whose token feeds other requests). **Expected**: the dependent requests are still
   sent and fail visibly (FR-006).

## Scenario 2: processing stage on every result (User Story 2)

Run a collection against a target set up to produce one pass, one assertion failure, one
unreachable request, and one cancellation. **Expected**: the stages are `"response-received"`,
`"response-received"`, `"no-response"`, and `"not-sent"`, matching data-model.md's invariants.
A run recorded before this feature, if you have one, is still returned without a
`processingStage`.

## Scenario 3: confirmation reflects approved requests (User Story 3)

Use a specification with GET and DELETE operations, and approve only GET scenarios.

| Environment tier | `confirmed` | Expected |
|------------------|-------------|----------|
| `local` | absent | `200`, run starts |
| `staging` | absent | `409 confirmation_required`, `destructiveOperations: []` |
| `staging` | `true` | `200`, run starts |

Then also approve a DELETE scenario and start against `local` without `confirmed`.
**Expected**: `409 confirmation_required`, with the DELETE listed once.

With an OAuth2 client-credentials specification and only GET scenarios approved, start against
`local` without `confirmed`. **Expected**: `200`. The token request's POST is not counted
(FR-010).

## Manual walkthrough (optional)

These endpoints have no UI (`specs/018` Clarifications 2026-09-23). Drive them with any HTTP
client against `npm run dev -w backend`, using the same session cookie for every call, in this
order: the guided workflow up to `postmanGeneration`, then `POST .../environments`, then
`POST .../execution/start`, then poll `GET .../execution/runs/:runId`.
