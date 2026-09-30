# Feature Specification: Edit a Performance Step's Request Body

**Feature Branch**: `[033-edit-step-request-body]`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "Let the engineer see and edit the request body of a performance plan
step. In the performance plan (quick and guided paths), each step's request preview (AP-032
FR-008) is currently view-only and editing a step's request is out of scope. This feature lets the
engineer edit the JSON/text body a step sends, so the k6 script sends the edited body; revert to
the generated body; keep {{name}} environment, workflow-variable, unique-per-iteration and
credential references working; never show or store secret values; and keep the preview identical
to what the script sends. Operations without a request body (for example GET) show that there is
no body."

**Product identifier**: `AP-033` (post-MVP). This spec directory is numbered `033` per the
repository's sequential feature-directory convention; the directory number and the `AP-###`
identifier coincide here but remain independent. `AP-033` is the canonical identifier used in
cross-references, commit messages, and `specs/ROADMAP.md`.

**Relationship to prerequisite specifications**: This feature extends the shared performance plan
screen of AP-029 (`specs/031-k6-performance-testing`) and AP-032
(`specs/032-quick-performance-test`). It reuses, unchanged: the plan, its steps and journeys, the
request each step sends (AP-032 research Q8), the per-iteration unique body fields (AP-029
FR-016), the workflow variables of guided journeys, the credential producers (AP-021, AP-023,
AP-024), environments (AP-017, AP-025), script generation, runs and reports.

It changes two existing decisions, each stated as a requirement below:
- AP-032 FR-008 makes a step's request view-only, and AP-032's Assumptions put "editing a step's
  request (headers, query or body)" out of scope. This feature makes the **body** editable
  (FR-001 to FR-008) and, since the amendment of 2026-09-30, the documented **path, query and
  header parameters** (FR-020 to FR-023).
- AP-029 keeps request bodies out of the stored plan and run snapshots (AP-029 research D20). An
  edited body has to be kept with the plan; FR-014 keeps run snapshots and reports free of body
  content.

**Governance**: Running the generated script is permitted only by the constitution's XVII
exception (2026-09-24, extended 2026-09-27). The exception covers "a k6 script that ApiPilot
generated deterministically (XVI) from a Performance Plan the user approved", and excludes a
script "uploaded, imported, pasted or edited by a user". In this feature the engineer edits a
plan input, not the script: ApiPilot still generates the whole script, and the script that runs
is still byte-identical to it. The constitution is amended before `/speckit-plan` (MINOR) to state
this explicitly: a request body the engineer edits in the plan is a plan input, the script is
still generated deterministically from the plan, and every existing condition of the exception is
unchanged, as was done for AP-032 in v2.4.0 (Clarifications 2026-09-29). Every condition of the
exception remains a requirement of this spec: no secrets in the script (FR-012), the body written
only as data (FR-013), and a byte-identical script for the same plan and edits (FR-015).

## Clarifications

### Session 2026-09-29

- Q: Is a user-edited request body in the plan read as covered by the XVII exception as written,
  or is the constitution amended first? → A: Amended before `/speckit-plan` (MINOR) to state that
  plan-level body edits are plan inputs and that the script stays ApiPilot-generated, with all of
  the exception's conditions unchanged (Governance). Done in constitution v2.5.0.
- Q: What happens to a well-formed body that does not match the operation's request schema? → A:
  It is saved, with a visible warning that lists each mismatch; the warning stays on the step
  while the mismatch remains (User Story 2 AS4, FR-005).
- Q: What stops a real secret being typed into a body? → A: A literal value in a field the request
  schema marks as sensitive (`format: password`) cannot be saved; that field must hold a
  `{{name}}` reference. The editor's statement about literal values applies to every other field
  (User Story 3 AS5, FR-012).

### Session 2026-09-30 (amendment: parameters)

