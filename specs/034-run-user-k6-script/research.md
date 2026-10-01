# Research: Run a User-Supplied k6 Script (AP-034)

Decisions R1 to R23 for [plan.md](./plan.md). Each records the decision, its rationale and the
alternatives considered. k6 behaviour cited here was checked on 2026-10-01 against Grafana's k6
documentation (options reference for v1.0.x and latest, scenarios) and k6's source
(`errext/exitcodes/codes.go`). The opt-in real-k6 test (R21) re-checks each behaviour that matters.

## R1. A JavaScript parser for the script check

**Decision**: Add `acorn` (MIT, no dependencies) as a backend runtime dependency, used with
`ecmaVersion: "latest"`, `sourceType: "module"` and `locations: true`. ApiPilot walks the ESTree
itself with a small typed visitor, so `acorn-walk` is not needed.

**Rationale**: The check (FR-004 to FR-009) needs a real syntax tree with line and column numbers.
Regular expressions cannot tell an import from a string, or a property name from a variable.
`acorn` is the smallest maintained ES2024+ parser. It is already in the lockfile as a dev
transitive dependency of ESLint, so the licence and supply chain are already reviewed. Module mode
is strict mode, so `with` and other sloppy-mode constructs fail to parse and need no rule of their
own. The parser only builds a tree and never evaluates the script (XVII).

**Alternatives considered**:
- The TypeScript compiler API: dev-only today, about 10 times the size, and a different AST.
- `@babel/parser`: larger, and brings plugin options this feature does not need.
- `esprima`: no longer maintained for current syntax.
- Running `k6 inspect` or `k6 archive`: both execute the script's init code, which is exactly what
  the check must prevent before confirmation.

## R2. Import rules (FR-005)

**Decision**: Every `ImportDeclaration`, every `ExportNamedDeclaration` with a `source`, and every
`ExportAllDeclaration` must name exactly one of `k6`, `k6/http`, `k6/metrics`, `k6/execution`,
`k6/encoding`, `k6/crypto`, `k6/data`, `k6/html` or `k6/timers`. Any other source is refused, and
its reason names the category:
- remote URL (`http:`, `https:` or `//`);
- local file (`./`, `../`, `/`, `file:` or a drive letter);
- extension (`k6/x/`);
- experimental (`k6/experimental/`);
- a named forbidden built-in (`k6/browser`, `k6/net/grpc`, `k6/ws`, `k6/websockets`, `k6/secrets`);
- any other module.

**Rationale**: This is the spec's allowlist, checked on the module specifier as written. A remote
import such as `https://jslib.k6.io/…` is the refusal users will hit most often, so its message
says why remote code is refused and that the helper can be copied into the script instead.

**Alternatives considered**: Allowing `jslib.k6.io` was rejected, because the constitution forbids
remote URL imports outright.

## R3. Indirect capabilities: what the check must rule out (FR-006)

**Decision**: The check accepts a conservative subset of JavaScript. A construct it cannot prove
safe is refused, with a rule id, line, column and message. The rules:

1. **Dynamic code and loading.** `ImportExpression` (dynamic `import()`) and `import.meta` are
   refused.
2. **Forbidden identifiers.** Any reference to `open`, `require`, `eval`, `Function`, `globalThis`,
   `global`, `self`, `window` or `Reflect` is refused, as is any declaration, parameter or import
   binding with one of these names (so they cannot be shadowed or re-exported). Property names are
   not identifiers here: `http.request` and `{ open: 1 }` are allowed.
