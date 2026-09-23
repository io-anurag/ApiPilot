# Feature Specification: Test Execution Gap Closure

**Feature Branch**: `[029-execution-gap-closure]`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: "Test Execution Gap Closure for AP-017 (specs/018-test-execution-results). A hardening feature on top of AP-017's generated-collection execution path, closing three gaps a convergence assessment found between specs/018's spec and the shipped code: FR-018 dependency-not-met is never produced; FR-016 processing stage is not recorded; FR-007's destructive-request confirmation is computed from the whole specification rather than the approved collection."

**Product identifier**: `AP-030` (proposed). `specs/ROADMAP.md` already assigns `AP-029` to k6
Performance Testing, so this directory's number (`029`) and its product identifier differ, the
same numbering divergence `specs/017-session-workflow-isolation` and
`specs/018-test-execution-results` already record. `AP-030` is the next free identifier; it is
not yet recorded in `specs/ROADMAP.md`.

## Clarifications

### Session 2026-09-23

- Q: Value hand-offs come from three sources: user-approved workflows (AP-016), automatic
  workflow chaining (AP-019), and automatic auth-credential chaining (AP-023). Which of them count
  as dependencies for withholding a request? → A: AP-016 and AP-019 data hand-offs only. AP-023
  credential hand-offs are not enforced; their dependents are still sent and fail visibly,
  consistent with `specs/024` FR-004b for OAuth2 tokens, so an authentication failure remains
  its own visible signal (FR-006, FR-007).
- Q: Should an earlier request that got a response but failed a check (for example, a 201 whose
  body does not match the documented schema) stop the requests that depend on it from being
  sent? → A: No. Dependents are held back only when the earlier request was not sent, got no
  response, returned an unexpected status, or its checks could not be evaluated. A schema
  mismatch on its own does not hold back dependents (FR-001).
- Q: Should the OAuth2 token request ApiPilot adds to a collection (a POST to the token URL)
  count as a destructive request when deciding whether a run needs the extra confirmation? → A:
  No. Only requests for approved scenarios are judged by HTTP method. The token request is
  never counted or listed (FR-010).

## Relationship to Existing Specifications

This feature hardens AP-017 (`specs/018-test-execution-results`) rather than adding a new
capability, the same way AP-019 through AP-025 layered onto it. Each requirement below restates
an existing `specs/018` requirement that the shipped implementation satisfies only partly or not
at all, as found by a convergence assessment on 2026-09-23. There is one deliberate refinement.
FR-001 narrows `specs/018` FR-018, whose edge case says a dependent request must never be "sent
with a missing or empty value". Under FR-001, a dependent whose earlier request failed only on
schema conformance is still sent, even if the value it needs is missing. It then fails visibly in
its own result (Clarifications 2026-09-23). All other `specs/018` requirements are restated
unchanged.

| Gap | `specs/018` source | Gap type | Observed behavior |
|-----|--------------------|----------|-------------------|
| 1 | FR-018, Edge Cases (dependency on an earlier failed request) | missing | Every request in a run is sent regardless of whether the earlier request it depends on succeeded. The "dependency not met" not-attempted reason exists in the result vocabulary but is never produced. |
| 2 | FR-016, User Story 3 Acceptance Scenario 2 | partial | A request result records outcome, failure category, duration, and identifiers, but not its processing stage; the stage can only be inferred. |
| 3 | FR-007, User Story 4 Acceptance Scenarios 1 and 3 | partial | Whether a run needs the extra confirmation, and which destructive requests the confirmation names, is decided from every operation in the uploaded specification, not from the requests the approved collection will actually send. |

**Scope boundary**: Only the generated-collection execution path defined by `specs/018` is in
scope. Since 2026-09-23 that path is API-only (`specs/018` Clarifications 2026-09-23); the UI
runs generated collections through `specs/026-external-collection-execution`'s
uploaded-collection path, which is not changed by this feature. OAuth2 token-fetch behavior is
governed by `specs/024-oauth2-client-credentials-auth` FR-004b and is not changed here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dependent Requests Are Not Sent After Their Prerequisite Fails (Priority: P1)

A QA engineer runs an approved collection that contains a multi-step workflow, for example
"create an order, then fetch that order by the id the create step returned." When the first
step fails, the engineer needs the run to report the second step as not attempted because its
prerequisite failed, rather than sending it with a missing or placeholder value and reporting a
misleading second failure.

**Why this priority**: This is the only gap where the shipped behavior sends real requests the
specification says must not be sent. A dependent request dispatched with an unresolved value
can hit an unintended resource on a real target, and its failure is noise that hides the one
failure that actually matters. It is also the only gap of type "missing."

