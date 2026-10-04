# Feature Specification: Request-Chain Performance Plans

**Feature Branch**: `[037-request-chain-performance]`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "K6 performance testing implementation so far is too complex. I want
simple as we could do in postman like request chaining. Similar thing is possible in Jmeter. Lets
revisit our k6 implementation" and "Think of the fact that, you need flexibility to setup apis in a
way because the uploaded openAPI spec has crap data / dummy data" (2026-10-02). The engineer's
example journey: `POST /auth/token` (extract the token, edit the body, check the status), then
`POST`, `GET` (list), `PUT`, `GET` (one), `PATCH` and `DELETE` on `/api/v1/customers[/{id}]`, each
using the token, setting headers, editing the body or query, extracting values for later steps and
checking the status.

**Product identifier**: `AP-037` (post-MVP). This spec directory is numbered `037` per the
repository's sequential feature-directory convention; the directory number and the `AP-###`
identifier happen to coincide here but remain independent. `AP-037` is the canonical identifier
used in cross-references, commit messages, and `specs/ROADMAP.md`.

**Relationship to prerequisite specifications**: Today's performance plan (AP-029, AP-032, AP-033,
AP-035, AP-036) is a view derived from generated scenarios, approved workflows or a stored
collection, with the engineer's changes stored as overlays on top of it: body edits and parameter
edits (AP-033), captures and bindings (AP-035), proposed journeys and user-defined journeys with
"Edit journey" and revert (AP-035), credential producers outside the journeys (AP-029 FR-009,
AP-036 FR-027), and a conversion review (AP-036 FR-018). The view is re-resolved on every assembly,
so each overlay needs rules for when its target changes or disappears. Edits can only attach to
what the specification documents, so an undocumented header cannot be set and a request the
specification does not describe cannot be added. When the specification's examples, statuses or
paths are wrong, the engineer cannot fully correct them.

This feature replaces that model with one the engineer owns outright, as in Postman or JMeter: a
**request-chain plan**. A plan holds one or more **chains**; a chain is an ordered list of
**steps**; a step is a concrete request (method, URL, query parameters, headers, body) with
expected statuses, extractors, checks, think time and a "runs" setting. `{{name}}` may appear in
any text of a step. The guided workflow, the quick test from a specification and Import & Run
Collection become ways to **seed** a first draft. After seeding, the plan is never re-derived from
its source.

It keeps, unchanged:
- the load profiles, user-set thresholds, environments and their encrypted values, the run
  trigger's naming of the target environment, the user-installed k6, one execution slot per
  session, live progress, cancel, persistence of runs, and the self-contained report (AP-029
  FR-017 to FR-019, FR-024 to FR-038, FR-040 to FR-042);
- the data-plus-fixed-interpreter design of the generated script, byte-identical for the same
  plan (AP-029 FR-020, FR-022, and FR-022a for plans without data sets, FR-047);
- the write-operation summary and its markers, now computed from each step's method (AP-032
  FR-009 to FR-012a);
- the supported Postman dynamic variables and their uniqueness rules (AP-036 FR-013), now
  available in every plan;
- the closed field-path grammar for reading a JSON response field (AP-035);
- running a user-supplied k6 script (AP-034), which does not use a plan and is out of scope.

It changes these existing decisions, each stated as a requirement below:
- AP-029 FR-002, FR-003, FR-005 and FR-006, AP-032 FR-004 to FR-006, and AP-036 FR-002 decide
  a plan's steps from their source every time the plan is assembled. They now decide only the
  seeded first draft (FR-020 to FR-026).
- AP-029 FR-007 refuses a reorder that places a consumer before its producer. Reordering is now
  always allowed; a use of an extracted value before the step that extracts it is listed and
  blocks generation instead (FR-014).
- AP-029 FR-009 and AP-036 FR-027 handle authentication through credential producers outside the
  journeys. Authentication is now ordinary steps the engineer can see and edit, with a "runs"
  setting (FR-008, FR-022).
- AP-029 FR-010 and AP-035 FR-010/FR-033 apply to captures and workflow variables. The same rule
  now applies to extractors (FR-011, FR-012).
- AP-029 FR-016 derives unique body values from the virtual-user and iteration numbers. Seeding
  now writes them as supported dynamic variables in the step's text (FR-021).
- AP-029 FR-039 records provenance against scenarios and dependency relationships. Provenance is
  now each step's seed source and whether the engineer changed it (FR-033).
- AP-036 FR-025 holds at most one collection plan per session, in memory, and the guided and quick
  plans are in memory too. Plans are now saved locally and a session may hold several (FR-039).
- AP-033 (step body and parameter edits), AP-035 (user-defined journeys, captures, bindings) and
  AP-036 FR-018 (the conversion review that gates the script) are superseded by direct editing
  and are retired in the second phase (FR-036 to FR-038).

**Governance**: Constitution XVII's 2026-09-24 exception (extended 2026-09-27, 2026-09-29 and
2026-10-02) covers scripts ApiPilot generates from plans that AP-029, AP-032 and AP-036 build, each
with its own meaning of "approved". A request-chain plan is authored by the engineer whatever it was
seeded from, so its steps are user content, as AP-036's collection requests are today. The
exception MUST be amended before `/speckit-plan` continues, to consolidate the k6 exceptions into
one rule for request-chain plans. *(Done 2026-10-02: constitution v2.8.0, commit `d0873c3`, merged
to `main`; noted by plan 2026-10-03.)* What this specification relies on:
- ApiPilot still writes every byte of the script, deterministically, and the engineer's content
  reaches it only as data, never as code (FR-016, FR-030);
