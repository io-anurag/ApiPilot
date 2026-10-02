# Research: Performance Test from a Postman Collection (AP-036)

Decisions R1 to R22 for [plan.md](./plan.md). Each records the decision, its rationale and the
alternatives considered. Requirement ids without a prefix are this spec's. AP-026 ids refer to
`specs/026-external-collection-execution`, AP-029 to `specs/031-k6-performance-testing`, AP-032 to
`specs/032-quick-performance-test`, AP-033 to `specs/033-edit-step-request-body`, AP-034 to
`specs/034-run-user-k6-script`, AP-035 to `specs/035-user-defined-journeys`.

The design rests on the code as it stands at 19.16.0, read on 2026-10-02:
- **Plan pipeline:** `backend/src/performance/plan/` (`buildPlan.ts`, `buildJourneys.ts`,
  `stepRequest.ts`, `planStepRequest.ts`, `planUpdate.ts`, `requestPreview.ts`,
  `userSuppliedValues.ts`, `runSnapshot.ts`).
- **Script:** `backend/src/performance/k6/renderScript.ts`.
- **Shared routes:** `backend/src/api/performanceRoutes.ts` (`registerPerformanceRoutes`,
  `PlanHandle`, `PerformancePlanSource`), with `quickPerformance.ts` as the model of a route family.
- **Stored collections:** `backend/src/externalCollections/` (`uploadedCollectionParsing.ts`,
  `collectionView.ts`, `collectionStructure.ts`, `runOrder.ts`, `editedItems.ts`,
  `uploadedCollectionStore.ts`) and `persistence/uploadedCollectionRepository.ts`.
- **Environments:** `execution/environmentStore.ts`, routes in `api/testGenerationWorkflow.ts`.
- **Frontend:** `pages/QuickPerformancePage.tsx`, `components/performance/PerformancePlanScreen.tsx`,
  `services/performanceTestingClient.ts`, `components/ExternalCollectionRunPanel.tsx`, `App.tsx`.

Facts that shaped the design:
- **Every pipeline stage takes an OpenAPI `PerformanceContext`** (`ApiModel` + `TestScenario[]`).
  Plan assembly, the step request, auth, the preview and `PUT /plan` all look up an operation and a
  scenario. No stage can take a stored collection as it is.
- **The shared routes read the context in five places.** `PUT /plan` (`applyPlanUpdate`), `POST
  /plan/reset` (`rebuildPlan`), the step and removed-operation previews, `GET /plan/response-fields`
  and `POST /script` (`renderScript`) all use `handle.context`.
