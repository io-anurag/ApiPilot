# Research: Test Execution Gap Closure

Resolves the design questions spec.md leaves to planning. Every decision below was checked against
the current code on 2026-09-23. File references are to the current tree.

## D1. Where the run gets its dependency links

**Decision**: The Postman generator computes the dependency links while it builds the collection
and returns them to the execution path through a new, backend-internal variant of the generator.
`generateCollection()` stays as it is and wraps the new variant, returning only its
`ExportOutcome`. The download, the `postmanGeneration` stage, `POST /api/postman-collections`, and
`ExportResult` in shared-domain do not change, so the exported bytes are unchanged
(constitution XVI).

Concretely, `backend/src/postman/generateCollection.ts` gains
`generateExecutableCollection(...)`, whose success value is `{ result: ExportResult,
dataDependencies: ExecutionDependencyMap }`. `ExecutionDependencyMap` maps a consuming item's
`PostmanRequestItem.id` to the ordered ids of the items it takes data values from. It is built
from two inputs the generator already holds at that point:

- **Approved workflows (AP-016)**: for every supported `WorkflowRenderPlan`, each
  `WorkflowVariable` links the item for `steps[producerStepIndex]` to the item for
  `steps[consumerStepIndex]`. Item ids come from `itemIdForWorkflowStep(...)`.
- **Automatic chains (AP-019)**: for every `AutomaticChain` that is not a credential chain, the
  producer's item (`itemIdForScenario(producer.scenarioId)`) links to each consumer's item.

**Rationale**: The links exist only inside the generator. `planApprovedWorkflows()` produces them
for workflows, and `planAutomaticChains()` produces them for chains, including the decisions that
drop a chain (ordering guard FR-015, rejected relationships, cycles). Anything outside the
generator would have to repeat those decisions and could disagree with the collection it actually
runs. Returning them from the same call that builds the items means the links always describe the
items being run.

**Alternatives considered**:
- *Add the links to `PostmanRequestItem.provenance`.* Rejected: `provenance` is serialized into
  the downloaded collection, so this would change every exported artifact and its golden tests.
  It would also add execution-only data to an artifact meant for Postman users.
- *Add a field to shared-domain `ExportResult`.* Rejected: `ExportResult` is returned to HTTP
  clients by the `postmanGeneration` stage and `POST /api/postman-collections`. That would widen
  two contracts outside this feature's scope for data only the execution path uses.
- *Re-derive the links in `runExecution.ts` by calling `planApprovedWorkflows()` and
  `planAutomaticChains()` again.* Rejected: `planAutomaticChains()` needs about thirty lines of
  setup computed inside `generateCollection()` (order ranks, credential relationships, scheme
  plan). Copying it would duplicate logic that must stay identical.
- *Parse `pm.environment.set(...)` and `{{variable}}` out of each item's script and URL text.*
  Rejected as fragile. Script text is an output format, not a data model.

## D2. Telling data hand-offs from credential hand-offs (FR-006)

**Decision**: `AutomaticChain` (backend-internal, `backend/src/postman/automaticChaining.ts`)
gains `kind: "data" | "credential"`. `applyChainGroup()` already computes this as `isAuthChain`
from `relationship.consumer.location === "auth"` and uses it to choose the variable name and
extraction target. `generateExecutableCollection()` puts only `kind === "data"` chains into
`dataDependencies`. Approved-workflow links are always data links. `DependencyFieldLocation` does include `"auth"`,
but the only code that creates an `"auth"` relationship is
`backend/src/postman/authCredentialRelationships.ts`. It runs inside the generator, and its
output goes only to `planAutomaticChains()`, never to dependency analysis or approved workflows.

**Rationale**: This answers the question spec.md's Assumptions left to planning: the collection
does already tell the two kinds apart, but only in a local variable. Storing it on the chain adds
no new analysis. It records a fact the generator already decided, in the only place that has it.

