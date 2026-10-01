---

description: "Task list for AP-034 Run a User-Supplied k6 Script"
---

# Tasks: Run a User-Supplied k6 Script (AP-034)

**Input**: Design documents from `specs/034-run-user-k6-script/`

**Prerequisites**:
- [plan.md](./plan.md)
- [spec.md](./spec.md)
- [research.md](./research.md) (R1 to R23)
- [data-model.md](./data-model.md)
- [contracts/user-scripts-api.md](./contracts/user-scripts-api.md)
- [contracts/changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md)
- [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution XXI and XXXI make automated tests part of done, and research R21
defines the test plan. Write each story's tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story (spec.md US1 to US3), so each story can be built
and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (a different file, and no dependency on an incomplete task).
- **[Story]**: the user story the task belongs to (US1 to US3).
- Paths are relative to the repository root. Workspaces are `backend/`, `frontend/` and
  `packages/shared-domain/`.

## Standing rules for every task

- **Commits.** Do not commit. The user reviews the diff and commits it.
- **Scope.**
  - No AI anywhere in this feature (FR-037).
  - The only new dependency is `acorn` (backend runtime).
  - No new environment variable.
- **Never execute the script.** Script content is never evaluated, previewed, logged or sent
  anywhere, in the backend or the frontend (FR-011, FR-039). The check only parses.
- **Never log:**
  - script content, script names, hosts or mapped names;
  - k6 messages, console output or environment values;
  - request names or URLs.

  Logs carry ids, counts, sizes, rule ids, categories and 12-character SHA-256 prefixes.
- **Ordering.** Never use `localeCompare`; use `compareCodeUnits` from
  `backend/src/postman/ordering.ts`. The same bytes give the same check (FR-008), and the same run
  data gives the same findings and report (FR-036).
- **Generated runs are unchanged.** `buildK6Args`, `buildChildEnv` and `renderHtmlReport` output
  for AP-029 and AP-032 stay unchanged. The one intended change to generated runs is the script
  template in T018 (AP-029 FR-022a, research R23); it keeps behaviour, tags and metrics. Their existing tests must keep passing after every
  foundational task.
- **Encryption.** Encrypt with `backend/src/persistence/credentialCipher.ts`. Never store script
  content, derived hosts, run snapshots, results or k6 messages in plain text (research R7, R9).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The dependency, and the fixtures that several stories' tests and the quickstart need.

- [ ] T001 Add `acorn` ^8 to `backend/package.json` dependencies with `npm install acorn -w backend`, which also updates `package-lock.json`. Confirm it is MIT-licensed and has no runtime dependencies (research R1).
- [ ] T002 [P] Create the accepted corpus in `backend/tests/fixtures/userScripts/accepted/`. Each file uses only allowlisted imports and the patterns R3 must accept:
  - `basic.js`: reads `__ENV.BASE_URL` and `__ENV.API_KEY`; sends named GET, POST and DELETE requests to `${__ENV.BASE_URL}`; has `check`, `group`, a custom `Trend`, `Counter`, `Rate` and `Gauge`, `options.thresholds` on `http_req_duration`, and a default function.
  - `loops-and-indexes.js`: covers each of these index forms:
    - `for (let i = 0; i < n; i++) data[i]`;
    - `data[Math.floor(Math.random() * data.length)]`;
    - `users[(__VU - 1) % users.length]`;
    - `data[i | 0]`;
    - `__ENV[name]` with a run-time key;
    - `SharedArray` from `k6/data` with inline data.
  - `scenarios-only.js`: named scenarios with `exec` functions and no default function.
  - `unnamed-urls.js`: unnamed requests with ids, user info and query strings in their URLs; more than 100 distinct URLs; `console.log(__ENV.API_KEY)`; and one literal `https://api.example.test:8443/x` host.
  - `class-and-objects.js`: a class with a `constructor()` method, and an object literal with a `prototype` key (both allowed by R3 rule 3).
  - `lookup-tables.js`: covers R3 rule 4's allowances:
    - `const STATUS = { ok: 200 }; STATUS[name]` and `const LIST = ["a"]; LIST[key]` with string keys;
    - computed writes `headers[name] = value` and `a.b[k] = v`;
    - `Object.prototype.hasOwnProperty.call(obj, k)`;
    - `Object.hasOwn(obj, k)`;
    - `new Map()` with `.get(k)`.
- [ ] T003 [P] Create the refused corpus in `backend/tests/fixtures/userScripts/refused/`: at least 25 files, each breaking exactly one rule. Add `refused/expected.json` mapping each file name to `{ rule, line }`. Cover at least:
  - **Parsing:** a parse error; a CommonJS file using `require`.
  - **Imports:** a remote `https://jslib.k6.io` import; `./lib.js`, `/abs/lib.js` and `file:` imports; `k6/x/sql`; `k6/experimental/fs`; `k6/browser`; `k6/net/grpc`; `k6/ws`; `k6/websockets`; `k6/secrets`; an unknown `lodash`; `export * from "./x.js"`.
  - **Dynamic code:** dynamic `import()`; `import.meta`; `open("/etc/passwd")`; `const o = open`; `eval("1")`; `Function("return 1")`; `new Function()`; `globalThis.open`.
  - **Reflection:** `Reflect.get(x, k)`; `(() => 1).constructor`; `x["constructor"]`; `x["con" + "structor"]`; `x[key]` with a string `key`; `Object.getPrototypeOf(f)`; `x.__proto__`; `const { constructor: c } = f`; `const { [k]: v } = o`.
  - **Timers:** `setTimeout("code", 1)`.
  - **Summary:** `export function handleSummary() {}` and `export { s as handleSummary }`.
  - **Shadowing:** `const Function = 1` (declaration shadowing).
  - **Literal-base limits:**
    - `const T = { __proto__: f }` (a prototype key in a literal);
    - `x.__proto__ = f` (a prototype write);
    - `let T = {}; T[k]` (not `const`);
    - `const T = make(); T[k]` (not a literal);
    - `T[k] += 1` on a non-literal base with a string `k` (a compound assignment reads);
    - `Object.prototype.hasOwnProperty` read on its own, without `.call(...)`.
- [ ] T004 [P] Create NDJSON fixtures in `backend/tests/fixtures/userScripts/ndjson/`, using the line shape of the existing `backend/tests/fixtures/performance/ndjson.ts`:
  - `basic.ndjson`: named requests with `name`, `url`, `method`, `status`, `group`, `check` and `expected_response` tags; `http_req_failed`; the six phase metrics; `checks`; `group_duration`; four custom metric types with their `Metric` declaration lines, including `thresholds`; `vus`; `iterations`; `iteration_duration`; `data_sent`; `data_received`; and a second host.
  - `unnamed-many.ndjson`: 130 distinct unnamed URLs with query strings and user info.
  - `long-soak.ndjson`: points spanning more than 200 five-second buckets.

  Add a small builder in `backend/tests/fixtures/userScripts/ndjsonBuilder.ts` so tests can compose lines.
- [ ] T005 [P] Extend `backend/scripts/perfStubTarget.ts` so that a `GET /echo-key` request records the `X-Api-Key` header it received. The record can be read through `GET /__received-keys`, which stays on the stub's local-only port. This serves quickstart 4 and the real-k6 test.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared types, storage, slot helper and runner and report seams that every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T006 Create `packages/shared-domain/src/userScript.ts` with every type in data-model.md "Entities":
  - `UserScriptSummary`, `UserScript`;
  - `ScriptCheckResult`, `ScriptCheckAccepted`, `ScriptCheckRefused`, `ScriptProblem`, `ScriptRuleId`, `ScriptEnvName`;
  - `ScriptConfirmation`;
  - `UserScriptRunSettings`, `UserScriptValueMapping`, `UserScriptLoad`, `UserScriptThreshold`, `MappingNameRefusal`;
  - `MappedValueStatus`;
  - `UserScriptRun`, `UserScriptRunSummary`, `UserScriptRunSnapshot`, `UserScriptRunProgress`, `K6ExitMeaning`;
  - `UserScriptResult`, `RequestGroupMetrics`, `RequestGroupResult`, `CustomMetricSummary`;
  - `UserScriptFinding`, `UserScriptFindingRuleId`;
  - `USER_SCRIPT_FINDINGS_RULESET_VERSION = 1`, `USER_SCRIPT_MAX_BYTES = 1048576`.

  Reuse `LoadProfile`, `PerformanceThresholdMetric`, `LatencyPercentiles`, `LatencySummary`, `RequestPhaseTiming`, `TimelinePoint`, `StepTimelinePoint`, `WriteMethod`, `PerformanceRunStatus`, `PerformanceRunCancelReason`, `PerformanceRunFailureCategory` and `PerformanceRunEnvironment` from `performance.ts`. Export the new types from `packages/shared-domain/src/index.ts`. No framework dependency.
- [ ] T007 Add the `user_scripts` and `user_script_runs` tables to `initializeSchema()` in `backend/src/persistence/connection.ts`, exactly as in data-model.md "Storage", with `CREATE TABLE IF NOT EXISTS` and session indexes. Add a comment citing AP-034 research R7 and R9 that explains which columns are encrypted and why.
- [ ] T008 [P] Create `backend/src/persistence/userScriptRepository.ts`, following `environmentRepository.ts`:
  - `SqliteUserScriptRepository` with `listBySession`, `get`, `create`, `replaceContent(id, bytes, sha256, size)` (also nulls the confirmation columns in the same statement, FR-016), `rename`, `confirm(id, sha256, hosts, at)` (writes only when `sha256` equals the stored one; returns whether it did), `saveSettings`, `delete`, `deleteBySession` and `hasAny(sessionId)`.
  - Content and confirmed hosts are encrypted with `credentialCipher`.
  - `getUserScriptRepository()` is a singleton rebuilt when the shared connection changes.
- [ ] T009 [P] Create `backend/src/persistence/userScriptRunRepository.ts`, following `performanceRunRepository.ts`:
  - `listBySession(sessionId, scriptId?)`, `get`, `getInProgress`, `create`, `checkpoint(progress, result)`, `settle(...)` (status, cancel reason, failure category, encrypted failure message, exit code, end time, encrypted result), `requestCancel`, `isCancelRequested`, `deleteBySession` and `markInterruptedRunsCancelled()`.
  - Snapshot, result and failure message are encrypted.
  - Every method takes the session id explicitly.
- [ ] T010 [P] Write `backend/tests/unit/persistence/userScriptRepositories.test.ts` against an in-memory connection (`setSharedConnectionForTest`). Check:
  - a round trip of every field;
  - `replaceContent` clears the confirmation;
  - `confirm` with a stale SHA-256 writes nothing;
  - rename keeps the confirmation;
  - `markInterruptedRunsCancelled` sets `backend-restart`;
  - after inserting a script containing a marker string, the raw table bytes (`SELECT content_encrypted, …`) do not contain the marker.
- [ ] T011 Create `backend/src/execution/executionSlot.ts` with `findExecutionInProgress(sessionId): { runId: string } | null`. It checks, synchronously:
  - `executionRunStore.getInProgressRun`;
  - `uploadedCollectionExecutionStore.getInProgressRun`;
  - `performanceRunStore.getPerformanceInProgressRun`;
  - `getUserScriptRunRepository().getInProgress`.

  Replace the three inline checks at `backend/src/api/performanceRuns.ts:63`, `backend/src/api/testGenerationWorkflow.ts:793` and `backend/src/api/externalCollections.ts:467` with it. Keep each route's `409 execution_in_progress { runId }` response, and keep no `await` between the check and the insert (research R9).
- [ ] T012 [P] Write `backend/tests/integration/execution/executionSlot.test.ts`. For each of the four run kinds in progress, the other three start routes return `409 execution_in_progress` with that run id. The existing slot tests must still pass unchanged.
- [ ] T013 Extend `backend/src/performance/k6/runner.ts` and `runnerTypes.ts`:
  - `RunnerStartInput` gains optional `args?: string[]`. When present, it replaces `buildK6Args(runDir)`.
  - It also gains `onStderrLine?: (line: string) => void`. The default keeps today's line counting.
  - `buildK6Args`, `buildChildEnv` and their pinned test are untouched.
- [ ] T014 Extend `backend/src/performance/k6/metricsStream.ts`: `parseMetricsLine(line, { acceptAllMetrics?: boolean })`. With the option, it:
  - returns points for any metric name;
  - returns `{ kind: "declaration", name, metricType, thresholds: string[] }` for `type: "Metric"` lines.

  Without the option, behaviour is unchanged. Add cases to the existing metricsStream unit test.
- [ ] T015 Export the existing helpers of `backend/src/performance/report/renderHtmlReport.ts`, with no change to their bodies: `escapeHtml`, `latencyScale`, `countScale`, `niceCeil`, `timeTickMs`, `clock`, `bytes`, `ms`, `pct`, `phaseTable`, the timeline SVG builder, `STYLE` and `REPORT_CSP`. The existing report tests must produce byte-identical output.
- [ ] T016 Make `frontend/src/components/performance/usePerformanceRuns.ts` generic, as `usePerformanceRuns<TRun extends { id: string; status: PerformanceRunStatus }, TSummary extends { id: string; status: PerformanceRunStatus; startedAt: string }>(client: PerformanceRunsClient<TRun, TSummary>)`. Define `PerformanceRunsClient` in `frontend/src/services/performanceTestingClient.ts` as the run-related subset of `PerformanceClient`:
  - `fetchReadiness`, `startRun`, `fetchRuns`, `fetchRun`, `cancelRun`, `fetchReport`, `reportDownloadUrl`;
  - a third type parameter, `TStartInput`, types `startRun: (input: TStartInput) => Promise<TRun>`. The guided and quick clients use `{ environmentId }`, and the user-script client uses `{ scriptId, environmentId, scriptSha256 }`. Do not use `unknown` or `any` (CLAUDE.md §44).

  The guided and quick callers must compile and behave unchanged. Run the existing frontend performance tests.

- [ ] T017 [P] Extend `backend/tests/unit/performance/renderScript.test.ts` with sandbox cases (`backend/tests/fixtures/performance/k6Sandbox.ts`) for research R23. Write them first; they must fail:
  - extracting a producer field named `toString` or `length` from a response that lacks it now fails the extraction, and cuts the journey short;
  - `items.0.id` through an array still extracts;
  - setup tokens reach every virtual user and refresh as before;
  - the rendered script contains `const VALUE_ENV =`, with each value name mapped to its `APIPILOT_V_<index>`, in `plan.userSuppliedValues` order;
  - it contains no `VALUE_INDEX[`, `scope.vars[`, `scope.tokens[`, `vuTokens[`, `data.tokens[` or `value[part]`.
- [ ] T018 Change the fixed runtime and constants in `backend/src/performance/k6/renderScript.ts` exactly as research R23's table specifies (AP-029 FR-022a):
  - `VALUE_ENV` replaces `VALUE_INDEX`, with the `hasOwnProperty` guard in `env()`;
  - `Map` for `scope.vars`, `scope.tokens` and `vuTokens`, and `tokenScope()` returning a `Map`;
  - `setup()` returns the token entries as an array, and the default function fills `vuTokens` from it;
  - an own-field `Object.entries` walk in `jsonField`;
  - the header comment updated: values are named in `VALUE_ENV`, and an edited copy can be run only as your own script under AP-034.

  Keep the imports, `options`, `SYSTEM_TAGS`, tags, counters, checks, the returned `valueIndex` and the environment template unchanged. Regenerate `backend/tests/fixtures/performance/golden/script.js` with the test's update path, and review the diff line by line: only the runtime and constants may differ. Every existing renderScript, bodyEdits, parameterEdits and sandbox test must pass unchanged, apart from the golden file. If k6 is installed, also run `npm run test:k6-real -w backend`.

**Checkpoint**: The foundation is ready. `npm test`, `npm run lint` and `npm run build` pass.
Generated performance runs keep their behaviour, arguments, environment and metrics, and only the
generated script's bytes have changed (R23).

---

## Phase 3: User Story 1 - Upload a k6 script, confirm it and run it (Priority: P1) 🎯 MVP

**Goal**: Choose "Run k6 Script", upload a script, see it checked, confirm its exact bytes, pick an
environment, run it with the user's k6, and read a report that names it as user-supplied with its
SHA-256.

**Independent Test**: spec US1 "Independent Test"; quickstart 1, 2, 3, 7 and 8.

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [ ] T019 [P] [US1] Write `backend/tests/unit/performance/userScript/checkUserScript.test.ts`:
  - **Refused corpus.** Every file in `fixtures/userScripts/refused/` is refused with the rule and line from `expected.json` (SC-001).
  - **Accepted corpus.** Every file in `accepted/` is accepted.
  - **Hosts.** `unnamed-urls.js` lists `https://api.example.test:8443`, and the templated base URL adds no host (SC-005).
  - **Names.** `basic.js` reads exactly `API_KEY` and `BASE_URL`.
  - **Default function.** `hasDefaultFunction` is false for `scenarios-only.js`.
  - **Determinism.** Each file is checked 10 times with identical results (FR-008, SC-010).
  - **Ordering.** Problems are sorted by line, column and rule.
  - **No quoting.** No message contains a string literal taken from the script.
  - **Limits.** Over 1 MiB gives `too-large`. Invalid UTF-8 and a NUL byte give `not-utf8-text`.
  - **Generated scripts.** Render generated scripts with `renderScript` for the guided fixture plan (`backend/tests/fixtures/openapi/performance.yaml`) and the quick fixture plan (`quick-performance.yaml`), including a plan with a token source, a body edit and a parameter edit. Assert that each is accepted, and that `envNames` lists exactly the plan's `APIPILOT_V_<n>` names, each with `suggestedSource` taken from its `VALUE_ENV` key (`baseUrl` → base URL; any other key → that environment value). This guards AP-029 FR-022a (research R5, R23).
- [ ] T020 [P] [US1] Write `backend/tests/unit/performance/userScript/numericGuarantee.test.ts`, with accepted and refused key expressions for each case of research R3 rule 4, including the literal-base allowance and computed writes. Include:
  - a `let i = 0` reassigned to a string (refused);
  - `+` with a non-numeric operand (refused);
  - a `const` literal shadowed in an inner scope by a non-literal (refused);
  - a computed write next to a compound assignment on the same base (the write accepted, the compound assignment refused).
- [ ] T021 [P] [US1] Write `backend/tests/unit/performance/userScript/exitCodesAndStderr.test.ts`:
  - **Exit codes.** R13's table for 0, 99, 104, 107, 108, 110 and other codes, with and without measured requests.
  - **stderr filter.** `source: "console"` lines are dropped. Non-JSON lines are counted and dropped. k6 `level: "error"` messages are kept up to 2,000 characters in total. Console text never appears in the kept text.
- [ ] T022 [P] [US1] Write `backend/tests/unit/performance/k6/userScriptArgs.test.ts`. Pin the exact `buildUserScriptK6Args(runDir, { kind: "script" })` list from research R10 as a reviewed contract: no `--summary-export`, no `--summary-mode`, no `--no-summary`, no stage. Then check `buildUserScriptChildEnv(processEnv, mapped)`:
  - with `K6_OUT`, `K6_CLOUD_TOKEN`, `APIPILOT_V_0` and an unrelated secret set in `processEnv`, none of them appears (SC-007);
  - the start-up keys are kept per platform;
  - each mapped name appears with its value;
  - no value appears in the argument list.
- [ ] T023 [P] [US1] Write `backend/tests/unit/performance/report/userScriptAggregate.test.ts` over the T004 fixtures:
  - display names follow the R14 rule, with no query, user info or fragment;
  - first-appearance order, the 100-name cap, and "Other requests" with `combinedNames` set to 30;
  - failure rate comes from `http_req_failed`;
  - statuses, phases and write counts per name and method;
  - checks, groups and the four custom metric summaries;
  - script threshold expressions from the declarations;
  - hosts received, sorted and capped at 50;
  - timeline bucket doubling to at most 200 buckets on `long-soak.ndjson`;
  - progress counts;
  - feeding the same lines twice gives deep-equal results.
- [ ] T024 [P] [US1] Write `backend/tests/unit/performance/report/userScriptReport.test.ts`:
  - `deriveUserScriptFindings` is deterministic, breaks ties by display name and covers each R16 rule;
  - `renderUserScriptReport` includes "supplied by the engineer and not generated by ApiPilot", the name and SHA-256, environment, tier, base URL, k6 version, load used, mapped names and sources, hosts received, writes, checks, groups, custom metrics and the script threshold outcome (FR-030 to FR-036);
  - the HTML has the CSP meta, no `<script`, no `http`/`https` asset reference outside escaped text, and is byte-identical when rendered twice;
  - it shows no journey, step or scenario wording (FR-031).
- [ ] T025 [P] [US1] Write `backend/tests/integration/userScripts/userScriptsRoutes.test.ts` with Supertest, the fake runner (`backend/tests/fixtures/performance/fakeRunner.ts`) and an in-memory database. Check:
  - **Upload.** Upload of `basic.js` → 201, needing confirmation, with hosts and names. Upload of each refused rule category → 422 `script_refused`, with no row stored. Over 1 MiB → 413. A wrong content type → 415.
  - **List.** `GET /api/user-scripts` returns the uploaded script.
  - **Confirmation.** Confirmation with a stale SHA-256 → 409 `script_changed`; with the current one → confirmed. Rename keeps it.
  - **Run-start refusals,** each in R17's order:
    1. content the current check refuses: inject a stricter check through the store's dependency, and expect 422 `script_refused` even though the script is confirmed;
    2. unconfirmed;
    3. wrong `scriptSha256`;
    4. k6 not ready;
    5. unknown environment;
    6. slot busy.
  - **Confirmation rules (FR-015).** A new script is never confirmed by default. The same bytes uploaded as a second script start unconfirmed, while the first stays confirmed. Confirming one script never confirms another.
  - **A successful run.** The written `script.js` bytes hash to the confirmed SHA-256 (SC-003). Changing the stored content after confirmation fails the run start with `script_changed`. The run directory is removed after settle (FR-041).
  - **Cancel and report.** Cancel → 202. The report route returns 409 while the run is in progress, then HTML.
  - **Failed start.** A fake k6 exit of 107 with no points and an error message → failed run with `k6Message` on `GET /runs/:runId`, absent from the run list and from the log file.
  - **Delete.** Delete with a run in progress → 409. Delete afterwards keeps the run.
  - **Restart and expiry.** Startup recovery cancels an in-progress run with `backend-restart`. Session expiry deletes scripts and runs.
  - **No automatic run.** No run starts on upload or on confirmation (FR-020).
- [ ] T026 [P] [US1] Write `backend/tests/integration/userScripts/environmentGate.test.ts`. A session with no script, Postman generation or quick test gets `409 stage_not_active` from the environments routes. After a script upload, the routes respond. Guided and quick access is unchanged (FR-024).
- [ ] T027 [P] [US1] Write `frontend/tests/unit/UserScriptPage.test.tsx` with React Testing Library and a mocked `userScriptClient`. Check:
  - **Entry.** The entry chooser shows "Run k6 Script", and choosing it opens the page with "Back to start".
  - **Empty state.** The page shows upload, and the credentials note (FR-012).
  - **Refusal.** A refused upload lists each reason as "Line N, column M: …".
  - **List.** The list shows name, size, SHA-256, a confirmation state in text, and the last run.
  - **Confirmation.** The dialog shows the exact statements of FR-014 and the SHA-256.
  - **Trigger.** It is disabled with "the script has not been confirmed" until confirmed. Then it shows the environment name, tier label, base URL, the hosts found (or "none found"), the note on run-time hosts, and the load-origin statement (FR-019, FR-023).
  - **Progress.** Live progress shows elapsed time, virtual users, requests and failures.
  - **Report.** The report frame opens when the run ends.

### Implementation for User Story 1

- [ ] T028 [P] [US1] Implement `backend/src/performance/userScript/numericGuarantee.ts`. It provides a per-function and module scope walk over the acorn ESTree that records every binding, its declaration kind, its initializer and its writes, plus:
  - `isNumericGuaranteed(expr, scope)`;
  - `isNumericIdentifier(name, scope)`;
  - `isConstLiteralBinding(name, scope)`, true for an unshadowed `const` bound to an object or array literal.

  Each follows research R3 rule 4 exactly. The functions are pure, with no I/O.
- [ ] T029 [US1] Implement `backend/src/performance/userScript/checkUserScript.ts` as `checkUserScript(bytes: Uint8Array): ScriptCheckResult` (pure):
  - size limit, then fatal UTF-8 decode and the NUL check;
  - acorn parse with `ecmaVersion: "latest"`, `sourceType: "module"` and `locations: true`, giving `parse-error` with the parser's line, column and message;
  - one walk applying R2 and R3 rules 1 to 6, including:
    - the `__proto__` rule in every position;
    - the exact `Object.prototype.hasOwnProperty.call(…)` chain;
    - computed writes with plain `=` only;
    - literal-base reads through `isConstLiteralBinding`;
  - R4 host scan, and R5 name collection, including names read through a `const` literal string table with their `suggestedSource`;
  - `hasDefaultFunction`;
  - problems sorted by line, column and rule id, with messages that never quote script strings and that suggest the allowed form where one exists.

  Depends on T028.
- [ ] T030 [P] [US1] Implement `backend/src/performance/userScript/mappingNames.ts`: `validateMappingName(name): MappingNameRefusal | null`. It applies FR-026 (a name of letters, digits and underscores, not starting with a digit, not starting with `K6_` case-insensitively) and the reserved start-up names `PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `HOME` and `TMPDIR`, compared without case.
- [ ] T031 [P] [US1] Implement `backend/src/performance/userScript/settings.ts` with these pure functions:
  - `initialSettings(check)`: R12's initial mapping (a `suggestedSource` first, then `BASE_URL`, then the same name), the load `{ kind: "script" }` and no thresholds;
  - `mergeSettingsAfterContentChange(settings, check)`: adds newly found names not in `removedNames`, and keeps entries no longer found;
  - `withFoundFlags(settings, check)`.
- [ ] T032 [P] [US1] Implement `backend/src/performance/userScript/exitCodes.ts`, with `exitMeaningOf(code)` and `settledStatusOf(code, measuredRequests)` from R13's table. Also implement `backend/src/performance/userScript/stderrFilter.ts`: `createStderrFilter()` returns `{ onLine, keptErrorText(), counts() }`, following R13.
- [ ] T033 [US1] Add `buildUserScriptK6Args(runDir, load)` and `buildUserScriptChildEnv(processEnv, mapped)` to `backend/src/performance/k6/runner.ts`, exactly as research R10 and R11 specify. Reuse the start-up allow-list logic of `buildChildEnv` through a shared private function, so the two cannot drift. In this story `load` is always `{ kind: "script" }`; the `--stage` branch arrives in T051.
- [ ] T034 [US1] Implement `backend/src/performance/report/userScriptAggregate.ts` as `createUserScriptAggregate({ plannedDurationMs: number | null, startedAtMs })`, returning `{ add(parsedLine), progress(nowMs), toResult(endMs, context) }`, as specified in research R14:
  - reuse `LatencyHistogram`, `timelineBucketMs` and `TimelinePoint`;
  - use bucket doubling when `plannedDurationMs` is null;
  - apply the display-name rule and the caps;
  - read raw `url` and `name` tags only in memory, and never put them in the result.
- [ ] T035 [P] [US1] Implement `backend/src/performance/report/userScriptFindings.ts`: `deriveUserScriptFindings(result, run)`, with the fixed rules of research R16 and ties broken by display name. It returns `findingsRulesetVersion = USER_SCRIPT_FINDINGS_RULESET_VERSION`.
- [ ] T036 [US1] Implement `backend/src/performance/report/renderUserScriptReport.ts`: `renderUserScriptReport(run: UserScriptRun): string`, using the helpers exported in T015. It covers the sections of FR-030 to FR-036:
  - provenance (user-supplied, name, SHA-256, environment, k6 version, load, mapped names and sources, exit meaning);
  - tiles;
  - ApiPilot thresholds and the script's threshold outcome;
  - findings;
  - the run timeline;
  - the request-group table with latency, statuses and phases;
  - per-group latency and failures over time;
  - "Other requests" with the naming note;
  - hosts received;
  - writes;
  - checks, groups and custom metrics.

  For a failed run, render only the failure and provenance, without the k6 message.
- [ ] T037 [US1] Implement `backend/src/performance/userScript/userScriptStore.ts`, a session-scoped facade over T008 using `getSessionId()`. It provides:
  - `list`, `get` (adds the memoised check result from an LRU of 64 entries keyed by SHA-256, plus derived `confirmed` and `lastRun`);
  - `createFromBytes(name, bytes)`: check, then store only when accepted, with `initialSettings`;
  - `rename`, `confirm(id, sha256)`, `delete` (refused while a run is in progress), `readContent(id)` and `hasUserScript()`.

  Register `onExpire` to delete by session. Throw the typed errors `UserScriptNotFoundError`, `UserScriptRefusedError(problems)`, `UserScriptChangedError` and `UserScriptRunInProgressError` from `backend/src/performance/errors.ts`.
- [ ] T038 [US1] Implement `backend/src/performance/userScript/userScriptRunStore.ts`, a session-scoped facade over T009 with `onExpire` deletion. Also implement `backend/src/performance/userScript/startUserScriptRun.ts`:
  - **Route-side checks:** `startUserScriptRun(scriptId, { environmentId, scriptSha256 }, deps)` performs R17's checks in order, using `findExecutionInProgress`. That order includes re-checking the stored content with the current rules, through the memoised check, and refusing with `UserScriptRefusedError` before the confirmation check. It then creates the run (with the snapshot from the script, settings and check, and `plannedDurationMs` null for the script's own load) and fires the background run.
  - **Background run:**
    1. decrypt the content;
    2. write `script.js` (mode 0600) with `createRunDirectory`;
    3. re-hash it and fail as `script-integrity-failed` on a mismatch;
    4. resolve mapped values from the environment (R12; absent or empty names are not set);
    5. spawn with T033's args and env and T032's stderr filter;
    6. tick with the aggregate's progress and result (thresholds and findings filled), calling `touch(sessionId)` and checking cancellation;
    7. settle with the exit meaning and status, and the encrypted k6 message only when failed;
    8. remove the run directory in `finally`.
  - **Shared mechanics:** use the existing `liveHandles` and `cancelLiveRun` from `runPerformanceTest.ts`, exporting them if needed.
  - **Logging:** only the events in the contract's Logging section.
- [ ] T039 [US1] Add `recoverUserScriptRunsAtStartup()` to `backend/src/performance/startup.ts`, calling `markInterruptedRunsCancelled()` on the user-script run repository. Call it from `backend/src/server.ts` after the existing performance recovery.
- [ ] T040 [US1] Make `requireEnvironmentAccess()` in `backend/src/api/testGenerationWorkflow.ts:166` also pass when `hasUserScript()` is true (research R18). Change nothing else.
- [ ] T041 [US1] Implement `backend/src/api/userScripts.ts` with these routes from contracts/user-scripts-api.md:
  - `GET /api/user-scripts`;
  - `POST /api/user-scripts/upload` (`express.raw({ type: "application/octet-stream", limit: USER_SCRIPT_MAX_BYTES })`, 415 for any other content type);
  - `GET /:id`, `GET /:id/content` (`Cache-Control: no-store`, `nosniff`), `PATCH /:id`, `DELETE /:id`, `POST /:id/confirmation`;
  - `GET /readiness`;
  - `POST /:id/runs`, `GET /runs`, `GET /runs/:runId`, `POST /runs/:runId/cancel`, `GET /runs/:runId/report`.

  Register the fixed paths (`/upload`, `/readiness`, `/runs…`, and `/example` in US3) before the `/:id` routes, and validate `:id` and `:runId` as UUIDs (404 otherwise).

  Routes stay thin: delegate, then map typed errors through `handleKnownError`/`fail` in `backend/src/api/performanceHttp.ts`, extending it for the new errors. Strip `failure.k6Message` from run summaries. Mount the router in `backend/src/app.ts`, injecting the same runner, probe, tick interval and clock as the performance routes so tests can use the fake runner.
- [ ] T042 [P] [US1] Implement `frontend/src/services/userScriptClient.ts` for the US1 routes, using the existing fetch and error helpers of `performanceTestingClient.ts`. The upload sends the `File` as `application/octet-stream`, with `name` taken from the file name without its extension. It implements `PerformanceRunsClient<UserScriptRun, UserScriptRunSummary>` for its own runs.
- [ ] T043 [US1] Add `"user-script"` to `EntryChoice` and `DIRECT_PATHS` in `frontend/src/components/EntryChooser.tsx`, with title "Run k6 Script" and one sentence stating that it runs a k6 script you supply with your own k6. Add a fourth tab and mounted view in `frontend/src/App.tsx`, and generalise `mount()` so it no longer assumes three views.
- [ ] T044 [P] [US1] Implement the US1 components in `frontend/src/components/userScript/`:
  - `ScriptList.tsx`: a semantic table of name, size, a shortened SHA-256 with the full value in `title`, a confirmation `StatusBadge` with text, and the last run.
  - `ScriptProblems.tsx`: an ordered list of "Line N, column M: message".
  - `ScriptConfirmDialog.tsx`: built on `ConfirmDialog`, with the exact FR-014 statements, the host list or "none found in the script text", and the SHA-256.
  - `UserScriptRunTrigger.tsx`: `EnvironmentPicker`, the target block (name, tier label via `TIER_TONE`, base URL), the hosts found and the run-time note, the load-origin statement, the readiness reason, and the disabled reason in text.
  - `UserScriptRunActivity.tsx`: the live tiles, elapsed time, the persistent target, the runs table, `PerformanceReportFrame`, and the failed-run k6 message in a `CodeBlock`.

  Use Tailwind tokens and AP-027 components only. Every state is given in text as well as colour.
- [ ] T045 [US1] Implement `frontend/src/pages/UserScriptPage.tsx`:
  - loading, empty, error and ready states;
  - an upload control (`accept=".js,text/javascript,application/javascript"`) with the credentials note;
  - the script list;
  - for a selected script, tabs **Script**, **Run setup** and **Runs & reports**:
    - **Script** has a read-only `CodeBlock` view of the content, rename, and delete with `ConfirmDialog`;
    - it also shows the check results: the hosts found and the environment names read, each list with the FR-009 note that values built at run time cannot be found, or the problems for a script the current check refuses;
  - "Back to start";
  - `usePerformanceRuns(userScriptClient)`.

**Checkpoint**: User Story 1 is complete. Quickstart 1, 2, 3, 7 and 8 pass, and the US1 tests pass.

---

## Phase 4: User Story 2 - Configure the run: environment values, load and thresholds (Priority: P2)

**Goal**: Map the names the script reads to environment values, override the load with a profile,
and set ApiPilot thresholds, without changing the script's bytes or its confirmation.

**Independent Test**: spec US2 "Independent Test"; quickstart 4 and 5.

### Tests for User Story 2 ⚠️ (write first, confirm they fail)

- [ ] T046 [P] [US2] Write `backend/tests/unit/performance/userScript/settings.test.ts`. Check:
  - `validateMappingName` for each refusal (`invalid-characters`, `starts-with-digit`, `k6-prefix`, `reserved-startup-name` for `path`, `Path` and `TMPDIR`);
  - the initial mapping (`BASE_URL` → base URL, others → the same name);
  - merging after a content change respects `removedNames` and keeps not-found entries;
  - settings validation limits (100 mappings, 50 thresholds, valid stages).
- [ ] T047 [P] [US2] Extend `backend/tests/unit/performance/k6/userScriptArgs.test.ts`. A profile load appends one `--stage <seconds>s:<target>` per stage, in order, before the script path. The rest of the list is unchanged.
- [ ] T048 [P] [US2] Write `backend/tests/unit/performance/report/userScriptThresholds.test.ts`, covering run and request-name scopes, each metric, "nothing measured fails", and the `scriptThresholdsOutcome` values from exit 99, exit 0 with declarations, and no declarations.
- [ ] T049 [P] [US2] Write `backend/tests/integration/userScripts/userScriptSettings.test.ts`. Check:
  - **Settings route.** `PUT /:id/settings` keeps the confirmation and SHA-256 (FR-028), and refuses bad names with `invalid_mapping_name`.
  - **Values route.** `GET /:id/values` marks present and missing values and never returns a value.
  - **Child environment.** A run passes the mapped values in the child environment of the fake runner, and a missing value is absent.
  - **Load override.** A profile load on a script with no default function returns 409 `load_override_unavailable`. A profile load otherwise passes `--stage` flags and records the stages in the snapshot.
  - **Snapshot.** The run snapshot lists the mapped names and sources without values.
  - **Seeded-secret scan (SC-004).** With seeded environment values and a script that logs them, none appears in any response body, the report HTML, the raw database file bytes or `logs/backend.log`.
- [ ] T050 [P] [US2] Write `frontend/tests/unit/UserScriptRunSetup.test.tsx`. Check:
  - the mapping editor lists the found names with sources and "not found in the script" entries, adds a name, refuses `K6_OUT` and `PATH` with reasons, removes a name, and never shows a value;
  - missing values are shown for the chosen environment;
  - the load choice defaults to "the script's own load settings", and the profile option is disabled with the reason for a script with no default function;
  - the threshold editor offers run and request-name scopes;
  - saving keeps "Confirmed".

### Implementation for User Story 2

- [ ] T051 [US2] Add the `--stage` branch to `buildUserScriptK6Args` in `backend/src/performance/k6/runner.ts` (research R10). In `startUserScriptRun.ts`, add R17 check 3 (`load_override_unavailable`), set `plannedDurationMs` from the profile, and record the load in the snapshot.
- [ ] T052 [P] [US2] Implement `backend/src/performance/report/userScriptThresholds.ts`: `evaluateUserScriptThresholds(thresholds, result)` and `scriptThresholdsOutcome(exitCode, declarations)` (research R15). Wire both into the tick and settle in `startUserScriptRun.ts`, and into the report's threshold section.
- [ ] T053 [US2] Add the following to `backend/src/api/userScripts.ts` and `userScriptStore.ts`:
  - `PUT /api/user-scripts/:id/settings`, which validates with `settings.ts` and `mappingNames.ts`, refuses with `invalid_mapping_name` or `invalid_settings`, and never touches the content or confirmation;
  - `GET /api/user-scripts/:id/values?environmentId=`, which returns `MappedValueStatus[]` and `baseUrl` with no values.
- [ ] T054 [P] [US2] Make `frontend/src/components/performance/ThresholdEditor.tsx` take its scope options as a prop. The current guided and quick callers pass their step options, and their behaviour is unchanged.
- [ ] T055 [P] [US2] Implement `frontend/src/components/userScript/ValueMappingEditor.tsx`. It lists each mapping with its source (base URL, or an environment value by name), "not found in the script", present or missing for the chosen environment, and "value hidden" in text. It supports adding (with the FR-026 reason shown inline), editing the source, and removing.
- [ ] T056 [US2] Extend the **Run setup** tab in `frontend/src/pages/UserScriptPage.tsx`:
  - `ValueMappingEditor`;
  - a load choice of "the script's own load settings" or `LoadProfileEditor`, with the override disabled and the reason given for a script with no default function;
  - `ThresholdEditor` with run and request-name scopes, suggesting the last run's request names.

  Extend `userScriptClient.ts` with `saveSettings` and `fetchValues`. Show the load used in the trigger and the run activity.

**Checkpoint**: User Stories 1 and 2 work. Quickstart 4 and 5 pass.

---

## Phase 5: User Story 3 - Write or edit a script in ApiPilot (Priority: P3)

**Goal**: Write a new script from ApiPilot's example, or edit a stored one, in an editor with line
numbers and highlighting that never executes it. Saving runs the same check, and a saved change
needs a new confirmation.

**Independent Test**: spec US3 "Independent Test"; quickstart 6.

### Tests for User Story 3 ⚠️ (write first, confirm they fail)

- [ ] T057 [P] [US3] Write `backend/tests/integration/userScripts/userScriptEditing.test.ts`. Check:
  - **Example.** `GET /example` is accepted by the check, reads `BASE_URL`, and contains no credential-like value.
  - **Create.** `POST /api/user-scripts` with JSON creates a script.
  - **Save.** `PUT /:id/content` with the current `baseSha256` stores a new SHA-256 and clears the confirmation (FR-016). A stale `baseSha256` → 409 `script_changed`, with nothing stored.
  - **Refused save.** A refused save → 422 with problems, and the stored bytes unchanged.
  - **Download.** `GET /:id/download` returns the stored bytes exactly, CRLF included for an uploaded CRLF file, with `Content-Disposition: attachment`.
  - **Settings merge.** A content change runs the settings merge.
  - **Replacement upload (FR-016).** `PUT /:id/content?baseSha256=` with an `application/octet-stream` body replaces the bytes exactly and clears the confirmation. Any other content type → 415.
  - **No run after a save (SC-008).** No run starts after an editor save or a replacement upload.
- [ ] T058 [P] [US3] Write `frontend/tests/unit/ScriptEditor.test.tsx` and `frontend/tests/unit/highlightJavaScript.test.ts`. Check:
  - **Tokenizer.** Comments, strings, templates, numbers, keywords and punctuation, and plain text round-trips exactly.
  - **Structure.** The editor's textarea is labelled and is the only focusable layer, and the overlay and gutter are `aria-hidden`.
  - **Large scripts.** Highlighting is off above 256 KiB, with the note.
  - **Problems.** Reasons appear at their lines, with a text marker in the gutter.
  - **Unsaved changes.** Leaving with unsaved changes asks first; Cancel keeps the text.
  - **Refused save.** It keeps the unsaved text.
  - **Notes.** The credentials note (FR-012) and the line-ending note are shown.
  - **No execution.** `eval` and the `Function` constructor are never called (spy on `globalThis.eval` and `Function`).

### Implementation for User Story 3

- [ ] T059 [P] [US3] Implement `backend/src/performance/userScript/exampleScript.ts`, exporting the fixed starter script as a constant. It imports `k6/http` and `k6`; sends one named `GET` to `` `${__ENV.BASE_URL}/` ``; makes one status check; sleeps 1 second; uses `vus: 1, duration: "30s"`; and has a comment stating that credentials belong in environment values.
- [ ] T060 [US3] Add to `userScriptStore.ts` and `backend/src/api/userScripts.ts`:
  - `GET /example`;
  - `POST /api/user-scripts` (JSON `{ name, content }`, UTF-8 encoded and checked);
  - `PUT /:id/content`, accepting JSON `{ content, baseSha256 }` or an `application/octet-stream` body with `?baseSha256=` (`express.raw`, limit `USER_SCRIPT_MAX_BYTES`), and 415 for any other type. The `baseSha256` check gives `script_changed`; the content check gives `script_refused`; otherwise `replaceContent` plus `mergeSettingsAfterContentChange`;
  - `GET /:id/download` (exact bytes; a file name built from the name, reduced to `[A-Za-z0-9._-]`).

  Log only `user_script_stored` and `user_script_refused` with the contract's fields.
- [ ] T061 [P] [US3] Implement `frontend/src/components/userScript/highlightJavaScript.ts`: a pure `highlightJavaScript(text): Token[]` tokenizer for comments, strings, templates, numbers, keywords, identifiers and punctuation (research R19). It never evaluates input.
- [ ] T062 [US3] Implement `frontend/src/components/userScript/ScriptEditor.tsx` (research R19):
  - a labelled native `<textarea>` with `spellCheck={false}`;
  - an `aria-hidden` highlighted `<pre>` behind it, with scroll synced;
  - an `aria-hidden` line-number gutter with a text marker on lines that have problems;
  - debounced highlighting, off above 256 KiB with a note;
  - the credentials note and the line-ending note;
  - Save and Cancel;
  - the `ScriptProblems` list.

  Use Tailwind tokens; the code font is the existing JetBrains Mono.
- [ ] T063 [US3] Wire the editor into `frontend/src/pages/UserScriptPage.tsx`:
  - **Write a new script** opens the editor on the example from `GET /example`;
  - **Edit** on the Script tab opens the stored content;
  - Save calls create or `PUT /content` with `baseSha256`;
  - a refusal keeps the text;
  - leaving with unsaved changes (selecting another script, switching tabs, Back to start) opens `ConfirmDialog`;
  - a successful save shows "Needs confirmation";
  - **Download** links to `GET /:id/download`;
  - **Replace with upload** on the Script tab sends a chosen file to `PUT /:id/content` as octet-stream, after a `ConfirmDialog` stating that the script will need confirmation again.

  Extend `userScriptClient.ts` with `fetchExample`, `createFromText`, `saveContent`, `replaceWithUpload` and `downloadUrl`.

**Checkpoint**: All three stories work. Quickstart 6 passes.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, specification pointers, the real-k6 check, version, roadmap, and the
definition of done (constitution XXXI).

- [ ] T064 [P] Add one user-script case to `backend/tests/integration/performance.k6.real.test.ts`, using `accepted/basic.js` against `perfStubTarget` (research R21). It must check that:
  - `name` and `url` tags reach the aggregate;
  - a `--stage` override replaces the script's scenarios (virtual users follow the stages);
  - a script threshold set to fail gives exit 99 and `scriptThresholdsOutcome: "crossed"`;
  - `console.log` output appears in no stored field;
  - the mapped `API_KEY` reached the stub;
  - every allowlisted module imports and runs (one import of each, with a trivial use).

  It runs only with `npm run test:k6-real -w backend`. Record the k6 version it ran with in `validation.md`. When k6 1.0.x is available, run it once on that version too, the minimum the readiness probe accepts (research R3, module availability).
- [ ] T065 [P] Update `docs/USER_MANUAL.md`:
  - a new section "6. Run k6 Script" covering entry, upload and the check rules (with the refused constructs and their rewrites), confirmation, mapping and reserved names, load override and its limit, thresholds, the editor, runs, the report, and what ApiPilot cannot restrict;
  - updated start-screen text (four entries) and environment-access text;
  - Known limitations and Troubleshooting rows: a remote import refused; `obj[key]` refused on a non-literal base (use a `Map`); and how to download a generated script from the plan and run it, changed or not, as your own (spec Edge Cases, AP-029 FR-022a); a named-scenarios-only script cannot take a profile; `handleSummary` refused; CRLF lost on an editor save.
- [ ] T066 [P] Update `docs/architecture.md` with the `performance/userScript/` module, the two tables and what each encrypts, the user-script run path (check → confirm → copy → hash → k6 with pinned args and env), and the consolidated execution slot.
- [ ] T067 [P] Add the specification pointers from contracts/changes-to-existing-apis.md:
  - AP-029 FR-026 and FR-022a in `specs/031-k6-performance-testing/spec.md`, already added on 2026-10-01 (check that they are still accurate against the implementation);
  - AP-032 FR-018 in `specs/032-quick-performance-test/spec.md`;
  - a pointer in `specs/031-k6-performance-testing/contracts/performance-api.md`.
- [ ] T068 [P] Update `README.md`'s feature list with one line for "Run k6 Script".
- [ ] T069 Update `specs/ROADMAP.md`:
  - add AP-034's row to the Implementation Status table, with its status, the new dependency, the spec amendments to FR-006 and FR-026, and the version;
  - add a Next Actions entry for the `multer` 1.x → 2.x security upgrade (research R22);
  - record AP-029's 2026-10-01 amendment (FR-022a: generated scripts pass the AP-034 check) in AP-029's row;
  - record that AP-035 (`specs/035-user-defined-journeys`) is specified and waiting for planning.
- [ ] T070 Bump the version from 19.14.0 to 19.15.0 with `npm run version:bump -- feature`, which updates the four `package.json` files and `package-lock.json`, then run `npm install`. Confirm no git tag or commit was created.
- [ ] T071 Run `npm test`, `npm run lint` and `npm run build` at the root, and fix every failure without weakening configuration or disabling tests. Record the exact results in `specs/034-run-user-k6-script/validation.md`, following `specs/032-quick-performance-test/validation.md`.
- [ ] T072 Review the diff against the security checklist and record the result in `validation.md`:
  - no path logs content, names, hosts, values, k6 messages or console output;
  - every sensitive column is encrypted;
  - `buildK6Args` and `buildChildEnv` are unchanged;
  - no `eval` or `Function` in frontend or backend code;
  - the upload limit is enforced before parsing;
  - `Content-Disposition` names are sanitised.
- [ ] T073 Walk through quickstart.md scenarios 1 to 8 in the browser, and scenario 9 when k6 is installed. Record each result, or the reason it was not run, in `validation.md`. Include the measured times for SC-006 (start screen to a running test) and SC-009 (progress after the trigger; report after the end). The feature is not "Implemented" in the roadmap until this walkthrough is recorded (constitution XXXI).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1):** no dependencies. T001 comes before any task that imports `acorn`.
- **Foundational (Phase 2):** depends on Setup, and blocks every story.
  - T006 comes first.
  - T007 comes before T008 and T009.
  - T011 depends on T009.
  - T013 to T017 are independent of each other.
  - T018 (the AP-029 template change) follows its test, T017.
  - T019's generated-script acceptance case depends on T018.
- **User Story 1 (Phase 3):** depends on Phase 2.
- **User Story 2 (Phase 4):** depends on Phase 2, and on US1's run path (T033, T038, T041) and page (T045). It extends them rather than replacing them.
- **User Story 3 (Phase 5):** depends on Phase 2 and on US1's store and routes (T037, T041). It is independent of US2.
- **Polish (Phase 6):** depends on the stories being shipped.

### Within Each User Story

- Tests come first and must fail before implementation.
- Pure modules come before the store and routes, which come before the frontend client, which
  comes before the components and page.
- US1 order:
  1. T028 → T029;
  2. T030 to T032;
  3. T033 to T036;
  4. T037 → T038 → T039 to T041;
  5. T042 → T043 to T045.

### Parallel Opportunities

- Setup: T002 to T005.
- Foundational: T008, T009 and T010 after T007; then T012 to T017, then T018.
- US1 tests: T019 to T027 together.
- US1 implementation: T028, T030, T031, T032 and T035 together, then T042 and T044 alongside the backend routes.
- US2 tests: T046 to T050. US2 implementation: T052, T054 and T055.
- US3 tests: T057 and T058. US3 implementation: T059 and T061.
- US2 and US3 can proceed in parallel once US1 is done.
- Polish: T064 to T068.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "Write checkUserScript.test.ts (refused and accepted corpora, determinism, hosts, names)"
Task: "Write numericGuarantee.test.ts"
Task: "Write exitCodesAndStderr.test.ts"
Task: "Write userScriptArgs.test.ts (pinned args, filtered env)"
Task: "Write userScriptAggregate.test.ts"
Task: "Write userScriptReport.test.ts"
Task: "Write userScriptsRoutes.test.ts and environmentGate.test.ts"
Task: "Write UserScriptPage.test.tsx"

# Pure modules, together:
Task: "Implement numericGuarantee.ts"
Task: "Implement mappingNames.ts"
Task: "Implement settings.ts"
Task: "Implement exitCodes.ts and stderrFilter.ts"
Task: "Implement userScriptFindings.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup.
2. Phase 2: Foundational. Generated runs must be unchanged.
3. Phase 3: User Story 1.
4. **Stop and validate:** quickstart 1, 2, 3, 7 and 8. The engineer can upload, confirm and run a
   script that reads `BASE_URL`, and read the report.

### Incremental Delivery

1. Setup and Foundational give the foundation.
2. US1 is the MVP: upload, check, confirm, run, report.
3. US2 adds mapping, load override and thresholds.
4. US3 adds the editor.
5. Polish adds docs, pointers, real-k6, roadmap, version 19.15.0 and validation.

---

## Notes

- **No commits.** Leave every change uncommitted for the user's review.
- **Security-relevant tasks.** T011, T013, T018, T029, T033, T038, T040 and T041 change what
  ApiPilot executes or who can reach environments. Flag them in the review summary.
- **Pinned tests.** If the T022 or T047 pinned argument lists need to change later, that is a
  reviewed contract change. Update research R10 first.
