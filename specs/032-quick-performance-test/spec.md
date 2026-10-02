# Feature Specification: Quick Performance Test from a Specification

**Feature Branch**: `[032-quick-performance-test]`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Quick performance test from specification. Add a new start-screen
entry point, next to "Import & Run Collection" (AP-026), that goes from an uploaded OpenAPI
specification straight to the existing k6 performance plan (AP-029), without the guided workflow's
API review, scenario approval, AI enhancement, dependency/workflow review or Postman generation
stages. [...] Write operations (POST, PUT, PATCH, DELETE) are included by default but must be shown
prominently [...] Environments [...] must be usable from this path even though no Postman
collection was generated [...] Also in the guided workflow's Performance Testing stage, remove the
"API review selection / All analyzed operations" scope toggle [...]" (full text in the
`/speckit-specify` request of 2026-09-27)

**Product identifier**: `AP-032` (post-MVP). This spec directory is numbered `032` per the
repository's sequential feature-directory convention; the directory number and the `AP-###`
identifier happen to coincide here but remain independent. `AP-032` is the canonical identifier
used in cross-references, commit messages, and `specs/ROADMAP.md`.

**Relationship to prerequisite specifications**: This feature adds a second way into the k6
performance test of AP-029 (`specs/031-k6-performance-testing`). It reuses, unchanged:
- specification upload, parsing, validation and analysis (AP-001, AP-002);
- deterministic positive-scenario generation (AP-003), without its review step;
- the credential producers (AP-021, AP-023, AP-024) and parameter serialization (AP-022);
- the AP-029 performance plan, script generation, run, live progress and report;
- environments and tiers (AP-017), their encrypted local storage (AP-025), and the session-wide
  "one execution in progress" slot (AP-017, AP-026);
- the start screen's entry chooser and its "Back to start" pattern (AP-009, AP-026) and the shared
  UI components (AP-027).

It changes three existing decisions, each stated as a requirement below:
- AP-029 builds only on the *approved* test model; this path builds on *generated* positive
  scenarios that no one approved (FR-004, FR-005);
- AP-017's environments are available only once a guided workflow's Postman collection has been
  generated (AP-029 research D1 kept that gate); this feature opens them to the quick path too
  (FR-016 to FR-018);
- AP-029 FR-001 offers the choice between the API review's selection and all analyzed operations;
  this feature removes that choice from the guided workflow (FR-022, FR-023).

**Governance**: Running the generated script from within ApiPilot is permitted only by the
constitution's XVII exception of 2026-09-24 as extended on 2026-09-27 (v2.4.0), which names this
feature. For a quick plan, "approved" means the user reviewed the plan, with every write
operation it will send listed on the plan and at the run trigger (FR-009, FR-011), and then
triggered the run. Every condition of the exception is a requirement of this spec, through
AP-029's requirements that FR-020 keeps unchanged:
- the per-run user trigger, naming its target, and no automatic runs (AP-029 FR-024, FR-025);
- only the unmodified generated script runs (AP-029 FR-026);
- a user-installed k6 (AP-029 FR-027);
- no secrets in the script (AP-029 FR-021, FR-008 here);
- local-only results and no AI (AP-029 FR-033, FR-041; FR-004 here);
- a statement of where the load comes from (AP-029 FR-028).

What the quick path does not have is scenario approval (constitution XI); the requirements on
write operations and request visibility (FR-008 to FR-013) are what the extension rests on.
Generating the script alone does not depend on the exception.

## Clarifications

### Session 2026-09-27

- Q: When a quick performance test is started while a guided workflow is in progress in the same
  session, what happens to that workflow? → A: Both coexist. The quick test keeps its own state,
  and the guided workflow is untouched and can still be resumed, as with AP-026's Import & Run
  (FR-021).
- Q: Is the constitution's XVII exception for running generated k6 scripts amended to name the
  quick path, or read as already covering it? → A: Amended before `/speckit-plan` (MINOR) so the
  exception names AP-032's quick plan, with all of its existing conditions unchanged (Governance,
  FR-020). Done in constitution v2.4.0.
- Q: Do the write-operation summary, the request preview and the readable lists also appear in the
  guided workflow's Performance Testing stage? → A: Yes, in both paths, on the one shared plan
  screen (FR-012a, FR-024).
