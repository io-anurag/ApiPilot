# Feature Specification: User-Defined Journeys and Captured Values for Performance Tests

**Feature Branch**: `[035-user-defined-journeys]`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "How can I define a sequence of run, this is important because if Put /
delete is called before Post then it will throw error & k6 tests fails. Also I want to extract
important data & pass it on to subsequent tests, e.g. Post creates a record & I should fetch the Id
& pass it to put to update the record" (2026-10-01, about k6 performance tests, raised on the quick
performance test's plan screen)

**Product identifier**: `AP-035` (post-MVP). This spec directory is numbered `035` per the
repository's sequential feature-directory convention; the directory number and the `AP-###`
identifier happen to coincide here but remain independent. `AP-035` is the canonical identifier
used in cross-references, commit messages, and `specs/ROADMAP.md`.

**Relationship to prerequisite specifications**: This feature lets the engineer compose their own
multi-step journeys in a performance plan, and pass a value captured from one step's response to a
later step's request. It applies to both performance paths: the guided workflow's Performance
Testing stage (AP-029) and the quick performance test (AP-032). It reuses, unchanged:
- the plan, its steps, scenario choice, expected statuses, think time, load profiles, thresholds,
  environments, script generation, run trigger, live progress, persistence and report (AP-029);
- the per-iteration extraction check and "cut short" behaviour for a failed extraction (AP-029
  FR-010), and missing-data reporting (AP-029 FR-014);
- the order check that refuses a move placing a step before the step that produces its value
  (AP-029 FR-007);
- step-level body and parameter edits, written into the script only as data (AP-033);
- the write-operation summary and its markers (AP-032 FR-009 to FR-012).

It does not change user-supplied k6 scripts (AP-034), which define their own order and extraction.

It changes five existing decisions, each stated as a requirement below:
- AP-029 FR-010 extracts each workflow variable and checks it, whatever status the producer
  received, and accepts any non-empty value. Captures, including workflow variables in proposed
  journeys, are now attempted only on an expected status and succeed only for a string, number or
  boolean (FR-010, FR-033).
- AP-032 FR-009 and FR-011 count each write operation once. The write-operation summary now counts
  each step that sends one, so an operation in two journeys counts twice (FR-023).
- AP-032 FR-006 says every operation in the quick plan is its own single-step journey and the quick
  path must not infer or apply dependency chaining. The quick path still infers nothing, but the
  engineer may now compose journeys and bind values themselves (FR-001, FR-030). The plan's note
  "To chain requests, use the guided workflow" changes accordingly (FR-031).
- AP-029 FR-006 makes the proposed journeys (one per approved workflow, one per other operation)
  the whole plan. The proposal is unchanged, but the engineer may add their own journeys and adjust
  a proposed workflow journey (FR-001, FR-024).
- AP-029 FR-024b restores a past run's settings without its body and parameter edits. It now also
  restores the run's user-defined journeys, captures and bindings, which hold no values (FR-028).

**Governance**: A user-defined journey, its captures and its bindings are inputs the engineer edits
in the performance plan. Under constitution XVII's 2026-09-24 exception as clarified on 2026-09-29
(v2.5.0), such inputs are part of the plan the user approved, not an edit to the script, provided
that every condition of that exception holds and:
- the content is written into the script only as data, never as script code: a capture is a field
  path or a header name, and a binding names a capture and a request target; no expression,
  filter, function or code is accepted (FR-008, FR-018);
- it carries no secret value: a captured value exists only in the virtual user's memory during one
  iteration of one journey, and is never stored, shown, logged or reported (FR-019, FR-020);
- the plan marks each step that carries user-defined content, and the run's snapshot and report
  record which steps did without containing any captured value (FR-021, FR-026).

Constitution XV (conservative dependency inference) is respected because ApiPilot never creates a
user-defined journey or binding itself: each one is the engineer's explicit choice, carries USER
provenance (XIII), and is shown apart from relationships ApiPilot detected. No constitution
amendment is expected; `/speckit-plan`'s Constitution Check MUST confirm this reading or raise an
amendment before planning continues.

## Clarifications

### Session 2026-10-01

- Q: Are captures per iteration only, or may some steps run once before the load and share their
  captures with every virtual user? → A: Per iteration only. A captured value is used by later steps
  of the same journey, in the same iteration, by the same virtual user. Steps that run once before
  the load (setup data) are out of scope (FR-017).

