# Phase 0 Research: Automatic Workflow Chaining for Postman Export

All Technical Context fields were resolved directly from the existing codebase and constitution;
no NEEDS CLARIFICATION markers remained after `/speckit.clarify`. This document instead records the
architecture decisions made while reading the existing `backend/src/postman/`,
`backend/src/dependencies/`, and `packages/shared-domain` implementations, each of which had a
real, non-obvious alternative.

## D1 — Insertion point: a new pass over standalone scenarios, not a change to workflow rendering

**Decision**: Add automatic chaining as a new function, `planAutomaticChains`, called from
`generateCollection.ts` immediately after `planApprovedWorkflows()` computes `renderedScenarioIds`
and the `standaloneResolved` list (the scenarios not already covered by an approved
`IntegrationWorkflow`), and before the standalone `buildRequestItem` loop. Its output is the same
`standaloneResolved` scenario list with eligible path parameters already substituted to
`{{chainVar}}`, plus a set of extraction scripts to attach to producer items and a list of chain
provenance entries for the summary/README.

**Rationale**: `buildUrl` (`requestItem.ts`) already treats any path parameter whose value is a
pre-populated string (including `{{...}}`) as resolved — it never distinguishes "a human filled
this in" from "the workflow substitution filled this in." So the smallest correct change is to
perform the substitution earlier in the pipeline, exactly where `applyWorkflowSubstitutions` does
it for approved workflows today, rather than teaching `buildUrl` a second, dependency-graph-aware
code path.

**Alternatives considered**:
- *Modify `buildUrl` to consult the dependency graph directly.* Rejected: this would duplicate the
  substitution logic that `applyWorkflowSubstitutions` already implements and tested, and would
  entangle a request-building function with dependency-graph traversal — a Separation of Concerns
  (constitution IX) violation.

## D2 — Reuse the existing leaf rendering primitives unmodified

**Decision**: Reuse `applyWorkflowSubstitutions(scenario, chainId, variables)`,
`workflowVariableName(chainId, variableName)`, and `appendWorkflowExtractions(event, extractions)`
exactly as they exist today. None of the three requires an approved `IntegrationWorkflow` or a
`WorkflowStep` — they only need a `chainId` string and a plain `WorkflowVariable`/
`WorkflowExtraction` value, which this feature can synthesize directly from an
`ApiDependencyRelationship` without constructing a fake `IntegrationWorkflow`.

**Rationale**: These functions are already unit-tested, already handle collision-safe naming and
JSON-path extraction, and are the exact mechanism spec 016 already established for chained
rendering. Reusing them verbatim is what "reuses the existing chained-rendering mechanics" (the
spec's own Assumption) means concretely, and satisfies "Prefer Simple Architecture" (constitution
XXVII).

**Alternatives considered**:
- *Write parallel extraction/substitution helpers scoped to "automatic" chains.* Rejected: pure
  duplication of tested logic for no behavioral benefit.

## D3 — Do not reuse full multi-step `IntegrationWorkflow` rendering (`planWorkflow`)

**Decision**: Automatic chaining does **not** feed candidate workflows from
`dependencyAnalysis.workflows` through the existing `planApprovedWorkflows`/`planWorkflow`
pipeline by default-approving them. It instead works one relationship at a time, directly against
`ApiDependencyGraph.relationships`.

**Rationale**: `planWorkflow`'s existing contract (016 FR-008) is all-or-nothing per workflow: if
any one step in a multi-step candidate workflow lacks approved scenario data, the *entire* workflow
is reported as one `workflow-unsupported-*` limitation and none of its steps are chained — correct
for a human-approved narrative, where the human already saw and accepted the whole sequence, but
wrong for this feature's goal. Under automatic-by-default eligibility, most multi-step candidate
workflows across a real API will have at least one step without an approved scenario (approving
every scenario for every operation in a 5-step candidate chain is unlikely), so reusing
`planWorkflow` wholesale would silently convert what should be several small, independently
resolvable per-parameter successes into one large "unsupported" limitation — a regression in
outcome granularity relative to today's per-parameter `unresolved-path-parameter` reporting, and
directly at odds with FR-001's "for every unresolved path parameter" framing and FR-014's
requirement to leave unaffected parameters' reporting unchanged.

**Alternatives considered**:
- *Treat "not rejected" as "approved" and pass that id set into `planApprovedWorkflows` unchanged.*
  Considered first; rejected for the all-or-nothing reason above, plus it would need `planWorkflow`
  to be relaxed to tolerate partial step coverage — a change to an existing, spec-016-governed
  function's contract rather than an additive extension.

## D4 — Grouping and producer reuse

**Decision**: Group eligible relationships by producer `(operationPath, operationMethod, field)`.
Emit exactly one `pm.environment.set` extraction per group, attached to that producer's single
rendered request item; every consumer in the group substitutes the same variable name (satisfies
FR-009).

**Rationale**: A real producer operation (e.g. `GET /orders`) commonly feeds several consumers
(`GET/PATCH/DELETE /orders/{id}`); capturing the value once and reusing it avoids redundant
`pm.environment.set` calls and keeps the environment/summary output stable and readable.

