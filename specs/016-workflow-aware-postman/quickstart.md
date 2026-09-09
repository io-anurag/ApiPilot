# Quickstart: Workflow-Aware Postman Generation

This guide validates AP-016 at the deterministic generator, HTTP contract, and guided workflow
boundaries. It assumes Node.js 20 LTS and npm dependencies are installed from the repository root.

## Prerequisites

- A valid ApiPilot checkout with dependencies installed.
- The repository's mock AI provider configuration for ordinary tests; AP-016 export itself does
  not invoke AI.
- The existing Postman and dependency workflow fixtures, plus AP-016 workflow fixtures created by
  the implementation tasks.

## Focused Automated Checks

Run the Postman and workflow tests from the repository root:

```powershell
npm run test -w backend -- tests/integration/postmanCollection.test.ts tests/integration/postmanCollectionValidation.test.ts tests/unit/testGenerationWorkflow/postmanGenerationStage.test.ts
```

Expected outcomes:

- Existing standalone exports still return one request per approved scenario.
- An approved workflow is rendered as an ordered workflow folder.
- A response field is extracted by the producer request and referenced by the consumer request.
- Rejected and undecided workflows are absent.
- A workflow missing an operation-matching approved scenario is reported as a limitation without a
  partial folder.
- Repeated identical exports have identical serialized results.
- No network request is made to a specification host.

Run the complete backend suite after the focused checks:

```powershell
npm run test -w backend
```

## HTTP Contract Check

Start the backend using its normal development command, then submit an export request containing:

1. `apiModel` with a producer and consumer operation.
2. `testModel` with approved positive scenarios for both operations.
3. `workflowContext.workflows` containing the ordered steps and `WorkflowVariable` handoff.
4. `workflowContext.approvedWorkflowIds` containing the workflow ID.

Use the JSON example in the contract as the request body with any HTTP client, for example by
saving it as `workflow-export-request.json` and running:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/test-models/postman-collection `
  -ContentType 'application/json' `
  -Body (Get-Content .\workflow-export-request.json -Raw)
```

Verify that the `200` response contains:

- A workflow folder with requests ordered by step position.
- A producer test script that stores the handoff variable.
- A consumer request referencing the handoff variable.
- Workflow counts and limitations in `summary` and `readme`.
- No credential value in `collection`, `readme`, or diagnostics.

## Guided Workflow Check

Use the existing guided workflow endpoints to complete a run through workflow review:

1. Upload and analyze a specification with at least one confirmed dependency.
2. Generate and approve scenarios for each operation in the dependency chain.
3. Approve one discovered integration workflow and reject or leave another workflow unapproved.
4. Complete workflow review.
5. Call Postman generation with export options.
6. Inspect the embedded `postmanArtifact`.

Expected outcomes:

- The approved workflow is present as a sequence.
- The rejected or undecided workflow is absent.
- Changing the workflow decision reopens workflow review and makes the prior Postman stage stale.
- Regenerating after review reflects the new decision without changing unrelated standalone output.

## Validation Commands Before Handoff

```powershell
npm run build
npm run lint
npm test
```

The implementation is complete only when the focused workflow checks and the repository-wide
validation commands pass without weakening existing tests or contracts.
