# API Contract: Workflow-Aware Postman Generation

This feature extends the existing stateless `POST /api/test-models/postman-collection` contract and
the guided workflow's Postman-generation stage. Existing requests without `workflowContext` remain
valid and preserve AP-007 single-operation behavior.

## `POST /api/test-models/postman-collection`

### Request

```json
{
  "apiModel": { "operations": [], "securitySchemes": {}, "summary": {} },
  "testModel": { "scenarios": [] },
  "workflowContext": {
    "workflows": [
      {
        "id": "workflow-1",
        "steps": [
          {
            "position": 0,
            "operationPath": "/orders",
            "operationMethod": "POST",
            "producesVariableNames": ["orderId"],
            "consumesVariableNames": []
          },
          {
            "position": 1,
            "operationPath": "/orders/{orderId}",
            "operationMethod": "GET",
            "producesVariableNames": [],
            "consumesVariableNames": ["orderId"]
          }
        ],
        "variables": [
          {
            "name": "orderId",
            "producerStepIndex": 0,
            "producerField": "id",
            "consumerStepIndex": 1,
            "consumerLocation": "path",
            "consumerField": "orderId",
            "relationshipId": "relationship-1"
          }
        ],
        "relationshipIds": ["relationship-1"]
      }
    ],
    "approvedWorkflowIds": ["workflow-1"]
  },
  "options": {
    "collectionName": "Orders API tests",
    "baseUrl": "https://qa.internal.example",
    "variableValues": {}
  }
}
```

`workflowContext` is optional. When present, `workflows` is the complete dependency-analysis
workflow list and `approvedWorkflowIds` is the set of explicit human approvals. The endpoint MUST
reject malformed context rather than silently treating it as absent.

The generator selects one approved scenario for each workflow step using this stable policy:
prefer category `positive`, then choose the smallest scenario ID. No workflow step without an
approved operation-matching scenario is rendered.

### Success Response: `200 OK`

The existing response fields remain. `summary` adds workflow counts:

```json
{
  "collection": {
    "info": { "name": "Orders API tests", "_postman_id": "…", "schema": "…" },
    "variable": [{ "key": "baseUrl", "value": "" }],
    "item": [
      {
        "name": "Workflow: workflow-1",
        "item": [
          {
            "id": "…",
            "name": "POST /orders — workflow step 1",
            "request": { "method": "POST", "url": { "raw": "{{baseUrl}}/orders" } },
            "event": [
              { "listen": "test", "script": { "type": "text/javascript", "exec": ["…"] } }
            ]
          },
          {
            "id": "…",
            "name": "GET /orders/{orderId} — workflow step 2",
            "request": {
              "method": "GET",
              "url": { "raw": "{{baseUrl}}/orders/:orderId" }
            }
          }
        ]
      }
    ]
  },
  "environment": { "name": "Orders API tests environment", "values": [] },
  "readme": "…",
  "validation": { "valid": true, "problems": [] },
  "limitations": [],
  "summary": {
    "requestCount": 2,
    "folderCount": 1,
    "byProvenance": { "RULE": 2, "AI": 0 },
    "workflowCount": 1,
    "workflowRequestCount": 2,
    "standaloneRequestCount": 0,
    "workflowVariableCount": 1,
    "unsupportedWorkflowCount": 0
  }
}
```

Workflow folders and requests are ordered deterministically. A producer test script extracts a
relationship field into a workflow-scoped variable; the consumer request references that variable
at its declared path, query, header, or body location. The exact generated script is an artifact
format detail, not a new domain contract.

A successful response may contain workflow limitations for approved workflows that could not be
rendered. Such a workflow contributes no partial folder or request. Existing AP-007 limitations
continue to be reported for emitted standalone and workflow requests.

### Error Responses

Existing errors remain unchanged:

- `400 invalid_request` for malformed ApiModel, TestModel, options, or workflow context.
- `400 empty_approved_test_model` when no approved scenarios exist.
- `400 unknown_operation` when approved scenario data references no ApiModel operation.
- `400 unknown_variable` for an option variable not referenced by the generated collection.
- `500 collection_validation_failed` when the generated collection fails pre-delivery validation.

The legacy `workflow_intent_unsupported` error remains reserved for unsupported ad hoc workflow
fields embedded in a TestModel. Supported workflow intent MUST arrive through `workflowContext`;
the generator MUST NOT infer workflow context from arbitrary object keys.

An unsupported approved workflow is a successful export with a workflow limitation, not a request
failure, provided at least one approved scenario is rendered and the resulting collection validates.

## Guided Workflow Contract

`POST /api/test-generation-workflow/postman-generation` continues to accept export options. The
stage implementation supplies its current `dependencyAnalysis.workflows` and
`approvedWorkflowIds` to the generator. The response's embedded `postmanArtifact` follows the
success shape above.

Changing a workflow decision reopens workflow review and marks Postman generation stale through the
existing workflow contract. A newly generated artifact therefore reflects the current approval
set.

## Guarantees

- No rejected or pending workflow is emitted.
- Every workflow request maps to an approved scenario and ApiModel operation.
- Every handoff extraction and reference maps to a `WorkflowVariable` and relationship ID.
- Unsupported workflows are never flattened into unrelated requests.
- Workflow and standalone requests remain deterministic and are not duplicated.
- No generated request is executed and no API host from the specification is contacted.
- Credential values remain only in the environment artifact and never in collection, README, or
  diagnostics.