## D5 — Producer scenario selection: positive-outcome scenarios only

**Decision**: When an operation has more than one approved scenario, only its approved
positive-outcome scenario is eligible as an automatic-chain producer (spec FR-017).

**Rationale**: Approved-workflow rendering lets a human pick any approved scenario — including a
deliberately invalid one — as a workflow step, because a human explicitly reviewed and accepted
that choice (016 Edge Cases: "a workflow contains a negative scenario... the request remains
unchanged because the approved test intent takes precedence"). Automatic chaining has no such human
confirmation step, so extracting an identifier from a scenario engineered to *fail* would be an
unreviewed guess about what that response actually contains — exactly what constitution XIV/XIX
forbid. Restricting the producer side to the positive-outcome scenario is the conservative default
consistent with "low-risk cases" in the original request.

## D6 — Ordering guard: never reorder the collection to make a chain work

**Decision**: A relationship is eligible only when the producer's item is already ordered before
the consumer's item under the existing, unmodified `compareRequestSortKeys`
(`path, method, category, scenarioId`, all code-unit comparison) — see `ordering.ts`. When it is
not, the pair is skipped and the parameter falls back to the existing unresolved-path-parameter
limitation (spec FR-015).

**Rationale**: Postman's collection runner executes items in their stored order; a
`pm.environment.set` in a later item cannot retroactively populate an earlier item's request. In
the overwhelming majority of real relationships, the producer's path is a literal prefix of the
consumer's path (`/orders` before `/orders/{id}`, `/users` before `/users/{id}/posts`) — precisely
the "resource relationship" signal 008 already weighs as strong evidence — so this guard rarely
excludes a real relationship. Reordering the collection instead was considered and rejected: it
would silently change output for every other request in the same folder, undermining the existing,
separately-tested deterministic ordering guarantees (spec 007/016) for a benefit that only applies
to the rare cross-resource case, and would make an already-complex ordering rule (path, method,
category, scenario id) conditional on chaining decisions — a Simple Architecture (XXVII) violation
for a narrow gain. Declining to chain in that rare case is a smaller, safer, and more explainable
behavior: it never produces a chain that looks wired but does not actually work at Postman runtime
(which XIX would treat as worse than today's honest blank variable).

**Alternatives considered**:
- *Add a topological reordering pass on top of the lexicographic sort.* Rejected per rationale
  above — the risk/complexity is disproportionate to the rare case it would fix, and the spec
  explicitly bounds this feature to "clear, deterministic, low-risk cases."

## D7 — Respect explicit workflow rejections

**Decision**: Compute the set of relationship ids belonging to any `IntegrationWorkflow` in
`dependencyAnalysis.workflows` whose `workflowDecisions[id].state === "rejected"`
(`packages/shared-domain/src/testGenerationWorkflow.ts`), and exclude every such relationship id
from automatic chaining, regardless of its own confidence (spec FR-016).

**Rationale**: `workflowDecisions` already distinguishes `"pending"` (no human decision yet — this
feature is exactly what fills that gap for CONFIRMED/LIKELY cases) from `"rejected"` (a human
explicitly said no). Only the former is fair game for automatic behavior; automating over an
explicit rejection would violate Human-in-the-Loop (constitution XI) even though XV separately
permits automatic promotion of confident relationships in the absence of a contrary human decision.

## D8 — Scope: single-hop relationships only

**Decision**: Automatic chaining renders only direct relationships — one producer field to one
consumer field — never a transitive chain across more than one relationship (spec FR-018).

**Rationale**: Multi-hop assembly (ordering three or more steps, resolving which producer feeds
which downstream consumer through an intermediate step) is exactly the problem `assembleWorkflows`
already solves for human-reviewed workflows. Re-deriving it here would duplicate tested logic
(XXVII) and reintroduce the D3 all-or-nothing granularity problem one level down. Single-hop
coverage already addresses the dominant real-world case this feature targets (a list/create
endpoint's identifier consumed directly by a read/update/delete endpoint on the same resource).

## D9 — Contract shape: one additive, optional context object

**Decision**: Add one new optional field to `WorkflowExportContext`:

```ts
automaticChaining?: {
  graph: ApiDependencyGraph;
  cycles: DependencyCycleFinding[];
  workflowDecisions: Record<string, WorkflowReviewDecision>;
};
```

and one new optional field to `ExportOptions`: `disableAutomaticChaining?: boolean` (default/absent
= automatic chaining enabled, per the clarified "fully automatic by default" decision; `true`
reverts to today's approved-workflow-only behavior for that export).

**Rationale**: Both existing types (`WorkflowExportContext`, `ExportOptions`,
`packages/shared-domain/src/postmanArtifact.ts`) are already the established seam for
export-time input; adding optional fields is backward compatible for every existing caller
(`postmanGenerationStage.ts` and the direct `POST /api/test-models/postman-collection` contract)
and requires no change to callers that never populate them. Nesting the three pieces of dependency
context under one `automaticChaining` object (rather than three loose top-level fields) keeps the
"this export has automatic-chaining context" check to a single presence test and keeps the
unrelated fields of `WorkflowExportContext` unchanged.
