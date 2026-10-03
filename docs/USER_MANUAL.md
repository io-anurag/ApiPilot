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

If you want to know how an API behaves under load, build a **performance plan**: chains of
requests you write and edit, as in Postman or JMeter, run with your own k6. A plan can start
empty, or be created once from an uploaded specification (the **Quick performance test**,
[section 5](#5-quick-performance-test)), from the guided workflow's approved workflows
([section 3.11](#311-performance-testing-optional)), or from the requests of an imported
collection ([section 5a](#5a-performance-test-from-a-postman-collection)). After that the plan is
yours. See [section 5b](#5b-performance-plans-request-chains).

If you already have a k6 script, **Run k6 Script** checks it, asks you to confirm its exact
content, and runs it with your own k6, with the report in ApiPilot. A script downloaded from
any performance plan can be run there too. See [section 6](#6-run-k6-script).

Nothing is ever sent to a cloud AI service, and no request is made against the API
described by your specification until you explicitly start an execution run. The one
exception is your own imported collection's requests and scripts, which you separately
and explicitly confirm before they run (section 4), and your own k6 script, whose exact content
you confirm before it runs (section 6).

## 2. Starting ApiPilot

Follow the [Quick start](../README.md#quick-start) section of the README to install
dependencies and run `npm run dev`. Once running:

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:4000/api/health`

The header shows a live connection indicator — **Connecting…**, **Connected**, or
**Disconnected** — so you always know whether the browser can reach the backend, plus a
light/dark theme toggle. Your choice is remembered on that browser; until you choose
explicitly, ApiPilot follows your operating system's light/dark preference.

The header also has two shortcuts:

- **Command palette** (the search button showing **Ctrl K**, or **⌘ K** on macOS, or that key
  combination anywhere outside a text field): type a few letters to open any of the five
  workflows, return to the start screen, or switch between light and dark theme. Use ↑ and ↓
  to move, **Enter** to choose and **Esc** to close. The palette offers only these commands; it
  does not search your specifications, collections, plans or runs, sends nothing to the backend
  and stores nothing except the theme choice. It does not open while you are typing in a field
  or while another dialog is open.
- **Help** (the **?** button): lists the keyboard shortcuts and what each workflow is for.

### The start screen

The start screen begins with **Start with the artifact you have.** Below it, three boxes name
the kind of input you may already hold and the workflows that accept it:

| You have | Workflows offered |
|---|---|
| An OpenAPI specification | Guided Workflow, Quick performance test |
| A Postman collection | Import & Run Collection |
| A k6 script | Run k6 Script |

Each workflow name there is a button. Under **Launch a test session**, the five workflows also
appear as cards, with **Guided Workflow** marked **Recommended**. A workflow opens the same way
whether you choose it from an artifact box, its card, its tab or the command palette. Each
workflow keeps one colour everywhere it appears (cards, tabs, palette), always next to its name:
indigo for Guided Workflow, fuchsia for Import & Run Collection, blue for the Quick performance
test, violet for Performance plans and pink for Run k6 Script. These colours are never used for
statuses: green, amber, red and cyan always mean success, warning, failure and information.
Paragraph text is justified, evenly spread between its margins.

## 3. The guided workflow

The start screen offers five paths: **Guided Workflow** (described in this section, including
the optional performance test in section 3.11),
**Import & Run Collection** (described in [section 4](#4-importing-and-running-your-own-postman-collection)),
**Quick performance test** (described in [section 5](#5-quick-performance-test)),
**Performance plans** (described in [section 5b](#5b-performance-plans-request-chains)) and
**Run k6 Script** (described in [section 6](#6-run-k6-script)).
While the guided workflow is in progress the tab bar is hidden so you can finish it; use
**← Back to start** to return to the start screen at any time. Nothing is discarded —
choosing **Guided Workflow** again resumes where you left off. The tab bar appears once you
are in **Import & Run Collection**, the **Quick performance test**, **Performance Plans** or **Run k6 Script**, each of which has its own
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

Performance Testing opens once the Postman collection is generated: choose **Set up a performance
test** on the Execution notice, or the **Performance Testing** chip. Choose **Create request-chain
plan** to create a performance plan from the workflows you approved: one chain per workflow, with
each workflow variable extracted by the step that produces it and passed as `{{name}}` to the steps
that use it, then one single-step chain for each other operation in the API review selection.
Credential requests become **Once before load** steps. The plan opens in **Performance Plans**,
where you edit, run and report it ([section 5b](#5b-performance-plans-request-chains)); it is never
re-derived from the workflow.

The stage also lists the plans already created from the guided workflow, each with **Open**. Runs
recorded from the guided plan this stage held before version 19.19.0 are listed read only under
**Earlier runs** in Performance Plans.

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
no AI.

**Creating a plan.** Choose **Create request-chain plan** to create a performance plan from the
specification: one single-step chain per operation, from its positive scenario, with credential
requests (an OAuth2 token, a login) as **Once before load** steps. Operations with no positive
scenario are listed in the plan's seeding report. Because no one reviewed these generated
requests, read each step, and the write steps listed at the run trigger, before you run. The plan
opens in **Performance Plans** ([section 5b](#5b-performance-plans-request-chains)). The page also
lists the plans already created from a specification, each with **Open**.

**Starting again.** **New specification** replaces the current quick test after you confirm.
Plans already created from it, runs and reports are kept. **← Back to start** returns to the
start screen and keeps the quick test for your session. The quick test lives in memory: a backend
restart loses it (plans, runs, reports and environments are kept), and you upload the
specification again.

Before version 19.19.0 the quick test held its own plan and runs. Those runs are listed read only
under **Earlier runs** in Performance Plans.

## 5a. Performance test from a Postman collection

When a collection already passes in **Import & Run Collection**, you can load-test the same flow
without defining its steps again. In the collection's run panel, select the requests and set their
order as for a run, then choose **Create request-chain plan**. You get one chain per top-level
folder, in run order. Recognised `pm.environment.set(...)` statements become extractors,
recognised status assertions become expected statuses, and inherited auth becomes an
`Authorization` header. Credential requests become **Once before load** steps. Creating the plan
reads the collection only: it runs no script and sends no request, and a seeding report lists
everything that was not carried over, such as pre-request scripts. The plan opens in
**Performance Plans** ([section 5b](#5b-performance-plans-request-chains)) and is never compared
with the collection again: editing or removing the collection leaves it unchanged.

The run panel also lists the plans already created from collections, each with **Open**. The
**Collection Performance Test** tab of earlier versions is gone; its runs are listed read only
under **Earlier runs** in Performance Plans.

## 5b. Performance plans: request chains

A **performance plan** is a load test you build and own outright, as in Postman or JMeter. It
holds one or more **chains**. A chain is an ordered list of **steps**, and every step is a concrete
request you can edit freely. Open the **Performance Plans** tab (or choose **Performance plans** on
the start screen) to list your plans, start an empty one, open, duplicate or delete one. Plans are
saved on this machine, so they are still there after ApiPilot restarts, for as long as your
browser session lasts.

An open plan is laid out like the other performance screens. **Before you can run** lists what
still blocks a run (plan problems, the target environment, the script, k6), each with the action
that fixes it, above the **Chains**, **Run setup** and **Runs & reports** tabs. The bar at the top
says **Saved**, **Saving…** or **Not saved**. **Not saved** means the last change was refused: the
message under the bar says why, and the script cannot be generated until it is fixed. A row you add
with **+ Add header** (or a query or form row) and leave empty is not saved.

**Earlier runs.** Before version 19.19.0 the guided workflow, the quick performance test and the
Collection Performance Test each held a derived plan of their own. Those plans are gone, but their
runs are not: when your session has any, the plans list shows them under **Earlier runs**, with the
note "Recorded before request-chain plans: you can open the report, but it cannot be run again or
restored." **View report** opens each report exactly as it was rendered.

**Starting from something you already have.** Each existing entry point can seed a first draft:
- **Quick performance test**: after uploading a specification, choose **Create request-chain plan**.
  You get one single-step chain per operation, from its positive scenario.
- **Guided workflow**: on the Performance Testing stage, choose **Create request-chain plan**. You
  get one chain per approved workflow, with its variables already extracted and referenced, then one
  single-step chain per other operation.
- **Import & Run Collection**: select requests in the run panel and choose **Create request-chain
  plan**. You get one chain per top-level folder, in run order. Recognised `pm.environment.set(...)`
  statements become extractors, recognised status assertions become expected statuses, and
  inherited auth becomes an `Authorization` header.

In every case, credential requests (an OAuth2 token, a login) become **Once before load** steps.
Seeding only reads its source and never runs a script. A **Seeding report** lists everything it
could not carry over, such as pre-request scripts, statements it did not recognise, or operations
with no positive scenario. After seeding, the plan is yours: it is never compared with,
re-derived from or overwritten by its source. Each seeded step shows where it came from, and is
marked **Changed** once you edit it. A step you add is marked **Added by you**.

**A step.** Each step has:
- a method, a URL and ordered query parameters, headers and a body (none, raw text with a content
  type, or form fields). Start the URL with `{{baseUrl}}`, the target environment's base URL, or
  with a full `http://` or `https://` address. Pasting a URL with a query splits it into rows.
  `Host` and `Content-Length` are set by k6 and cannot be set by a step;
- expected statuses, such as `201` or `2XX`. Any other status counts as a failure;
- **extractors**: a name taken from a JSON body field (`data.items[0].id`) or a response header;
- **checks**: a JSON field exists, a JSON field equals a value (text, number, true or false, or a
  `{{name}}`), the body contains a text, or the response time is at most a number of milliseconds.
  A failed check is counted, but never stops the chain;
- **Runs**: **Every iteration** (the default), **Once per virtual user** (on its first iteration,
  and again until it succeeds), or **Once before load** (once before any virtual user starts, shared
  by all of them);
- a think time after it, or the plan's default.

**Values.** Type `{{` in any field to pick a value. A `{{name}}` is filled from, in order:
- a value an earlier step extracted for the same virtual user (the latest extraction wins);
- the current row of a data set with that column;
- the target environment.

`{{$guid}}`, `{{$randomEmail}}` and the other supported dynamic variables are generated for each
request. Values extracted by every-iteration steps are cleared at the start of each iteration.

**The plan check** lists what must be fixed before a script can be generated:
- a value used before any step extracts it (move the step; moving is never refused);
- a Once before load step that uses a load step's value;
- a host taken from a variable other than `{{baseUrl}}`;
- a step with no expected status;
- a reference that is not valid.

It also lists the values the environment must provide (and whether it does), and every host the
plan sends to.

**Credentials typed as text.** If you type a credential into an `Authorization`,
`Proxy-Authorization` or `Cookie` header (or into a password field of a seeded step), saving
moves it into a secret value of the target environment, and the step keeps only `{{name}}`. You
are told which value was moved and where. Without a target environment, the save is refused until
you choose one.

**Data sets.** Under **Run setup**, add up to five CSV files: UTF-8, a header row, at most 5 MiB,
100,000 rows and 50 columns. Each column is a `{{name}}` you can use in any step. Choose **Next row
per iteration** (rows in file order, shared by all virtual users) or **One row per virtual user**.
Rows wrap to the first when they run out. Once before load steps use the first row. Mark columns
secret to hide them in the preview. A file that breaks a rule is refused with the reason and line,
and nothing is kept. Data set files are encrypted on this machine and reach k6 only while a run
lasts. Note that a downloaded copy of a script that reads a data set cannot be run in **Run k6
Script**, which never lets a script open files.

**Running.** Under **Run setup**, choose the target environment, the load profile, thresholds and
the default think time, then generate the script. The run trigger names the environment and
lists the chains, every write step and every host. Nothing is sent until you start the run. If a
Once before load step fails, the load never starts and the run ends as failed, naming that step.
The report shows each chain and step with its figures, each check's and extractor's counts, the
Once before load steps apart from the load, and how each data set was used. It never shows a
request or response body, an extracted value or a data set value. **Run again** repeats the newest
run while its script and data set files are unchanged. **Restore** brings a run's chains and steps
back into the plan, or into a new plan, without starting a run.

**Limits.** 20 chains, 50 steps per chain, 10 extractors and 10 checks per step, a 256 KiB body, 50
plans per session.

## 6. Run k6 Script

Choose **Run k6 Script** on the start screen (or its tab, once the tab bar is visible) to run a
k6 script you supply with the k6 installed on the backend machine. It needs no specification,
guided workflow or plan, and it never changes either of them.

**Uploading or writing a script.** **Upload script** takes one UTF-8 text file of at most 1 MiB.
**Write a new script** opens the editor on ApiPilot's example: one named request to
`BASE_URL`, one check, no credentials. Before a script is stored, ApiPilot checks it. A refused
script is not stored, and every reason is listed with its line and column. The check never runs
the script.

**What the check allows.** A script may import only `k6`, `k6/http`, `k6/metrics`,
`k6/execution`, `k6/encoding`, `k6/crypto`, `k6/data`, `k6/html` and `k6/timers`. It refuses:

- remote imports (for example `https://jslib.k6.io/…`): copy what you need into the script;
- imports of other files, `k6/x/…` extensions, `k6/experimental/…`, `k6/browser`,
  `k6/net/grpc`, `k6/ws`, `k6/websockets` and `k6/secrets`;
- `open()`, `require()`, dynamic `import()`, `import.meta`, `eval`, the `Function`
  constructor, `globalThis` and `Reflect`;
- reading `constructor`, `prototype`, `__proto__` or `getPrototypeOf`. The one allowed form is
  `Object.prototype.hasOwnProperty.call(object, key)`; `Object.hasOwn(object, key)` also works;
- reading a property by a key built at run time, such as `obj[key]` with a string `key`. Use a
  `Map` (`map.get(key)`), a `const` lookup table written as an object or array literal
  (`STATUS[key]`), or a numeric index (`data[i]`, `data[i | 0]`,
  `data[Math.floor(Math.random() * data.length)]`). Writing `obj[key] = value` and `__ENV[name]`
  are allowed;
- exporting `handleSummary`, which k6 uses to write files: ApiPilot produces the report instead.

**What the list shows.** Each script has its name, size, SHA-256, whether its current content is
confirmed, and its last run. Opening a script shows its content, the hosts written in it as
absolute URLs, and the environment values it reads through `__ENV`. Values built while the
script runs cannot be found, and the page says so.

**Confirming.** A script runs only after you confirm its exact content. The confirmation says
that ApiPilot did not write or verify the script, lists every host it found, says that hosts
built while the script runs cannot be listed, and states that ApiPilot cannot restrict where the
script sends requests. It is tied to the script's SHA-256: any change, whether **Replace with
upload** or a save in the editor, needs a new confirmation. Renaming keeps it.

**Run setup.**

- **Target environment.** The environments are the same set as the guided and quick paths, and
  they open as soon as you store a script.
- **Environment values the script receives.** Each name the script reads is mapped to the
  environment's base URL (`BASE_URL` by default) or to an environment value (the same name by
  default). You can change a source, remove a name, or add one the script builds at run time.
  Names may contain letters, digits and underscores, may not start with a digit, and may not
  start with `K6_` or be one k6 needs to start (`PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `HOME`,
  `TMPDIR`). Values are never shown: each row says whether the chosen environment has the value.
  A missing value does not block a run; the script receives nothing for that name. Values reach
  k6 only as its process environment for that run.
- **Load.** By default the script's own load settings are used. Choose a load profile to pass
  its stages to k6 as `--stage` options, which replace the script's own scenarios. A script with
  no default function cannot take a profile and runs with its own settings.
- **Thresholds set in ApiPilot (optional)** apply to the whole run or to one request name, and
  are evaluated from the measurements. They are never added to the script.

Changing the setup never changes the script, so the confirmation is kept.

**Running.** The trigger names the environment, its tier and base URL, repeats the hosts found
in the script, and says that load comes from the machine running the backend. A run starts only
when you press it, never after an upload, a confirmation or a restart. It shares the
one-run-at-a-time slot with every other run. While it runs you see elapsed time, virtual users,
requests and failures, and you can cancel it. If k6 cannot run the script (for example, an error
in its start-up code), the run fails and k6's message, at most 2,000 characters, is shown on the
run's page only. The script's `console` output is never kept or shown.

**The report** says the script was supplied by you and not generated by ApiPilot, with its name
and SHA-256. It covers:

- the environment, the k6 version and the load used;
- the mapped names and their sources, never their values;
- requests grouped by k6's request name: a request you did not name is shown by method, host
  and path without its query string, and beyond 100 names the rest are combined into "Other
  requests", with a note on naming requests;
- latency, failures as k6 counts them, statuses and request phases, for each name and over
  time;
- the hosts that received requests: k6 replaces a named request's URL with its name, so named
  requests are counted by the server address k6 connected to;
- the write requests sent;
- checks, groups and custom metrics;
- your thresholds, and k6's outcome for the thresholds the script defines (for the run as a
  whole);
- plain-language findings.

It downloads as one self-contained HTML file.

**Running a script ApiPilot generated.** Download a script from a guided or quick performance
plan and upload it here, changed or not. ApiPilot generates scripts that pass the check, and the
values they read (`APIPILOT_V_0`, …) are mapped automatically to the environment values they
stand for, with `baseUrl` mapped to the base URL. Run it against the same environment and no
mapping is needed. It is then your script: it needs your confirmation, and the report names it
as yours. Its requests have no names, so they are grouped by method, host and path.

**Scripts and runs are kept** in the local database, encrypted, and survive a backend restart
for as long as your session stays active. A run in progress when the backend stops is recorded
as cancelled and is not started again. Deleting a script keeps its past runs and reports; a
script with a run in progress cannot be deleted.

## 7. Sessions

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

## 8. AI behavior you should know about

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

## 9. Limitations to keep in mind

- Only a single OpenAPI 3.x YAML file is supported per workflow (max 10 MB). Swagger 2.0
  and JSON OpenAPI input are not supported.
- Only same-document `$ref`s are resolved; external references are reported as
  unresolved analysis issues, never fetched.
- Request-chain performance plans (section 5b) do not support multipart bodies or file uploads,
  extracting from XML or form responses, partial values (regular expressions) or computed values,
  conditional steps, loops or per-step retries. Runs recorded from the derived plans retired in
  version 19.19.0 can be opened under **Earlier runs** but not run again or restored.
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
- A plan created from a specification (section 5) starts from generated requests that no one
  reviewed, one single-step chain per operation, using each operation's full happy-path scenario
  only. Valid boundary variants and negative scenarios are not generated.
- Performance plans (section 5b) and Run k6 Script (section 6) need k6 1.0.0 or later that you
  install yourself. The run path has been checked against a real k6 (v2.3.0 on Windows,
  2026-10-03).
- Performance runs apply no limit and no warning on virtual users or duration, include write
  operations by default, and never clean up what they create. Load comes from the machine
  running the backend, so a heavy profile can be limited by that machine; the report shows it.
- Under load, each step checks its status, its extracted values and the checks you add, not
  response schemas.
- Run k6 Script (section 6) accepts a single file of allowed k6 modules in a strict subset of
  JavaScript: reading a property by a key built at run time is refused (use a `Map`), and test
  data files cannot be read. ApiPilot lists the hosts written in a script but cannot restrict
  where it sends requests; that, and what the script does, is your responsibility. A script
  that defines only named scenarios cannot take a load profile. Saving in ApiPilot's editor
  stores LF line endings. WebSocket, gRPC and browser tests are not supported.
- Each virtual user refreshes its own token before its stated lifetime ends, so a run sends
  one token request per virtual user per token lifetime. A token provider that rate-limits
  token requests, or revokes older tokens when it issues a new one, can make refreshes fail;
  the report shows this as failed refreshes and authentication failures.
- For an operation with both a rule-generated and an AI-enhanced positive scenario, a plan created
  from the guided workflow uses the rule-generated one, while the Postman collection's choice
  ignores the origin, so the two can send different requests for that operation.
- Creating a plan from a collection (section 5a) converts only a fixed set of script statements
  and runs no script. Pre-request scripts, conditional or computed statements, body assertions,
  `pm.sendRequest`, `pm.setNextRequest` and iteration data are listed in the seeding report, not
  converted. Requests with OAuth 2.0, Digest and other auth types, form-data, file or GraphQL
  bodies, or dynamic variables outside the supported list are left out.

## 10. Troubleshooting

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
| **Generate script** stays disabled | **Before you can run** lists a plan problem, such as a step with no expected status or a value used before any step extracts it, or the plan says **Not saved** | Choose **Show** to go to the problem, or fix the error shown under the plan's bar |
| Quick performance test: a new upload asks to replace the current one | A session has one quick test at a time | Confirm to replace it; plans created from it, runs and reports are kept |
| Performance report shows a step as "Missing data" | The chosen environment has no value for a name the step needs | Edit the environment's values; the plan check lists which are missing |
| Performance report shows many authentication failures | A token expired with no stated lifetime, or token refreshes failed | Check the report's token refresh section; a provider that revokes older tokens or rate-limits token requests needs fewer virtual users or longer-lived tokens |
| Run k6 Script: "Imports a module from a URL" | The script imports from `https://…`, such as jslib.k6.io | Copy the helper you need into the script; remote code is never loaded |
| Run k6 Script: "Reads a property by a key built at run time" | The script reads `obj[key]` with a string key | Use a `Map` (`map.get(key)`), a `const` lookup table, or a numeric index; see section 6 |
| Run k6 Script: "Exports `handleSummary`" | k6 would write the summary to files | Remove `handleSummary`; ApiPilot's report covers the run |
| Run k6 Script: the load profile option is disabled | The script has no default function, only named scenarios | It runs with its own load settings; add a default function to use a profile |
| Run k6 Script: the run trigger says the script has not been confirmed | The content changed (a save or a replacement upload) since it was confirmed | Choose **Review and confirm**; any change needs a new confirmation |
| Run k6 Script: a name cannot be mapped | It starts with `K6_`, is a name k6 needs to start, or has other characters | Read the value under another name in the script |
| Run k6 Script: a run failed with k6's message | An error in the script's start-up code, or k6 refused its options | Read the message on the run's page, fix the script, confirm it again, and run |
| Failure analysis says "Not enough evidence to name a likely cause" | No rule matched the recorded result, for example a 404 or a 500 with no recorded body | Check the evidence shown yourself; a Local-tier run records request and response excerpts, which let more rules apply |

## 11. Where to look next

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
