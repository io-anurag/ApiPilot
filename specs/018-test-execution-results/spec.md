# Feature Specification: Test Execution & Results

**Feature Branch**: `[018-test-execution-results]`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "AP-017 — Test Execution & Results"

**Product identifier**: `AP-017` (post-MVP, per `specs/ROADMAP.md`). This spec directory is
numbered `018` per the repository's sequential feature-directory convention; the directory
number and the `AP-###` product identifier are independent (see `specs/017-session-workflow-
isolation` for the established precedent of this same numbering divergence). `AP-017` is the
canonical identifier used in cross-references, commit messages, and `specs/ROADMAP.md`.

**Relationship to prerequisite specifications**: This feature executes the approved, generated
Postman artifact already produced by AP-007 (Postman Collection Generator), AP-009 (End-to-End
Test Generation Workflow), and AP-016 (Workflow-Aware Postman Generation). It does not change
how that artifact is generated, reviewed, or approved. Per `specs/ROADMAP.md`'s MVP Boundary
and Next Actions #9-12, this feature's specification work begins only after the full MVP
boundary (AP-001 through AP-010) was validated end-to-end against two independent real-world
OpenAPI specifications (2026-09-11).

## Clarifications

### Session 2026-09-11

- Q: Within a single execution run, should requests execute strictly one at a time in a defined
  order, or should independent requests run concurrently for speed? → A: Strictly sequential —
  every request in a run executes one at a time, in a defined order.
- Q: Should requests be sent back-to-back as fast as the target responds, or does this feature
  need a configurable pause between requests? → A: Configurable delay between requests —
  users can set a minimum pause to avoid overwhelming a real target.
- Q: Should a QA engineer be able to cancel an execution run that's already in progress? → A:
  Yes — already-attempted results are kept, remaining requests are marked not-attempted with
  reason "cancelled," matching the AP-013 cancellation precedent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run an Approved Test Suite Against a Chosen Environment (Priority: P1)

A QA engineer has an approved, generated test collection for their API (produced by the
existing guided workflow). They want to actually run it against a real, running instance of
the API — their local machine, a shared development server, or a QA environment — and find out,
in plain terms, whether the API behaves as the approved tests expect.

**Why this priority**: This is the entire point of AP-017: without it, "approved tests" are
inert documents. Everything else in this feature (environment management, detailed
diagnostics, safety guards, history) exists to make this one journey trustworthy and safe to
repeat. A QA engineer who can execute an approved suite and see a clear pass/fail outcome
already has a usable, standalone capability.

**Independent Test**: Can be fully tested by taking an already-approved test collection from
the existing workflow, supplying the minimum required target information (a base URL) for a
single environment, triggering execution, and confirming the engineer sees a single, clear
execution summary (counts of passed/failed/skipped requests) once it completes — independent
of every other story below.

**Acceptance Scenarios**:

1. **Given** an approved test collection and a reachable target base URL, **When** the
   engineer explicitly starts execution, **Then** the system runs every request in the
   collection against that target and presents a summary of how many passed, failed, or could
   not be attempted.
2. **Given** an execution is in progress, **When** the engineer views the run, **Then** they
   can see that it is actively running (not silently doing nothing, and not indistinguishable
   from a finished run).
3. **Given** an execution has completed, **When** the engineer opens the results, **Then**
   every individual request in the collection has its own recorded outcome (passed, failed, or
   not attempted), not only the aggregate summary.
4. **Given** the target base URL is unreachable, **When** the engineer starts execution,
   **Then** the system reports connectivity failure as its own distinct, explicit category
   rather than presenting it as a normal assertion failure or as a silently empty result.
5. **Given** an execution is in progress, **When** the engineer cancels it, **Then** every
   request already attempted keeps its recorded outcome, every remaining request is recorded as
   not attempted with reason "cancelled," and the run reaches a terminal state reflecting the
   cancellation rather than normal completion.

---

### User Story 2 - Configure and Select the Right Target Environment (Priority: P2)

Before running anything, a QA engineer needs to say exactly where the requests should go and
what environment-specific values (a base URL, an API key placeholder, a tenant ID, etc.) should
fill the collection's variables — and be able to tell, at a glance, which named environment
("Local", "Dev", "QA", "Staging", "Production") they are about to target, since running the
same collection against the wrong one has real consequences.

