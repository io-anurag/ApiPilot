# Feature Specification: End-to-End Test Generation Workflow

**Feature Branch**: `009-e2e-test-generation-workflow`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "AP-009 — End-to-End Test Generation Workflow"

## Clarifications

### Session 2026-09-04

- Q: Is the guided workflow the exclusive way to interact with each stage's screen, or do the
  existing standalone AP-002–AP-008 screens stay independently accessible alongside it? → A: The
  guided workflow is the exclusive entry point; standalone stage screens are not independently
  reachable outside an active workflow.
- Q: Should in-progress workflow state be a single instance shared by the whole running backend,
  or isolated per browser session? → A: A single global workflow instance lives in the backend
  process at a time, shared by whichever browser connects to it.
- Q: When AI enhancement is skipped because the local AI provider was unavailable, can the user
  retry it later, or is the skip permanent for that workflow run? → A: The user can retry AI
  enhancement later, as long as scenario review has not yet been finalized.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Go From Specification to Executable Tests in One Guided Flow (Priority: P1)

As a QA engineer, I want to move through the complete ApiPilot pipeline — upload, analyze,
review discovered APIs, generate deterministic scenarios, enhance with local AI, review
scenarios, analyze dependencies, review/approve workflows, and generate a Postman collection —
as a single continuous guided experience, so I don't have to manually stitch together
independent screens or re-establish context at every step.

**Why this priority**: This is the entire premise of AP-009: turning eight independently
useful capabilities into one coherent MVP journey. Without it, each prior feature remains an
isolated tool rather than a product.

**Independent Test**: Upload a valid OpenAPI specification with a handful of related
operations, proceed through every stage using only the guided workflow's own navigation, and
verify the end result is a downloadable Postman collection and environment file traceable back
to the originally uploaded specification.

**Acceptance Scenarios**:

1. **Given** a freshly uploaded, valid OpenAPI specification, **When** the QA engineer proceeds
   through the workflow, **Then** each stage (analysis, API review, deterministic generation, AI
   enhancement, scenario review, dependency analysis, workflow review/approval, Postman
   generation) becomes available in order and consumes the output of the stage before it.
2. **Given** the QA engineer has completed every stage, **When** they reach the final stage,
   **Then** a Postman collection, environment file, and README are available to download.
3. **Given** a stage has not yet produced a valid output (e.g., specification analysis has not
   completed), **When** the QA engineer attempts to open a later stage, **Then** the system
   prevents entry to that stage and explains what is still required.
4. **Given** the QA engineer completes the workflow for one specification, **When** they inspect
   the generated Postman collection, **Then** every request traces back to a specific reviewed
   and approved scenario or workflow step from the earlier stages.

---

### User Story 2 - Always Know Where I Am and What's Left (Priority: P2)

As a QA engineer, I want to see which stage of the workflow I am in, which stages are already
complete, and which remain, so I can plan my review effort and confidently step away and come
back without losing track of progress.

**Why this priority**: A multi-stage workflow that hides its own progress undermines the trust
and transparency the rest of the product is built on; this is required for the workflow to feel
coherent rather than like a sequence of disconnected tools.

**Independent Test**: Start a workflow, complete a few stages, and verify a progress view
correctly reflects completed, active, and not-yet-reached stages at every point.

**Acceptance Scenarios**:

1. **Given** an in-progress workflow, **When** the QA engineer views the workflow overview,
   **Then** it shows every stage's status as complete, active, or not-yet-reached.
2. **Given** a stage that produced analysis issues, unresolved dependencies, or an unavailable
   AI provider, **When** the QA engineer views the workflow overview, **Then** that condition is
   visible at the workflow level, not only inside the individual stage screen.
3. **Given** the QA engineer navigates away from the workflow and returns while the backend is
   still running, **When** they reopen it, **Then** the workflow resumes at the stage they left,
   with all prior decisions intact.

---

### User Story 3 - Revise an Earlier Decision Without Silently Invalidating Later Work (Priority: P2)

As a QA engineer, I want to go back and change a decision I made earlier in the workflow (such
as excluding an API operation, or rejecting a scenario I previously approved) and have the
system clearly tell me which later stages are now stale, so I never ship a Postman collection
that no longer reflects my actual decisions.

