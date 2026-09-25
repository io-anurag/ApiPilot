# Feature Specification: External Postman Collection Import & Execution

**Feature Branch**: `026-external-collection-execution`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "Also let people to upload their existing collection & environment &
start their execution" — deferred from AP-017 (specs/018-test-execution-results) during that
feature's Run & Results UI enhancement (2026-09-20), because it conflicts with AP-017's own stated
scope boundary: AP-017 executes only the approved, generated Postman artifact and explicitly does
not change how that artifact is generated. Bringing in an externally-authored collection bypasses
generation entirely, introduces a request/response trust boundary AP-017 never assumed (arbitrary
pre-request/test scripts, arbitrary absolute URLs), and has no `TestScenario` to report results
against — see that session's Clarifications for the full reasoning.

## Clarifications

### Session 2026-09-20

- Q: Should uploading and running an external collection require an active OpenAPI-generated
  workflow already in progress (living inside the existing guided `execution` stage as an
  alternative input), or should it be usable as a fully standalone capability with no workflow at
  all? → A: Standalone. It has its own entry point, independent of AP-009's guided workflow and
  reachable without ever uploading a specification — it does not require, and must not require,
  an existing `TestGenerationWorkflow` in the session.
- Q: Should the uploaded collection's own pre-request/test scripts actually execute, or should the
  feature only ever send the literal HTTP requests with scripts disabled? → A: Execute them with
  full fidelity, exactly as Postman/Newman would run them. This is a deliberate, larger trust
  boundary than sending a fixed request, taken because collections routinely depend on scripts for
  signatures, token refresh, and chaining values between requests — accepted explicitly given
  User Story 2's confirmation requirement (FR-007) exists precisely to surface this risk rather
  than hide it.
- Q: AP-017's staging/production confirmation gate (specs/018 FR-007) classifies "destructive"
  requests from `ApiModel`-derived HTTP methods — an uploaded collection has no such metadata. How
  should risk-tier confirmation work here? → A: The user manually declares a risk tier for the
  uploaded environment (mirroring `Environment.tier`: local/dev/qa/staging/production), reusing
  the existing tiered confirmation gate as-is. Because a Postman collection request always
  specifies its own HTTP method directly (no OpenAPI schema needed to know it), "destructive"
  detection for that gate is derived from the uploaded collection's own request methods
  (POST/PUT/PATCH/DELETE) rather than from `ApiModel` operations.
- Q: Should starting a run of an uploaded collection be blocked whenever any other execution is
  already in progress in the same session — including an ApiPilot-generated run — or can
  uploaded-collection runs proceed independently, in parallel with other runs? → A: Extend the
  existing global rule (specs/018 FR-008) to cover both: an uploaded-collection run occupies the
  same single, session-wide "one execution in progress at a time" slot a generated-collection run
  already uses. Starting either kind of run is refused while any run of either kind is in
  progress.
- Q: Can a user have more than one uploaded collection+environment pair configured at once in a
  session, or does uploading a new pair replace whatever was uploaded before it? → A: Multiple
  named pairs, listable and selectable — mirrors the existing `Environment` entity's own pattern.
  Each upload gets a user-supplied name, unique within the session, and stays available (and
  runnable) until the user removes it or the session ends.
- Q: Given the collection's scripts can make arbitrary additional HTTP calls, should the system
  impose any additional hard limit on an uploaded collection's size (max request count) or its
  total run duration, or run it to completion with no limit beyond specs/018's existing per-request
  timeout and the upload file-size cap? → A: No additional limit. Relying on the existing
  per-request timeout and file-size cap only is consistent with the full script-fidelity decision
  already made — a developer accepting how the collection behaves in Postman/Newman is already
  accepting how long it takes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run My Own Existing Postman Collection Through ApiPilot (Priority: P1)

As a QA engineer who already has a Postman collection and environment — exported from Postman
itself, received from a teammate, or hand-authored — I want to upload both files directly into
ApiPilot and run them, so I get the same per-request pass/fail visibility ApiPilot already
provides for its own generated collections, without first having to upload an OpenAPI
specification and walk through analysis, scenario review, and generation.

**Why this priority**: This is the entire premise of the feature. Without it, a user whose test
coverage did not originate inside ApiPilot gets none of its execution/results reporting value.

**Independent Test**: Upload a valid Postman collection.json and a matching environment.json,
start a run, and verify every request in the collection is executed in order and reported with a
pass/fail outcome consistent with the collection's own defined assertions.

**Acceptance Scenarios**:

1. **Given** a valid Postman collection.json and a matching environment.json, **When** the user
   uploads both and starts a run, **Then** the system executes every request in the collection
   sequentially and reports each one's outcome, duration, and response status.
2. **Given** the uploaded collection references environment variables, **When** the uploaded
   environment supplies a value for every one of them, **Then** the run proceeds without the user
   having to re-enter any value by hand.
3. **Given** the uploaded environment is missing a value a request in the collection needs,
   **When** the user starts the run, **Then** the run starts anyway; the variable stays visibly
   unresolved in the collection view beforehand, and a request that still sends it unresolved
   records its own failed/errored outcome. *(Superseded: this originally refused the run with
   `400 missing_variable_values`. Changed so an earlier request's test script can capture a value
   (`pm.environment.set`) that a later request uses — see FR-004.)*
4. **Given** the uploaded collection.json is not valid Postman Collection JSON, **When** the user
   uploads it, **Then** the system refuses with a specific, actionable parsing error and does not
   attempt to repair or guess at the intended structure.

---

### User Story 2 - Understand the Trust Boundary Before Anything Runs (Priority: P2)

As a QA engineer, I want ApiPilot to clearly tell me that an uploaded collection's requests (and
any scripts it carries) were not generated or verified by ApiPilot, and to require an explicit
confirmation before the very first request runs, so I understand this carries different risk than
running ApiPilot's own generated tests against my own API.

**Why this priority**: Directly required by the platform's human-in-the-loop and
security-by-design principles (constitution XI, XVII). Without it, a user could unknowingly
execute untrusted third-party requests or scripts sourced from outside ApiPilot.

**Independent Test**: Upload a collection and attempt to start a run against it for the first
time; verify a distinct confirmation step, naming the untrusted/unverified nature of the content,
appears before any request is dispatched, and that declining prevents execution entirely.

**Acceptance Scenarios**:

1. **Given** an uploaded collection has never been run, **When** the user starts a run, **Then**
   the system requires an explicit confirmation stating that the collection's requests (and any
   scripts) were not generated or verified by ApiPilot, before dispatching any request.
2. **Given** the user declines the confirmation, **When** they close or dismiss it, **Then** no
   request is dispatched and no run record is created.

---

### User Story 3 - Tell Uploaded Runs Apart From ApiPilot's Own Runs (Priority: P3)

As a QA engineer, I want run history and an individual run's detail to clearly show whether a run
executed an uploaded external collection or ApiPilot's own specification-derived, generated
collection, so I never mistake externally-authored coverage for ApiPilot's specification-grounded
coverage.

**Why this priority**: Preserves the product's core positioning — specification-grounded,
explainable test provenance (ApiPilot North Star). Without this, run history becomes ambiguous
about what was actually verified against a specification versus what was not.

**Independent Test**: Run both an uploaded external collection and an ApiPilot-generated
collection within the same session; verify run history visibly labels each run's source and
that neither can be mistaken for the other.

**Acceptance Scenarios**:

1. **Given** a session with at least one run of an uploaded external collection and at least one
   run of an ApiPilot-generated collection, **When** the user views run history, **Then** each
   run's source is visibly labeled and distinguishable at a glance.

---

### Edge Cases

- What happens when the uploaded environment.json references a variable the collection never
  uses? It is accepted and simply unused — only a variable the collection *does* reference but the
  environment does *not* supply is refused (User Story 1, Scenario 3).
- What happens when the uploaded collection contains nested folders? Every request within is
  executed; folder nesting does not change the sequential execution order beyond the order the
  collection itself already defines.
- What happens when a request in the uploaded collection defines no test/assertion script at all?
  It is still executed and its response status is still reported; it contributes no pass/fail
  assertion outcome of its own, mirroring how a generated request with no applicable assertions is
  already reported.
- What happens when the uploaded environment.json contains a value that looks like a credential
  (API key, token, password)? It MUST receive the same at-rest and logging protection
  `Environment.variableValues` already receives (FR-009) — it is not treated as lower-risk merely
  because it arrived via upload rather than manual entry.
- What happens when the uploaded collection or environment file exceeds the platform's existing
  upload size limit? It is refused before any parsing is attempted, with the same size-limit
  error behavior the OpenAPI specification upload already uses (CLAUDE.md §47).
- What happens when the same collection/environment pair is uploaded and run more than once in a
  session? Each run is recorded and reported independently, exactly as repeated runs of a
  generated collection already are (specs/018 FR-019/FR-020).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a user to upload a Postman Collection v2.1 JSON file and a
  corresponding Postman Environment JSON file as a paired unit.
