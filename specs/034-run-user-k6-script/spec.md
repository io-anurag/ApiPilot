# Feature Specification: Run a User-Supplied k6 Script

**Feature Branch**: `[034-run-user-k6-script]`

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "It should also be possible to upload a k6 script & configure & run"
(raised on 2026-09-30 during the AP-033 parameter-editing amendment, declined then under
constitution XVII, and admitted by the constitution's 2026-09-30 amendment, v2.6.0)

**Product identifier**: `AP-034` (post-MVP). This spec directory is numbered `034` per the
repository's sequential feature-directory convention; the directory number and the `AP-###`
identifier happen to coincide here but remain independent. `AP-034` is the canonical identifier
used in cross-references, commit messages, and `specs/ROADMAP.md`.

**Relationship to prerequisite specifications**: This feature adds a way to run a k6 script the
engineer wrote, rather than one ApiPilot generated from a specification. It needs no OpenAPI
specification, guided workflow or performance plan. It reuses, unchanged:
- k6 readiness, the user-installed k6, the run's local-only outputs, live progress, cancellation,
  restart handling, the session-wide "one execution in progress" slot, local persistence of runs,
  and the self-contained HTML report (AP-029, AP-017, AP-025, AP-026);
- the five named load profiles with editable stages and the user-set thresholds (AP-029 FR-017,
  FR-018);
- environments and tiers with their encrypted storage (AP-017, AP-025, AP-032 FR-016, FR-017);
- the start screen's entry chooser and its "Back to start" pattern (AP-026, AP-032) and the shared
  UI components (AP-027).

It changes two existing decisions, each stated as a requirement below:
- AP-029 FR-026 says the system MUST NOT execute a script that was uploaded, imported, pasted or
  edited by a user. That rule stays in force for AP-029 and AP-032 runs, which still execute only
  the unmodified generated script. This feature is the one place a user's script runs, under its
  own conditions (FR-013 to FR-022). AP-029's FR-026 text gains a pointer to this spec.
- AP-032 FR-018 opens environments only to a session with a completed Postman generation or a
  quick plan. This feature also opens them to a session that holds a stored user script (FR-024).

**Governance**: Running a user-supplied script is permitted only by the constitution's XVII
exception of 2026-09-30 (v2.6.0). Every condition of that exception is a requirement of this spec:
- a single file of allowlisted k6 built-in modules, checked before it is stored, with the
  allowlist defined here (FR-004 to FR-008);
- an explicit confirmation of the exact bytes, bound to their SHA-256, that lists the hosts found
  and states ApiPilot cannot restrict them, and is asked again after any change (FR-013 to FR-016);
- the confirmed bytes executed unchanged, with configuration reaching the script only as k6
  command-line options and environment variables (FR-017, FR-018);
- a per-run trigger that names the environment and repeats the hosts, and no automatic run
  (FR-019, FR-020);
- the user's k6 with local outputs only (FR-021, FR-022);
- the script treated as sensitive, never logged, never sent to or produced by AI, never executed
  by the editor, with credentials directed to environment values (FR-002, FR-011, FR-012, FR-039,
  FR-040);
- the run and report stating the script was user-supplied with its SHA-256, reporting only k6's
  metrics, and stating where the load comes from (FR-023, FR-030 to FR-036).

## Clarifications

### Session 2026-09-30

These decisions were taken while amending the constitution (v2.6.0) for this feature.

- Q: When must the engineer confirm a script before it runs? → A: Once per script content. The
  confirmation is bound to the script's SHA-256 and is asked again after any change, whether a new
  upload or an edit saved in ApiPilot's editor (FR-013, FR-016).
- Q: What may a script import? → A: A single file that imports only k6 built-in modules on this
  spec's allowlist. Remote imports, file imports, `open()`, extension modules and any module that
  reaches the filesystem, starts a process or starts a browser are refused (FR-004 to FR-008).
- Q: Can ApiPilot restrict which hosts a script sends load to? → A: No. ApiPilot lists the hosts it
  finds in the script and warns that it cannot restrict them. The confirmation and the run trigger
  both show the list (FR-009, FR-014, FR-019).
- Q: May the engineer write or edit a script inside ApiPilot? → A: Yes, in an editor in ApiPilot.
  Saving an edit is a change, so it needs a new confirmation before the next run (FR-010 to
  FR-012).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload a k6 script, confirm it and run it (Priority: P1)

A performance engineer already has a k6 script for their API. From the start screen they choose
"Run k6 Script" and upload the file. ApiPilot checks the script's imports before storing it. It
refuses a script that uses anything outside the allowed k6 modules, and says which line and why.
An accepted script is listed by name with its size, the hosts ApiPilot found in it, and the
environment variable names it reads.

Before the first run, the engineer confirms the script. The confirmation says that ApiPilot did not
write or check what the script does, lists every host found, says that hosts built while the
script runs cannot be listed, and states that ApiPilot cannot restrict where the script sends
requests. The engineer chooses a target environment and starts the run. The trigger names the
environment by name, tier label and base URL and repeats the hosts. The run shows live progress
and ends with a report that says the script was supplied by the engineer and gives its SHA-256.

**Why this priority**: It is the whole request in its smallest form: an existing script, run with
the engineer's own k6, with results in ApiPilot. Configuration and in-app editing build on it.

**Independent Test**: Upload a valid script that sends requests to a local test server, confirm it,
choose an environment and start the run. Check that the run executes the confirmed bytes, that
progress appears, that the report opens, and that it names the script as user-supplied with the
matching SHA-256. Upload a script that imports a remote module and check it is refused and not
stored.

**Acceptance Scenarios**:

1. **Given** the start screen, **When** the engineer chooses "Run k6 Script", **Then** a page opens
   that needs no specification, guided workflow or performance plan, and offers to upload a script
   or write a new one.
2. **Given** a script that imports only allowed k6 modules, **When** the engineer uploads it,
   **Then** it is stored and listed with its name, size, SHA-256, the hosts found in it and the
   environment variable names it reads, and it is marked as needing confirmation.
3. **Given** a script that imports a remote URL, a local file, an extension module or a module
   not on the allowlist, or that calls `open()`, **When** the engineer uploads it, **Then** it is
   refused, nothing is stored, and each reason is shown with its line number.
4. **Given** an unconfirmed script, **When** the engineer views it, **Then** the run trigger is
   unavailable and the reason is that the script has not been confirmed.
5. **Given** the confirmation, **When** it is shown, **Then** it states that the script was not
   written or verified by ApiPilot, lists every host found (or says none were found in the script
   text), says hosts built while the script runs cannot be listed, states that ApiPilot cannot
   restrict where the script sends requests, and shows the script's SHA-256.
6. **Given** a confirmed script, a ready k6 and a chosen environment, **When** the engineer starts
   the run, **Then** the trigger shows the environment's name, tier label and base URL and the
   hosts found, and the run starts only then. Nothing runs on upload, confirmation or selection.
7. **Given** a running script, **When** it is in progress, **Then** live progress shows elapsed
   time, current virtual users, requests so far and failures so far, and the engineer can cancel
   it with the results measured so far kept.
8. **Given** a run that ended, completed or cancelled, **When** its report is presented, **Then**
   it states that the script was supplied by the engineer and not generated by ApiPilot, gives its
   name and SHA-256, and shows only measurements k6 produced.

---

### User Story 2 - Configure the run: environment values, load and thresholds (Priority: P2)

The engineer's script reads its base URL and an API key from k6 environment variables. On the
script's page ApiPilot lists the names the script reads. It maps `BASE_URL` to the chosen
environment's base URL, and each other name to the environment value with the same name. The
engineer can map a name to a different environment value, and can add a name ApiPilot did not
find, for example one the script builds at run time. Secret values are never shown. Before the run
the page says which mapped values are missing from the chosen environment.

By default the run uses the load settings written in the script. The engineer can instead pick one
of the five load profiles and edit its stages, which ApiPilot passes to k6 as command-line options.
They can also set pass/fail thresholds on latency percentiles and error rate, which ApiPilot
evaluates against the measurements, as it does for generated scripts.

**Why this priority**: A script that hard-codes its target or credentials works under Story 1, but
most real scripts read them from the environment. Running the same script against local, QA and
staging without editing it is the main reason to run it from ApiPilot.

**Independent Test**: Upload a script that reads `BASE_URL` and `API_KEY` through `__ENV`, create
two environments with different base URLs and keys, and run the script against each. Check that
each run reaches its own environment's server with its own key, that the key appears in no log,
report or run record, and that a profile override changes the virtual users k6 runs while the
script bytes stay the same.

**Acceptance Scenarios**:

1. **Given** a script that reads `__ENV.BASE_URL` and `__ENV.API_KEY`, **When** its page opens,
   **Then** both names are listed. `BASE_URL` is mapped to the chosen environment's base URL and
   `API_KEY` to that environment's value named `API_KEY`.
2. **Given** a mapped value that the chosen environment does not have, **When** the engineer views
   the run controls, **Then** the name is shown as missing. The run can still start, and the script
   receives no value for that name.
3. **Given** a name the check could not find (built at run time), **When** the engineer adds it to
   the mapping with an environment value, **Then** the script receives it on the next run.
4. **Given** a secret environment value in the mapping, **When** the mapping, the run or the report
   is shown, **Then** the value itself appears nowhere; only its name and that it is secret.
5. **Given** the default "script's own load settings", **When** the run starts, **Then** k6 runs
   the load the script defines and ApiPilot passes no load options.
6. **Given** a chosen load profile, **When** the run starts, **Then** its stages reach k6 as
   command-line options, the script bytes are unchanged, and the run controls and report show the
   stages as the load used.
7. **Given** user-set thresholds, **When** the report is presented, **Then** each shows passed or
   failed against the measured value. **Given** none, **Then** the report says none were set in
   ApiPilot. Either way the report shows the outcome k6 gives for thresholds the script defines.

---

### User Story 3 - Write or edit a script in ApiPilot (Priority: P3)

The engineer does not have a script yet, or wants to change one. They open ApiPilot's script editor
on a new script, which starts from a short example that sends one request to `BASE_URL`, or on a
stored script. The editor shows the text with line numbers and highlighting, and never executes it.
It reminds the engineer that credentials belong in environment values, not in the script. Saving
runs the same check as an upload. A refused save is not stored, and the editor keeps the unsaved
text with the reasons beside the lines. A saved change creates a new version of the script, with a
new SHA-256, and needs a new confirmation before the next run.

**Why this priority**: It saves a round trip through a separate editor for small changes, such as
fixing a check or a request name. Uploading already covers every script the editor can produce.

**Independent Test**: Create a script from the example, save it, confirm and run it. Edit one line
and save. Check that the SHA-256 changed, the script needs confirmation again, and the trigger is
unavailable until it is confirmed. Add a remote import and save; check the save is refused, the
stored script is unchanged, and the unsaved text is still in the editor.

**Acceptance Scenarios**:

1. **Given** the script page, **When** the engineer chooses to write a new script, **Then** the
   editor opens on ApiPilot's fixed example, which reads its target from `BASE_URL` and contains no
   credentials.
2. **Given** the editor, **When** it is open, **Then** it states that credentials belong in
   environment values and not in the script, and that ApiPilot cannot check a script holds none.
3. **Given** an edited, confirmed script, **When** the engineer saves a change, **Then** the stored
   script, its SHA-256, the hosts found and the names read are updated, and it is marked as needing
   confirmation.
4. **Given** an edit that the check refuses, **When** the engineer saves, **Then** nothing is
   stored, the previous version is unchanged, each reason is shown at its line, and the unsaved
   text stays in the editor.
5. **Given** unsaved changes, **When** the engineer leaves the editor, **Then** they are asked
   whether to discard them.
6. **Given** a stored script, **When** the engineer downloads it, **Then** the file is the stored
   bytes exactly.

---

### Edge Cases

- **A generated script supplied again**: a script ApiPilot generated (AP-029, AP-032) that the
  engineer downloads, changes or not, and uploads is a user-supplied script, never ApiPilot's
  output. ApiPilot generates scripts that pass this check (AP-029 FR-022a), so an unchanged copy
  is accepted. It is confirmed and reported as the engineer's. It reads its values as
  `APIPILOT_V_<n>` through a literal table, so the check lists those names, and the initial mapping
  maps each one to the environment value it stands for, with `baseUrl` mapped to the base URL. Run
  against the same environment, it needs no manual mapping (FR-025, FR-026). Changes the engineer
  makes are checked like any other script. (Amended 2026-10-01.)
- **A module used indirectly**: a script that builds a function or module name at run time, runs
  code from a string (for example with `eval` or the `Function` constructor), or uses dynamic
  `import()` or `require()` is refused, because the check cannot rule out a forbidden capability
  (FR-006).
- **Syntax errors**: a script the check cannot parse is refused with the parser's line and message.
  A script that parses but fails when k6 starts it is recorded as a failed run, and k6's error
  message is shown to the engineer on the run's page (FR-029).
- **The script changes between confirmation and run**: the run starts only when the bytes it would
  execute match the confirmed SHA-256. Otherwise the trigger is refused with the reason, and the
  script is marked as needing confirmation (FR-017).
- **Editing while a run is in progress**: the run keeps executing the bytes it started with. A
  saved edit creates a new version that needs confirmation, and does not affect the running test.
- **Deleting a script**: its confirmation, mapping and load settings are deleted with it. Its past
  runs and reports stay, identified by the script's name and SHA-256. A script with a run in
  progress cannot be deleted until the run ends.
- **Hosts the check cannot see**: hosts built at run time, or read from environment variables,
  cannot be listed. The confirmation says so. When the script reads `BASE_URL`, the trigger shows
  the chosen environment's base URL as well.
- **A script with no default function and a profile override**: a load profile replaces the
  script's own scenarios with k6's single default scenario. A script that defines only named
  scenarios cannot take the override; the override is unavailable with the reason, and the
  script runs with its own settings (FR-027).
- **A remote output configured on the machine**: k6 also reads options from environment variables
  such as `K6_OUT` and `K6_CLOUD_TOKEN`. The run passes none of the backend machine's environment
  to k6 except what k6 needs to start and the mapped values, so no remote output can be turned on
  that way (FR-022).
- **Console output from the script**: `console.log` in a script can print anything, including
  values it received. That output is not kept, logged or shown (FR-040).
- **Requests without a name, or with IDs in the path**: requests are grouped by k6's request name.
  When the script did not name a request, the report uses its method, host and path, with any user
  name, password, query string and fragment removed. When there are more than 100 distinct request
  names, the rest are combined into one "Other requests" row, and the report says how many were
  combined and how to name requests in k6 (FR-032).
- **The script sends load elsewhere**: ApiPilot cannot stop a script from sending requests to a
  host that is not the chosen environment's. The confirmation and the trigger say so; the report
  lists the hosts that received requests, taken from k6's measurements (FR-033).
- **Write requests under load**: the report lists, per request name and method, how many POST, PUT,
  PATCH and DELETE requests were sent and succeeded. Nothing is cleaned up on the target.
- **Backend restart**: stored scripts, confirmations, mappings and past runs survive, like runs do.
  A run in progress when the backend stops is recorded as cancelled with a backend-restart reason
  and is not started again.
- **k6 not installed or unusable**: readiness shows the reason and the trigger is unavailable, as
  for generated scripts.
- **Another execution in progress**: the trigger is refused with the reason, and nothing is sent.

## Requirements *(mandatory)*

### Functional Requirements

**Supplying a script**

- **FR-001**: The start screen MUST offer a "Run k6 Script" entry that works without an uploaded
  specification, a guided workflow or a performance plan, with "Back to start" like the other
  entries.
- **FR-002**: The engineer MUST be able to upload a script file or write one in ApiPilot's editor.
  A script MUST be one UTF-8 text file of at most 1 MiB. Its content, not its file name, MUST
  decide whether it is accepted. Scripts MUST be kept locally, owned by the session and removed
  with it, stored with the same at-rest protection as secret environment values, and MUST survive
  a backend restart.
- **FR-003**: A session MUST be able to hold several scripts, each with a name the engineer can
  change. The list MUST show each script's name, size, SHA-256, whether its current content is
  confirmed, and its last run.

**Checking a script** (constitution XVII, 2026-09-30: allowlisted built-ins only)

- **FR-004**: Before a script is stored, whether uploaded or saved in the editor, the system MUST
  check it and refuse it, storing nothing, when it breaks any rule of FR-005 to FR-007. Each reason
  MUST be shown with its line number.
- **FR-005**: The script MAY import only these k6 built-in modules: `k6` (which provides `check`,
  `group`, `sleep` and `fail`), `k6/http`, `k6/metrics`, `k6/execution`, `k6/encoding`,
  `k6/crypto`, `k6/data`, `k6/html` and `k6/timers`. Every other module MUST be refused,
  including remote URL imports, relative or absolute file imports, extension modules (`k6/x/…`),
  experimental modules (`k6/experimental/…`), `k6/browser`, `k6/net/grpc`, `k6/ws`,
  `k6/websockets` and `k6/secrets`.
- **FR-006**: The script MUST NOT call `open()`, use `require()` or dynamic `import()`, run code
  built from a string (for example `eval` or the `Function` constructor), or look up a global
  function by a name computed at run time. A construct the check cannot rule out MUST be refused
  rather than accepted. The script MUST NOT export `handleSummary`, because k6 writes what it
  returns to local files (amended 2026-10-01 during planning, research R3).
- **FR-007**: A script the check cannot parse MUST be refused with the parser's line and message.
- **FR-008**: The check MUST be deterministic: the same bytes MUST always give the same result,
  the same reasons, the same hosts found and the same names read.
- **FR-009**: For every accepted script, the system MUST list the hosts it finds as absolute
  `http://`, `https://`, `ws://` or `wss://` URLs in the script's text, each as scheme, host and
  port, and the environment variable names the script reads through `__ENV`. Both lists MUST be
  shown with a note that values built at run time cannot be found.

**Editor** (constitution XVII, 2026-09-30: in-app editing)

- **FR-010**: The editor MUST show the script with line numbers and syntax highlighting, open a new
  script on ApiPilot's fixed example (one request to `BASE_URL`, no credentials), and offer
  download of the stored bytes exactly.
- **FR-011**: The editor MUST NOT execute, evaluate or preview the script in any form. Saving MUST
  run the FR-004 check. A refused save MUST leave the stored version unchanged and keep the unsaved
  text in the editor, and leaving with unsaved changes MUST ask first.
- **FR-012**: The editor and the upload control MUST state that credentials belong in environment
  values and not in the script, and that ApiPilot cannot verify a script holds none.

**Confirmation** (constitution XVII, 2026-09-30: confirmation of the exact bytes)

- **FR-013**: A script MUST NOT run until the engineer confirms its current content. The
  confirmation MUST be bound to the SHA-256 of the stored bytes.
- **FR-014**: The confirmation MUST state that the script was not generated or verified by
  ApiPilot, list every host found (or say none were found in the script text), say that hosts
  built at run time cannot be listed, state that ApiPilot cannot restrict where the script sends
  requests, and show the SHA-256.
- **FR-015**: The confirmation MUST be an explicit action by the engineer for that script. It MUST
  NOT be given by default, carried over from another script, or given for several scripts at once.
- **FR-016**: Any change to the stored bytes, by a new upload or a saved edit, MUST clear the
  confirmation. A rename MUST NOT, since it does not change the bytes.

**Execution** (constitution XVII, 2026-09-30: confirmed bytes, per-run trigger, local k6)

- **FR-017**: At run start, the system MUST execute a copy of the stored bytes and MUST refuse to
  start when that copy's SHA-256 differs from the confirmed one. The system MUST NOT rewrite, wrap,
  inject into or append to the script.
- **FR-018**: Configuration set in ApiPilot MUST reach the script only as k6 command-line options
  and environment variables: the load stages when a profile is chosen (FR-027) and the mapped
  values (FR-025). User-set thresholds are evaluated by ApiPilot from the measurements and MUST NOT
  be added to the script.
- **FR-019**: A run MUST start only on the engineer's explicit trigger for that run. The trigger
  MUST name the target environment, show its name, tier as a text label and base URL, and repeat
  the hosts found in the script. These MUST stay visible throughout the run. A run on any tier MUST
  need no confirmation beyond the trigger and the script's confirmation, as in AP-029 FR-025.
- **FR-020**: The system MUST NOT start or repeat a run automatically, on a schedule, as a retry,
  after an upload, after a confirmation, or after a restart.
- **FR-021**: Runs MUST use the k6 binary the engineer installed and the same readiness state as
  AP-029 FR-027. While k6 is not ready, the trigger MUST be unavailable with the reason.
- **FR-022**: k6 MUST run with only ApiPilot's local outputs and no usage report. No k6 Cloud,
  Grafana Cloud or other remote output MUST be passed, and k6 MUST receive none of the backend
  machine's environment except what it needs to start and the mapped values.
- **FR-023**: The run controls MUST state that load is generated from the machine running the
  ApiPilot backend. A run MUST share the session-wide "one execution in progress" slot, and MUST
  have the live progress, cancellation, restart handling and session keep-alive of AP-029 FR-029
  to FR-034a.

**Configuration**

- **FR-024**: Environments MUST be available to a session that holds at least one stored script,
  with the same set, encrypted storage and tiers as the guided and quick paths (AP-032 FR-017).
  This extends AP-032 FR-018's condition and changes nothing else about when environments open.
- **FR-025**: Each script MUST have a mapping from the environment variable names it receives to
  environment values. The mapping MUST start with every name FR-009 found: `BASE_URL` mapped to the
  chosen environment's base URL, and each other name to the environment value with the same name.
  The engineer MUST be able to change a mapping, remove one, and add a name the check did not find.
  The mapping MUST hold names only, never values. Before a run, each mapped value missing from the
  chosen environment MUST be shown as missing; the run MAY still start, and the script receives no
  value for that name.
- **FR-026**: Only a name made of letters, digits and underscores, not starting with a digit and
  not starting with `K6_`, MUST be accepted into the mapping. Names that k6 needs to start, compared
  without case (`PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `HOME`, `TMPDIR`), MUST also be refused (amended
  2026-10-01 during planning, research R11). Other names MUST be refused with the reason.
- **FR-027**: By default a run MUST use the script's own load settings, with no load option passed.
  The engineer MUST be able to choose one of the five load profiles instead and edit its stages as
  in AP-029 FR-017 and FR-019. The override MUST be unavailable, with the reason, for a script that
  has no default function.
- **FR-028**: The engineer MUST be able to set pass/fail thresholds on latency percentiles and error
  rate, as in AP-029 FR-018. The mapping, load choice and thresholds MUST be kept with the script
  and survive a restart, and MUST NOT need a new confirmation when changed, since they do not change
  the script's bytes.
- **FR-029**: A run k6 cannot start (for example, a script error at start-up) MUST be recorded as
  failed, and k6's error message, limited to 2,000 characters, MUST be shown on the run's page. It
  MUST NOT be written to server logs.

**Report** (constitution XVII, 2026-09-30: stated provenance, k6 metrics only)

- **FR-030**: The run record and report MUST state that the script was supplied by the engineer
  and not generated by ApiPilot, and MUST give the script's name and SHA-256, the environment's
  name, tier and base URL, the k6 version, the load used (the script's own, or the chosen stages),
  and the names mapped with their source, never their values.
- **FR-031**: The report MUST contain only measurements k6 produced. It MUST NOT show journeys,
  steps, scenarios, expected statuses or any provenance derived from a specification.
- **FR-032**: The report MUST group requests by k6's request name. A request the script did not
  name MUST be shown by method, host and path, with any user name, password, query string and
  fragment removed. Beyond 100 distinct request names, the rest MUST be combined into one
  "Other requests" row, and the report MUST say how many were combined and how to name a request
  in k6.
- **FR-033**: For the run and for each request name, the report MUST show p50, p90, p95 and p99
  latency, exact minimum, mean and maximum latency, throughput, failure rate as k6 counts it, every
  status received with its count, and k6's request phases. For the run it MUST also show iteration
  duration, bytes sent and received, and the hosts that received requests. It MUST show each check
  by name with its pass rate, each group the script uses, and each custom metric by name and type
  with its summary.
- **FR-034**: The report MUST include the timeline of AP-029 FR-036, with each measure on its own
  scale, and per request name latency and failures over time.
- **FR-035**: The report MUST show each ApiPilot threshold as passed or failed against the measured
  value, or say none were set, and MUST separately show the outcome k6 gives for thresholds the
  script defines: each threshold expression by metric, and k6's overall outcome (crossed or not),
  since k6 reports that outcome for the run as a whole. It MUST list, per request name and method, the write requests sent and succeeded.
- **FR-036**: The report MUST include plain-language findings from fixed rules on the measured data
  (such as the slowest request, where failures start, and the most frequent failing status). The
  same data MUST give the same findings. It MUST be presented in ApiPilot when the run ends and be
  downloadable as self-contained HTML with no external assets or services.

**AI, privacy and logging**

- **FR-037**: No AI MUST be used to write, check, explain, change or run a script, or to produce its
  report. A script MUST NOT be sent to any AI provider, and AI output MUST NOT be run as a script.
- **FR-038**: Environment values MUST reach k6 only for the run, as environment variables of its
  process, and MUST NOT appear in the script, the run record, the report, the UI or the logs.
- **FR-039**: Logs MUST NOT contain script content, environment values, k6's error messages,
  resolved URLs, or request or response bodies.
- **FR-040**: The script's console output MUST NOT be kept, logged or shown.
- **FR-041**: The run's working copy of the script MUST be removed when the run ends. The run record
  MUST keep the script's name and SHA-256, not its content.

### Key Entities *(include if feature involves data)*

- **User Script**: a k6 script the engineer supplied, by upload or in the editor. It holds its
  name, content, size and SHA-256, the check's result (hosts found and names read), and its
  confirmation state. It belongs to the session and survives a restart.
- **Script Check Result**: whether a script's content is accepted and, if refused, each reason with
  its line. For an accepted script, the hosts found and the environment variable names read. The
  same content always gives the same result.
- **Script Confirmation**: the engineer's explicit acceptance of one script's content, bound to its
  SHA-256, recording what was stated (hosts found) and when. It is cleared by any change to the
  content.
- **Script Run Settings**: kept with the script: the mapping of names to environment values (names
  only), the load choice (the script's own, or a profile with stages), and the ApiPilot
  thresholds. Changing them does not clear the confirmation.
- **User Script Run**: one execution of a user script against one environment. It shares the run
  states, cancel reasons, failure categories, environment snapshot and the session-wide
  "one execution in progress" slot with AP-029's Performance Run. In place of a plan snapshot it
  records the script's name and SHA-256, the load used, the mapped names and their sources, the k6
  exit code and its meaning.
- **User Script Result**: the measurements of a User Script Run, grouped by request name rather
  than by journey and step, with checks, groups, custom metrics, hosts that received requests and
  the script's own threshold outcome. It is kept apart from AP-029's Performance Result, whose
  shape is step-based. (Updated 2026-10-01 to match the plan, research R9.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Against a fixed set of at least 25 scripts that each break one rule of FR-005 to
  FR-007, 100% are refused before storage with the rule and the line, and nothing is stored.
- **SC-002**: 0 runs start for a script whose current content was not confirmed. After a change to
  a confirmed script, 100% of run attempts are refused until it is confirmed again.
- **SC-003**: In 100% of runs, the SHA-256 of the executed bytes equals the confirmed SHA-256 and
  the SHA-256 in the report.
- **SC-004**: With known secret values seeded into environment values, none appears in the logs,
  the run record, the report, the UI or any file ApiPilot keeps, in 100% of checked runs.
- **SC-005**: For a fixed set of scripts, 100% of hosts written as absolute URLs in the script are
  listed in the confirmation and at the trigger.
- **SC-006**: An engineer with an existing k6 script can go from the start screen to a running
  test in under 3 minutes.
- **SC-007**: No run turns on a remote output or usage report, including when the backend
  machine's environment sets k6's remote-output variables, in 100% of checked runs.
- **SC-008**: No run starts without the engineer's trigger. Across uploads, confirmations, edits,
  restarts and retries, 0 runs start on their own.
- **SC-009**: Progress appears within 5 seconds of the trigger; the report is presented within 10
  seconds of the run ending, renders completely with no network access, and gives identical
  findings when produced twice from the same run data.
- **SC-010**: Checking the same script 10 times gives 10 identical results, and the script's
  content appears in no server log line.

## Assumptions

- The engineer knows k6 and writes scripts in JavaScript. ApiPilot does not teach k6 beyond the
  starter example and the note on naming requests.
- The allowlist in FR-005 covers HTTP load testing. WebSocket, gRPC, browser and other protocols are
  out of scope in this version; their modules are refused. Widening the allowlist is a change to
  this spec.
- Test data files (for example a CSV read with `open()` into a `SharedArray`) are not supported,
  because the constitution forbids reading local files. Data the script needs is written into the
  script or supplied through environment values.
- The 1 MiB limit is well above typical hand-written k6 scripts and far below the 10 MiB upload
  limit for specifications. It keeps the check and the stored copies small.
- The static check finds hosts and names only where they are written literally. The engineer is
  responsible for what a script does at run time, which is why the confirmation says ApiPilot
  cannot restrict it.
- `BASE_URL` is the one name ApiPilot maps by default to the environment's base URL, and the
  starter example uses it. A generated script supplied again uses `APIPILOT_V_<n>` names, which the
  engineer maps by hand.
- The same minimum k6 version and readiness check as AP-029 apply. A load profile override relies on
  k6's rule that command-line load options replace the script's own scenarios.
- Running load against any system, including production and hosts other than the environment's, is
  the engineer's responsibility, as in AP-029. The confirmation and the trigger make the target
  and the hosts unmistakable instead of adding a limit.
- Out of scope: multi-file scripts and data files, k6 extensions, distributed or cloud execution,
  k6 browser tests, scheduling, comparing runs, opening a generated script directly in the editor
  (it can be downloaded and uploaded instead), and AI help writing or explaining scripts.