**Why this priority**: Execution without deliberate environment selection is what turns a
useful capability into an accident waiting to happen. This story is what makes User Story 1
safe to use more than once, and directly serves the constitution's requirement that the system
treat environments as potentially sensitive and destructive.

**Independent Test**: Can be fully tested by defining two named environments with different
base URLs (e.g., "Local" and "Staging"), running the same approved collection against each in
turn, and confirming the requests actually reached the URL configured for whichever
environment was selected — without needing execution history, detailed diagnostics, or
destructive-operation guards to already exist.

**Acceptance Scenarios**:

1. **Given** no environment has been configured yet, **When** the engineer tries to start
   execution, **Then** the system requires them to supply or select a target environment
   before anything runs.
2. **Given** more than one named environment has been configured, **When** the engineer starts
   execution, **Then** they must explicitly choose which one this run targets — the system
   MUST NOT default silently to a prior or arbitrary environment.
3. **Given** an environment is classified as a higher-risk tier (Staging or Production),
   **When** the engineer selects it, **Then** the system visibly and unambiguously identifies
   that tier before and during execution, distinct from how a Local/Dev tier is presented.
4. **Given** an environment's configuration is incomplete (e.g., a variable the collection
   requires has no supplied value), **When** the engineer tries to start execution, **Then**
   the system identifies exactly which value is missing rather than starting a run that will
   fail opaquely partway through.

---

### User Story 3 - Diagnose a Failed Run Without Wading Through Noise (Priority: P3)

After a run reports failures, a QA engineer needs to quickly understand *which* requests
failed, *why* (a failed assertion vs. a connection error vs. a timeout vs. an unexpected status
code), and *what the API actually returned* for that request — without having to search through
raw logs containing every credential, full request body, and full response body from the
entire run.

**Why this priority**: A pass/fail count (User Story 1) tells an engineer *that* something is
wrong; this story is what lets them actually act on it. It depends on User Story 1 already
producing per-request results, so it is ordered after it, but it is what makes those results
genuinely useful rather than a black box.

**Independent Test**: Can be fully tested by deliberately running a collection against a target
that will produce at least one assertion failure and one unexpected-status-code failure, then
confirming the engineer can distinguish the two failure categories, see the specific assertion
that failed, and see the actual response status/summary for that request, without needing
environment-tier safeguards or execution history from the other stories.

**Acceptance Scenarios**:

1. **Given** a completed run with failures, **When** the engineer inspects a failed request,
   **Then** they see which specific assertion(s) failed, distinct from a request that failed
   because of a connection problem, a timeout, or an unexpected status code.
2. **Given** a completed run, **When** the engineer inspects any individual request's result,
   **Then** they see its processing stage, duration, and an operation/request identifier
   sufficient to locate it in the original collection.
3. **Given** a request in the collection carries a header or body value the platform treats as
   sensitive (e.g., an authorization token, a password field), **When** the engineer views that
   request's diagnostics, **Then** the sensitive value is not shown in the clear by default.
4. **Given** a run produced a very large number of results, **When** the engineer views the
   results, **Then** they can filter or navigate to failures specifically rather than scrolling
   through every passing request to find them.

---

### User Story 4 - Be Stopped From Accidentally Running Destructive Requests Unattended (Priority: P4)

A QA engineer (or a teammate on the project) must never be able to trigger execution of a test
suite — especially one containing destructive requests (creates, updates, deletes) — against a
Staging or Production environment merely by the tests having been generated and approved for
test *design* purposes. Starting a run is always a distinct, deliberate act, and a run that
targets a higher-risk environment or contains destructive requests carries a visibly higher bar
before it proceeds.

**Why this priority**: This directly implements the constitution's requirement that generated
tests never constitute authorization to execute, and that the system must not silently run
destructive workflows against a protected environment. It is ordered after the first three
stories because it is a safeguard *on* execution, not the execution capability itself, but it
is not optional or deferrable — see Assumptions for how "destructive" and "extra confirmation"
are scoped for this feature.

**Independent Test**: Can be fully tested by attempting to execute a collection containing at
least one write-method (create/update/delete) request against an environment tagged Staging or
Production, and confirming the run does not proceed until the engineer completes an explicit,
distinct confirmation step beyond the ordinary "start execution" action required for a Local/Dev
run.

**Acceptance Scenarios**:

1. **Given** a collection contains at least one destructive request and the selected
   environment is tagged Staging or Production, **When** the engineer attempts to start
   execution, **Then** the system requires an additional explicit confirmation step naming the
   environment and the destructive requests involved, beyond the normal start action.
2. **Given** the engineer does not complete that additional confirmation, **When** they
   abandon or dismiss it, **Then** no request in the collection is sent.
3. **Given** the same collection and a Local or Dev-tagged environment, **When** the engineer
   starts execution, **Then** the ordinary single start action is sufficient — the extra
   confirmation step is not imposed where it provides no safety value.
4. **Given** an execution is already in progress for a given approved test collection,
   **When** the engineer or a teammate attempts to start a second execution of that same
   collection, **Then** the system refuses the second attempt and directs them to the run
   already in progress, rather than running two overlapping executions against the same
   target.

---

### User Story 5 - Come Back Later and Still See What Happened (Priority: P5)

A QA engineer who ran a test suite wants to look at that run's results again later in the same
working session — for example, after reviewing a failure in detail, switching to look at
something else, and coming back — without having to re-run the suite to see what already
happened.

**Why this priority**: Useful, but the lowest-priority story: the first four stories already
deliver the feature's core value (run, target correctly, understand failures, don't run
unattended-destructive). Losing history on backend restart is consistent with how every
existing ApiPilot workflow already behaves (see Assumptions) and is an acceptable v1
limitation.

**Independent Test**: Can be fully tested by completing a run, navigating away from its results
within the same session, and confirming the same run's summary and per-request results can be
retrieved again without re-executing anything.

**Acceptance Scenarios**:

1. **Given** a run has completed, **When** the engineer navigates away and returns within the
   same working session, **Then** the same run's summary and per-request results are still
   available.
2. **Given** multiple runs have been executed across different environments in the same
   session, **When** the engineer looks at run history, **Then** each run is distinguishable by
   which collection, environment, and time it ran.

---

### Edge Cases

- What happens when the selected environment's base URL is well-formed but the target actively
  refuses or resets the connection, versus simply timing out with no response at all? Both MUST
  be surfaced as distinct, explicit failure categories rather than collapsed into "assertion
  failed."
- What happens when a request in the collection depends on a value extracted from an earlier
  request in the same run (a workflow data handoff, per AP-016), and that earlier request
  failed? The dependent request MUST be reported as not attempted (with the reason), not
  silently sent with a missing/empty value.
- What happens when the engineer closes their browser or loses connectivity while a run is in
  progress? The run already in progress on the backend MUST continue or reach an explicit
  terminal state rather than being left ambiguously stuck; reconnecting MUST show its current or
  final state, not a false "nothing has happened" empty state.
- What happens when the collection's variables reference a value the selected environment never
  supplied? Execution MUST be refused before any request is sent, identifying the specific
  missing value(s), rather than sending partially-substituted requests.
- What happens when the same collection is executed twice in a row against the same environment?
  Both runs MUST be tracked as distinct results (per User Story 5), and re-running MUST NOT
  silently overwrite or merge with the previous run's recorded outcome.
- What happens when an assertion itself is malformed or cannot be evaluated against the actual
  response (e.g., expects JSON but the response is not valid JSON)? This MUST be reported as its
  own explicit "assertion could not be evaluated" outcome, distinct from both "passed" and a
  normal "failed."
- What happens when a cancellation is requested while a request has already been sent and the
  system is waiting on its response? The system MUST let that one in-flight request reach its own
  outcome (passed/failed) rather than discarding a response already on its way; only requests not
  yet started at the moment of cancellation are recorded as not-attempted/"cancelled."

## Requirements *(mandatory)*

### Functional Requirements

**Environment definition and selection**

- **FR-001**: Users MUST be able to define one or more named target environments, each with a
  base URL and a set of variable values corresponding to the collection's declared variables
  (e.g., `{{baseUrl}}`, `{{token}}`).
- **FR-002**: Users MUST be able to classify each defined environment into a risk tier (at
  minimum: Local, Dev, QA, Staging, Production), and the system MUST visibly distinguish which
  tier is targeted before and throughout an execution.
- **FR-003**: The system MUST require an explicit environment selection before any execution
  starts and MUST NOT default to a previously used or arbitrary environment when more than one
  exists.
