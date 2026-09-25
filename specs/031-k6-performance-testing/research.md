# Research: k6 Performance Testing (AP-029)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-24

This records each design decision with its rationale and the alternatives rejected. Facts about
the existing code were taken from the repository on 2026-09-24. Facts about k6 are k6's documented
behaviour, and the opt-in real-k6 test (quickstart scenario 9) verifies them before the feature is
recorded as Implemented.

## D1. Where the feature lives: a new optional last stage of the guided workflow

**Decision**: Add a `performanceTesting` stage to `WORKFLOW_STAGE_ORDER`
(`packages/shared-domain/src/testGenerationWorkflow.ts`), after `execution`.
- It becomes available once `workflowReview` is completed. Neither `postmanGeneration` nor
  `execution` is a prerequisite.
- It is optional. Like `execution`, it may be `skipped`, and it never blocks the workflow from
  being complete.
- Upstream changes (a re-finalized scenario review or workflow review) mark it stale through the
  existing `staleness.ts` mechanism. That is also how the script becomes out of date (FR-023).

**Rationale**: The spec builds on the approved test model and workflows, which live only in the
guided workflow's state (`approvedTestModel`, `approvedWorkflowIds`). A stage gets the stage
tracker, stale marking and session scoping for free.

**Alternatives rejected**:
- A new top-level tab like Import & Run Collection. It would have to reach into workflow state
  without the stage machinery.
- Placing it before `execution`. `execution` hands off to Import & Run Collection, and putting
  performance first would make a functional run wait behind an optional stage.
- Using uploaded collections as a source. That is excluded by the spec's Assumptions.

## D2. Module boundaries

**Decision**: A new `backend/src/performance/` module with four sub-areas:

| Area | Contents | Pure? |
|---|---|---|
| `plan/` | Scenario selection, journey building, reorder validation, user-supplied value listing, unique-value rules, load profiles | Yes |
| `k6/` | Script and environment-template rendering, readiness probe, process runner, metrics-stream parsing | Rendering and parsing are pure; the probe and runner are the only I/O |
| `report/` | Aggregation, threshold evaluation, findings rules, HTML rendering | Yes |
| `store/` | Performance run store and repository | No (persistence) |

Plus one router, `backend/src/api/performanceTesting.ts`. Shared types go in
`packages/shared-domain/src/performance.ts`, and are framework- and k6-agnostic. Only `k6/` knows
k6 syntax, options, CLI flags or output formats (constitution VIII, IX).

**Rationale**: This mirrors the Postman boundary. Everything except the process runner and the
repository is testable with no binary and no database (XXI).

## D3. Reuse of existing generation code

**Decision**:
- **Reused as is:**
  - `postman/parameterSerialization.ts`, already documented as pure functions only (FR-011);
  - the AP-021/023/024 auth planning: `planSchemeVariables`, `findCredentialProducers`,
    `buildAuthCredentialRelationships` and `mapOperationAuth`;
  - the scenario's own status assertions from `testDesign/assertions.ts` (FR-012);
  - `IntegrationWorkflow` step positions and variables, for journey order;
  - `identifiers.ts`'s content-derived ids.
- **Not reused:** the Postman renderers (`requestItem`, `oauth2TokenFetch`,
  `assertionScripts`). They emit Postman items and `pm.*` scripts, so `k6/` renders its own.
- **Only change to `backend/src/postman/`:** export the planning functions above, if any is not
  already exported. No behaviour changes.

**Rationale**: The same serialization and auth planning are what make "a k6 request matches its
Postman equivalent" true. The renderers are format-specific by nature.

**Alternatives rejected**: Converting the generated Postman collection into k6 (a
Postman-to-k6 translation). It would inherit Postman's `pm.*` semantics and make k6 output depend
on an unrelated renderer.

## D4. Scenario selection (FR-002, FR-003)