**Why this priority**: Reviewers change their minds after seeing downstream output; if revising
an earlier stage silently leaves stale downstream artifacts in place, the workflow's core
promise of traceability and trustworthiness is broken.

**Independent Test**: Complete the workflow through Postman generation, return to an earlier
stage and change a decision that affects downstream output, and verify the affected downstream
stages are marked stale and the previously generated Postman collection is no longer presented
as current.

**Acceptance Scenarios**:

1. **Given** a completed downstream stage (e.g., an approved workflow), **When** the QA engineer
   changes a decision at an earlier stage that the downstream stage depended on, **Then** the
   system marks the affected downstream stage(s) as stale rather than leaving them marked
   complete.
2. **Given** a stage marked stale, **When** the QA engineer attempts to download a Postman
   collection generated before the change, **Then** the system indicates the artifact no longer
   reflects current decisions and requires the stale stage(s) to be redone first.
3. **Given** the QA engineer redoes a stale stage, **When** it completes again, **Then** its
   downstream stages return to a normal not-yet-reached or in-progress state rather than
   remaining marked stale.

---

### User Story 4 - Continue the Workflow When Local AI Is Unavailable (Priority: P3)

As a QA engineer, I want to still be able to complete the workflow using only deterministic
scenarios when the local AI provider is not ready or fails, so a temporary local inference
problem doesn't block me from producing a usable, if less enriched, test suite.

**Why this priority**: AI enhancement is one stage among many, and the constitution requires
deterministic capability to remain independent of AI availability; the end-to-end workflow must
honor that rather than treating AI as a hard gate.

**Independent Test**: Run the workflow with the AI provider forced into an unavailable state at
the enhancement stage, and verify the workflow still reaches Postman generation using only the
deterministic TestModel, with the AI-unavailable condition visibly recorded.

**Acceptance Scenarios**:

1. **Given** the local AI provider reports itself unavailable during the AI-enhancement stage,
   **When** the QA engineer proceeds, **Then** the workflow allows continuing to scenario review
   using the deterministic-only TestModel and visibly records that AI enhancement did not run.
2. **Given** a workflow that proceeded without AI enhancement, **When** the QA engineer reaches
   Postman generation, **Then** the generated collection and its provenance clearly show that no
   AI-derived scenarios are present, rather than implying AI review occurred.
3. **Given** AI enhancement was skipped and scenario review has not yet been finalized, **When**
   the local AI provider becomes ready, **Then** the QA engineer can retry AI enhancement and have
   any resulting AI-derived scenarios added to scenario review, rather than being forced to
   restart the workflow from upload.
4. **Given** scenario review has already been finalized without AI enhancement, **When** the local
   AI provider later becomes ready, **Then** the workflow does not retroactively insert AI-derived
   scenarios into the already-approved review outcome.

---

### Edge Cases

- The uploaded specification fails validation during analysis: the workflow stops at that stage,
  reports the validation failure, and does not present later stages as reachable.
- Dependency analysis finds no relationships at all: the workflow allows proceeding directly to
  Postman generation using only the approved scenarios, without requiring a workflow-approval
  step to contain any steps.
- The QA engineer rejects every generated scenario during review, leaving an empty approved
  TestModel: the system blocks Postman generation and explains that at least one approved
  scenario is required, rather than generating an empty, misleadingly "successful" collection.
- The QA engineer attempts to start a new end-to-end workflow for a different specification while
  one is already in progress: the system requires explicit confirmation before discarding the
  in-progress workflow's state. Because the workflow instance is global to the running backend,
  this applies even if the attempt comes from a different browser tab or connection than the one
  that started the in-progress workflow.
- The QA engineer attempts to navigate directly to a stage screen (e.g., scenario review) without
  an active workflow, or while an active workflow has not yet reached that stage: the system
  blocks direct access and routes the QA engineer back into the guided workflow at its current
  stage, since no stage screen is independently reachable outside an active workflow.
- An underlying stage (analysis, scenario generation, dependency analysis, artifact generation)
  fails unexpectedly: the workflow reports the failure at the stage where it occurred and keeps
  all previously completed stages' state intact rather than resetting the whole workflow.
