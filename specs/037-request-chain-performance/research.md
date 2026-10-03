# Research: Request-Chain Performance Plans (AP-037)

**Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Each decision states what was chosen, why, and what else was considered. References: FR and SC
are this spec's; "AP-0xx FR-yyy" are earlier specs'. Paths are relative to the repository root.

The existing code was surveyed before deciding. The relevant findings are:
- **Model.** The performance plan is `PerformancePlan` in `packages/shared-domain/src/performance.ts`
  (1,106 lines). It is re-derived by `buildPlan` / `assemblePlan`, with overlays added by AP-033,
  AP-035 and AP-036.
- **Runtime.** `backend/src/performance/k6/renderScript.ts` holds one fixed runtime, shared by every
  plan source.
- **Seam.** The three sources reach the shared routes through `PlanEngine`.
- **Runs.** Runs are stored in `performance_runs`. Their reports are rendered on request from the
  stored snapshot and result (`renderHtmlReport`).

---

## R1. A new plan model beside the old one, not inside it

**Decision**: A request-chain plan is a new shared-domain type, `ChainPlan`, with its own pure
modules (`backend/src/performance/chain/`), store, routes (`/api/chain-plans`), runtime and report.
It does not implement `PlanEngine` and is never a `PerformancePlan`. In phase one the old plans are
left byte-for-byte unchanged. Phase two deletes them (R24).

**Rationale**:
- The old model's defining property is that it is re-derived, which FR-026 forbids.
- `PerformancePlan` carries about 20 fields that exist only for overlays, re-derivation or
  fingerprints of upstream approvals. Shaping a chain plan to fit it would bring all of that along.
  It would also make phase two a refactor instead of a deletion, which works against SC-006.
- Leaving the old runtime untouched means no existing golden is regenerated. **Run again** on
  existing runs keeps working throughout phase one, because the AP-029 FR-024a comparison is by
  script SHA-256.

**Alternatives considered**:
- **A fourth `PlanEngine` source:** rejected. The engine's operations (`applyUpdate`, `reset`,
  `removedPreview`, `responseFields`) all assume a derived plan.
- **Converting chain plans to `PerformancePlan` for rendering:** rejected. Every chain feature
  (checks, runs settings, data sets, iteration-scoped values) would need a matching old-model field.

## R2. Saved plans: one table, an encrypted document, an optimistic revision

**Decision**: Add a new `chain_plans` table under AP-025, created with `CREATE TABLE IF NOT EXISTS`
the way every earlier table was (`connection.ts`). It has these columns:
- `id`, `session_id`, `name`, `revision`;
- `document_encrypted`, `document_iv`;
- `fingerprint`, `created_at`, `updated_at`.

The document is the whole `ChainPlan` JSON: chains, steps, settings and the seeding report. Data
set metadata is in its own table (R14).
- **Encryption.** The document is encrypted with the existing credential cipher (AES-256-GCM,
  `persistence/credentialCipher.ts`). It holds no secret value (FR-027), but step content is the
  engineer's own and can carry anything. AP-034 drew this line for `user_scripts`, and this table
  follows it.
- **Plain columns.** `name`, `revision`, `fingerprint` and the timestamps stay plain, so the plan
  list can be read without decrypting.
- **Saving.**
  - Every save is a whole-document `PUT` carrying the `revision` the client last read.
  - A stale revision is refused with `409 plan_revision_conflict` and the current plan. Nothing is
    merged silently.
  - The frontend saves after each completed edit (field blur, add, move, delete), not on every
    keystroke.
- **Session ownership.** A plan is owned by the session and removed with it. `chainPlanStore.ts`
  registers the same `onExpire` cleanup as `performanceRunStore.ts` (AP-029 FR-034). A plan reopens
  unchanged after a restart (FR-039, SC-008).

**Rationale**: Whole-document saves keep the server API to one write route and make "the plan as
saved" a single value. That value is what the analysis (R6), the fingerprint (R22) and the
`Changed` flags (R9) are computed from. The limits (R26) keep the document at most 8 MiB.

**Alternatives considered**:
- **Per-step and per-chain routes:** smaller payloads, but more routes, partial-update ordering
  problems and harder conflict handling.
- **Plain JSON column:** rejected. Step bodies and headers are user content of unknown
  sensitivity.
- **Keeping plans in memory:** rejected by the clarification of 2026-10-02.

## R3. Shared-domain contracts and one pure analysis used by both sides

**Decision**: Add a new `packages/shared-domain/src/requestChain.ts`. It holds the types (see
data-model.md) and these pure functions:
- `parseReferences(text)`: the `{{name}}` grammar (R5);
- `analyzeChainPlan(plan, context)`: blockers, required values, hosts, extractor overlaps and unused
  data set columns (R6, R7);
- `summarizeChainWrites(plan)`: the write summary, per step (AP-032 FR-009 to FR-012a, FR-031);
- `chainRunOrder(plan)`: the order of setup steps, then iteration positions.

`parseCapturePath` and `formatCapturePath` (the AP-035 closed field-path grammar) move from
`backend/src/performance/plan/capturePath.ts` into the shared package unchanged. The backend file
re-exports them, so AP-035 callers are untouched.

**Rationale**:
- The editor needs to know at once that `{{customer_id}}` is used before it is extracted (FR-014),
  without a round trip.
- The backend must enforce the same rule before generating a script and before a run.
- One pure function serves both, so the two cannot drift (CLAUDE.md §4, §44).
- The function takes the environment's value names, never its values, so the shared package stays
  free of secrets and of I/O.

**Alternatives considered**: Server-only analysis returned on every save. The analysis is still
returned on save, as the authority, but a save-only signal is too slow while the engineer types `{{`.