**Decision**: Take the accepted scenarios in `approvedTestModel` whose `category` is `positive`.
Prefer `provenance.source === "RULE"` over `"AI"`, then the lowest `id` by code-unit comparison
(never `localeCompare`; see `postman/ordering.ts`). Record the reason as `rule-generated`,
`only-positive` or `ai-enhanced-no-rule-alternative`, plus a tie-break note when one was used.

**Known divergence**: Postman's `selectScenario` (`workflowRendering.ts:75-90`) prefers positive,
then the smallest id, and ignores `RULE` versus `AI`. For an operation with both a rule-generated
and an AI-enhanced positive scenario, k6 and Postman can therefore send different requests. This
follows FR-003 as written. FR-011's "matches its Postman equivalent" is read as "the same
scenario is serialized the same way".

**Resolution (2026-09-25)**: FR-003 is kept, and FR-011 now says "for the same scenario". Amending
FR-003 to Postman's rule was rejected: the choice between a rule-generated and an AI-enhanced
scenario would then depend on UUID order, and the recorded reason would explain nothing. Changing
Postman to FR-003's rule is the intended end state, but it alters a shipped contract
(`specs/016-workflow-aware-postman/contracts/workflow-aware-postman-api.md`) and the producer
choice in `automaticChaining.ts`, so it is a separate follow-up (ROADMAP Next Actions #30). The k6
`selectScenario.ts` is written with no k6-specific dependencies so that follow-up can reuse it.

**Determinism note**: scenario ids are `randomUUID()` when generated
(`testDesign/scenario.ts:23`). The choice is therefore stable for a given approved test model, and
so is the script for a given plan (SC-001). Regenerating scenarios from scratch can change the
tie-break, which is the same as for Postman.

## D5. Journeys and reorder validation (FR-006, FR-007)

**Decision**:
- **Building the journeys:**
  - Each approved workflow (`approvedWorkflowIds`, in id order) becomes one journey, with its steps
    in `position` order.
  - Each operation in scope that appears in no approved workflow becomes a single-step journey.
  - Single-step journeys are ordered by method then path, by code-unit comparison.
  - An operation used in two workflows appears in both journeys.
- **Reorder validation:** a pure function. A proposed step order is valid only if every
  `WorkflowVariable`'s producer index stays before each of its consumers. Credential chains
  (AP-023, consumer location `auth`) count too. Journey reordering is always valid, because
  journeys are independent.
- **A rejected reorder** returns the first broken variable by the workflow's variable order, and
  the plan is unchanged.

**Rationale**: It is the same dependency data Postman uses, validated rather than re-derived
(XV).

## D6. User-supplied values (FR-013, FR-014; clarification 2026-09-24)

**Decision**:
- **Which values the plan lists:** every variable the specification cannot produce, derived from
  the same sources that give Postman its limitations:
  - unresolved path parameters (`pathParameterVariableName`);
  - scheme credentials (`planSchemeVariables`);
  - OAuth2 `clientId`/`clientSecret`;
  - the `baseUrl`.
- **What the plan records:** only each value's name, the steps that need it, and whether it is
  secret. A value is secret when it is a credential variable.
- **Where the values live:** they are the target environment's `variableValues`, already
  encrypted by AP-025. Presence is computed per environment at read time and returned as a
  boolean; the value itself is never returned.
- **Missing values:** the script carries the dependency logic.
  - A step whose required value is absent from the run's environment records a `missing-data`
    point and sends nothing.
  - Its dependants record `dependency-not-attempted`.
  - This happens inside one byte-identical script, so presence never changes the script
    (FR-020).

**Rationale**: No new secret store, and environments already have per-environment values (spec
Clarifications).

## D7. How values reach k6: process environment, never argv or the script (FR-021)

**Decision**:
- **Inputs:** the runner passes the base URL and each present variable value to the k6 child
  through its environment, as `APIPILOT_V_<index>` with a fixed index per variable name. The
  script reads `__ENV.APIPILOT_V_<index>`.
- **Mapping:** the name-to-index map is part of the script, and names alone are not secret. No
  value is ever passed with `-e` or `--env`, because command lines are visible to other processes.
- **What the child inherits:** only `PATH`, `SystemRoot`/`TEMP`/`TMP` (Windows) and `HOME`/`TMPDIR`
  (POSIX), plus these variables. The backend's own environment, including `.env` values, is not
  passed on.

**Trade-off (XXX)**: on some platforms, other processes of the same OS user can read a process's
environment. That is the local machine's own trust boundary, and it is recorded, not mitigated
further.

## D8. Only the unmodified generated script runs (FR-026)

**Decision**:
- **When generating:** the plan fingerprint and the script's SHA-256 are stored with the script in
  workflow state.
- **When starting a run:**
  - The router refuses with `script_out_of_date` if the current plan's fingerprint differs.
  - Otherwise the runner writes the stored script to a new run directory, re-reads the file, and
    compares its SHA-256 before spawning. A mismatch aborts the run with `script_integrity_failed`.
- **No input path:** no endpoint accepts script content.
- **Imports:** the generated script imports only k6 built-in modules (`k6`, `k6/http`,
  `k6/metrics`). A unit test rejects any other import, including URLs, because k6 can import
  modules from the network.

## D9. Finding and checking k6 (FR-027)

**Decision**:
- **Finding the binary:** from the new optional `K6_BINARY_PATH` setting, or else the first `k6`
  (`k6.exe` on Windows) on `PATH`. ApiPilot never downloads or installs it.
- **Probe:** `execFile(binary, ["version"])` with no shell, a 5-second timeout and an ignored
  stdin. It parses `k6 vX.Y.Z` and requires at least 1.0.0, the first major release with k6's
  stability commitment.
- **Readiness:** `{state: "ready", version}` or `{state: "unavailable", reason}`. The reasons are
  `not-found`, `not-executable`, `version-unreadable` and `unsupported-version (found X, need
  ≥ 1.0.0)`.
- **When the probe runs:** on first request, and again when the user asks for a re-check and just
  before each run. The result is cached briefly. It follows the AI readiness pattern
  (`ai/readiness.ts`): explicit states, a reason, and no automatic retry loop.

**Alternatives rejected**: bundling k6 or downloading it on demand. The constitution v2.3.0
exception forbids both.

## D10. The k6 invocation and local-only output (FR-033)

**Decision**:
- **Invocation:** `spawn(binary, ["run", "--no-usage-report", "--quiet", "--no-color",
  "--out", "json=<runDir>/metrics.ndjson", "<runDir>/script.js"], {shell: false, cwd: runDir,
  env: <D7>})`.
- **Usage report:** `--no-usage-report` is mandatory. k6 sends anonymous usage statistics to its
  vendor by default, which would break "results stay on the local machine".
- **Cloud output:** no `cloud` output or command is ever used.
- **Test:** a unit test pins the argument list.

## D11. Live progress and results: stream the JSON output and aggregate as it arrives

**Decision**: The runner tails `metrics.ndjson` while k6 writes it, and parses one line at a time
into an in-memory aggregate:
- `http_reqs` points by `step` tag give request counts and status classes.
- `http_req_duration` points give latency.
- `vus` points give current virtual users.
- `checks`, plus custom counters (`apipilot_missing_data`, `apipilot_cut_short`,
  `apipilot_not_attempted`, `apipilot_token_refresh`), give the rest.

Progress (FR-030) is read from the aggregate: elapsed time against planned duration, current
virtual users and requests so far. The file is deleted when the run settles, and on startup any
leftover run directories are removed.

- **No URLs in the output:** the script sets `systemTags` to exclude `url` and `name`, and tags
  each request with a `step` id. So the metrics stream never contains a resolved URL, and with it
  any secret in a query string (FR-040, FR-042).
- **Percentiles:** latency goes into a fixed log-linear histogram with at most 1% relative error.
  p50, p90, p95 and p99 are read from it deterministically, and the report says "within 1%".
  Memory stays constant however long the run is (a spec edge case).
- **Timeline:** buckets of `max(5 s, planned duration / 200)`, so a report has at most about 200
  points per series.

**Alternatives rejected**:
- k6's end-of-test summary (`handleSummary`). It only covers the whole run, with no timeline, and
  per-step percentiles would need threshold tricks.
- k6's local REST API for live metrics. It gives cumulative figures only, with no per-interval
  latency, and adds a listening port.
- Keeping every duration. Memory would grow with the request count.

## D12. Token lifetime and refresh (FR-015): per-virtual-user refresh (FR-015 amended 2026-09-25)

**Finding**: k6 virtual users do not share mutable memory. `setup()` runs once, and its return
value is copied read-only into each virtual user. Stock k6 has no way to refresh one token and
have all virtual users use the new value; that needs extensions, which the "user-installed k6,
never bundled" condition rules out.

FR-015's original "a new token … shared by the virtual users as the first one was" therefore
could not be implemented as written. FR-015 was amended on 2026-09-25 to the decision below.

**Decision (confirmed 2026-09-25)**:
- **The first token:** acquired once in `setup()` and shared, as FR-009 says.
- **Refresh:** when the token response states `expires_in` (seconds, RFC 6749), each virtual user
  refreshes its own copy through the same producer.
  - It refreshes at a fixed fraction of the stated lifetime, measured from when that virtual
    user's current token was acquired. The fraction is `0.70 + 0.01 × ((__VU − 1) mod 11)`, so it
    runs from 70% to 80% in 1% steps.
  - Why the offset: every virtual user starts with the token from `setup()`, so a single fraction
    would make all of them refresh at the same moment. That burst can trip a producer's rate
    limit. Deriving the offset from the virtual-user number spreads the burst over 10% of the
    lifetime and keeps it identical across re-runs, like FR-016's unique values. No randomness is
    used.
  - A refresh request carries no `step` tag, only `apipilot_kind: token-refresh`. The aggregate
    in D11 groups requests and latency by `step`, so refreshes never enter a step's figures.
  - Each refresh is counted in `apipilot_token_refresh`, and the report shows the count and the
    times, bucketed.
  - A virtual user whose refresh fails keeps its old token. Its later requests fail as
    authentication errors, and the refresh failure is counted.
- **No stated lifetime:** the token is not refreshed. The report says the lifetime was not stated,
  and failures after expiry show up as authentication errors (FR-015, second half).
- **Source of the lifetime:** only `expires_in` is read, not a JWT `exp` claim. That is "stated by
  the producer's response" in the plainest sense.

**Consequence**: a run with many virtual users sends one token request per virtual user per
lifetime, not one in total. The report makes that visible, and the spec's Assumptions state the
cost.

**Known risk**: a producer that revokes a client's earlier token when it issues a new one, or caps
concurrent sessions per user, lets one virtual user's refresh invalidate the tokens of the others.
ApiPilot cannot detect this in advance. It shows up in the report as authentication errors after
the first refreshes.

**Alternatives rejected**: never refreshing, or fetching several tokens in `setup()`, both fail
SC-013 (tokens fetched together expire together). Serving the current token from the ApiPilot
backend would keep one producer request in total, but the script would then depend on ApiPilot
running, expose a local token endpoint, and add polling requests to the load. Sharing through an
extension or an external store such as Redis conflicts with the user-installed, unbundled k6 and
adds infrastructure.

## D13. Unique body values (FR-016)

**Decision**:
- **Which fields:** string fields with `format: email` or `format: uuid` in POST request bodies.
  The plan lists each such field.
- **Email:** the local part gets `+vu<N>-it<M>`, using k6's `__VU` and `__ITER`.
- **UUID:** replaced by a deterministic, UUID-shaped value from the same two numbers.
- **Everything else:** sent as the scenario defines it.

**Rationale**: OpenAPI has no uniqueness keyword. These two formats are the common cases, and
guessing further, for example from field names, would be a silent assumption (XIV).

## D14. Checks and failure categories (FR-010, FR-012)

**Decision**:
- **Status check:** the scenario's documented status assertion only. Schema-conformance
  assertions are not run under load, because validating schemas in every virtual user distorts the
  latency being measured; the plan says so.
- **Extraction check:** each extraction is checked as present and non-empty.
- **Failure categories** in the result (data-model.md):
  - `unexpected-status`
  - `connection-error` (status 0 with a k6 error code)
  - `timeout`
  - `extraction-failed`
  - `missing-data`
  - `dependency-not-attempted`
  - `authentication` (401 or 403)
  - `rate-limited` (429)

## D15. Thresholds are evaluated by ApiPilot, not by k6 (FR-018, FR-037)

**Decision**: Thresholds (p50, p90, p95 or p99 latency in ms, or error rate in %, for the whole
run or for one step) are stored in the plan. They are evaluated from the aggregate after the run,
and are not written as k6 `thresholds`. So they never abort a run, and the verdict in the report
is computed from the same numbers the report shows. With no thresholds, the report says none were
set (FR-037).

## D16. Findings rules (FR-038)

**Decision**: A versioned rule set (`PERFORMANCE_FINDINGS_RULESET_VERSION = 1`), with each rule
pure over the aggregate and applied in this fixed order:

1. `threshold-failed`: each failed threshold.
2. `slowest-step`: the step with the highest p95, with its value.
3. `failures-start`: the earliest timeline bucket with a non-zero error rate, and the step with
   the most errors in it.
4. `cut-short-iterations`: the count of iterations cut short by a failed extraction, and the step.
5. `missing-data`: the steps skipped for missing data, with the variable names.
6. `rate-limited`: when there are any 429 responses, with the count and the first bucket.
7. `authentication-after-expiry`: authentication errors after the first token's lifetime passed,
   or with no stated lifetime.
8. `connection-errors`: when there are any, with the count.
9. `refreshes`: the token refresh count, when above 0.

Ties are broken by step order. A rule that does not apply produces nothing. No rule makes a claim
about the API's quality beyond the measurement.

## D17. The report: one deterministic HTML renderer, shown in a sandboxed frame (FR-035 to FR-040)

**Decision**: `report/renderHtmlReport.ts` builds a complete HTML document from the stored
result:
- inline CSS, with light and dark styles through `prefers-color-scheme`;
- charts as inline SVG, computed on the server, with no JavaScript;
- a `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src
  'unsafe-inline'; img-src data:">`, so it cannot load anything;
- HTML escaping of every string, since path templates come from an uploaded specification.

The UI shows it in an `<iframe sandbox srcdoc>` with no permissions, plus a download button. The
same bytes are served for the download, so what is shown is what is downloaded. The HTML is
rendered on request from the stored result, not stored, and it is deterministic for a given
result.

**Trade-off (XXXIII)**: the report uses its own inline styling, not the app's Tailwind tokens,
because it must work as a standalone file. It uses the same colour roles and text labels for
status.

## D18. The execution slot, session lifetime and restart (FR-029, FR-032, FR-034, FR-034a)

**Decision**:
- **The slot:** add `getPerformanceInProgressRun()` to the two existing inline checks
  (`testGenerationWorkflow.ts:754-761`, `externalCollections.ts:426-435`). The new start route
  checks all three. The check and the insert stay synchronous, with no `await` between them, as
  today.
- **Session keep-alive:** while a run is in progress, the runner calls the session registry's
  `touch(sessionId)` on each progress tick (at most every 5 s). So the idle timeout cannot pass
  during a run, and it restarts from the last tick, at the run's end (FR-034a). There is no new
  mechanism in the registry.
- **Restart:** a new `performance_runs` table gets the same statement as the other run tables:
  `UPDATE … SET status='cancelled', cancel_reason='backend-restart' WHERE status='in-progress'`,
  called from `server.ts` before `listen`. Its `deleteBySession` is registered as an `onExpire`
  listener.
- **Orphaned k6 after a crash (XXX):** if the backend process dies, its k6 child can keep
  running until its own stages end. The script's total duration bounds it, and nothing restarts
  it. Killing a recorded PID at startup was rejected, because the PID may belong to another
  process by then.

## D19. Cancellation (FR-031, SC-008)

**Decision**:
- **POSIX:** send `SIGINT`, which k6 treats as a graceful stop, then `SIGKILL` after 5 s.
- **Windows:** `taskkill /T /F` on the child tree, because no graceful console signal can be sent
  to a detached child.

In both cases everything already streamed is in the aggregate, so partial results are kept. The
run settles `cancelled`, with the reason `user-requested`.

## D20. Storage: `performance_runs`

**Decision**:
- **Table:** one new, session-owned table: `id`, `session_id`, `status`, `cancel_reason`,
  `environment_snapshot` (name, tier and base URL only, as JSON), `plan_snapshot` (the plan,
  which holds no values, as JSON), `script_sha256`, `k6_version`, `planned_duration_ms`,
  `started_at`, `ended_at`, `result` (the aggregate as JSON, written at settle and at checkpoints)
  and `error`.
- **Encryption:** none. Nothing stored is secret: no values, bodies or URLs. This matches
  `execution_runs.results`.
- **Script:** not stored in the table. The hash identifies it, and it stays in workflow state.

## D21. API shape

**Decision**: Routes under `/api/test-generation-workflow/performance/` (contract in
[contracts/performance-api.md](./contracts/performance-api.md)), matching the existing
`/execution/...` routes:
- inline errors of the form `{error: snake_code, message}`;
- fire-and-poll runs;
- `202` for cancel.

Downloads are `text/javascript`, `application/json` and `text/html`, each with
`Content-Disposition: attachment`.

## D22. Configuration

**Decision**: One new optional variable, `K6_BINARY_PATH`, documented in `.env.example` and the
README. Run directories go under `os.tmpdir()/apipilot-k6/<runId>`, created with mode 0700 where
the platform supports it. There is no working-directory setting.

## D23. Logging (XX, FR-042)

**Decision**: The events are:

| Event | Fields |
|---|---|
| `performance_plan_built` | journey count, step count |
| `performance_script_generated` | first 12 characters of the SHA-256, step count |
| `k6_readiness` | state, version or reason |
| `performance_run_started` | run id, environment tier, step count, planned duration |
| `performance_run_settled` | run id, status, cancel reason, request count, duration |
| `performance_run_failed` | run id, error category |

No event carries a URL, variable name, value, body, token or k6 output text. k6's stderr is
counted and summarized by category, never logged verbatim.

## D24. Testing

**Decision**:
- **Unit:**
  - plan building, selection, reorder validation, value listing and unique-value rules;
  - script rendering: golden file, byte-identical twice, a secret scan with seeded values, an
    import allow-list, and `systemTags`;
  - NDJSON parsing and aggregation from recorded fixture streams;
  - the histogram's percentiles against exact values;
  - findings rules;
  - the HTML renderer: escaping, a CSP present, no external references, deterministic;
  - readiness parsing;
  - the argument list.
- **Integration:** the routes use an injected fake runner, which replays a fixture NDJSON stream
  on a clock. They cover the slot, out-of-date refusal, cancellation, restart marking, session
  keep-alive, and report download.
- **Opt-in:** `npm run test:k6-real -w backend` (`K6_TEST_REAL=1`) runs the real binary against a
  local stub server, and checks the version gate, the no-usage-report flag, the JSON stream shape,
  graceful cancel, and per-virtual-user token refresh. It is never part of `npm test`.
