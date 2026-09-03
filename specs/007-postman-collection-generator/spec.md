# Feature Specification: Postman Collection Generator

**Feature Branch**: `007-postman-collection-generator`

**Created**: 2026-09-03

**Status**: Draft

**Input**: User description: "AP-007 — Postman Collection Generator"

## Clarifications

### Session 2026-09-03

- Q: Does AP-007 render multi-step workflow requests and chain extracted response values into
  variables, given that AP-008 (which defines API relationships and workflows) has not been built?
  → A: Deferred with a documented seam. AP-007 exports single-operation scenarios only. The
  specification states the required workflow-rendering behavior (ordered request sequences with
  response-value extraction into variables) so AP-008 has a defined target, but no workflow contract
  is invented and no workflow rendering is implemented here. See FR-028 through FR-030.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Export an Executable Collection (Priority: P1)

As a QA engineer, I want to export the test scenarios I approved during review as an executable
Postman collection, so I can run the agreed test intent in the tool my team already uses instead
of rebuilding each request by hand.

**Why this priority**: Producing a runnable artifact from approved test intent is the entire
purpose of this feature; nothing else in it delivers value without this.

**Independent Test**: Supply an approved test set covering several API operations, request an
export, and verify that the resulting collection contains one runnable request per approved
scenario with the correct method, path, path/query parameters, headers, and body, organized so a
reviewer can locate any scenario without reading the raw file.

**Acceptance Scenarios**:

1. **Given** an approved test set covering multiple API operations, **When** the engineer requests
   a collection export, **Then** a collection artifact is produced containing exactly one request
   per approved scenario, and no request for a scenario that was not approved.
2. **Given** an approved scenario targeting an operation with path parameters, query parameters,
   headers, and a request body, **When** the collection is produced, **Then** each of those inputs
   appears in the generated request exactly as the approved scenario defined it, with path
   parameters substituted into the request address.
3. **Given** approved scenarios spanning several API groupings, **When** the collection is produced,
   **Then** the requests are organized into folders that let an engineer locate the scenarios for a
   given operation, and each request name states the operation and the scenario's purpose.
4. **Given** an approved scenario carries expected-response assertions, **When** the collection is
   produced, **Then** the request includes executable checks for exactly those assertions and adds
   no expected status code, schema, or other assertion that the approved scenario did not carry.
5. **Given** the same approved test set is exported twice, **When** the two collection artifacts are
   compared, **Then** they are identical.

---

### User Story 2 - Run Without Embedding Secrets (Priority: P1)

As a QA engineer, I want the exported artifacts to reference a base address and credentials as
named variables I fill in myself, so I can share the collection with my team and run it against
different environments without leaking secrets.

**Why this priority**: An exported artifact that hard-codes a host or a credential is unsafe to
share and unusable outside one machine, which would make the export practically worthless.

**Independent Test**: Export from an approved test set whose operations declare authentication,
then verify the collection addresses every request through a base-address variable, configures
authentication through named variables, and that the companion environment artifact lists those
variables with no real credential values in it.

**Acceptance Scenarios**:

1. **Given** any approved test set, **When** the artifacts are produced, **Then** every request
   address is expressed through a base-address variable rather than a literal host, and the
   environment artifact declares that variable.
2. **Given** operations that declare an authentication requirement, **When** the artifacts are
   produced, **Then** authentication is configured using named credential variables and the
   environment artifact declares those variables with empty values.
3. **Given** the engineer supplies a base address and credential values when requesting the export,
   **When** the artifacts are produced, **Then** those values are placed only in the environment
   artifact, are marked as sensitive where they represent credentials, and are never written into
   the collection artifact.
4. **Given** no base address or credential values are supplied, **When** the artifacts are produced,
   **Then** the environment artifact still declares every variable the collection needs, with empty
   values and guidance on what to provide, and the export does not invent a host or a credential.
5. **Given** an approved scenario's request data contains a value that the system recognizes as a
   credential, **When** the artifacts are produced, **Then** that value is replaced by a variable
   reference rather than written literally into the collection.

---

### User Story 3 - Trust and Understand the Artifact (Priority: P2)

As a QA engineer, I want the export to be checked before I receive it and to arrive with a written
summary of what it contains and what it does not, so I can hand it to my team knowing its coverage
and its limits.

**Why this priority**: Engineers will not adopt a generated suite they cannot explain; a validated,
documented artifact is what makes the export reviewable rather than merely produced.

