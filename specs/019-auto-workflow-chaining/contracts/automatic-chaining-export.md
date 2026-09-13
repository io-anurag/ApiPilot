# API Contract: Automatic Workflow Chaining for Postman Export

This feature extends the existing stateless `POST /api/test-models/postman-collection` contract
(007-postman-collection-generator, 016-workflow-aware-postman) and the guided workflow's
Postman-generation stage. Existing requests without the new fields below remain valid and preserve
today's behavior exactly — this is an additive extension, not a breaking change.

**Important distinction from 016's `workflowContext`**: `workflowContext.approvedWorkflowIds` still
governs full, multi-step `IntegrationWorkflow` rendering exactly as it does today — a pending or
rejected workflow is still never rendered as a workflow sequence. `workflowContext.automaticChaining`
(new) is a separate, independent mechanism operating only on **standalone** scenarios (those not
covered by an approved workflow) and only on **direct, single-hop** relationships; it may render a
chain for a relationship that belongs to a still-*pending* workflow (that is the feature's purpose),
but never one that belongs to an explicitly *rejected* workflow.

## `POST /api/test-models/postman-collection`

### Request

```json
{
  "apiModel": { "operations": [], "securitySchemes": {}, "summary": {} },
  "testModel": { "scenarios": [] },
  "workflowContext": {
    "workflows": [],
    "approvedWorkflowIds": [],
    "automaticChaining": {
      "graph": {
        "relationships": [
          {
            "id": "relationship-1",
            "producer": { "operationPath": "/orders", "operationMethod": "GET", "field": "id" },
            "consumer": {
              "operationPath": "/orders/{id}",
              "operationMethod": "DELETE",
              "field": "id",
              "location": "path"
            },
            "confidence": "CONFIRMED",
            "source": "deterministic",
            "evidence": {
              "nameMatch": true,
              "typeMatch": true,
              "formatMatch": true,
              "resourceRelationship": true,
              "tagAlignment": true
            },
            "explanation": "Response field \"id\" on GET /orders matches path parameter \"id\" on DELETE /orders/{id}; same resource, matching type and format."
          }
        ]
      },
      "cycles": [],
      "workflowDecisions": {}
    }
  },
  "options": {
    "collectionName": "Orders API tests",
    "baseUrl": "https://qa.internal.example",
    "variableValues": {},
    "disableAutomaticChaining": false
  }
}
```

`workflowContext.automaticChaining` is optional. When absent, no automatic chaining is attempted
and export behaves exactly as it does today (including for callers that never adopted
008-dependency-workflow-engine). When present:

- `graph` is the complete, unfiltered dependency graph produced by dependency analysis — the
  endpoint filters it internally to CONFIRMED/LIKELY relationships; it does not require the caller
  to pre-filter.
- `cycles` is the dependency-analysis cycle-finding list; any relationship named in a cycle's
  `relationshipIds` is never used for automatic chaining.
- `workflowDecisions` is the human review decision map (`IntegrationWorkflow.id` →
  `{ state: "pending" | "approved" | "rejected", ... }`). Only relationships belonging to an
  explicitly `"rejected"` workflow are excluded; `"pending"` and `"approved"` relationships are both
  eligible (an already-approved workflow's own relationships are moot here since its scenarios are
  already excluded from the standalone set the automatic pass operates on).

`options.disableAutomaticChaining` is optional, default `false`. Setting it to `true` reverts this
export to today's behavior: no automatic chains are applied regardless of `automaticChaining`
context, and every otherwise-eligible parameter is reported as an `unresolved-path-parameter`
limitation exactly as before this feature existed. There is no per-relationship opt-out — the flag
applies to the whole export (Clarifications, 2026-09-13).

The generator selects a producer's response value from that operation's approved **positive**-
outcome scenario only (mirroring the existing workflow-step scenario-selection policy: prefer
category `positive`, then the smallest scenario ID) — never from a negative/invalid-input scenario.

### Success Response: `200 OK`

The existing response fields remain. `summary` adds one field:

```json
{
  "collection": { "info": {}, "variable": [], "item": [] },
  "environment": { "name": "Orders API tests environment", "values": [] },
  "readme": "…",
  "validation": { "valid": true, "problems": [] },
  "limitations": [],
  "summary": {
    "requestCount": 2,
    "folderCount": 1,
    "byProvenance": { "RULE": 2, "AI": 0 },
    "workflowCount": 0,
    "workflowRequestCount": 0,
    "standaloneRequestCount": 2,
    "workflowVariableCount": 0,
    "unsupportedWorkflowCount": 0,
    "omittedWorkflowCount": 0,
    "automaticChainCount": 1
  }
}
```

Every generated `ArtifactVariable` produced by an automatic chain carries
`provenance.origin: "automatic-chain"` (existing workflow-derived variables carry
`provenance.origin: "approved-workflow"`), so the environment and README can distinguish the two
origins as required by spec FR-010.

The README's "Known limitations" section is otherwise unchanged in format; a path parameter that
automatic chaining could not resolve (no eligible relationship, ordering conflict, cycle,
rejection, or ambiguous producer left unresolved) is still reported as an `unresolved-path-parameter`
limitation with the existing message text.

### Error Responses

Existing errors remain unchanged (see 007/016 contracts). `automaticChaining` and
`disableAutomaticChaining` are validated the same way as other optional request fields: a malformed
`automaticChaining` object (e.g. a relationship referencing an operation absent from `apiModel`) is
a `400 invalid_request`, not a silently-ignored field.

## Guided Workflow Contract

`POST /api/test-generation-workflow/postman-generation` continues to accept `ExportOptions`
(including the new `disableAutomaticChaining`). The stage implementation now additionally supplies
`dependencyAnalysis.graph`, `dependencyAnalysis.cycles`, and `workflowDecisions` from the current
`TestGenerationWorkflow` record as `workflowContext.automaticChaining`, alongside the existing
`workflows`/`approvedWorkflowIds`. No new stage, endpoint, or review step is introduced — automatic
chaining takes effect the moment `workflowReview` is complete and Postman generation runs, the same
trigger that already exists today.

## Guarantees

- No automatic chain is applied using a relationship weaker than LIKELY confidence, or using
  field-name similarity alone.
- No automatic chain crosses a cycle, an explicitly rejected workflow's relationships, or more than
  one hop.
- No automatic chain is applied when doing so would require the collection's existing item order to
  place the consumer before the producer.
- Every applied automatic chain is traceable, in the export summary, to its source relationship and
  confidence.
- `disableAutomaticChaining: true` reproduces byte-identical output to the pre-feature behavior for
  the same inputs.
- No generated request is executed and no API host from the specification is contacted.
- Credential values remain only in the environment artifact and never in collection, README, or
  diagnostics.