- **FR-002**: The system MUST validate that the uploaded collection is well-formed Postman
  Collection v2.1 JSON and refuse with a specific, actionable error otherwise, without attempting
  to repair or guess at malformed content (mirrors the platform's existing "do not silently repair
  malformed documents" principle already applied to OpenAPI YAML).
- **FR-003**: The system MUST validate that the uploaded environment file is well-formed Postman
  Environment JSON and refuse with a specific, actionable error otherwise.
- **FR-004**: The system MUST identify every variable the uploaded collection references and show,
  before a run, which ones have no value (the collection view's `unresolvedVariables` and the
  variable panel's missing indicator). A missing value MUST NOT refuse the run.
  *(Superseded: originally "refuse with a clear message naming any variable the uploaded
  environment does not supply a value for". Refusing prevented collections whose later requests
  depend on a value an earlier request's test script captures at run time.)*
- **FR-005**: The system MUST execute every request in the uploaded collection strictly one at a
  time, in the collection's own request/folder order, mirroring the existing sequential execution
  model (specs/018 FR-010) rather than introducing a second, concurrent execution path.
- **FR-006**: The system MUST report each executed request's outcome, duration, and response
  status code, deriving pass/fail from the collection's own defined test assertions where present,
  and MUST NOT fabricate an assertion the collection itself did not define.
- **FR-007**: The system MUST require an explicit, distinct user confirmation — stating that the
  collection's requests and any embedded pre-request/test scripts will execute exactly as
  authored, and were not generated or verified by ApiPilot — before the first request of an
  uploaded collection is ever dispatched.
- **FR-008**: The system MUST execute an uploaded collection's own pre-request and test scripts
  with the same fidelity Postman/Newman itself would, rather than disabling or stripping them —
  script-dependent behavior (computed signatures, token refresh, chained values between requests)
  MUST work exactly as the collection defines it. This includes the collection's and each
  enclosing folder's auth and pre-request/test scripts, which apply to every request inside them
  *(clarified 2026-09-25, when a defect that ran each request without them was fixed; see
  specs/028-collection-editor-ui, Post-implementation follow-up 2026-09-25)*.
- **FR-009**: A value supplied via an uploaded environment file that resembles a credential MUST
  be persisted encrypted at rest and MUST NOT appear in logs, mirroring the existing protection
  for `Environment.variableValues` (constitution XVII, XVIII).
- **FR-010**: The system MUST visibly distinguish, in run history and in an individual run's own
  detail view, a run of an uploaded external collection from a run of ApiPilot's own generated
  collection.
- **FR-011**: The system MUST NOT require an existing, currently-active OpenAPI-generated workflow
  in the session for a user to upload and run an external collection — this is a standalone
  capability, reachable without ever uploading a specification.
- **FR-012**: The system MUST enforce an upload size limit for both the uploaded collection and
  environment files, consistent with the platform's existing upload-size-limit convention rather
  than an unbounded or newly-invented limit.
- **FR-013**: The system MUST require the user to declare a risk tier for an uploaded environment
  (the same local/dev/qa/staging/production vocabulary `Environment.tier` already uses), and MUST
  require the same staging/production confirmation a generated collection's execution already
  requires (specs/018 FR-007) — naming every request in the uploaded collection whose HTTP method
  is POST, PUT, PATCH, or DELETE, detected directly from the collection's own requests rather than
  from `ApiModel`-derived operation metadata.
- **FR-014**: The system MUST allow the user to cancel a run of an uploaded collection already in
  progress, with the same "already-attempted results kept, remaining requests marked
  not-attempted" behavior an ApiPilot-generated run's cancellation already has (specs/018 FR-015).
- **FR-015**: The system MUST treat a run of an uploaded collection as occupying the same single,
  session-wide "one execution in progress at a time" slot ApiPilot-generated runs already use
  (specs/018 FR-008) — starting either kind of run MUST be refused while any run of either kind is
  already in progress.
- **FR-016**: The system MUST allow more than one uploaded collection/environment pair to exist in
  a session at the same time, each identified by a user-supplied name unique within the session
  (mirroring `Environment.name`'s own uniqueness rule), and MUST let the user list and select
  among them when starting a run.
- **FR-017**: The system MUST allow the user to remove a previously uploaded collection/environment
  pair. Removing it MUST NOT alter any past run already recorded against it — a run's own record
  keeps whatever snapshot of the pair it captured at the time it ran, the same way an
  `ExecutionRun`'s `environmentSnapshot` already survives its source `Environment` later changing
  (specs/018 data-model.md).

### Post-implementation addendum (2026-09-21, driven by specs/028-collection-editor-ui follow-up)

Added directly against this spec (not routed through a separate spec-kit pass) once
specs/028-collection-editor-ui's own follow-up work needed a Postman-Runner-style "choose which
requests to run" screen, which FR-005 as originally written did not support.

- **FR-018**: The system MUST allow the user to start a run against a chosen subset of the
  uploaded collection's own requests, rather than always every request (FR-005's original
  "execute every request" behavior remains the default when no subset is chosen). A request
  excluded from the run MUST be skipped entirely — it MUST NOT appear in that run's `results`, not
  even as `"not-attempted"` (research.md/data-model.md for the exact request/response shape). Both
  confirmation gates (FR-007, FR-013) MUST be evaluated against only the chosen subset, not the
  whole collection, so an unselected request's destructive method never blocks a run that never
  included it.

### Key Entities *(include if feature involves data)*

- **UploadedCollection**: A validated Postman collection supplied directly by the user rather than
  generated by ApiPilot — its own requests, folders, variables, and scripts (FR-008), identified by
  a user-supplied name unique within the session (FR-016, mirroring `Environment.name`), listable
  and removable (FR-017), session-scoped like every other workflow artifact.
- **UploadedEnvironment**: A validated Postman environment paired 1:1 with one `UploadedCollection`,
  supplying the variable values its requests need and a user-declared risk tier (FR-013, the same
  vocabulary `Environment.tier` already uses); may carry credential-like values requiring the
  same at-rest protection as `Environment.variableValues` (FR-009).
- **ExecutionRun** (existing, specs/018): its source must now be distinguishable as either
  ApiPilot-generated or an uploaded external collection (FR-010) — this spec extends what an
  existing run can originate from, not the run record's core reporting shape.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with an existing Postman collection and environment can go from upload to
  seeing per-request pass/fail results in under 2 minutes, without first completing an OpenAPI
  upload, analysis, or review flow.
- **SC-002**: 100% of runs against an uploaded external collection are visibly labeled as such in
  run history; zero runs are ever misattributed as ApiPilot-generated or vice versa.
- **SC-003**: No credential-like value from an uploaded environment file is ever observable in
  logs or in an unencrypted persisted record — verified by the same audit approach already applied
  to `Environment.variableValues`.
- **SC-004**: Every run of a newly uploaded collection is preceded by an explicit confirmation
  naming its unverified nature; zero runs are ever dispatched without it.

## Assumptions

- The uploaded collection follows Postman Collection Format v2.1 and the uploaded environment
  follows Postman's environment export format — the same two formats ApiPilot's own
  `generateCollection()` output already produces, so an unsupported or older format (e.g.
  Collection Format v2.0) is refused the same way any other malformed upload is (FR-002), not
  silently best-effort converted.
- This feature reuses the existing sequential, one-request-at-a-time execution model and the
  existing run-history/cancel/request-delay mechanics already established by specs/018, rather
  than introducing a second, parallel execution engine.
- Uploaded collections/environments are session-scoped, non-persistent-beyond-session-lifetime
  artifacts, exactly like every other object AP-017/specs/025 already govern — they are not
  treated as more or less durable merely because they arrived via upload.
- The confirmation required by FR-007 is required once per uploaded collection the first time it
  is run, not on every subsequent run of the same already-confirmed upload — mirroring how
  AP-017's own staging/production confirmation is a per-run-start gate rather than a per-request
  one.
- Because this capability is standalone (FR-011), uploaded collections/environments are tracked
  independently of any `TestGenerationWorkflow` — a user may have both an AP-009 guided workflow
  and one or more uploaded collections configured in the same session at once, without either
  affecting the other's configuration or decisions. Running either kind, however, shares one
  single session-wide execution slot (FR-015): only one run of either kind can be in progress at a
  time.
- Executing a collection's own scripts (FR-008) means those scripts run with the same real
  network/side-effect capability Postman/Newman itself grants them (e.g. a script may itself make
  an additional HTTP call) — this is accepted as part of the trust boundary FR-007's confirmation
  already discloses, not a separate capability this spec introduces.
- No request-count limit or run-duration cap is imposed on an uploaded collection beyond the two
  bounds specs/018 already establishes — the fixed per-request timeout and the file upload size
  limit (FR-012). A long-running or large uploaded collection occupying the shared execution slot
  (FR-015) for an extended time is an accepted consequence of the full script-fidelity decision
  (FR-008), not a gap this spec leaves open.