**Independent Test**: Export from an approved test set that includes scenarios with no documented
expected response and operations flagged with analysis issues, then verify the export is validated
before delivery and that the accompanying document states the coverage, the required variables, and
each known limitation.

**Acceptance Scenarios**:

1. **Given** an export has been produced, **When** it is delivered, **Then** it has been checked
   against the expected collection format and the check result is reported to the engineer.
2. **Given** the produced collection fails that check, **When** the export completes, **Then** the
   engineer receives an explicit failure describing what was wrong, and an invalid artifact is not
   presented as a successful export.
3. **Given** an export has been produced, **When** the engineer opens the accompanying document,
   **Then** it states how many requests were generated, how they are organized, which variables must
   be supplied before running, and how to run the collection.
4. **Given** approved scenarios whose origin includes rule-derived and AI-derived test intent,
   **When** the accompanying document is produced, **Then** it reports the counts by origin so the
   engineer can see how much of the suite came from inference rather than the specification.
5. **Given** approved scenarios that carry no expected-response assertion, or operations that
   carried analysis issues, **When** the accompanying document is produced, **Then** those cases are
   listed as known limitations rather than omitted or silently assigned an expected outcome.

---

### User Story 4 - Re-export After Further Review (Priority: P3)

As a QA engineer, I want to re-export after changing my review decisions and see only the changes I
intended, so I can maintain the collection over time instead of regenerating an unrecognizable file
on every run.

**Why this priority**: Valuable for ongoing maintenance, but the first export already delivers the
core value; this refines the workflow rather than enabling it.

**Independent Test**: Export an approved test set, change one review decision, re-export, and verify
that the difference between the two artifacts is limited to the affected scenario.

**Acceptance Scenarios**:

1. **Given** a collection has been exported, **When** the engineer rejects one previously approved
   scenario and re-exports, **Then** the new collection differs from the previous one only by the
   removal of that scenario's request.
2. **Given** a collection has been exported, **When** the engineer re-exports with no review changes,
   **Then** the new artifacts are identical to the previous ones, including the ordering of folders,
   requests, and variables.
3. **Given** the engineer previously supplied environment values, **When** re-exporting, **Then** the
   set of declared variables remains stable for unchanged scenarios so an existing filled-in
   environment continues to work.

---

### Edge Cases

- The approved test set is empty because every scenario was rejected or none was reviewed: the
  export reports an explicit empty-result outcome rather than delivering an empty collection that
  appears successful.
- The supplied test set contains scenarios that are pending or rejected: those scenarios are
  excluded, and the export never treats an unreviewed scenario as approved.
- An approved scenario carries no assertions because the specification documented no response for
  that case: the request is still generated, no expected outcome is fabricated, and the omission is
  reported as a known limitation.
- An operation declares no grouping information: requests are placed in a deterministic fallback
  grouping rather than scattered or dropped.
- Two operations share a grouping name, or a grouping name contains characters that are awkward in a
  folder label: naming is made unique and safe deterministically, and the mapping remains
  understandable.
- Two approved scenarios would produce identically named requests: names are disambiguated
  deterministically so every request remains individually identifiable.
- An approved scenario deliberately violates the schema (a negative case) so its body is not valid
  against the documented request schema: the invalid body is preserved exactly as approved, because
  that violation is the test intent.
- An approved scenario's request body uses a content type that the collection format cannot express
  as structured data: the export either represents it faithfully or reports it as an unsupported
  case, and does not silently convert it to a different content type.
- An operation declares multiple alternative authentication requirements: the export applies a
  deterministic, documented choice and records which requirement it used.
- An operation declares an authentication scheme type the export cannot configure: the request is
  still generated, the gap is reported as a known limitation, and no substitute credential
  mechanism is invented.
- A path parameter has no approved value: the export surfaces the missing value as a variable to be
  supplied rather than emitting a malformed address.
- The approved test set is very large: the export completes within the stated performance target or
  fails explicitly, rather than producing a partial artifact presented as complete.
- The export is requested twice concurrently for the same approved test set: both requests produce
  identical artifacts and neither corrupts the other's output.
- An approved test set carries multi-step workflow intent before workflow rendering is implemented:
  the export reports that case explicitly rather than exporting the steps as unrelated single
  requests and implying the chaining was preserved.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST generate an executable collection artifact, an environment artifact,
  and a human-readable accompanying document from an approved test set.
- **FR-002**: The system MUST include exactly one runnable request per approved scenario and MUST
  exclude every scenario that is pending, rejected, or otherwise not approved.