Trigger: a quick run's report showed `GET /api/v1/posts` failing with 400 on every request. The
target's log showed `?limit=1&page=1&sort=a&userId=1`: generated, specification-conformant query
values the server rejected. The report did not show them, and the plan offered no way to change
them.

- Q: Which parts of a step's request become editable? → A: The documented path, query and header
  parameters: a new value for any of them, or leaving out an optional one. Authentication,
  undocumented headers (such as `Content-Type`), the method and the path template stay as
  generated (FR-020).
- Q: Is a new specification (AP-034) needed? → A: No. The user chose to amend AP-033, since
  parameter edits follow the body-edit model exactly (kept, discarded, fingerprinted, snapshotted
  and reported the same way). Constitution XVII already covers "a Performance Plan's inputs that
  the user edits in the plan, including a request body", so no amendment is needed; its three
  conditions are met by FR-021 and FR-022.
- Q: How does the engineer find the steps to fix? → A: The plan marks each step that the latest
  finished run answered with a status it does not expect, with the statuses and a pointer to the
  step's request, and a chip lists only those steps. The report's response block for such a step
  says where to check and edit the request. Parameter values stay out of run snapshots and
  reports (FR-022, FR-023).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every step's body, or that it has none (Priority: P1)

A QA engineer opens a step in the performance plan to check what it sends. For an operation with
a request body, the body is shown with each value that comes from somewhere else (an environment
value, a workflow variable, a value unique per iteration, a token) named and explained. For an
operation that sends no body, such as `GET /errors/conflict`, the step says so in words, so an
empty space is never mistaken for a missing or failed preview.

**Why this priority**: Today a step without a body shows nothing where the body would be, which
reads as a defect. The engineer cannot decide whether to edit a body before they can see it
clearly. This story is also the base the editor builds on.

**Independent Test**: Build a plan from a specification with a GET without a body, a POST with a
JSON body, and a POST whose body carries a `format: email` field. Open each step and verify the
body, its explained references, and the "no body" statement for the GET.

**Acceptance Scenarios**:

1. **Given** a step for `GET /errors/conflict` whose operation documents no request body,
   **When** the engineer opens the step, **Then** the request says "This request has no body."
2. **Given** a step for `POST /orders` with a JSON body, **When** the engineer opens the step,
   **Then** the body is shown as formatted JSON, and each `{{name}}` in it is listed with where
   its value comes from at run time.
3. **Given** a step whose operation documents a request body but whose chosen scenario sends
   none, **When** the engineer opens the step, **Then** the request says the operation accepts a
   body that this step does not send, and offers to add one (User Story 2).

---

### User Story 2 - Edit the body a step sends (Priority: P1)

The generated body uses values that satisfy the specification but not the target system: an
order for a product that does not exist, a customer id the environment does not have. The
engineer edits the body in the step's details, saves it, and the next generated script sends
exactly the edited body. The step is marked as having an edited body, so the edit is visible from
the table without opening the step.

**Why this priority**: This is the feature. Without it, a load test against a real system spends
its load on requests the system rejects, and the only workaround is to change the specification.

**Independent Test**: Edit the body of one POST step, save, generate the script, and verify that
the preview and the script send the edited body, that the step shows it is edited, that the
script was marked out of date by the edit, and that generating twice gives byte-identical files.

**Acceptance Scenarios**:

1. **Given** a step with a JSON body, **When** the engineer changes a value and saves, **Then**
   the step's preview shows the edited body, the step row is marked "Body edited", and a script
   generated earlier is marked out of date.
2. **Given** that saved edit, **When** the script is generated, **Then** the script sends the
   edited body, and the preview and the script agree byte for byte on the body they describe.
3. **Given** a JSON step, **When** the engineer enters text that is not well-formed JSON,
   **Then** the edit cannot be saved, and the reason and position of the error are shown next to
   the editor.
