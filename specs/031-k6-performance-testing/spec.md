# Feature Specification: k6 Performance Testing

**Feature Branch**: `[031-k6-performance-testing]`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "Ap-029" (the AP-029 entry in `specs/ROADMAP.md`, "AP-029 — k6
Performance Testing", with its decisions of 2026-09-23 in Next Actions #24)

**Product identifier**: `AP-029` (post-MVP, per `specs/ROADMAP.md`). This spec directory is
numbered `031` per the repository's sequential feature-directory convention. The directory number
and the `AP-###` identifier are independent, as with AP-030 (`specs/029-execution-gap-closure`)
and AP-031 (`specs/030-ai-failure-analysis`). `AP-029` is the canonical identifier used in
cross-references, commit messages, and `specs/ROADMAP.md`.

**Relationship to prerequisite specifications**: This feature builds a performance test from the
same approved scenarios and workflows the functional tests use. It reuses:
- positive scenarios (AP-003) and the API review's operation selection (AP-009);
- dependency workflows, ordering and variable chaining (AP-008, AP-016, AP-019);
- the credential producers for OAuth2 client credentials, chained login and distinct per-role
  credentials (AP-021, AP-023, AP-024);
- parameter serialization (AP-022);
- environments, environment tiers and the session-wide "one execution in progress" slot
  (AP-017, AP-026);
- local persistence (AP-025) and the shared UI components (AP-027).

It changes none of their contracts.

**Governance**: Running the generated script from within ApiPilot is permitted only by the
constitution's XVII exception of 2026-09-24 (v2.3.0). Every condition of that exception is a
requirement of this spec:
- the per-run user trigger, naming its target, and no automatic runs (FR-024, FR-025);
- only the unmodified generated script runs (FR-026);
- a user-installed k6 (FR-027);
- no secrets in the script (FR-021);
- local-only results and no AI (FR-033, FR-041);
- a statement of where the load comes from (FR-028).

Generating the script alone does not depend on the exception.

## Clarifications

### Session 2026-09-24

- Q: Are write operations (POST, PUT, PATCH, DELETE) included by default, or only when the user
  opts in? → A: Included by default, like read operations. Every operation in the selection is in
  scope unless the user removes it (FR-004).
- Q: How is token expiry during long (soak) runs handled? → A: When the producer's response states
  the token's lifetime, a new token is acquired through the same producer before it expires, and
  each refresh is shown in the report. A token with no stated lifetime is not refreshed, and
  failures after it expires are reported as authentication errors (FR-015).
- Q: Is there a maximum number of virtual users or run duration? → A: No. ApiPilot applies no limit
  and no warning; the user is responsible for the load they configure (FR-019).
- Q: Where are the values the specification cannot produce entered and kept? → A: As variable
  values of the target environment, in the existing environments feature. They are stored
  encrypted, survive a restart, and each environment keeps its own values. The plan shows which
  are present for the chosen environment (FR-013).
- Q: When the browser is closed or idle during a long run, does the run continue and keep its
  session alive? → A: Yes. The run continues on the server regardless of the browser. While a run
  is in progress its session is not removed for being idle, and the normal 60-minute idle timeout
  applies again once the run ends (FR-034a).
- Q: Should ApiPilot clean up records that write operations create during a run? → A: No automatic
  cleanup. The report lists, per operation and method, how many write requests were sent and how
  many succeeded (FR-036a).

### Session 2026-09-25

- Q: k6 virtual users share no memory, so a refreshed token cannot be shared by all of them as the
  first one is. How is a token with a stated lifetime refreshed? → A: The first token is still
  acquired once and shared (FR-009). Each virtual user then acquires its own replacement through the
  same producer before its current token expires, and the report shows how many refreshes happened
  and when. This costs one token request per virtual user per token lifetime, not one in total
  (FR-015, Assumptions).
- Q: FR-003 prefers a rule-generated positive scenario, but the Postman generator takes the lowest
  scenario identifier regardless of origin, so the two can send different requests for the same
  operation. Which rule applies? → A: FR-003 is kept. Aligning Postman's selection with it is a
  separate follow-up outside this feature. Until then, FR-011's match with Postman holds for the
  same scenario, not necessarily the same choice (FR-011, Assumptions).
- Q: When a plan has several journeys, does each virtual user run all of them in plan order on
  every iteration, or are the virtual users divided among the journeys? → A: On each iteration,
  every virtual user runs every journey in plan order. A journey that is cut short skips only its
  own remaining steps, and the virtual user moves on to the next journey (FR-006a, FR-010).
- Q: Which responses count as failures for a step, including a step whose specification documents
  no success status? → A: Each step has one or more expected status codes, and any other response
  is a failure. The expected codes start as the success statuses the specification documents, and
  the user can change them. A step with no documented success status starts empty and must be set
  by the user before the script can be generated; the plan lists the steps that still need one
  (FR-012, FR-012a).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a performance test from approved scenarios and workflows (Priority: P1)

A QA engineer has analyzed a specification, approved its scenarios and its dependency workflows,
and wants to know how the API behaves under load. They open performance testing, choose the
operations in scope (the API review's selection, or all analyzed operations), pick a load profile,
and set their own pass/fail thresholds. ApiPilot proposes the journeys: each approved workflow
becomes a multi-step journey in dependency order, and each remaining operation becomes a
single-step journey. ApiPilot lists every value the specification cannot produce, which step needs
it, and whether it has been supplied. It then generates a k6 script and an environment template
that the engineer can download.

**Why this priority**: The plan and script are the foundation of the feature. Without them there
is nothing to run or report on, and a deterministic, explainable script is useful on its own, for
review and as a versioned artifact.

**Independent Test**: With no k6 installed, generate a plan and script for a specification with at
least one approved workflow. Verify the selected scenarios, the journey order, the listed
user-supplied values, and that generating twice from the same plan gives byte-identical files with
no secrets in them.

**Acceptance Scenarios**:

1. **Given** approved scenarios for five selected operations, two of which form an approved
   workflow, **When** the engineer opens performance testing, **Then** the proposed plan has one
   two-step journey in dependency order and three single-step journeys, and each step shows the
   one positive scenario used and why it was chosen.
2. **Given** an operation with two positive scenarios, one rule-generated and one AI-enhanced,
   **When** the plan is built, **Then** the rule-generated scenario is used and the plan records
   that reason.
3. **Given** a step whose path parameter no operation produces, **When** the plan is shown,
   **Then** the value is listed as user-supplied, with the step that needs it and a "missing"
   status until the engineer supplies it.
4. **Given** a completed plan, **When** the script is generated twice without changes, **Then** the
   two scripts are byte-identical, and neither the script nor the environment template contains a
   credential, token or other secret value, even one the engineer has supplied.
5. **Given** the engineer picks the "load" profile, **When** the profile is shown, **Then** its
   stages (virtual users, ramp time, duration) are shown as editable numbers, and no pass/fail
   threshold is set until the engineer sets one.
6. **Given** a step whose specification documents 201 and another whose specification documents no
   success status, **When** the plan is shown, **Then** the first step's expected status is 201 and
   can be changed, the second is listed as needing an expected status, and the script cannot be
   generated until the engineer sets it.

---

### User Story 2 - Run the test from within ApiPilot and follow its progress (Priority: P2)

With a generated script, the engineer chooses a target environment and triggers the run. The
trigger names its target, for example "Run on payments-prod (production)". ApiPilot shows whether
k6 is available before the run. During the run it shows elapsed time against planned duration,
current virtual users and requests so far, and the engineer can cancel it. When the run ends, its
results are kept.

**Why this priority**: Running from within ApiPilot is a confirmed product requirement (decision
2026-09-23). It turns a downloaded file into a measured result without leaving the tool, but it
depends on User Story 1's script.

**Independent Test**: With k6 installed and a local stub target, trigger a run of a generated
script. Verify that the run starts only on the trigger, that progress updates during the run, that
cancelling stops load generation, and that the run and its results are still listed after a
backend restart.

**Acceptance Scenarios**:

1. **Given** k6 is not installed, **When** the engineer opens the run controls, **Then** the run
   trigger is unavailable and a readiness message says k6 was not found, while the script can still
   be downloaded.
2. **Given** a generated script and a production environment, **When** the engineer triggers the
   run, **Then** it starts with no extra confirmation step, and the environment's name, tier (as a
   text label) and base URL are shown next to the trigger and throughout the run.
3. **Given** a running test, **When** the engineer cancels it, **Then** load generation stops, the
   run is recorded as cancelled, and results measured up to that point are kept.
4. **Given** another execution is already in progress in the session, **When** the engineer
   triggers a performance run, **Then** it is refused with a message saying another run is in
   progress, and nothing is sent to the target.
5. **Given** a script was generated, **When** no one triggers it, **Then** no run ever starts: not
   on generation, not after a backend restart, not on a schedule and not as a retry.
6. **Given** a 30-minute run and a token whose producer states a 10-minute lifetime, **When** the
   run proceeds, **Then** each virtual user acquires a new token before its current one expires, no
   request fails because the token expired, and the report shows how many refreshes happened and
   when.

---

### User Story 3 - Understand the result through an explainable report (Priority: P3)

When the run ends, ApiPilot presents a report automatically and offers it as a self-contained HTML
download. Per journey and per step it shows latency percentiles, throughput, error rate by status
and failure category, and check pass rate, with a timeline of virtual users against latency and
errors. Plain-language findings, produced by fixed rules from the measured data, point to what
matters, such as the slowest step or where failures start. Every step carries its provenance.

**Why this priority**: The report is where the engineer gets the answer, but it is only reachable
once a run exists (User Story 2).

**Independent Test**: From a recorded run result (no live target needed), produce the report.
Verify the metrics, that findings are identical for the same data, that every step has provenance,
that the report opens with no network access, and that it contains no secrets or bodies.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the report is presented, **Then** each step shows p50, p90,
   p95 and p99 latency, throughput, error rate by status and failure category, and check pass rate.
2. **Given** thresholds set by the engineer, **When** the report is presented, **Then** each
   threshold shows passed or failed against the measured value. **Given** no thresholds, **Then**
   the report says none were set and gives no pass/fail verdict.
3. **Given** the same run data, **When** the report is produced twice, **Then** the findings are
   identical.
4. **Given** the downloaded report, **When** it is opened on a machine with no network access,
   **Then** it renders completely.
5. **Given** any report, **When** it is inspected, **Then** it contains no credentials, tokens,
   request bodies or response bodies.

---

### User Story 4 - Adjust the journey order and pacing (Priority: P4)

The engineer can reorder steps within a journey, reorder journeys, and set an optional think time
between steps. A reorder that would place a step before the step that produces a variable it
consumes is rejected, naming the variable it would break.

**Why this priority**: The proposed order is already valid, so adjustment refines a working plan
rather than enabling one.

**Independent Test**: In a plan with a two-step workflow, try to move the consumer before the
producer and verify the rejection message names the variable. Reorder two independent journeys and
verify the new order is kept in the regenerated script.

**Acceptance Scenarios**:

1. **Given** a journey where step 2 consumes `orderId` produced by step 1, **When** the engineer
   moves step 2 above step 1, **Then** the change is rejected with a message naming `orderId`, and
   the order is unchanged.
2. **Given** two independent journeys, **When** the engineer swaps them, **Then** the new order is
   kept, and the script is regenerated to match.
3. **Given** a think time of 2 seconds, **When** the script is generated, **Then** each virtual
   user pauses 2 seconds between steps.

---

### Edge Cases

- **Operation with no positive scenario**: it is left out of the plan and listed with the reason
  "no positive scenario", never replaced by a negative one.
- **Operation with no documented success status**: its step starts with no expected status, and the
  plan lists it as needing one. The script cannot be generated until the user sets one, so no step
  ever runs unchecked and nothing is assumed (FR-012, FR-012a; constitution I, XIX).
- **Response with a status the user did not expect**: it counts as a failure, even if the
  specification documents that status for the operation (FR-012a).
- **Missing user-supplied value at run time**: the run still starts. Each step that needs the value
  is reported as failed with the reason "missing data" and the variable's name, and nothing is sent
  for it. Steps that depend on it are reported as not attempted. Every other step runs normally.
- **Switching the target environment**: the list of user-supplied values is re-checked against the
  new environment. A value present in one environment and missing in another is shown as missing,
  and FR-014 applies if the run is triggered anyway.
- **Failed extraction during an iteration**: the rest of that journey is not attempted in that
  iteration and is counted as cut short, rather than sending an unresolved value to the next step.
  The virtual user continues with the next journey, so a failure in one journey does not stop the
  others (FR-010).
- **Values that must be unique across iterations** (for example, an email on a create operation):
  they are derived from the virtual-user and iteration numbers, so they are unique within a run and
  identical across re-runs of the same plan.
- **Plan inputs change after generation** (scenarios or workflows re-approved, or the selection,
  profile, thresholds, expected statuses, order or data changed): the script is marked out of date, and it cannot be
  run until it is regenerated.
- **k6 found but unusable** (it fails to start, or reports a version ApiPilot does not support):
  readiness shows the specific reason, and the trigger stays unavailable.
- **Target unreachable or refusing connections**: the run proceeds. Those requests are counted as
  connection failures, and a finding reports it.
- **Target rate-limits the load** (for example, 429 responses): these are counted as errors by
  status. The report does not treat them as the API being faulty.
- **Browser closed or idle during a long run**: the run continues. Its session is kept alive while
  the run is in progress, and the idle timeout restarts when the run ends, so the report is waiting
  when the user comes back (FR-034a).
- **Backend stops during a run**: on restart, the run is recorded as cancelled with a
  backend-restart reason, and it is not started again.
- **Very long or heavy runs**: the report shows aggregated measurements, not every request, so its
  size does not grow with the number of requests sent.
- **Credentials inside URLs** (for example, an API key in a query parameter): steps are identified
  by method and path template, never by the resolved URL, so no secret reaches the report, the plan
  view or the logs.
- **Token lifetime shorter than the run** (for example, a soak test): a token with a stated
  lifetime is refreshed by each virtual user before it expires. A token with no stated lifetime is
  not, so failures after its expiry are reported as authentication errors (FR-015).
- **Very large load settings** (for example, thousands of virtual users): no limit or warning is
  applied (FR-019). If the backend machine cannot sustain the load, the effect appears in the
  measurements. The report's timeline and findings show it, rather than ApiPilot refusing the run.
- **Write operations under load**: they are included by default (FR-004), so repeated creates,
  updates and deletes reach the target, including production. The plan shows each step's method,
  and the user removes any operation they do not want run. Nothing the run created is cleaned up
  afterwards. The report counts the write requests sent and succeeded per operation and method
  (FR-036a).

## Requirements *(mandatory)*

### Functional Requirements

**Scope and scenario selection**

- **FR-001**: The operations in scope MUST be the API review's explicit selection, or every
  analyzed operation when the user chooses "all".
- **FR-002**: Each operation in scope MUST contribute exactly one positive scenario. Negative
  scenario categories (missing required fields, invalid types, formats or enum values, boundaries)
  MUST never be included.
- **FR-003**: When an operation has more than one positive scenario, the system MUST choose one by
  a fixed rule (a rule-generated scenario before an AI-enhanced one, then the lowest scenario
  identifier) and record the choice and its reason.
- **FR-004**: Write operations (POST, PUT, PATCH, DELETE) MUST be included by default, like read
  operations. Each step MUST show its HTTP method in the plan, and the user MUST be able to remove
  any operation from the plan.
- **FR-005**: An operation in scope with no positive scenario MUST be left out and listed with the
  reason "no positive scenario".

**Journeys and ordering**

- **FR-006**: The system MUST propose an order in which each approved workflow is a multi-step
  journey in dependency order, and each operation in no workflow is a single-step journey.
- **FR-006a**: On each iteration, every virtual user MUST run every journey in the plan's journey
  order, and the steps of each journey in their order. Virtual users MUST NOT be divided among
  journeys.
- **FR-007**: The user MUST be able to reorder steps within a journey and reorder journeys. A
  reorder that places a consumer before the step that produces one of its variables MUST be
  rejected with the name of that variable, and never silently accepted or corrected.
- **FR-008**: The user MUST be able to set an optional think time between steps.

**Authentication, variables and request construction**

- **FR-009**: Authentication MUST reuse the existing credential producers (OAuth2 client
  credentials, chained login, and distinct per-role credentials). Tokens MUST be acquired once
  before load starts and shared by the virtual users, not fetched per request.
- **FR-010**: Each workflow variable MUST be extracted from its producer's response and checked.
  When an extraction fails, the rest of that journey MUST NOT be attempted in that iteration, and it
  MUST be recorded as cut short. The virtual user MUST then continue with the next journey in the
  same iteration.
- **FR-011**: Requests MUST be built with the same parameter serialization as the functional
  tests, so that a performance request matches its Postman equivalent for the same scenario.
- **FR-012**: Every step MUST have one or more expected status codes. They MUST start as the success
  statuses the specification documents for the step's scenario, and the user MUST be able to change
  them. The system MUST NOT pre-fill a status the specification does not document. A step with no
  documented success status MUST start with no expected status, and the user MUST set one.
- **FR-012a**: Unlike a missing user-supplied value (FR-014), a step with no expected status MUST
  block script generation. The plan MUST list every step that still needs an expected status. During
  a run, any response whose status is not among its step's expected codes MUST be counted as a
  failure, as MUST a request that gets no response (connection error or timeout).

**User-supplied data**

- **FR-013**: Before generation and before a run, the plan MUST list every value the specification
  cannot produce: the value's name, the step that needs it, whether it is secret, and whether it is
  present in the chosen target environment. The values MUST be entered and kept as variable values
  of that environment, with the same encrypted storage as other environment values. They MUST NOT
  be stored in the plan, the script or the environment template. Choosing a different environment
  MUST re-evaluate which values are present.
- **FR-014**: A missing value MUST NOT block generation or a run. Each step that needs a missing
  value MUST be reported as failed with the reason "missing data" and the variable's name, and
  nothing MUST be sent for it. Steps that consume its output MUST be reported as not attempted
  because their dependency failed. Every other step MUST run normally.
- **FR-015**: When the producer's response states a token's lifetime, each virtual user MUST acquire
  its own replacement token through the same producer before its current token expires. The first
  token remains acquired once and shared (FR-009). Virtual users MUST NOT all refresh at the same
  moment. Refresh requests MUST NOT be counted in any step's request count or latency. The report
  MUST show the number of refreshes and when they happened. A token whose lifetime is not stated
  MUST NOT be refreshed. Failures after it expires MUST be reported as authentication errors, and
  the report MUST say that the token had no stated lifetime. A failed refresh MUST be reported as
  such, and the steps that needed the token are then reported as authentication errors.
- **FR-016**: Body values that must be unique across iterations MUST be derived from the
  virtual-user and iteration numbers, so they are unique within a run and identical across re-runs.

**Load profile and thresholds**

- **FR-017**: The user MUST be able to pick a load profile (smoke, load, stress, spike or soak)
  whose stages (virtual users, ramp time, duration) are shown as numbers and are editable.
- **FR-018**: Pass/fail thresholds (latency percentiles, error rate) MUST be set by the user only.
  The system MUST NOT propose or invent performance targets.
- **FR-019**: The system MUST NOT impose a maximum number of virtual users or a maximum duration,
  and MUST NOT warn about them. The stages the user sets MUST be shown in the plan and on the run
  controls exactly as entered, so the configured load is visible before the trigger.

**Script generation**

- **FR-020**: The system MUST generate a k6 script and an environment template from the plan. The
  same plan MUST always produce byte-identical files.
- **FR-021**: The script and the environment template MUST contain no secret value, including one
  the user supplied. Secrets MUST reach a run only through its environment at run time.
- **FR-022**: The script and environment template MUST be downloadable.
- **FR-023**: When any plan input changes after generation, the script MUST be marked out of date
  and MUST NOT be runnable until it is regenerated.

**Execution** (constitution XVII exception, 2026-09-24)

- **FR-024**: Generating a script MUST NOT start a run. A run MUST start only on the user's
  explicit trigger within ApiPilot. The system MUST never start or repeat a run automatically, on a
  schedule, as a retry, or after a restart.
- **FR-025**: The trigger MUST name its target environment, and the environment's name, tier as a
  text label, and base URL MUST be shown next to the trigger and throughout the run. A run on any
  tier, including production, MUST need no confirmation step beyond the trigger. This deliberately
  departs, for performance runs only, from AP-017 FR-007's staging and production confirmation,
  which stays in force for functional runs.
- **FR-026**: Only the unmodified generated script MUST be executed. The system MUST NOT execute a
  script that was uploaded, imported, pasted or edited by a user, or any AI output.
- **FR-027**: The system MUST run a k6 binary the user installed, and MUST NOT bundle, download or
  install one. Whether k6 is available and usable MUST be shown as an explicit readiness state, with
  a reason when it is not. While k6 is not ready, the trigger MUST be unavailable.
- **FR-028**: The run controls MUST state that load is generated from the machine running the
  ApiPilot backend.
- **FR-029**: A performance run MUST share the session-wide "one execution in progress" slot with
  functional runs. A trigger while another execution is in progress MUST be refused with a reason,
  and nothing MUST be sent.
- **FR-030**: While a run is in progress, the system MUST show elapsed time against planned
  duration, current virtual users and requests so far.
- **FR-031**: The user MUST be able to cancel a running test. Cancelling MUST stop load generation,
  record the run as cancelled, and keep the results measured up to that point.
- **FR-032**: A run left in progress when the backend stops MUST be recorded on restart as cancelled
  with a backend-restart reason, and MUST NOT be started again.
- **FR-033**: Results MUST stay on the local machine. The system MUST NOT send results to k6 Cloud,
  Grafana Cloud or any other remote service.
- **FR-034**: Runs and their results MUST be persisted locally, owned by the session and removed
  with it, like the other execution runs.
- **FR-034a**: A run MUST continue on the server whether or not a browser is open or polling. While
  a run is in progress, its session MUST NOT be removed for being idle. Once the run ends, the
  session's normal idle timeout MUST apply again from that moment. A user returning within that
  time MUST see the run's final status and its report.

**Report**

- **FR-035**: When a run ends, whether completed or cancelled, the system MUST present its report in
  ApiPilot automatically and offer it as a self-contained HTML download with no external assets or
  services.
- **FR-036**: The report MUST show, per journey and per step, p50, p90, p95 and p99 latency,
  throughput, error rate by status and by failure category, and check pass rate, plus a timeline of
  virtual users against latency and errors.
- **FR-036a**: The system MUST NOT clean up, undo or delete anything a run created on the target.
  The report MUST list, per operation and HTTP method, how many write requests (POST, PUT, PATCH,
  DELETE) were sent and how many succeeded, so the user knows what the run changed.
- **FR-037**: The report MUST show each user-set threshold as passed or failed against the measured
  value. With no thresholds, it MUST say none were set and give no pass/fail verdict.
- **FR-038**: The report MUST include plain-language findings produced by fixed rules from the
  measured data, such as the slowest step, the step where failures start, and the number of
  journeys cut short by a failed extraction. The same data MUST give the same findings.
- **FR-039**: Every step in the report MUST carry its provenance: why it is in the journey (the
  dependency relationship and its confidence), which scenario was used and why, where each variable
  came from, which authentication method was used, and its expected status codes and whether each
  came from the specification or was set by the user. The report MUST also record the load
  profile, thresholds, environment name, tier and base URL, and k6 version.
- **FR-040**: The report MUST NOT contain credentials, tokens, request bodies or response bodies,
  and MUST identify steps by method and path template, never by resolved URL.

**AI and privacy**

- **FR-041**: No AI MUST be used in plan building, script generation, execution or the report.
- **FR-042**: Logs MUST NOT contain secrets, tokens, request or response bodies, or resolved URLs.

### Key Entities *(include if feature involves data)*

- **Performance Plan**: what will be tested and how. It holds the operations in scope, one chosen
  scenario per operation with the reason, the ordered journeys and steps, think time, the load
  profile and its stages, the user-set thresholds, each step's expected status codes, and the list
  of user-supplied values with their status. It belongs to the session's guided workflow.
- **Journey**: an ordered sequence of steps run by each virtual user. It comes either from an
  approved workflow (multi-step) or from a single operation. One iteration of a virtual user runs
  every journey once, in the plan's journey order.
- **Step**: one request in a journey. It records its operation, chosen scenario, the variables it
  consumes and produces, its expected status codes (each marked as from the specification or set by
  the user), its checks, and its provenance.
- **User-Supplied Value**: a value the specification cannot produce. The plan records its name, the
  steps that need it, and whether it is secret. The value itself is a variable value of the target
  environment, stored encrypted like any other, so each environment has its own. Whether it is
  present is always judged against the chosen environment.
- **Generated Script**: the k6 script and environment template produced from one version of a plan.
  It records whether it is current or out of date relative to the plan.
- **Performance Run**: one execution of a generated script against one environment. It records the
  environment's name, tier and base URL, start and end times, planned duration, status (running,
  completed, cancelled, failed), cancellation reason, and k6 version.