- **The script's runtime is fixed text** that reads data constants (`VALUE_ENV`, `UNIQUE`,
  `TOKEN_SOURCES`, `JOURNEYS`). A step's request is a `RequestTemplate {method, url, headers, body,
  bodyKind, auth}` with `{{name}}` references.
- **A stored collection has no content version.** `uploaded_collections` holds the Postman JSON
  (plaintext) and the encrypted `variableValues`. An edit rewrites the JSON. A functional run rewrites
  only the values. A new upload is a new row with a new id.
- **Item ids are stable** (`ensureStableIds` at upload), and the run panel's ordered selection is a
  list of item ids. That selection is held in the panel's local state only.
- **`postman-collection` 4.5.0 and `acorn` 8 are already backend dependencies.**
  `POSTMAN_DYNAMIC_VARIABLES` (`uploadedCollectionParsing.ts:128`) is the backend's list of 48 known
  dynamic variables. It is not exported.
- **Postman's status assertions** come from chai-postman, bundled in
  `node_modules/postman-sandbox/.cache/bootcode.js`. Read there on 2026-10-02:
  - `status(n)` with a number compares the code; with a string it compares the reason phrase.
  - `ok` requires reason `OK` and code 200.
  - The classes are `info` 1, `success` 2, `redirection` 3, `clientError` 4 and `serverError` 5.
  - The named codes are `accepted` 202, `withoutContent` 204, `badRequest` 400,
    `unauthorised`/`unauthorized` 401, `forbidden` 403, `notFound` 404, `notAcceptable` 406 and
    `rateLimited` 429.

## R1. A third plan source, `collection`, with its own route family and store

**Decision**: `PerformancePlanSourceKind` gains `"collection"`. A new router,
`api/collectionPerformance.ts`, mounts at `/api/collection-performance`. It adds three routes of its
own: build, read and rebuild (contract). It registers the shared AP-029 routes with
`registerPerformanceRoutes(router, "/collection-performance", collectionSource, deps)`.

The session's collection plan lives in memory in `performance/collection/collectionPlanStore.ts`,
one per session, cleared on expiry, like `quickTestStore.ts` (FR-025). Runs use the existing
`performance_runs` table with `plan_source = 'collection'`. The run list filters by source, so the
collection page lists only its own runs.

**Rationale**: This is the AP-032 pattern. It already gives one-run-per-session, live progress,
cancel, Run again, report download and run listing for a second source with no duplication. A third
source is the same shape.

**Alternatives considered**:
- **A `?source=` parameter on the quick routes.** Rejected: the gates, errors and lifetimes differ,
  and AP-032 already chose separate route families.
- **Storing the plan in SQLite.** Rejected: both other plans are in memory, and FR-025 keeps that.
  Rebuilding from the stored collection is cheap.

## R2. The seam: `PlanHandle.context` becomes `PlanHandle.engine`

**Decision**: `PlanHandle.context: PerformanceContext` is replaced by `engine: PlanEngine`, which
names the six operations the shared routes need:

```ts
interface PlanEngine {
  applyUpdate(plan: PerformancePlan, body: unknown): PerformancePlan;
  reset(plan: PerformancePlan): PerformancePlan;
  stepRequestPreview(plan: PerformancePlan, stepId: string): StepRequestPreview;
  removedPreview(plan: PerformancePlan, key: string): RemovedOperationPreview;
  responseFields(operationKey: string): ResponseFieldsResult | null; // null: 404 not_applicable
  scriptInputs(plan: PerformancePlan): ScriptInputs;                 // may throw a gate error
}
```

`openApiEngine(context)` in `plan/openApiEngine.ts` wraps today's functions unchanged:
`applyPlanUpdate`, `rebuildPlan`, `buildStepRequestPreview`, `buildRemovedOperationPreview`, the
documented-field listing, and `scriptInputsFromContext`. The guided and quick handles build it from
their context. `collectionEngine(test)` in `performance/collection/collectionEngine.ts` implements
the same interface for a collection plan.

`renderScript(plan, context)` is split into `scriptInputsFromContext(plan, context): ScriptInputs`
and `renderScriptFrom(plan, inputs): RenderedScript`. `renderScript` stays as their composition, so
existing callers and tests are unchanged. `ScriptInputs` is what the renderer reads today, made
explicit:
- the rendered step of each runnable step (template, needed names, captures, token sources);
- the rendered token sources;
- the unique tokens;
- the dynamic tokens (R9).

**Rationale**: The six call sites are the only points where the shared routes depend on OpenAPI. An
interface at exactly those points lets the collection source reuse every route, the store pattern,
the runs, the snapshot and the report, without making the OpenAPI pipeline take a union context.
The golden fixtures of AP-029 and AP-035 bound the refactor: their scripts must stay identical apart
from R10's runtime change.

**Alternatives considered**:
- **A union `PerformanceContext`** (`{source:"collection", ...}`) handled inside `assemblePlan`,
  `stepRequestFor`, `planAuth` and `applyPlanUpdate`. Rejected: about fifteen functions would branch
  on a source they do not otherwise need (XXVII).
- **Converting the collection into a synthetic `ApiModel` and scenarios.** Rejected: it would
  present collection content as specification content (I, XIV). Expected statuses would read "from
  specification", and every AP-033 and AP-035 assumption about documented fields would silently hold
  for content that documents nothing.

## R3. Reading the collection: the `postman-collection` SDK, never Newman

**Decision**: `collection/readCollectionRequests.ts` parses the stored JSON with
`parseStoredCollection`. It walks `forEachItem` and returns, for the ordered selected ids, one
`CollectionRequestSource` each, with variables unresolved:
- **Identity:** item id, name, folder path (names from the root), and the folder chain's ids.
- **Method:** upper-cased.
- **URL:** `url.toString()` keeps `{{name}}` and drops disabled query parameters (the SDK's
  `QueryParam.unparse`). Each `:name` path segment is replaced by the value of its `url.variable`
  entry, as `templateFromItem` already does for generated items.
- **Headers:** enabled `headers.all()` entries (`disabled !== true`), keys and values as written.
- **Body:**
  - `raw` becomes the text. `bodyKind` is `"json"` when the request's `Content-Type` header is
    `application/json` or `+json`, or the raw options' language is `json`; otherwise `"text"`.
  - `urlencoded` becomes `"form"` (R11).
  - `none` and an empty body have no body.
  - `formdata`, `file` and `graphql` leave the request out (R4).
- **Auth:** `item.getAuth()` gives the effective auth, which walks request, then folder chain, then
  collection (what Newman applies). The owner is found with `inheritedAuth`.
- **Scripts:** the `prerequest` and `test` listeners that apply to the request, in Postman's order:
  collection, then each folder outward-in, then the request. Each is kept with its owner (R5).

**Rationale**: Reading the SDK model, rather than re-parsing JSON, keeps one definition of
inheritance and disabled items, shared with the collection view and the run. Newman is never invoked
(FR-005). Building a plan sends nothing.

**Alternatives considered**: reusing `collectionView.ts`'s request view. Rejected: it masks secrets
and flattens bodies into display text, both meant for the browser.

## R4. Which requests are left out, and why (FR-004, FR-013)

**Decision**: A selected request is left out, with one reason code, when any of these holds:

| Code | When |
|---|---|
| `unsupported-auth` | Effective auth is not `noauth`, `bearer`, `basic` or `apikey`. Includes `oauth2`, `digest`, `hawk`, `awsv4`, `ntlm`, `akamai`, `edgegrid` and `jwt`. Postman's `oauth2` sends a stored access token, which a load test cannot refresh. |
| `unsupported-body` | Body mode `formdata`, `file` or `graphql`. |
| `unsupported-dynamic-variable` | Uses a `{{$name}}` in `POSTMAN_DYNAMIC_VARIABLES` that is not in R9's supported list. The detail names it. |
| `unknown-dynamic-variable` | Uses a `{{$name}}` that is not in that list. |
| `other-host-variable` | The URL starts with a `{{name}}` that is not the plan's base-URL variable (R12). |
| `reserved-name` | Uses a `{{name}}` starting with `apipilot_`, which the script reserves. |

Left-out requests appear in `plan.collection.leftOut` in run order. They never become steps.

**Rationale**: Each case is something the script cannot send faithfully. Naming the cause lets the
engineer fix it in the collection editor and rebuild (User Story 3).

**Spec amendment**: FR-004 said form-data text fields were supported. k6 sends an object body
URL-encoded, not as multipart. Building multipart in the runtime would be new runtime code for a
rare case, so form-data is left out with its reason. FR-004 is amended to match.

**Alternatives considered**: skipping only the offending part (for example, sending the request
without its unsupported auth). Rejected as a silent change (XIV).

## R5. Reading scripts: acorn, a fixed recognizer, everything else listed (FR-005 to FR-010)

**Decision**: `collection/recognizeScript.ts` parses each test script with acorn: `ecmaVersion:
"latest"`, `sourceType: "script"`, `allowReturnOutsideFunction: true`, `locations: true`. Postman
wraps scripts in a function, so a top-level `return` is legal there. A script that does not parse
becomes one `unreadable-script` finding with acorn's line and column. Nothing from it is converted.

A statement is recognised only at the top level of the script, or as a direct statement of the
callback of a top-level `pm.test(<any>, <function or arrow>)` (FR-007). An arrow callback with an
expression body is treated as one statement. The recognised forms are a closed grammar:

```text
statement   := setter | alias | test | assertion | inert
setter      := SCOPE ".set(" STRING "," value ")"
             | "postman.setEnvironmentVariable(" STRING "," value ")"
             | "postman.setGlobalVariable(" STRING "," value ")"