## R4. A step is concrete text with a fixed shape

**Decision**: A `ChainStep` has these request fields:
- `method`: GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS.
- `url`: scheme, host, path and any references, with no `?` or `#`.
- `query`: an ordered list of `{ name, value }`.
- `headers`: an ordered list of `{ name, value }`.
- `body`, which takes one of three forms:
  - `{ kind: "none" }`;
  - `{ kind: "raw", contentType, text }`;
  - `{ kind: "form", fields: { name, value }[] }`.

**Editing rules**:
- When the engineer pastes a URL with a query, the editor splits it into the list. The server
  refuses a `url` that contains `?` or `#` (`422 invalid_step`), so a step has one canonical form.
- `Host` and `Content-Length` header names are refused with the reason the editor shows (Edge Cases).
- For a raw body, `contentType` becomes the `Content-Type` header unless the step's headers already
  name one. The header list wins, as in Postman.
- References in a raw body are filled JSON-escaped when the effective content type is
  `application/json` or `*+json`. Otherwise they are filled as they are. This is today's `json`
  fill mode: it keeps a value containing a quote from breaking the document. It does not quote an
  unquoted reference, so `"age": {{age}}` stays the engineer's responsibility, as in Postman.
- Form fields are URL-encoded after filling.

**Rationale**: This is the Postman and JMeter shape the spec asks for (FR-003). Separate query rows
let each name and value be filled and encoded on its own (FR-004).

**Alternatives considered**:
- **A single URL string with an inline query:** ambiguous encoding of references inside it.
- **Multipart bodies:** out of scope (Assumptions).

## R5. References, dynamic variables and value scopes

**Decision**:
- **Grammar.** `{{name}}` where `name` is `[A-Za-z0-9_]+`, or `{{$name}}` for one of the 13 supported
  dynamic variables (AP-036 FR-013, `SUPPORTED_DYNAMIC_VARIABLES` in
  `backend/src/performance/collection/dynamicValues.ts`, which moves to shared-domain).
  - Any other `{{…}}` text is an `invalid-reference` blocker.
  - A lone `{{` or `}}` is literal text.
  - References may appear in the URL, every query name and value, every header value, raw body text,
    every form field name and value, and a check's expected value (FR-004, FR-016). They may not
    appear in header names.
- **Resolution order (FR-013):**
  1. a value extracted earlier for this virtual user;
  2. the current row of the data set that has that column;
  3. the target environment.

  `baseUrl` is always the environment's base URL, as today.
- **Scopes (FR-010).** Each virtual user keeps three maps: setup values (shared and read-only),
  per-virtual-user values, and iteration values.
  - At the start of each iteration, the iteration map is cleared and the working view is rebuilt
    from setup values, then per-virtual-user values.
  - Each extraction then writes into the working view and into its own scope's map. The latest
    write in run order wins, which is the edge case "a later extractor replaces the value for the
    steps after it".
  - Clearing the iteration map means a failed extraction never leaves the previous iteration's
    value in place (Edge Cases, "Stale values").
- **Dynamic variables.** At generation, each occurrence of `{{$x}}` is rewritten, in plan order, to
  `{{apipilot_dyn_<k>}}`, as `rewriteDynamicValues` does today. Each occurrence therefore gets its
  own value, as in Postman. The values are produced by the same generator code as AP-036
  (virtual user, iteration, occurrence, run tag), copied into the chain runtime.

**Rationale**: The scopes come straight from FR-008 and FR-010. A single working view keeps lookups
O(1) and makes "latest write wins" literal.

**Alternatives considered**:
- **Precedence by scope (iteration over per-virtual-user over setup):** rejected. It contradicts
  "latest write wins" when a per-virtual-user step comes after an every-iteration extractor of the
  same name.

## R6. Use before extraction, and what a setup step may use (FR-014, FR-015)

**Decision**: `analyzeChainPlan` walks the run order, which `chainRunOrder` defines:
1. **Once before load** steps, in plan order (chain order, then step order).
2. Then one iteration: every chain in order, each step in order, skipping setup steps.

**Checks:**
- **Use before extraction.** A step's use of a name that some step extracts is valid only when an
  extractor of that name comes earlier in run order.
  - A setup extractor counts for every later position.
  - A per-virtual-user or every-iteration extractor counts only for positions after it in the same
    iteration.
  - Otherwise the use is a `use-before-extraction` blocker naming the step and the name. Moving
    steps is never refused.