- **Performance Result**: the aggregated measurements of a run, per journey and per step, with the
  timeline, threshold outcomes and deterministic findings. The report is produced from it.
- **k6 Readiness**: whether a usable k6 is available, with its version or the reason it is not.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Generating the script 10 times from an unchanged plan gives 10 byte-identical scripts
  and environment templates.
- **SC-002**: For a specification of up to 50 selected operations with approved workflows, a QA
  engineer can go from opening performance testing to a downloadable script in under 5 minutes.
- **SC-003**: With known secret values seeded into credentials and user-supplied data, none of them
  appears in the script, the environment template, the report, the plan view or the logs, in 100%
  of checked runs.
- **SC-004**: 100% of steps in every report carry provenance: why the step is included, the
  scenario and why, each variable's source, and the authentication method.
- **SC-005**: In a plan with missing user-supplied values, the run completes. 100% of affected
  steps are reported as "missing data" with the variable's name, and no request is sent for them.
- **SC-006**: No run starts without the user's trigger. Across generation, backend restarts and
  retries, 0 runs start on their own.
- **SC-007**: Progress appears within 5 seconds of the trigger and refreshes at least every 5
  seconds during the run. The report is presented within 10 seconds of the run ending.
- **SC-008**: Cancelling stops load generation within 10 seconds, and the partial results are kept.
- **SC-009**: 100% of reorders that would break a dependency are rejected with the name of the
  variable they would break.
