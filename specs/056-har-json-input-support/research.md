# Research: HAR and JSON API Input Support

Phase 0 output for [plan.md](plan.md). The spec has no `NEEDS CLARIFICATION` markers; the open points were design
choices the spec left to planning (limits, evidence threshold, contract field names) and a few places where the
existing code constrains the design. Each decision lists what was chosen, why, and what was rejected. References such
as `backend/src/openapi/parseYaml.ts` describe the code as read on 2026-10-18.

## Facts about the current code that shape the design

- `POST /api/specifications` and `POST /api/test-generation-workflow` both read the upload as UTF-8 and call
  `parseYaml` then `validateSpec` then `buildApiModel`. `startWorkflowFromUpload` has the same three calls.
- `js-yaml` parses JSON, so an OpenAPI JSON file already works today through the YAML path by accident. No format is
  reported, and nothing else is accepted.
- The frontend rejects anything not matching `/\.ya?ml$/i` before upload (`TestGenerationWorkflowPage.tsx:317`) and the
  input has `accept=".yaml,.yml"`. The AP-032 quick test has its own YAML-only control (`SourceStep.tsx`).
- `ApiModel`, `Parameter`, `RequestBody`, `Response`, `SchemaConstraint` have no provenance, and `required` is a plain
  `boolean`.
- Operation identity is `(method, path)`: `toOperationKey`, `TestScenario.operationPath/operationMethod`, dependency
  `FieldRef`, selection keys, Postman folders. 129 references in 57 files.
- Test generation is `RULES` over each `ApiOperation`, with `deduplicate`; assertions come from documented responses.
  `buildScenario` assigns `randomUUID()` ids.
- Credential detection has one definition, `testDesign/sensitiveValueDetection.ts`, shared by review (redact) and export
  (variable substitution), with a stated rule that there must not be two definitions.
- The workflow store is in-memory and keyed by session; the multer upload is memory-only.
- The k6 and execution paths read `environment.baseUrl`; `ApiModel` has no server list.
- The Postman exporter (`postman/requestItem.ts`) emits a request body only for JSON and `text/*` content types (`raw`
  mode); `PostmanBody` has the single `raw` shape; `validateCollection.ts` requires `raw`. It substitutes credentials by
  header name, body-field name, or `Bearer` shape, and a credential-named query parameter is not substituted.

## R1. Governance: observed and inferred information (constitution amendment)

**Decision**: Before implementation, amend the constitution 3.1.0 to 3.2.0 (MINOR, materially expanded guidance) through
`/speckit-constitution`, and resync `specs/constitution.md`. **Status (2026-10-18): applied to
`.specify/memory/constitution.md`; review and the `specs/constitution.md` resync remain (task T001).** Plan and tasks
proceed in parallel; no implementation task starts before the amendment is merged.

**Proposed wording** (for the amendment PR to refine):

- Preamble list: add *6. Observations: facts recorded from captured traffic (for example a HAR file)* and *7. Inferences
  ApiPilot derives from observations (for example a path parameter or an inferred schema)*. Keep the existing five.
- Principle I: add that "when no specification exists and the user supplies a capture, the capture is evidence, not a
  contract. Observed facts MUST be labelled observed, MUST carry their supporting observation count, and MUST NOT be
  presented as documented or as the API's guaranteed behavior. A status code, field, constraint or authentication
  scheme that was not observed MUST NOT appear."
- Principle XIII: add `OBSERVED` and `INFERRED` as provenance origins for facts (scenario `source` stays `RULE` for
  deterministic generation; the origin is carried in the evidence block).
- Principle XIV: state that an inference from observations is a marked inference, never a specification fact.
- Principle XV: state that value-reuse evidence from a capture supports at most a likely relationship.

**Rationale**: The spec's Assumptions require it. Doing it as an explicit amendment (not a plan-level carve-out) is what
Governance's conflict-resolution procedure requires, and what AP-029, AP-032, AP-033 and AP-036 each did.

**Alternatives**: Treat observations as "user-provided assumptions" (category 4). Rejected: it hides that the data is
machine-observed and that its trust level differs from a user's explicit configuration. Skip the amendment and rely on
the spec. Rejected: Principle I would be silently contradicted.

## R2. HAR is not converted into an OpenAPI document

**Decision**: The HAR adapter builds `ApiModel` directly. It never constructs an OpenAPI document or a Postman
collection, and never calls `buildApiModel` with synthesized input.

**Rationale**: `buildApiModel` treats everything it reads as documented. A synthesized OpenAPI document would make
observed statuses and schemas indistinguishable from a contract (FR-016, FR-028 would fail) and would require inventing
`description`, `required` and `components`. FR-031 also forbids Postman as an internal representation, and FR-032 forbids
depending on a conversion library.

**Alternatives**: Use an existing HAR-to-OpenAPI package. Rejected on FR-032, on provenance loss, and on supply-chain
weight for a feature that handles credentials. Convert then post-label. Rejected: labelling after the fact cannot
recover which facts were observed.

## R3. Format detection by content

**Decision**: `detectFormat(text)` is a pure function with this order:

1. Strip a UTF-8 BOM. If nothing remains, fall through to the YAML path unchanged (the existing `invalid_yaml`
   outcome "document is empty or not an object"). This preserves SC-002 and already names the problem.
2. If the first non-whitespace character is not `{` or `[`, the content is **YAML**: run today's pipeline, label
   `openapi-yaml`. All existing parse errors, version errors and issues are unchanged (FR-006).
3. Otherwise pre-scan nesting depth (R9) and `JSON.parse`. On success, classify (below). On failure, try the YAML
   parser: a YAML flow mapping that is not JSON still takes the YAML path (label `openapi-yaml`). If YAML also fails,
   throw `invalid_json` (400) whose message gives the JSON parse position and never echoes content. A `.har` file that is
   truncated JSON lands here, so the failure names the real problem, not the extension (spec US1 scenario 7).
