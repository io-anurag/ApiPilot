# Research: Workflow-Aware Postman Generation

## Decision 1: Add workflow context at the artifact boundary

**Decision**: Extend the export input with an optional workflow context containing the discovered
`IntegrationWorkflow[]` and the explicitly approved workflow IDs. Keep `TestScenario` and
`IntegrationWorkflow` framework-independent and unchanged as domain concepts.

**Rationale**: The current guided workflow already stores `dependencyAnalysis.workflows` and
`approvedWorkflowIds`, but `postmanGenerationStage.ts` passes only `apiModel` and
`approvedTestModel` to `generateCollection`. An optional boundary input preserves AP-007 behavior
for callers that have no workflow intent and prevents Postman-specific fields from leaking into the
core test model.

**Alternatives considered**:

- Add workflow fields to `TestScenario`: rejected because a scenario represents one operation and
  the constitution requires the TestModel to remain framework-independent.
- Make Postman generation read the global workflow store: rejected because AP-007 is a stateless
  generator and hidden global reads would make the artifact boundary difficult to test and reuse.
- Remove workflow review: rejected because AP-008 already supplies meaningful dependency and
  approval data; consuming it is the smaller product change.

## Decision 2: Filter approval at export time

**Decision**: Pass the complete discovered workflow list with approved IDs, then render only IDs
whose review state is explicitly approved. Rejected and undecided workflows are absent from the
collection and are reported in the workflow export summary/documentation as omitted decisions where
that context is available.

**Rationale**: The workflow review stage remains the authority for human approval. Filtering at the
generator boundary protects direct API callers from accidentally exporting an unapproved workflow.

**Alternatives considered**:

- Pass only approved workflow objects: rejected because the export report cannot distinguish
  approved output from workflows omitted by human decision, and the generator loses a useful
  validation boundary.
- Trust the caller to filter: rejected because it weakens the human-in-the-loop guarantee.

## Decision 3: Select scenarios deterministically when a workflow step identifies only an operation

**Decision**: For each workflow step, find approved scenarios matching method and path. Prefer a
`positive` scenario; if several remain, select the lexicographically smallest scenario ID. If no
positive scenario exists, select the lexicographically smallest matching approved scenario. If no
approved scenario matches, the whole workflow is unsupported and no part of it is emitted.

**Rationale**: AP-008's `WorkflowStep` identifies an operation, not a scenario ID, while AP-006 may
approve multiple scenarios for one operation. This rule is deterministic, favors a request likely
to produce the response needed by a handoff, and avoids arbitrary input-array ordering.

**Alternatives considered**:

- Select the first scenario in input order: rejected because input order is not a stable semantic
  contract.
- Add scenario selection to workflow review immediately: deferred because it expands the review
  UX and contract beyond the current product gap.
- Emit every matching scenario as a branch: rejected because the existing workflow contract is a
  linear sequence and branching semantics are not defined.

## Decision 4: Fail a workflow atomically when it cannot be represented

**Decision**: Validate every approved workflow before rendering. Missing operations, missing step
scenarios, invalid positions, unresolved variables, unsupported extraction paths, or unsupported
request representation mark the entire workflow unsupported. The collection contains no partial
sequence for that workflow, while the report contains a safe limitation.

**Rationale**: A partial chain would look executable while silently losing the relationship that
made workflow approval meaningful. This directly follows FR-008 and the existing AP-007 rule that
unsupported intent must not be flattened into unrelated requests.

**Alternatives considered**:

- Render supported steps and list failed steps: rejected because it creates misleading workflow
  intent and makes later requests appear chained when they are not.
- Fail the entire export for one unsupported workflow: rejected because AP-007 already supports
  successful exports with limitations and unaffected standalone scenarios should remain usable.

## Decision 5: Render handoffs through deterministic Postman scripts and variables

**Decision**: Add extraction statements to the producer request's test script for each approved
`WorkflowVariable`, using the relationship's producer field as the response path. Reference the
same deterministically named variable in the consumer request at its declared path, query, header,
or body location. Scope names with the workflow ID and variable name to prevent collisions.

**Rationale**: Postman test scripts are the existing artifact mechanism for executable assertions,
and workflow variables already identify producer/consumer positions, fields, and locations.
Deterministic names make repeated exports stable and traceable.

**Alternatives considered**:

- Add a separate request between steps: rejected because it would change the workflow and add an
  operation not present in the approved intent.
- Use a single global variable name: rejected because different workflows may reuse field names.
- Use AI or runtime inference to find response paths: rejected by the constitution and the feature
  specification.

## Decision 6: Preserve the existing endpoint and add an optional request field

**Decision**: Keep `POST /api/test-models/postman-collection` and its current response shape,
extending the request with optional workflow context and the response summary/limitations with
workflow-aware counts and safe provenance identifiers. Keep the guided workflow endpoint as the
source of context for the in-process stage.

**Rationale**: This is additive for AP-007 callers and lets contract tests exercise workflow export
without requiring a running guided workflow. The route remains thin and delegates all decisions to
the deterministic generator.

**Alternatives considered**:

- Create a second workflow-specific export endpoint: rejected because it duplicates artifact
  behavior and creates two contracts for the same output.
- Change the response into a Postman-specific workflow model: rejected because Postman remains an
  output adapter, not the domain model.