**Independent Test**: Run an approved collection containing a two-step workflow against a local
test target configured so the first step returns an unexpected status. Confirm the target
received no request for the second step, and the second step's result is "not attempted" with reason "dependency not met"
and names the first step as the unmet dependency.

**Acceptance Scenarios**:

1. **Given** an approved workflow whose second step uses a value produced by its first step,
   **When** the first step returns an unexpected status during a run, **Then** the second step is
   not sent, and its result is recorded as not attempted with reason "dependency not met," identifying the first
   step as the unmet dependency.
2. **Given** the same workflow, **When** the first step passes, **Then** the second step is sent
   with the value the first step produced, exactly as today.
3. **Given** a three-step workflow in which step 2 depends on step 1 and step 3 depends on step 2,
   **When** step 1 has a blocking outcome (FR-001), **Then** neither step 2 nor step 3 is sent, and each identifies its own
   direct unmet dependency (step 3 names step 2, not step 1).
4. **Given** a run containing a workflow step with a blocking outcome and unrelated standalone
   requests, **When** the run continues, **Then** every standalone request that does not depend
   on that step is still sent and receives its own normal outcome.
5. **Given** a run is cancelled after a producing step completes but before its dependent step
   starts, **When** the run settles, **Then** the dependent step is recorded as not attempted
   with reason "cancelled," not "dependency not met," because cancellation is what stopped it.
6. **Given** the same two-step workflow, **When** the first step returns its expected status but
   its body does not match the documented schema, **Then** the second step is still sent, and
   the first step's own result reports the schema failure as usual.

---

### User Story 2 - Every Result States Where Processing Ended (Priority: P2)

A QA engineer (or a tool consuming the execution API) inspecting one request result needs to
see, as an explicit recorded fact, how far that request got: never sent, sent but no usable
response received, or response received and assertions evaluated. Today this has to be worked
out from the combination of outcome and failure category.

**Why this priority**: The information is already derivable, so nothing is wrong or unsafe
today, but `specs/018` FR-016 names processing stage as a required part of every result.
Recording it explicitly makes results self-describing for API callers and for AP-018 (AI
Failure Analysis), which will consume them.

**Independent Test**: Run a collection against a local target configured to produce one passing
request, one assertion failure, one unreachable-target failure, and one cancelled request.
Confirm each result carries a processing stage consistent with what happened to it.

**Acceptance Scenarios**:

1. **Given** a request that was never sent (cancelled, dependency not met, or run ended before
   reaching it), **When** its result is retrieved, **Then** its processing stage says it was
   not sent.
2. **Given** a request that failed because the target was unreachable, refused the connection,
   or timed out, **When** its result is retrieved, **Then** its processing stage says no
   response was received.
3. **Given** a request that received a response, **When** its result is retrieved, **Then** its
   processing stage says the response was received and its assertions were evaluated,
   regardless of whether the assertions passed, failed, or could not be evaluated.
4. **Given** results stored before this feature existed, **When** they are retrieved, **Then**
   they are still returned successfully; the absence of a recorded stage on an older result
   does not cause an error.

---

### User Story 3 - The Confirmation Step Reflects What Will Actually Be Sent (Priority: P3)

A QA engineer approves only read-only scenarios (for example, only GET requests) from a
specification that also documents create, update, and delete operations. When they run that
collection against their local or dev environment, they should not be asked to confirm
destructive requests that the collection does not contain. When they run a collection against
staging or production, the confirmation should list exactly the destructive requests that run
will send, no more.

**Why this priority**: Today's behavior errs toward over-confirmation, so it never allows a
destructive run to proceed without confirmation; safety is not reduced. The defect is accuracy:
a confirmation that names requests which will not be sent trains engineers to click through it,
which undermines the safeguard over time.

**Independent Test**: From a specification with both GET and DELETE operations, approve only GET
scenarios. Start a run against a local environment and confirm no extra confirmation is
required. Start the same run against a staging environment and confirm a confirmation is still
required but names no destructive requests.

**Acceptance Scenarios**:

1. **Given** an approved collection containing only non-destructive requests, and a local, dev,
   or QA environment, **When** the engineer starts the run, **Then** the ordinary start action is
   sufficient and no additional confirmation is required.
2. **Given** an approved collection containing at least one destructive request, and any
   environment, **When** the engineer starts the run without confirming, **Then** the additional
   confirmation is required, and it names exactly the destructive requests the approved
   collection contains.
3. **Given** a staging or production environment, **When** the engineer starts any run, **Then**
   the additional confirmation is always required, even if the approved collection contains no
   destructive request.
4. **Given** a specification operation that is destructive but has no approved scenario, **When**
   the confirmation is shown, **Then** that operation is not listed.

---

### Edge Cases