4. **Given** an edited body whose content does not match the operation's request schema (for
   example a missing required property), **When** the engineer saves, **Then** the edit is
   saved, and the step shows a warning that lists each mismatch (for example "`quantity` is
   required by the specification and missing"); the warning stays until the mismatch is fixed or
   the body is reset.
5. **Given** an unsaved edit, **When** the engineer closes the step or cancels, **Then** the
   step's body is unchanged and nothing is marked out of date.
6. **Given** the same plan with the same edits, **When** the script is generated twice, **Then**
   both scripts and environment templates are byte-identical.

---

### User Story 3 - Keep references working and secrets out (Priority: P1)

The body a step sends can hold references that are filled in at run time: an environment value
such as a customer id, a value produced by an earlier step of a guided workflow, a value unique
per virtual user and iteration, or a token. ApiPilot applies these to their fields after the
edit, as it does for a generated body: the engineer keeps one by keeping its field and removes it
by removing the field. The engineer can add a reference to an environment value anywhere by
writing `{{name}}`. Secret values are never shown in the editor and never become part of the body
or the script.

**Why this priority**: A body edit that silently drops a workflow variable breaks the chain; one
that pastes a password into the script breaks the constitution (XVIII). Editing without these
rules is unsafe, so this story ships with Story 2.

**Independent Test**: In a guided workflow journey, edit a step whose body carries a workflow
variable and a unique email; change another value, remove the unique email's field, add
`{{warehouseId}}`, and verify the preview, the values checklist, the plan's notices and the
script.

**Acceptance Scenarios**:

1. **Given** a body carrying a unique-per-iteration field and a workflow variable, **When** the
   engineer edits other values and saves, **Then** both references keep working, and the preview
   still names each one's source.
2. **Given** the same body, **When** the engineer removes the field the workflow variable fills
   and saves, **Then** the plan states that this step no longer uses the variable produced by the
   earlier step, before the script is generated.
3. **Given** an edited body, **When** the engineer adds `{{warehouseId}}` inside a string value
   and saves, **Then** `warehouseId` is listed as a value the target environment must supply, is
   present in the environment template, and is shown in the values checklist as present or
   missing.
4. **Given** a body that references a secret environment value, **When** the engineer opens the
   editor, **Then** the reference is shown by name and marked secret, and no secret value is
   shown or can be revealed.
5. **Given** an edited body, **When** the engineer types a literal value into it, **Then** the
   editor states that literal values are written into the script and that secrets must be
   referenced as `{{name}}`.
6. **Given** a body field the request schema declares `format: password`, **When** the engineer
   enters a literal value in it and saves, **Then** the edit is refused, the field is named, and
   the editor says to reference an environment value as `{{name}}` instead; a `{{name}}`
   reference in that field is saved. The same refusal applies when the engineer changes only
   another field and leaves the generated value in the password field.

---

### User Story 4 - Go back to the generated body (Priority: P2)

After experimenting, the engineer wants the body the specification produced. They reset one
step's body, or every edited body at once, and the plan returns to what was generated.

**Why this priority**: Edits are easy to make and hard to undo by hand, and a plan with many
edited bodies needs a way back. The feature is usable without it, so it follows the editor.

**Independent Test**: Edit three steps, reset one, then reset all, and verify each preview, the
"Body edited" markers and the out-of-date state of the script.

**Acceptance Scenarios**:

1. **Given** a step with an edited body, **When** the engineer chooses "Reset to generated body"
   and confirms, **Then** the step sends the generated body again, its "Body edited" marker is
   removed, and a script generated earlier is marked out of date.
2. **Given** a plan with several edited bodies, **When** the engineer resets all edited bodies in
   one action and confirms, **Then** every step sends its generated body, and the confirmation
   stated how many steps would change.
3. **Given** a plan with edited bodies, **When** the engineer looks at the table, **Then** the
   number of steps with an edited body is shown, and the filter of FR-008 lists them, so each can
   be reset.

---

### Edge Cases

- **An operation with no request body** (for example `GET`, or a `DELETE` without one): the step
  says so, and no editor is offered. A body is never added to an operation whose specification
  documents none (constitution I).
- **An operation whose body is optional and whose scenario sends none**: the step says the
  operation accepts a body that this step does not send, and the engineer can add one.
- **A body that is not JSON** (a documented text content type): it is edited as text, without JSON
  checks; references work the same way.
- **An empty edit**: saving an empty JSON body is refused as not well-formed. For a text body
  whose generated body is not empty, an empty body is sent as empty and the step is marked "Body
  edited"; where the step sends no body, saving an empty text body leaves it with none.
- **An edit identical to the generated body**: saving it records no edit and shows no marker.
- **A removed operation**: its preview in the Removed view stays read-only (AP-032 FR-024a). An
  edit made before removal is kept and comes back when the operation is restored, and the Removed
  view's preview shows it.
- **The plan is rebuilt from a changed source** (a new specification in the quick path, or a
  changed test model in the guided workflow): an edit whose step no longer exists, or whose step
  now uses a different scenario, is discarded, and the plan says which operations lost their
  edits.
- **A reference to a name that is neither a workflow variable nor a unique field**: it is treated
  as an environment value the engineer must supply, like any other.
- **A very large body**: an edit larger than the size limit (Assumptions) cannot be saved, and the
  limit is stated.
- **A guided workflow's Postman collection and functional tests**: they are not affected. Editing
  a performance step's body changes only the performance plan and its script.
- **Backend restart**: edits do not survive, as the plan does not (AP-029, AP-032).

## Requirements *(mandatory)*

### Functional Requirements

**Seeing the body**

- **FR-001**: For every step, the request preview MUST show the body the step sends, or state in
  words that the request has no body. When the operation documents a request body that the step's
  scenario does not send, the preview MUST say so. This amends AP-032 FR-008 for the body only.
- **FR-002**: Each `{{name}}` in a body MUST be shown with where its value comes from at run time:
  an environment value (marked secret where it is one), a workflow variable with the step that
  produces it, a value unique per virtual user and iteration, or a token the plan acquires, as
  AP-032 research Q8 already classifies them.

**Editing the body**

- **FR-003**: For a step in the plan whose operation documents a request body, the engineer MUST
  be able to edit the body the step sends, save the edit, or cancel it. Steps of removed or
  left-out operations MUST NOT be editable. This applies wherever the plan is shown: the quick
  path and the guided workflow's Performance Testing stage alike (AP-032 FR-012a).
- **FR-004**: A JSON body MUST be well-formed JSON to be saved; otherwise the reason and the line
  and column of the error MUST be shown and nothing MUST be saved. Any JSON value is accepted; a
  top-level value whose type differs from the schema's is a mismatch (FR-005), not a refusal. A
  text body MUST be saved as entered.
- **FR-005**: A well-formed body that does not match the operation's request schema (a missing
  required property, a wrong type, a value outside a documented enum, format or bound) MUST be
  saved, and the step MUST show a warning listing each mismatch by field, in words, while the
  mismatch remains. The warning MUST be derived only from the request schema (constitution I) and
  MUST NOT block script generation. A `{{name}}` reference MUST NOT be reported as a mismatch.
