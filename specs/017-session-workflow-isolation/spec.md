# Feature Specification: Session-Scoped Concurrent Workflow Isolation

**Feature Branch**: `017-session-workflow-isolation`

**Created**: 2026-09-10

**Status**: Draft

**Input**: User description: "Session-scoped concurrent workflow isolation — allow multiple users/browser sessions to use ApiPilot's guided test-generation workflow at the same time without one user's actions overwriting another's in-progress workflow state. Today (spec 009-e2e-test-generation-workflow, FR-018) the backend holds exactly one global in-progress TestGenerationWorkflow instance shared by every client; this feature isolates that state per browser session so concurrent users (e.g. a team trying the tool at the same time after a demo) each get their own independent workflow, while preserving the existing single-instance behavior for a single user across page reloads/tabs within their own session. This intentionally reverses the 'single global instance' clarification in spec 009 and must reconcile with spec 012's reconnect/progress-visibility design, which was built assuming no session identity."

## Clarifications

### Session 2026-09-10

- Q: Must a session's identifier be unguessable by another concurrent session, so nobody can
  access another person's workflow just by guessing or crafting an identifier? → A: Yes —
  session identifiers MUST be cryptographically random/unguessable; a teammate cannot feasibly
  derive or guess another active session's identifier.
- Q: When a session's workflow is discarded for inactivity (FR-007), should the user get any
  explicit indication that their previous progress was lost, or is it acceptable to just show
  the standard empty state? → A: Show an explicit notice ("your previous session expired due to
  inactivity") the first time a returning session lands on the empty state.
- Q: Roughly how many concurrent sessions should this feature be designed to handle well? → A:
  Small team scale — comfortably handle up to ~20 concurrent sessions; no special capacity
  limits needed beyond the idle-eviction already specified (FR-007).

## Relationship to Existing Specifications

This feature hardens an already-shipped feature rather than introducing a new pipeline stage,
the same way AP-011 through AP-016 hardened earlier MVP features (see `specs/ROADMAP.md`). It
directly reverses one clarified decision recorded in `specs/009-e2e-test-generation-workflow/spec.md`
(FR-018: "the system MUST maintain the in-progress end-to-end workflow as a single instance...
shared by the whole running backend"), and it must remain compatible with
`specs/012-ai-enhancement-progress/research.md` Decision 2, whose reconnect/progress-visibility
design was explicitly built on that same single-instance, no-session-identity assumption.

To avoid confusion with `specs/ROADMAP.md`'s own `AP-017` ("Test Execution & Results", a
post-MVP feature), this feature is **not** AP-017 — it is an unnumbered hardening feature for
AP-009/AP-012, analogous to AP-011–AP-016. Its directory number (`017-`) is the next sequential
spec directory number only, per this repository's numbering convention.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Team Tries ApiPilot Together Without Colliding (Priority: P1)

As a QA engineer demonstrating ApiPilot to my team, I want each teammate who opens the app at
the same time to get their own independent guided workflow, so that one person uploading a
specification, generating scenarios, or making review decisions never overwrites, hides, or
corrupts what anyone else on the team is doing at the same moment.

**Why this priority**: This is the entire premise of the feature. Without it, the guided
workflow (AP-009) is unusable by more than one person at a time against the same running
instance — exactly the failure mode that motivated this request.

**Independent Test**: Open the application from two different browsers (or two devices) at the
same time. In browser A, upload specification X and advance through analysis. In browser B,
upload a different specification Y and advance through analysis. Confirm browser A still shows
only specification X's data and progress, and browser B still shows only specification Y's data
and progress, at every stage.

**Acceptance Scenarios**:

1. **Given** two people open ApiPilot in separate browsers at the same time, **When** each
   uploads a different OpenAPI specification, **Then** each person's screen shows only their own
   specification, generated scenarios, and review decisions, throughout the entire guided
   workflow.
2. **Given** person A is midway through reviewing generated scenarios, **When** person B starts
   a brand-new workflow by uploading a specification, **Then** person A's review progress and
   decisions are unaffected and remain exactly as they left them.
3. **Given** person A and person B both reach AI-assisted enhancement at the same time,
   **When** each watches their own run's batch-by-batch progress (AP-012), **Then** each sees
   only their own workflow's progress, never the other person's.

---

### User Story 2 - My Own Progress Survives a Reload or a Second Tab (Priority: P2)

As a QA engineer using ApiPilot alone, I want reloading the page or opening a second tab in the
same browser to resume my own in-progress workflow exactly as it is today, so that isolating
other people's sessions from mine does not cost me the continuity I already rely on.

**Why this priority**: This preserves an existing, already-relied-upon guarantee
(`specs/009-e2e-test-generation-workflow` FR-014: the workflow survives a reconnect). Isolating
concurrent users must not regress the single-user experience.

**Independent Test**: Start a workflow, advance a few stages, reload the page (and separately,
open a new tab to the same application in the same browser). Confirm the same in-progress
workflow — same stage, same data, same decisions so far — is shown both times.

**Acceptance Scenarios**:

1. **Given** a user has an in-progress workflow, **When** they reload the page, **Then** they
   see the same workflow resume at the same stage, unchanged from today's behavior.
2. **Given** a user has an in-progress workflow open in one tab, **When** they open a second tab
   to the application in the same browser, **Then** the second tab shows the same in-progress
   workflow, not a separate empty one.

---

### User Story 3 - A Lost or New Session Starts Clean, Never on Someone Else's Data (Priority: P3)

As a QA engineer, I want a browser that has never connected before (or that has lost its prior
session, e.g. after clearing cookies) to start with no in-progress workflow, so that I can never
accidentally land on a stranger's in-progress work.

**Why this priority**: This is a safety/correctness backstop for the isolation guarantee in
User Story 1 — it matters less often than the core concurrent-use case, but a failure here is a
data-exposure defect, not just an inconvenience.

**Independent Test**: Connect with a browser session that has no prior workflow (e.g. a fresh
private/incognito window) while another session already has an in-progress workflow. Confirm
the new session shows the existing "no workflow started" state, never the other session's data.

**Acceptance Scenarios**:

1. **Given** another session already has an in-progress workflow, **When** a brand-new session
   connects for the first time, **Then** it sees the standard "no workflow started yet" state,
   never the other session's workflow.
2. **Given** a session's identifying information is lost (e.g., cookies cleared) mid-workflow,
   **When** that browser makes its next request, **Then** it is treated as a new session with no
   in-progress workflow — it is never silently reattached to its own prior workflow or to any
   other session's workflow.
3. **Given** a session's workflow was discarded because that session was idle for over 60
   minutes (FR-007), **When** that same browser returns and makes its next request, **Then** it
   sees an explicit notice that its previous session expired due to inactivity, distinguishing
   this case from a browser that never started a workflow.

### Edge Cases

- What happens when two sessions' workflows are active at once and the backend process
  restarts? Every session's in-progress workflow is lost, exactly as today's single-instance
  behavior already allows (no persistence is introduced by this feature).
- What happens when the same person uses two different browsers (or one regular and one private
  window)? Each is treated as a fully independent session with its own workflow; this feature
  does not introduce login, so there is no way to recognize both as "the same person" or merge
  their workflows.
- What happens to a session's in-progress workflow if that browser is closed and never comes
  back? See FR-007 — it is eventually discarded rather than retained forever, so many short-lived
  sessions (e.g. a team demo) do not accumulate indefinitely for the life of the backend process.
- What happens when a session tries to resume a workflow after that session's workflow has
  already been discarded for inactivity? It sees an explicit "session expired" notice rather
  than the plain "no workflow started yet" state a genuinely new session sees (FR-007a, User
  Story 3).
- Does isolating workflow state also isolate the local AI model itself? No — see FR-005: the
  underlying AI provider's readiness/loading state and its single serialized inference queue
  (`specs/004-ai-provider-local-inference`) remain one shared, process-wide resource; only
  workflow progress, review decisions, and generated content are isolated per session.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow two or more browser sessions to each run their own
  independent in-progress guided test-generation workflow at the same time, with no session's
  actions (uploading, generating, reviewing, approving, exporting) visible to or capable of
  altering another session's workflow.
- **FR-002**: The system MUST continue to let a single browser session retain and resume its own
  in-progress workflow across page reloads and across multiple tabs opened in that same browser,
  matching the continuity already guaranteed today (`specs/009-e2e-test-generation-workflow`
  FR-014) for the single-user case.
- **FR-003**: Within one session, starting a new guided workflow MUST replace only that same
  session's own prior workflow (matching today's "starting a new workflow replaces the current
  one" behavior) — it MUST NOT affect any other session's workflow.
- **FR-004**: The system MUST distinguish sessions from one another without requiring the user to
  log in, register, or provide any personally identifying information.
- **FR-004a**: Session identifiers MUST be cryptographically random and unguessable — no
  concurrent session may feasibly derive, guess, or enumerate another active session's
  identifier, since the identifier is the only boundary protecting one person's workflow from
  another in a system with no login (FR-010).
- **FR-005**: The system MUST keep the local AI provider's readiness/model-loading state and its
  single serialized inference request queue (`specs/004-ai-provider-local-inference`) as one
  shared, process-wide resource, unaffected by session isolation — only workflow progress,
  review decisions, and generated content are isolated per session.
- **FR-006**: If a session's identifying information is lost or absent (e.g., a browser that has
  never connected, or one that has cleared its cookies), the system MUST treat its next request
  as belonging to a brand-new session with no in-progress workflow — it MUST NOT attach that
  request to any existing session's workflow.
