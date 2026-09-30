# ApiPilot User Manual

This manual is for the person operating ApiPilot day to day — typically a QA or API
engineer — to turn an OpenAPI specification into a reviewed, exportable, and runnable
test suite. For setup, environment variables, and internal architecture, see the
[README](../README.md) and the [architecture reference](architecture.md); this manual
covers what you see and do on screen.

## 1. What ApiPilot does

You upload one OpenAPI 3.x YAML file and choose which of its operations to test. ApiPilot
analyzes it, generates a baseline set of test scenarios deterministically (the same input
always produces the same scenarios), optionally proposes additional scenarios using a
locally running AI model, and lets you review and approve everything before anything is
exported or executed. Approved scenarios become a Postman collection, which ApiPilot then
hands to its **Import & Run Collection** view, where you can inspect and edit it and run it
against a target you choose. For any request that fails, ApiPilot can name the likely cause
using fixed rules and show the evidence behind it, and the local AI can explain it
(section 4.5).

If you already have a Postman collection and environment of your own — exported from
Postman, received from a teammate, or hand-authored — you can instead import and run it
directly, without uploading an OpenAPI specification at all. See
[section 4](#4-importing-and-running-your-own-postman-collection).

If you only want to know how an API behaves under load, the **Quick performance test** takes
an uploaded specification straight to a k6 load-test plan, with no review stages. Every
operation becomes a step with a generated request that no one reviews, so every write it will
send is listed before you run. See [section 5](#5-quick-performance-test).

Nothing is ever sent to a cloud AI service, and no request is made against the API
described by your specification until you explicitly start an execution run. The one
exception is your own imported collection's requests and scripts, which you separately
and explicitly confirm before they run (section 4).

## 2. Starting ApiPilot

Follow the [Quick start](../README.md#quick-start) section of the README to install
dependencies and run `npm run dev`. Once running:

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:4000/api/health`

The header shows a live connection indicator — **Connecting…**, **Connected**, or
**Disconnected** — so you always know whether the browser can reach the backend, plus a
light/dark theme toggle. Your choice is remembered on that browser; until you choose
explicitly, ApiPilot follows your operating system's light/dark preference.

## 3. The guided workflow

The start screen offers three paths: **Guided Workflow** (described in this section, including
the optional k6 performance test in section 3.11),
**Import & Run Collection** (described in [section 4](#4-importing-and-running-your-own-postman-collection))
and **Quick performance test** (described in [section 5](#5-quick-performance-test)).
While the guided workflow is in progress the tab bar is hidden so you can finish it; use
**← Back to start** to return to the start screen at any time. Nothing is discarded —
choosing **Guided Workflow** again resumes where you left off. The tab bar appears once you
are in **Import & Run Collection** or the **Quick performance test**, each of which has its own
**← Back to start** too, and switching between the views never discards any one's state.

Within the guided workflow, every step below is reached in this fixed order, and a
completed step can be revisited read-only (or, for the two review stages, reopened) by
clicking its chip in the stage tracker at the top of the page.

```text
Upload → Analysis → API Review → Deterministic Generation → AI Enhancement
  → Scenario Review → Dependency Analysis → Workflow Review → Postman Generation
  → Execution (hand-off to Import & Run Collection)
  → Performance Testing (optional; opens once Postman Generation is complete)
```

Each stage chip shows one of: **Not yet reached**, **Active**, **Complete**, **Needs to
be redone** (a later edit made this stage stale), **Skipped**, or **Partially
completed**.

### 3.1 Upload

On the start screen, choose a `.yaml` or `.yml` file (up to 10 MB). Only OpenAPI 3.x is
supported — Swagger 2.0 and JSON OpenAPI documents are rejected. If the file cannot be
parsed as YAML, or is not OpenAPI 3.x, an explicit error is shown before anything else
runs.

If you already have a workflow in progress and choose to start a new one, ApiPilot asks
you to confirm discarding it first. Choosing **Discard and start new** discards it at once;
it cannot be resumed afterwards. While AI enhancement is still running the discard is
refused, so cancel the run and wait for it to stop first. If your previous session was idle for more than 60
minutes, it will already have been discarded automatically, and you'll see a notice
explaining that.

### 3.2 Analysis

Runs automatically after upload. You'll see counts of operations, schemas, and security
schemes found, plus a list of any **analysis issues** — for example, an unresolved
reference, a circular reference, a duplicate operation, or an unsupported construct
(`oneOf`, `discriminator`, callbacks, etc.). These issues don't block you from
continuing; they tell you where the specification itself is incomplete or ambiguous, so
you can judge whether the generated tests for that area are trustworthy. External
(cross-file or URL) `$ref`s are always reported as unresolved — ApiPilot never fetches
them over the network.

### 3.3 API Review

A table of every operation (method + path). Click one to see its parameters, request
body content types, responses, and security requirements as ApiPilot understood them
from the spec. This is your chance to confirm the analysis matches your expectations
before test generation runs.

Check the operations you want to test. Only the checked operations, and the schemas they
use, go on to Deterministic Generation and AI Enhancement, so leaving out operations you
don't care about also makes AI enhancement faster. Use **Select all** to include every
operation. **Continue** stays disabled until at least one operation is checked.

Your selection is fixed once you continue: revisiting this stage shows it read-only. To
test a different set of operations, start a new workflow. Operations you left out are
still known to ApiPilot — for example, a token endpoint you didn't select can still be
used to fetch credentials for the operations you did.

### 3.4 Deterministic Generation

Click **Generate Baseline Test Suite**. ApiPilot produces, for every operation you
selected, one or two positive scenarios and a set of rule-based negative/boundary scenarios. These never
depend on AI and are fully reproducible from the same spec. The categories are:

| Category | What it tests |
|---|---|
| `positive` | A valid request that should succeed — the full happy-path request, a second happy-path request with every optional field/parameter omitted (when the operation has any), and any at-minimum/at-maximum boundary value, since all are equally schema-conformant |
| `missing-field` | A required field omitted |
| `null-value` | A field explicitly set to `null` |
| `empty-value` | A field set to an empty string/array |
| `invalid-type` | A field given the wrong JSON type |
| `invalid-format` | A field violating its declared format (e.g. not a valid date) |
| `invalid-enum` | A field set to a value outside its enum |
| `numeric-boundary` | A number just past its min/max (below minimum or above maximum) |
| `string-boundary` | A string just past its min/max length (below minimum or above maximum) |
| `array-boundary` | An array just past its min/max item count (below minimum or above maximum) |

Path parameters only receive the type/format/enum/boundary variants, not
missing/null/empty, since an omitted path parameter is a routing concern rather than a
payload one.

### 3.5 AI Enhancement (optional)

Click **Enhance with AI** to have the locally running model propose additional
scenarios — typically business-risk or semantic cases the deterministic rules don't
cover. This step is optional; you can skip straight to Scenario Review with just the
deterministic baseline.

While a run is in progress you'll see:

- A **phase** label: "Preparing the local model" (first run may need to load/download
  it) or "Generating scenarios."
- A live elapsed-time stopwatch and the remaining run-time budget.
- Per-batch progress (large specs are split into small batches so progress is visible
  incrementally): **Pending / In progress / Retrying / Succeeded / Failed / Not
  attempted**.
- A live preview of AI-suggested scenarios as each batch completes — you don't have to
  wait for the whole run to see results.
- A **Cancel** button. Cancelling keeps whatever was already generated and marks the
  rest not attempted, rather than discarding the run.

If a run only partially succeeds, a plain-language explanation and next step is shown,
along with:

- **Retry AI enhancement** — re-runs the whole stage, only shown when the failure is
  retryable (some failures, like content too large for the model, are not).
- **Retry batch N** — re-runs just one failed/not-attempted batch, leaving every other
  batch's results untouched. The stage status updates automatically once every batch has
  succeeded.

AI-suggested scenarios never replace or alter deterministic ones; duplicates against the
deterministic baseline are automatically removed. If the AI model is unavailable, the
deterministic baseline remains intact and you can continue without it.

### 3.6 Scenario Review

This is where you decide what actually ships. You'll see:

- A summary of totals (deterministic count, AI-added count, deduplicated count, rejected
  count, non-executable count).
- A filterable list (by Operation, Category, or Source — Deterministic rule vs.
  AI-suggested) with checkboxes for multi-select. There is no free-text search; use the
  three dropdown filters. The list loads 50 rows at a time via **Load more**.
- Per-scenario detail: the exact request JSON, the expected assertions, its provenance
  (which rule or AI rationale/confidence/assumptions produced it), and its review
  history. If the operation requires authentication, a note names the required scheme(s).
  Authentication is added automatically when the collection is exported or run, so it is
  not shown as a header in the request JSON.
- A side panel counting how many of the scenarios are currently accepted, broken down by
  category. Only accepted scenarios carry forward; pending and rejected ones are excluded.

Actions available:

| Action | Where | Notes |
|---|---|---|
| Accept | Per-scenario or bulk | Bulk actions are grouped as **Filtered** (all rows matching the current filters) and **Selected** (your checked rows), each with a confirmation dialog showing the affected count |
| Reject | Per-scenario or bulk | Requires a free-text reason; bulk reject requires one shared justification |
| Edit | Per-scenario | Edits the request body JSON directly; invalid JSON is rejected inline and the last valid version is kept; an edited scenario is marked "User-modified" |
| Regenerate with AI | Per-scenario, AI-derived only | Replaces the scenario with a new AI candidate, or reports a failure — it never silently approves anything |

When you're done, click **Finalize Review**:

- If any scenarios are still pending, you'll be warned they'll be excluded from
  everything downstream, and told how many accepted scenarios will be finalized.
- If zero scenarios are accepted, finalizing is blocked — you must accept at least one.
- **Finalize Review** is unavailable while a decision you just made is still being saved.
- Finalizing triggers dependency analysis automatically (this can take a couple of
  minutes on larger specs). While it runs, the review is locked — the list, filters, bulk
  actions, and decision controls are disabled and a "locked while it is being finalized"
  message is shown — so nothing can change the review after it has been committed.

### 3.7 Dependency Analysis

Runs automatically when you finalize Scenario Review — there's no separate screen to
operate. You'll see a read-only summary: how many operation relationships were found,
how many were assembled into workflows, any cycles detected, and any AI
unavailability/limitation notices for this pass.

A **relationship** here means ApiPilot detected that one operation's response likely
feeds a value into another operation's request (e.g., a `POST /users` response's `id`
being used by a later `GET /users/{userId}`). Relationships carry a confidence level —
**Confirmed**, **Likely**, or **Possible** — and only Confirmed/Likely relationships are
assembled into a reviewable workflow.

### 3.8 Workflow Review

Each discovered **integration workflow** is an ordered chain of operations, shown as a
sequence of method+path steps. Each hand-off between steps shows its confidence badge
and a plain-language explanation of the evidence (e.g., "response field `id` from step 1
matches the `userId` path parameter in step 2").

Approve or reject each workflow individually, or select several and use **Approve
selected / Reject selected** with confirmation. If no workflows were discovered, you'll
see an empty state and can simply continue. Approving a workflow here determines whether
it will be rendered as an ordered request sequence in the Postman export (see 3.9);
rejecting it means only the individual scenarios (if separately accepted) are exported. If
an action fails, the error appears at the top of the stage and the page scrolls to it.

### 3.9 Postman Generation

Optionally enter a base address, then click **Generate Postman Collection**. On success
you get:

- **A Postman collection** — one request per accepted single-operation scenario, plus
  one ordered request sequence per *approved* workflow (with response values wired into
  variables consumed by later steps), organized into folders by the spec's tags. Beyond
  approved workflows, a standalone scenario with an unresolved path parameter (e.g. an
  `{id}` no workflow covers) is automatically chained to a confirmed/likely producer's
  response value where one exists, so fewer requests need manual variable entry.
- **An environment file** listing every variable the collection references (base URL,
  credentials/identifiers), left empty for you to fill in — no real secrets are ever
  written into the collection. A path parameter with no known value gets a variable named
  after its resource, so `/users/{id}` uses `{{user_id}}` and `/products/{id}` uses
  `{{product_id}}` — you can fill each one independently. A parameter that already names
  its resource (`/users/{userId}`) keeps its own name. If the spec declares more than one distinct authentication
  scheme, each gets its own named variable rather than sharing one. If a scheme uses
  OAuth2 client-credentials, the collection also includes a prepended "OAuth2 Token
  Setup" folder with one request that fetches an access token before the rest run, plus
  `clientId`/`clientSecret` variables for you to fill in. If a token or API key is itself
  obtainable from another operation's response, that value is wired in automatically
  instead of left blank.
- **A README** describing the request count, folder layout, how to run the collection,
  and a list of known limitations for this export (e.g., scenarios with no expected
  outcome, unsupported auth schemes, unsupported parameter serialization styles, or
  workflows that couldn't be faithfully rendered).

All three files are downloadable from this screen. If generation fails validation, you
get an explicit error and a list of the specific problems — never a silently broken
file. You can come back to this screen later and regenerate with different options.

### 3.10 Execution: handing off to Import & Run Collection

The guided workflow does not run collections itself. When you're done with the
downloads, click **Continue to Import & Run Collection**. ApiPilot switches to the
**Import & Run Collection** view with its upload form already filled in: the name (from
your specification's title) and the generated collection and environment files.

Nothing is uploaded or run for you. Pick a risk tier (Local / Dev / QA / Staging /
Production), submit the upload, and from there the generated collection is handled
exactly like any collection you import yourself — fill in its variables, optionally edit
requests or pick a subset, and run it, as described in
[section 4](#4-importing-and-running-your-own-postman-collection). That includes the
one-time uploaded-content confirmation before its first run.

The **Execution** chip in the stage tracker shows a short notice with a **Go to Import &
Run Collection** button, in case you reload the page or navigate away before the
hand-off.

### 3.11 Performance Testing (optional)

Performance Testing turns the scenarios and workflows you approved into a k6 load test. It
opens once the Postman collection has been generated (section 3.9), whether or not you run
it: choose **Set up a performance test** on the Execution notice, or the **Performance
Testing** chip in the stage tracker. Nothing is sent to any system until you trigger a run.

**The screen.** Above the tabs, a bar lists what still blocks a run, each item with the button
that fixes it: steps without an expected status (**Show them**), no target environment (**Create
one**), a script not generated or out of date (**Generate**), or k6 not available. Items disappear
as you finish them. When nothing is left, the bar says **Ready to run on** the chosen
environment, how many write operations will be sent, and **Go to run →**. The bar never starts a
run itself. Missing environment values are noted in the bar but do not block a run.

The tabs follow the order in which you prepare a test:

- **Plan**: the operations table, at full width.
- **Run setup**: the target environment and its values, the load profile, the thresholds
  (optional) and the k6 script, beside the run trigger. The tab label counts what is still to do
  there, for example **Run setup (2 to do)**. **Next: Run setup →** at the foot of the Plan tab
  goes to it.
- **Runs & reports**: a run's live progress, its report and the session's runs. Starting a run
  switches to it.

**The plan.** The operations in scope are the ones you selected in API Review, or every
operation when you selected none; there is no choice to widen them here. To include other
operations, widen the selection in API Review and regenerate, or use the quick performance
test (section 5). ApiPilot proposes one journey per approved workflow, with its steps in
dependency order, and one single-step journey for each other operation in scope. Every
virtual user runs every journey, in order, on each iteration. For each step you see its
method and path, the one positive scenario used and, when there was a choice, why (a
rule-generated scenario is preferred over an AI-enhanced one), its authentication, and the
variables it produces or needs. Each step sends that scenario's generated request, built the
same way as the Postman collection: its headers, query parameters and body come from the
scenario and are not edited here. Negative scenarios are never run under load. Write operations (POST, PUT, PATCH,
DELETE) are included by default: remove any operation you do not want sent (see **Removing**
below).

- **The operations table.** One line per step: its journey number when some journey has more
  than one step (`J2.1` is the first step of journey 2, whose steps are grouped under a
  **Workflow** row; with only single-step journeys, as in the quick test, the column is left
  out), its method
  and path, the write marker, its expected status, a short authentication label, and the
  environment values it needs. Filter by method, by **Writes**, by **Needs expected status** or
  by **Body edited** (each chip shows its count), and search by method, path or scenario. Select a step's path to
  open its details in a row directly under it: the scenario and why it was chosen, the request
  preview, the expected-status editor, the full authentication, the variables, the order
  controls and **Remove from plan**. More than 50 steps are split into pages.

- **What the writes will do.** Above the journeys, a summary states how many write
  operations will be sent, the count per method, and each one by method and path, with the
  reminder that every virtual user sends each of them on every iteration for the whole run and
  that ApiPilot does not clean up afterwards. Each write step carries a text marker
  (**Creates**, **Replaces**, **Updates** or **Deletes**) beside its method. The same list is
  shown next to the run trigger. Select an operation's path in either list to open its details
  in the table. A plan with no writes says it sends only read requests.
- **Removing.** **Remove all write operations** removes every write in one action, and
  **Remove by method** offers **Remove all <METHOD> operations** for each method in the plan.
  To remove a few operations, tick their rows and choose **Remove from plan**, or use
  **Remove from plan** in one step's details. Removed
  operations are in the table's **Removed** view (see below). When every operation is removed,
  the plan says so and the script cannot be generated until you restore one.
- **Removed and left-out operations.** Above the table, **In plan**, **Removed** and **Left out**
  switch between the plan's steps, the operations you (or ApiPilot, for a login it uses for
  credentials) removed, and the operations left out because they have no positive scenario. Each
  shows its count; a view with nothing in it is not offered. In **Removed**, each row gives the
  reason and a **Restore** button; tick several rows to restore them together, or use **Restore
  all**. Select a removed operation's path to see, under it, the step and request it would have
  if restored: scenario, expected status, authentication, variables and the request preview. This
  view does not change the plan; **Restore to the plan** there adds it back. A left-out operation
  has nothing to open or restore.
- **The request a step sends.** In a step's details, choose **Request** to see what it sends: the
  method, the path template, each path, query and header parameter with its generated value
  or the environment value it needs, the authentication, and the body. Values that come from
  the environment are shown by name only, and secrets are marked, never shown. A step without a
  body says **This request has no body.**; an operation that accepts a body this step does not
  send says so; form and multipart bodies are shown but cannot be edited. Authentication and
  undocumented headers are view only.
- **Editing a step's parameters.** Under **Parameters**, each path, query and header
  parameter the specification documents is listed with its type, allowed values, the generated
  value and what the step sends. Choose **Edit parameters**, change a value or clear **Send** to
  leave an optional parameter out (or tick it to add one the step does not send), and **Save
  parameters**. For example, if your server rejects the generated `sort=a`, set `sort` to a value
  it accepts, or leave it out.
  - A parameter filled by an earlier workflow step cannot be edited. An array or object
    parameter can be left out but not edited. A required parameter, and every path parameter, is
    always sent; an edited path parameter is sent as the value you type instead of a value from
    the environment.
  - `{{name}}` in a value takes it from the target environment, as in a body. A parameter the
    specification marks `format: password` must hold a `{{name}}` reference. A value is at most
    2 KiB and cannot contain a line break. A refusal is shown on the parameter it is about.
  - An edited step shows **Parameters edited**. **Reset to generated parameters** puts it back
    after you confirm. Saving or resetting marks the script **Out of date**. Parameter edits are
    kept, restored and discarded exactly as body edits are.
- **Steps that failed the last run.** After a run ends, each step the server answered with a
  status it does not expect shows **Failed last run**, and the **Failed last run** chip lists
  only those steps. A step's details name the statuses (for example `400 × 7,422`) and point you
  to its **Request**, where you can check and edit what it sends.
- **Editing a step's body.** For a JSON or text body, choose **Edit body** (or **Add a body**)
  under the request, change it, and **Save body**; **Cancel** leaves it as it was. You edit the
  body before ApiPilot fills in its own values: under **Replaced at run time**, the editor lists
  each field ApiPilot fills when the test runs (a value unique per virtual user and iteration, a
  value from an earlier workflow step, or a token) and where it comes from. Keep the field to
  keep that value; remove the field and ApiPilot stops filling it, and the step's details say so.
  - To use a value from the target environment, write `{{name}}` inside a JSON string (or
    anywhere in a text body). The name is then listed with the plan's other values, in the
    environment template and in the checklist. Names ApiPilot uses for its own values are
    refused.
  - **Secrets.** Values you type are written into the script. Reference secrets from the
    environment as `{{name}}` instead. A field the specification marks `format: password` must
    hold a `{{name}}` reference whenever you save the body, even if you changed another field;
    such a reference is marked secret. ApiPilot cannot recognise a secret typed into any other
    field, so do not type one.
  - A JSON body must be valid JSON; if not, the editor shows the line and column. A body that
    differs from the specification (a missing required field, a wrong type, a value outside the
    documented values, format or bounds) is saved with a **Differs from the specification**
    warning listing each difference; it never blocks the script. A body is at most 64 KiB.
  - An edited step shows **Body edited** in the table; the **Body edited** chip lists them, and
    **Reset all edited bodies** puts every one back to the generated body after you confirm.
    **Reset to generated body** in a step's details does the same for one step.
  - Saving or resetting a body marks the script **Out of date**. Editing a performance step's
    body never changes the approved test model, the Postman collection or the functional tests.
  - An edit stays with its step while the plan exists. It is kept while the operation is removed
    (the **Removed** view shows it, read only) and comes back when you restore it, and **Reset
    plan** keeps it. If the guided workflow's approvals change the step's scenario, the edit is
    discarded and the plan names the operation. Starting a new quick test replaces the plan and
    its edits.
- **Long lists.** The steps that still need an expected status are a counted list, collapsed.
  The write list is never collapsed. The steps that need an
  expected status are counted in the bar above the tabs; open **steps to set** there, and each
  entry opens that step in the table and puts the cursor in its editor. **Needs status · Set** in
  the table does the same for its row.

- **Expected status.** Each step starts with the success statuses the specification
  documents, labelled "from specification". You can add codes (an exact code such as `201`,
  or a range such as `2XX`) or remove them; yours are labelled "set by you". Any other
  response counts as a failure. A step whose specification documents no success status
  starts empty, and the script cannot be generated until you set one.
- **Order and think time.** In a step's details, **Move up** and **Move down** move a single-step
  journey, **Move journey up** and **Move journey down** move a workflow journey, and **Move step
  up** and **Move step down** reorder a workflow journey's steps.
  A move that would run a step before the step producing a value it needs is refused, and
  the message names the value. **Think time** pauses between requests.
- **Load profile.** Pick Smoke, Load, Stress, Spike or Soak and edit its stages (duration and
  target virtual users). These are starting values, not recommendations. ApiPilot applies no
  limit on virtual users or duration and gives no warning.
- **Thresholds.** None are set until you add one (a latency percentile or a failure rate,
  for the run or one step). With none, the report gives no pass/fail verdict.

**Values.** Values the specification cannot produce (the base URL, client credentials, a
path parameter no operation produces) are the target environment's values. Choose the
environment, then **Edit values** or **New environment**; values are typed into hidden
fields and stored encrypted. The checklist shows each value as **Present** or **Missing**
for the chosen environment. A missing value does not block a run: that step is not sent and
is reported as missing data, and the steps that depend on it are reported as not attempted.
The environment form suggests one row for each value the plan still needs. Removing an
operation drops only the values no remaining step needs: a path parameter such as `customer_id`
stays while any remaining operation, for example `GET /customers/{id}`, uses it. The checklist's
**Needed by** column shows which steps need each value. Rows left empty are not saved.

**The script.** **Generate script** creates a k6 script and an environment template, which
you can download and run elsewhere. The same plan always produces the same bytes, and neither
file ever contains a value. Any change to the plan marks the script **Out of date** until you
regenerate it.

**Running the script outside ApiPilot.** The two downloads are `apipilot-performance.js` (the
script) and `apipilot-performance-environment.json` (the template). The template lists each
value the plan needs, the environment variable that carries it, and whether it is a secret. The
names and numbers depend on the plan, and a changed plan can renumber them, so always take them
from the template downloaded with the script you run. For example:

```json
{
  "baseUrl": { "env": "APIPILOT_V_0", "secret": false, "value": "" },
  "clientSecret": { "env": "APIPILOT_V_1", "secret": true, "value": "" }
}
```

k6 does not read the template. The script takes each value only from its `APIPILOT_V_<n>`
environment variable, so install k6 1.0.0 or later on the machine that will generate the load,
set those variables, and run the script unmodified:

```powershell
$env:APIPILOT_V_0 = "https://staging.example.com"
$env:APIPILOT_V_1 = "<client secret>"
k6 run apipilot-performance.js
```

On Linux or macOS, use `export APIPILOT_V_0=...` instead. `k6 run -e APIPILOT_V_0=...` also works,
but it leaves secrets in shell history and the process list, so prefer environment variables for
anything the template marks `"secret": true`. Do not type real secrets into the template and keep
it on disk: the files are value-free by design. A variable left unset behaves as a missing value
does in ApiPilot: that step is not sent, and the steps depending on it are not attempted. A run
outside ApiPilot prints k6's own end-of-test summary; ApiPilot's report, findings and run history
are produced only for runs started from the panel.

**Running.** You need k6 1.0.0 or later installed yourself on the machine running the
ApiPilot backend, on `PATH` or named in `K6_BINARY_PATH` (README Configuration). ApiPilot
never downloads or installs k6; the panel shows whether k6 is ready, and **Check again**
re-checks. The trigger names its target, for example **Run on perf-local (local)**, next to
the environment's tier and base URL and the statement that load comes from the machine
running the backend. There is no extra confirmation on any tier, production included. Starting a run opens the
**Runs & reports** tab, which repeats the target for as long as the run lasts. While
it runs you see elapsed time against the plan, virtual users, requests, failures, journeys
cut short, token refreshes, and a per-step table. **Cancel run** stops load within about 10
seconds and keeps what was measured. A run carries on if you close the page, and it keeps
your session alive; only one run (performance or functional) can be in progress per session.
ApiPilot never starts, repeats or resumes a run by itself: a run interrupted by a backend
restart is recorded as cancelled.

**The report.** When a run ends, its report appears automatically, and **Download report
(HTML)** saves the same file, which opens with no network access. It shows:

- Totals: requests, throughput, failure rate, p50, p95 and p99 latency (within 1%), exact
  minimum, mean and maximum latency, iterations with their p95 duration, journeys cut short, and
  data received and sent.
- Your thresholds with passed or failed, and findings from fixed rules (such as the slowest step
  or where failures start).
- **Timeline**: three panels on one time axis, each with its own scale: virtual users, p95
  latency of all steps (a log scale when one interval is far slower than the rest), and requests
  per interval split into as expected and failed. Hover over an interval for its figures, or open
  **Timeline as a table**.
- **By step over time**: one row per step, one cell per interval, shaded by that step's p95
  latency on a shared scale. Hatched cells had failures; hover over a cell for its figures.
- **By step**: the expected statuses and every status **received**, each marked expected or
  unexpected (for example `400 × 59 unexpected`), requests, throughput, failure rate, min, p50,
  p90, p95, p99 and max latency, failure category, check pass rate and requests not sent.
- What the run changed on the target (write requests sent and succeeded) and token refreshes.
- **Provenance · request and response by step**: for each step, a **Request** block (method and
  path template, authentication, values taken from earlier steps, values you supply, whether the
  body was edited) and a **Response** block (expected and received statuses, failures, latency,
  k6's request phases such as time to first byte, extracted values and checks), followed by why
  the step is in its journey and which scenario it uses. Steps with failures open automatically.

A run recorded before version 19.11.0 has no received statuses beyond its failures, no request
phases and no per-step timeline; its report says so rather than showing empty figures. A step that sent a
body you edited is marked **Body edited by you**, and a step whose parameters you edited is
marked **Parameters edited by you**; the provenance says how many steps did each. A step that
received a status it does not expect says, under **What to check**, to open its request in the
plan;
the edited body itself is not recorded. It never contains a credential, token, request or
response body, or a resolved URL, so the request and response blocks show each step's template
and what was measured, not the content that was sent or received.

## 4. Importing and running your own Postman collection

Choose **Import & Run Collection** on the start screen (or its tab, once the tab bar is
visible). This area never requires an OpenAPI upload or a guided workflow. It is also
where a collection generated by the guided workflow is run (section 3.10); apart from
that hand-off, nothing you do in the guided workflow affects it. Use **← Back to start** to
return to the start screen; your selection and run order are kept for when you choose
**Import & Run Collection** again.

### 4.1 Upload

Provide a name (unique among your uploads), a risk tier (Local / Dev / QA / Staging /
Production — the same vocabulary as a guided-workflow environment), your Postman
Collection v2.1 JSON file, and your Postman Environment JSON file. Both files are
validated immediately: a malformed collection, a collection with no requests at all, or a
malformed environment is refused with a specific error, never silently repaired.

### 4.2 The uploaded-content confirmation

The first time you run a newly uploaded collection, a warning appears: its requests, and
any pre-request/test scripts it carries, were **not generated or verified by ApiPilot**
and will execute exactly as authored — including any additional network calls a script
itself makes. You must explicitly confirm before the first request is ever dispatched;
declining runs nothing. This confirmation is required only once per uploaded collection,
not on every run of an already-confirmed one.

### 4.3 Browsing and editing the collection

Once uploaded, select the collection to open its editor — a Postman-like view of exactly
what will be sent, before anything runs.

- **Collection tree**: every folder and request, in the collection's own order. Selecting
  a request shows its method, full URL, headers, and body, with every `{{variable}}`
  placeholder visibly marked rather than silently resolved.
- **Variable panel**: click **Variables** in the tree's header row to see every variable
  the collection references (plus any you define yourself, even before a request uses
  it), its current value, whether it's resolved or missing, and which scope currently
  wins — the collection's own default, the selected environment, or your own override.
  Typing a value updates every visible request preview immediately, with no reload or
  run required. Values you set here are saved with the collection, so they're still there
  next time. If any variable is still missing a value, the **Variables** button shows a
  red dot.
- **Request editor**: method, URL, and **Save** stay visible while you switch between
  three tabs — **Headers**, **Body**, and **Tests** (the request's own `pm.test(...)`
  script, previously invisible pre-run). A tabbed resolved (variable-substituted) preview
  — **Request**, **Body**, **Tests** — stays visible below as you edit, and lists any
  variables that request still leaves unresolved. Saving an edit updates ApiPilot's
  stored copy of the collection (the file you uploaded is not changed), and any run made
  with the edit applied marks that request as edited in its results.
- **Headers added by authentication**: if a request's authentication (its own, or
  inherited from its folder or the collection) is a bearer token or an API key sent in a
  header, the Headers tab shows an "Auth adds" note with the header, its `{{variable}}`
  highlighted, and where the auth comes from; the preview lists it marked "(from auth)". It
  isn't a header row: click **Edit auth** in the note to change it on the Auth tab. A token
  typed directly into the collection shows as "hidden literal value", never as its value.
- **Tests**: the Tests tab shows and saves only the request's own test script. Test scripts
  on its folders or on the collection also run, as they do in Postman, but they are not
  shown or saved there.
  Other authentication types (basic, digest, OAuth, AWS signature, and so on) are not
  previewed, because their header can't be shown ahead of time without guessing.
- **Auth and used variables**: a request's **Auth** tab shows the auth it actually uses,
  whether that is set on the request or inherited from a folder or the collection, with
  its fields and `{{variable}}` references. A secret typed directly into the collection
  (for example a literal password) is shown as hidden, never as its value. The **Used
  variables** tab lists every variable the request uses, where, and whether it is set, and
  is read-only.
- **Editing auth**: on the **Auth** tab, choose the request's auth type — **Inherit auth
  from parent**, **No Auth**, **Bearer Token**, **Basic Auth** or **API Key** (header or
  query params) — and fill in its fields, for example `{{adminToken}}` to call one endpoint
  with a different token. Click **Save** to save it with the request's other fields; the
  request is marked edited and the next run uses it. A hidden secret stays as it is while
  you leave its field blank; type a value to replace it. Other auth types, such as OAuth
  2.0, are shown read-only; choosing an editable type replaces them. Folder and collection
  auth can't be edited in ApiPilot.
- **Adding, deleting, renaming, and reordering**: use the actions menu on a request or
  folder row to rename, delete, or move it up or down, or **+ Add request** to add a new
  one to a folder or the collection root. Deleting a folder deletes everything nested
  inside it. None of this affects a run you already completed.
- **Moving to another folder**: choose **Move to…** in the request's or folder's actions
  menu. The item lands last in its new folder. It keeps working as it
  did: auth it inherited from the folder it leaves is written onto it, and that folder's
  pre-request and test scripts are copied onto it, each marked as copied. ApiPilot then
  tells you what it copied and marks the item edited. The new folder's own scripts also
  run for it, because a folder's scripts run for everything inside it; the dialog lists
  them before you confirm, and warns if a folder's scripts would run twice.
- While a run of this collection is in progress, the entire editor becomes read-only
  until the run finishes — you'll see this indicated rather than being allowed to make a
  change that might not apply.

A collection generated by the guided workflow gets this same editor once you've submitted
it through the hand-off (section 3.10).

### 4.4 Running it

Before clicking **Start run**, you can optionally use the run panel's checklist to select
which requests actually run this time — leave everything checked to run the whole
collection, or narrow it to a subset the way Postman's own collection runner lets you. Each
row shows the request's folder, method, name and endpoint path. Drag a row, or use its ↑ and
↓ buttons, to place a request anywhere in the run, across folders, as in Postman's Runner.
That order is for runs only: the collection, its tree and each request's folder auth and
scripts don't change. It stays for every later run until you reload the page, and **Reset**
restores the collection's own order with every request selected. Unchecked requests stay
unchecked when you reorder. To change the collection's own order, or move a request to
another folder, use the collection tree.

Each request runs with its collection's and folders' auth and pre-request/test scripts
applied, exactly as Postman runs it.

A variable that's still missing a value does not stop the run. That's deliberate: an
earlier request's test script may capture a value (for example a token, with
`pm.environment.set`) that a later request uses. A request that still sends an unresolved
`{{variable}}` simply records its own failure. Values captured by scripts during a run are
saved back to the collection, so the preview shows them afterwards and the next run starts
with them. They are saved as text: a number such as `42` becomes `"42"`, and an object
becomes its JSON. Within a single run, later requests see the value exactly as the script
set it.

Click **Start run**. A Staging/Production tier or a destructive request
(`POST`/`PUT`/`PATCH`/`DELETE`, detected directly from the collection's own requests)
triggers a second, separate confirmation naming the tier and the specific requests
involved. Requests then run one at a time, in the run-order list's order (the collection's
own order unless you changed it) — including everything inside nested folders.

While running, you see a live summary and a **Cancel run** button. Each request's row
shows an outcome:

| Outcome | Meaning |
|---|---|
| Passed | The request completed and none of its tests failed |
| Assertion failed | The request completed but one or more of its tests failed |
| Connectivity failure | The request could not reach the target at all |
| Timed out | No response within the allotted time |
| Cancelled / Run ended before this request | The run was stopped before this request was sent |

An uploaded-collection run sends every selected request in order. A request that needs a value
an earlier request failed to produce is still sent, and records its own outcome.

Expand a row to see its details in tabs — **Request**, **Response**, and **Tests** —
including each test's individual result, named exactly as your collection's `pm.test(...)`
scripts named it. ApiPilot never invents a status-code or schema expectation your
collection didn't declare. Runs are always labeled **Uploaded**; past runs are listed and
can be reopened without re-running, even after a backend restart. A run that was in
progress when the backend restarted is recorded as cancelled with a reason that
distinguishes it from one you cancelled yourself.

You can upload and keep multiple named collection/environment pairs at once, switch
between them, and remove one you no longer need — removing a collection never changes
the results of a run you already completed against it.

### 4.5 Asking why a request failed

Expand a failed request's row and choose **Analyze failure**. ApiPilot names the most likely
cause using fixed, documented rules, and the local AI writes a short explanation and next
steps. Nothing is analyzed automatically. You can analyze a failure
while the rest of the run is still in progress, and in any earlier run still listed in the
run history. Analysis never sends a request to your target API; it works only from what
the run already recorded.

While it works, the panel shows **Waiting for the local AI** (the model is loading, or other
AI work is ahead of yours) and then **Generating**, each with an elapsed timer. Only one
analysis runs at a time in your session. Every **Analyze failure** button stays disabled
until it finishes, including after a page reload.

The result contains:

- **A likely cause**, decided by a rule and marked with a **Rule** badge: a potential
  specification mismatch, environment issue, or downstream-service issue. It carries a
  **Strength** of High or Moderate, with no number. High is used only where the signal has
  one reading: no response at all, or a status the specification does not document. Below it
  is the rule in plain words, for example "No response was received: the connection failed
  or timed out." It is a likely cause, not a confirmed one.

  When no rule fits, you see **Not enough evidence to name a likely cause** and "No rule
  matched the recorded evidence." ApiPilot deliberately doesn't guess on ambiguous signals,
  such as a 404 (wrong address, or a route that differs from the specification) or a bare 500.
- **Evidence for this cause**: the recorded facts that triggered the rule, such as the
  status code, a failed test's message, or, for a Local-tier run, the response body. Facts
  from the specification are marked "from the specification". Everything else is under a
  collapsed **Other evidence considered** section.
- **An AI explanation**, marked with an **AI** badge and labelled **AI inference, not a
  confirmed root cause**: a short summary and up to three **Suggested next steps**. The AI
  cannot change the cause. An answer that names a different cause, or that points at no
  recorded evidence, is not shown.
- **Specification context**, when the collection came from your current guided workflow:
  the operation, the scenario, the documented response codes, and any earlier workflow
  step this request depends on, with that step's outcome in the same run. For a
  collection ApiPilot did not generate, or one from an earlier workflow, the panel says
  context is unavailable and why. It never guesses one.

Credentials, tokens, and sensitive body fields are replaced with `[redacted]` before the AI
sees them, and again in anything it writes back. Analyses are saved with the run, so they
are still there after a reload or backend restart. If the AI is unavailable, slow, or its
answer can't be used, you still get the cause and the evidence, with **AI explanation
unavailable** and the reason in place of the summary. **Analyze again** replaces the stored
analysis with a new one. The exception is when the new explanation fails and the stored
one had an explanation: the earlier explanation is kept, and a notice says why the new one
couldn't be written. Nothing retries automatically.

Treat the result as a starting point for your own investigation.

### 4.6 Things to know

- An uploaded-collection run and a guided-workflow run share the same single "one run at
  a time" slot for your session — starting either kind is refused while the other is
  still in progress. (Guided-workflow runs are started only through the HTTP API; the
  screens always use Import & Run Collection.)
- If you edit a request and later re-upload a new version of the same collection, or the
  request no longer exists, your edit is discarded rather than silently reapplied to a
  different request.

## 5. Quick performance test

Choose **Quick performance test** on the start screen (or its tab, once the tab bar is visible)
to load-test an API straight from its OpenAPI specification. It skips API Review, scenario
review, AI enhancement, workflow review and Postman generation, and it never reads or changes a
guided workflow you have in progress; both can exist side by side.

**Upload.** Upload one OpenAPI 3.x YAML file. The same checks as the guided workflow apply
(size limit, YAML, OpenAPI version), with the same error messages, and nothing is created when
the file is rejected. ApiPilot then generates positive scenarios only, with its fixed rules and
no AI, and opens the performance plan. Uploading the same file again gives the same plan, and
the same edits give a byte-identical script.

**What the plan contains.** Every operation that has a positive scenario is its own single-step
journey, using the operation's full happy-path request. Requests are not chained: a path
parameter such as `orderId` is a value you supply in the environment, and the guided workflow is
the way to chain requests. Operations with no positive scenario are listed as left out, with
the reason. When the specification secures its operations with a token from a login operation
(for example `POST /auth/login`), that login is placed in the removed list as "used to acquire
the run's credentials": the token is still obtained once for the run, but the login itself is
not sent by every virtual user on every iteration. You can restore it. Nothing else is removed
by name; a logout or revoke operation stays in the plan, where the write summary shows it.

**Everything else is the performance plan of section 3.11**: the write summary and effect
markers, bulk removal, the request preview, expected statuses, order and think time, the load
profile, thresholds, the script and its download, and the out-of-date marking. Because no one
reviewed these scenarios, read the write summary before you run. It lists every write operation
the run will send, above the journeys and again next to the run trigger.

**Environments and values.** You can create, edit and choose target environments from the quick
plan without starting a guided workflow. Environments are one set per browser session: one you
create here is also available in the guided workflow, and the other way round. The values
checklist works as in section 3.11.

**Running.** Runs work exactly as in section 3.11: your own k6, a trigger that names the
target, live progress, cancel, and the report. They share the one-run-at-a-time slot with
functional and guided performance runs. The report of a quick run states that the plan came
from the quick performance test with generated scenarios that were not reviewed. The run list
on this page shows quick runs only.

**Starting again.** **New specification** replaces the current quick test after you confirm.
Runs and reports already made are kept. **← Back to start** returns to the start screen and
keeps the quick test for your session. Like the guided workflow's plan, the quick test lives in
memory: a backend restart loses it (runs, reports and environments are kept), and you upload the
specification again.

## 6. Sessions

ApiPilot has no login. Each browser is assigned its own private session automatically (a
random cookie), so two people working from different browsers never see or affect each
other's uploads, reviews, or runs. Reloading the page, or opening a second tab in the
*same* browser, resumes the same in-progress workflow. If a session sits idle for more
than 60 minutes, its workflow is discarded and the next visit shows an explicit
"session expired" notice rather than silently starting over.

Your in-progress guided workflow itself lives in memory only and is lost if the backend
restarts. Uploaded collections (including their variable values and your edits) and your
run history are saved to a local database on disk, so they survive a backend restart for
as long as your session stays active — you won't need to re-enter credentials or lose
past results just because the server restarted. That saved data is still tied to your
session: if your session times out from inactivity, it is removed along with it.
Variable and credential values are encrypted before being stored.

## 7. AI behavior you should know about

- AI runs entirely on your own machine (Transformers.js); nothing about your
  specification, scenarios, or results is ever sent to an external service.
- Whether AI is available at all (`local` vs `mock` mode, and the model used) is a
  deployment-time configuration your operator sets — see the README's
  [Configuration](../README.md#configuration) section. There's no in-app toggle.
- If the AI model isn't ready or fails, the deterministic baseline is unaffected and you
  can continue the workflow normally.
- Larger specifications may only get AI enhancement for part of their operations within
  one run's time budget (roughly 5–10 operations on typical hardware); the rest are
  marked "not attempted" rather than silently dropped, and you can retry them in
  smaller batches.
- AI failure analysis (section 4.5) runs only when you ask for it, shares the same local
  model and queue as AI enhancement, and waits behind any AI work already running. The
  likely cause comes from fixed rules, not the AI; only the explanation is AI output, and it
  is labelled as an inference. Neither ever changes a run's recorded results.

## 8. Limitations to keep in mind

- Only a single OpenAPI 3.x YAML file is supported per workflow (max 10 MB). Swagger 2.0
  and JSON OpenAPI input are not supported.
- Only same-document `$ref`s are resolved; external references are reported as
  unresolved analysis issues, never fetched.
- Execution always requires you to explicitly click **Start run** — there is no scheduled,
  unattended, or CI-triggered execution mode.
- The operations you select at API Review can't be changed later in the same workflow;
  start a new workflow to test a different set.
- "Destructive" request warnings are based on HTTP method only (POST/PUT/PATCH/DELETE),
  not per-operation semantics — review the confirmation banner's request list yourself
  before confirming a Staging/Production run.
- AI failure analysis (section 4.5) is complete but not yet signed off: it has been tested
  only on made-up failures, not yet on failures recorded from real runs. The likely cause
  comes from fixed rules, so it is consistent, but it is still a likely cause, not a
  confirmed one; failures the rules do not cover show "insufficient evidence". Verify the
  cause yourself before acting on it. It explains one failed request at a time, and only in
  Import & Run Collection runs.
- Automatic chaining of an unresolved path parameter or auth credential to another
  operation's response is single-hop only (one producer, one consumer) and only applies
  to confirmed/likely relationships — it does not assemble multi-step chains on its own;
  use Workflow Review for that.
- OAuth2 support covers the client-credentials flow only. Authorization-code, implicit,
  and password grant flows are not automated and are reported as an unsupported auth
  scheme.
- Persisted environments and execution run history are tied to your browser session —
  they are not shared across different browsers/devices and are removed if that session
  is idle-evicted, the same as the rest of the session-scoped model.
- An imported collection's scripts execute with real effect, including any additional
  network calls a script itself makes — you are trusting the collection's author (or
  yourself) exactly as you would running it in Postman directly.
- The collection/variable editor (browsing, editing, and selective run) works on uploaded
  collections. A collection the guided workflow generates can use it only after you submit
  it through the hand-off (section 3.10).
- Headers added by authentication are previewed only for bearer tokens and API keys sent
  in a header (section 4.3).
- The quick performance test (section 5) sends generated requests that no one reviewed, never
  chains requests, and uses each operation's full happy-path scenario only. Valid boundary
  variants and negative scenarios are not generated.
- Performance testing (section 3.11) and the quick performance test (section 5) need k6
  1.0.0 or later that you install yourself. The run path has been checked against a real k6
  (v2.3.0 on Windows, 2026-09-28); the manual browser walkthrough of both features is still
  outstanding.
- Performance runs apply no limit and no warning on virtual users or duration, include write
  operations by default, and never clean up what they create. Load comes from the machine
  running the backend, so a heavy profile can be limited by that machine; the report shows it.
- Under load, each step checks its status and extracted values only, not response schemas.
- Each virtual user refreshes its own token before its stated lifetime ends, so a run sends
  one token request per virtual user per token lifetime. A token provider that rate-limits
  token requests, or revokes older tokens when it issues a new one, can make refreshes fail;
  the report shows this as failed refreshes and authentication failures.
- For an operation with both a rule-generated and an AI-enhanced positive scenario, the
  performance test uses the rule-generated one, while the Postman collection's choice ignores
  the origin, so the two can send different requests for that operation.

## 9. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "Something went wrong and this page could not be shown." | The page hit an unexpected error while displaying something | Choose **Reload page**. Saved collections, environments and run history are not affected. If it happens again, report it; the error is recorded in the backend log |
| Upload rejected immediately | File isn't `.yaml`/`.yml`, or exceeds 10 MB | Check the extension and file size |
| "Invalid YAML" / "Unsupported version" error | File isn't valid YAML, or isn't OpenAPI 3.x | Validate the file locally; Swagger 2.0 must be converted to OpenAPI 3.x first |
| Analysis issues listed after upload | Spec has unresolved/external `$ref`s, circular references, or unsupported constructs | Review the listed locations; generation still proceeds but treat affected operations' tests with caution |
| "Enhance with AI" stays on "Preparing the local model" a long time | First run needs to download/load the model | Wait for first-run provisioning to finish (see README AI setup); subsequent runs are faster |
| AI Enhancement ends "Partially completed" | Spec has more operations than fit the run's time budget | Use the per-batch **Retry batch N** buttons, or **Retry AI enhancement** if retryable |
| **Continue** on API Review is disabled | No operation is checked | Check at least one operation, or use **Select all** |
| "Finalize Review" is blocked | No scenarios have been accepted yet, or a decision is still being saved | Accept at least one scenario; wait a moment for pending decisions to finish |
| Scenario Review controls are greyed out | The review is being finalized and dependency analysis is running | Wait for finalizing to finish; the workflow moves on to Workflow Review automatically |
| Postman generation fails | Approved scenarios/workflows contain unresolved data ApiPilot cannot faithfully render | Read the listed validation problems and address them in Scenario/Workflow Review, then regenerate |
| Confirmation appears after **Start run** | Target environment is Staging/Production, or the collection includes destructive requests | Review the named requests, then confirm explicitly if intended |
| "Your previous session expired due to inactivity" | Session was idle over 60 minutes | Start a new upload; prior workflow state cannot be recovered |
| Guided workflow progress lost after a backend restart | Workflow generation state is in-memory only by design | Re-run the workflow from Upload; your uploaded collections and past run history are unaffected and still there |
| "Import & Run Collection" tab refuses my collection/environment file | File isn't valid JSON, or the collection has no requests at all | Fix the file locally; ApiPilot never attempts to repair a malformed upload |
| A request fails with an unresolved `{{variable}}` in what it sent | No value was supplied, and no earlier request's script captured one | Set the value in the **Variables** panel (the red dot shows which are missing), or check the script that should capture it |
| Collection/variable editor won't let me make a change | A run of that collection is currently in progress | Wait for the run to finish (or cancel it); the editor unlocks automatically once it does |
| **Analyze failure** is disabled on every request | Another failure analysis is already running in your session | Wait for it to finish; the buttons re-enable automatically |
| Failure analysis stays on "Waiting for the local AI" | The model is loading, or other AI work (such as AI enhancement) is ahead in the queue | Wait; the timer shows how long it has waited, and the time limit starts only once generation begins |
| Failure analysis shows "AI explanation unavailable" | The local model did not finish in time, was not ready, would take longer than the limit, or gave an answer ApiPilot could not use | The cause and evidence are still valid; choose **Analyze again**, or ask your operator about the model and `AI_INFERENCE_TIMEOUT_MS` (README Configuration). An earlier explanation is kept |
| Performance run trigger is disabled with "k6 was not found" | k6 is not installed on the backend machine, or not on `PATH` | Install k6 1.0.0 or later yourself, or set `K6_BINARY_PATH`, then choose **Check again**. You can still download the script |
| "k6 is installed but not supported" | The installed k6 is older than 1.0.0 | Upgrade k6, then choose **Check again** |
| **Generate script** stays disabled | A step has no expected status (its specification documents no success status) | Add an expected status to the listed step |
| **Generate script** is disabled with "The plan has no operations" | Every operation was removed | Restore at least one operation from the removed list |
| Quick performance test: a new upload asks to replace the current one | A session has one quick test at a time | Confirm to replace it; runs and reports are kept |
| Quick performance test: the login operation is under Removed | It is the operation the plan uses to acquire its token | Leave it removed unless you want it load-tested; **Restore** adds it as a journey |
| Performance report shows a step as "Missing data" | The chosen environment has no value for a name the step needs | Edit the environment's values; the checklist shows which are missing |
| Performance report shows many authentication failures | A token expired with no stated lifetime, or token refreshes failed | Check the report's token refresh section; a provider that revokes older tokens or rate-limits token requests needs fewer virtual users or longer-lived tokens |
| Failure analysis says "Not enough evidence to name a likely cause" | No rule matched the recorded result, for example a 404 or a 500 with no recorded body | Check the evidence shown yourself; a Local-tier run records request and response excerpts, which let more rules apply |

## 10. Where to look next

- [README](../README.md) — installation, configuration, AI model selection, and full
  scope/limitations.
- [Architecture reference](architecture.md) — internal system design.
- [specs/ROADMAP.md](../specs/ROADMAP.md) — feature status and what's planned next.
- Individual `specs/<feature>/spec.md` files — the normative requirements behind any
  behavior described in this manual, including
  [specs/027-frontend-design-system](../specs/027-frontend-design-system/spec.md) (the shared
  shell, theme, and component library) and
  [specs/028-collection-editor-ui](../specs/028-collection-editor-ui/spec.md) (the collection/
  variable editor described in section 4.3) and
  [specs/030-ai-failure-analysis](../specs/030-ai-failure-analysis/spec.md) (the AI failure
  analysis described in section 4.5).
