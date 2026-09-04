# Feature Specification: API Dependency & Integration Workflow Engine

**Feature Branch**: `008-dependency-workflow-engine`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "AP-008 — API Dependency & Integration Workflow Engine"

## Clarifications

### Session 2026-09-04

- Q: What is the maximum acceptable time for dependency analysis and workflow assembly to finish
  over a 200-operation API model before the system must stop and report an explicit failure instead
  of continuing to run? → A: Under 15 seconds.
- Q: When more than one CONFIRMED or LIKELY relationship could supply the same consuming field, how
  should automatic workflow assembly pick which producer to use for that step? → A: Resolve to
  exactly one producer deterministically (strongest evidence, then a stable tie-break), while the
  full relationship graph continues to expose every candidate producer for review.
- Q: When deterministic matching and AI-assisted detection both identify the very same
  producer-to-consumer field relationship, should the system merge them into one reported
  relationship or keep two separate entries? → A: Merge into a single relationship, keeping the
  deterministic classification and evidence as primary and recording that AI corroborated it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover How My APIs Relate (Priority: P1)

As a QA engineer, I want ApiPilot to analyze my parsed API collection and tell me which
operations produce values that other operations consume, so I understand the real integration
shape of the system without manually cross-referencing every request and response schema.

**Why this priority**: Dependency discovery is the entire premise of this feature; without it
there is nothing to build a workflow from or review.

**Independent Test**: Supply an ApiModel containing operations such as `POST /users` (returning
`userId`) and `GET /users/{userId}` (accepting `userId`), request dependency analysis, and verify
the system reports a relationship between the two operations naming the producing response field,
the consuming request field, and a confidence classification.

**Acceptance Scenarios**:

1. **Given** an ApiModel with an operation whose response schema contains a field and a second
   operation whose parameter or request-body schema uses a matching field, **When** dependency
   analysis runs, **Then** the system reports a candidate relationship between the two operations
   naming the producing field, the consuming field, and its confidence classification.
2. **Given** two operations whose only similarity is that a response field and a request field
   share the same name, with no matching type, description, or endpoint-semantic evidence, **When**
   dependency analysis runs, **Then** the relationship is reported at a confidence no higher than
   POSSIBLE, never CONFIRMED or LIKELY.
3. **Given** an operation whose response schema and a later operation's request schema agree on
   field name, data type, and format, and whose paths share the same resource segment (e.g.
   `/users` and `/users/{userId}`), **When** dependency analysis runs, **Then** the relationship is
   reported at CONFIRMED or LIKELY confidence with the supporting evidence listed.
4. **Given** an ApiModel with no operations that share any candidate relationship, **When**
   dependency analysis runs, **Then** the system reports an explicit empty result rather than
   fabricating a relationship.
5. **Given** the same ApiModel is analyzed twice without modification, **When** the two results are
   compared, **Then** the reported relationships, their confidence classifications, and their
   supporting evidence are identical.

---

### User Story 2 - Turn Related APIs into a Runnable Sequence (Priority: P1)

As a QA engineer, I want ApiPilot to assemble a discovered chain of related operations (such as
create → read → update → delete) into an ordered, multi-step workflow with the request-to-response
value hand-offs made explicit, so I can test realistic integration scenarios instead of only
isolated single-operation requests.

**Why this priority**: Detected relationships only become testable integration coverage once they
are assembled into an executable step order; this is the feature's other half of core value and is
required by AP-007's deferred workflow-rendering seam (AP-007 FR-029).

**Independent Test**: Supply dependency relationships covering `POST /users` → `GET
/users/{userId}` → `PUT /users/{userId}` → `DELETE /users/{userId}`, request workflow generation,
and verify the resulting workflow orders the four steps consistently with the dependency direction,
names the variable each step extracts, and names where each later step consumes it.

**Acceptance Scenarios**:

1. **Given** a set of relationships that chain three or more operations through shared fields,
   **When** workflow generation runs, **Then** the system produces a workflow whose steps are
   ordered so that every step consuming a value appears after the step that produces it.
2. **Given** a generated workflow, **When** its steps are inspected, **Then** each hand-off between
   steps is represented as a named variable stating which step's response field populates it and
   which later step's request field consumes it.
3. **Given** relationships that would require a step to consume a value before any step produces
   it (a cycle or an unresolved dependency), **When** workflow generation runs, **Then** the system
   reports the case explicitly and does not produce a workflow that silently drops or reorders the
   conflicting step.