- **FR-003**: The system MUST reproduce each approved scenario's request method, path, path
  parameters, query parameters, headers, and body exactly as approved, including deliberately
  invalid values used by negative scenarios.
- **FR-004**: The system MUST organize generated requests into a navigable folder structure derived
  deterministically from the API's own grouping information, with a deterministic fallback when
  grouping information is absent.
- **FR-005**: The system MUST name every folder and request so that the operation and the scenario's
  purpose are identifiable without opening the request, and MUST disambiguate colliding names
  deterministically.
- **FR-006**: The system MUST translate each approved assertion into an executable check in the
  generated request, and MUST NOT add an expected status code, schema check, or other assertion that
  the approved scenario did not carry.
- **FR-007**: The system MUST generate a request with no fabricated expected outcome when an approved
  scenario carries no assertions, and MUST record that case as a known limitation in the accompanying
  document.
- **FR-008**: The system MUST address every generated request through a base-address variable and
  MUST NOT embed a literal host derived from anywhere other than an explicitly supplied value.
- **FR-009**: The system MUST configure authentication for operations that declare it using named
  credential variables, MUST record which declared requirement it applied, and MUST NOT invent an
  authentication mechanism that the specification does not declare.
- **FR-010**: The system MUST declare, in the environment artifact, every variable the collection
  references, including its purpose and whether it holds a credential.
- **FR-011**: The system MUST NOT write credential values into the collection artifact, and MUST
  place any user-supplied credential values only in the environment artifact, marked as sensitive.
- **FR-012**: The system MUST default credential and base-address variables to empty values when the
  user supplies none, and MUST NOT substitute a guessed host, token, or identifier.
- **FR-013**: The system MUST replace values it recognizes as credentials in approved request data
  with variable references rather than writing them literally into the collection.
- **FR-014**: The system MUST validate the generated collection against the expected collection
  format before delivering it, and MUST report the validation result.
- **FR-015**: The system MUST fail explicitly, with a description of the problem, when validation
  fails, and MUST NOT deliver an invalid artifact as a successful export.
- **FR-016**: The system MUST produce an accompanying document stating the request count, the folder
  organization, the variables that must be supplied before running, how to run the collection, and
  the counts of approved scenarios by origin.
- **FR-017**: The system MUST list known limitations in the accompanying document, including
  scenarios with no expected outcome, unsupported authentication schemes, unsupported request content
  types, and operations that carried specification analysis issues.
- **FR-018**: The system MUST produce identical artifacts for identical approved input, including
  stable ordering of folders, requests, checks, and variables.
- **FR-019**: The system MUST NOT use AI inference at any point in generating, naming, organizing,
  validating, or documenting the artifacts.
- **FR-020**: The system MUST return an explicit empty-result outcome, rather than an apparently
  successful export, when the approved test set contains no scenarios.
- **FR-021**: The system MUST report an unsupported case explicitly when an approved scenario cannot
  be faithfully expressed in the collection format, and MUST NOT silently alter the scenario's test
  intent to make it expressible.
- **FR-022**: The system MUST allow the engineer to obtain all three artifacts from a single export
  action.
- **FR-023**: The system MUST NOT execute any generated request, contact any API described by the
  specification, or treat producing an artifact as authorization to run it.
- **FR-024**: The system MUST NOT retain the generated artifacts, the approved test set, or supplied
  credential values beyond what the export itself requires.
- **FR-025**: The system MUST keep specification content, request payloads, and credential values out
  of diagnostic output produced during export.
- **FR-026**: The system MUST preserve each scenario's origin information in the export so that a
  generated request can be traced back to the approved scenario and its origin.
- **FR-027**: The system MUST expose loading, success, empty, and failure states for the export
  action, including recovery guidance when an export fails.
- **FR-028**: The system MUST export single-operation scenarios only in this feature, and MUST NOT
  define, infer, or invent multi-step relationships between operations.
- **FR-029**: The system MUST be specified so that, when an approved test set later carries
  multi-step workflow intent supplied by the dependency and workflow feature (AP-008), the export
  renders that workflow as an ordered request sequence in which a value extracted from one response
  is stored in a named variable and referenced by a later request in the same sequence. Implementing
  that rendering is deferred until AP-008 supplies the workflow contract.
- **FR-030**: The system MUST reject or explicitly report, rather than silently ignore, an approved
  test set that carries multi-step workflow intent before that rendering is implemented.

### Key Entities