- **FR-006**: A saved edit MUST replace the step's generated body in both the preview and the
  script, and the preview MUST remain the request the script sends, byte for byte (AP-032 research
  Q8).
- **FR-007**: Every saved edit or reset MUST mark a previously generated script out of date, as
  other plan edits do (AP-029).
- **FR-008**: A step with an edited body MUST carry a text marker "Body edited" in the plan's
  table, not relying on colour alone; the table MUST show how many steps have an edited body and
  MUST offer a filter to list them.

**References and secrets**

- **FR-009**: The engineer edits the step's **base body**: its body before ApiPilot's
  substitutions (the generated body, or the engineer's earlier edit). ApiPilot MUST
  apply to the edited body the references it applies to a generated one (workflow variables,
  per-iteration unique fields and credentials), each at its field, and the editor MUST list which
  fields are replaced at run time and by what. The engineer MUST be able to add a reference to an
  environment value by writing `{{name}}` inside a JSON string value, or anywhere in a text body.
  A reference MUST be recognised in the edited body exactly as in a generated one. A reference
  whose name ApiPilot reserves for its own substitutions MUST NOT be accepted. (Amended
  2026-09-29 by plan research R1: previously "keep, move or remove any reference". ApiPilot's
  own references are bound to their fields, because their names are internal and positional.)
- **FR-010**: A per-iteration unique field or workflow variable that the edited body no longer
  carries MUST stop being applied to that step, and the plan MUST say so in words, naming the
  field or variable, before the script is generated.
- **FR-011**: An environment value referenced only by an edited body MUST be listed in the plan's
  needed values, the environment template and the values checklist, exactly as AP-029 FR-013 and
  FR-014 list other values. A value no longer referenced by any step MUST no longer be listed.
- **FR-012**: No value from an environment MUST be shown in the editor, stored with the plan, or
  written into the script. Secrets MUST reach the script only through the run's environment
  (constitution XVIII). The editor MUST state that literal values are written into the script and
  that secrets must be referenced as `{{name}}`. (Amended 2026-09-29 by plan research R8:
  previously "No secret value". A literal the engineer types into a field the schema does not mark
  as sensitive cannot be recognised as a secret without guessing, which FR-012a forbids; the
  statement in the editor is the safeguard there.)
- **FR-012a**: An edited body that holds anything other than a single `{{name}}` reference in a
  field the request schema declares `format: password` MUST NOT be saved, even when the engineer
  changed only other fields; the field MUST be named and the engineer told to reference an
  environment value instead. Sensitive fields MUST be identified from the schema only; ApiPilot
  MUST NOT guess them from field names (constitution XIV). (Amended 2026-09-29 by
  `/speckit-analyze` finding C1: the generated value is no longer accepted, to meet constitution
  v2.5.0 XVII as written.)
- **FR-013**: The content of an edited body MUST be written into the script only as data, so that
  no content of a body can run as script code.

**Provenance and determinism**

- **FR-014**: A run's snapshot and report MUST record which steps sent an edited body (by
  operation), and MUST NOT contain any body content (AP-029 research D20). The report MUST state
  that those bodies were written by the engineer and not generated from the specification
  (constitution XI, XIII).