### Session 2026-10-02

- Q: Should captures in journeys ApiPilot proposed from approved workflows follow the same rule as
  user-defined journeys (capture only on an expected status, scalar values only)? → A: Yes, one rule
  for every journey; AP-029 FR-010 is amended accordingly (FR-010, FR-033).
- Q: When an edited workflow journey is reverted, do the expected statuses and body or parameter
  edits set on its converted steps carry back to the proposed steps? → A: Yes, for steps that came
  from the workflow; settings on steps the engineer added are discarded, and the confirmation names
  those steps (FR-024).
- Q: Does an incomplete user-defined journey block script generation? → A: No; the script is
  generated without it, the plan's pending list shows it as a note, and the run trigger names it
  (FR-025).
- Q: When a response repeats a header and k6 reports the values combined, what does a header
  capture take? → A: The whole value as k6 reports it, never split (Edge Cases, "Header captures").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chain create, update and delete with a captured id (Priority: P1)

A performance engineer has a quick performance plan for an API with `POST /api/v1/customers`,
`PUT /api/v1/customers/{id}` and `DELETE /api/v1/customers/{id}`. As single-step journeys, the PUT
and DELETE read `customer_id` from the environment, so under load they update and delete the same
record, and fail once it is gone. The engineer chooses **New journey**, names it "Customer
lifecycle", and adds the POST, then the PUT, then the DELETE.

On the POST step they add a capture named `customer_id` from the response body field `id`.
ApiPilot lists the fields the specification documents for the POST's success response, so the
engineer picks `id` rather than typing it. On the PUT step, the path parameter `{id}` offers
"Value captured by an earlier step", and the engineer picks `customer_id` from step 1. The DELETE
does the same. ApiPilot shows that the three operations no longer run as single-step journeys, and
that `customer_id` is no longer a value the environment needs.

The engineer generates the script and starts the run. On every iteration, each virtual user
creates a customer, updates that customer and deletes it. The report shows, for each step, where
`{id}` came from, how many captures succeeded and failed, and how many journeys were cut short.

**Why this priority**: It is the request in its smallest form: run writes in an order that works,
and send the id one step created to the steps that use it. Without it, write-heavy plans fail by
design.

**Independent Test**: Against a local test server whose POST returns a new id each time and whose
PUT and DELETE answer 404 for an unknown id, build the three-step journey, generate and run a smoke
test with two virtual users. Check that every PUT and DELETE used the id returned by the POST of the
same virtual user in the same iteration, that no 404 was received, and that the report shows the
capture and its success count. Make the server omit `id` from one response and check that the PUT
and DELETE of that iteration were not sent and the journey was recorded as cut short.

**Acceptance Scenarios**:

1. **Given** a performance plan on either path, **When** the engineer chooses **New journey**,
   **Then** they can name it and add steps from the plan's operations in the order they choose.
2. **Given** a step in a user-defined journey, **When** the engineer adds a capture, **Then**
   ApiPilot lists the fields the specification documents for that operation's success responses,
   and the engineer can pick one or type a field path.
3. **Given** a later step in the same journey with a path parameter, **When** the engineer sets its
   source, **Then** they can choose "Value captured by an earlier step" and pick a capture from a
   step before it in that journey.
4. **Given** a path parameter bound to a capture, **When** the plan lists the values the
   environment must provide, **Then** that parameter is no longer listed for that step, and the
   step's request preview shows the capture's name and step instead of an environment value.
5. **Given** a journey with captures, **When** the engineer moves a step before the step whose
   capture it uses, or removes that step from the journey, **Then** the change is refused and the
   message names the capture.
6. **Given** a generated script and a run, **When** each virtual user runs the journey, **Then** the
   bound requests send the value captured in the same iteration by the same virtual user, and never
   a value from another iteration, journey or virtual user.
7. **Given** a capture that fails (the field is missing, empty or not a single value, or the step
   received a status it does not expect), **When** the iteration continues, **Then** the rest of
   that journey is not sent in that iteration, the journey is recorded as cut short with the
   capture's name, and the virtual user continues with the next journey.
8. **Given** a run that ended, **When** its report is presented, **Then** each step shows where each
   bound value came from (capture name, step, and response field or header) and each capture shows
   how many times it succeeded and failed.

---

### User Story 2 - Pass captured values anywhere a request takes a value (Priority: P2)