4. A JSON document that is not an object (an array, a scalar) is `unrecognized_input_format`.
5. Classify a JSON object by **discriminating markers**, one per family:
   - OpenAPI: `openapi` is a string, or `swagger` is a string.
   - HAR: `log` is an object and `log.entries` is an array.
   - ApiPilot definition: `format === "apipilot.api-definition"` exactly.
   - Postman collection: `info.schema` is a string containing `schema.getpostman.com/json/collection/`, or `info` is an
     object with `_postman_id` and `item` is an array.
6. Exactly one marker: route to that family. None: `unrecognized_input_format`, listing the supported formats and
   saying nothing was identified. Two or more: `ambiguous_input_format` naming the matched families. No precedence is
   ever applied (spec edge case).
7. OpenAPI marker routes into the existing `validateSpec`, so Swagger 2.0 and non-3.x versions get the identical
   `unsupported_version` outcome as YAML (FR-007).

The file name is used only for the report and logs, never for routing (FR-001).

**Rationale**: Discriminating markers keep detection cheap and make "arbitrary JSON is never a definition" structural: a
definition needs the exact format identifier (FR-003, US6 scenario 6). The messages name families, not the document's own
keys, so an unknown JSON file's content is never echoed.

**Alternatives**: Score by field overlap. Rejected as guesswork (the spec forbids guessing). Use `Content-Type` of the
multipart part. Rejected: browsers send `application/json` for `.har`.

## R4. Postman routing is a marker check, not an import

**Decision**: The Postman marker in R3 only decides routing. The error `postman_collection_detected` (400) tells the user
the file is a Postman collection and points to Import & Run Collection, and nothing is imported. The detector does not
load `postman-collection`.

**Rationale**: FR-004 and FR-031. Reusing `parseUploadedCollection` would build a `Collection` object for a file that
must not be processed here, and it requires at least one request, which is the wrong failure mode for routing.

## R5. One input layer, per-format adapters

**Decision**: `loadApiInput(buffer, filename)` returns `{ apiModel, input: { format, label }, importReport? }`. It calls
an adapter per format. The OpenAPI adapter wraps the **unchanged** `parseYaml` / `validateSpec` / `buildApiModel`; for a
JSON document it passes the already-parsed object to `validateSpec` and `buildApiModel` (the same functions, so the same
issues and model). Both upload routes and `startWorkflowFromUpload` call it. `createQuickTest` keeps calling `parseYaml`
directly (FR-054).