- **FR-015**: The same plan with the same edits MUST produce the same script and environment
  template byte for byte (constitution XVI, AP-032 FR-007).
- **FR-016**: Editing a performance step's body MUST NOT change the approved test model, the
  generated Postman collection, or any functional test.

**Going back**

- **FR-017**: The engineer MUST be able to reset one step's body to the generated body, and to
  reset every edited body in one action. Both MUST ask for confirmation, and resetting all MUST
  state how many steps will change.
- **FR-018**: An edit MUST be kept with its step while the plan exists, including while the
  operation is removed. When the plan is rebuilt and a step no longer exists or uses a different
  scenario, its edit MUST be discarded and the plan MUST name the operations whose edits were
  discarded.

**Parameters (amended 2026-09-30)**

- **FR-020**: For a step in the plan, the engineer MUST be able to change the value of each path,
  query and header parameter the operation documents, and to leave out an optional query or
  header parameter, including adding an optional parameter the generated scenario does not send.
  The request preview MUST show each documented parameter with its schema (type, format, allowed
  values), the generated value (or that none is sent) and what the step sends. A saved change
  MUST be applied where a body edit is, so the preview and the script send the same request;
  only changes that differ from the generated request are kept. Edits MUST be kept, discarded,
  reset and fingerprinted as body edits are (FR-006, FR-007, FR-015, FR-017, FR-018), and an
  edited path parameter MUST be sent as its value instead of an environment value.