3. **Forbidden property names.** Reading a property named `constructor`, `__proto__`,
   `prototype`, `getPrototypeOf`, `setPrototypeOf`, `getOwnPropertyDescriptor`,
   `getOwnPropertyDescriptors`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`,
   `__lookupSetter__`, `caller` or `callee` is refused. This applies to dotted access, string-literal
   computed access and destructuring keys.
   - `__proto__` is refused in every position: as a read, as a write, and as an object-literal key.
     A `__proto__` key in a literal sets the object's prototype, which would undo rule 4's literal
     allowance.
   - Defining any other forbidden name as an object-literal key, or a class `constructor()` method,
     is allowed, because it cannot read the function constructor.
   - One exact chain is allowed: `Object.prototype.hasOwnProperty.call(a, b)`, with `Object` not
     shadowed. It returns a boolean, and nothing else can be taken from it.
4. **Computed property access.** A computed **write** with plain `=` (`headers[name] = v`,
   `a.b[k] = v`) is allowed with any key, because assigning cannot read the function constructor.
   A compound assignment (`+=` and the like) or an update (`++`) also reads, so its key falls under
   the read rule.

   A computed **read** `a[k]`, and a computed destructuring key `{ [k]: v }`, is allowed with any
   key when `a` is an identifier bound with `const`, and not shadowed, to an object or array
   literal. This covers lookup tables such as `const STATUS = { ok: 200 }; STATUS[name]`. With such
   a base, an unknown key can at worst give `Object` or `Array` themselves. Neither reaches the
   function constructor without a further computed read on a non-literal base, a forbidden name
   (rule 3) or `Reflect` (rule 2), and the literal cannot be given another prototype (rule 3,
   `__proto__`).

   On any other base, a computed read is allowed only when `k` is one of:
   - a number literal;
   - a string literal or expression-free template that is not on rule 3's list;
   - a *numeric-guaranteed* expression: unary `-`, `+` or `~`; binary `-`, `*`, `/`, `%`, `**`,
     `|`, `&`, `^`, `<<`, `>>` or `>>>`; `+` whose two operands are both numeric-guaranteed; a call
     `Math.<name>(…)` with `Math` not shadowed; the k6 globals `__VU` and `__ITER`;
   - an identifier declared with `let`, `const` or `var` whose initializer and every assignment are
     numeric-guaranteed (`++`, `--`, and `=`, `+=`, `-=`, `*=` and so on with a numeric-guaranteed
     right side). This covers `for (let i = 0; i < n; i++) data[i]`.

   One exception: `__ENV[k]` with any key is allowed when `__ENV` is not shadowed. Its result can
   only be a string or a built-in such as `Object`, and rules 2 and 3 stop either from reaching the
   function constructor.
5. **Timers with string code.** `setTimeout` or `setInterval` whose first argument is a string
   literal or a template is refused. k6's timers take functions only. The rule makes the refusal
   explicit rather than relying on a run-time error.
6. **Summary files.** Exporting `handleSummary` in any form (`export function`, `export const`,
   `export { x as handleSummary }`) is refused. k6 writes whatever `handleSummary` returns to local
   file paths, which is filesystem access the constitution forbids. ESM exports are static, so this
   rule is complete. *This rule is added to spec FR-006 by this plan (see the spec's amendment
   note).*

Messages suggest the allowed form where one exists:
- a `Map` with `map.get(key)` in place of a computed read on a non-literal base (a `Map` has no
  inherited keys);
- `Object.hasOwn(x, k)`;
- `data[i | 0]` for an index.

**Scripts ApiPilot generated (spec Edge Cases; AP-029 FR-022a, amended 2026-10-01).** The check
is not loosened for generated scripts. Instead, AP-029's template is changed so that it passes the
check as written (R23). A test renders generated scripts for the guided and quick fixture plans and
asserts that each is accepted. If a later template change breaks the check, that test fails.

**Module availability**: each allowlisted module is documented in the k6 v1.0.x JavaScript API
(checked 2026-10-01), the minimum version ApiPilot's readiness probe accepts. None is marked
deprecated there: `k6`, `k6/http`, `k6/metrics`, `k6/execution`, `k6/encoding`, `k6/crypto`,
`k6/data`, `k6/html` and `k6/timers`. In 1.0.x, WebSockets are `k6/ws` and
`k6/experimental/websockets`; both are refused. `--log-format json` and `--system-tags` are
documented in the v1.0.x options reference.

**Rationale**: k6 has no run-time switch that disables `open()` or `require()`. The protection is
static, so it must close every way to reach those globals or the function constructor:
- **Name.** Rule 2 blocks the direct names, so `open` cannot be read directly.
- **Global object.** Rule 2 also blocks every name for the global object, so `globalThis.open` is
  refused.
- **Built constructor.** `Function("return open")()` is blocked by rule 2.
  `(() => 1).constructor("…")` is blocked by rule 3.
  `x["con" + "structor"]` and `x[k]` with an unknown `k` are blocked by rule 4.
- **Reflection.** `Reflect` is blocked by rule 2. `Object.getPrototypeOf` and the descriptor
  functions are blocked by rule 3.

Numeric-guaranteed keys can only name array indexes or `NaN`, never `constructor`. Together with
computed writes, literal lookup tables and the `hasOwnProperty` chain, this keeps everyday k6 code
working:
- loop indexes;
- `data[Math.floor(Math.random() * data.length)]` and `users[(__VU - 1) % users.length]`;
- `headers[name] = value`;
- `STATUS[name]` on a `const` literal;
- `__ENV[name]`. A refused construct always has an explicit
rewrite, so the strictness costs a script edit rather than blocking the feature. This meets FR-006's
"a construct the check cannot rule out MUST be refused".

**Alternatives considered**:
- A blacklist of known escape strings: unsound, because keys can be built at run time.
- Refusing all computed access: too strict for ordinary k6 scripts (loops, `SharedArray` indexing).
- Wrapping the script to delete `open`/`require` at start: forbidden by FR-017 (no injection) and
  by the constitution (no rewriting).
- Running k6 inside an OS sandbox: not portable across Windows, macOS and Linux, and out of scope
  (XXVII).

## R4. Hosts found (FR-009)

**Decision**: Scan the script's whole text, comments included, for
`(http|https|ws|wss)://` followed by a host. Parse each match with the WHATWG `URL` parser and
record `scheme://host:port`, with the scheme's default port filled in. Skip a match whose host
contains `${`, because a template expression builds it. Sort the results by code unit and remove
duplicates.