- **Setup steps.** A setup step may use only:
  - environment values;
  - dynamic variables;
  - extractions by earlier setup steps;
  - **data set columns**, which take the first row (FR-043 and the Edge Case "Data set used by a
    Once before load step").

  Anything else is a `setup-uses-iteration-value` blocker. This keeps FR-043 consistent with FR-014,
  whose list omits data sets (**Open item 1**).
- **Required values (FR-015).** Every other name is a required environment value. It is listed with
  the steps that use it, whether it is secret (`plan.secretNames`), and whether the target
  environment provides it.
  - A missing value does not block. It is handled at run time as AP-029 FR-014: missing data,
    nothing sent.
  - A data set column that is also an environment value name is listed as shadowing it (Edge Cases).
- **Other blockers:**
  - a step with no expected status (FR-006);
  - an invalid field path or header name;
  - a URL whose host comes from a variable (R7);
  - an invalid reference;
  - a duplicate data set column name (FR-042).

  A chain with no step that runs in the iteration is listed as `empty-chain` but does not block
  (Edge Cases).

**Rationale**: FR-014's rule is a statement about run order. Computing the order once and checking
positions against it is linear in the number of steps.

## R7. Hosts (FR-029)

**Decision**: A step URL must start with one of these:
- `{{baseUrl}}`;
- a literal `http://` or `https://` scheme and host, with an optional port.

A URL whose scheme or host contains any other reference is a `host-from-variable` blocker. A URL
with neither form is `invalid-url`. `analyzeChainPlan` returns the distinct hosts in plan order:
the base URL first, as the environment's base URL, then each literal origin. The plan, the run
trigger and the run snapshot list them. The runtime builds URLs only from these forms, so the
script cannot send anywhere else (constitution XVII, "requests go only to the base URL and literal
hosts").

## R8. Literal credentials (FR-027)

**Decision**: On every save, the server moves literal credentials into secret environment values
before the document is stored. Two kinds of literal are detected:
1. **Headers.** An `Authorization` or `Proxy-Authorization` value is literal when text remains
   after removing an optional leading scheme word (such as `Bearer` or `Basic`) and its references.
   For `Cookie`, any text left after removing references makes the value literal.
   - The literal part after the scheme word becomes the environment value.
   - The step keeps `Scheme {{name}}`.
   - A value that mixes literal text with references, such as `Bearer abc{{x}}`, is refused with
     `422 credential_mixed_literal`, because the move cannot be done exactly.
2. **Password fields.** A JSON body field the seeding operation declared `format: password`. The
   seeder records those field paths on the step's source as `passwordFields` (R15). After seeding
   the plan is never compared with the specification (FR-026), so this needs no access to it. A
   string at one of those paths that is not a single reference is moved.

**The move**:
- **Name.** `<header-or-field>_<stepId>`, lower-cased with non-word characters replaced by `_`,
  and suffixed `_2`, `_3` and so on when the name is taken. The name is deterministic.
- **Writes.** The value goes to `environment.variableValues` of the plan's target environment
  through `environmentStore`, encrypted at rest as today. The name is added to `plan.secretNames`.
- **Response.** It returns `movedCredentials: [{ stepId, location, name, environmentName }]`, which
  the editor announces (FR-027, "told which value was moved and where").
- **No target environment.** The save is refused with `422 credential_needs_environment`, naming
  the header or field. No literal is ever stored to be moved later (**Open item 3**).

Seeding never refuses. A literal found while seeding moves when the seed request names an
environment. Otherwise it is dropped: the reference stays, and the seeding report lists the name as
a secret value to provide (R18).

**Rationale**: The constitution requires that no literal credential reaches the plan. A plan with no
environment has nowhere to put one, so the only safe outcomes are to refuse or to drop it, and each
is stated.

**Alternatives considered**:
- **Holding the literal in memory until an environment is chosen:** the plan would hold a secret.
- **Moving every header value that looks like a token:** guessing (constitution XIV).

## R9. Provenance and the `Changed` mark (FR-033)

**Decision**: Each step has a `source`, which is one of:
- `{ kind: "added" }`;
- `{ kind: "operation", operationKey, label, passwordFields }`;
- `{ kind: "workflow", workflowId, workflowName, operationKey, label }`;
- `{ kind: "collection", collectionId, collectionName, itemId, label }`.

A seeded step also stores `seedDigest`: the SHA-256 of its canonical step content (method, URL,
query, headers, body, expected statuses, extractors, checks, runs setting and think time) at
seeding. On every save, `changed` is recomputed as `digest !== seedDigest`.
- A step edited back to exactly its seeded content is therefore not marked changed.
- A duplicated step is `added`: the engineer created it.
- Moving a step between chains does not change its content, so it does not mark the step changed.

**Rationale**: A digest needs no copy of the seeded content and no access to the source after
seeding (FR-026). Recomputing on save keeps the flag true to the content rather than to the
history.

## R10. A second fixed runtime for chain plans

**Decision**: `backend/src/performance/k6/renderChainScript.ts` renders a chain plan into a script
with this layout:
- **Header.** A comment block (generated by ApiPilot, the plan fingerprint, no values).
- **Imports.**
  - `k6/http`;
  - `k6` (`check`, `sleep`);
  - `k6/metrics` (`Counter`);
  - `k6/execution` (iteration and virtual-user numbers, `test.abort`);
  - and only when the plan has data sets, `k6/data` (`SharedArray`).
- **`options`.** The load stages, and `systemTags` as today (no `url` or `name` tag, AP-029 FR-040).
- **Constant data tables.**
  - `VALUE_ENV`: value name → `APIPILOT_V_<i>`, as AP-029 FR-022a;
  - `THINK_TIME_S`;
  - `DYNAMIC`;
  - `DATA_SETS`: index, mode and column names, never values;
  - `SETUP_STEPS`;
  - `CHAINS`, where each step is its method, URL, query, headers, body, expected statuses,
    extractors, checks, runs setting, think time, needed environment names, used extracted names
    and refresh source.
- **`CHAIN_RUNTIME`.** One fixed text constant.

The legacy `RUNTIME` and `renderScriptFrom` are not changed. Phase two deletes them (R24).
- **What the engineer controls.** Only the JSON constants. Every byte of code is ApiPilot's.
  Extractors are a name plus a path or a header name; checks are one of four forms (R11). No
  expression, pattern or function is accepted (constitution XVII).
- **Determinism.** Key order and list order come from the plan, and JSON is serialized with stable
  spacing. The same plan therefore renders byte-identical text, tested ten times (FR-030, SC-004).
  Data set content never reaches the renderer (FR-047).
- **AP-034 compatibility (AP-029 FR-022a).** The runtime follows AP-034's checked subset: `Map`s,
  `const` literal tables and own-field walks. A script from a plan **without** data sets passes
  `checkUserScript`, which is tested. A script **with** data sets must call `open()`, which AP-034
  refuses by constitution. Its downloaded copy therefore cannot run as a user script, and the
  download says so (**Open item 2**).

**Rationale**: The chain semantics differ from the legacy runtime in many places: iteration-wide
scopes, runs settings, checks, the setup abort, data sets and plain headers instead of auth kinds.
Extending the shared runtime would change every legacy script's bytes, disable **Run again** for
every existing run (as AP-035 and AP-036 did) and couple two models that phase two separates anyway.

**Alternatives considered**: One runtime for both models. It is rejected for the reasons above.

## R11. Runtime semantics for one iteration

**Decision**: The default function does the following:
1. **Start of the iteration.** Rebuild the working view of values (R5). Take this iteration's data
   rows (R14).
2. **Each chain in order.** For each step that is not a setup step:
   - **Per-virtual-user steps.** Skip a **Once per virtual user** step that has already succeeded
     for this virtual user. It is marked done only on success, so a failed one is tried again next
     iteration (FR-019).
   - **Missing data.** If a needed environment name has no value, count `apipilot_missing_data`.
     Nothing is sent, and the step counts as not sent.
   - **Unavailable extracted value.** If an extracted name the step uses has no value in the
     working view, because its producer was not sent in this iteration, count `apipilot_not_attempted`
     with `reason: "dependency"`. Nothing is sent. Static order is already guaranteed by R6, so this
     covers only run-time absence.
   - **Token refresh.** For each refresh source the step uses, refresh it if due (R13).
   - **Send.** Build the request: fill the URL in `url` mode (each reference encoded except
     `baseUrl`), append the encoded query, fill headers raw, and fill the body (R4). Send it with
     tags `{ step, journey: chainId }` and `responseType: "text"` when the step has extractors or
     body checks, `"none"` otherwise.
   - **Status.** The expected-status check is a k6 `check` named `status`, as today. An unexpected
     status counts as a failed request.
   - **Extractors.** Attempted only on an expected status (FR-011). They succeed only for a
     non-empty string, a finite number or a boolean, using today's `captured()` walk. Each outcome
     is counted on `apipilot_capture` (`capture` = extractor name).
   - **Checks.** Always evaluated on a response. Each outcome is counted on
     `apipilot_check { step, check, outcome }`. A failed check never stops extractors or the chain
     (FR-017). The four forms are:
     - **field exists:** the walk finds a value, `null` included;
     - **field equals:** strict equality with the declared type (`text`, `number` or `boolean`), or
       the text of a resolved `{{name}}`;
     - **body contains:** a substring test on the response text;
     - **time at most:** `response.timings.duration <= maxMs`.
   - **A failed extractor.** Count `apipilot_cut_short { capture }` and count every remaining step
     of the chain as `not_attempted` with `reason: "cut-short"`. Then move to the next chain
     (FR-012).
   - **Think time.** After each step that was sent, sleep for the step's think time, or the plan
     default when it has none (FR-007).

**Rationale**: This is the spec's semantics written once. Counters reuse the legacy names, so the
existing aggregate's stream handling carries over (R19).

## R12. Setup steps, and stopping before the load (FR-018)

**Decision**: k6's `setup()` sends the **Once before load** steps in plan order, tagged
`{ apipilot_kind: "setup", setup_step }`. Those tags keep them out of every step's and the load's
figures (FR-034).
- **Inputs.** Each setup step resolves references from environment values, dynamic variables, the
  data sets' first rows and earlier setup extractions (R6).
- **Failure.** An unexpected status, no response, or a failed extractor ends the run before the
  load:
  1. count `apipilot_setup { setup_step, outcome: "failed", reason }`, where `reason` is one of
     `status`, `no-response`, `extractor:<name>` or `missing-data:<name>`;
  2. call `exec.test.abort("apipilot setup step failed")`.

  k6 then exits with code 108 and no virtual user starts.
- **Success.** A successful step counts `outcome: "ok"`. Its latency is read from the tagged
  `http_req_duration` sample.
- **Settling.** `runPerformanceTest` settles a chain run as `failed` with the new category
  `setup-step-failed` when it saw a failed `apipilot_setup` point. The result's `setupSteps` names
  the step and the reason. No retry is made (FR-018).
- **Fallback.** If exit code 108 arrives with no such point, the category is still
  `setup-step-failed`, and the reason is recorded as `unknown`.
- **Verification.** k6 flushes points emitted in `setup()` before an abort. An opt-in real-k6 case
  verifies this (R25).

**Alternatives considered**:
- **Today's behaviour (`setup-failed` counted, load continues):** rejected. FR-018 requires the
  load not to start.
- **`fail()`:** rejected. It aborts only the current setup call with an exception k6 logs to stderr,
  and is less explicit than `exec.test.abort`.

## R13. Token refresh for setup steps (FR-040)

**Decision**: A setup step is a refresh source when its response, at setup time, carries a positive
finite `expires_in` body field. This is today's rule, computed at run time (`acquire`); it is not
decided by the analysis.
- **Handover.** `setup()` returns, for each setup step, `{ values, acquiredAtMs, lifetimeS }`.
- **When to refresh.** Before each step that uses a name extracted by such a setup step (the
  renderer writes `refreshFrom: [setupStepId…]` per step), each virtual user refreshes at
  0.70 to 0.80 of the lifetime, staggered by virtual user (today's `refreshFraction`).
- **The refresh request.** It re-sends the setup step tagged `apipilot_kind: "token-refresh"`.
- **Counting.** A refresh is counted on `apipilot_token_refresh { step, outcome }` and never in a
  step's requests or latency.
- **A failed refresh.** It keeps the old value. Later 401 and 403 responses fall into the existing
  `authentication` category.
- **No lifetime.** A step without a stated lifetime is never refreshed. The report's
  "authentication after expiry" finding then says the lifetime was not stated (existing rule
  `authentication-after-expiry`).

## R14. CSV data sets (FR-041 to FR-047)

**Decision**:
- **Parsing.** A new pure module, `backend/src/performance/chain/csv.ts`, implements RFC 4180. No
  dependency is added: the repository has no CSV library, and the grammar is about 80 lines.
  - It accepts UTF-8 (BOM stripped; invalid sequences refused with the line), commas, quoted fields
    with `""`, and CRLF or LF.
  - A header row is required, and every row must have the header's field count.
  - Limits: at most 5 MiB, 100,000 data rows and 50 columns.
  - Column names must match the reference grammar and be unique within the file. Duplicates across
    the plan's data sets are refused on add, replace and rename (FR-042).
  - Refusals are `422 data_set_invalid` with `reason` and `line`. Nothing is stored (FR-041).
  - An empty cell is the empty text (Edge Cases).
- **Upload.** Multipart with `multer`, which is already a dependency. The memory limit is 5 MiB plus
  form overhead, and anything above it is refused before parsing.
- **Storage.** A new `chain_plan_data_sets` table holds:
  - `id`, `plan_id`, `session_id`, `name`, `mode`, `position`;
  - `columns` (JSON of `{ name, secret }`), `row_count`, `size_bytes`, `sha256`;
  - `content_encrypted`, `content_iv`;
  - `created_at`, `updated_at`.

  The original file bytes are encrypted with the credential cipher (FR-044), and the SHA-256 is of
  those bytes (FR-046). Values are never logged; logs carry ids, counts and sizes only.
- **Preview (FR-045).** `GET …/data-sets/:id/preview` decrypts, parses and returns the first 5 rows,
  with each secret column's cells replaced by `null`. The UI renders those as "hidden".
- **Run-time copy.**
  - At run start, after the script integrity check, each data set used by the plan is decrypted,
    parsed and written as `apipilot-data-<i>.json` into the run directory, owner-only, mode `0600`.
    The file is a JSON array of rows of strings, in file order.
  - The script reads it with `new SharedArray("apipilot-data-<i>", () => JSON.parse(open("./apipilot-data-<i>.json")))`.
    The name is fixed and relative to the script, and the run directory is removed when the run
    settles and at startup (existing `removeRunDirectory` and `removeLeftoverRunDirectories`).
  - The script reads no other file (constitution XVII).
- **Rows.**
  - **One row per virtual user:** `rows[(exec.vu.idInTest - 1) % n]`, taken on the virtual user's
    first iteration.
  - **Next row per iteration:** `rows[exec.scenario.iterationInTest % n]`. That counter is unique
    and increasing across virtual users, so rows are used in order and every row is used before any
    row is used twice (FR-043, SC-009).
  - **Setup steps:** use `rows[0]`.
  - **Counting.** Each take is counted on `apipilot_data { dataset, outcome: "take" | "wrap" }`,
    where `wrap` means the taker index was `n` or more. The report derives "rows used" and
    "wrapped" from the counts, never from values (FR-046).
- **Shown and recorded.** The run trigger lists data set names and row counts. The run snapshot
  records name, mode, columns (name and secret), row count and SHA-256.

**Alternatives considered**:
- **Passing rows as environment variables:** Linux caps one environment string at 128 KiB and
  Windows caps a variable at 32,767 characters, far below 5 MiB.
- **A CSV dependency (`csv-parse`):** adds a package for 80 lines of a fixed grammar (CLAUDE.md §5).
- **Parsing CSV inside k6:** puts more runtime code in the script and makes the script read
  user-formatted text.

## R15. Seeding from a specification (quick path, FR-021, FR-022)

**Decision**: `seedFromSpecification(context)` in `backend/src/performance/chain/seed/` uses the
session's quick test (`quickTestStore`: its `ApiModel` and positive scenarios) and the existing
pure builders:
- **Steps.** For each operation in scope, minus chained-login producers (AP-032 FR-003a, today's
  `credentialProducerOperationKeys`, now exported):
  1. `selectPerformanceScenario` picks the scenario. An operation with no positive scenario becomes
     a seeding-report item.
  2. `buildStepRequest(context, planAuth(context), operation, scenario, { uniqueFields })` builds
     the request.
  3. `toChainStep` converts its `RequestTemplate`. It splits the URL into URL and query
     (`splitUrl`), copies the headers, converts the body (`json` to raw `application/json`, `form`
     to fields, anything else to raw with its content type), and rewrites each unique token
     `{{apipilot_unique_N}}`: `format: uuid` becomes `{{$guid}}` and `format: email` becomes
     `{{$randomEmail}}` (FR-021).
- **Authentication (FR-022).** Auth becomes headers or query rows.
  - `bearer` becomes `Authorization: Bearer {{<token variable>}}`.
  - `apikey` becomes a header or query row.
  - `basic` becomes `Authorization: Basic {{<scheme>_basic}}`, a secret environment value. The
    seeding report says it must hold the Base64 of `user:password`, because the chain runtime has
    no auth kinds (R10).
- **Credential producers.** Each token source from `planAuth`, one per scheme, becomes a
  **Once before load** step at the top of a first chain, "Credentials". This covers OAuth2 client
  credentials, a chained login, and each scheme's own credential when several schemes or roles are
  in use. The step has an extractor named after the token variable, taken from the source's
  response field.
- **Expected statuses.** `prefillExpectedStatuses` gives the documented success codes (FR-006).
- **Password fields.** The field paths the request body schema declares `format: password` are
  recorded as `source.passwordFields` (R8).
- **Chains.** One single-step chain per operation, in the specification's operation order, named
  `METHOD /path` (FR-023, quick path).

**Rationale**: These functions already produce exactly the request AP-029 and AP-032 send today. Seeding
reuses them once and keeps the text. Nothing new about OpenAPI is derived.

## R16. Seeding from the guided workflow (FR-023)

**Decision**: `seedFromWorkflow(context)` uses `contextFromWorkflow`. It has the same gate as today's
guided plan (Postman generation complete) and the same builders as R15.
- **Chains.**
  - One chain per approved workflow, in workflow position order, named after the workflow.
  - Then one single-step chain per other operation in scope (`operationsInScope`).
  - A workflow with a step that has no candidate scenario falls back to single-step chains, as
    `buildJourneys` does today. The fallback is listed in the seeding report.
- **Wiring.**
  - Each workflow variable becomes an extractor on its producer step. The name is the variable name
    reduced to the reference grammar and made unique within the plan. The path is
    `parseCapturePath(producerField)`.
  - Each consumer gets a `{{name}}` reference in the location `stepWiringOf` gives. Consumed-value
    keys (`apipilot_c_…` and workflow variable keys) are rewritten to the plain name.
  - Auth consumers are dropped, as `convertWorkflowJourney` does: authentication comes from R15's
    credential steps.
- **Constraint.** Only approved workflows are chained (constitution XV). ApiPilot adds no other
  extractor.

`workflowLinks` (`buildJourneys.ts`) and `captureNameFor` (`convertWorkflowJourney.ts`) are exported
for this.

## R17. Seeding from a stored collection (FR-024)

**Decision**: `seedFromCollection(collectionId, orderedRequestIds, environmentId?)` reads the stored
collection with `readCollectionRequests` and `recognizeScript`. Nothing is executed or evaluated
(AP-036 FR-005).
- **Chains.** One per top-level folder. The root's requests form one chain. Chains are ordered by
  their first selected request, and steps keep the selected run order.
- **Requests.** Each step is the request as the functional run sends it (AP-036 FR-003):
  - method and URL, with collection references kept as `{{name}}` and `{{$…}}` kept literally;
  - enabled headers;
  - the body (json, text or form).
- **Inherited auth.** Written as a header or query row (`effectiveAuth`): bearer, apikey, and basic
  (as R15). Literal auth values and literal credential headers move to the named environment, or
  are dropped and listed (R8).
- **Script statements.**
  - Recognised setters become extractors (`convertedCaptures`).
  - Status assertions become expected statuses (`intersectStatuses`).
  - Steps whose extracted values feed only later requests' authentication become **Once before
    load** (`classifyCredentialRequests`, AP-036 FR-027). The classification uses only where values
    are used.
- **Left out.** Requests AP-036 leaves out (form-data bodies, unsupported auth), pre-request scripts,
  unrecognised statements and unsupported dynamic variables become seeding-report items, each with
  its request (FR-025).

`templateOf` is not reused: it binds to capture keys, and a chain step keeps plain names.

## R18. The seeding report

**Decision**: `SeedingReport` is stored in the plan document and is viewable from the plan screen at
any time (FR-025). It holds:
- the source: kind, name, and when it was seeded;
- `items: { kind, sourceLabel, detail }[]`.

Item kinds:
- `pre-request-script`, `unrecognised-statement`, `unsupported-dynamic-variable`;
- `left-out-request`, `no-positive-scenario`, `workflow-fallback`;
- `basic-auth-encoded-value`;
- `literal-credential-moved`, `literal-credential-dropped`.

It never gates generation. It holds names, lines and labels, never a value.

## R19. Runs: the same table, a chain run type, a neutral aggregate layout

**Decision**:
- **Table.** Chain runs use `performance_runs`, so they share the session's one execution slot,
  restart handling (`markInterruptedRunsCancelled`), checkpoints and cancel. They are marked with
  `plan_source = 'chain'`. Two additive columns come through `ensureColumn`:
  - `chain_plan_id TEXT`;
  - `plan_document_encrypted BLOB` with `plan_document_iv BLOB`: the run's copy of the plan
    document for **Run again** (R21), encrypted like the plan.
- **Snapshot.** `plan_snapshot` holds a `ChainRunSnapshot` (data-model.md), which has no step
  content and no value (FR-033).
- **Shared types.**
  - `ChainRun` is a new type with `planSource: "chain"` and `snapshot: ChainRunSnapshot`.
  - `PerformanceRun` is unchanged for the legacy kinds.
  - Legacy `listBySessionAndSource` excludes `chain` rows. New repository methods (`createChainRun`,
    `getChainRun`, `listChainRuns(planId)`) share the row mapping.
  - `findExecutionInProgress` already covers every row in the table.
- **Aggregate.**
  - `createAggregate` takes a `RunLayout` instead of a `PerformancePlan`. The layout is steps with
    `stepId`, `journeyId`, `label`, `method` and `expected`, plus capture order, check ids and setup
    step ids.
  - `layoutFromPlan(PerformancePlan)` reproduces today's inputs exactly; the existing aggregate
    tests are the regression proof. `layoutFromChainSnapshot` is the chain version.
  - New streams: `apipilot_check`, `apipilot_setup`, `apipilot_data`, and setup and refresh request
    samples by `setup_step`.
  - `PerformanceResult` gains optional fields:
    - `steps[].checks`;
    - `setupSteps`;
    - `dataSets`;
    - `tokenRefreshes.bySetupStep`.

    Older results do not have them, so no stored run is reinterpreted.
- **Findings.** `deriveFindings` takes the layout's labels instead of the snapshot.

**Rationale**: A second runs table would duplicate about 250 lines of repository code and need a
second slot check, which risks two runs at once. The layout is the minimum the aggregate actually
reads from a plan.

## R20. The chain report

**Decision**: `backend/src/performance/report/renderChainReport.ts` renders a chain run as a
self-contained HTML report.
- **Reused helpers.** It reuses `renderHtmlReport.ts`'s exported helpers: `timelineSvg`,
  `timelineTable`, `phaseTable`, the formatters and the escape function.
- **Content.**
  - per chain and per step: the figures of AP-029 FR-036 to FR-038, with checks, extractors and
    chains cut short by extractor;
  - setup steps, with outcome and latency;
  - token refreshes by setup step;
  - data sets: name, mode, columns, row count, SHA-256, rows used, and wrapped or not (FR-046);
  - each step's seed source and `Changed` mark, with the statement that step content is authored by
    the engineer and not verified by ApiPilot (FR-033, constitution XVII).
- **Excluded content.** It contains no request or response content: steps are identified by name,
  method and path template.
- **Legacy.** `renderHtmlReport` stays unchanged, so legacy reports render identically (FR-037,
  SC-007).

## R21. Run again and restore (FR-035)

**Decision**:
- **Run again.** Offered for the newest ended run of the open plan when all of these hold:
  - the current script's SHA-256 equals the run's;
  - each data set's SHA-256 equals the run's snapshot;
  - the environment exists;
  - the slot is free.

  Otherwise the reason is shown. The data set check keeps "the same test" true when only a file
  changed, since data set content does not change the script.
- **Restore.** `POST /api/chain-plans/runs/:runId/restore` decrypts the run's plan copy and
  either:
  - replaces the open plan's chains, steps and settings, when the plan still exists and the
    engineer chose that; or
  - creates a new plan named `<name> (restored)`.

  It then generates the script. It never starts a run and copies no environment value.
  - Data sets are relinked by id when they still exist with the same SHA-256. Otherwise they are
    listed as not restored, and their columns become unresolved names (FR-015).
- **Why a copy.** The run's copy of the plan is separate from the snapshot. The snapshot and the
  report stay free of content (FR-033), while restore has the steps it needs. This is
  **Open item 4**: FR-035 needs content that FR-033 keeps out of the snapshot.
- **Legacy runs.** Runs from before this feature never offer **Run again** or restore in a chain
  plan's view. After phase two they are read-only everywhere, with the reason (FR-037).

## R22. Fingerprint and out-of-date (FR-032)

**Decision**: `plan.fingerprint` is the SHA-256 of the canonical JSON of what the script depends on:
- chains and steps, without `source` or `changed`;
- the load profile, think time and thresholds;
- data set index, mode and column names.

It excludes the plan name, the seeding report and the target environment, which do not change the
script. The script store keys scripts by plan id and records the fingerprint, and a mismatch marks
the script out of date (AP-029 FR-023). The run route refuses an out-of-date script, as today.

## R23. Frontend

**Decision**:
- **Navigation.**
  - **Phase one:** add a **Performance plans** tab to `App.tsx` `TABS`, rendering a new
    `RequestChainPlansPage`. It lists plans (name, chains, steps, updated) with **New plan**,
    **Open**, **Duplicate** and **Delete**. Beside the old plan screens, the guided stage, the
    quick page and the collection run panel each offer **Create request-chain plan** (seed dialog:
    name, and an optional environment for literal credentials). They switch to the new plan when it
    is seeded (FR-020).
  - **Phase two:** those entry points lose their old plan screens and offer only seeding, plus the
    plans already seeded from that source (US5).
- **New components** in `frontend/src/components/requestChain/`:
  - `ChainPlanEditor`: a two-pane layout. On the left, chains and steps as a tree with move,
    duplicate and delete buttons. On the right, the selected step. It stacks on narrow screens
    (CLAUDE.md §36).
  - `StepEditor`, with these sections:
    - **Request:** method, URL, a `KeyValueRows` table for query and headers, and `BodyEditor`;
    - **Extract:** `ExtractorRows`;
    - **Checks:** `CheckRows`;
    - **Settings:** runs, think time and expected statuses.
  - `ReferenceField`: a text input or textarea that opens a suggestion listbox on `{{`, following
    the ARIA combobox pattern with arrow keys, Enter and Escape. It offers earlier extracted names
    in run order, the environment's value names, data set columns and dynamic variables (FR-005).
    No library is needed. Native `<datalist>`, used elsewhere, cannot be triggered mid-text.
  - `PlanIssues`: blockers, required values, hosts and extractor overlaps, each with a button that
    selects the step.
  - `DataSetsPanel`, `SeedingReportView`, `ChainRunPanel`.
- **Reused:** `LoadProfileEditor`, `ThresholdEditor` (with steps as scopes), `EnvironmentPicker`,
  `PendingBar`, `SetupItem`, `WriteOperationSummary` (fed by `summarizeChainWrites`), `usePerformanceRuns`
  (already generic), `PerformanceReportFrame`, `HttpMethodBadge`, `StatusBadge`, `Dialog`,
  `ConfirmDialog` and `Tabs`.
- **Services.** All HTTP calls go through `frontend/src/services/requestChainClient.ts`.
- **Styling.** AP-027 tokens and Tailwind v4 only. Every state is given in text as well as colour.

## R24. Phase two: retirement (FR-036 to FR-038)

**Decision**: Phase two starts only when phase one's acceptance scenarios pass on all three entry
points. It then does the following.
- **Removed:**
  - AP-033 body and parameter edits (`bodyEdits.ts`, `parameterEdits.ts`, `bodySchemaMismatches.ts`,
    `StepBodyEditor`, `StepParameterEditor`);
  - AP-035 user journeys (`userJourneys.ts`, `userJourneyNames.ts`, `convertWorkflowJourney.ts`,
    `UserJourneysPanel`, `CaptureEditor`, `BindingSourceControl`, `AddStepDialog`);
  - AP-036 conversion and assembly (`assembleCollectionPlan.ts`, `bindCollectionPlan.ts`,
    `collectionEngine.ts`, `collectionPlanStore.ts`, `seedEnvironment.ts`, `ConversionReview`,
    `CredentialRequestList`, `CollectionCapturesPanel`, `NewEnvironmentFromCollection`);
  - the derived plan (`buildPlan.ts`, `buildJourneys.ts`, `planUpdate.ts`, `validateOrder.ts`,
    `openApiEngine.ts`, `planStepRequest.ts`, `requestPreview.ts`, `removedOperationPreview.ts`,
    `JourneyList`, `OtherOperationsTable`, `PerformancePlanScreen`);
  - the legacy runtime;
  - the `/plan*` and `/script*` routes under the three old bases.
- **Kept:**
  - the seeding inputs: `quickTestStore` (the uploaded specification), `stepRequest.ts`,
    `selectScenario.ts`, `expectedStatuses.ts`, `uniqueValueFields.ts`, `readCollectionRequests.ts`,
    `recognizeScript.ts`, `statusAssertions.ts`, `credentialRequests.ts` and `dynamicValues.ts`;
  - the legacy runs' read routes, and the legacy `renderHtmlReport` for FR-037;
  - `PerformancePlan` and the legacy result types, trimmed to what stored snapshots and the legacy
    report read.
- **Entry points.** Each entry point opens a request-chain plan (US5).
- **Legacy runs.** The runs view states that runs recorded before request-chain plans can be viewed
  but not run again or restored (FR-037).
- **Governance.** The constitution's TODO(XVII_LEGACY_PLAN_TEXT) amendment (MAJOR) goes with this
  phase.
- **SC-006 measurement.** The measured set is listed in plan.md. Its baseline on 2026-10-03, before
  this feature, is 16,110 lines of non-test source: backend 7,396, frontend 7,608, shared 1,106. The
  target after phase two is at most 8,055 lines across the same set plus every new chain module and
  component.

## R25. Testing

**Decision**:
- **Shared-domain unit tests:**
  - `parseReferences`;
  - `analyzeChainPlan`: use before extraction across chains, setup restrictions, data set columns in
    setup, hosts, the empty chain, shadowing, duplicate columns;
  - `summarizeChainWrites`.
- **Backend unit tests:**
  - the CSV parser: every refusal reason with its line, the BOM, quoting, the limits;
  - the credential mover: header forms, mixed literals, password fields, naming, no environment;
  - the three seeders against fixtures, each seeded twice for determinism: the AP-032
    specification, the guided `TestModel`, and the AP-036 collection fixture;
  - `renderChainScript`: a golden file, byte-identical ten times, independence from data set
    content, and AP-034's `checkUserScript` passing without data sets;
  - the chain runtime in `k6Sandbox`, extended with `k6/execution`, `exec.test.abort`,
    `SharedArray` and `open()` stubs. It covers scopes, runs settings, cut short, checks, refresh,
    data rows and wrap;
  - the aggregate's chain layout, with the legacy layout unchanged;
  - `renderChainReport`;
  - the repositories on `:memory:`.
- **Backend integration (Supertest, fake runner):** every route in contracts/chain-plan-api.md,
  including revision conflicts, refusals, restore and the slot shared with legacy runs.
- **Opt-in real k6 (`npm run test:k6-real -w backend`):**
  1. the US1 seven-step chain against `perfStubTarget`'s existing `customers-auth` mode (AP-036),
     which already counts token calls and serves the customers resource;
  2. a failing setup step stops the run with `setup-step-failed` and the step named;
  3. a data set with 50 rows over 5 virtual users and 20 iterations is used in order and wraps.
- **Leak scan (SC-005).** A seeded secret token and a secret data set column are looked for, and
  must be absent, in the plan row, the script, the template, the snapshot, the report and the logs.
- **Frontend (RTL with `stubFetch`):**
  - the plan list;
  - the editor: add a chain and step, `{{` suggestions by keyboard, moving steps, issues;
  - data set upload refusal and the hidden preview;
  - the seed dialogs;
  - the run trigger listing chains, writes, hosts and data sets.

## R26. Limits

**Decision**:
- **From the spec's Assumptions:** 20 chains per plan, 50 steps per chain, 10 extractors and 10
  checks per step, and a body of at most 256 KiB.
- **Added by this plan:**
  - at most 50 plans per session;
  - a serialized plan document of at most 8 MiB, which is also the `PUT` JSON limit;
  - at most 100 query rows, 100 headers and 100 form fields per step;
  - URLs and values of at most 8 KiB each.

A limit is refused with `422 plan_limit_exceeded` naming the limit.

**Rationale**: Bounded resources (constitution XVII, "reasonable limits") and a readable plan. The
additions are generous for real API tests and keep the worst-case document small.

## R27. Logging

**Decision**: Log events carry only these fields:
- plan id, run id and data set id;
- counts of chains, steps and rows;
- sizes in bytes;
- error codes and durations.

They never carry a plan name, step content, header names or values, column values or file names.
The existing log redaction tests are extended with the leak scan (R25, constitution XX).