The engineer's API creates an order for a customer: `POST /api/v1/orders` takes `customerId` in its
body, and `GET /api/v1/orders/{id}?customer={customerId}` reads it back. Another operation returns
the new resource's address only in a `Location` header. The engineer captures values from response
bodies and from response headers, and binds them to path parameters, query parameters, headers and
body fields of later steps. They add the same operation more than once in one journey, for example
a GET after the PUT to read the updated record, and each occurrence is its own step with its own
expected status.

**Why this priority**: Real flows pass ids in bodies and queries, not only in paths, and often check
a record after changing it. Story 1 works without this; most real journeys need it.

**Independent Test**: Build a journey that captures `customer_id` from a POST body and `order_url`
from a `Location` header, binds `customer_id` to a body field, a query parameter and a header of
later steps, and repeats a GET. Run it against a test server that echoes what it receives. Check
that each target received the captured value, that the repeated GET counts as two steps in the plan,
script and report, and that the same plan and journeys generate a byte-identical script twice.

**Acceptance Scenarios**:

1. **Given** a step, **When** the engineer adds a capture, **Then** they can take it from a response
   body field or from a response header by name.
2. **Given** a later step, **When** the engineer binds a capture, **Then** they can bind it to any
   path, query or header parameter the specification documents for that operation, or to a field
   of the step's body.
3. **Given** a body field bound to a capture, **When** the engineer opens the body editor (AP-033),
   **Then** the field is listed under "Replaced at run time" with the capture as its source.
4. **Given** an operation already in a journey, **When** the engineer adds it again to the same or
   another journey, **Then** it becomes another step with its own expected status, body and
   parameter edits, and captures.
5. **Given** a capture typed as a field path the specification does not document, **When** the
   engineer saves it, **Then** it is saved with a "Not documented in the specification" warning,
   and the warning never blocks the script.
6. **Given** a write operation that occurs in several steps, **When** the write-operation summary is
   shown, **Then** it counts each step that sends it and names the journey each one belongs to.

---

### User Story 3 - Adjust a proposed workflow journey and keep journeys across runs (Priority: P3)

On the guided path, ApiPilot proposed a journey from an approved workflow: `POST /customers` then
`GET /customers/{id}`. The engineer wants the same journey to also update and delete the customer.
They choose **Edit journey** on the proposed journey; it becomes a user-defined journey "based on"
that workflow, keeping its steps and the workflow's variables as captures and bindings. They add the
PUT and DELETE and bind them. Later, after changing the plan, they restore a past run's settings,
and its journeys, captures and bindings come back.

**Why this priority**: It saves rebuilding a journey ApiPilot already proposed, and keeps journeys
from being lost when the engineer tries other plan settings. Stories 1 and 2 already deliver
working chains without it.

**Independent Test**: On a guided plan with one approved two-step workflow, edit the proposed
journey, add two steps and bindings, run it, then remove a step and regenerate the script. Restore
the first run's settings and check the journey, its captures and its bindings match that run's.

**Acceptance Scenarios**:

1. **Given** a proposed workflow journey, **When** the engineer chooses **Edit journey**, **Then**
   it becomes a user-defined journey marked as based on that workflow, each workflow variable
   becomes a capture and a binding with the same producer field and consumer target, and the
   relationship's confidence stays visible on those bindings.
2. **Given** an edited workflow journey, **When** the engineer chooses **Revert to proposed
   journey** and confirms, **Then** the proposed journey replaces it, each step that came from the
   workflow keeps the expected statuses and body and parameter edits set on it, and the
   confirmation names the added steps whose settings will be discarded.
3. **Given** a run whose plan had user-defined journeys, **When** the engineer restores that run's
   settings (AP-029 FR-024b), **Then** its journeys, steps, captures and bindings are restored.
4. **Given** a user-defined journey, **When** the engineer deletes it and confirms, **Then** its
   operations return as single-step journeys unless they are in another journey.

---

### Edge Cases

- **Removing an operation from the plan**: removing an operation (one row, by method, or all write
  operations) removes it everywhere, including from user-defined journeys. A journey with a removed
  step keeps its definition, is not run, and is shown as incomplete with the operation named. It
  runs again when the operation is restored. Removing a step from one journey is a separate action,
  refused while a later step uses its capture.
- **Operations in a journey and on their own**: when an operation is first added to a user-defined
  journey, its single-step journey leaves the plan and the plan says so. The engineer can choose
  **Also run on its own** to keep a single-step journey for it, which then uses environment values
  as before.