- **FR-007**: The system MUST discard a session's in-progress workflow after 60 minutes of no
  requests from that session, so that abandoned sessions (e.g. from a team demo that has ended)
  do not accumulate for the life of the backend process. A session that is still active resets
  this window on every request, exactly like a standard idle-session timeout.
- **FR-007a**: When a session whose workflow was discarded for inactivity (FR-007) makes its
  next request, the system MUST distinguish that case from a genuinely new session by showing an
  explicit notice that its previous session expired due to inactivity, rather than an
  indistinguishable "no workflow started yet" empty state.
- **FR-008**: The system MUST NOT persist any session's workflow state to durable storage as
  part of this feature — an isolated session's workflow remains in-memory only, and a backend
  restart still clears every session's workflow, unchanged from today's behavior
  (`specs/009-e2e-test-generation-workflow` FR-014/FR-016).
- **FR-009**: The AI-enhancement progress visibility already provided by
  `specs/012-ai-enhancement-progress` (batch-level progress, scenarios revealed as each batch
  succeeds, one unambiguous final status) MUST continue to function correctly per session, so
  each session watching an enhancement run in progress sees only its own run's progress.
- **FR-010**: The system MUST NOT expose one session's uploaded specification, discovered APIs,
  generated scenarios, review decisions, dependency analysis, approved workflows, or exported
  artifacts to any other session, under any sequence of concurrent requests.