- no secret value reaches the plan or the script: secrets are environment references, and a
  literal credential becomes a secret environment value (FR-027, FR-028);
- "approved" means the engineer reviewed the plan at the run trigger, which lists every chain and
  step, every write and every host the plan sends to, and then triggered the run (FR-029, FR-031);
- the script sends requests only to the target environment's base URL and to hosts written
  literally in step URLs (FR-029);
- the run's snapshot and report name each step's seed source and mark each step the engineer
  changed, without containing that content (FR-033).

- a data set's values never reach the script or the environment template; they reach k6 only at
  run time, are encrypted at rest, and are never shown, logged or reported (FR-041 to FR-047).

Constitution XV (conservative dependency inference) is respected: seeding chains only the
workflows the engineer approved (AP-008, AP-016), and ApiPilot never creates an extractor or a
reference itself outside seeding. XIII (provenance) and XIV (no silent assumptions) are met by
FR-033 and by listing what seeding could not carry over (FR-025).

## Clarifications

### Session 2026-10-02

- Q: How does the request-chain model relate to the existing plan? → A: It replaces it, in
  phases: the chain becomes the one plan model and the old overlay screens are retired once the
  chain works on every entry point (FR-020, FR-036).
- Q: How often does a step such as `POST /auth/token` run under load? → A: A per-step setting:
  once before load, once per virtual user, or every iteration (FR-008).
- Q: Which checks besides the status code? → A: JSON field exists or equals a value, body contains
  text, and a per-step response time limit (FR-016).
- Q: One chain per plan, or several? → A: Several, run in order by every virtual user on each
  iteration (FR-001, FR-002).
- Q: Must the plan allow fixing a specification's dummy data and wrong details? → A: Yes; seeding
  is only a first draft, every part of a step is editable, requests the specification does not
  describe can be added, and nothing is checked against the specification (User Story 2, FR-003,
  FR-026).
- Q: Are plans saved locally and kept across a backend restart? → A: Yes, in the local database
  (AP-025), owned by the session (FR-039).
- Q: Does a once-before-load token step keep AP-029 FR-015's per-virtual-user refresh when its
  response states a lifetime? → A: Yes (FR-040).
- Q: Does the plan accept data files supplying `{{name}}` values per virtual user or iteration? →
  A: Yes, CSV data sets are part of this feature (User Story 6, FR-041 to FR-047).

### Session 2026-10-03

- Q: When a hand-edited step holds a literal credential and the plan has no target environment,
  what happens on save? → A: The save is refused with the reason, and the engineer is asked to
  choose a target environment first; nothing is stored (FR-027).
- Q: May a Once before load step use a data set column? → A: Yes, always from the data set's
  first row, and the report says so (FR-014, FR-043).
- Q: May a script from a plan with data sets fail AP-034's user-script check? → A: Yes. AP-029
  FR-022a applies only to plans without data sets, because reading a data set needs `open()`,
  which AP-034 refuses; downloading such a script says its copy cannot run in Run k6 Script
  (FR-047).
- Q: May each run keep a copy of its plan's steps so restore can bring them back? → A: Yes, an
  encrypted copy stored with the run, separate from the snapshot and report, read only by restore
  (FR-035).
- Q: What if SC-006's half-size target cannot be met without removing required behaviour? → A:
  Keep the target, measure it at the end of phase one, and if over target report the gap and agree
  a revised target before phase two; required behaviour is never cut to meet it (SC-006).
- Q: Phase one measured 22,357 lines and phase two is projected at about 12,500 to 13,500. Which
  target should phase two be held to? → A: At most 13,000 lines over the same measured set (SC-006).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build the customer journey as a request chain (Priority: P1)

A performance engineer wants to load-test the customer lifecycle. In a new request-chain plan they
add a chain "Customer lifecycle" and add steps one by one, as they would in Postman:

1. `POST {{baseUrl}}/auth/token` with a form body `client_id={{client_id}}` and
   `client_secret={{client_secret}}`, runs **Once before load**, expects `200`, and extracts
   `token` from the body field `access_token`.
2. `POST {{baseUrl}}/api/v1/customers` with header `Authorization: Bearer {{token}}`, a JSON body
   they type, expects `201`, and extracts `customer_id` from `id`.
3. `GET {{baseUrl}}/api/v1/customers` with query parameters `page=1` and `size=20`, expects `200`.
4. `PUT {{baseUrl}}/api/v1/customers/{{customer_id}}`, a JSON body, expects `200`.
5. `GET {{baseUrl}}/api/v1/customers/{{customer_id}}`, expects `200`, with a check that body field
   `id` equals `{{customer_id}}`.
6. `PATCH {{baseUrl}}/api/v1/customers/{{customer_id}}`, a JSON body, expects `200`.
7. `DELETE {{baseUrl}}/api/v1/customers/{{customer_id}}`, expects `204`.