- Q: Is an operation the plan's authentication uses to acquire credentials (a detected login or
  token operation) a load-tested journey by default in the quick plan? → A: No. It starts in the
  removed list with the reason "used to acquire the run's credentials" and can be restored. Only
  operations the existing credential producers identify start removed; nothing is guessed by name
  (FR-003a).

### Session 2026-09-28

- Q: Where are removed and left-out operations shown, and can a removed operation's details be
  seen? → A: In the operations table, as its own counted views beside the plan's steps, not as
  separate lists. A removed operation opens, like a step, to the step and request it would have if
  restored, read-only, and can be restored from there (FR-024, FR-024a). Decided with the product
  owner after the separate lists proved hard to read on a large specification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Go from a specification to a performance plan in one step (Priority: P1)

A QA engineer wants to know how an API behaves under load and has only its OpenAPI specification.
They do not want to review scenarios, approve workflows or generate a Postman collection first.
On the start screen they choose **Quick performance test**, upload the specification, and land on
the performance plan. Every analyzed operation that has a positive scenario is a single-step
journey, with its method, path, the request it will send and its expected statuses. Operations
that cannot be tested are listed with the reason. The engineer removes what they do not want,
sets the load profile and thresholds, and generates the k6 script.

**Why this priority**: This is the feature. Today the only way to a performance test runs through
every stage of the guided workflow, even when the engineer only wants to load the API as
specified. Without this story nothing else in this spec has a place to live.

**Independent Test**: With no k6 installed, upload a specification with at least ten operations
through the quick path. Verify that the plan appears without any review stage, that every
operation with a positive scenario is a single-step journey, that the others are listed with
their reason, and that generating twice gives byte-identical files with no secrets in them.

**Acceptance Scenarios**:

1. **Given** the start screen, **When** the engineer looks at the entry points, **Then** a
   "Quick performance test" entry is offered next to "Import & Run Collection", with a short
   statement that it runs every operation of the specification under load without scenario
   review.
2. **Given** a valid OpenAPI 3.x specification with twelve operations, all of which have a
   positive scenario, **When** the engineer uploads it through the quick path, **Then** the
   performance plan opens with twelve single-step journeys and no dependency chaining, and no
   API review, scenario review, AI enhancement, workflow review or Postman generation stage is
   shown.
3. **Given** an operation for which no positive scenario can be generated, **When** the plan is
   built, **Then** that operation is not a journey and is listed as left out, with its method,
   path and the reason.
4. **Given** the same specification uploaded twice through the quick path, **When** both plans are
   built with the same edits and the script is generated, **Then** both scripts and environment
   templates are byte-identical.
5. **Given** a malformed or unsupported document (for example invalid YAML or Swagger 2.0),
   **When** it is uploaded through the quick path, **Then** the same error the guided workflow
   gives is shown and no plan is created.
6. **Given** a specification whose operations are secured by a token from `POST /auth/login`,
   **When** the quick plan is built, **Then** `POST /auth/login` is not a journey, is listed as
   removed with the reason "used to acquire the run's credentials", and can be restored; the
   secured operations are journeys whose authentication is "Token from a login request".
7. **Given** a plan in the quick path, **When** the engineer inspects a step, **Then** they can see
   the request it will send: method, path template, the path, query and header parameters with
   their generated values or the environment value they need, and the body, with secret values
   never shown.

---

### User Story 2 - See clearly what write operations will do before loading the target (Priority: P1)

The quick path skips scenario approval, so no one has looked at the requests that change data.
Under load those requests are sent again and again. The engineer needs to see, before generating
the script and again next to the run trigger, how many write operations are in the plan, which
ones they are, and what they will do to the target. They can remove any of them one at a time, or
all of one method or all writes at once.

