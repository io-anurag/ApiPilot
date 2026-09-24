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
against a target you choose. For any request that fails, you can ask the local AI for a
labelled, evidence-backed explanation of the likely cause (section 4.5).

If you already have a Postman collection and environment of your own — exported from
Postman, received from a teammate, or hand-authored — you can instead import and run it
directly, without uploading an OpenAPI specification at all. See
[section 4](#4-importing-and-running-your-own-postman-collection).

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

The start screen offers two paths: **Guided Workflow** (described in this section) and
**Import & Run Collection** (described in [section 4](#4-importing-and-running-your-own-postman-collection)).
While the guided workflow is in progress the tab bar is hidden so you can finish it; use
**← Back to start** to return to the start screen at any time. Nothing is discarded —
choosing **Guided Workflow** again resumes where you left off. The tab bar appears once you
are in **Import & Run Collection**, and switching between the two views never discards
either one's state.

Within the guided workflow, every step below is reached in this fixed order, and a
completed step can be revisited read-only (or, for the two review stages, reopened) by
clicking its chip in the stage tracker at the top of the page.

```text
Upload → Analysis → API Review → Deterministic Generation → AI Enhancement
  → Scenario Review → Dependency Analysis → Workflow Review → Postman Generation
  → Execution (hand-off to Import & Run Collection)
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
you to confirm discarding it first. If your previous session was idle for more than 60
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

## 4. Importing and running your own Postman collection

Choose **Import & Run Collection** on the start screen (or its tab, once the tab bar is
visible). This area never requires an OpenAPI upload or a guided workflow. It is also
where a collection generated by the guided workflow is run (section 3.10); apart from
that hand-off, nothing you do in the guided workflow affects it.

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
  header, the editor notes the header it will add, and the preview lists it marked
  "(from auth)". It isn't an editable header entry — change the auth variable instead.
  Other authentication types (basic, digest, OAuth, AWS signature, and so on) are not
  previewed, because their header can't be shown ahead of time without guessing.
- **Adding, deleting, renaming, and reordering**: use the actions menu on a request or
  folder row to rename, delete, or move it, or **+ Add request** to add a new one to a
  folder or the collection root. Deleting a folder deletes everything nested inside it.
  None of this affects a run you already completed.
- While a run of this collection is in progress, the entire editor becomes read-only
  until the run finishes — you'll see this indicated rather than being allowed to make a
  change that might not apply.

A collection generated by the guided workflow gets this same editor once you've submitted
it through the hand-off (section 3.10).

### 4.4 Running it

Before clicking **Start run**, you can optionally use the run panel's checklist to select
which requests actually run this time — leave everything checked to run the whole
collection, or narrow it to a subset the way Postman's own collection runner lets you.

A variable that's still missing a value does not stop the run. That's deliberate: an
earlier request's test script may capture a value (for example a token, with
`pm.environment.set`) that a later request uses. A request that still sends an unresolved
`{{variable}}` simply records its own failure. Values captured by scripts during a run are
saved back to the collection, so the preview shows them afterwards and the next run starts
with them.

Click **Start run**. A Staging/Production tier or a destructive request
(`POST`/`PUT`/`PATCH`/`DELETE`, detected directly from the collection's own requests)
triggers a second, separate confirmation naming the tier and the specific requests
involved. Requests then run one at a time, in the collection's own order — including
everything inside nested folders.

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

### 4.5 Asking the AI why a request failed

Expand a failed request's row and choose **Analyze failure** to have the local AI suggest
why it most likely failed. Nothing is analyzed automatically. You can analyze a failure
while the rest of the run is still in progress, and in any earlier run still listed in the
run history. Analysis never sends a request to your target API; it works only from what
the run already recorded.

While it works, the panel shows **Waiting for the local AI** (the model is loading, or other
AI work is ahead of yours) and then **Generating**, each with an elapsed timer. Only one
analysis runs at a time in your session. Every **Analyze failure** button stays disabled
until it finishes, including after a page reload.

The result is always labelled **AI inference, not a confirmed root cause**. It contains:

- **A likely cause**: a potential specification mismatch, environment issue, or
  downstream-service issue, with a confidence such as "Moderate (0.62)" (Moderate is 0.5 to
  below 0.75, High is 0.75 and above). If the model cannot support a cause, you see
  **Not enough evidence to name a likely cause** instead, with the reason. The reasons
  are that the model said so, its confidence was below 0.5, or it cited none of the
  recorded evidence.
- **A short summary** and up to three **Suggested next steps**.
- **Evidence cited**: the recorded facts the answer relies on, such as the failure
  category, status code, test results, and (for a Local-tier run) the request and response
  excerpts. ApiPilot writes this text from the recorded result; the AI only points to it.
  The rest is under a collapsed **Other evidence considered** section.
- **Specification context**, when the collection came from your current guided workflow:
  the operation, the scenario, the documented response codes, and any earlier workflow
  step this request depends on, with that step's outcome in the same run. For a
  collection ApiPilot did not generate, or one from an earlier workflow, the panel says
  context is unavailable and why. It never guesses one.

Credentials, tokens, and sensitive body fields are replaced with `[redacted]` before the AI
sees them, and again in anything it writes back. Analyses are saved with the run, so they
are still there after a reload or backend restart. **Analyze again** replaces the stored
analysis with a new one. If the new attempt fails, the previous analysis is kept and a
plain-language message explains what went wrong, for example that the model did not finish
within the time limit or that the analysis would take longer than the limit allows. Nothing
retries automatically.

Treat the result as a starting point for your own investigation. The default local model
did not yet meet ApiPilot's accuracy bar for this feature (see section 7).

### 4.6 Things to know

- An uploaded-collection run and a guided-workflow run share the same single "one run at
  a time" slot for your session — starting either kind is refused while the other is
  still in progress. (Guided-workflow runs are started only through the HTTP API; the
  screens always use Import & Run Collection.)
- If you edit a request and later re-upload a new version of the same collection, or the
  request no longer exists, your edit is discarded rather than silently reapplied to a
  different request.

## 5. Sessions

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

## 6. AI behavior you should know about

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
  model and queue as AI enhancement, and waits behind any AI work already running. Its
  conclusions are labelled as inferences and never change a run's recorded results.

## 7. Limitations to keep in mind

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
- AI failure analysis (section 4.5) is complete but still awaiting its model evaluation:
  the default local model often misclassifies causes or returns an answer ApiPilot has to
  reject. Verify any suggested cause yourself. It explains one failed request at a time,
  and only in Import & Run Collection runs.
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

## 8. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
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
| Failure analysis reports the model did not finish, or the analysis would take too long | The local model is slower than the configured AI time limit on this machine | Try again, or ask your operator about the model and `AI_INFERENCE_TIMEOUT_MS` setting (README Configuration); any earlier analysis is kept |
| Failure analysis says "Not enough evidence to name a likely cause" | The recorded result had too little detail, or the model's answer could not be supported by it | Check the evidence shown yourself; a Local-tier run records request/response excerpts that give the AI more to work with |

## 9. Where to look next

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