- **FR-004**: The system MUST validate, before sending any request, that every variable the
  collection declares has a supplied value in the selected environment, and MUST refuse to
  start execution — identifying exactly which value(s) are missing — otherwise.
- **FR-005**: Environment configuration values that constitute credentials MUST follow the same
  no-real-secrets-in-generated-artifacts posture already established for collection generation
  (constitution XVIII): the system MUST NOT require or encourage embedding a real secret
  directly into the generated Postman collection itself, and any credential value supplied for
  execution MUST be entered through the environment configuration mechanism, not hand-edited
  into the collection. A defined environment's values, including credential-like ones such as a
  token, MAY be retained in memory for reuse across multiple runs within the same working
  session, consistent with the platform's existing non-durable, session-scoped state model
  (constitution XVII/`specs/017-session-workflow-isolation`) — never written to durable storage,
  and cleared on backend restart along with every other session-scoped state.

**Execution authorization and safety**

- **FR-006**: The system MUST NOT execute any request as a side effect of test generation,
  review, approval, or Postman export; execution MUST always require a live, explicit,
  interactive user action at the moment it starts. No pre-configured "execution policy" that
  authorizes a run to start with no person present is in scope for this feature; an unattended/
  CI-style execution mode would require a separate, later specification.
- **FR-007**: When the selected environment is tagged Staging or Production, or when the
  collection contains at least one destructive request (a request whose HTTP method is one of
  POST, PUT, PATCH, or DELETE), the system MUST require an additional, distinct explicit
  confirmation step — naming the target environment and identifying the destructive requests
  involved — beyond the ordinary action that starts execution against a Local/Dev environment
  with no destructive requests. Completing this confirmation is sufficient to proceed; this
  feature does not technically block such executions outright.
- **FR-008**: The system MUST NOT allow two executions of the same approved test collection to
  run concurrently; an attempt to start a second execution while one is in progress MUST be
  refused and MUST direct the user to the run already in progress.
- **FR-009**: No AI-generated content or AI process may itself trigger, approve, or bypass the
  confirmation required by FR-006/FR-007; only an explicit human action may do so.

**Execution and results**

- **FR-010**: Once started, the system MUST execute every request in the approved collection,
  strictly one at a time in a defined order, against the selected environment, and produce, for
  each individual request, one of the following outcomes: passed, failed (with a specific reason
  category), or not attempted (with a specific reason, e.g., an earlier dependency in the same
  run failed). Requests within the same run MUST NOT execute concurrently with each other.
- **FR-011**: Users MUST be able to configure a minimum pause duration to enforce between
  consecutive requests within a run (globally or per environment), separate from the
  connection/response timeout for any single request; a run with no configured pause proceeds
  to its next request as soon as the current one resolves.
- **FR-012**: The system MUST distinguish, as separate failure categories, at minimum:
  assertion failure, unexpected status code, connectivity failure (target unreachable or
  connection refused), timeout, and an assertion that could not be evaluated against the actual
  response.
- **FR-013**: The system MUST produce an overall execution summary (counts of passed, failed,
  and not-attempted requests, and overall duration) as soon as a run reaches a terminal state.
- **FR-014**: While an execution is in progress, the system MUST make that in-progress state
  visible and distinguishable from both "not yet started" and "completed."
- **FR-015**: Users MUST be able to cancel a run while it is in progress. On cancellation, every
  request already attempted keeps its recorded outcome, every remaining request is recorded as
  not attempted with "cancelled" as its specific reason, and the run reaches a terminal state
  reflecting that it was cancelled rather than that it completed normally.
- **FR-016**: For each individual request's result, the system MUST retain enough information
  to locate it in the original collection (an operation/request identifier), its processing
  stage, its duration, which assertion(s) were evaluated and their outcomes, and a summary of
  the actual response (at minimum, status code) sufficient to diagnose the failure.
- **FR-017**: The system MUST NOT include raw credentials, complete raw request bodies, or
  complete raw response bodies in diagnostics or logs by default; a result's diagnostic detail
  MUST favor operation/request identifiers, processing stage, duration, error category, and
  assertion identifiers, consistent with the platform's existing observability principle
  (constitution XX).
- **FR-018**: When a request in the run depends on a value produced by an earlier request in
  the same run (a workflow data handoff) and that earlier request did not succeed, the dependent
  request MUST be recorded as not attempted, with the specific unmet dependency identified,
  rather than sent with a missing or empty value.