- **Approved Test Set**: The reviewed, human-approved test intent supplied to the export, consisting
  of approved scenarios with their requests, assertions, and origin information.
- **Collection Artifact**: The executable output containing the folder structure, requests, and
  assertion checks derived from the approved test set.
- **Environment Artifact**: The companion output declaring every variable the collection references,
  its purpose, whether it is a credential, and its value if the engineer supplied one.
- **Artifact Variable**: A named placeholder used in place of a literal address, credential, or
  supplied identifier, with a purpose, a sensitivity marking, and an optional value.
- **Artifact Document**: The human-readable summary describing coverage, organization, required
  variables, how to run the collection, and known limitations.
- **Validation Report**: The outcome of checking the produced collection against the expected format,
  including whether it passed and what failed.
- **Generation Limitation**: A recorded case where the export could not fully express approved test
  intent — a missing expected outcome, an unsupported authentication scheme, an unsupported content
  type, or an operation carrying analysis issues.
- **Export Request**: One engineer-initiated export, carrying the approved test set and any supplied
  base address or variable values.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of approved scenarios appear as exactly one runnable request in the exported
  collection, and 0% of pending or rejected scenarios appear in it.
- **SC-002**: Exporting the same approved test set repeatedly produces identical artifacts in 100% of
  repeated runs.
- **SC-003**: 0% of exported collections contain a literal host or a credential value; every such
  value is expressed as a variable declared in the environment artifact.
- **SC-004**: In credential-focused evaluation cases, no deliberately marked secret appears in the
  collection artifact, the accompanying document, or export diagnostics.
- **SC-005**: 100% of assertion checks in the exported collection correspond to an assertion carried
  by the approved scenario, with zero fabricated expected status codes or schema checks.
- **SC-006**: 100% of exported collections are validated against the expected collection format
  before delivery, and 100% of validation failures are reported as failed exports.
- **SC-007**: A QA engineer can import the exported collection and environment into a standard
  collection runner and execute the suite after supplying only the variables the accompanying
  document lists, with no manual edits to the collection.
- **SC-008**: In evaluation with representative specifications, at least 90% of engineers can locate
  the requests for a chosen API operation within 30 seconds of opening the collection.
- **SC-009**: 100% of approved scenarios lacking an expected outcome, unsupported authentication
  schemes, and unsupported request content types are listed as known limitations rather than
  silently omitted or filled in.
- **SC-010**: An approved test set of 500 scenarios exports in under 10 seconds, or fails explicitly
  rather than delivering a partial artifact.
- **SC-011**: 100% of generated requests can be traced back to the approved scenario and origin they
  came from.
- **SC-012**: No export run issues a network request to any API described by the specification.

## Assumptions

- The approved test set comes from the human review stage (AP-006) and already reflects the review
  policy; this feature performs no review, no scenario generation, and no approval of its own.
- The approved test set uses the existing framework-independent test model; this feature converts
  that model into an executable artifact and does not extend or replace it as the core domain.
- The parsed specification carries no server address, so the base address is always a variable the
  engineer supplies at export time or fills into the environment artifact afterwards.
- The export runs on demand and its outputs are delivered to the engineer for download rather than
  stored by the platform, consistent with the project's non-persistent processing model.
- Following the pattern established by earlier features, this feature covers both the generation
  capability and the user-facing export action needed to obtain the artifacts; the end-to-end journey
  that chains upload through export is assembled later (AP-009).
- Assertion checks are limited to the assertion types the approved test model already carries;
  richer assertion styles are only added when the test model itself gains them.
- Variable naming follows the project's established placeholder convention (a base-address variable
  plus credential and identifier variables) so that artifacts from different exports remain familiar.
- The collection targets a current, widely supported version of the collection format; the exact
  version is an implementation decision for the technical plan.

## Out of Scope

- Executing the generated collection, reporting run results, or analyzing failures (AP-010, AP-011).
- Inferring API dependencies or deciding which operations relate to each other (AP-008).
- Implementing multi-step workflow rendering and response-value chaining; FR-029 states the required
  behavior as a target, but the implementation waits on the AP-008 workflow contract.
- Generating artifacts for other test frameworks such as Playwright or Serenity/JS; the test model
  must remain capable of supporting them, but no other generator is built here.
- Reviewing, editing, regenerating, or approving scenarios (AP-006).
- Any AI inference, including AI-assisted naming, organization, or documentation of the artifact.
- Storing, versioning, or synchronizing exported artifacts, or publishing them to a hosted workspace.
- Editing the API specification or the approved test model as part of export.