**Alternatives considered**: telling them apart by variable name (the credential chain writes to
a fixed name such as `token`). Rejected: it depends on naming conventions in `authMapping.ts` and
would break silently if they changed.

## D3. When a dependency counts as unmet (FR-001 to FR-005)

**Decision**: The loop in `runExecution.ts` keeps a set of item ids that have a blocking outcome
(spec.md FR-001, Clarifications 2026-09-23). Before
dispatching a scenario-backed item, and after the existing cancellation check, it looks up the
item's producers in `dataDependencies`. If any producer is in that set, the item is not sent. It
is recorded as `not-attempted` with reason `"dependency-not-met"`, and the item itself is added
to the set. An item that ran is added to the set when its `RequestResult` is `outcome: "failed"`
with any `failureCategory` other than `"assertion-failed"`. That leaves `"assertion-failed"` as
the only non-blocking failure. `mapNewmanResult.ts`'s `categorizeFailure()` gives it only when
the status check passed and a schema-conformance check failed: a failed status check becomes
`"unexpected-status"` first, and a check that could not run becomes `"could-not-evaluate"`. So
the category alone decides whether an outcome blocks, with no second look at the assertions.

- **Transitive (FR-003)**: a withheld item is itself added to the set, so its own dependents are
  withheld too, and each names its own direct producer (spec.md User Story 1, Scenario 3).
- **Cancellation wins (FR-005)**: the cancellation check stays first in each iteration, and on
  cancellation every remaining item is recorded `"cancelled"`, exactly as today.
- **Unaffected items (FR-004)**: items with no entry in `dataDependencies`, or none of whose producers
  is in the set, follow today's path unchanged.
- **OAuth2 token-fetch items (FR-007)**: synthesized items have no `scenarioId`. They keep today's
  code path and never enter the set, so their dependents are still sent (`specs/024` FR-004b).
- **Several unmet producers**: the result names every producer in the set, in execution order.

**Rationale**: A schema mismatch with the right status usually still carries the value the
hand-off needs, such as a created resource's `id`. Blocking on it would hide the dependents'
own results (spec.md Assumptions). Execution order already puts every
producer before its consumers. Workflow steps are sorted by position, and automatic chains are
only applied when the producer comes first (`specs/019` FR-015). So one forward pass is enough,
with no graph search.

**Alternatives considered**:
- *Block on any outcome other than passed.* This was the spec's first assumption. It was
  rejected in Clarifications 2026-09-23 because one schema mismatch could cascade through a whole
  workflow.
- *Check whether the extracted variable is empty in the environment Newman carries between
  items.* Rejected: it implements the "value not captured" refinement that spec.md records as a
  candidate follow-up rather than this feature's rule.

## D4. How a result names its unmet dependencies (FR-002, FR-017)

**Decision**: `RequestResult` gains `unmetDependencies?: UnmetDependency[]`, where
`UnmetDependency` is `{ scenarioId, operationPath, operationMethod }`. It is present only when
`notAttemptedReason === "dependency-not-met"`, and each entry is a producer with a blocking
outcome. These are the same three identifiers every `RequestResult` already carries, so a caller
can match an entry to the producer's own result in the same run (SC-002).

**Rationale**: It reuses existing vocabulary and carries no values, only identifiers (FR-017,
constitution XX). Workflow id and step position are not added. A scenario appears in at most one
position per workflow, and a result does not carry those fields today either.

## D5. Processing stage (FR-008, FR-009)

**Decision**: `RequestResult` gains `processingStage?: RequestProcessingStage`, where
`RequestProcessingStage = "not-sent" | "no-response" | "response-received"`. It is set on every
result produced after this feature ships:

| Result | `processingStage` |
|--------|-------------------|
| `outcome: "not-attempted"` (any reason) | `"not-sent"` |
| `failureCategory: "connectivity-failure"` or `"timeout"` | `"no-response"` |
| `outcome: "passed"`, or `failureCategory` of `"assertion-failed"`, `"unexpected-status"`, `"could-not-evaluate"` | `"response-received"` |