**Rationale**: One entry point makes "every downstream stage consumes one model" structural (FR-027) and removes the
duplicated three-call sequence in two places (the spec's "format-independent input layer").

**Alternatives**: Put detection in each route. Rejected: duplicates logic and violates thin routes (CLAUDE.md section 22).

## R6. Model extension is additive, optional and absent for OpenAPI

**Decision**: Every new field is optional. For OpenAPI input none is set, so the YAML model and the JSON model are deeply
equal, and every existing consumer is untouched (FR-029, SC-001, SC-002). **An absent `provenance` means documented.**
That is a deliberate meaning for omission, justified by backward compatibility; the alternative would add a field to
every OpenAPI fact. The detected format is carried on the response envelope and on `TestGenerationWorkflow.input`, not
inside `ApiModel`, so OpenAPI models gain nothing at all.

"Unknown" values (FR-017) cannot be a `boolean` today. `required: false` is kept for compatibility, with
`requiredUnknown: true` as the explicit marker. Existing consumers read it as optional, which is the conservative
direction (no missing-field negatives, no fabricated requirement).

**Alternatives**: Change `required` to `boolean | "unknown"`. Rejected: breaks every consumer's type. Add `ApiModel.input`.
Rejected: it would make the YAML model differ from the JSON model for no consumer benefit.

## R7. Provenance and confidence

**Decision**: `FactProvenance = { origin: "documented" | "declared" | "observed" | "inferred"; observationCount?: number; confidence?: "low" | "medium" | "high" }`.
`confidence` is a pure function of evidence: `high` when the count is at least `OBSERVED_EVIDENCE_MIN_OBSERVATIONS` (3)
and the observations are consistent, `medium` for 2, `low` for 1 or any conflict. `observationCount` and `confidence`
exist only for observed and inferred facts (FR-028).

**Rationale**: A count plus a derived label is what lets a reviewer read "seen once" versus "seen 40 times" without a
legend. A pure function keeps it testable and deterministic.

## R8. HAR validation without a library

**Decision**: Hand-written structural checks in `validateHar.ts`: valid JSON (done by detection), `log` object,
`log.entries` array, at least one entry (FR-009). HAR 1.2 fields are optional to the importer; version and creator are
read only for the report. Per-entry validation (`extractEntry.ts`) requires a string `request.url` and an integer
`response.status` (a missing status is malformed; `0` is a failed request, excluded, R11). Everything else may be absent
(FR-010).

**Rationale**: FR-032 and the fact that real captures from different tools omit many optional fields.

## R9. Limits and where each is enforced

| Limit | Default | Setting | Enforced at | On exceed |
| --- | --- | --- | --- | --- |
| Upload size | 10 MiB | unchanged `MAX_UPLOAD_BYTES` | multer | `413 file_too_large` (existing) |
| HAR entries | 5,000 | `INPUT_HAR_MAX_ENTRIES` | after `log.entries` is read | `413 input_limit_exceeded`, names the limit |
| Analyzed body size | 1 MiB | `INPUT_MAX_BODY_BYTES` | `decodeBody` before parse or decode | body skipped, reason `oversized`, issue `unsupported-content` |
| Document JSON nesting | 128 | `INPUT_MAX_JSON_DEPTH` | linear pre-scan before `JSON.parse` | `413 input_limit_exceeded`, names the limit |
| Embedded body JSON nesting | 32 | constant | `decodeBody` | body marked unavailable, reason `too-deep` |
| Derived operations | 2,000 | constant | `buildHarModel` | `413 input_limit_exceeded` |
| Retained examples per operation | 5 | constant | `mergeObservations` | extras counted, not stored |
| Distinct values kept per path parameter | 10 | constant | `inferPathParameters` | count kept, values truncated |
| Leaf values extracted per body for dependency evidence | 500 | constant | `detectDependencies` | truncated, counted |
| Issues per kind | 200 | constant | `buildHarModel` | one summary issue "N more suppressed" |
| Exclusion samples listed per reason | 20 | constant | `buildHarModel` | count only beyond 20 |

The depth pre-scan is a single pass that tracks `{`/`[` nesting while skipping string literals, so a hostile
`[[[[...` is refused before `JSON.parse` recurses. 128 exceeds the existing `MAX_WALK_DEPTH` (100) in `validateSpec`,
so a legitimate OpenAPI JSON document is never refused by the new limit where its YAML twin would be accepted.

Analysis is `async` and awaits `setImmediate` every 100 entries. The output does not depend on where it yields.

**Rationale**: Each limit protects a different resource (memory, CPU, recursion, output size) and each message names its
limit (FR-045). Defaults come from the spec's own typical-capture target (500 entries) with 10x headroom. Environment
variables get `.env.example` entries and startup validation like `AI_ENHANCEMENT_RUN_BUDGET_MS` (CLAUDE.md section 48).

**Alternatives**: Streaming JSON parser. Rejected: the 10 MiB cap bounds the parse to tens of milliseconds, and a
streaming dependency adds complexity without raising the cap (which the spec forbids). Worker thread. Rejected, see
plan Complexity Tracking.

## R10. URL and path normalization (documented, deterministic)

**Decision** (full rules in [contracts/har-import-rules.md](contracts/har-import-rules.md)): Parse with `new URL`, which
only parses and never fetches. Origin is `scheme://host[:port]` with lower-cased scheme and host and the default port
removed. Userinfo is stripped from the URL and recorded as an observed credential. Path processing, in order: drop
query and fragment; remove dot segments per RFC 3986 section 5.2.4 as a string operation (no filesystem is touched);
collapse runs of `/`; decode percent-escapes of unreserved characters only and upper-case the hex of the rest, so `%2F`
stays distinct from `/`; fold one trailing slash except for the root. Segment case is preserved (paths are
case-sensitive). The first three observed raw paths for each operation are kept as examples, so normalization is
auditable. The counts of folded slashes and removed dot segments go in the report.

**Rationale**: Folding a trailing slash is the one lossy step. It is taken because servers overwhelmingly serve both as
one resource, and it is reported. `%2F` stays encoded because merging it with `/` would merge genuinely different
resources (the spec's edge case).

## R11. Entry classification and exclusion rules (ordered, first match wins)

**Decision**: After extraction, an entry is **malformed**, **excluded** with exactly one reason, or **imported**.
Order and reasons:

1. Malformed (missing or non-string `request.url`, unparseable URL, relative URL, missing method, missing or
   non-integer `response.status`): `malformed` with position and reason.
2. Non-HTTP(S) scheme (`ws:`, `wss:`, `data:`, `file:`, extension schemes): excluded `non-http-scheme`. `ws`/`wss` also
   raise an `unsupported-content` issue.
3. `OPTIONS` with an `Access-Control-Request-Method` header: excluded `cors-preflight`. A plain `OPTIONS` is kept.
4. Streaming (`text/event-stream` response, or a `_webSocketMessages` array): excluded `streaming`, plus
   `unsupported-content` issue.
5. `status === 0` (no response, network failure): excluded `failed-request`.
6. 3xx: excluded `redirect` (the redirect target is its own entry and is judged on its own).
7. `304`: excluded `not-modified` (a cache artifact, not an observed API outcome). 3xx and 304 are never recorded as
   observed statuses because a positive scenario asserting `302` or `304` would be wrong when executed.
8. Static asset: `GET`/`HEAD` whose response mime type is `image/*`, `font/*`, `text/css`, `*/javascript`, or whose path
   extension is in a fixed list (`.js .mjs .css .map .png .jpg .jpeg .gif .svg .ico .webp .woff .woff2 .ttf .otf .eot`):
   excluded `static-asset`. `text/html` responses: excluded `html-document` (page navigations).
9. Analytics and telemetry: host equals or is a subdomain of an entry in the frozen list in `analyticsHosts.ts`:
   excluded `analytics-telemetry`.
10. Unrelated third-party origin (R12): excluded `third-party-origin`.
11. Same `(method, path)` on another included origin that lost the collision rule (R13): excluded
    `duplicate-method-path-other-origin`.

Otherwise the entry is imported. `imported + excluded + malformed = total` is an invariant checked in `buildHarModel`
(FR-020, SC-005); a violation is an internal error, not a silent correction.

**Rationale**: An ordered rule list with one reason per entry makes counts reconcile by construction and lets the summary
group by reason. Dropping redirects and 304s avoids executable scenarios that assert a transient status.

**Alternatives**: Keep redirects as observed statuses. Rejected, as above. Let users re-include. Out of scope per spec.

## R12. First-party origin scope

*(Rule confirmed by clarification 2026-10-18, option A; FR-019 now states it.)*

**Decision**: `originScope.ts` computes the **anchor origins**: the origin of each parseable `log.pages[].title` URL, plus
the *primary API origin*, which is the origin with the most API-like entries (response mime type JSON, XML or
`+json`, a JSON request body, or a `_resourceType` of `xhr`/`fetch`), ties broken by lexicographic origin. An origin is
**related** when its site key equals an anchor's. The site key is the last two host labels, or the last three when the
second-level label is in a small fixed table (`co`, `com`, `org`, `net`, `gov`, `ac`, `edu`). IP-address hosts and
`localhost` compare by exact host. API-like entries on unrelated origins are excluded `third-party-origin`.

**Rationale**: A public-suffix list would be the accurate tool but adds a dependency and a data file to maintain. The
heuristic is deterministic, documented and conservative in the harmful direction (it can exclude a real API, which is
always reported, rather than import an advertising endpoint as part of the API).

**Alternatives**: Treat every origin as first-party. Rejected: real captures are mostly third-party noise. Add a public
suffix list. Deferred; a replacement of `siteKey()` only.

## R13. Multi-origin collisions (resolved by clarification 2026-10-18)

**Decision**: Group by `(origin, method, normalized path)` as FR-012 requires, and record the origin on each operation
(`observed.origin`). If two groups on different origins have the same `(method, path)`, keep the one with more
observations (ties: lexicographically smaller origin), exclude the other's entries with reason
`duplicate-method-path-other-origin`, and add a `duplicate-operation` analysis issue naming both origins. Different
`(method, path)` pairs across origins are all imported.

**Rationale**: The original spec edge case said the two are different operations. In the model they cannot be: `(method,
path)` is the identity in 129 references across 57 files, scenarios and the Postman folder structure are keyed by it, and
execution targets one environment base URL, so an operation on a second origin could not be sent to the right host
anyway. The owner chose this behaviour in the clarification session of 2026-10-18 (option A), and the spec's Edge Cases,
FR-012 and Origins assumption now state it. Reporting the loss is consistent with Constitution XIV.

**Alternatives**: Add `origin` to the operation key everywhere. Rejected for this feature: large, risky, and still not
executable against one base URL. Prefix the path with the origin. Rejected: it would corrupt the URL the exporter
builds.

## R14. Path parameter inference

**Decision**: `inferPathParameters.ts`, per `(origin, method, segment count)`:

1. Mark each observed segment **identifier-like** by a pure predicate: all digits; UUID; 24 hex characters; at least 8
   hex characters; ULID (26 Crockford base32); or an alphanumeric token of 16 or more characters containing both a
   digit and a letter. Shorter mixed tokens (`v1`, `abc12`) and ordinary words are literal.
2. A path's **skeleton** replaces each identifier-like segment with a wildcard. Paths with equal skeletons are one
   candidate group.
3. In a group, a wildcard position becomes a path parameter only when it has at least **2 distinct** values across the
   group (`PATH_PARAM_MIN_DISTINCT = 2`). A wildcard position with a single distinct value stays literal and raises an
   `ambiguous-path` issue (possible parameter, insufficient evidence; FR-013).
4. Names are inferred: the singularized previous literal segment plus `Id` (`users` gives `userId`), falling back to
   `id`, with a numeric suffix on collision (`id2`). Singularization is the small rule used by
   `postman/artifactVariables.ts` (`categories` to `category`, trailing `s` removed).
5. The decision is recorded as `origin: "inferred"`, with the distinct-value count as `observationCount`, and the
   observed values (up to 10) become examples.

A non-identifier segment (`/users/me`) is literal and forms its own operation (`/users/me` versus `/users/{userId}`).

**Rationale**: Wildcarding only identifier-like segments prevents `/users/list` and `/users/search` from being
collapsed into `/users/{param}`, which would merge genuinely different resources. Defining "otherwise identical" as
"same skeleton" is what lets `/users/1/orders/9` and `/users/2/orders/8` produce two parameters instead of none. The owner
chose this in the clarification session of 2026-10-18 (option A), and FR-013 now states it.

**Alternatives**: Treat any varying segment as a parameter. Rejected: collapses real distinct resources. Require every
other segment to be byte-identical. Rejected: fails on every multi-parameter path, which are common.

## R15. Observation merging

**Decision**: `mergeObservations.ts` groups imported entries by `(origin, method, normalized path)` and, per operation,
records: observation count; per-status counts; query parameter names with how many observations carried each (as
`observed N of M`); request header names (after dropping transport noise, see contract) with counts; and **examples**.
An example is the redacted request (path parameter values, query values, body) plus the response status it received.
Identical examples collapse into one with a count. At most 5 examples are kept, ordered by count descending then first
observation index; the rest are counted. Request `Content-Type` values are kept per example. Non-path parameters get
`requiredUnknown: true` (FR-017).

## R16. Schema inference (structural only)

**Decision**: `inferSchema.ts` walks parsed JSON bodies (string, number, integer, boolean, null, object, array) and builds
a `SchemaConstraint` containing only `type`, `properties`, `items` and `required`. `required` holds names present in
**every** observation of that body (FR-015). No `enum`, `format`, `minimum`, `maximum`, `pattern`, length or item-count
constraints are ever inferred, because a value that was merely seen is not a constraint.

Schemas are kept per operation, per direction and per **response status** (and per content type), never merged across
statuses. Where observations disagree on a field's type, the field gets no `type`, and a `conflicting-types` issue
names the operation, status and field path (never a value). An integer and a float for one field are `number`.
Alongside the schema, `SchemaEvidence` records per dotted field path `presentIn` (observations containing it) and a
`types` histogram, plus the observation total. Arrays merge element schemas across all elements of all observations.
Object keys are collected in `Object.create(null)` maps, so a key named `__proto__` cannot alter a prototype.

Evidence is a parallel structure rather than counts inside `SchemaConstraint`, so the shared constraint shape and every
consumer of it stay unchanged.

**Rationale**: The test designer needs counts to apply the threshold (R21), and the review UI needs them to show
"seen in 2 of 5". Keeping the schema literal (present in all observations means `required`) matches the spec text, and
the threshold gate lives where scenarios are decided.

**Consequence**: An AI-suggested negative scenario can target a field that is `required` from a single observation. It
remains labelled AI, is validated against the model, and is reviewed by the user (FR-039 asks for model validation, not
the threshold). Noted as a limitation in the docs.

## R17. Body availability and encodings

**Decision**: `decodeBody.ts` returns `{ available: true, value }` or `{ available: false, reason }`, reasons being
`missing`, `empty`, `oversized`, `binary`, `compressed`, `undecodable-encoding`, `truncated`, `not-json`, `invalid-json`,
`too-deep`, `multipart-file`.

- `content.encoding` of `base64` is decoded when the declared size is within the body limit; any other declared
  encoding is `undecodable-encoding`.
- Compression is **not** undone. A body with `Content-Encoding` of `gzip`, `br` or `deflate` and no usable text is
  `compressed`. This closes decompression-bomb exposure entirely instead of mitigating it (spec edge case on bomb-like
  bodies).
- Binary mime types (`image/*`, `audio/*`, `video/*`, `application/octet-stream`, `application/pdf`, zip family) are
  `binary` and the body is not decoded.
- A declared JSON content type whose text does not parse is `invalid-json`; declared size larger than the text length
  is `truncated`. Neither is coerced.
- Form-urlencoded and multipart bodies are **available** (clarification 2026-10-18, FR-056): the HAR `postData.params`
  (or the parsed `postData.text` for urlencoded) become a flat object of field name to string value, with credential values
  replaced at extraction (R18). Presence is the only structure inferred (spec edge case), so the modelled constraint is one
  string-typed property per field. A multipart part with `fileName` or its own `contentType` carries file content that a
  HAR does not hold in reproducible form: the request body is `multipart-file` (unavailable for replay) while its text
  fields still count as evidence.
- Any unavailable body keeps the entry's method, path and status, records the reason, and raises one
  `unsupported-content` or `incomplete-observation` issue per `(operation, reason)`.

**Consequence**: An operation observed only with unavailable bodies (including multipart file uploads) may have no
example-backed positive scenario. It stays in review and says why (FR-040, R21). Form-only operations do get a positive
scenario, which is why the exporter must learn to send form bodies (R31).

**Alternative rejected (superseded)**: keeping form bodies presence-only with no scenario. That was the first plan; the
owner chose to generate the scenario instead.

## R18. Redaction

**Decision**: `redaction.ts` is applied **inside `extractEntry`**, so unredacted values never leave the function that
copies them. `extractEntry` builds a new observation object from an allow-list of named HAR fields; unknown fields (for
example Chrome's `_` extensions) are never copied.

Detection reuses `isSensitiveHeaderName`, `isSensitiveFieldName`, `isBearerTokenValue`, `credentialKindForHeader` and
`credentialKindForField` from `testDesign/sensitiveValueDetection.ts` unchanged (FR-034: the OpenAPI review and export
behaviour must not change). The input layer **adds** its own extension, because captured traffic carries credentials
the OpenAPI-oriented predicates do not look for:

- Header names: `x-auth-token`, `x-csrf-token`, `x-xsrf-token`, `x-amz-security-token` plus any name matching the
  existing credential pattern.
- Query, cookie, form and JSON field names matching the existing pattern, plus exact names `key`, `sig`, `signature`,
  `sid`, `sessionid`, `session`, `auth`, `authorization`, `jsessionid`, `code` (OAuth), `jwt`.
- Value patterns, high confidence only: a JWT (`eyJ` prefix, three base64url segments), `Bearer <token>`,
  `Basic <base64>`, an AWS access key id (`AKIA` plus 16 uppercase alphanumerics).
- URL userinfo.
- Every value in a `Cookie`, `Set-Cookie`, HAR `cookies` array.

A detected value is replaced with `[redacted:<kind>]` where kind is `token | apiKey | password | cookie | session`. The
model records `credentialsObserved: { location, name, kind, observations }[]` without a value (FR-047), and the report
and an informational `credential-detected` issue state that a credential of that kind was seen. The structure of
observed bodies is preserved with placeholders in place of values. Logs record only counts.

Value-reuse detection (R19) runs on the in-memory pre-redaction values inside `detectDependencies` and emits evidence
with credential values withheld; this is the only place pre-redaction values exist, it is a pure function, and its
output is part of the same audited surface.

The placeholder format is a contract between two modules: redaction writes it, and the exporter's variable substitution
recognizes it (R24, `redactionPlaceholderKind` in the same shared file as the predicates above), so a value redacted here is
guaranteed to become a secret variable reference there, in headers, JSON and form fields, and query and path values.

**Rationale**: Redacting before the model exists is the only placement that makes leaks structurally impossible for
every downstream stage (spec Assumption "Redaction placement"). An allow-list means a new tool's custom field cannot
smuggle a secret through. Reusing the predicates honors the existing "one definition of credential" rule.

**Alternatives**: Redact at the API boundary on the way out. Rejected: the AI prompt, logs and Postman exporter would each
need their own. Pattern-scan all string values for secrets. Rejected: false positives on ordinary data. Only
high-confidence value patterns are used.

## R19. Dependency evidence from a capture

**Decision**: `detectDependencies.ts` runs after grouping, over imported entries in chronological order (the ordering rule in
[contracts/har-import-rules.md](contracts/har-import-rules.md): file order, or timestamp order when every usable entry
has a valid timestamp). It extracts scalar leaf values
from each response body (dotted field path, `[]` for arrays) and looks for them in **later** entries' path segments,
query values, header values and JSON request-body leaves.

A value counts as evidence only if it is **distinctive**: a string of at least 8 characters or an integer of at least 4
digits; not a boolean or null; not a member of a small stoplist (common MIME types, `true`/`false` strings, ISO currency
codes); produced by exactly one `(operation, field)` pair in the capture; and not appearing as a value of 3 or more
different fields. The producer and consumer must be different operations.

Output is a `DependencyHint`: producer and consumer `FieldRef`s, the number of distinct consuming entries, the order
fact, and a sample value truncated to 32 characters, **withheld** when either field name is credential-like or the
value matches the credential or email patterns (`valueWithheld: true`). Matches in a credential position (for example a
login token reused in `Authorization`) are kept, with the value withheld, since that is the most useful dependency.

**Confidence mapping**: one consuming entry gives `POSSIBLE`; two or more give `LIKELY`; never `CONFIRMED` from value
matching alone (FR-038).

**Rationale**: Short numeric ids and booleans collide constantly, so excluding them trades recall for the spec's
requirement that coincidences are not evidence. Requiring a unique producer removes the "id: 1 appears everywhere" class.

## R20. Merging hints into the existing dependency analysis

**Decision**: `analyzeDependencies` converts `ApiModel.dependencyHints` into `ApiDependencyRelationship`s and passes
them through the existing `mergeRelationships` disambiguation. `DependencySource` gains `"observed"` and `"declared"`
(additive). When the existing deterministic analysis also finds the same pair, the relationship keeps source
`"deterministic"`, takes the higher confidence, and attaches the hint as `inputEvidence`, so an existing confirming
signal (name match plus type or format plus shared resource path) can still give `CONFIRMED`, which the spec's
assumption permits.

Declared hints (definition format) are verified: the operations exist (checked at validation), and if both operations
declare schemas, both fields must exist in them. Verified gives `CONFIRMED`; unverifiable (no schema on one side) gives
`LIKELY` with the reason in `explanation`.

**Rationale**: Reuses disambiguation, cycle detection and workflow assembly instead of a parallel graph (FR-033).

## R21. Scenario generation for observed and declared operations

**Decision**: `generateTestModel` picks the rule list per operation by `operation.provenance?.origin`:

- Absent, or `documented`: today's `RULES`, unchanged (FR-034).
- `declared` (definition): today's `RULES` plus `declaredExampleScenarios` (a positive scenario from the first declared
  request example, only when the operation has an example and no body schema to generate from). Assertions follow
  `assertions.ts` against declared responses (FR-037).
- `observed`: only `observedExampleScenarios`.

`observedExampleScenarios` emits, per operation:

1. One positive scenario for each distinct observed **2xx** status, built from the most-observed example with that
   status. The request is the observed redacted example; the only assertion is `status-code` with that status and
   `basis: "observed"`. No schema, header or body assertion is ever generated (FR-035, spec Assumption "HAR assertions").
2. For each request-body field that appears in every one of at least `OBSERVED_EVIDENCE_MIN_OBSERVATIONS` (3) body
   observations: one `missing-field` scenario removing it from the chosen example.
3. For each request-body field with exactly one observed type across at least 3 observations: one `invalid-type`
   scenario using the existing wrong-type value helper from `valueGenerators.ts`.
4. Negative scenarios carry an assertion only if an **observed non-2xx example's request equals** the mutated request
   (deep equality on the redacted request); then the assertion is that example's status with `basis: "observed"`.
   Otherwise the assertion list is empty with a gap description, as today's negative rule does (FR-036).

Every observed scenario gets `evidence: { origin, observationCount, basis description }` and is labelled
inference-derived when it is a negative. No boundary, enum, format or constraint-violation scenarios are generated for
observed operations: nothing observed is a constraint of that kind.

Form-style bodies take the same path as JSON bodies: the positive scenario reuses the observed flat object, and
`missing-field` negatives apply to form fields seen in all of at least 3 bodies. `invalid-type` is JSON-only, because every
form value is a string by encoding. Examples are filtered to the operation's primary request content type so the exporter's
body mode always matches the example.

An operation with no scenario from any rule yields a `GenerationNote` (for example "no successful response was observed",
"every observed request with a body had a multipart file part") stored on the workflow, so it stays reviewable with its
reason (FR-040). The reason list is in [contracts/observed-generation-rules.md](contracts/observed-generation-rules.md).

**Rationale**: Dispatching on provenance keeps the designer parser-agnostic (FR-030) and leaves OpenAPI untouched.
The "request equals an observed failure" rule is the most literal reading of "unless a matching failure was observed"; a
looser match would guess. Reusing `deduplicate` and the existing helpers keeps one generation pipeline.

**Alternatives**: Run all `RULES` over inferred schemas. Rejected: it would generate boundary and enum scenarios from
constraints nobody declared, and assert 4xx codes. Add a new `ScenarioCategory`. Rejected: not needed, and it would ripple
through the AI prompt, validator and UI.

## R22. The definition format: Ajv plus a published schema

**Decision**: Version 1 of `apipilot.api-definition` is specified by `contracts/api-definition.v1.schema.json` (JSON
Schema draft-07, `additionalProperties: false` throughout, bounded arrays) and by
[contracts/api-definition-format-v1.md](contracts/api-definition-format-v1.md). `validateDefinition.ts` compiles the
schema once with Ajv (`allErrors: true`, `strict: true`) and maps each Ajv error to `"<JSON Pointer>: <corrective
message>"` (`additionalProperties` becomes "unknown field 'x'", and so on). Code-level checks that JSON Schema cannot
express run after it and report with the same format: duplicate `(method, path)`; duplicate operation `id`; a path
parameter in the path but not declared, or declared but absent from the path; `required: false` on a path parameter;
statuses outside 100 to 599; a `baseUrl` that is not absolute http(s) or has userinfo, query or fragment; a security
reference to an undefined scheme; a dependency hint naming an unknown operation or field.

**Verified during planning** with the Ajv 8.20 copy already installed: the schema compiles under `strict: true` (after
restating the conditionally required properties inside each `then`, which strict mode demands), the example in the format
document validates, and a deliberately broken document returned all nine violations in one pass, with Ajv's `oneOf`
alternatives for a single bad `status` producing three raw errors that the mapper must collapse into one message per
location. The backend task adds Ajv as a direct dependency; the hoisted root `ajv` is 6.x (ESLint), so npm nests the
8.x copy under `backend/`, and the implementation must `import` it from `backend`, never from the root.

The schema is a TypeScript constant generated from the JSON file at build time (a test asserts the two stay equal), so
the runtime does not read the filesystem. Embedded request and response schemas use a **closed subset** that is exactly
`SchemaConstraint`'s vocabulary (`type`, `properties`, `required`, `items`, `enum`, `format`, `minimum`, `maximum`,
`pattern`, `minLength`, `maxLength`, `minItems`, `maxItems`); `$ref`, `$schema` and `$id` are unknown fields, so no
reference can reach the validator, let alone be fetched (FR-046).

Credential values can appear only in examples (authentication metadata has no value fields). They go through
`redaction.ts`, are replaced by placeholders, and raise a `credential-detected` issue (FR-026). Omitted information stays
unknown: no schema means an empty `SchemaConstraint`, no responses means an empty list, no examples means none.

**Rationale**: Constitution XXVIII prefers a standard validator over custom schema code. Ajv gives every violation at
once with a stable instance path. A published schema also gives editors completion for free.

**Alternatives**: OpenAPI-lite (a trimmed OpenAPI subset). Rejected: users with that would just write OpenAPI, and
"unknown versus default" semantics would conflict with OpenAPI's. Hand-written validator. Rejected, see plan Complexity
Tracking.

## R23. AI enhancement

**Decision**: No provider, queue or batching code changes. The scenario prompt builder serializes the redacted
`ApiModel`, so no secret can reach it. For non-OpenAPI models it adds one sentence to the system section: operations come
from captured or declared traffic; listed statuses are observed or declared, not documented guarantees. The OpenAPI
prompt text is byte-identical, which keeps the versioned-prompt rule (XXIII) satisfied (the new sentence is gated on
provenance and covered by a prompt snapshot test). Candidate validation is unchanged: for an observed operation, the
only statuses and fields in the model are observed ones, so candidates referencing anything else are rejected
(FR-039). AI-derived assertions on undocumented statuses are already stripped by the existing 2026-10-15 rule.

**Contract version (decided 2026-10-18)**: `AI_SCENARIO_RESPONSE_VERSION` (currently 5, in `aiScenarioPrompt.ts`, with a
version-history comment per Constitution XXIII) is **not** bumped. The OpenAPI prompt is byte-identical, and a bump would
break existing assertions on the version, which SC-002 forbids. The change is recorded as a dated note in that comment,
and a snapshot test pins the OpenAPI prompt text. If a reviewer prefers a bump to 6, that needs approval to update those
assertions.

## R24. Postman generation, credentials and base URL

**Decision**: URL building is unchanged. `ApiModel` has no server list and the exporter builds URLs from the selected
environment's `baseUrl`, so the capture's origin cannot become an execution target (FR-052). Credential values never
reach the exporter because the model holds `[redacted:<kind>]` placeholders. Reading `postman/requestItem.ts` on
2026-10-18 showed that the exporter substitutes credentials **by name or shape** (a header name, a body field name, a
`Bearer` value), not by placeholder, and that a credential-named **query** parameter is not substituted at all. Left alone, a
captured `api_key=[redacted:apiKey]` would be sent literally. So the exporter gains one additive predicate in the shared
`sensitiveValueDetection.ts`, `redactionPlaceholderKind`, used for headers, body fields and URL values, and
`validateCollection` refuses to generate if any `[redacted:` text would remain. Details and the regression guard (byte
equality of every existing OpenAPI fixture's artifacts) are in
[contracts/postman-artifact-amendment.md](contracts/postman-artifact-amendment.md).

**Alternatives**: Substitute by name only and extend the name list for query and cookie names. Rejected: the redaction
list and the substitution list would be two definitions of "credential" that can drift (the existing code states this is how a
secret slips through one path). Emit the placeholder as-is and document it. Rejected: the run would send junk, and a missing
substitution would be silent.

## R31. Postman form-style bodies (FR-056)

**Decision**: Widen `PostmanBody` to `raw | urlencoded | formdata`, add the two emitting branches to `buildBody`, accept the
modes in `validateCollection`, and teach `performance/plan/stepRequest.ts` the new modes (urlencoded maps to the existing
`form` body kind; formdata is reported as not representable). Multipart omits the `Content-Type` header so Newman supplies
the boundary. Only text fields are emitted; file parts never reach a scenario (R17).

**Rationale**: The clarification chose generating a positive scenario for form-only operations, and today the exporter emits
no body for any non-JSON, non-text content type. Newman supports both modes natively, so execution needs no change.
`PostmanBody` is a compile-time widening on purpose: the compiler enumerates every reader instead of leaving a silent
`undefined` at `body.raw`.

**Risks and guards**: (1) Existing artifacts must not change: a byte-equality snapshot over all existing fixtures. (2) The
widening could reach consumers not yet found: tasks build with the widened type before anything else. (3) k6 chain seeding
from an approved HAR-derived workflow meets `formdata`: `buildStepRequest` returns an unsupported result and its callers
record a left-out step with the reason (the precedent is `left-out-request` in `seedFromCollection.ts`; the first plan wrongly
said an existing "not converted" mechanism covered this path, which it only does for uploaded collections), rather than
inventing a representation.

**Alternatives**: Keep form bodies unsupported (superseded by the clarification). Emit form bodies as `raw` text with a
form `Content-Type`. Rejected: Postman and Newman treat `urlencoded` and `formdata` as structured modes, which is what
users edit and review, and raw multipart would need a hand-written boundary.

## R25. Frontend

**Decision**: Reuse the apiReview stage and the page's existing dropzone. Changes: `accept=".yaml,.yml,.json,.har"`; the
client-side extension guard accepts those four extensions and its message lists them; hero and card wording describe
"OpenAPI (YAML or JSON), HAR capture or ApiPilot API definition" instead of YAML only (FR-041); while uploading, a
`role="status"` line reads "Analyzing capture…" for `.har` and "Uploading…" otherwise (the work is one request, so an
indeterminate indicator is honest; there is no percentage to show); the detected format is shown by `InputFormatBadge`
in the Active run header and the apiReview stage; `HarImportSummary` renders the counts as a `KeyValueGrid`, exclusions
by reason in a semantic table, malformed entries in a `<details>`, and warnings through the existing issue list;
`FactOriginBadge` renders text ("Observed ×12", "Inferred ×3", "Declared", "Documented") plus an icon, never color
alone, with light and dark token variants. `OperationDetail` adds the badges beside parameters, statuses, schema facts
and path-parameter decisions; scenario detail shows the `evidence` and each assertion's `basis`.

`postman_collection_detected` renders a message with an "Open Import & Run Collection" button using the existing
navigation module. `problems[]` (definition violations) renders as a list inside `ErrorState`; the client already
passes `problems` through.

Tailwind v4 utilities and existing tokens only; no custom CSS, no new colors outside the token set.

## R26. Security hardening checklist

- No `eval`, no `Function`, no dynamic `require`/`import` from file content; no regex built from file content.
- `new URL` parses only. Nothing in `apiInput/` imports `http`, `https`, `net`, `dns`, `fs` or `child_process`, enforced
  by a unit test that scans the module's imports.
- `$ref`-style content in HAR bodies is ordinary data. In OpenAPI JSON the existing `stripExternalRefs` still applies.
- Prototype safety: dynamic key accumulations use `Object.create(null)` or `Map`; output objects copy only own,
  non-`__proto__` keys.
- No decompression (R17). Base64 decode only after a size check.
- The upload buffer is overwritten with `fill(0)` in a `finally` in the route, best effort; nothing stores it.
- Logging: only counts, durations, error categories, format names, never URLs, headers, bodies or filenames' contents.
  A test spies on the logger and console across the corpus.
- Errors never include a stack, a path or a value (FR-051); Ajv messages are rewritten, not passed through.
- The HAR path creates no workflow unless at least one operation is derived (FR-021).

## R27. Configuration

`INPUT_HAR_MAX_ENTRIES` (default 5000), `INPUT_MAX_BODY_BYTES` (default 1048576), `INPUT_MAX_JSON_DEPTH` (default 128).
All optional, validated at startup as positive integers by `validateInputConfiguration` next to
`validateAIConfiguration`, documented in `.env.example` and `docs/configuration.md`. The upload limit is not made
configurable here.

## R28. Test strategy and fixtures

- **Fixtures** (synthetic, no real credentials, no network): `backend/tests/fixtures/apiInput/har/` (a realistic
  capture with analytics, a font, a preflight, a redirect, a 304, repeated calls, a varying id, a login that returns a
  token reused later, bodies in each unavailable state, form bodies, two origins, seeded secrets in every location),
  `definitions/` (one valid, one per violation class), `json/` (OpenAPI JSON twins of existing fixtures, Swagger 2.0 JSON,
  Postman collection JSON, arbitrary JSON, an ambiguous document).
- **Equivalence (SC-001)**: for each existing OpenAPI fixture, convert YAML to JSON in the test, run `loadApiInput` on
  both, and assert deep equality of `apiModel` and of `generateTestModel` output with scenario ids normalized.
- **Determinism (SC-003)**: analyze the HAR fixture repeatedly and compare `JSON.stringify` of model and report.
- **Secrets (SC-004)**: seed recognizable markers (`SEEDED-SECRET-*`) in headers, cookies, query, JSON and form bodies and
  URL userinfo; assert none appears in the HTTP response, captured logs, the AI prompt text, the Postman collection and
  environment JSON.
- **Reconciliation (SC-005)** and **grounding (SC-006)**: property-style checks over the fixture and mutated variants
  (counts add up; no status, field, security scheme absent from the capture appears in the model).
- **Limits and isolation (SC-009)**: oversized, over-count, too-deep, oversized-body inputs; a concurrent second session's
  request completes during a large analysis.
- **Exporter changes (R24, R31)**: unit tests per body mode, header handling, credential substitution per location, the
  placeholder predicate and validator checks; a Newman-level test against a local test server for urlencoded and multipart
  bodies; and a byte-equality snapshot of collection, environment and README for every existing OpenAPI fixture.
- **Regression (SC-002)**: the existing suites run unmodified. The OpenAPI prompt snapshot and Postman output for
  existing fixtures must be unchanged.
- AI tests use the mock provider. No real model, GPU or network.

## R29. Documentation, contracts and versioning

README (inputs, HAR quick start, definition, security), `docs/architecture.md` (input layer, provenance, redaction
placement, why HAR is not converted), `docs/USER_MANUAL.md` (capture a HAR from browser devtools or a proxy, strip secrets
before sharing, upload, read origin labels, limitations), `docs/http-api.md` (envelope, error codes),
`docs/configuration.md` plus `.env.example`, `docs/api-definition-format.md`, and the three example files. Amendment
pointers go into the 002 and 009 contract documents. The roadmap entry and the version bump (`npm run version:bump --
feature`, 19.58.0 to 19.59.0, all four package files, lockfile via npm) close the feature, as the standing practice for
ApiPilot features requires. Changes stay uncommitted for review.

## R30. Alternatives rejected at the architecture level

| Alternative | Why rejected |
| --- | --- |
| HAR to OpenAPI to existing pipeline | Loses provenance, fabricates documented facts, conflicts with FR-016, FR-028 (R2). |
| HAR to Postman collection as an intermediate | Forbidden by FR-031; Postman is an output only. |
| A second test-generation pipeline for observed input | Forbidden by FR-033; dispatch by provenance inside one pipeline instead (R21). |
| Add `origin` to operation identity | Cross-cutting and not executable against one base URL (R13). |
| Streaming parser, worker thread | Not justified by the 10 MiB cap (R9, Constitution XXVII). |
| Infer enums, formats and ranges from observed values | A seen value is not a constraint; would yield fabricated negative scenarios (R16). |
| Decompress `gzip`/`br` bodies | Opens decompression-bomb exposure for little value (R17). |
| Keep form bodies presence-only, no scenario | Superseded by the clarification: the owner chose to generate the scenario, so the exporter is extended (R17, R31). |
| Substitute credentials in the exporter by name only | Two definitions of "credential" that can drift; a gap would send a literal placeholder (R24). |
| Per-feature flag for HAR | Ordering plus the secrets corpus test gate it without a flag to forget (plan, Delivery slices). |