- **FR-019**: Users MUST be able to retrieve a completed or in-progress run's results and
  summary again later in the same working session without re-executing the collection.
- **FR-020**: Each run MUST be individually distinguishable by which collection, which
  environment, and when it ran; re-running the same collection against the same environment
  MUST produce a new, separately retrievable run rather than overwriting the prior one's
  recorded outcome.
- **FR-021**: Users MUST be able to filter or otherwise navigate a completed run's results to
  the requests that failed, without needing to scan every passing result.

### Key Entities

- **Environment**: A named, risk-tier-classified execution target (Local/Dev/QA/Staging/
  Production) holding a base URL and the variable values a collection's placeholders resolve
  against. Distinct from the collection itself; the same collection can be executed against
  many environments.
- **Execution Run**: One attempt to execute a specific approved collection against a specific
  environment, from an explicit start action through a terminal state (completed or otherwise
  concluded), processing its requests strictly one at a time in a defined order. Has an overall
  summary and belongs to exactly one collection/environment pair at a time, though the same pair
  may have many runs over time.
- **Request Result**: The outcome of one request within one execution run: its outcome (passed/
  failed/not-attempted), failure category when applicable, duration, processing stage, the
  assertions evaluated and their outcomes, and a non-sensitive summary of the actual response.
- **Assertion Outcome**: The evaluated result of one assertion against one request's actual
  response within a run: passed, failed, or could-not-be-evaluated, tied back to the specific
  assertion defined on the originating TestScenario.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A QA engineer with an already-approved test collection can configure a target
  environment and obtain a first pass/fail execution summary in under 5 minutes, without
  consulting documentation beyond what the interface itself presents.
- **SC-002**: 100% of individual request results in a completed run are traceable to a specific
  operation in the original collection and to a specific pass/fail/not-attempted outcome with a
  named reason.
- **SC-003**: Zero executions occur without an explicit, distinct user action to start them, and
  zero executions against a Staging/Production environment or containing a destructive request
  proceed without the additional confirmation step being completed, across all tested scenarios.
- **SC-004**: An engineer diagnosing a failed run can identify the specific failing
  assertion(s) or failure category for any given failed request without needing to view a raw
  request/response body dump or any credential value.
- **SC-005**: Re-running the same collection against the same environment never silently
  overwrites a previous run's recorded results; both remain independently retrievable for the
  rest of the working session.
- **SC-006**: 100% of connectivity failures (unreachable target, connection refused, timeout)
  are categorized distinctly from assertion failures in the results an engineer sees.

## Assumptions

- **Execution history persistence matches the rest of the platform's existing architecture**:
  runs and their results are retained only for the current session/process lifetime (the same
  no-durable-persistence, backend-restart-clears-state model already established by AP-009 and
  `specs/017-session-workflow-isolation`), not written to a database or file store. A future
  specification may extend this if durable execution history becomes a concrete need.
- **"Destructive" is scoped to HTTP method for v1**: a request is treated as destructive-capable
  if its method is POST, PUT, PATCH, or DELETE. This is a coarse, conservative heuristic (a
  read-only POST-based search endpoint would still be flagged) chosen because it requires no new
  specification-level metadata and errs toward more confirmation rather than less; refining this
  (e.g., via explicit per-operation annotation) is a candidate future enhancement, not a v1
  requirement.
- **One execution at a time, per approved collection**: consistent with the existing
  single-in-progress-operation concurrency pattern already used elsewhere in the platform (e.g.,
  AI enhancement's already-running guard), rather than introducing a new concurrency model.
- **Execution targets are supplied by the user for each environment they define**; ApiPilot does
  not itself discover, provision, or manage the lifecycle of the environments it executes
  against.
- **This feature executes real HTTP requests against a user-specified, explicitly authorized
  target as data-driven behavior of an approved test artifact** — it does not execute uploaded
  specification content, generated scripts, or arbitrary code on the ApiPilot server itself;
  this is the same boundary the constitution's existing "avoid executing uploaded specifications
  or generated scripts on the server" principle (XVII) already draws, extended here to the new
  execution capability this feature introduces.
- **Assertion evaluation reuses the same Assertion definitions already produced by the existing
  deterministic and AI-assisted test design pipeline** (AP-003/AP-005); this feature does not
  change how assertions are authored, only how they are evaluated against a real response.