### Key Entities *(include if feature involves data)*

- **Session**: The boundary introduced by this feature. Corresponds to one browser (not one tab
  or one page load); holds at most one in-progress `TestGenerationWorkflow` at a time, exactly
  as the whole backend does today; carries no personally identifying information and is not tied
  to a login or user account.
- **TestGenerationWorkflow** *(existing, `specs/009-e2e-test-generation-workflow`)*: Unchanged in
  shape and behavior — this feature changes only how many instances of it may exist at once
  (one per active session instead of one per backend process) and which requests may read or
  mutate a given instance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two or more people can each complete the entire guided workflow (upload through
  exporting a Postman collection) independently and correctly at the same time against the same
  running instance, with zero instances of one person's data appearing on another person's
  screen.
- **SC-002**: A person using the application alone experiences no change in behavior when
  reloading the page or opening a second tab — their own in-progress workflow resumes exactly as
  it does today, in 100% of such reloads/second-tab opens.
- **SC-003**: With up to 20 people using the application at the same time, none of them
  experience slowdown or failure caused by the others' activity, for a multi-hour session in
  which participants join and leave at different times — abandoned sessions stop consuming
  workflow memory within one hour of the last activity from that session.
- **SC-004**: Across a full audit of every guided-workflow stage (analysis, deterministic
  generation, AI enhancement, scenario review, dependency analysis, workflow review, Postman
  export), no uploaded specification, generated content, or review decision from one concurrent
  session is ever readable from a different session.

## Assumptions

- A "session" corresponds to one browser, not one tab: reloading the page or opening additional
  tabs in the same browser continues to resume the same workflow, matching today's single-user
  continuity guarantee. This directly follows from the feature description's own framing
  ("preserving the existing single-instance behavior for a single user across page reloads/tabs
  within their own session").
- This feature introduces session *isolation*, not user *authentication*: there is no login, no
  user accounts, and no way to recognize the same person across two different browsers/devices —
  each is simply a separate, independent session. This matches the product's current local-first,
  account-free design; adding real multi-user accounts and access control is a materially larger
  change explicitly out of scope here.
- A 60-minute idle-session retention window (FR-007) is used as a reasonable default for bounding
  memory growth from abandoned sessions, consistent with common session-timeout conventions. This
  is a business-tunable parameter, not a hard architectural constraint, and may be revisited
  during `/speckit-plan` or later hardening.
- The feature targets small-team scale (comfortably up to ~20 concurrent sessions), matching the
  team-demo scenario that motivated it. No explicit maximum-session cap or eviction-under-memory-
  pressure policy is required beyond the idle-eviction already specified (FR-007); larger-scale
  concurrency is out of scope and would need its own follow-up if it becomes a real requirement.
- The local AI model, its readiness state, and its inference queue remain global/shared
  infrastructure (per `specs/004-ai-provider-local-inference`); this feature does not attempt to
  run multiple concurrent model instances or otherwise partition AI inference capacity per
  session.
- This feature is primarily a backend isolation boundary; the only user-facing addition is the
  small "your previous session expired" notice (FR-007a) shown on the existing empty state — no
  new screen, page, or workflow stage is introduced.