4. **Given** only CONFIRMED and LIKELY relationships are eligible for automatic workflow assembly,
   **When** workflow generation runs over a relationship set containing POSSIBLE relationships,
   **Then** the POSSIBLE relationships are excluded from the automatically assembled workflow and
   are reported separately as candidates requiring manual confirmation.
5. **Given** the same relationship set is used to generate a workflow twice, **When** the two
   workflows are compared, **Then** the step order, variable names, and hand-off mappings are
   identical.

---

### User Story 3 - Understand Why a Relationship or Workflow Was Suggested (Priority: P2)

As a QA engineer, I want every suggested dependency and workflow to come with an explanation of
the evidence behind it, so I can judge whether to trust it before it becomes part of my test
coverage.

**Why this priority**: Explainability is what allows a QA engineer to safely accept or reject a
suggestion; without it, dependency and workflow output is not meaningfully different from an
opaque guess, undermining adoption.

**Independent Test**: Request dependency analysis over an ApiModel that yields both a
deterministically evidenced relationship and an AI-suggested semantic relationship, then verify
each relationship's explanation names its evidence, states whether the relationship came from
deterministic matching or AI inference, and, for AI-derived relationships, states the confidence
score and rationale.

**Acceptance Scenarios**:

1. **Given** a relationship detected by deterministic field/schema matching, **When** its
   explanation is inspected, **Then** it names the specific evidence used (field name, type,
   format, endpoint-path relationship, or tag) and identifies its source as deterministic.
2. **Given** a relationship suggested only through AI semantic reasoning (e.g., an
   `accountRef` field that deterministic matching would not associate with `accountId`), **When**
   its explanation is inspected, **Then** it identifies its source as AI, states a confidence score
   and rationale, and is never presented as if it were confirmed specification information.
3. **Given** a relationship or workflow explanation, **When** it is displayed, **Then** it
   distinguishes deterministic evidence from AI inference so a reviewer never has to guess which
   applies.
4. **Given** an AI-suggested relationship that cannot be validated against the ApiModel (referring
   to a field or operation that does not exist), **When** dependency analysis completes, **Then**
   that suggestion is rejected or clearly surfaced as non-executable rather than included as a
   usable relationship.

---

### Edge Cases

- The ApiModel contains only one operation: dependency analysis completes and reports no
  relationships rather than failing.
- Two operations share a field name but the field represents genuinely unrelated data (e.g. `name`
  appearing on both a `User` and a `Product` schema with no other supporting evidence): the
  relationship is reported at POSSIBLE confidence at most, and is excluded from automatic workflow
  assembly.
- A response field is an object or array containing the identifier that a later request actually
  needs (e.g. `{ user: { id } }` rather than a top-level `id`): the analysis still detects the
  usable field to the extent the ApiModel's schema exposes it, and reports non-detection explicitly
  when the nesting cannot be resolved rather than guessing.
- A candidate relationship would connect two operations that also form a cycle (each depends on
  the other): the cycle is surfaced as an explicit finding, and no workflow that requires
  contradictory ordering is silently produced.
- The AI provider used for semantic dependency detection is unavailable: deterministic
  relationships are still produced, and the unavailability is reported rather than silently
  omitted or substituted with a fabricated relationship.
- The same field name recurs across many unrelated operations in a large ApiModel: relationships
  are still classified individually on their own evidence rather than assumed connected merely
  because the name matches elsewhere.
- A workflow candidate chain exceeds a reasonable number of steps: the system still produces a
  complete, correctly ordered workflow or reports an explicit failure, rather than truncating the
  chain silently.
- An operation appears more than once as a candidate step in overlapping chains (e.g. `GET
  /users/{userId}` is a valid next step for two different creation chains): each valid workflow is
  reported as its own candidate rather than merging them into one workflow that no longer reflects
  either chain accurately.
- Dependency analysis is requested for an ApiModel that carries specification analysis issues
  (from AP-002) on one of the involved operations: the analysis still runs on the resolvable
  information and reports the affected relationship as lower confidence or as a known limitation
  rather than silently ignoring the issue.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST analyze an ApiModel and identify candidate dependency relationships
  between operations, where one operation's response can plausibly supply a value consumed by
  another operation's parameters or request body.
- **FR-002**: The system MUST classify every detected relationship as CONFIRMED, LIKELY, or
  POSSIBLE, and MUST NOT omit the classification from any reported relationship.
