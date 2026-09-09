# Data Model: Workflow-Aware Postman Generation

## Existing Inputs

### ApiModel

The analyzed OpenAPI-derived model. It supplies the canonical operation list, security schemes,
summary issues, request/response schema information, and operation methods and paths.

Validation used by this feature:

- Every workflow step must match exactly one `operationMethod` + `operationPath` in the ApiModel.
- No operation is inferred or created during export.

### Approved TestModel

The scenario set produced by scenario review. It contains only accepted scenarios and preserves
request values, assertions, operation identity, and provenance.

Validation used by this feature:

- Every rendered workflow step must resolve to one approved scenario using the deterministic
  selection rule in research.md.
- Approved request data and assertions are copied without schema repair or invented outcomes.

## New Boundary Entity

### WorkflowExportContext

The optional context passed to artifact generation.

| Field                 | Type                    |                Required | Rules                                                                      |
| --------------------- | ----------------------- | ----------------------: | -------------------------------------------------------------------------- |
| `workflows`           | `IntegrationWorkflow[]` | yes when context exists | Must be the workflows produced by dependency analysis; IDs must be unique. |
| `approvedWorkflowIds` | `string[]`              | yes when context exists | IDs must refer to entries in `workflows`; only these workflows may render. |

The context is optional to preserve AP-007 standalone exports. An omitted context means there is no
workflow intent to render, not that all workflows are approved.

## WorkflowRenderPlan

An internal deterministic planning representation created before artifact emission.

| Field        | Type                         | Rules                                                                                 |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------- |
| `workflowId` | string                       | Source `IntegrationWorkflow.id`.                                                      |
| `steps`      | `WorkflowRenderStep[]`       | Sorted by `WorkflowStep.position`; positions must be unique and contiguous from zero. |
| `variables`  | `WorkflowRenderVariable[]`   | Every source `WorkflowVariable` must resolve to valid producer and consumer steps.    |
| `status`     | `supported` or `unsupported` | Unsupported plans emit no collection items.                                           |
| `limitation` | `GenerationLimitation`       | Required when status is unsupported; contains safe location/message and workflow ID.  |

### WorkflowRenderStep

| Field          | Type                    | Rules                                                           |
| -------------- | ----------------------- | --------------------------------------------------------------- |
| `position`     | number                  | Source step position; determines request order.                 |
| `scenario`     | `TestScenario`          | Deterministically selected approved scenario for the operation. |
| `operation`    | `ApiOperation`          | Exact ApiModel operation matched by method/path.                |
| `extractions`  | `WorkflowExtraction[]`  | Handoffs produced by this step.                                 |
| `consumptions` | `WorkflowConsumption[]` | Handoffs consumed by this step.                                 |

### WorkflowExtraction

| Field            | Type   | Rules                                                                                |
| ---------------- | ------ | ------------------------------------------------------------------------------------ |
| `variableName`   | string | Stable name scoped to workflow and source variable.                                  |
| `responseField`  | string | Source `WorkflowVariable.producerField`; dotted paths become nested response access. |
| `relationshipId` | string | Must reference a relationship in the dependency graph when available.                |

### WorkflowConsumption

| Field            | Type                                 | Rules                                                                                  |
| ---------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `variableName`   | string                               | Must match a prior extraction in the same workflow.                                    |
| `location`       | `path`, `query`, `header`, or `body` | Source consumer location.                                                              |
| `field`          | string                               | Source consumer field; nested body fields follow the existing dotted-field convention. |
| `relationshipId` | string                               | Traceability to the source relationship.                                               |

## Artifact Output Extensions

### GenerationLimitation additions

Workflow limitations carry the existing `kind`, `location`, and safe `message`, plus:

- `workflowId`: source workflow identifier.
- `stepPosition`: affected workflow step when applicable.
- `relationshipId`: affected dependency relationship when applicable.

New kinds are expected to distinguish missing step scenario, unsupported sequence, and failed
workflow variable extraction. They remain limitations rather than silent omissions.

### ExportSummary additions

| Field                      | Type   | Meaning                                              |
| -------------------------- | ------ | ---------------------------------------------------- |
| `workflowCount`            | number | Supported approved workflows rendered.               |
| `workflowRequestCount`     | number | Requests emitted inside rendered workflow folders.   |
| `standaloneRequestCount`   | number | Approved scenarios emitted outside workflow folders. |
| `workflowVariableCount`    | number | Handoff variables declared for rendered workflows.   |
| `unsupportedWorkflowCount` | number | Approved workflows omitted as unsupported.           |

Existing `requestCount`, `folderCount`, and `byProvenance` remain populated and compatible.

## State and Invariants

1. **Approval invariant**: only workflow IDs in `approvedWorkflowIds` may produce workflow items.
2. **Operation invariant**: every emitted request maps to an ApiModel operation.
3. **Scenario invariant**: every emitted request maps to an approved TestScenario.
4. **Sequence invariant**: workflow item order equals ascending source step position.
5. **Handoff invariant**: every consumer variable has an earlier producer extraction in the same
   supported workflow.
6. **No-duplication invariant**: scenarios used by a rendered workflow are not emitted again as
   standalone items.
7. **Atomicity invariant**: an unsupported workflow contributes zero collection items.
8. **Determinism invariant**: workflow sorting, scenario selection, variable naming, item IDs, and
   report ordering use stable canonical keys.
9. **Secret invariant**: workflow variables never contain supplied credential values; existing
   credential substitution and environment rules remain authoritative.
10. **Non-execution invariant**: planning and rendering issue no network requests and invoke no AI.

## State Transitions

Workflow review state already controls the stage transition:

```text
workflowReview active
  -> decisions recorded for every discovered workflow
  -> workflowReview complete
  -> postmanGeneration active
  -> export consumes approvedWorkflowIds
  -> postmanGeneration complete
```

Changing a workflow decision after export reopens workflow review and makes Postman generation
stale through the existing stage staleness rules. A subsequent export recomputes the artifact from
the current approved IDs and scenarios.
