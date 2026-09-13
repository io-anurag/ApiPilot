# Quickstart: Automatic Workflow Chaining for Postman Export

This guide validates AP-019 at the deterministic generator, HTTP contract, and guided workflow
boundaries. It assumes Node.js 20 LTS and npm dependencies are installed from the repository root.

## Prerequisites

- A valid ApiPilot checkout with dependencies installed.
- The repository's mock AI provider configuration for ordinary tests; automatic chaining itself
  does not invoke AI (it consumes dependency analysis output already produced by
  008-dependency-workflow-engine).
- The existing Postman and dependency/workflow fixtures (`backend/tests/fixtures/postman/`), plus
  new relationship/graph fixtures (`dependencyFixtures.ts`) created by the implementation tasks.

## Focused Automated Checks

Run the Postman and dependency-related tests from the repository root:

```powershell
npm run test -w backend -- tests/unit/postman/automaticChaining.test.ts tests/unit/postman/generateCollection.test.ts tests/unit/postman/requestItem.test.ts tests/integration/postmanWorkflowCollection.test.ts tests/unit/testGenerationWorkflow/postmanGenerationStage.test.ts
```

Expected outcomes:

- A standalone `GET /orders` (producer) and `DELETE /orders/{id}` (consumer) pair connected by a
  CONFIRMED relationship, with no approved `IntegrationWorkflow` for that pair, is rendered chained:
  the producer request extracts `id` into a variable, and the consumer request substitutes it —
  with no `unresolved-path-parameter` limitation for that parameter.
- The same pair with only a POSSIBLE-confidence relationship (or no relationship at all) is left
  exactly as it is today: a bare `{{id}}` variable and an `unresolved-path-parameter` limitation.
- A relationship whose producer or consumer belongs to an explicitly *rejected* workflow is not
  chained.
- A relationship that would place the consumer before the producer under the collection's existing
  ordering is not chained.
- Setting `options.disableAutomaticChaining: true` reproduces byte-identical output to a run from
  before this feature existed, for the same inputs.
- The export `summary.automaticChainCount` and README distinguish automatic chains from
  approved-workflow chains.
- Repeated identical exports (same scenarios, same dependency graph, same options) produce
  identical serialized results.
- No network request is made to a specification host.

Run the complete backend suite after the focused checks:

```powershell
npm run test -w backend
```

## HTTP Contract Check

Start the backend using its normal development command, then submit an export request containing:

1. `apiModel` with a producer operation (`GET /orders`) and a consumer operation
   (`DELETE /orders/{id}`).
2. `testModel` with an approved positive scenario for `GET /orders` and an approved scenario for
   `DELETE /orders/{id}` that supplies no value for `id`.
3. `workflowContext.automaticChaining.graph.relationships` containing one CONFIRMED relationship
   between the two operations' `id` fields.
4. No entry for that relationship in `workflowContext.automaticChaining.cycles` or in a `"rejected"`
   `workflowDecisions` entry.

Use the JSON example in [contracts/automatic-chaining-export.md](./contracts/automatic-chaining-export.md)
as the request body with any HTTP client, for example by saving it as
`automatic-chaining-request.json` and running:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/test-models/postman-collection `
  -ContentType 'application/json' `
  -Body (Get-Content .\automatic-chaining-request.json -Raw)
```

Verify that the `200` response contains:

- The `GET /orders` request with a test script that stores the `id` field into a variable.
- The `DELETE /orders/{id}` request referencing that variable instead of a bare `{{id}}` placeholder.
- `summary.automaticChainCount` equal to `1`.
- No `unresolved-path-parameter` limitation for that `id` parameter.
- No credential value in `collection`, `readme`, or diagnostics.

Repeat the request with `"options": { "disableAutomaticChaining": true }` and verify the `DELETE`
request instead contains the bare `{{id}}` placeholder with the standard
`unresolved-path-parameter` limitation — proving the opt-out reverts to pre-feature behavior.

## Guided Workflow Check

Use the existing guided workflow endpoints to complete a run through workflow review:

1. Upload and analyze a specification with at least one CONFIRMED dependency relationship whose
   producer and consumer operations both have approved scenarios.
2. Complete scenario review (AP-006) and workflow review (AP-008/016) **without** approving or
   rejecting the workflow that contains this relationship (leave it pending) — the point of this
   feature is that a human never had to act on it.
3. Complete workflow review and call Postman generation with default export options.
4. Inspect the embedded `postmanArtifact`.

Expected outcomes:

- The relationship is rendered as an automatic chain even though its workflow was never approved.
- `summary.automaticChainCount` reflects it; `summary.workflowCount` does not (it was never
  rendered as an approved workflow sequence).
- Re-running workflow review to explicitly *reject* that workflow, then regenerating, removes the
  chain and restores the `unresolved-path-parameter` limitation for that parameter.

## Validation Commands Before Handoff

```powershell
npm run build
npm run lint
npm test
```

The implementation is complete only when the focused automatic-chaining checks and the
repository-wide validation commands pass without weakening existing tests or contracts (in
particular, existing 007/016 workflow and standalone export tests must continue to pass unchanged).