- **Capture value types**: a capture takes a string, number or boolean and sends it as its text. A
  missing field, `null`, empty string, object or array is a failed capture. A response that is not
  JSON fails every body capture of that step.
- **Header captures**: header names match regardless of case. When a header appears more than once,
  the capture takes the value exactly as k6 reports it for that name, even if k6 combines the
  repeated values; ApiPilot never splits it. Extracting part of a value (for example the id at the end of a
  `Location` URL) is out of scope; the whole value is captured.
- **Unexpected status on a producing step**: its captures are not attempted and count as failed, so
  the rest of the journey is cut short, and the step is counted as failed as before.
- **A binding whose target disappears**: when a plan rebuild changes a step's scenario so that a
  bound body field no longer exists, or the operation no longer documents a bound parameter, the
  binding is marked "Target no longer exists" and the script cannot be generated until the engineer
  removes or re-targets it. The plan names each such binding.
- **An operation that leaves the analysis**: when a guided workflow's approvals or a new API review
  selection take an operation out of scope, steps for it are marked as unavailable and their
  journeys are shown as incomplete, not silently shortened.
- **Edited parameters and bodies**: a parameter bound to a capture cannot also hold an edited value
  (AP-033 FR-021, "a parameter filled by an earlier workflow step"). Binding a parameter that has an
  edited value asks first and drops the edited value for that parameter. Removing a bound body field
  in the body editor removes the binding, and the step's details say so (AP-033 FR-010).
- **Names**: a capture name is made of letters, digits and underscores, does not start with a
  digit, and is unique within its journey. It may equal an environment value's name; the binding,
  not the name, decides where a value comes from.
- **Captured secrets**: a capture may hold a token or other secret (for example from a login
  response). Its value is never shown (FR-020), and a capture bound to a header, or to a field the
  request schema declares `format: password`, is marked "secret" in the request preview, as
  environment secrets are. Binding a capture to the step's authentication is
  out of scope; authentication stays as AP-029 FR-009 defines it.
- **Shared values**: captured values are not shared between virtual users, iterations or journeys
  (FR-017). There are no steps that run once before the load. A test that reads one existing record
  under load takes its id from the environment, as before.
- **A new quick test**: uploading a new specification on the quick path replaces the plan and its
  user-defined journeys, as it replaces body and parameter edits (AP-033 FR-018).
- **Resetting the plan**: resetting rebuilds the proposed journeys and keeps user-defined journeys,
  re-checked against the new plan (FR-016, FR-025). A journey based on a workflow is reverted to the
  proposed journey, as in FR-024, and the reset confirmation names it.
- **Write volume**: a journey that ends with a DELETE removes what its POST created, but ApiPilot
  still cleans up nothing itself (AP-029 FR-036a); a journey cut short leaves its records behind.

## Requirements *(mandatory)*

### Functional Requirements

**Composing journeys**

- **FR-001**: On both performance paths, the engineer MUST be able to create a journey, name it,
  and add steps to it from the operations in the plan, in an order they choose.
- **FR-002**: A journey MUST hold at most 20 steps. An operation MAY appear in several journeys and
  more than once in one journey; each occurrence MUST be its own step with its own expected
  statuses, body edit, parameter edits and captures.
- **FR-003**: When an operation is first added to a user-defined journey, its single-step journey
  MUST leave the plan, and the plan MUST say so. The engineer MUST be able to keep a single-step
  journey for it as well.
- **FR-004**: The engineer MUST be able to rename a user-defined journey, reorder its steps, remove
  a step from it, and delete it after confirming. Deleting it MUST return each of its operations to
  a single-step journey unless the operation is in another journey.
- **FR-005**: User-defined journeys MUST take part in the plan's journey order (AP-029 FR-006a and
  FR-007) like any other journey, and every virtual user MUST run every journey on each iteration.
- **FR-006**: ApiPilot MUST NOT create, extend or bind a user-defined journey on its own. Each
  journey, step, capture and binding MUST come from an explicit action by the engineer.

**Captures**

