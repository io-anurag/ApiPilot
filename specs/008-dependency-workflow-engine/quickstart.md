# AP-008 Quickstart Validation

This guide validates dependency detection and workflow assembly from an `ApiModel`. Nothing in it
executes a discovered relationship or contacts an API described by the specification. This feature
introduces no new frontend page (research.md); validation is via the automated suite and direct API
calls.

## Prerequisites

- Node.js 20 LTS or newer
- npm dependencies installed from the repository root
- A normalized AP-002 `ApiModel` (from `POST /api/specifications`, or a fixture under
  `backend/tests/fixtures/openapi/`)

A local AI model download is not required. Automated tests use the deterministic mock provider
(`AI_PROVIDER_MODE=mock`, the project default for tests per CLAUDE.md §16); the AI-assisted pass is
optional and degrades explicitly (`aiOutcome`) rather than failing the analysis when unavailable.

## Automated Validation

From the repository root:

```powershell
npm test --workspace @apipilot/shared-domain -- --run tests/unit/api-dependency.test.ts
npm test --workspace @apipilot/backend -- --run tests/unit/dependencies tests/integration/apiDependencies
npm run build
npm run lint
```

Expected outcomes:

- No relationship is classified CONFIRMED or LIKELY from a field-name match alone (FR-003, SC-002).
- Every relationship carries a non-empty explanation naming its evidence or AI rationale, and
  identifies whether it is deterministic, AI, or both (FR-007, SC-004).
- An ApiModel with no candidate relationships returns an explicit empty `graph.relationships` and
  `workflows` (FR-009).
- A create → read → update → delete chain (`POST /users` → `GET/PUT/DELETE /users/{userId}`)
  assembles into one ordered workflow whose steps never consume a value before it is produced
  (FR-011, FR-013, SC-005, SC-006).
- A relationship set containing a cycle is reported under `cycles`, and no workflow is produced that
  requires contradictory step ordering (FR-014).
- Running the same analysis twice against the same `ApiModel` with the mock AI provider produces an
  identical response (FR-010, FR-016, SC-003).
- An AI-suggested relationship referencing a nonexistent field or operation never appears in the
  result (FR-008).

## Manual Validation

### 1. Analyze a representative multi-operation specification

Start the backend:

```powershell
npm run dev --workspace @apipilot/backend
```

Upload a specification via `POST /api/specifications` to obtain an `ApiModel` (see
`specs/002-openapi-specification-engine/contracts/`), then call the dependency endpoint:

```powershell
curl -X POST http://localhost:3000/api/api-models/dependencies `
  -H "Content-Type: application/json" `
  -d '{ "apiModel": <paste the apiModel from the previous response> }'
```

Confirm (see `contracts/api-dependency-workflow-api.md` for the full response shape):

- `graph.relationships` lists a CONFIRMED or LIKELY relationship for each obvious
  create-then-use pair in the specification (e.g. a `POST` returning an id consumed by a later
  `GET`/`PUT`/`DELETE` on the same resource).
- `workflows` contains an ordered, multi-step workflow for each such chain, with `variables` naming
  the hand-off between steps.
- `manualConfirmationCandidates` lists any POSSIBLE relationships or disambiguation exclusions,
  each with a human-readable reason (FR-012, FR-013a).

### 2. Confirm graceful AI degradation

Set `AI_PROVIDER_MODE=local` with no model cached (or otherwise make the provider unavailable), call
the endpoint again, and confirm:

- The response still returns `200 OK` with deterministic relationships populated.
- `aiOutcome` is `"unavailable"` or `"timeout"`, not `"success"`, and no relationship is silently
  fabricated in place of the missing AI pass (FR-018).

### 3. Confirm no network access and no sensitive logging

- While the backend serves the analysis, confirm no outbound request is made to any host named in
  the `apiModel` (FR-019, SC-009) — e.g. by running the analysis with network access to those hosts
  blocked and confirming the result is unaffected.
- Inspect the server log for the request: it must contain no specification content, no AI prompt, and
  no AI response body — only request id, operation counts, duration, and `aiOutcome` (FR-020).

## Determinism check

```powershell
npm test --workspace @apipilot/backend -- --run tests/unit/dependencies/determinism.test.ts
```

The determinism test analyzes the same `ApiModel` twice in one process (mock AI provider) and
asserts an identical serialized result, including relationship ids, classifications, workflow step
order, and variable names — and repeats the analysis with the `ApiModel`'s operations shuffled to
confirm the result does not depend on input order.

## Performance check (SC-008)

```powershell
npm test --workspace @apipilot/backend -- --run tests/unit/dependencies/performance.test.ts
```

Asserts that a 200-operation fixture ApiModel completes dependency analysis and workflow assembly
(including a mock AI call) in under 15 seconds, or fails explicitly rather than returning a partial
result.