- **FR-003**: The system MUST NOT classify a relationship as CONFIRMED or LIKELY based on field-name
  similarity alone; such classification MUST require corroborating evidence such as matching data
  type, format, endpoint-path/resource relationship, tag alignment, schema description similarity,
  or examples.
- **FR-004**: The system MUST support deterministic dependency detection based on field names,
  types, formats, path/resource structure, and other information already present in the ApiModel,
  independent of any AI provider.
- **FR-005**: The system MUST support AI-assisted semantic dependency detection, through the
  existing `AIProvider` abstraction, for relationships that deterministic matching cannot identify
  (e.g., semantically related fields with dissimilar names).
- **FR-006**: The system MUST record, for every relationship, whether it originated from
  deterministic matching or AI inference, and MUST NOT present an AI-derived relationship as
  confirmed specification information.
- **FR-006a**: When deterministic matching and AI-assisted detection both identify the same
  producer field-to-consumer field relationship, the system MUST merge them into a single reported
  relationship that keeps the deterministic classification and evidence as primary, and MUST record
  that the relationship was also corroborated by AI rather than listing two separate entries for the
  same field pair.
- **FR-007**: The system MUST record an explanation for every relationship stating the specific
  evidence considered (for deterministic relationships) or the model, confidence score, and
  rationale (for AI-derived relationships).
- **FR-008**: The system MUST reject or explicitly surface as non-executable any AI-suggested
  relationship that references a field or operation not present in the ApiModel.
- **FR-009**: The system MUST report an explicit empty result, rather than an apparently successful
  analysis with no explanation, when no relationships are found.
- **FR-010**: The system MUST produce identical relationship results, including confidence
  classifications and evidence, when the same ApiModel is analyzed repeatedly without modification.
- **FR-011**: The system MUST assemble ordered, multi-step integration workflows from relationships
  it classifies at CONFIRMED or LIKELY confidence, and MUST exclude POSSIBLE relationships from
  automatic workflow assembly.
- **FR-012**: The system MUST report POSSIBLE relationships that could extend or form a workflow as
  separate candidates requiring explicit human confirmation, rather than silently discarding them.
- **FR-013**: The system MUST order every generated workflow's steps so that a step consuming a
  value never precedes the step that produces it.
- **FR-013a**: When a consuming field could be satisfied by more than one CONFIRMED/LIKELY
  relationship, the system MUST deterministically resolve automatic workflow assembly to exactly
  one producer for that step, using a documented, stable tie-break (e.g. strongest supporting
  evidence, then a consistent ordering rule), and MUST NOT vary the chosen producer across repeated
  runs of the same input. The excluded candidate producer(s) MUST remain visible in the dependency
  graph for manual review rather than being discarded.
- **FR-014**: The system MUST detect cyclical or otherwise unresolvable ordering among candidate
  relationships and MUST report such cases explicitly instead of producing a workflow with
  contradictory step ordering.
- **FR-015**: The system MUST represent each inter-step hand-off in a generated workflow as a named
  workflow variable identifying the producing step's response field and the consuming step's
  request location and field.
- **FR-016**: The system MUST produce identical workflows, including step order, variable names, and
  hand-off mappings, when the same relationship set is used to generate a workflow repeatedly.
- **FR-017**: The system MUST express dependency and workflow output using ApiModel-level domain
  concepts (operations, fields) and MUST NOT depend on or reference Postman-specific structures.
- **FR-018**: The system MUST continue to produce deterministic relationships and report the
  condition explicitly, rather than failing the entire analysis, when the AI provider used for
  semantic detection is unavailable.
- **FR-019**: The system MUST NOT execute any API operation, or contact any API described by the
  ApiModel, while performing dependency analysis or workflow generation.
- **FR-020**: The system MUST keep specification content and any AI prompts/responses used during
  dependency analysis out of diagnostic output beyond what is needed to report an error category.
- **FR-021**: The system MUST allow a reviewer to inspect a generated workflow's steps, hand-offs,
  and the relationships that produced it before that workflow is treated as approved integration
  test intent.
- **FR-022**: The system MUST preserve enough provenance on each relationship and workflow step to
  trace it back to the ApiModel operations and evidence that produced it.

### Key Entities

- **API Dependency Relationship**: A candidate connection between one operation's response field
  and another operation's request field, carrying a confidence classification (CONFIRMED, LIKELY,
  POSSIBLE), a source (deterministic or AI), supporting evidence or AI rationale, and a reference to
  both operations and fields involved.