- **FR-021**: The following MUST be refused, naming the parameter and never quoting its value, and
  nothing MUST be applied: an undocumented parameter; a parameter a workflow variable fills (it is
  shown as filled at run time); a new value for an array or object parameter (it may be left
  out); leaving out a required parameter or any path parameter; an empty path parameter; a value
  over 2 KiB or with a control character; a `{{name}}` ApiPilot reserves; and a literal in a
  parameter of `format: password`, which MUST hold exactly one `{{name}}` reference. A `{{name}}`
  the engineer writes MUST be listed as a needed value (`parameter-reference`), secret in a
  `format: password` parameter.
- **FR-022**: A step with edited parameters MUST be marked "Parameters edited" in the plan. A run's
  snapshot MUST keep that mark and hold no parameter edit. The report MUST mark the step
  "Parameters edited by you", state how many steps sent edited parameters, and contain no
  parameter value.
- **FR-023**: The plan MUST mark each step that the session's latest finished run answered with a
  status the step does not expect, naming the statuses, and offer a filter for those steps. The
  report's response block of such a step MUST say that its request can be checked and edited in
  the plan.

### Key Entities *(include if feature involves data)*

- **Body Edit**: the engineer's replacement for one step's body: the step it belongs to, the
  scenario that step used when the edit was made, the content type (JSON or text) and the edited
  body (a JSON value or text) with any `{{name}}` references the engineer wrote. Kept with the performance plan for the session, never in
  run snapshots or reports. Its provenance is USER (constitution XIII).
- **Step Request Preview** (existing, AP-032): gains the statement that a request has no body, or
  that the operation accepts a body the step does not send, whether the body shown is edited, and
  the schema mismatches of an edited body (FR-005).
- **Performance Plan** (existing, AP-029, AP-032): gains the step's body edits and the notices
  about references no longer applied (FR-010) and edits discarded on rebuild (FR-018).
- **Run Report** (existing, AP-029): gains the list of operations whose body was edited.
- **Parameter Edit** (amended 2026-09-30): one step's changed parameters (location, name, and a
  value or "left out"), with the step and scenario it was made for. Kept with the plan like a
  Body Edit, never in run snapshots or reports. Its provenance is USER.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An engineer can change one value in a step's body and have the next generated script
  send it in under 1 minute, without leaving the plan screen.
- **SC-002**: For 100% of steps, the body shown in the preview and the body the generated script
  sends are identical, with and without edits.
- **SC-003**: No generated script, stored plan, run snapshot or report contains a value from an
  environment, and no run snapshot or report contains any body content, in 100% of runs.
- **SC-003a**: In 100% of attempts, an edit that puts a literal value in a `format: password` body
  field is refused before it is saved.
- **SC-004**: Generating the script twice from the same plan and edits gives byte-identical files
  in 100% of runs.
- **SC-005**: For 100% of steps without a body, the preview states that there is no body; no step
  shows an empty body area.
- **SC-006**: On a plan of 100 steps, the engineer can find every step with an edited body in one
  action and reset all of them in one confirmed action.

## Assumptions

- The body and, since 2026-09-30, the documented path, query and header parameters become
  editable. Authentication, undocumented headers, and the method and path template stay as
  generated.
- Editing works on the body before ApiPilot's substitutions (FR-009); the preview beside it shows
  the body as sent, which is what the script sends. References are recognised inside JSON string
  values, as they are in generated bodies today.
- JSON and text bodies are supported because they are the content types the plan's requests use
  today. Form and multipart bodies are not edited in this feature.
- The size limit for one edited body is 64 KiB, well above generated positive-scenario bodies; it
  bounds what the plan holds in memory for the session.
- Edits last as long as the plan does: one session, lost on a backend restart, as AP-029 and
  AP-032 plans are.
- An edit does not change which scenario a step uses (AP-029's selection rule), its expected
  statuses, or its authentication.
- Out of scope: editing authentication, undocumented headers or cookies; editing the value of an
  array or object parameter; adding a body to an operation whose
  specification documents none; AI suggestions for body values; carrying performance body edits
  over to the functional tests or the Postman collection.