- A workflow step depends on more than one earlier step, and only one of them had a blocking
  outcome (FR-001): the step is not sent, and every unmet dependency is identified, not only the first one found.
- A producing step returned its expected status but its body did not match the schema: its
  dependents are still sent (FR-001). If the value they need is missing from that body, they
  fail visibly in their own results; this feature does not inspect captured values.
- A producing step passed its assertions, but the value it was meant to provide could not be
  found in its response: its dependents are still sent, because the step succeeded. Detecting a
  missing captured value is a candidate follow-up (Assumptions).
- A producing step was itself not attempted (cancelled, or its own dependency was not met): its
  dependents are recorded as "dependency not met," naming it, except when the run was cancelled
  before they were reached, in which case "cancelled" applies (User Story 1, Scenario 5).
- The same scenario appears as a step in more than one approved workflow: dependency is judged
  per workflow, from the steps that actually precede it in the run.
- An OAuth2 token-fetch request fails: dependent requests are still sent and visibly fail, exactly
  as `specs/024` FR-004b requires. This feature does not change that path.
- A login-style request that AP-023 chained as the credential source for other requests fails:
  those requests are still sent and fail visibly, because credential hand-offs are not enforced
  (FR-006).
- A request uses both a data value from a failed earlier request (AP-016/AP-019) and a
  credential from a failed earlier request (AP-023): it is withheld because of the data
  dependency, and only the data dependency is named as unmet.
- An approved collection contains a destructive request whose scenario is a negative test (for
  example, a DELETE with a missing required field): it is still a destructive request, and still
  named in the confirmation, because the method alone decides (`specs/018` Assumptions).
- An approved collection uses OAuth2 client-credentials, and every approved scenario is a GET:
  against a local, dev, or QA environment no confirmation is required, even though the run
  sends a POST to the token URL (FR-010).
- A run result stored before this feature was deployed is retrieved from run history: it is
  returned unchanged, without a processing stage or dependency identification.

## Requirements *(mandatory)*

### Functional Requirements

**Dependency-aware execution (restates `specs/018` FR-018)**

- **FR-001**: When a request in a run depends on a value produced by an earlier request in the
  same run, and that earlier request has a blocking outcome, the system MUST NOT send the
  dependent request. A blocking outcome is any of: not attempted (for any reason), a
  connectivity failure, a timeout, an unexpected status code, or an assertion that could not be
  evaluated. A failure whose only cause is a response body that does not conform to the
  documented schema is not a blocking outcome (Clarifications 2026-09-23). This is how this
  feature applies `specs/018` FR-018's "did not succeed", and it supersedes that requirement's
  "never sent with a missing or empty value" clause for the non-blocking case. Such a dependent
  is sent and fails visibly in its own result rather than being withheld.
- **FR-002**: A request withheld under FR-001 MUST be recorded as not attempted with reason
  "dependency not met," and its result MUST identify every earlier request whose blocking outcome
  left the dependency unmet, by the same operation/request identifiers results already use.
- **FR-003**: Dependency MUST be judged transitively through what actually happened in the run: a
  request that was itself withheld under FR-001 has a blocking outcome for any request that
  depends on it.
- **FR-004**: Requests with no dependency on a request with a blocking outcome MUST continue to run, in the same
  order and with the same outcomes as they would have without this feature.
- **FR-005**: When a run is cancelled, any request not yet started MUST be recorded with reason
  "cancelled" rather than "dependency not met," preserving `specs/018` FR-015.
- **FR-006**: The dependency relationships this feature enforces MUST be exactly the data
  hand-offs between steps of user-approved workflows (AP-016) and the data hand-offs created by
  automatic workflow chaining (AP-019). Credential hand-offs created by automatic
  auth-credential chaining (AP-023) MUST NOT be enforced: a request that uses a credential from
  an earlier request that failed MUST still be sent, so its authentication failure stays
  visible in its own result (Clarifications 2026-09-23).
- **FR-007**: The OAuth2 token-fetch request introduced by `specs/024` MUST keep its current
  behavior: its dependents are sent and fail visibly (`specs/024` FR-004b). This feature MUST NOT
  change it. FR-006's treatment of AP-023 credential hand-offs applies the same rule to every
  credential source, so auth failures are reported the same way whichever feature produced the
  credential.

**Processing stage (restates `specs/018` FR-016)**

- **FR-008**: Every request result produced by a run MUST record its processing stage as one of:
  not sent; sent with no response received; response received and assertions evaluated.
- **FR-009**: The recorded processing stage MUST be consistent with the result's outcome and
  failure category: not attempted means not sent; a connectivity or timeout failure means no
  response received; a pass, an assertion failure, an unexpected status, or an assertion that
  could not be evaluated means response received.

**Confirmation accuracy (restates `specs/018` FR-007)**