- **SC-010**: The downloaded report renders completely with no network access and makes no network
  requests.
- **SC-011**: Producing the report twice from the same run data gives identical findings.
- **SC-012**: When k6 is missing or unusable, the trigger is unavailable and the specific reason is
  shown, in 100% of cases.
- **SC-013**: In a run longer than a token's stated lifetime, 0 requests fail because the token
  expired, and 100% of refreshes appear in the report.
- **SC-014**: A run lasting longer than the session idle timeout (for example 2 hours), with no
  browser open, completes, and its report is available when the user returns within the idle
  timeout after it ends.
- **SC-015**: 100% of steps in every generated script have at least one expected status code, and
  100% of responses outside a step's expected codes are counted as failures.

## Assumptions

- The feature is used from the guided workflow once scenarios and workflows are approved, since it
  builds on the approved test model. Uploaded collections (AP-026) are not a source for
  performance tests in this version.
- The target environment is an existing environment with a unique name, a tier (`local`, `dev`,
  `qa`, `staging` or `production`) and a base URL, as defined by AP-017. No new environment
  model is introduced. User-supplied values are that environment's variable values
  (Clarifications 2026-09-24).
- Like the rest of the guided workflow's state, the plan does not survive a backend restart. Runs,
  their results and their reports do.
- k6 is installed by the user on the machine running the ApiPilot backend, and a minimum supported
  k6 version is fixed during planning.