- The QA engineer closes the browser tab mid-workflow and reopens the application while the
  backend process is still running: the workflow resumes from where it left off, from any
  browser connection, because workflow state is a single instance shared by the backend rather
  than tied to that browser tab. If the backend process itself has been restarted, the previous
  in-progress workflow is not recoverable and must be restarted from upload.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST guide the user through the complete workflow — specification
  upload, analysis, API review, deterministic scenario generation, AI enhancement, scenario
  review, dependency analysis, workflow review/approval, and Postman generation — as stages of
  one continuous, ordered workflow.
- **FR-002**: The system MUST NOT allow a user to enter a stage whose required input (the
  approved or completed output of a prior stage) does not yet exist, and MUST explain what is
  still required when entry is blocked.
- **FR-003**: The system MUST NOT generate an executable Postman collection except from a
  TestModel that has passed explicit human review/approval at the scenario-review and
  workflow-review stages.
- **FR-004**: The system MUST display, at the workflow level, the status of every stage as
  complete, active, or not-yet-reached, and MUST surface stage-level errors, analysis issues, or
  unavailable-provider conditions at the workflow level rather than only inside the stage screen.
- **FR-005**: The system MUST preserve, without loss or merging, the provenance metadata
  (specification-derived, deterministic-rule-derived, AI-derived, user-approved) attached by each
  underlying feature as its output moves into and through later workflow stages.
- **FR-006**: When the user revises a decision at a completed stage that a later, already
  completed stage depended on, the system MUST mark the dependent downstream stage(s) as stale
  rather than leaving them marked complete.
- **FR-007**: The system MUST prevent downloading a Postman collection, environment, or README
  that was generated before a decision revision left any stage marked stale, until the stale
  stage(s) are redone.
- **FR-008**: When the local AI provider is unavailable or fails during the AI-enhancement stage,
  the system MUST allow the user to continue the workflow using the deterministic-only
  TestModel, and MUST visibly record that AI enhancement was skipped or unavailable rather than
  presenting the workflow as if AI review occurred.
- **FR-008a**: The system MUST allow the user to retry AI enhancement after it was skipped for
  provider unavailability, as long as scenario review has not yet been finalized, and MUST fold
  any resulting AI-derived scenarios into scenario review. Once scenario review is finalized, the
  system MUST NOT retroactively insert AI-derived scenarios into that workflow run.
- **FR-009**: The system MUST NOT automatically approve, authorize, or skip a stage's required
  human decision (API selection, scenario approval, workflow approval); every such decision MUST
  result from explicit user action.
- **FR-010**: The system MUST require explicit user confirmation before discarding an in-progress
  workflow's state to start a new end-to-end workflow for a different specification.
- **FR-011**: The system MUST block Postman generation and explain the reason when the approved
  TestModel entering that stage contains zero approved scenarios.
- **FR-012**: The system MUST make the final downloadable artifacts (Postman collection,
  environment, README) available only once the workflow reaches its completed state with no
  stage marked stale.
- **FR-013**: The system MUST NOT execute, or contact, any API operation described by the
  uploaded specification at any point in the workflow.
- **FR-014**: The system MUST retain the in-progress workflow's state for as long as the backend
  process keeps running so the user can complete the full workflow, or return to it later from
  any browser connection, without re-uploading the specification or re-entering prior decisions.
- **FR-015**: When an underlying stage fails unexpectedly, the system MUST report the failure at
  the stage where it occurred while preserving the state of all previously completed stages,
  rather than resetting the entire workflow.
- **FR-016**: The system MUST keep the uploaded specification's content, generated payloads, and
  any AI prompts/responses out of workflow-level diagnostic or error output beyond what is needed
  to report an error category, consistent with the diagnostic constraints already established by
  the individual stages.
- **FR-017**: The system MUST make the guided workflow the exclusive way to open any stage's
  screen (API review, scenario review, dependency analysis, workflow review/approval, Postman
  generation); it MUST NOT expose a way to open a stage's screen independently of an active
  workflow that has reached that stage.
- **FR-018**: The system MUST maintain the in-progress end-to-end workflow as a single instance
  shared by the running backend, rather than isolating it per browser connection or session.

