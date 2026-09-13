# ApiPilot User Manual

This manual is for the person operating ApiPilot day to day — typically a QA or API
engineer — to turn an OpenAPI specification into a reviewed, exportable, and runnable
test suite. For setup, environment variables, and internal architecture, see the
[README](../README.md) and the [architecture reference](architecture.md); this manual
covers what you see and do on screen.

## 1. What ApiPilot does

You upload one OpenAPI 3.x YAML file. ApiPilot analyzes it, generates a baseline set of
test scenarios deterministically (the same input always produces the same scenarios),
optionally proposes additional scenarios using a locally running AI model, and lets you
review and approve everything before anything is exported or executed. Approved scenarios
become a Postman collection, which you can then run yourself against an environment you
define, with results reported back in the same screen.

Nothing is ever sent to a cloud AI service, and no request is made against the API
described by your specification until you explicitly start an execution run.

## 2. Starting ApiPilot

Follow the [Quick start](../README.md#quick-start) section of the README to install
dependencies and run `npm run dev`. Once running:

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:4000/api/health`

The header shows a live connection indicator — **Connecting…**, **Connected**, or
**Disconnected** — so you always know whether the browser can reach the backend.

## 3. The guided workflow

ApiPilot has a single entry point: the guided workflow. There are no other screens or
routes — every step below is reached in this fixed order, and a completed step can be
revisited read-only (or, for the two review stages, reopened) by clicking its chip in the
stage tracker at the top of the page.

```text
Upload → Analysis → API Review → Deterministic Generation → AI Enhancement
  → Scenario Review → Dependency Analysis → Workflow Review → Postman Generation
  → Run & Results
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
before test generation runs. Click **Continue** to proceed.

### 3.4 Deterministic Generation

Click **Generate Baseline Test Suite**. ApiPilot produces, for every operation, a
positive scenario and a set of rule-based negative/boundary scenarios. These never
depend on AI and are fully reproducible from the same spec. The categories are:

| Category | What it tests |
|---|---|
| `positive` | A valid request that should succeed |
| `missing-field` | A required field omitted |
| `null-value` | A field explicitly set to `null` |
| `empty-value` | A field set to an empty string/array |
| `invalid-type` | A field given the wrong JSON type |
| `invalid-format` | A field violating its declared format (e.g. not a valid date) |
| `invalid-enum` | A field set to a value outside its enum |
| `numeric-boundary` | A number just below/above its min/max |
| `string-boundary` | A string just below/above its min/max length |
| `array-boundary` | An array just below/above its min/max item count |

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
  history.

Actions available:

| Action | Where | Notes |
|---|---|---|
| Accept | Per-scenario or bulk | Bulk actions apply to all filtered rows or your manual selection, with a confirmation dialog showing the affected count |
| Reject | Per-scenario or bulk | Requires a free-text reason; bulk reject requires one shared justification |
| Edit | Per-scenario | Edits the request body JSON directly; invalid JSON is rejected inline and the last valid version is kept; an edited scenario is marked "User-modified" |
| Regenerate with AI | Per-scenario, AI-derived only | Replaces the scenario with a new AI candidate, or reports a failure — it never silently approves anything |

When you're done, click **Finalize Review**:

- If any scenarios are still pending, you'll be warned they'll be excluded from
  everything downstream.
- If zero scenarios are accepted, finalizing is blocked — you must accept at least one.
- Finalizing triggers dependency analysis automatically (this can take a couple of
  minutes on larger specs).

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
rejecting it means only the individual scenarios (if separately accepted) are exported.

### 3.9 Postman Generation

Optionally enter a base address, then click **Generate Postman Collection**. On success
you get:

- **A Postman collection** — one request per accepted single-operation scenario, plus
  one ordered request sequence per *approved* workflow (with response values wired into
  variables consumed by later steps), organized into folders by the spec's tags.
- **An environment file** listing every variable the collection references (base URL,
  credentials/identifiers), left empty for you to fill in — no real secrets are ever
  written into the collection.
- **A README** describing the request count, folder layout, how to run the collection,
  and a list of known limitations for this export (e.g., scenarios with no expected
  outcome, unsupported auth schemes, or workflows that couldn't be faithfully rendered).

All three files are downloadable from this screen. If generation fails validation, you
get an explicit error and a list of the specific problems — never a silently broken
file.

### 3.10 Run & Results

Once a Postman collection exists, a **Run & Results** panel appears below the stage
tracker (this isn't a numbered stage — it stays available for the rest of the session).

**Define an environment** the first time you use it: name, risk tier (Local / Dev / QA /
Staging / Production), base URL, an optional delay between requests in milliseconds, and
any variables the collection needs (e.g., an auth token). If you have more than one
environment, pick one explicitly from the dropdown — none is pre-selected.

Click **Run**. If the selected environment is tagged Staging or Production, or the
collection includes any destructive request (POST/PUT/PATCH/DELETE), you'll see a
confirmation banner naming the tier and every destructive request involved — you must
confirm before it proceeds. Requests then run one at a time (respecting your configured
delay), never in parallel.

While running, you see a live summary (status, tier, passed/failed/not-attempted
counts) and a **Cancel run** button. Each request's row shows an outcome:

| Outcome | Meaning |
|---|---|
| Passed | Every assertion for this request succeeded |
| Assertion failed | The request completed but one or more assertions didn't match |
| Unexpected status code | The response status wasn't one ApiPilot expected |
| Connectivity failure | The request could not reach the target at all |
| Timed out | No response within the allotted time |
| Could not be evaluated | An assertion couldn't be checked (e.g., malformed response) |
| Cancelled / Dependency not met / Run ended before this request | The run was stopped, or an earlier required step in a workflow didn't succeed |

Expand a row to see duration, the response status code, and each assertion's individual
result. Raw request/response bodies and credential values are never shown. Use **Show
failures only** to filter the list. Past runs from this session are listed below and can
be reopened for review without re-running them.

## 4. Sessions

ApiPilot has no login. Each browser is assigned its own private session automatically (a
random cookie), so two people working from different browsers never see or affect each
other's uploads, reviews, or runs. Reloading the page, or opening a second tab in the
*same* browser, resumes the same in-progress workflow. If a session sits idle for more
than 60 minutes, its workflow is discarded and the next visit shows an explicit
"session expired" notice rather than silently starting over.

Nothing is stored durably: workflows, environments, and run history all live in memory
and are lost if the backend restarts.

## 5. AI behavior you should know about

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

## 6. Limitations to keep in mind

- Only a single OpenAPI 3.x YAML file is supported per workflow (max 10 MB). Swagger 2.0
  and JSON OpenAPI input are not supported.
- Only same-document `$ref`s are resolved; external references are reported as
  unresolved analysis issues, never fetched.
- Execution always requires you to explicitly click Run — there is no scheduled,
  unattended, or CI-triggered execution mode.
- "Destructive" request warnings are based on HTTP method only (POST/PUT/PATCH/DELETE),
  not per-operation semantics — review the confirmation banner's request list yourself
  before confirming a Staging/Production run.
- AI-assisted analysis of *why* an execution failed (as opposed to reporting that it
  failed) is not part of the current product.

## 7. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Upload rejected immediately | File isn't `.yaml`/`.yml`, or exceeds 10 MB | Check the extension and file size |
| "Invalid YAML" / "Unsupported version" error | File isn't valid YAML, or isn't OpenAPI 3.x | Validate the file locally; Swagger 2.0 must be converted to OpenAPI 3.x first |
| Analysis issues listed after upload | Spec has unresolved/external `$ref`s, circular references, or unsupported constructs | Review the listed locations; generation still proceeds but treat affected operations' tests with caution |
| "Enhance with AI" stays on "Preparing the local model" a long time | First run needs to download/load the model | Wait for first-run provisioning to finish (see README AI setup); subsequent runs are faster |
| AI Enhancement ends "Partially completed" | Spec has more operations than fit the run's time budget | Use the per-batch **Retry batch N** buttons, or **Retry AI enhancement** if retryable |
| "Finalize Review" is blocked | No scenarios have been accepted yet | Accept at least one scenario before finalizing |
| Postman generation fails | Approved scenarios/workflows contain unresolved data ApiPilot cannot faithfully render | Read the listed validation problems and address them in Scenario/Workflow Review, then regenerate |
| Confirmation banner appears before Run | Target environment is Staging/Production, or the collection includes destructive requests | Review the named requests, then confirm explicitly if intended |
| "Your previous session expired due to inactivity" | Session was idle over 60 minutes | Start a new upload; prior workflow state cannot be recovered |
| Everything reset after a backend restart | Workflow/session/run history are in-memory only by design | Re-run the workflow from Upload |

## 8. Where to look next

- [README](../README.md) — installation, configuration, AI model selection, and full
  scope/limitations.
- [Architecture reference](architecture.md) — internal system design.
- [specs/ROADMAP.md](../specs/ROADMAP.md) — feature status and what's planned next.
- Individual `specs/<feature>/spec.md` files — the normative requirements behind any
  behavior described in this manual.