- The five named load profiles come with starting stages that the user can edit. The starting
  values are recorded in the plan, not presented as recommended performance targets.
- Running load against a system is the user's responsibility, including the write operations
  included by default and any virtual-user count or duration (Clarifications 2026-09-24). The
  environment's name, tier and base URL, each step's method, and the configured stages are shown to
  make the target and the load unmistakable, instead of adding a confirmation step or a limit
  (decision 2026-09-23).
- A token's lifetime is known only when the producer's response states it (for example, an
  `expires_in` value). Otherwise it is treated as unknown.
- Refreshing per virtual user sends one token request per virtual user per token lifetime to the
  producer. For example, 200 virtual users over a 1-hour run with 5-minute tokens send about 3,000.
  A producer that rate-limits token requests, revokes a client's earlier token when it issues a new
  one, or caps concurrent sessions per user can make refreshes fail or invalidate other virtual
  users' tokens. ApiPilot cannot detect this in advance. The report shows it as failed refreshes
  and authentication errors (FR-015).
- For an operation with both a rule-generated and an accepted AI-enhanced positive scenario, the
  performance test can use a different scenario from the generated Postman collection, whose
  selection ignores the scenario's origin (FR-003, FR-011). Aligning the Postman rule is a separate
  follow-up.
- Out of scope: negative scenarios under load, distributed or cloud load generation, k6 browser
  testing, baseline comparison and trends across runs (a candidate follow-up), AI-generated
  analysis of results (AP-031), editing the generated script before running it (it would need a
  further constitution amendment), and cleaning up data a run created on the target.