SCOPE       := "pm.environment" | "pm.collectionVariables" | "pm.globals" | "pm.variables"
value       := body path+ | header
body        := "pm.response.json()" | "JSON.parse(responseBody)" | ALIAS
path        := "." IDENT | "[" STRING "]" | "[" NON_NEGATIVE_INT "]"
header      := "pm.response.headers.get(" STRING ")" | "postman.getResponseHeader(" STRING ")"
alias       := ("const" | "let" | "var") IDENT "=" body-source   ; one declarator
test        := "pm.test(" any "," function ")"                    ; container only
assertion   := see R7
inert       := "console." IDENT "(" ... ")"                      ; listed as having no effect
```

`ALIAS` is a name declared by an `alias` statement at the top level, or earlier in the same
callback, that the script never assigns again. It is checked over every `AssignmentExpression` and
`UpdateExpression` in the script. A `value` needs at least one `path` segment, because a whole-body
capture is never a scalar. Paths become AP-035 `BodyPathSegment[]`, so the capture runtime walks them
unchanged. Header names are lowercased, as AP-035 R8 does.

Every other statement in a script that applies to a step becomes a `ConversionFinding`. It carries
the step, the owner (request, folder id and name, or collection), the event (`test`), the line, and
one reason code:
- `condition`, `loop`, `function`, `try`: a statement inside such a construct;
- `computed-name`, `computed-value`: a setter whose name is not a string literal, or whose value is
  outside `value`;
- `send-request` (`pm.sendRequest`), `set-next-request` (`pm.setNextRequest`,
  `postman.setNextRequest`), `skip-request` (`pm.execution.skipRequest`), `iteration-data`
  (`pm.iterationData`, `data.`);
- `unset` (`.unset(`, `.clear(`), `assertion-not-converted` (any other `pm.expect`, or a
  `pm.response.to...` that R7 does not cover), `no-effect` (`console.*`);
- `unsupported-statement`: anything else.

The finding keeps a statement excerpt of at most 160 characters, for the plan view only. Excerpts
never enter the run snapshot (R16).

Pre-request scripts are not converted (FR-009). Each non-empty pre-request script that applies to at
least one step becomes one `prerequest-not-converted` finding per owner, listing the steps it applies
to. It is not repeated per step.

Recognition is a pure function of the script text. The same text always gives the same captures,
assertions and findings, in source order.

**Rationale**: A closed grammar matched on the AST is data extraction, not evaluation (constitution
XVII, 2026-10-02: "read only as text against a fixed set of statement forms"). Restricting
recognition to top level and `pm.test` callbacks keeps every recognised statement unconditional, so
converting it cannot change its meaning. The two body forms and the alias form cover what Postman's
own snippets and most collections write.

**Alternatives considered**:
- **Regular expressions over the text.** Rejected: comments, strings and nesting make them wrong in
  ways that would convert a statement inside an `if`.
- **Running the script in postman-sandbox against a recorded response.** Rejected by the
  constitution: scripts are never run for a performance plan.
- **Accepting `String(x)`, `.toString()` and template literals.** Deferred. Each is a value
  transformation; the grammar can grow later with tests.

## R6. Captures, bindings and Postman's scopes (FR-006, FR-008, Edge Cases)

**Decision**:
- **Captures.** Each recognised setter becomes a `Capture` on the step whose request the script
  applies to. A folder or collection test script yields the same capture on every step inside it. The
  capture's name is the Postman variable name. The capture records its scope, owner and line as
  `ConvertedCaptureOrigin`. When the same name is set twice for one step, the later statement wins,
  in Postman's script order (collection, folders, request); the earlier one becomes a
  `superseded-setter` finding.
- **References.** Each step's references are the `{{name}}` occurrences in its URL, headers, body
  and effective auth fields, using `extractReferencedVariables`'s pattern and skipping `{{$…}}`.
- **Binding.** A reference binds to the latest earlier step, in plan order, that captures the same
  name. It is rewritten in the template to `{{apipilot_c_<step>_<key>}}`, through the existing
  `captureKeyOf`, so the runtime resolves it from the virtual user's captured values exactly as for
  AP-035. Each bound name gets one `ValueBinding` with the new target kind `reference` (data-model),
  listing where it occurs.
- **Unbound references** are environment values (R12).
- **Scope.** A capture binds whatever its scope. When a capture sets a name with
  `pm.collectionVariables` or `pm.globals`, the review adds one `scope-precedence` note per capture.
  The note says that Postman would send an environment value of the same name instead, if the
  collection's environment sets one.
- **Run-time rule.** AP-035's rule applies unchanged: a capture is attempted only on an expected
  status, succeeds only for a scalar, and a failure cuts the journey short (FR-008).
- **Order.** Step order, journey order and removal re-bind on every assembly. A move that would place
  a binding before its capture is refused by AP-029's order check, through `dependsOn` (FR-008).
  Removing a capturing step re-binds its consumers to an earlier capture of the name, or to the
  environment.

**Rationale**: Re-binding on every assembly from the step order is AP-035 R1's pattern. It makes
order changes, removal and rebuilds consistent without stored bindings to repair.

**Spec amendment (Edge Cases, "Scope precedence")**: the spec said the reference "stays an
environment value" when Postman's precedence would resolve it from the environment. Whether the
environment sets the name is a property of the values. Those are the collection's current values,
not the target environment's, and they change on every functional run (R13). Making the plan depend
on them would make bindings change when no request changed, and would read secret values to decide
structure. The plan binds by the script's evident intent and surfaces the difference as a note. The
Edge Case and FR-008 are amended. **The user confirmed this reading (spec Clarifications,
2026-10-02).**

## R7. Expected statuses from the collection's tests (FR-011, FR-012)

**Decision**: These assertions are recognised as statements (R5 rules) and give a set of codes:

| Form | Codes |
|---|---|
| `pm.response.to.have.status(<int>)`, `pm.response.to.be.status(<int>)` | that code |
| `pm.response.to.be.ok`, `pm.response.to.have.ok` | 200 |
| `pm.response.to.be.<named>` for `accepted`, `withoutContent`, `badRequest`, `unauthorised`, `unauthorized`, `forbidden`, `notFound`, `notAcceptable`, `rateLimited` | the chai-postman code |
| `pm.response.to.be.<class>` for `info`, `success`, `redirection`, `clientError`, `serverError` | `1XX` to `5XX` |
| `pm.expect(pm.response.code).to.<eql\|equal\|equals\|eq>(<int>)`, optionally through `.to.be.` | that code |
| `pm.expect(pm.response.code).to.be.oneOf([<int>, ...])` | those codes |

`.to.not.` and `.not.` forms, `status("<reason>")` with a string, and every other assertion give no
codes. They become `assertion-not-converted` findings (FR-011).

All recognised assertions that apply to a step must pass in Postman, so the step's expected set is
their intersection. An exact code is inside a class when it shares the first digit. The source is
`"collection"`, labelled "from the collection's test". An empty intersection, or a step with no
recognised assertion, gives an empty set, which blocks generation through AP-029 FR-012a (FR-012). An
empty intersection also adds a `contradictory-assertions` finding. An engineer's change replaces the
set and is labelled "set by you", as today.

**Rationale**: The table is exactly what chai-postman defines (read from the bundled sandbox), so a
converted status means what it meant in Postman. Intersection is the only reading under which "every
test passes" holds.

**Alternatives considered**: a union of codes. Rejected: it would accept responses the functional
run fails.

## R8. Credential requests (FR-027 to FR-029)

**Decision**:
- **Classification.** After binding (R6), a step is a credential request when it has at least one
  capture, at least one of its captures is bound, and every bound occurrence of each of its captures
  is in an auth field, or an `Authorization` header, of a later step. Classification repeats on
  every assembly.
- **Token sources.** Each credential request becomes a token source with:
  - its id (the step id), its request template and its own needed names;
  - its expected statuses (R7 rules, editable like a step's);
  - its captures, each with a token variable `apipilot_t_<step>_<key>`.

  Consumers' references are rewritten to those variables, so the runtime's `tokenScope` provides
  them. Token sources render in plan order. A credential request may bind a value captured by an
  earlier credential request; it is then acquired after it, with the earlier tokens in scope.
- **Not in the journey.** A credential request is not a step of the journey. It is listed under "Run
  once before the load" (`plan.collection.credentialRequests`), with the values it provides and the
  steps that use them. It is not in the write summary. It can be removed like a step.
- **Expected statuses.** A credential request with no expected status blocks generation, like a step.
- **At run time** (R10):
  - `setup()` sends each source once, in order. It checks the expected status and takes each capture
    with the AP-035 scalar rule.
  - The values are shared by every virtual user (FR-027).
  - When the response's `expires_in` is a positive number, each virtual user refreshes before
    expiry through the existing `maybeRefresh` (FR-028). The staggering and the
    `apipilot_token_refresh` counter are unchanged.
  - A failed status or capture in `setup()` counts `apipilot_token_refresh{outcome:"setup-failed",
    scheme, capture}`. The token variables stay empty, as AP-029 does today when no token can be
    acquired, so consumers fail and are counted as authentication failures. The report names the
    request and the capture (FR-029).

**Rationale**: This reuses AP-029's token machinery, which is what the clarification chose. Rewriting
consumers to token variables keeps the per-virtual-user refresh semantics without new runtime
concepts.

**Alternatives considered**: classifying by request name or path (for example `/auth/token`).
Rejected as a guess (XIV). Classification uses only where the captured values are used.

## R9. Dynamic variables: a fixed list, generated by the runtime (FR-013)

**Decision**:
- **Rewriting.** At assembly, every occurrence of a supported `{{$name}}` in a step's or token
  source's template is rewritten to `{{apipilot_dyn_<k>}}`. `k` is a plan-wide occurrence index,
  assigned in plan order, then credential requests first, then URL, headers, body and auth. The
  script's `DYNAMIC` table maps each token to `{kind}`. The runtime's `resolve` calls
  `dynamicValue(kind, k)` for these tokens, after captures and tokens and before unique values.
- **Values** come from `__VU`, `__ITER`, `k` and word lists written into the runtime:

| Variable | Value |
|---|---|
| `$guid`, `$randomUUID` | `hex(VU,8)-hex(k,4)-4<t1>-8<t2>-hex(ITER,12)`, where `t1` and `t2` are the run tag's two 3-hex halves (`000` without a tag): version 4 and variant bits set, unique per run, virtual user, iteration and occurrence for k < 65,536 |
| `$timestamp` | `Math.floor(Date.now() / 1000)` (Postman: Unix seconds) |
| `$isoTimestamp` | `new Date().toISOString()` |
| `$randomInt` | `mix(VU, ITER, k) % 1001` (Postman: 0 to 1000) |
| `$randomFirstName`, `$randomLastName` | `FIRST[mix % 24]`, `LAST[mix % 24]` |
| `$randomFullName` | first and last, separated by a space |
| `$randomUserName` | `first.last` + `_r<tag>_vu<VU>_it<ITER>_<k>` (`_r<tag>` omitted without a tag), unique |
| `$randomEmail` | `first.last+r<tag>-vu<VU>-it<ITER>-<k>@example.com` (`r<tag>-` omitted without a tag), unique |
| `$randomPhoneNumber` | `NNN-NNN-NNNN` from `mix` |
| `$randomAlphaNumeric` | one character of `[0-9a-z]` from `mix` |
| `$randomBoolean` | `mix % 2 === 0 ? "true" : "false"` |

`mix` is a fixed 32-bit integer hash of `(VU, ITER, k)`. Timestamps use the run's clock (FR-013).

- **Run tag** (spec Clarifications 2026-10-02). When ApiPilot starts a run, it passes
  `APIPILOT_RUN_TAG`: the first 6 hex characters of SHA-256 of the run id. It is passed as a k6
  environment variable, beside the `APIPILOT_V_<n>` values, and is never written into the script. The
  runtime reads it once, and accepts only `^[0-9a-f]{6}$`; anything else counts as no tag. Only the
  four unique kinds use it, so names, numbers, booleans and phone numbers are the same in every run.
  A run's values are reproducible from its tag. The tag is derived from the run id, so nothing new is
  stored, and it is not secret. Two runs share a tag with probability 2^-24, an accepted residual.
- **Scope.** AP-029's `UNIQUE` fields do not use the tag (spec Assumptions; a follow-up).
- **AP-034.** The check lists `APIPILOT_RUN_TAG` among the names the script reads. A downloaded copy
  run in Run k6 Script gets no tag unless the engineer maps one.

- **Determinism.** The script's bytes depend only on the plan (FR-023). The `DYNAMIC` table is
  rendered as `{}` when the plan uses none, and existing plans keep it empty.

**Rationale**: Uniqueness by construction meets SC-006 without randomness (constitution XVI, XXIV).
The `example.com` domain is reserved (RFC 2606), so generated emails never reach a real mailbox. The
runtime stays one text for every plan (AP-035 FR-018).

**Alternatives considered**:
- **A faker library.** Rejected: AP-034's check forbids remote imports, the script must be one file,
  and no dependency is needed.
- **`Math.random()`.** Rejected: values would not be reproducible, and uniqueness would hold only by
  probability.

## R10. Runtime changes, made once for every plan

**Decision**: The fixed `RUNTIME` changes in four additive ways:
1. `resolve` reads the `DYNAMIC` table, and the runtime reads `APIPILOT_RUN_TAG` once (R9).
2. Token sources carry `captures: [{key, source}]` and optional `expected`. `acquire` checks
   `expected` when present, and takes each capture with the AP-035 `captured` rule. Existing AP-029
   sources render with one capture: their `tokenVariable` key and a body source built from
   `responseField`'s segments. They have no `expected`, so their behaviour is unchanged.
3. A rendered step's `tokenScheme: string | null` becomes `tokenSchemes: string[]`. A step can use
   tokens from several credential requests. Existing steps render `[]` or one scheme.
4. `bodyKind: "form"` fills each reference with `encodeURIComponent` (R11). The `setup-failed`
   outcome is counted (R8).

The AP-029 and AP-035 golden scripts are regenerated once, and their diff is reviewed to contain only
these changes. Every generated script, existing plans' included, still passes AP-034's check.

**Rationale**: AP-035 FR-018 requires one runtime for every plan. A conditional runtime, like the
Basic line, would double the cases the sandbox tests must cover. As with AP-035, a run made before
the upgrade cannot be repeated with **Run again** until the script is regenerated, because the bytes
differ. This is shown already (AP-029 FR-024b).

**Alternatives considered**: a second runtime for collection plans. Rejected: two interpreters for the
same data shape would drift, and AP-034 R23's compatibility work would be done twice.

## R11. URL, form bodies and encoding

**Decision**:
- **URLs.** The leading base-URL variable is rewritten to `{{baseUrl}}`, the name the runtime leaves
  unencoded (R12). Every other reference keeps today's URL fill, `encodeURIComponent`.
- **Form bodies.** A `urlencoded` body renders as `key=value&...` from its enabled pairs. Literal text
  is encoded with `encodeURIComponent` at render time, and references are encoded at run time
  (`bodyKind: "form"`). A `Content-Type: application/x-www-form-urlencoded` header is added when the
  request has none, as Postman does.
- **Raw bodies** keep today's `json` and `raw` fills.

**Known difference, documented in the manual**: Postman substitutes a variable inside a URL without
encoding characters such as `/`. The script encodes them. A variable that holds part of a path, for
example `v1/customers`, is therefore sent differently. The review adds one `url-encoding` note that lists
every name referenced in a URL after the host, so the engineer can check any that holds more than
one path segment. It is a review item, not a block.

**Rationale**: Encoding values is the script's existing, safe behaviour, and IDs and tokens, the
common case, are unaffected. Making URL encoding depend on values would need the values.

## R12. Environment values, the base URL, secrets and literals (FR-014 to FR-016)

**Decision**:
- **Base URL.** The base-URL variable is the leading `{{name}}` of the most selected requests' URLs.
  A tie goes to the first in code-unit order. It maps to the target environment's base URL. Requests
  whose URL starts with a different variable are left out (`other-host-variable`, R4). A URL that
  starts with a literal scheme and host keeps it. Its host joins `plan.collection.hosts`, which the
  plan and the run trigger list (FR-016, FR-021).
- **Values.** Every unbound, non-dynamic reference is a `UserSuppliedValueRequirement` with source
  `collection-variable`.
- **Credential headers** (spec Clarifications 2026-10-02): `Authorization`, `Proxy-Authorization`,
  `Cookie`, and every header whose lower-cased name contains `key`, `token`, `secret`, `password`,
  `auth` or `session`. This goes beyond the constitution's three named headers, which is stricter and
  therefore compliant. Each match adds a `credential-header` note to the review, with the substring
  that matched.
- **Secrets.** A value is secret when any occurrence is in an auth field or a credential header
  (FR-014).
- **Literals.** A literal (non-reference) value in an auth field or a credential header is
  replaced at render time by the reference `{{apipilot_literal_<owner>_<field>}}`, where:
  - `<owner>` is `request_<8 hex of the item id>`, `folder_<8 hex of the folder id>` or
    `collection`;
  - `<field>` is the auth field, or `header_<lower-cased header name, non-alphanumerics as _>`.

  It becomes a secret requirement with source `collection-literal`. The literal never enters the
  plan, the script or the template (FR-015). The plan stores only the name and the owner.
- **Reserved names.** These names start with `apipilot_`, which R4 reserves, so a collection cannot
  collide with them.
- **Other literals** (URLs, bodies, other headers) are written as data, and the plan states it
  (FR-015).

**Spec amendment (FR-014)**: the spec also marked as secret "a value the collection's environment
marks secret". The upload keeps only enabled key and value pairs (`parseUploadedEnvironment`), so
that information does not exist. The clause is removed.

## R13. Out of date with its collection: a content digest (FR-022)

**Decision**: The plan stores `collectionDigest = sha256Hex(stored collection JSON)` and the ordered
request ids it was built from. Every handle acquisition compares the digest with the stored row:
- a different digest marks `collectionState: "changed"`;
- a missing row (deleted, or the session's data removed) marks `"deleted"`.

While the state is not `"current"`:
- `POST /script` and `POST /runs` are refused with `409 collection_plan_out_of_date`;
- the plan view shows the state with **Rebuild** (or, for `"deleted"`, the explanation);
- `PUT /plan` still works, so the engineer can adjust settings before rebuilding.

`POST /collection-performance/rebuild` re-reads the collection with the same ordered ids, minus the
ids that no longer exist. It keeps:
- load profile, thresholds, think time;
- removed request ids;
- expected statuses set by the engineer, for steps whose item id survives;
- captures and bindings added by the engineer, for steps whose item id survives.

It names every step whose settings it could not keep, and resets the review (R14).

Only the collection JSON changes the digest. A functional run's value save-back does not, because
values never shape the plan.

**Spec amendment (FR-022 and Edge Cases)**: the spec listed "a functional run saves values back"
and "re-uploaded" as causes. The first does not change anything the plan uses. The second does not
exist: a new upload is a new collection with a new id. Both are removed.

**Alternatives considered**: adding an `updated_at` column. Rejected: the digest needs no migration,
and it is exact.

## R14. The conversion review (FR-018)

**Decision**:
- **Recording.** `plan.collection.review = {reviewed: boolean, conversionDigest}`. `PUT /plan
  {conversionReviewed: true}` records it. `conversionDigest` hashes the conversion's result: steps,
  credential requests, captures, bindings, left-out requests, findings, hosts, base-URL variable and
  generated values. It excludes the engineer's settings.
- **Reset.** Any assembly that changes `conversionDigest` resets `reviewed` to false. That covers
  rebuilds, and removals or reorders that change bindings. Settings the engineer changes do not reset
  it.
- **Gate.** `POST /script` refuses an unreviewed plan with `409 conversion_not_reviewed`. The pending
  bar shows "Review the conversion" with **Review**.
- **Statement.** The review states that the requests and scripts were not generated or verified by
  ApiPilot, and that literals other than R12's secrets are written into the script.

**Rationale**: The 2026-10-02 constitution amendment rests on the review making every request,
captured value and unconverted statement visible before a run. A review tied to the conversion's
digest means what was reviewed is what runs.

## R15. Shared types reused, extended additively (data-model)

**Decision**: A collection plan is a `PerformancePlan` with `source: "collection"`. One journey has
`source: {kind: "collection", collectionId, collectionName}`.

Each step is a `PerformanceStep` with these values:

| Field | Value |
|---|---|
| `operationKey` | `METHOD <path>`, where `<path>` is the URL after the base URL or host, references kept |
| `path` | that path |
| `scenarioId` | `collection:<itemId>` |
| `scenarioDescription` | the request name |
| `scenarioChoice` | the new value `"collection-request"` |
| `collectionRequest` | `{itemId, name, folderPath}` (new, optional) |
| `auth` | `{kind: "collection-auth", schemeName: <postman auth type>}` (new kind); `"chained-login"` when it uses a credential request |

`plan.collection` (new, optional) holds what only a collection plan has: the collection's identity
and digest, the order it was built from, removed request ids, left-out requests, credential
requests, findings, hosts, the base-URL variable, the review and its state.

`excludedOperationKeys` and `omitted` stay empty.

**Rationale**: The plan screen, write summary, run snapshot, aggregate and report read these types.
Filling them keeps those consumers working. Only labels that assumed a specification change (data
model, contract "Frontend").

## R16. Snapshot, report and logging (FR-024, FR-026)

**Decision**:
- **Snapshot.** `planSnapshotForRun` also empties each finding's `excerpt`. Findings keep owner,
  line and reason. Literal secret names and owners are kept; values never existed in the plan.
- **Report.** When `plan.source === "collection"`, it shows "Plan built from the collection
  <name>. Its requests and scripts were authored outside ApiPilot and were not generated or
  verified by it."
  - **Steps** are labelled `<folder path> / <request name>`, with method and path below.
  - **Bindings** read "← captured <name>, from <request name> (response field x), test script line
    n" or "set by you".
  - **Credential requests** get a section: request name, setups sent, refreshes ok and failed,
    setup failures with the capture.
  - **Statuses**: "from the collection's test" joins "from specification" and "set by you".
- **Logging.** Logs hold ids, counts and reason codes. They never hold scripts, excerpts, variable
  names or values, collection names or URLs.

## R17. "New environment from this collection" (FR-017)

**Decision**: `POST /collection-performance/environment {name}` creates an `Environment` through
`createEnvironment`:
- **Name and tier:** the given name, and the collection's tier.
- **Base URL:** the base-URL variable's resolved value. When it is empty, the request is refused with
  `422 base_url_missing`.
- **Values:**
  - for each `collection-variable` requirement, its resolved value, following the collection view's
    precedence (`buildVariableBindings`): a non-empty environment value, then the collection
    default;
  - for each `collection-literal` requirement, the literal read from the stored collection's auth or
    header.
- **Delay:** `requestDelayMs: 0`.

Unresolved names are left out, so the checklist shows them as missing. A duplicate name returns the
existing `409 duplicate_environment_name`. The response is the environment's id and name only, and
the values never appear in it. The collection is unchanged.

**Spec amendment (FR-017)**: once created, the environment is like every other. The existing
environment API returns values to the edit form (`GET /test-generation-workflow/environments`), as it
does for every environment. FR-017's "never sent to the browser" therefore applies to the copy
action, and is reworded so. The environments gate (`requireEnvironmentAccess`) also opens when the
session has a collection plan.

## R18. Building and replacing the plan (FR-001, FR-002, FR-025)

**Decision**: `POST /collection-performance {collectionId, orderedRequestIds, replaceExisting?}`.
`orderedRequestIds` is validated by AP-026's `resolveRunOrder`, which refuses repeated or unknown
ids. More than 100 ids gives `422 too_many_requests` with the count. An existing collection plan
gives `409 collection_plan_exists` unless `replaceExisting` is true, which the UI asks first, as
AP-032 does.

Building neither needs nor checks AP-026's first-run confirmation, because no script is run. The
review (R14) states what that confirmation would have. Building is allowed while a functional run is
in progress, because it only reads. The frontend passes the run panel's ordered selected ids through
a new `onSetUpPerformanceTest` callback.

## R19. Ids, determinism and fingerprints (FR-023)

**Decision**:
- **Ids.** The journey id is `j_` + `shortDigest("collection-journey", collectionId)`. A step id is
  `s_` + `shortDigest("collection-step", itemId)`, because each item appears once (AP-026 refuses
  repeats). The ids survive rebuilds, order changes and removal.
- **Fingerprint.** It adds `collection` (without `review` and `collectionState`) to the canonical
  JSON when present. Existing plans keep their fingerprint.
- **Order.** Steps follow the built order, then the engineer's step order. Findings follow step
  order, then owner order, then line. Values follow name order.
- **Tests.** Byte-identity of the script is tested ten times (SC-004).

## R20. Frontend

**Decision**:
- **Page and tab.** `pages/CollectionPerformancePage.tsx` composes `PerformancePlanScreen` with
  `createPerformanceClient("/api/collection-performance")`. It adds the collection header (name,
  state, **Rebuild**) and the empty state. It is a fifth lazy tab, "Collection Performance Test",
  shown once opened from a collection.
- **Entry.** `ExternalCollectionRunPanel` gets **Set up a performance test** beside **Start run**. It
  calls `onSetUpPerformanceTest(orderedSelectedIds)`, which the page lifts to `App`, as the guided
  hand-off does.
- **New components** in `components/performance/collection/`:
  - `ConversionReview`: findings grouped by step and owner, left-out requests, scope notes, the
    statement, and **Mark as reviewed**;
  - `CredentialRequestList`;
  - `CollectionStepSource`: folder path, request name, captures with their origin, references and
    bindings, generated values.
- **Reused:** `OtherOperationsTable` for the Removed and Left-out views (keyed by item id),
  `PendingBar` items for review and out-of-date, `CaptureEditor` and `BindingSourceControl` for
  FR-019 (targets are the step's environment references), `CountedOperationList`, and
  `WriteOperationSummary`.
- **Labels.** Specification-specific labels take a source-aware variant, for example "Not documented
  in a specification" and "from the collection's test".
- **Not offered.** AP-033's editors and AP-035's journey composer do not appear for collection
  plans.

The UI uses AP-027 tokens and components. States are given in text, not colour alone. Lists are
semantic tables and lists.

## R21. Testing strategy

**Unit tests:**
- `recognizeScript`: every recognised form, every finding code, aliases (including reassignment),
  `pm.test` with function and arrow callbacks, unreadable scripts, and source order.
- `statusAssertions`: the R7 table and intersection.
- `readCollectionRequests`: inheritance (request, folder, collection), disabled headers and query
  parameters, path variables, body modes, folder scripts.
- `bindCollectionPlan`: binding, re-binding on reorder and removal, superseded setters, scope notes.
- `credentialRequests`: classification edge cases.
- `collectionValues`: base URL, secrets, literal names.
- The digest, the review reset, and the R9 values in the k6 sandbox: determinism, uniqueness over 10
  virtual users × 10 iterations × several occurrences, formats.
- The renderer: a new golden for the User Story 1 collection, the AP-034 check, and a seeded-literal
  scan (the literal token never appears in the script, the template, logs or the snapshot).

**Integration tests (Supertest):**
- build, read, rebuild and replace;
- the review gate and the out-of-date gate;
- `PUT /plan` refusals of AP-033 and AP-035 fields;
- environment seeding, and the gate opening;
- runs listed by source;
- the snapshot without excerpts.

**Opt-in real k6** (`test:k6-real`): the User Story 1 collection against the stateful customers stub
with token issue and `expires_in` (SC-001, SC-002, FR-028).

**Frontend:** the run panel action, the page, the review gate, credential list and left-out view.

**Regenerated goldens:** AP-029 and AP-035, diff-reviewed (R10).

## R22. Delivery order and version

**Decision**:
1. **P1, User Story 1:** the R2 seam, reading, recognition, bindings, statuses, credential requests,
   the runtime, routes, the review, the page.
2. **P2, User Story 2:** R9.
3. **P3, User Story 3:** findings UI completeness and FR-019 captures.
4. **P4, User Story 4:** R17.

The version bump is minor, 19.16.0 → 19.17.0 (`npm run version:bump -- feature`).

**No new dependency, no AI, no configuration, no table.**