**Rationale**: SC-005 requires 100% of hosts *written* as absolute URLs to be listed. Scanning the
whole text, not only string literals, cannot miss one, and an extra host from a comment only adds
caution to a confirmation. Template-built hosts cannot be known statically, and the confirmation
already says so (FR-014).

**Alternatives considered**: Literal-only scanning would give quieter lists but could miss a URL
that a script assembles from a comment-like string. It was rejected for SC-005.

## R5. Environment variable names read (FR-009, FR-025)

**Decision**: The names are collected from:
- `__ENV.NAME`;
- `__ENV["NAME"]` and expression-free templates;
- destructuring `const { NAME, OTHER: alias } = __ENV`.

The pass also finds `__ENV[T[k]]` where `T` is an unshadowed `const` object literal whose values
are all string literals, and lists each of those values as a name read. Each such name carries a
`suggestedSource` taken from its table key:
- the key `baseUrl` or `BASE_URL` suggests the base URL;
- any other key suggests the environment value of that name.

This is how a generated script's `VALUE_ENV` table (R23) yields `APIPILOT_V_0`, and so on, already
mapped to the values the guided or quick plan used.

Each name is listed once, sorted. Any other `__ENV[expr]` with a run-time key adds nothing; the
engineer adds that name to the mapping by hand (US2 scenario 3). Since the table's entries could be
overwritten at run time, the list stays informational and carries the same "values built at run
time cannot be found" note. A name that FR-026 would refuse is listed with
the reason, so the engineer sees that it cannot be mapped.

## R6. Upload transport and byte fidelity (FR-002, FR-010)

**Decision**:
- **Upload** is `POST /api/user-scripts/upload?name=<name>` with an `application/octet-stream`
  body, parsed by `express.raw` with a 1 MiB limit on that route only.
- **Editor saves** are JSON (`{ name?, content }`), and the stored bytes are the UTF-8 encoding of
  `content`.
- **Validation:** content must decode as UTF-8 with `TextDecoder("utf-8", { fatal: true })` and
  contain no NUL character. Otherwise it is refused as `not_utf8_text`.
- **Replacing a script's content with an upload** (spec FR-016, "a new upload"): send
  `PUT /api/user-scripts/:id/content?baseSha256=<sha>` with an `application/octet-stream` body.
  It follows the same rules as an editor save, so the confirmation is cleared.
- **Hashing:** the SHA-256 is taken over the stored bytes.
- **Download** returns the stored bytes exactly.
- **Line endings:** the browser's textarea turns CRLF into LF. An uploaded CRLF script edited in
  ApiPilot is therefore saved with LF line endings. Any save is a new version needing confirmation
  anyway, and the editor says so.

**Rationale**: A raw body keeps the uploaded bytes exact, so the SHA-256, the download and the
executed copy all match (SC-003). Server-side decoding catches invalid UTF-8; a browser would
replace it silently. This route does not use `multer`.

**Alternatives considered**:
- `multer` like other uploads: the lockfile resolves `multer` 1.4.5-lts.2, which npm marks
  deprecated with known vulnerabilities fixed in 2.x. This feature avoids adding a use of it.
  Upgrading the existing uses is a separate bugfix and is outside AP-034 (noted in plan.md).