- **FR-007**: The engineer MUST be able to add captures to any step of a user-defined journey. A
  capture MUST have a name (FR-026's rule) unique within its journey, and a source: a response body
  field, or a response header by name. A step MUST hold at most 10 captures.
- **FR-008**: A body field MUST be given as a path of object field names and array positions (for
  example `data.items[0].id`). Wildcards, filters, expressions and code MUST be refused with the
  reason.
- **FR-009**: When choosing a body field, the system MUST list the fields the specification
  documents for the operation's success response bodies, in a fixed order, with any field whose name
  matches a parameter of a later step in the journey marked as such. A path the specification does
  not document MUST be accepted with a "Not documented in the specification" warning that never
  blocks the script.
- **FR-010**: At run time, a capture MUST be attempted only when the step received one of its
  expected statuses. It MUST succeed only for a string, number or boolean value, which is sent as
  its text. Any other case MUST count as a failed capture. This rule MUST apply to every capture
  in the plan, including workflow variables in proposed journeys (FR-033).

**Bindings**

- **FR-011**: For each path, query and header parameter the specification documents for a step, and
  for each field of the step's body, the engineer MUST be able to choose "Value captured by an
  earlier step" and pick a capture from a step before it in the same journey.
- **FR-012**: A bound parameter or field MUST NOT be listed as a value the environment must provide
  for that step (AP-029 FR-013), and the request preview MUST show the capture's name and step in
  its place, never a value.
- **FR-013**: A bound body field MUST be listed in the body editor under "Replaced at run time" with
  the capture as its source (AP-033 FR-009). Removing the field in the editor MUST remove the binding
  and the step's details MUST say so.
- **FR-014**: Binding a parameter that holds an edited value (AP-033 FR-020) MUST ask first, and
  confirming MUST drop that parameter's edited value. A bound parameter MUST NOT be editable as a
  value.
- **FR-015**: A reorder, a step removal or a capture removal that would leave a binding without an
  earlier step that captures its value MUST be refused, naming the capture and the steps that use
  it, and never silently corrected.
- **FR-016**: A binding whose target no longer exists after a plan rebuild MUST be marked "Target no
  longer exists", MUST block script generation, and MUST be listed with the other items that block
  a run until the engineer removes or re-targets it.

**Running**

- **FR-017**: A captured value MUST be used only by later steps of the same journey, in the same
  iteration, by the same virtual user.
- **FR-018**: Captures and bindings MUST be written into the script only as data. The script's code
  MUST be the same for every plan, apart from that data, so that no engineer input can reach k6 as
  code.
- **FR-019**: A failed capture MUST cut the rest of its journey short in that iteration, as AP-029
  FR-010 defines, and the virtual user MUST continue with the next journey. A step whose bound value
  was not captured MUST NOT be sent.
- **FR-020**: Captured values MUST NOT appear in the plan, the script, the environment template, the
  run record, the report, the user interface or the logs.
- **FR-021**: The same plan with the same journeys, captures and bindings MUST produce a
  byte-identical script and environment template (AP-029 FR-020). Any change to them MUST mark a
  generated script out of date (AP-029 FR-023).

**Presenting the plan**

- **FR-022**: Each user-defined journey MUST be marked "Defined by you" (or "Based on workflow" for
  an edited proposed journey), and each step that captures or binds a value MUST say so in the
  operations table, with its captures and the source of each bound value in its details.
- **FR-023**: The write-operation summary (AP-032 FR-009, FR-011) MUST count each step that sends a
  write operation, so an operation in two journeys counts twice, and MUST name the journey of each.
- **FR-024**: On the guided path, the engineer MUST be able to edit a proposed workflow journey,
  which then becomes a user-defined journey based on that workflow, with each workflow variable
  turned into a capture and a binding and the relationship's confidence kept on the binding. The
  engineer MUST be able to revert it to the proposed journey after confirming. On revert, the
  expected statuses, body edit and parameter edits of each step that came from the workflow MUST
  carry back to the corresponding proposed step; those of steps the engineer added MUST be
  discarded, and the confirmation MUST name those steps.
- **FR-025**: A user-defined journey with a step whose operation is removed or out of scope MUST
  keep its definition, MUST NOT be run, and MUST be shown as incomplete, naming the operation, until
  the operation is back in the plan. It MUST NOT block script generation; it MUST be listed as a
  note with the plan's pending items, and the run trigger MUST name each incomplete journey.

**Records, report and restore**

- **FR-026**: A capture name MUST be made of letters, digits and underscores and MUST NOT start
  with a digit. Other names MUST be refused with the reason.
- **FR-027**: A run's snapshot MUST record each journey's name and origin (proposed, defined by the
  engineer, or based on a workflow), its steps, each capture's name and source, and each binding's
  capture and target. It MUST NOT record any captured value.
- **FR-028**: Restoring a past run's settings (AP-029 FR-024b) MUST also restore its user-defined
  journeys, captures and bindings. A step that cannot be restored, because its operation or target
  no longer exists, MUST be named as not restored.
- **FR-029**: The report MUST show, for each step, the source of each bound value (capture name,
  producing step, and response field or header), and for each capture its success and failure
  counts. Its findings (AP-029 FR-038) MUST name the capture that cut the most journeys short. Each
  step's provenance MUST state whether it is in a proposed or a user-defined journey (AP-029 FR-039).

**Changed decisions**

- **FR-030**: AP-032 FR-006 MUST read: every operation in the quick plan starts as its own
  single-step journey, and the quick path MUST NOT infer dependency chaining between operations;
  the engineer MAY compose journeys and bind captured values as this specification defines.
- **FR-031**: The quick plan's description MUST say that requests are not chained unless the
  engineer builds a journey, and point to **New journey**, instead of pointing to the guided
  workflow.
- **FR-032**: No AI MUST be used to propose, build, check or explain journeys, captures or bindings.
- **FR-033**: AP-029 FR-010 MUST read: each workflow variable MUST be extracted from its producer's
  response and checked, only when the producer received one of its expected statuses, and MUST
  succeed only for a string, number or boolean value. A failed or skipped extraction cuts the rest
  of the journey short as before.

### Key Entities *(include if feature involves data)*

- **Performance Journey** (existing, AP-029): gains an origin (proposed workflow, single-step,
  defined by the engineer, or based on a workflow), a name for user-defined journeys, and an
  incomplete state with its reason.
- **Performance Step** (existing, AP-029): may now be one of several occurrences of the same
  operation, each with its own settings, captures and bindings.
- **Capture**: a named value a step takes from its response, with its source (body field path or
  header name), whether the specification documents it, and the step it belongs to. Holds no value.
- **Value Binding**: links one request target of a later step (path, query or header parameter, or
  body field) to a capture of an earlier step in the same journey, with its state (active, or target
  no longer exists) and, when it came from a workflow, the relationship and confidence.
- **Run Snapshot** (existing, AP-029): records journeys, captures and bindings without values.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An engineer can turn three single-step journeys (create, update, delete) into one
  journey with a captured id and a generated script in under 3 minutes.
- **SC-002**: In runs against a test server that returns a new id on every create, 100% of bound
  requests send the value captured in the same iteration by the same virtual user, and 0 bound
  requests are answered "not found" because of a wrong id.
- **SC-003**: When captures are made to fail on purpose, 0 requests are sent for steps whose bound
  value was not captured, and 100% of those iterations are recorded as cut short with the capture's
  name.
- **SC-004**: Generating the script 10 times from the same plan and journeys gives 10 byte-identical
  scripts, and the script's code is identical for every plan apart from its data.
- **SC-005**: With known values seeded into test server responses, none of them appears in the
  plan, the script, the run record, the report, the user interface or the logs, in 100% of checked
  runs.
- **SC-006**: 100% of reorders, step removals and capture removals that would leave a binding
  without its capture are refused with the capture's name.
- **SC-007**: Restoring a past run's settings gives the same journeys, captures and bindings as that
  run, in 100% of checked runs where the operations still exist.

## Assumptions

- The engineer knows the order their API needs and which response field holds an id. ApiPilot
  helps by listing documented response fields but does not decide for them.
- Captures read JSON response bodies and response headers. XML or form response bodies, partial
  values (a substring or the last segment of a URL) and computed values are out of scope.
- The limits of 20 steps per journey and 10 captures per step keep the plan readable and the script
  small; they are well above the detected workflows' 10-step bound (AP-008).
- The quick path still runs no dependency analysis. Suggesting journeys from detected relationships
  on the quick path is out of scope.
- Authentication keeps the existing credential producers (AP-029 FR-009). Binding a capture to a
  step's authentication is out of scope.
- User-defined journeys change only the performance plan. They do not change the approved test
  model, the Postman collection or the functional tests.
- Out of scope: sharing captured values across journeys, iterations or virtual users, steps that
  run once before the load (Clarifications 2026-10-01), conditional steps or loops, data files, exporting or importing journey
  definitions, and user-supplied k6 scripts (AP-034).