**Why this priority**: Write operations are included by default (AP-029 FR-004, kept here by the
user's decision of 2026-09-27). Without review, prominence is the safeguard that stops an engineer
from unknowingly sending thousands of deletes to a shared environment. It ships with Story 1.

**Independent Test**: Build a quick plan from a specification with GET, POST, PUT, PATCH and
DELETE operations. Verify the write summary above the journeys and next to the run trigger, the
per-step marking, and that bulk and single removal and restore each update the summary.

**Acceptance Scenarios**:

1. **Given** a quick plan with 40 operations, 15 of them write operations, **When** the plan is
   shown, **Then** a summary above the journeys states "15 write operations will be sent" with a
   count per method, lists each one by method and path, and states in words that each is sent by
   every virtual user on every iteration for the whole run, so records are created, changed or
   deleted repeatedly and are not cleaned up.
2. **Given** that plan, **When** the engineer looks at any write step, **Then** the step carries a
   text marker naming what it does (for example "Creates", "Replaces", "Updates", "Deletes") in
   addition to its method badge, so the meaning never depends on colour alone.
3. **Given** that plan, **When** the engineer chooses "Remove all DELETE operations" or "Remove all
   write operations", **Then** those operations leave the plan in one action, the summary updates,
   and they appear in the removed list from which they can be restored.
4. **Given** a plan with write operations, **When** the run controls are shown, **Then** the same
   write summary (count per method and each write operation by method and path) is shown next to
   the trigger that names the target environment.
5. **Given** a plan with no write operations, **When** it is shown, **Then** the summary states
   that the plan sends only read requests.

---

### User Story 3 - Supply values and run without a guided workflow (Priority: P1)

The engineer picks or creates a target environment from within the quick plan, enters the values
the specification cannot produce (base URL, credentials, path parameters), and runs the test on
their installed k6. The run, its live progress and its report behave exactly as in AP-029.

**Why this priority**: Without environments the quick plan cannot run anything. Today environments
are only available once a guided workflow has generated its Postman collection, which the quick
path never does.

**Independent Test**: In a fresh session, with no guided workflow started, open a quick plan,
create an environment from it, enter the listed values, and run the test with k6 installed.
Verify the checklist of values, the run and the report.

**Acceptance Scenarios**:

1. **Given** a fresh session with no guided workflow, **When** the engineer opens the target
   environment panel of a quick plan, **Then** they can create, edit and choose an environment,
   and the values checklist shows each needed value as present or missing for that environment.
2. **Given** an environment created from the quick path, **When** the engineer later starts a
   guided workflow in the same session and reaches a stage that uses environments, **Then** that
   environment is listed there too, and the reverse also holds.
3. **Given** a quick plan whose script is current and k6 is ready, **When** the engineer triggers
   the run naming the target environment, **Then** the run proceeds, is shown and is reported as
   in AP-029, and the report records that the plan came from the quick path with generated,
   unreviewed scenarios.
4. **Given** a functional run or another performance run already in progress in the session,
   **When** the engineer triggers a quick run, **Then** it is refused with the same reason AP-029
   gives, because both share the one-execution slot.

---

### User Story 4 - The guided workflow uses its own selection only (Priority: P2)

In the guided workflow's Performance Testing stage, the engineer is no longer offered "API review
selection" and "All analyzed operations". The plan always uses the operations chosen in API
review, or every operation when none were chosen. The list of left-out operations no longer fills
with operations that were never going to have scenarios.

**Why this priority**: The toggle offers a choice that changes nothing runnable: test design only
generates scenarios for the selected operations, so "All analyzed operations" only adds operations
that are always left out with "no positive scenario". It is confusing, but it does not block
anything, so it follows the quick path, which is where "all operations" now lives.

**Independent Test**: Complete a guided workflow with a selection of five out of twenty operations.
Verify the Performance Testing stage offers no scope choice, the plan has the five operations, and
none of the other fifteen is listed as left out.

**Acceptance Scenarios**:

1. **Given** a guided workflow whose API review selected five of twenty operations, **When** the
   Performance Testing stage opens, **Then** no scope choice is shown, the plan covers those five
   operations, and the other fifteen are not listed as left out.
2. **Given** a guided workflow whose API review selected no subset, **When** the stage opens,
   **Then** the plan covers every operation, as before.
3. **Given** the guided workflow's Performance Testing stage, **When** the engineer wants to
   include operations outside the selection, **Then** the stage says how: widen the selection in
   API review and regenerate, or use the quick performance test.
4. **Given** a guided-workflow plan with write operations, **When** the stage is shown, **Then** it
   has the same write summary, effect markers and request preview as the quick path.

---

### User Story 5 - Readable lists at real scale (Priority: P3)

A specification with a hundred operations must still give a plan the engineer can read and act on.
The left-out and removed operations are shown as counted, collapsible lists with one operation per
line, not as one run-on paragraph.

**Why this priority**: The quick path brings in every operation, so long lists become the normal
case (constitution XXXII). It improves the guided workflow's stage as well.

**Independent Test**: Build a quick plan from a specification with at least 80 operations, some
left out. Verify the lists are counted, collapsed by default when long, one operation per line
with its method badge, and that bulk removal works on the journeys.

**Acceptance Scenarios**:

1. **Given** a plan with 30 left-out operations, **When** it is shown, **Then** a collapsed
   section reads "30 operations left out" and, when expanded, lists one operation per line with
   its method, path and reason.
2. **Given** a plan the engineer has removed operations from, **When** it is shown, **Then** the
   removed operations are listed the same way, each with a restore action.

---

### Edge Cases

- **A specification with no operation that has a positive scenario**: no plan with journeys is
  built; the quick path states that nothing can be load-tested, lists every operation with its
  reason, and offers "Back to start". Nothing can be generated or run.
- **A specification with only write operations**: the plan is built; the write summary covers every
  step. There is no extra confirmation on any tier, as in AP-029 (FR-025 of AP-029).
- **Every operation removed by the engineer**: the plan has no journeys; script generation is
  disabled with the reason "the plan has no operations", and restoring any operation re-enables it.
- **Operations that depend on each other** (for example POST `/orders` and GET `/orders/{id}`): the
  quick path does not chain them. The path parameter `id` is a value the engineer supplies in the
  environment, and the plan says that the guided workflow is the way to chain requests.
- **Operations secured by OAuth2 client credentials or a login operation**: authentication is
  planned with the same credential producers as AP-029, so tokens are acquired once and shared
  (AP-029 FR-009). The login or token operation itself starts removed from the journeys, so it is
  not called by every virtual user on every iteration; the engineer can restore it (FR-003a).
  Operations such as logout or key revocation are not detected and stay in the plan, where the
  write summary shows them.
- **An operation with no documented success status**: it starts with no expected status and blocks
  script generation until the engineer sets one, as in AP-029 FR-012a. With many such operations,
  the list of steps needing a status is counted and each step is reachable from it.
- **Unsupported constructs** (callbacks, links, `oneOf`, `anyOf`, `allOf`, discriminator,
  webhooks): they are handled as the analysis already handles them, which degrades the affected
  schema node rather than dropping the operation, so the operation is still planned. Any operation
  for which no positive scenario is generated is left out with the reason "no positive scenario".
- **A guided workflow already in progress in the session**: it is not affected. The quick path is a
  separate entry and does not discard, resume or read that workflow.
- **Starting a second quick test in the same session**: the new specification replaces the
  previous quick plan after the engineer confirms; runs and reports already made are kept.
- **Backend restart**: the quick plan does not survive, as AP-029's plan does not. Environments,
  runs and reports do (AP-025, AP-029).
- **Large specifications**: the existing upload size limit applies unchanged.

## Requirements *(mandatory)*

### Functional Requirements

**Entry and scenario generation**

- **FR-001**: The start screen MUST offer a "Quick performance test" entry point alongside the
  guided workflow and "Import & Run Collection", with a one-sentence statement that it load-tests
  every operation of the uploaded specification using generated requests that no one reviews.
- **FR-002**: The quick path MUST accept an OpenAPI specification through the same upload,
  validation, size limit, parsing and analysis as the guided workflow, and MUST report the same
  errors for invalid, unsupported or oversized input. No plan MUST be created when analysis fails.
- **FR-003**: Every analyzed operation MUST be in scope by default. There MUST NOT be an API review
  or selection stage in the quick path.
- **FR-003a**: In the quick path, an operation that the plan's authentication uses to acquire its
  credentials (a login or token operation found by the existing credential producers, AP-021,
  AP-023) MUST start in the removed list with the reason "used to acquire the run's credentials",
  and MUST be restorable like any other removed operation (FR-014). Only operations identified
  that way start removed; ApiPilot MUST NOT guess by name or path (for example "logout" or
  "revoke").
- **FR-004**: For each operation in scope, the system MUST generate positive scenarios with the
  existing deterministic, rule-based generation only. No AI MUST be used, and negative scenario
  categories MUST NOT be generated for or included in the plan.
- **FR-005**: The system MUST choose one positive scenario per operation with AP-029's fixed rule
  (lowest scenario identifier among rule-generated scenarios) and record the choice. An operation
  with no positive scenario MUST be left out and listed with its method, path and reason.
- **FR-006**: Every operation in the quick plan MUST be its own single-step journey. The quick path
  MUST NOT infer or apply dependency chaining between operations. *(Amended 2026-10-02 by AP-035
  FR-030, specs/035-user-defined-journeys: every operation starts as its own single-step journey;
  the engineer MAY compose journeys and bind captured values. The quick path still infers nothing.)*
- **FR-007**: The same specification and the same plan edits MUST produce the same plan, and the
  same script and environment template byte for byte (constitution XVI).

**Visibility of what will be sent**

- **FR-008**: For every step, the engineer MUST be able to see the request it will send: method,
  path template, each path, query and header parameter with its generated value or the name of the
  environment value it needs, and the request body. Secret values MUST NOT be shown. The request is
  view-only in this feature.
- **FR-009**: The plan MUST show, above the journeys, a write-operation summary: the number of
  write operations (POST, PUT, PATCH, DELETE) in the plan, the count per method, and each one by
  method and path. It MUST state in words that each write is sent by every virtual user on every
  iteration for the whole run, that it creates, changes or deletes data on the target each time,
  and that ApiPilot does not clean up after the run.
- **FR-010**: Each write step MUST carry a text marker naming its effect ("Creates" for POST,
  "Replaces" for PUT, "Updates" for PATCH, "Deletes" for DELETE) in addition to its method badge.
  The marker MUST NOT rely on colour alone.
  *(FR-009 and FR-011 amended 2026-10-02 by AP-035 FR-023: the counts are per step that sends a
  write operation, so an operation in two journeys counts twice, and each is named with its
  journey.)*
- **FR-011**: The write-operation summary MUST also be shown next to the run trigger: the count per
  method and each write operation by method and path, readable without expanding a section,
  together with the target environment's name, tier and base URL that AP-029 already shows there.
- **FR-012**: A plan with no write operations MUST say that it sends only read requests.
- **FR-012a**: FR-008 to FR-012 MUST apply wherever the performance plan is shown: in the quick
  path and in the guided workflow's Performance Testing stage alike.
- **FR-013**: The report of a run started from the quick path MUST record that the plan came from
  the quick path and that its scenarios were generated and not reviewed, in addition to AP-029's
  provenance (AP-029 FR-039).

**Editing the plan**

- **FR-014**: The engineer MUST be able to remove any operation, remove all operations of one HTTP
  method in one action, and remove all write operations in one action. Removed operations MUST be
  listed and each MUST be restorable. Every removal and restore MUST update the write summary.
- **FR-015**: All other AP-029 plan editing MUST be available unchanged in the quick path: journey
  order, think time, expected statuses (AP-029 FR-012, FR-012a), load profile and stages,
  thresholds, script generation, download, and the out-of-date marking.

**Environments and values**

- **FR-016**: The engineer MUST be able to create, edit and choose a target environment from the
  quick plan without having started a guided workflow or generated a Postman collection.
- **FR-017**: Environments MUST remain one set per browser session: an environment created or
  edited in either the quick path or the guided workflow MUST be available in the other, with the
  same encrypted storage, tiers and presence checks (AP-017, AP-025, AP-029 FR-013).
- **FR-018**: Opening environments to the quick path MUST NOT change what the guided workflow
  requires before its own stages use environments, and MUST NOT expose environments to any caller
  that has neither a completed Postman generation nor a quick plan in the session. AP-034 FR-024
  (specs/034-run-user-k6-script) also opens environments to a session that holds a stored user
  script (pointer added 2026-10-01).
- **FR-019**: Values the specification cannot produce MUST be listed and handled exactly as AP-029
  FR-013 and FR-014 define, including path parameters that, without chaining, every operation
  needs from the environment.

**Running**

- **FR-020**: Runs from the quick path MUST meet every AP-029 run requirement unchanged, including
  the per-run trigger naming its target (AP-029 FR-024, FR-025), executing only the unmodified
  generated script (FR-026), the user-installed k6 (FR-027), the statement of where load comes
  from (FR-028), the shared one-execution slot (FR-029), cancellation, live progress, the report,
  and no AI (FR-041).
- **FR-021**: The quick path MUST NOT read, change, resume or discard a guided workflow in the same
  session, and a guided workflow MUST NOT read or change the quick plan. Starting a new quick test
  while a quick plan exists MUST ask the engineer to confirm replacing it; runs and reports already
  made MUST be kept.

**Guided workflow scope**

- **FR-022**: The guided workflow's Performance Testing stage MUST NOT offer a choice between the
  API review's selection and all analyzed operations. Its operations in scope MUST be the API
  review's selection, or every analyzed operation when no subset was selected. This replaces
  AP-029 FR-001.
- **FR-023**: Operations outside the guided workflow's selection MUST NOT be listed as left out.
  The stage MUST state that operations outside the selection can be included by widening the
  selection in API review, or by using the quick performance test.

**Lists at scale**

- **FR-024**: Left-out operations and removed operations MUST each be shown as a counted view of
  the operations table, beside the plan's steps, with one operation per row, its method badge,
  path and reason (or restore action). The plan's steps are shown by default, so these views start
  hidden, showing their count. This applies to both paths. (Amended 2026-09-28: previously two
  counted lists above the journeys, collapsed above ten entries.)
- **FR-024a**: The engineer MUST be able to open a removed operation and see the step and request
  it would have if restored, as FR-008 shows them for a step, without the plan changing, and MUST
  be able to restore it from there, alone, with others, or all at once. A removed operation that
  would have no positive scenario says so. This applies to both paths.
- **FR-025**: The quick path MUST offer "Back to start", which returns to the entry chooser and
  keeps the quick plan for the session, as AP-026's Import & Run does.

### Key Entities *(include if feature involves data)*

- **Quick Performance Plan**: an AP-029 Performance Plan whose source is an uploaded specification
  rather than a guided workflow. It records its source kind ("quick") so the plan screen, run
  controls and report can say that its scenarios were generated and not reviewed. It holds every
  analyzed operation with a positive scenario as a single-step journey, the left-out operations
  with reasons, the operations the engineer removed, and everything else an AP-029 plan holds. One
  per browser session; it does not survive a backend restart.
- **Write-Operation Summary**: derived from the plan's steps: the number of write steps, the count
  per method, and each step's method, path and effect. Recomputed on every plan change; never
  stored separately.
- **Step Request Preview**: the view-only request of one step, derived from its chosen scenario:
  path template, parameters with generated values or the names of needed environment values, and
  the body. It never contains a secret value.
- **Environment** (existing, AP-017): unchanged. Scoped to the browser session and shared by the
  guided workflow and the quick path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An engineer can go from the start screen to a generated k6 script for a specification
  of 50 operations in under 3 minutes, passing through no review or approval stage.
- **SC-002**: For any plan, the number of write operations, the count per method, and each write
  operation's method and path are readable on the plan screen and next to the run trigger without
  opening a step or expanding a section.
- **SC-003**: An engineer can remove every write operation from a plan of 100 operations in one
  action, and every DELETE operation in one action.
- **SC-004**: Generating the script twice from the same specification and the same plan edits gives
  byte-identical output in 100% of runs, and no generated file contains a secret value.
- **SC-005**: In the guided workflow's Performance Testing stage, zero operations outside the API
  review's selection appear in the plan or in its left-out list.
- **SC-006**: An environment created in either path is available in the other in 100% of cases
  within the same session, and no environment is reachable in a session that has neither a
  completed Postman generation nor a quick plan.

## Assumptions

- The default for write operations was decided by the user on 2026-09-27: they stay included by
  default and are shown prominently (FR-009 to FR-011). There is no extra confirmation step before
  a run on any tier, consistent with AP-029's clarification that the user is responsible for the
  load they configure.
- The write summary and effect markers, the request preview (FR-008 to FR-012a) and the readable
  lists (FR-024) are shown in both paths, because both use the same plan screen and guided-workflow
  runs send the same repeated writes (Clarifications 2026-09-27).
- The quick path is independent of the guided workflow, like AP-026's Import & Run (its
  clarification of 2026-09-20): both can exist in one session, and each keeps its own state
  (Clarifications 2026-09-27).
- The number of requests a run will send cannot be known in advance, because it depends on response
  times; the write summary therefore describes repetition in words and does not estimate counts.
- The quick path chooses among rule-generated positive scenarios only; AP-029's preference for
  rule-generated over AI-enhanced scenarios is trivially satisfied because no AI-enhanced scenario
  exists here.
- Deprecated operations are analyzed and planned like any other; the engineer can remove them.
- The XVII exception of 2026-09-24 was extended to name AP-032 in constitution v2.4.0
  (2026-09-27), as was done for AP-029 (Clarifications 2026-09-27). The extension adds the quick
  plan as a permitted source and changes none of the exception's conditions.
- Out of scope: editing a step's request (headers, query or body), dependency chaining in the quick
  path, turning a quick plan into a guided workflow, AI enhancement in the quick path, and
  uploading a Postman collection or k6 script as a source.