- Reading the file in the browser and sending JSON: the browser's decoding hides invalid bytes and
  can change line endings, so the bytes would not be the uploaded file.

## R7. Script storage (FR-002, FR-003)

**Decision**: A new SQLite table `user_scripts`, in the AP-025 database:
- **Content** is encrypted with the existing AES-256-GCM `credentialCipher`, the same protection as
  environment values.
- **Plain columns:** id, session id, name, size, SHA-256, timestamps, and the confirmation's
  SHA-256 and time.
- **Encrypted columns:** the hosts stated at confirmation, encrypted like the content.
- **Settings** (mapping names, load choice, thresholds) are a JSON column holding no values.

The check result (hosts, names, default function, problems) is not stored. It is recomputed from
the decrypted content and memoised in process by SHA-256; FR-008 makes it deterministic. Rows are
deleted with the session through the session registry's `onExpire` listener, like environments.

**Rationale**: Content and anything derived from it are treated as sensitive (XVII). Recomputing
derived data avoids a second encrypted copy that could drift from the content. Storing only the
current content meets the spec: runs keep the name and SHA-256, not the content (FR-041).

**Alternatives considered**: Keeping every version was rejected, because the spec does not require
it and it would multiply the sensitive data kept.

## R8. Confirmation bound to content (FR-013 to FR-016)

**Decision**:
- `POST /api/user-scripts/:id/confirmation` takes `{ sha256 }`, which is the SHA-256 the
  confirmation dialog showed. It succeeds only when that equals the current content's SHA-256.
  Otherwise it returns `409 script_changed`.
- It stores `confirmed_sha256`, `confirmed_at` and the hosts listed.
- A script is confirmed exactly when `confirmed_sha256 = sha256`.
- A content change sets the new SHA-256 and clears the confirmation in the same statement. A rename
  touches neither.

**Rationale**: Binding the confirmation to a hash the dialog displayed means what the engineer
accepted is what runs. The existing uploaded-collection confirmation is a bare timestamp that edits
do not clear, so it cannot be reused here.

## R9. Run storage and the shared execution slot (FR-023, FR-030, FR-041)