As they type `{{`, the editor offers the names extracted by earlier steps and the target
environment's values. The plan lists `client_id` and `client_secret` as values the environment must
provide, and marks `client_secret` secret. The run trigger lists the chain, the five write steps and
the one host. Under load, the token request is sent once before the load; each virtual user then
creates, reads, updates and deletes its own customer on every iteration.

**Why this priority**: It is the request in its smallest form. Every other story builds on a plan
whose steps the engineer owns.

**Independent Test**: Against a local test server with a token endpoint that counts its calls and
customer endpoints that return 404 for an unknown id, build the seven-step chain by hand (no
specification, no collection), generate the script, and run a smoke test with two virtual users
and three iterations. Check that the token endpoint was called once, that every request after it
carried the token, that each PUT, GET, PATCH and DELETE used the id the same virtual user's POST
returned in the same iteration, that no 404 was received, and that the same plan generates a
byte-identical script twice.

**Acceptance Scenarios**:

1. **Given** a new request-chain plan, **When** the engineer adds a chain and a step, **Then** they
   can set the step's method, URL, query parameters, headers and body directly, with no
   specification or collection loaded.
2. **Given** a step, **When** the engineer adds an extractor, **Then** they name it and take it
   from a JSON response body field by field path or from a response header by name.
3. **Given** a later step, **When** the engineer writes `{{customer_id}}` in its URL, a query
   value, a header value or its body, **Then** the request sends the value the earlier step
   extracted in the same iteration by the same virtual user.
4. **Given** a step set to run **Once before load**, **When** the run starts, **Then** it is sent
   once before any virtual user starts, and its extracted values are shared by every virtual user
   for the whole run.
5. **Given** a step with expected statuses, **When** a response has any other status, **Then** the
   request counts as failed and its extractors are not attempted.
6. **Given** an extractor that fails (missing, empty or not a single value, or an unexpected
   status), **When** the iteration continues, **Then** the rest of that chain is not sent in that
   iteration, the chain is recorded as cut short with the extractor's name, and the virtual user
   continues with its next chain.
7. **Given** a plan whose steps use `{{names}}`, **When** the plan is shown, **Then** it lists every
   name that is neither extracted by an earlier step nor a dynamic variable, with whether the chosen
   environment provides it.

---

### User Story 2 - Start from the specification, then fix its dummy data (Priority: P1)

The engineer's specification is weak: its request examples are placeholders (`"string"`, `0`,
`user@example.com`), `POST /customers` documents `200` where the API returns `201`, the token
endpoint is not documented at all, and one path is documented as `/customer/{customerId}` where the
real API serves `/api/v1/customers/{id}`. They seed a plan from the specification and get a draft
with one step per operation. They then:
- replace the body of the POST step with a realistic payload they paste in;
- change its expected status to `201`;
- add the undocumented token request as a new step at the top of the chain;
- correct the path of the PUT step and add an `X-Tenant-Id` header the specification never
  mentions;
- move the steps into one chain in the order their API needs, and delete steps they do not want.

Nothing they change is checked against, overwritten by or re-derived from the specification. Each
seeded step still shows which operation it came from, marked "Changed" once edited.

**Why this priority**: Real specifications carry dummy data and wrong details. A plan the engineer
cannot fully correct produces failing load tests by design, which is the problem this feature
exists to fix.

**Independent Test**: Seed from a fixture specification with placeholder examples, a wrong
documented status and a wrong path. Make each change above, generate and run a smoke test against a
test server that implements the real API. Check that every request was sent exactly as edited, that
no edit was reverted after reloading the plan or reseeding a different plan, and that the report
marks each changed step and names its seed operation.

**Acceptance Scenarios**:

1. **Given** a plan seeded from a specification, **When** the engineer changes any part of a step
   (method, URL, query, headers, body, expected statuses), **Then** the step sends exactly what was
   entered, and no schema or documented-status check blocks or warns.
2. **Given** a seeded chain, **When** the engineer adds a step that no operation describes, **Then**
   it behaves like any other step and is shown as "Added by you".
3. **Given** seeded steps, **When** the engineer moves steps between chains, duplicates a step,
   deletes a step or deletes a chain, **Then** the plan changes accordingly and nothing is restored
   from the specification.
4. **Given** an edited seeded step, **When** the plan is shown, **Then** the step names the
   operation it was seeded from and is marked "Changed".
5. **Given** a seeded body with placeholder values, **When** the engineer replaces them with
   `{{name}}` references, **Then** those names are listed as values the environment must provide.

---

### User Story 3 - Checks beyond the status code (Priority: P2)

The engineer wants to know not only that `GET /customers/{{customer_id}}` returned `200`, but that
it returned the right customer, quickly. On that step they add three checks: body field `id` equals
`{{customer_id}}`, the body contains `"status":"ACTIVE"`, and the response arrives within 500 ms.
After the run, the report shows each check's pass and fail counts.

**Why this priority**: A `200` with the wrong record or an error page hides real defects under
load. Story 1 works without it; most realistic tests want it.

**Independent Test**: Against a test server that returns the wrong id for one request in ten and
delays one request in five past 500 ms, run a load profile and check that each check's failure
count matches the server's behaviour within the run's counts, and that the step's failed-check
count is reported separately from its unexpected statuses.

**Acceptance Scenarios**:

1. **Given** a step, **When** the engineer adds a check, **Then** it is one of: a JSON body field
   exists; a JSON body field equals a value (text, number, boolean, or a `{{name}}`); the body
   contains a text; or the response time is at most a number of milliseconds.
2. **Given** a failed check, **When** the iteration continues, **Then** the failure is counted for
   that check and step, the step's later extractors are still attempted, and the chain continues.
3. **Given** a run that ended, **When** the report is shown, **Then** each check shows how many
   times it passed and failed.

---

### User Story 4 - Seed from a Postman collection or the guided workflow (Priority: P2)

The engineer already has the customer journey as a Postman collection in Import & Run Collection,
with `pm.environment.set("customer_id", pm.response.json().id)` in a test script and
`pm.response.to.have.status(201)`. They choose **Set up a performance test** and get one chain per
folder, with each request as a step, the setter as an extractor, the status assertion as the
expected status, and request auth written as a header. A short seeding report lists what could not
be carried over (pre-request scripts and unrecognised script statements). From the guided workflow,
seeding gives one chain per approved workflow, with its variables as extractors and `{{name}}`
references, and one single-step chain per other operation.

**Why this priority**: Engineers rarely start from nothing. Seeding saves work while keeping the
plan the engineer's own.

**Independent Test**: Seed from a fixture collection with two folders, an extracting test script, a
status assertion, a pre-request script and bearer auth at folder level. Check that the plan has two
chains in run order, that the extractor, expected status and `Authorization` header are on the
right steps, that the seeding report lists the pre-request script with its request, and that
editing the collection afterwards does not change the plan.

**Acceptance Scenarios**:

1. **Given** a stored collection, **When** the engineer seeds a plan, **Then** each selected request
   becomes a step in run order, grouped into one chain per top-level folder (requests at the root
   form one chain), with auth inherited from folders or the collection written as headers.
2. **Given** a test script statement in the forms AP-036 recognises, **When** seeding runs, **Then**
   a setter becomes an extractor and a status assertion becomes the step's expected statuses.
3. **Given** anything seeding cannot carry over, **When** seeding ends, **Then** the seeding report
   lists each item with its source request, and the report stays viewable from the plan.