`mapNewmanResult.ts` sets it for results that were sent, and `runExecution.ts` sets it for every
not-attempted result.

**Rationale**: Three values, not four, per spec.md Assumptions. In this path assertion evaluation
always follows a received response. The field is optional in the type only because stored rows
from before this feature do not have it, and spec.md Edge Cases require those to be returned
unchanged (FR-015).

**Alternatives considered**: working out the stage on read for old rows. Rejected: spec.md says
old results are returned unchanged, without a processing stage. Working it out on read would also
put data in stored results that was never recorded.

## D6. Destructive requests for the confirmation step (FR-010 to FR-013)

**Decision**: `confirmationRequirement(apiModel, approvedTestModel, environment)` lists as
destructive only the `ApiModel` operations that have at least one approved scenario (matched on
upper-cased method and path) and whose method is in `DESTRUCTIVE_METHODS`. `ApiModel` order is
kept, and each operation appears once. `destructiveOperations(apiModel, approvedTestModel)`
changes the same way. The tier rule is unchanged: `staging` and `production` always require
confirmation.

- The route (`backend/src/api/testGenerationWorkflow.ts`) passes `workflow.approvedTestModel!`,
  which it already holds.
- Synthesized OAuth2 token-fetch requests (a POST to the token URL) are not counted (spec.md
  FR-010, Clarifications 2026-09-23). They only fetch a credential, and they have no approved
  scenario, so filtering by approved scenarios leaves them out without any special case.
- `DESTRUCTIVE_METHODS` and `DestructiveOperation` keep their exports, so
  `externalCollections/destructiveRequests.ts` (`specs/026`) is unaffected (FR-016).

**Rationale**: The shared-domain doc comment on `ExecutionConfirmationRequirement` already says it
is computed from "the approved `TestModel`'s operations". The code is what drifted. Keeping
`ApiModel` order means that when a collection contains every destructive operation, the
confirmation body is identical to today's.

**Alternatives considered**:
- *Work it out from the built collection items (`request.method`).* Rejected: it would sweep in
  the token-fetch POST, and it depends on the export format instead of the domain model.
- *Sort by path and method.* Rejected: it would reorder the existing response for no benefit.

## D7. Persistence and compatibility (FR-014, FR-015)

**Decision**: No migration. `executionRunRepository.ts` stores `results` as a JSON array (`JSON.parse`
on read, `JSON.stringify` on append), so the two new optional fields are saved with new results
and simply absent from old ones. `rawCapture` handling is unchanged, and the new fields contain no
raw data.

**Rationale**: Adding optional fields needs no schema change. Old rows are read by the same code
path.

## D8. Test approach

**Decision**:
- **Dependency and processing-stage behavior**: unit tests in `backend/tests/unit/execution/
  runExecution.test.ts`. They follow that file's existing pattern: a hand-built `ApiModel` and
  `TestModel`, a real `TargetServer` fixture, and `runExecution()` called directly, now with a
  `WorkflowExportContext` for an approved two-step workflow and a dependency graph for an
  automatic chain. The shared pet-store fixture used by `executionRuns.test.ts` is left unchanged.
- **Link construction**: unit tests for `generateExecutableCollection()` in
  `backend/tests/unit/postman/`. They check that the links are right for workflows, data chains,
  and credential chains (none), and that `generateCollection()` output is unchanged.
- **Stage mapping**: `mapNewmanResult.test.ts` is extended for every row of D5's table.
- **Confirmation**: `destructiveOperations.test.ts` is extended, including a GET-only approved
  model on `local`, where no confirmation is required. The two FR-007 tests in
  `executionRuns.test.ts` are re-checked against the pet-store fixture's approved scenarios.
- **Compatibility**: a repository-level test reads a stored result that lacks both new fields.

**Rationale**: This matches constitution XXI and `.claude/CLAUDE.md` §51–53. No test needs
network access beyond the local fixture server.