**Decision**:
- **Table.** A new table `user_script_runs`. It holds the run's id, session id, script id, status,
  cancel reason, failure category, cancel-requested flag, k6 version, k6 exit code, planned duration
  (null when the script's own load is used), start and end times, and progress.
- **Encrypted columns.** The environment snapshot is a plain column, as in AP-029. These are
  encrypted:
  - the run snapshot: script name and SHA-256, load used, mapping names and sources, ApiPilot
    thresholds, hosts found;
  - the result;
  - k6's error message.

  Request names, hosts and k6's messages come from the user's script and can carry anything.
- **Shared slot.** The three copies of the "one execution in progress" check
  (`api/performanceRuns.ts:63`, `api/testGenerationWorkflow.ts:793`, `api/externalCollections.ts:467`)
  move into one helper, `findExecutionInProgress()`. It checks the four run stores, and every start
  route uses it.
- **Restart.** Recovery marks in-progress user-script runs as cancelled with reason
  `backend-restart`. Leftover run directories are already removed by the shared k6 run directory
  sweep.

**Rationale**: A separate table keeps `PerformanceRun.planSnapshot` required, and the guided and
quick code untouched. It also lets this run kind encrypt fields that `performance_runs`
deliberately leaves plain. Merging the slot check is the smallest way to add a fourth run kind
without a fourth copy.

**Alternatives considered**: Reusing `performance_runs` with `plan_source = 'user-script'` would
need `planSnapshot` to become optional, or a union, across every guided and quick consumer. It
would also leave user-derived names unencrypted.

## R10. Command line for a user script (FR-017, FR-018, FR-022, FR-027)

**Decision**: `buildUserScriptK6Args(runDir, load)` returns:

`run --no-usage-report --quiet --no-color --log-format json
--system-tags proto,subproto,status,method,url,name,group,check,error,error_code,tls_version,scenario,service,expected_response
--out json=<runDir>/metrics.ndjson [--stage <d>s:<target> …] <runDir>/script.js`

- `--stage` flags are added only when a load profile is chosen, one per stage, in order.
- A unit test pins the arguments as a reviewed contract, like the existing `buildK6Args` test.
- No `--summary-export`, `--summary-mode` or `--no-summary` is passed. Summary file writing is
  closed by R3 rule 6. The summary flag differs between k6 1.0 (`--no-summary`) and current
  releases (`--summary-mode=disabled`), so depending on it would tie the safety rule to a version.
- `--system-tags` on the command line overrides a script's `systemTags`, so the report always
  receives `name`, `url`, `method`, `status`, `group` and `check`.

**Rationale**:
- `--out`, `--log-output` and `--summary-export` can be set only on the command line or in the
  environment, never in script `options`. The fixed command line plus the filtered environment
  (R11) therefore mean no remote output can be enabled (FR-022, SC-007).
- k6 documents that command-line `--stage` overrides scenarios defined in the script, which is the
  FR-027 override.
- `--log-format json` lets ApiPilot tell console output apart from k6's own errors (R13).

## R11. The k6 process environment (FR-022, FR-038, FR-026)

**Decision**: `buildUserScriptChildEnv(processEnv, mapped)` starts from the same start-up
allow-list as `buildChildEnv`:
- `PATH`;
- on Windows, `SystemRoot`, `TEMP` and `TMP`;
- on POSIX, `HOME` and `TMPDIR`.

It then adds each mapped name with its resolved environment value. Names that collide with the
start-up variables, compared without case, are refused in the mapping (FR-026), along with names
starting with `K6_`. *This plan adds the start-up names to FR-026 (spec amendment note).* Values are
never placed in the command line.

**Rationale**: k6 exposes the process environment as `__ENV`, so the mapping reaches the script
without rewriting it. Building the environment from an allow-list means a `K6_OUT` or
`K6_CLOUD_TOKEN` on the backend machine never reaches k6 (SC-007). Refusing collisions stops a
mapped value from replacing `PATH` and changing which binaries k6 starts.

## R12. Mapping resolution and missing values (FR-025)

**Decision**:
- **Initial mapping.** A script starts with one entry per name found:
  - a name with a `suggestedSource` (R5) maps to that source;
  - `BASE_URL` maps to `{ kind: "base-url" }`;
  - every other name maps to `{ kind: "environment-value", valueName: <same name> }`.
- **Edits.** The engineer can change an entry's source, remove an entry, or add a name.
- **After a content change,** names now found and not yet mapped are added. Names the engineer
  removed are remembered in `removedNames` and are not re-added. Entries for names no longer found
  are kept and marked "not found in the script".
- **Missing values.** Resolution happens only at run start. A mapped value that is missing from the
  chosen environment is shown as missing beforehand, and the name is not set for k6.
- **Secrecy.** Environments carry no per-value secret flag, so every mapped value is treated as
  secret. The mapping, the run, the report and the UI show names and sources, never values.

**Rationale**: This is the spec's default with the least surprise. Treating every value as secret
is stricter than the spec and needs no new environment field.

## R13. k6 output that is not metrics (FR-029, FR-039, FR-040)

**Decision**: stderr is read as JSON log lines (R10):
- a line with `source: "console"` is discarded unread;
- lines that do not parse are counted and discarded;
- k6's own `level: "error"` messages are kept in memory, up to 2,000 characters in total.

The kept text is stored, encrypted, only when the run fails. It is shown only on that run's page
and is never logged. Logs carry counts only, as today.

The exit code is recorded and interpreted from a fixed table taken from k6's
`errext/exitcodes`:

| Exit code | Meaning | Status |
|---|---|---|
| 0 | completed | completed |
| 99 | thresholds the script defines were crossed | completed |
| 108 | aborted by the script | completed |
| 110 | the script marked the run as failed | completed |
| 104 | invalid configuration | failed, `k6-exited-with-error`, with message |
| 107 | script exception | failed, `k6-exited-with-error`, with message |
| any other non-zero, with no request measured | | failed, `k6-exited-with-error`, with message |
| any other non-zero, with requests measured | | completed, with the exit code noted |

**Rationale**: The JSON log format is the only reliable way to keep the script's `console.log`
output (FR-040) away from k6's start-up errors (FR-029). The existing behaviour, a non-zero exit
with points counted as completed, is kept, but the meaning is now reported.

## R14. Aggregating a user script's metrics (FR-031 to FR-035)

**Decision**: A new aggregate, `createUserScriptAggregate`, reads the same NDJSON stream with the
shared `LineSplitter` and `parseMetricsLine`, in a mode that accepts every metric and also reads
`type: "Metric"` declarations (metric type and the script's threshold expressions). It reuses
`LatencyHistogram`.

What it keeps:
- **Per request group.** Groups are keyed by display name, the first 100 in order of first
  appearance, then one "Other requests" group with a count of combined names. Each group has
  latency percentiles and exact min/mean/max, throughput, failure rate from `http_req_failed`
  (k6's own count), statuses with counts, request phases, write requests sent and succeeded per
  method, and a timeline.
- **Run totals.** The same measures as each group, plus iteration duration, data sent and received,
  and virtual users.
- **Hosts that received requests.** Origins of the `url` tag, at most 50, with a count of others.
- **Checks.** Pass rate per check name, at most 100.
- **Groups the script uses.** At most 100, with `group_duration` statistics.
- **Custom metrics.** At most 100, summarised by type:
  - counter: total and rate;
  - gauge: last, min and max;
  - rate: percentage true;
  - trend: percentiles and min/mean/max.
- **The script's threshold expressions,** from the `Metric` declarations.

**Display name rule (FR-032):** if `name` equals `url`, or `name` parses as an absolute URL, the
request was not named. Its display name is `METHOD host/path`, with user info, query and fragment
removed. Otherwise the display name is `name` as given. The raw `url` and `name` tags are used only
in memory and never stored.

**Timeline:** for the script's own load, the planned duration is unknown. Buckets therefore start
at 5 s and double, merging pairs, whenever more than 200 would be needed. With a profile, the
existing `timelineBucketMs(planned)` is used.

**Rationale**:
- First-appearance order is deterministic for the same stream and bounds memory, unlike "top 100 by
  count", which needs every name kept until the end.
- `http_req_failed` is what k6 itself counts as failed.
- Bucket doubling keeps the existing chart's resolution on long soaks without knowing the duration
  in advance.

## R15. ApiPilot thresholds for a user script (FR-028, FR-035)

**Decision**: `UserScriptThreshold` reuses `PerformanceThresholdMetric` and the `<=` comparator.
Its scope is `{ kind: "run" } | { kind: "request-name"; name }`. Evaluation is the AP-029 rule over
the user-script result: a threshold with nothing measured fails. For the script's own thresholds,
the report lists each threshold expression the script defines, by metric, and gives k6's overall
outcome from the exit code: crossed (99), or not crossed. Per-expression pass/fail is not shown,
because k6's metrics stream does not carry it.

**Rationale**: This shows "the outcome k6 gives" (FR-035) without re-implementing k6's threshold
language or depending on `--summary-export`, which k6 discourages and which the summary flags
would disable.

## R16. The report (FR-030 to FR-036)

**Decision**: A new renderer, `renderUserScriptReport(run)`, reuses the helpers of
`renderHtmlReport.ts`: escaping, scales, timeline SVG, phase table, styles and the CSP meta. Those
helpers are exported from that module, not copied. The report keeps the same self-contained rules:
no script, no external asset, every string escaped, locale-free numbers.

Findings come from a new fixed ruleset, `USER_SCRIPT_FINDINGS_RULESET_VERSION = 1`, with ties
broken by display name:
- an ApiPilot threshold failed;
- the script's thresholds were crossed;
- the slowest request group by p95;
- where failures start;
- the most frequent failing status;
- names combined into "Other requests";
- hosts other than the environment's base URL received requests;
- the script aborted or marked the run failed.

**Rationale**: Reusing the helpers keeps one report look (XXXIII). A separate ruleset keeps
AP-029's step-based findings unchanged.

## R17. Readiness, trigger and run-start checks (FR-017, FR-019 to FR-021)

**Decision**: `POST /api/user-scripts/:id/runs` takes `{ environmentId, scriptSha256 }`.
`scriptSha256` is the SHA-256 the trigger displayed. The checks run in this order, and the first
failure is returned:
1. the script exists (404 `script_not_found`);
2. it is confirmed and `scriptSha256` matches the confirmed and current SHA-256
   (409 `script_not_confirmed` / `script_changed`);
3. a load profile override is not chosen for a script with no default function
   (409 `load_override_unavailable`);
4. k6 is ready, rechecked (409 `k6_unavailable`);
5. the environment exists (404 `environment_not_found`);
6. the execution slot is free (409 `execution_in_progress`).

Between checks 1 and 2, the stored content is checked again with the current rules, using the
memoised result. If it is now refused, for example because a later release tightened the check,
the start fails with 422 `script_refused { problems }`. A confirmation cannot make a script runnable
that the current check refuses (constitution XVII: "checked before it is stored" is necessary, not
sufficient).

The background run then:
1. decrypts the content;
2. writes `script.js` (mode 0600) into the run directory;
3. re-reads the file and compares its SHA-256 with the confirmed one, failing as
   `script-integrity-failed` without spawning k6 on a mismatch;
4. spawns k6 with R10 and R11.

The run directory, and so the working copy, is removed when the run ends (FR-041). Cancellation,
ticks, session keep-alive and the `liveHandles` map are the existing ones.

**Rationale**: This is the AP-029 order, extended with the confirmation check, and it reuses
AP-029's integrity check unchanged.

## R18. Environment access (FR-024)

**Decision**: `requireEnvironmentAccess()` in `api/testGenerationWorkflow.ts:166` also passes when
`hasUserScript()` is true for the session, meaning at least one row in `user_scripts`. Nothing else
about environments changes.

## R19. The script editor (FR-010 to FR-012)

**Decision**: A `ScriptEditor` component with no new dependency, built from three layers:
- a native `<textarea>` as the only interactive layer, labelled and keyboard accessible;
- an `aria-hidden` highlighted `<pre>` behind it, kept in sync on scroll;
- an `aria-hidden` line-number gutter.

Highlighting comes from a small tokenizer, `highlightJavaScript.ts`, for comments, strings,
templates, numbers, keywords and punctuation, with Tailwind token classes. It runs debounced, and
is turned off above 256 KiB with a visible note, so typing stays responsive near the 1 MiB limit.

Refusal reasons are listed under the editor as "Line N, column M: message", and marked in the
gutter with a text marker, not colour alone. Leaving with unsaved changes opens the existing
`ConfirmDialog`. Nothing in the editor evaluates the script.

**Rationale**: The repository has no code editor today; every editor is a `<textarea>`. CodeMirror
or Monaco would add hundreds of kilobytes and a new dependency family for one screen.
Approximate highlighting is enough to read a script, and the authoritative check is server-side.

**Alternatives considered**:
- CodeMirror 6: rejected for size.
- Prism: still needs the overlay, so it saves little.
- No highlighting: fails FR-010.

## R20. Frontend structure (FR-001, FR-003, FR-019, FR-023)

**Decision**:
- **Entry.** A fourth entry `"user-script"` in `EntryChooser`, and a fourth tab and mounted page in
  `App.tsx`. `mount()` is generalised so it no longer assumes three views.
- **Page.** `UserScriptPage` lists the session's scripts. A selected script has three tabs:
  - **Script:** the editor or viewer, check results, rename, download, delete;
  - **Run setup:** environment, mapping, load, thresholds, confirmation, trigger;
  - **Runs & reports.**
- **Reused components:** `EnvironmentPicker`, `LoadProfileEditor`, `PerformanceReportFrame`,
  `ConfirmDialog`, `StatusBadge`, `EmptyState`, `ErrorState`, `TIER_TONE` and `runStatusLabel`.
- **Runs hook.** `usePerformanceRuns` becomes generic over the run type, typed against a narrowed
  `PerformanceRunsClient` interface. Existing callers are unchanged.
- **Thresholds editor.** `ThresholdEditor` takes the scope choices as a prop, so it can offer
  request names: a free-text name, with the last run's names suggested.

## R21. Tests (XXI, SC-001 to SC-010)

**Decision**:
- **Unit, the check:**
  - an accepted corpus of common k6 patterns;
  - a refused corpus of at least 25 scripts, each breaking one rule, with its expected rule id and
    line (SC-001);
  - a determinism test that checks the same bytes 10 times (SC-010);
  - host and name extraction (SC-005);
  - generated scripts for the guided and quick fixture plans are accepted, with their
    `APIPILOT_V_<n>` names and suggested sources (R23).
- **Unit, the run machinery:**
  - the pinned argument list;
  - the child environment with `K6_OUT` and `K6_CLOUD_TOKEN` set in the parent environment (SC-007);
  - mapping validation;
  - the exit-code table;
  - stderr filtering, so console lines are dropped and the error is capped at 2,000 characters;
  - the aggregate, display-name rule, 100-name cap and bucket doubling, over NDJSON fixtures;
  - findings determinism;
  - report self-containment.
- **Integration (Supertest, fake runner):**
  - upload, refusal, nothing stored on refusal;
  - confirmation and the SHA-256 races;
  - every run-start refusal in R17's order;
  - the shared slot across all four run kinds;
  - restart recovery;
  - session expiry;
  - the environment gate;
  - a seeded-secret scan of responses, the database file, the report and the log file (SC-004).
- **Frontend (React Testing Library):** entry, list, editor (unsaved-changes prompt, reasons at
  lines), confirmation, mapping, trigger content, and the runs view.
- **Opt-in real k6** (`npm run test:k6-real -w backend`), one user-script run against
  `perfStubTarget`, which checks:
  - the `name`/`url` tags arrive;
  - `--stage` overrides the script's scenarios;
  - exit code 99 on a crossed script threshold;
  - console output is absent from what is stored.

## R22. Out of scope, noted for follow-up

- **Multer.** Upgrading `multer` 1.x to 2.x for the existing uploads is a security-relevant bugfix
  of its own.
- **k6 REST API.** k6 starts its local REST API on `localhost:6565` for every run, generated or
  user-supplied. That is existing behaviour, unchanged here.
- **Opening a generated script in the editor.** Out of scope per the spec. Download and upload
  covers it, now that generated scripts pass the check (R23).
- **Request names.** A generated script tags requests with `step` and `journey`, and sets no
  `name`. Run under AP-034, its requests are therefore grouped by method, host and path. Paths
  with ids captured at run time can exceed 100 names and fall into "Other requests". Naming
  generated requests would change AP-029's metric tags and its real-k6 assertions, so it is left
  for a later amendment.

## R23. AP-029's generated script passes the check (AP-029 FR-022a)

**Decision**: Change the fixed runtime in `backend/src/performance/k6/renderScript.ts` so that the
generated script passes R2 to R5 as written. Each change keeps behaviour:

| Current construct | Replacement |
|---|---|
| `const VALUE_INDEX = { name: index }` read as `__ENV["APIPILOT_V_" + index]` | `const VALUE_ENV = { name: "APIPILOT_V_<index>" }`, read as `__ENV[VALUE_ENV[name]]` behind an `Object.prototype.hasOwnProperty.call(VALUE_ENV, name)` guard. The name order is unchanged (`plan.userSuppliedValues`). |
| `scope.vars[name]`, `scope.tokens[name]` and their writes | `scope.vars` and `scope.tokens` become `Map`s (`.has`, `.get`, `.set`). `tokenScope()` returns a `Map`. |
| `vuTokens[scheme]` | `vuTokens` becomes a `Map`. |
| `setup()` returning `{ tokens: { [scheme]: token } }`, read as `data.tokens[scheme]` | `setup()` returns `{ tokens: [{ scheme, value, acquiredAtMs, lifetimeS }] }`, an array, because k6 passes setup data to virtual users as JSON, which a `Map` cannot cross. The default function fills `vuTokens` from it. |
| `value = value[part]` in `jsonField` | An own-field walk: `for (const [key, child] of Object.entries(value)) if (key === part) …`. This also fixes a latent defect: an inherited name such as `toString` or `length` no longer counts as an extracted value. |

- **Header comment.** It also says that an edited copy can be run only as the engineer's own
  script under AP-034.
- **Unchanged:** `SYSTEM_TAGS`, the imports, `options`, the `valueIndex` returned to the runner,
  the environment template, the metrics and tags emitted, and `buildK6Args`.
- **Fixtures and tests.** The golden script fixture is regenerated and its diff reviewed. The k6
  sandbox tests must keep passing unchanged: auth, extraction, missing data, cut-short journeys,
  per-virtual-user refresh, unique values.

**Rationale**: The user wants to download a generated script and run it, changed or not, as their
own (2026-10-01). Making the generator emit check-clean code keeps the check strict for every
script. Generation stays deterministic (constitution XVI), and AP-029 runs still execute only the
unmodified generated bytes (AP-029 FR-026).

**Alternatives considered**:
- Loosening R3 for generated scripts: rejected. Any marker that identifies a generated script can
  be copied into another script.
- GJSON `response.json(selector)` for the field walk: rejected. Its special characters would need
  escaping, and the Node sandbox tests would need a GJSON stub.