- **FR-010**: Whether a run contains destructive requests MUST be determined only from the
  requests for approved scenarios that the collection will send in that run, using the existing
  HTTP-method rule (POST, PUT, PATCH, DELETE, per `specs/018` Assumptions). Requests ApiPilot
  adds to obtain a credential, such as the OAuth2 token request (`specs/024`), MUST NOT be
  counted or listed as destructive (Clarifications 2026-09-23).
- **FR-011**: The confirmation MUST name exactly the destructive requests the approved collection
  contains, without duplicates, and MUST NOT name operations that have no approved request.
- **FR-012**: A run against a staging or production environment MUST still always require the
  additional confirmation, whether or not the approved collection contains destructive requests.
- **FR-013**: A run against a local, dev, or QA environment whose approved collection contains no
  destructive request MUST NOT require the additional confirmation.

**Compatibility**

- **FR-014**: Every change to the execution API's request and response shapes MUST be additive.
  Existing fields, error codes, status codes, and endpoints MUST keep their current meaning, and
  existing callers that ignore the new information MUST keep working unchanged. The one intended
  exception is FR-013's correction. It changes when `409 confirmation_required` is returned, not
  what that response means or looks like.
- **FR-015**: Run results stored before this feature MUST remain retrievable. The absence of the
  new information on such results MUST NOT be treated as an error.
- **FR-016**: This feature MUST NOT change the uploaded-collection execution path
  (`specs/026-external-collection-execution`) or any frontend behavior.
- **FR-017**: The new information MUST follow `specs/018` FR-017's non-sensitive diagnostics rule:
  identifying an unmet dependency MUST use operation/request identifiers only, never the value
  that was expected or any credential.

### Key Entities

- **Request Result** (existing, `specs/018`): gains a recorded processing stage and, for a
  request withheld because a dependency was not met, the identities of the unmet dependencies.
- **Dependency Relationship** (existing, from AP-016 approved workflows and AP-019 automatic
  chains, per FR-006): a directed link from a producing request to a consuming request that uses
  a data value the producer's response provides. This feature reads these links at run time; it
  does not create or change them. AP-023 credential links exist in the same collection but are
  deliberately not enforced.
- **Execution Confirmation Requirement** (existing, `specs/018`): unchanged in shape; its list of
  destructive requests is now derived from the approved collection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across all tested runs, zero requests are sent whose AP-016 or AP-019 data
  dependency had a blocking outcome (FR-001), 100% of requests whose producers' only failure was
  a schema mismatch are still sent, and 100% of requests whose only unmet link is an AP-023 credential
  hand-off are still sent.
- **SC-002**: 100% of withheld requests carry reason "dependency not met" and name at least one
  unmet dependency that is itself present in the same run's results.
- **SC-003**: 100% of request results produced after this feature carry a processing stage, and
  in 100% of them that stage agrees with the result's outcome and failure category.
- **SC-004**: For a collection of only non-destructive approved requests against a local, dev, or
  QA environment, 0% of runs require the additional confirmation. For every run against staging
  or production, 100% still require it.
- **SC-005**: In 100% of confirmations, the destructive requests named equal the destructive
  requests in the approved collection, with no extras and no omissions.
- **SC-006**: Every existing execution test that does not exercise one of the three corrected
  behaviors passes unchanged.

## Assumptions

- **"Did not succeed" is judged by outcome category, not by captured values** (FR-001,
  Clarifications 2026-09-23). An unexpected status, no response, or a response that could not be
  evaluated means the hand-off cannot be relied on. A schema mismatch alone usually still carries
  the value (for example, a created resource's `id`), so blocking on it would hide the dependent
  requests' own results. Refining the rule to "the needed value was not captured" is a candidate
  follow-up, not part of this feature.
- **Processing stage uses three values.** Assertion evaluation always follows a received response
  in this execution path, so "response received" and "assertions evaluated" are recorded as one
  stage rather than two.
- **Dependency information already exists.** The approved collection already records which
  requests hand values to which (AP-016 workflow steps, AP-019 automatic chains) and which hand
  credentials to which (AP-023). This feature reads that information and can tell data hand-offs
  from credential hand-offs; it adds no new analysis of the specification. If the plan finds the
  collection does not already distinguish the two, that is a planning finding to report, not a
  reason to change FR-006.
- **No frontend work.** `specs/018`'s endpoints have had no UI caller since 2026-09-23. Showing the
  new information in the UI would belong to `specs/026`, whose own "dependency not met" label
  already exists but is unreachable there (`specs/026` data-model.md).
- **No roadmap or `specs/018` edits are part of the specification itself.** Recording `AP-030` in
  `specs/ROADMAP.md`, and cross-referencing this feature from `specs/018`, belong to the plan and
  tasks for this feature.