4. **Given** a seeded plan, **When** its source changes (the collection is edited, the guided
   workflow's approvals change, or a new specification is uploaded), **Then** the plan does not
   change; the engineer may seed a new plan explicitly.

---

### User Story 5 - One plan model everywhere (Priority: P3)

Once request-chain plans work on every entry point, the old plan screens go away: no separate
body editor overlay, no parameter overlay, no capture and binding pickers, no proposed versus
user-defined journeys, no conversion review gate. An engineer who opens a past run made before this
change still sees its report exactly as before.

**Why this priority**: The simplification is only real once the old model is gone. It follows the
first phase so that no capability disappears before its replacement works.

**Independent Test**: With a persisted run from each old plan source (guided, quick, collection),
complete phase two. Check that each old report renders unchanged, that no screen offers the retired
controls, and that the guided, quick and collection entry points each open a request-chain plan.

**Acceptance Scenarios**:

1. **Given** phase two is complete, **When** the engineer opens a performance plan from any entry
   point, **Then** it is a request-chain plan.
2. **Given** a run recorded before this feature, **When** its report is opened, **Then** it renders
   as it did, and **Run again** is not offered for it.

---

### User Story 6 - Real test data from a CSV data set (Priority: P2)

The specification's examples are dummy data, and the engineer's test environment needs real
customer names, tenant ids and logins that exist there. They upload `customers.csv` with a header
row `tenant_id,first_name,last_name,email,username,password`, mark `password` secret, and choose
**Next row per iteration**. In their steps they write `{{first_name}}`, `{{email}}` and
`X-Tenant-Id: {{tenant_id}}`. A second data set, `logins.csv`, uses **One row per virtual user**,
so each virtual user logs in as a different user in a **Once per virtual user** step. The plan shows
both data sets' columns and row counts, and the values the environment must still provide. The
run trigger lists the data sets. The report says how many rows each data set used, and never shows
a value.

**Why this priority**: Dummy specification data is only half fixed by editing steps by hand. Load
tests need many distinct, realistic records, as JMeter's CSV Data Set Config and Postman's data
files provide.

**Independent Test**: Upload a 50-row CSV with a secret column, use it in **Next row per
iteration** mode, run 5 virtual users for 20 iterations each against a test server that records
what it receives, and check that the rows were used in order, wrapping after row 50; that the
secret column's values appear in no plan, script, environment template, snapshot, report or log;
and that the same plan generates a byte-identical script whatever the file's content.

**Acceptance Scenarios**:

1. **Given** a plan, **When** the engineer uploads a CSV file with a header row, **Then** it becomes
   a data set whose columns are names usable as `{{name}}` in any step, and the plan shows its
   columns and row count.
2. **Given** a data set in **One row per virtual user** mode, **When** the run starts, **Then** each
   virtual user takes the next row once and keeps it for the whole run.
3. **Given** a data set in **Next row per iteration** mode, **When** each iteration starts, **Then**
   it takes the next row in the run's order, shared across virtual users.
4. **Given** more takers than rows, **When** the rows run out, **Then** the order wraps to the first
   row, and the report says the data set wrapped.
5. **Given** a malformed file (no header row, a row with a different number of fields, invalid
   column names, invalid encoding), **When** it is uploaded, **Then** it is refused with the reason
   and line number, and nothing is stored.
6. **Given** a column marked secret, **When** the data set is previewed, **Then** that column's
   values are hidden.

### Edge Cases

- **Use before extraction**: a step uses `{{customer_id}}` but the step that extracts it comes
  later in run order, or in a chain the virtual user runs later. The plan lists the step and the
  name, and the script cannot be generated until it is fixed. Moving steps is never refused.
- **Name both extracted and in the environment**: an extracted value takes priority once it exists;
  before it is extracted the use is an error (above), not a silent fall-back to the environment.
- **Same name extracted twice**: a later extractor replaces the value for the steps after it. The
  plan shows both extractors on the name.
- **Setup step uses a per-iteration value**: a **Once before load** step may use only environment
  values, dynamic variables, data set columns (first row) and values extracted by earlier **Once
  before load** steps; anything else is listed and blocks generation.
- **Setup step fails**: when a **Once before load** step gets an unexpected status, no response, or
  a failed extractor, the load does not start. The run ends as failed, naming the step and the
  reason.
- **Per-virtual-user step fails**: a **Once per virtual user** step that fails cuts its chain short
  for that iteration and is attempted again on the virtual user's next iteration.
- **Stale values**: values extracted by **Every iteration** steps are cleared at the start of each
  iteration, so a failed extraction never leaves the previous iteration's value in place.
- **Non-JSON response**: every body extractor and JSON check of that step fails; header extractors,
  body-contains and response-time checks still apply.
- **Header repeated in the response**: a header extractor takes the value as k6 reports it for that
  name, never split (as AP-035).
- **Host from a variable**: a URL whose scheme and host come from any `{{name}}` other than the base
  URL value is listed and blocks generation, because the run trigger could not name the host.
- **Literal credential typed by the engineer**: a literal value in an `Authorization`,
  `Proxy-Authorization` or `Cookie` header, or in a JSON body field the seeding operation's request
  schema declares `format: password`, is moved into a secret environment value when the step is
  saved, and the step keeps only the reference. The engineer is told which value was moved. When
  the plan has no target environment, the save is refused with the reason and nothing is stored
  until a target environment is chosen.
- **Headers the runtime sets**: `Host` and `Content-Length` cannot be set; the editor says why.
- **Empty chain**: a chain with no steps, or whose every step runs once before load, is listed and
  is not run as a chain.
- **Missing environment value**: as AP-029 FR-014, it does not block generation; each step that
  needs it is reported failed with "missing data" and the name, and nothing is sent for it.
- **A step with no expected status**: blocks generation, as AP-029 FR-012a.
- **Data set column also an environment value**: the data set's value is used; the plan shows that
  the column shadows the environment value.
- **Column name in two data sets**: refused when the second data set is added or a column renamed;
  column names are unique across a plan's data sets.
- **Empty cell**: sent as an empty text, not treated as missing.
- **Data set used by a Once before load step**: the step takes the first row, once, and the report
  says so.
- **Data set removed while steps use its columns**: those names become unresolved and are listed
  (FR-015).
- **Plan saved, then the backend restarts**: the plan, its chains, steps, seeding report and data
  sets reopen in the same session as they were saved (FR-039).
- **Token lifetime stated**: a **Once before load** step whose response carries `expires_in`
  refreshes per virtual user (FR-040); one without a stated lifetime is never refreshed, and
  failures after expiry are reported as authentication errors that say the lifetime was not stated.

## Requirements *(mandatory)*

### Functional Requirements

**Plan, chains and steps**

- **FR-001**: A request-chain plan MUST hold one or more chains, each with a name and an ordered list
  of steps, plus the existing load profile, think time default, thresholds and target environment.
- **FR-002**: The engineer MUST be able to add, rename, reorder, duplicate and delete chains, and
  add, reorder, duplicate, move between chains and delete steps. On each iteration, every virtual
  user MUST run every chain in the plan's chain order (as AP-029 FR-006a).
- **FR-003**: Each step MUST have a method (GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS), a URL,
  an ordered list of query parameters (name and value), an ordered list of headers (name and value),
  and a body that is none, raw text with a content type, or form URL-encoded name and value pairs.
  Every one of these MUST be editable, and headers MUST NOT be limited to those a specification
  documents.
- **FR-004**: `{{name}}` MUST be accepted in the URL, every query parameter name and value, every
  header value and the body. Names MUST be letters, digits and underscores, or a supported dynamic
  variable (`{{$name}}`, AP-036 FR-013).
- **FR-005**: The editor MUST offer, as the engineer types `{{`, the names extracted by earlier steps
  in run order, the target environment's value names, and the supported dynamic variables.
- **FR-006**: Each step MUST have one or more expected status codes before the script can be
  generated (AP-029 FR-012a). Seeding MAY pre-fill them (FR-021, FR-023); the engineer MUST be able
  to change them.
- **FR-007**: Each step MAY have a think time after it; otherwise the plan's default applies.
- **FR-008**: Each step MUST have a "runs" setting: **Every iteration** (the default), **Once per
  virtual user** (on that virtual user's first iteration, at its place in the chain), or **Once
  before load** (before any virtual user starts, in plan order, shared by every virtual user).

**Extractors, values and checks**

- **FR-009**: A step MAY have extractors. Each MUST have a name and a source: a JSON response body
  field by the closed field-path grammar (AP-035), or a response header by case-insensitive name.
- **FR-010**: An extracted value MUST be available to every step that runs after its extractor for
  the same virtual user: for the rest of the run (**Once before load**, shared by all virtual users),
  for the rest of that virtual user's run (**Once per virtual user**), or for the rest of the
  iteration (**Every iteration**, cleared at the start of the next iteration).
- **FR-011**: Extractors MUST be attempted only when the step received one of its expected statuses,
  and MUST succeed only for a string, number or boolean value (as AP-035 FR-033).
- **FR-012**: When an extractor fails, the rest of that chain MUST NOT be sent in that iteration, the
  chain MUST be recorded as cut short with the extractor's name, and the virtual user MUST continue
  with its next chain (as AP-029 FR-010).
- **FR-013**: A `{{name}}` MUST resolve, in order, from a value extracted earlier for that virtual
  user, then from the current row of the data set that has that column (FR-043), then from the
  target environment. Dynamic variables MUST be generated as AP-036 FR-013
  defines.
- **FR-014**: Before generation and before a run, the plan MUST list every use of a name that some
  step extracts but that comes before every extractor of that name in run order, and every
  **Once before load** step that uses a value other than an environment value, a dynamic variable,
  a data set column (first row, FR-043) or an earlier **Once before load** extraction. Each item
  MUST block generation and name the step and the name. Reordering MUST NOT be refused.
- **FR-015**: Before generation and before a run, the plan MUST list every other name a step uses
  that no step extracts, no data set provides and that is not a dynamic variable, with the steps that use it, whether it
  is secret, and whether the chosen environment provides it (AP-029 FR-013). A missing value MUST
  be handled as AP-029 FR-014.
- **FR-016**: A step MAY have checks, each one of: a JSON body field exists; a JSON body field
  equals a text, number, boolean or `{{name}}`; the response body contains a text; the response
  time is at most a number of milliseconds. Checks are data, never expressions or code.
- **FR-017**: A failed check MUST be counted for that check and step, and MUST NOT stop the step's
  extractors or the chain.
- **FR-018**: A **Once before load** step that receives an unexpected status, no response, or a
  failed extractor MUST stop the run before the load starts. The run MUST end as failed, naming the
  step and the reason, and ApiPilot MUST NOT retry it.
- **FR-019**: A **Once per virtual user** step that fails MUST cut its chain short for that iteration
  and MUST be attempted again on that virtual user's next iteration.

**Seeding a first draft**

- **FR-020**: The quick performance test, the guided workflow's Performance Testing stage and Import
  & Run Collection's **Set up a performance test** MUST each create a request-chain plan by seeding,
  and an engineer MUST also be able to start an empty plan. Seeding MUST be deterministic: the same
  source and selection produce the same plan.
- **FR-021**: Seeding from a specification MUST write, for each operation, one step whose request is
  the operation's chosen positive scenario (AP-029 FR-003) as concrete text, with the documented
  success statuses as expected statuses (AP-029 FR-012), values that must be unique as supported
  dynamic variables, and values the specification cannot produce as `{{name}}` references.
- **FR-022**: Seeded authentication MUST be ordinary steps and headers: a credential producer
  (OAuth2 client credentials, chained login, distinct per-role credentials) becomes a **Once before
  load** step with an extractor, and each step that used it gets the header that applies it with a
  `{{name}}` reference. *(Amended 2026-10-04, 19.22.0: when seeding from a specification, a token
  operation (a login, an API-key issuer) is an ordinary selectable operation and is seeded as a
  credential step only when it is selected; a token source with no operation behind it, such as OAuth2
  client credentials, is seeded only when a seeded step sends its token. Endpoints that need no token
  never cause a credential step. Guided-workflow and collection seeding are unchanged.)*
- **FR-023**: Seeding from the guided workflow MUST give one chain per approved workflow, with each
  workflow variable as an extractor on its producer and a `{{name}}` reference on its consumers, and
  one single-step chain per other operation in scope. Seeding from the quick path MUST give one
  single-step chain per operation, with login operations left out as AP-032 FR-003a.
- **FR-024**: Seeding from a collection MUST give one chain per top-level folder (requests at the
  root form one chain), with the selected requests in run order. Each step MUST send what the
  functional run sends (AP-036 FR-003), with inherited auth written as headers. Test-script
  statements AP-036 recognises MUST become extractors and expected statuses. No script MUST be run
  or evaluated (AP-036 FR-005).
- **FR-025**: Seeding MUST produce a seeding report listing everything it could not carry over (for
  example pre-request scripts, unrecognised statements, unsupported dynamic variables, operations
  with no positive scenario), each with its source. The report MUST remain viewable from the plan.
  It MUST NOT gate script generation.
- **FR-026**: After seeding, the plan MUST NOT be re-derived from, validated against or overwritten
  by its source. A change to the source MUST NOT change the plan.

**Security, approval and determinism**

- **FR-027**: The plan, the script and the environment template MUST contain no secret value
  (AP-029 FR-021). A literal value in an `Authorization`, `Proxy-Authorization` or `Cookie` header,
  or in a JSON body field the seeding operation declares `format: password`, MUST be moved into a
  secret value of the target environment when the step is saved, and the step MUST keep only the
  reference. The engineer MUST be told which value was moved and where. When the plan has no target
  environment, the save MUST be refused with the reason, nothing MUST be stored, and the engineer
  MUST be asked to choose a target environment first.
- **FR-028**: Captured and extracted values MUST exist only in the virtual user's memory during the
  run. They MUST NOT be stored, shown, logged or reported (AP-035 FR-019, FR-020).
- **FR-029**: Every step URL MUST start with the target environment's base URL value or a literal
  scheme and host. The script MUST send requests only to those hosts, and the plan and the run
  trigger MUST list each host.
- **FR-030**: The script MUST contain the plan's content only as data interpreted by ApiPilot's one
  fixed runtime, never as code, and the same plan MUST generate a byte-identical script (AP-029
  FR-020).
- **FR-031**: The run trigger MUST name the target environment by name, tier and base URL (AP-029
  FR-025), and MUST list the chains, the number of steps, the write-operation summary per step
  (AP-032 FR-011) and the hosts (FR-029).
- **FR-032**: Any change to the plan after generation MUST mark the script out of date (AP-029
  FR-023).

**Report and provenance**

- **FR-033**: Each step in the plan, the run's snapshot and the report MUST carry its source: the
  operation, workflow or collection request it was seeded from, or "Added by you", and whether the
  engineer changed it since seeding. Neither the snapshot nor the report MUST contain request or
  response content (AP-029 FR-040).
- **FR-034**: The report MUST keep AP-029 FR-036 to FR-038 per chain and per step, and MUST add: each
  check's pass and fail counts, each extractor's success and failure counts, chains cut short with
  the extractor named, and each **Once before load** step's outcome and latency, which MUST NOT be
  counted in the load's latency or request counts.
- **FR-035**: **Run again** and restoring a past run's settings (AP-029 FR-024a, FR-024b) MUST work
  for runs of request-chain plans, restoring the chains and steps without any environment value.
  **Run again** MUST also be unavailable, with the reason, when any data set's content differs from
  the run's (by SHA-256), since data set content does not change the script.
  To restore steps, each run MUST keep a copy of its plan as run, encrypted at rest like saved
  plans, separate from the snapshot and the report, and read only by restore. The copy MUST NOT be
  shown, logged or reported, and holds no secret value (FR-027).

**Retirement (phase two)**

- **FR-036**: Once FR-001 to FR-035 and FR-039 to FR-047 hold on every entry point, the AP-033 body and parameter edit
  overlays, the AP-035 user-defined journeys, captures and bindings, the proposed-versus-user journey
  split, and the AP-036 conversion review gate MUST be removed, with their screens.
- **FR-037**: A run recorded before this feature MUST keep its report exactly as rendered before.
  **Run again** and restore MUST NOT be offered for it, and the runs view MUST say why.
- **FR-038**: No AI MUST take part in seeding, editing, generating, running or reporting (AP-029
  FR-041).

**Saving plans**

- **FR-039**: Request-chain plans, including their seeding reports and data sets, MUST be saved in
  the local database (AP-025) as the engineer changes them, owned by the session and removed with
  it like its runs (AP-029 FR-034). A plan MUST reopen unchanged after a backend restart. A session
  MAY hold several plans; the engineer MUST be able to name, open, duplicate and delete them.
  Saved plans hold no secret value (FR-027).

**Token refresh**

- **FR-040**: When a **Once before load** step extracts a value and its response carries an
  `expires_in` body field, each virtual user MUST re-send that step before the value expires and
  use the new value, as AP-029 FR-015 and AP-036 FR-028 define: not all at the same moment, not
  counted in any step's requests or latency, with the number and times of refreshes in the report.
  A failed refresh MUST be reported as such, and the steps that needed the value are then reported
  as authentication errors. A step whose response states no lifetime MUST NOT be refreshed.

**Data sets**

- **FR-041**: The engineer MUST be able to add up to 5 data sets to a plan by uploading a CSV file
  (UTF-8, comma-separated, quoted fields as RFC 4180, a header row, at most 5 MiB, 100,000 rows and
  50 columns). A file that does not meet this MUST be refused with the reason and, where it applies,
  the line number, and nothing MUST be stored.
- **FR-042**: Each column name MUST follow the `{{name}}` rules (FR-004) and MUST be unique across the
  plan's data sets. The engineer MUST be able to mark columns secret, rename the data set, replace
  its file, and remove it.
- **FR-043**: Each data set MUST have a mode: **One row per virtual user** (each virtual user takes
  the next row when it starts and keeps it), or **Next row per iteration** (each iteration takes the
  next row in the run's order, shared across virtual users). Rows MUST be taken in file order and
  MUST wrap to the first row when they run out. A **Once before load** step MUST use the first row.
- **FR-044**: Data set files MUST be encrypted at rest with the same protection as environment
  values, and their values MUST NOT appear in the plan, the script, the environment template, the
  run's snapshot, the report or any log. They MUST reach k6 only at run time, and ApiPilot MUST
  remove any run-time copy when the run ends.
- **FR-045**: The plan MUST show each data set's name, mode, columns, which columns are secret, its
  row count and the steps that use each column, and MAY preview its first 5 rows with secret
  columns hidden.
- **FR-046**: The run trigger MUST list the data sets the plan uses with their row counts. The run's
  snapshot and report MUST record each data set's name, mode, columns, row count, the SHA-256 of its
  file and whether it wrapped, and no value.
- **FR-047**: The script MUST NOT depend on a data set's content: the same plan with different data
  set files MUST generate a byte-identical script (FR-030).
  A script from a plan without data sets MUST pass AP-034's script check (AP-029 FR-022a). A script
  from a plan with data sets reads them with `open()`, which AP-034 refuses. AP-029 FR-022a does
  not apply to it, and downloading it MUST state that the copy cannot be run in Run k6 Script.
- **FR-048** *(added 2026-10-04, 19.22.0)*: Every Postman dynamic variable the collection editor
  offers (48 in all: common, text, numbers and colors, internet, names, profession, phone, address
  and location, dates, domains and emails) MUST be accepted as `{{$name}}` and generated at run time
  by the fixed runtime, deterministically from the virtual user, the iteration, the occurrence and
  the run tag (the clock-based ones, timestamps and the three random dates, from the time of the
  request). Amends AP-036 FR-013 and research R5, which listed 13. A name is supported only together
  with its generator; any other `{{$name}}` stays an `invalid-reference` blocker. Values come from
  short built-in lists, so a generated script does not grow with a data set. Dates are ISO 8601.

### Key Entities

- **Request-chain plan**: the chains, load profile, default think time, thresholds, target
  environment and seeding report. Owned by the session.
- **Chain**: a name and an ordered list of steps; the equivalent of a Postman folder or a JMeter
  thread group's sampler list.
- **Step**: a name (shown in lists and the report), method, URL, query parameters, headers, body,
  expected statuses, extractors, checks, think time, "runs" setting, and source (seed origin,
  changed flag).
- **Extractor**: a name and a source (JSON field path or header name); belongs to one step.
- **Check**: one of field exists, field equals, body contains, response time at most.
- **Seeding report**: what seeding could not carry over, with sources.
- **Data set**: a named CSV file with columns (some secret), a row count, a mode and the SHA-256 of
  its content; belongs to one plan. Its values are encrypted at rest and never leave run time.
- **Run snapshot**: the plan's structure and provenance as run, with no request content and no value.
- **Run plan copy**: the plan as run, encrypted, kept with the run for restore only (FR-035).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An engineer can build the seven-step customer journey of User Story 1 from an empty
  plan, generate the script and start a smoke run in under 10 minutes, without a specification or
  collection.
- **SC-002**: Every part of a seeded step (method, URL, query, headers, body, expected statuses) can
  be changed, and 100% of changes are sent exactly as entered in a run against a test server.
- **SC-003**: In a run with at least 10 virtual users, 100% of requests that use an extracted value
  send the value extracted for the same virtual user and iteration (or the shared setup value), and
  none sends a stale value.
- **SC-004**: The same plan generates a byte-identical script on every generation.
- **SC-005**: No secret value, extracted value, data set value, request body or response body
  appears in any plan, script, environment template, snapshot, report or log, checked by a scan of
  all of them after a run that uses a secret token and a data set with a secret column.
- **SC-008**: A plan built by hand survives a backend restart with 100% of its chains, steps and
  data sets intact.
- **SC-009**: In a run using a data set in **Next row per iteration** mode, 100% of iterations use
  a row in the run's order, and every row is used before any row is used twice.
- **SC-006**: After phase two, the performance plan code and screens are at most half their size
  before this feature, measured in lines of non-test source, with every acceptance scenario above
  passing. The size is measured at the end of phase one. If it is above target, the gap is reported
  and a revised target is agreed before phase two starts. No required behaviour is removed to meet
  the target. *(Revised 2026-10-03: phase one measured 22,357 lines, and the agreed target after
  phase two is at most 13,000 lines over the same measured set.)*
- **SC-007**: Every report of a run recorded before this feature renders identically after phase
  two.

## Assumptions

- Limits keep plans readable and scripts small: at most 20 chains per plan, 50 steps per chain, 10
  extractors and 10 checks per step, and a body of at most 256 KiB.
- Multipart bodies and file uploads, XML or form response extraction, partial values (substrings,
  regular expressions) and computed values are out of scope. Regular-expression extraction is left
  out because a pattern can be slow to evaluate against large responses under load.
- Conditional steps, loops and per-step retry are out of scope, as in AP-035.
- Saving plans locally replaces AP-036 FR-025's one in-memory collection plan per session, and the
  in-memory guided and quick plans (Clarifications 2026-10-02). It needs new local tables under
  AP-025; no new dependency is expected.
- Data sets are uploaded per plan, not shared between plans or sessions; reusing one in another
  plan means uploading it again. Data generated from a data set (for example a value derived from a
  column) is out of scope; a column is used as it is.
- The first phase delivers FR-001 to FR-035 and FR-039 to FR-047 alongside the old screens; the
  second delivers FR-036 to FR-038. Each phase is shippable on its own.
- The engineer knows the order their API needs and which response field holds an id; ApiPilot does
  not infer order beyond seeding approved workflows.
- Constitution XVII's k6 exceptions are consolidated by an amendment before planning continues
  (Governance).