- **API Dependency Graph**: The complete set of relationships discovered across an ApiModel's
  operations, from which candidate workflows are assembled.
- **Integration Workflow**: An ordered sequence of operation steps assembled from CONFIRMED/LIKELY
  relationships, where each step after the first may consume one or more values produced by an
  earlier step.
- **Workflow Step**: One operation's participation in a workflow, identifying the operation, its
  position in the sequence, and which workflow variables it produces or consumes.
- **Workflow Variable**: A named hand-off value passed between workflow steps, identifying the
  producing step's response field and the consuming step's request location and field.
- **Dependency Evidence**: The recorded justification for a relationship's confidence
  classification — matching field/type/format information for deterministic relationships, or
  model/confidence/rationale for AI-derived relationships. When both deterministic matching and AI
  inference independently identify the same relationship, the deterministic evidence remains primary
  and the AI corroboration (model, confidence, rationale) is recorded alongside it on the same
  relationship rather than on a separate one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In evaluation with representative multi-operation specifications, at least 90% of
  known create-then-use relationships (e.g. `POST` returning an identifier consumed by a later
  `GET`/`PUT`/`DELETE` on the same resource) are detected at CONFIRMED or LIKELY confidence.
- **SC-002**: 0% of relationships in evaluation are classified CONFIRMED or LIKELY on field-name
  similarity alone with no corroborating evidence.
- **SC-003**: Analyzing the same ApiModel repeatedly produces identical relationship and workflow
  output in 100% of repeated runs.
- **SC-004**: 100% of reported relationships carry an explanation identifying whether they are
  deterministic or AI-derived, with the corresponding evidence or rationale present.
- **SC-005**: 100% of automatically assembled workflows contain zero steps that consume a value
  before it has been produced by an earlier step.
- **SC-006**: In evaluation with a representative create → read → update → delete chain, the
  generated workflow reconstructs the expected step order and hand-offs in at least 95% of cases.
- **SC-007**: A QA engineer reviewing a generated workflow can identify, within 30 seconds, which
  relationships produced it and what evidence supports each hand-off.
- **SC-008**: An ApiModel of 200 operations completes dependency analysis and workflow assembly in
  under 15 seconds, or fails explicitly rather than returning a partial result presented as
  complete.
- **SC-009**: No dependency analysis or workflow generation run issues a network request to any API
  described by the ApiModel.

## Assumptions

- This feature consumes only the ApiModel produced by AP-002; it neither reads nor modifies the
  TestModel produced by AP-003, and introduces new dependency/workflow domain concepts rather than
  extending either existing contract.
- AI-assisted semantic dependency detection uses the `AIProvider` abstraction established by AP-004,
  under the same local-first, no-silent-cloud-fallback constraints as other AI-dependent features;
  it is exercised through the mock provider in automated tests.
- Following the review pattern established by AP-006, human confirmation of POSSIBLE relationships
  and review/approval of generated workflows as executable test intent is expected but is delivered
  through the existing/extended review capability rather than reimplemented here; this feature is
  responsible for producing correctly classified relationships and correctly ordered workflow
  candidates for that review to act on.
- Workflow output is structured so that AP-007's collection generator can later render it as an
  ordered request sequence with variable hand-offs, per the seam AP-007 already defines (its FR-029
  and FR-030); this feature does not itself generate Postman or any other artifact-specific output.
- Resource-relationship evidence (e.g., recognizing `/users` and `/users/{userId}` as the same
  resource) relies on path structure already present in the ApiModel; no new OpenAPI extraction
  capability is introduced.
- A reasonable default limit on workflow chain length and analysis scope is an implementation detail
  for the technical plan, informed by the performance target in SC-008.

## Out of Scope

- Generating Postman, Playwright, Serenity/JS, or any other executable artifact from a workflow;
  that remains the responsibility of artifact-specific generators (AP-007 and future generators).
- Reviewing, approving, rejecting, or editing relationships and workflows as a user-facing
  experience; this feature produces the relationships and workflow candidates that a review
  capability (AP-006 or its extension) acts upon.
- Executing any generated workflow or reporting execution results (AP-010, AP-011).
- Modifying the ApiModel or TestModel contracts produced by AP-002 and AP-003.
- Detecting dependencies that require information outside the parsed specification, such as runtime
  API behavior, live response sampling, or external documentation.