### Key Entities

- **Test Generation Workflow**: The end-to-end orchestration instance for one uploaded
  specification, tracking which stage is active, each stage's status, and references to the
  domain objects (ApiModel, deterministic TestModel, enhanced TestModel, approved TestModel,
  dependency graph, integration workflows, Postman artifact) produced by each stage.
- **Workflow Stage**: One step in the ordered sequence (upload, analysis, API review,
  deterministic generation, AI enhancement, scenario review, dependency analysis,
  workflow review/approval, Postman generation), identified by its position, its required input,
  and the domain object it produces.
- **Stage Status**: The state of a single workflow stage — not-yet-reached, active, complete,
  stale, or skipped (recorded when AI enhancement did not run due to provider unavailability).
  The skipped status is not terminal for the AI-enhancement stage: it can return to active if the
  user retries AI enhancement before scenario review is finalized (FR-008a).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A QA engineer can go from uploading a valid OpenAPI specification of representative
  size (around 10 operations) to downloading a Postman collection and environment without
  leaving the guided workflow or manually locating an unrelated screen.
- **SC-002**: 100% of Postman collections produced through the workflow in evaluation originate
  from a TestModel that passed explicit human approval at both the scenario-review and
  workflow-review stages.
- **SC-003**: When a decision at an earlier stage is revised after downstream stages already
  completed, 100% of the affected downstream stages are visibly marked stale before any
  previously generated artifact can be re-downloaded.
- **SC-004**: In evaluation with the local AI provider deliberately made unavailable, 100% of
  workflow runs still reach a downloadable Postman collection using the deterministic-only
  baseline, with the AI-unavailable condition visibly recorded in the workflow and in the
  resulting artifact's provenance.
- **SC-005**: A QA engineer can identify the workflow's current stage and overall progress within
  5 seconds of opening the workflow view.
- **SC-006**: 0% of completed workflow runs produce a downloadable artifact without a
  corresponding approved TestModel with at least one approved scenario.
- **SC-007**: No workflow stage transition issues a network request to any API described by the
  uploaded specification.

## Assumptions

- This feature introduces an orchestration layer over the existing AP-002 through AP-008
  capabilities; it does not add new OpenAPI analysis, scenario-generation, AI-enhancement,
  review, dependency-detection, or artifact-generation logic beyond what those specifications
  already define.
- Consistent with ApiPilot's local-first, non-persistent processing model, workflow state is
  retained in memory for the duration of the running backend process; it is not persisted to
  durable storage across an application restart, and a restart requires the workflow to be
  started again from specification upload.
- One end-to-end workflow is active at a time, as a single instance shared by the running backend
  process rather than isolated per browser session; starting a new one for a different
  specification requires the explicit confirmation described in FR-010 rather than running
  multiple workflows concurrently. This matches ApiPilot's local, single-user framing and avoids
  introducing session/cookie identity infrastructure the product does not otherwise need.
- The guided workflow is the exclusive way to reach each stage's screen; the standalone
  AP-002–AP-008 screens are not independently accessible outside an active workflow, so the
  workflow never needs to detect changes made to underlying data from outside itself.
- The individual stage capabilities (upload validation, analysis, deterministic generation, AI
  enhancement, review, dependency analysis, Postman generation) already define their own
  detailed behavior, edge cases, and success criteria in their respective specifications; this
  feature's requirements are scoped to sequencing, progress visibility, staleness handling, and
  the AI-unavailable continuation path across those stages.
- Producing a downloadable Postman collection is this workflow's terminal state; executing that
  collection and reporting results is out of scope, per AP-011.

## Out of Scope

- Any new OpenAPI parsing, deterministic scenario generation, AI enhancement, review, dependency
  detection, or Postman generation logic beyond what AP-002 through AP-008 already specify.
- Executing generated Postman collections or reporting execution results (AP-011) and AI failure
  analysis (AP-012).
- Multi-user or multi-tenant workflow session management, including concurrent workflows across
  different users or browser sessions.
- Persisting workflow history or in-progress workflow state across an application restart.
- Supporting more than one concurrently active end-to-end workflow within the same running
  backend process.
