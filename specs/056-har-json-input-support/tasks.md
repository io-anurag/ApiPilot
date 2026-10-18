---

description: "Task list for HAR and JSON API Input Support (AP-056)"
---

# Tasks: HAR and JSON API Input Support

**Input**: Design documents from `/specs/056-har-json-input-support/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md) (with the 2026-10-18 clarifications), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included. The spec's success criteria (SC-001 to SC-010) are verified by automated tests, and project rules treat tests as part of the feature. Within each story, write the tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story. The spec orders the stories P1, P2, P2, P2, P2, P3, P3, but Story 5 (safety) is a release gate for Story 2 (HAR import), so its phase comes first among the HAR stories. No HAR path is reachable before Story 5 and the HAR secrets gate (T058) are done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story the task serves (US1 to US7)
- Tasks `T002a` and `T080a` were added by the analysis remediation of 2026-10-18; they keep the lettered suffix so no other task id or cross-reference moved
- All paths are relative to the repository root `D:\api\ApiPilot`

## Path Conventions

- Backend: `backend/src/`, tests in `backend/tests/unit/` and `backend/tests/integration/`
- Frontend: `frontend/src/`, tests in `frontend/tests/unit/`
- Shared contracts: `packages/shared-domain/src/`
- New backend module: `backend/src/apiInput/`; fixtures: `backend/tests/fixtures/apiInput/`

---

## Phase 1: Setup

**Purpose**: Governance, baseline, and fixture scaffolding

- [ ] T001 Governance prerequisite: have the constitution 3.2.0 amendment in `.specify/memory/constitution.md` reviewed and merged (applied 2026-10-18; this is a human review step), then resync the manual copy `specs/constitution.md` to 3.2.0 (same category list, Principles I, XIII, XIV, XV text, version line, and a "Mirror" note in its Sync Impact Report). No implementation task below may merge before this is done.
- [ ] T002 Record the baseline before any code change: run `npm test`, `npm run lint` and `npm run build` from the repository root and note the pass/fail counts in the working notes, so SC-002 ("existing tests unmodified and passing") can be checked honestly at the end.
- [ ] T002a Capture the exporter baseline now, before any code change: create `backend/tests/unit/postman/existingArtifactsUnchanged.test.ts` that, for every loadable OpenAPI fixture in `backend/tests/fixtures/openapi/` and the shared fixtures in `backend/tests/fixtures/postman/`, builds the test model and generates the collection, environment and README, and compares them to golden files in `backend/tests/fixtures/postman/golden/`. Generate the golden files from the current, unmodified exporter and confirm the test passes (SC-002; plan open item 1). T071 later reuses these goldens and never regenerates them.
- [ ] T003 [P] Create `backend/tests/fixtures/apiInput/README.md` and the empty directories `backend/tests/fixtures/apiInput/har/`, `backend/tests/fixtures/apiInput/definitions/`, `backend/tests/fixtures/apiInput/json/`. The README states: every fixture is synthetic, contains no real credential, needs no network, and seeded secrets use the marker prefix `SEEDED-SECRET-`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Shared contracts, typed errors, limits and safe-JSON helpers that every story uses

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 [P] Create `packages/shared-domain/src/apiInput.ts` with every type and the constant from [data-model.md](data-model.md) *New file*: `InputFormat`, `ApiInputDescriptor`, `FactOrigin`, `FactConfidence`, `OBSERVED_EVIDENCE_MIN_OBSERVATIONS` (3), `FactProvenance`, `CredentialKind`, `CredentialObservation`, `FieldEvidence`, `SchemaEvidence`, `PathParameterDecision`, `ObservedRequestExample`, `BodyUnavailableReason`, `ObservedOperationDetails`, `ExclusionReason`, `ExclusionGroup`, `MalformedEntry`, `ImportAnalysisReport`, `DependencyHint`, `GenerationNote`. No framework imports (CLAUDE.md section 4).
- [ ] T005 [P] Edit `packages/shared-domain/src/apiModel.ts` (additive, optional fields only): `ApiModel.importReport`, `.dependencyHints`, `.declaredBaseUrl`; `ApiOperation.provenance`, `.observed`, `.description`; `Parameter.provenance`, `.requiredUnknown`; `RequestBody.provenance`, `.requiredUnknown`, `.examples`; `Response.provenance`, `.bodyUnavailable`; extend `AnalysisIssue.kind` with `ambiguous-path`, `conflicting-types`, `unsupported-content`, `incomplete-observation`, `credential-detected`. Do not change any existing field.
- [ ] T006 [P] Edit `packages/shared-domain/src/testModel.ts` (additive): `ScenarioEvidence` interface, `TestScenario.evidence?`, `Assertion.basis?: "documented" | "declared" | "observed"`.
- [ ] T007 [P] Edit `packages/shared-domain/src/apiDependency.ts` (additive): `DependencySource` gains `"observed"` and `"declared"`; `ApiDependencyRelationship.inputEvidence?: DependencyHint`.
- [ ] T008 [P] Edit `packages/shared-domain/src/testGenerationWorkflow.ts` (additive): `TestGenerationWorkflow.input?: ApiInputDescriptor` and `.generationNotes?: GenerationNote[]`.
- [ ] T009 Export `./apiInput` from `packages/shared-domain/src/index.ts` and run the shared-domain build so backend and frontend resolve the new types (`npm run build -w packages/shared-domain`, or the workspace's existing build script). Depends on T004 to T008.
- [ ] T010 [P] Create `backend/src/apiInput/errors.ts` with typed errors and their codes: `InvalidJsonError` (`invalid_json`), `UnrecognizedInputError` (`unrecognized_input_format`), `AmbiguousInputError` (`ambiguous_input_format`, carries matched families), `PostmanCollectionDetectedError` (`postman_collection_detected`), `InvalidHarError` (`invalid_har`), `InvalidDefinitionError` (`invalid_definition`, carries `problems: string[]`), `NoOperationsDerivedError` (`no_operations_derived`, carries the report), `InputLimitExceededError` (`input_limit_exceeded`, carries `limit` and `maximum`). Messages per [contracts/upload-api-amendment.md](contracts/upload-api-amendment.md); none may echo document content.
- [ ] T011 [P] Create `backend/src/apiInput/limits.ts` exporting `InputLimits`, the defaults from research R9 (5,000 entries, 1,048,576 body bytes, 128 depth), the fixed constants (embedded body depth 32, derived operations 2,000, examples per operation 5, path-parameter values kept 10, leaf values per body 500, issues per kind 200, exclusion samples 20), and `loadInputLimits(env)` reading `INPUT_HAR_MAX_ENTRIES`, `INPUT_MAX_BODY_BYTES`, `INPUT_MAX_JSON_DEPTH`. Add `backend/tests/unit/apiInput/limits.test.ts` (defaults, overrides, non-positive and non-integer values rejected).
- [ ] T012 Add `validateInputConfiguration(env)` to `backend/src/config.ts` (positive integers, throws a typed error naming the variable, same style as `validateAIConfiguration`), call it next to `validateAIConfiguration()` in `backend/src/server.ts`, extend `backend/tests/unit/config.test.ts`, and document the three variables in `.env.example` and `docs/configuration.md` (CLAUDE.md section 48). Depends on T011.
- [ ] T013 [P] Create `backend/src/apiInput/jsonSafe.ts`: `scanJsonDepth(text, max)` (single pass that tracks `{`/`[` nesting and skips string literals, returns the depth or flags exceeded), `nullProtoMap()` helpers (`Object.create(null)` accumulators), `ownEntries(obj)` that skips `__proto__`, and `yieldToEventLoop()` (`await new Promise((r) => setImmediate(r))`). Add `backend/tests/unit/apiInput/jsonSafe.test.ts` (hostile `[[[[…`, braces inside strings, escaped quotes, a `__proto__` key does not alter a prototype).
- [ ] T014 Map the new typed errors in the centralized handler in `backend/src/app.ts`: 400 for `invalid_json`, `unrecognized_input_format`, `ambiguous_input_format`, `postman_collection_detected` (adds `redirectTo: "import-run-collection"`), `invalid_har`, `invalid_definition` (adds `problems`), `no_operations_derived` (adds `report`); 413 for `input_limit_exceeded` (adds `limit`, `maximum`). Existing `invalid_yaml`, `unsupported_version`, `file_too_large`, `payload_too_large` mappings stay byte-identical. Log only `errorCategory`, never the message. Depends on T010.

**Checkpoint**: Contracts compile, errors and limits exist. User stories can begin.

---

## Phase 3: User Story 1 - Upload any supported file and have its format recognized (Priority: P1) MVP

**Goal**: The guided workflow accepts OpenAPI as JSON exactly like YAML, reports the detected format, redirects Postman collections, and rejects unrecognized or ambiguous JSON with a specific message. YAML behaviour does not change.

**Independent Test**: Upload one OpenAPI document as YAML and as JSON: same operations, summary and scenarios, different format label. Upload a Postman collection and an unrecognizable JSON object and see the two distinct messages ([quickstart.md](quickstart.md), *Story 1*). No HAR or definition support is needed.

### Tests for User Story 1 (write first, expect failure)

- [ ] T015 [P] [US1] Create `backend/tests/unit/apiInput/detectFormat.test.ts`: the BOM and empty-content path (falls through to the YAML pipeline), YAML text (including a flow-style `{openapi: 3.0.0}` document) stays `openapi-yaml`, JSON with each single marker (openapi, swagger, HAR `log.entries`, definition `format`, Postman `info.schema` and `_postman_id`+`item`), no marker, two markers (`ambiguous_input_format` naming both), array and scalar JSON, truncated JSON that is also not YAML (`invalid_json` with a position and no content echoed), a `.har`-named file holding YAML. Per research R3.
- [ ] T016 [P] [US1] Create `backend/tests/unit/apiInput/openapiEquivalence.test.ts`: for every loadable fixture in `backend/tests/fixtures/openapi/` (skip the intentionally invalid ones), serialize the parsed YAML to JSON, run `loadApiInput` on both, assert deep equality of `apiModel`, and of `generateTestModel(apiModel)` with scenario ids normalized (SC-001). Also assert `unsupported-version.yaml` as JSON gives the identical `unsupported_version` message, and `invalid-yaml.txt` gives the unchanged `invalid_yaml` message (FR-006, FR-007).
- [ ] T017 [P] [US1] Create `backend/tests/integration/apiInput.upload.test.ts` (Supertest, `createApp`, mock provider) covering both `POST /api/specifications` and `POST /api/test-generation-workflow`: `input` envelope with the four labels (HAR and definition cases are added in later phases), Postman redirect body, unrecognized and ambiguous bodies, `invalid_json`, extension disagreeing with content, empty upload keeps the existing `invalid_yaml` message, over-limit file keeps `file_too_large`, `409 workflow_in_progress` unchanged, and a failed upload leaves the session's existing workflow untouched. Reuse patterns from `backend/tests/integration/testGenerationWorkflow.test.ts`.
- [ ] T018 [P] [US1] Create `frontend/tests/unit/TestGenerationWorkflowUpload.test.tsx` (React Testing Library): the file input accepts `.yaml,.yml,.json,.har`; a `.txt` file is rejected client-side with a message listing the supported extensions; wording no longer says only YAML; an `unrecognized_input_format` error and a `postman_collection_detected` error render their messages (the latter with an action to open Import & Run Collection); the detected format badge shows after a successful start.
- [ ] T019 [P] [US1] Create `backend/tests/unit/apiInput/quickTestUnchanged.test.ts` (or extend the existing quick-performance integration test): the AP-032 quick performance upload still uses the YAML-only path, so a JSON HAR is still refused exactly as before (FR-054).

### Implementation for User Story 1

- [ ] T020 [US1] Implement `backend/src/apiInput/detectFormat.ts` per research R3: strip BOM; non-`{`/`[` content is YAML; for `{`/`[` run `scanJsonDepth` (limit from `InputLimits`), `JSON.parse`, fall back to YAML on JSON failure, `InvalidJsonError` if both fail; classify a JSON object by the four discriminating markers; return a discriminated result (`{ family, document }`). No filename use. Depends on T010, T011, T013.
- [ ] T021 [US1] Implement `backend/src/apiInput/openapi/loadOpenApi.ts`: for YAML, call the unchanged `parseYaml`, `validateSpec`, `buildApiModel`; for an already-parsed JSON OpenAPI document, pass it to the same `validateSpec` and `buildApiModel` (Swagger and non-3.x get the existing `UnsupportedVersionError`). Do not modify any file under `backend/src/openapi/`.
- [ ] T022 [US1] Implement `backend/src/apiInput/index.ts`: `loadApiInput(buffer, filename, limits?)` returning `{ apiModel, input: ApiInputDescriptor, importReport? }`, calling `detectFormat` then the family adapter; Postman marker throws `PostmanCollectionDetectedError`; HAR and definition markers throw `UnrecognizedInputError` for now with a `// ENABLED IN T059 (HAR) / T104 (definition)` marker (they are listed in the message only once enabled). Emit `input_detected` (`format`, `durationMs`) and `input_rejected` (`errorCategory`) log events with no content. Depends on T020, T021.
- [ ] T023 [US1] Update `backend/src/testGenerationWorkflow/startWorkflow.ts` to call `loadApiInput` instead of the inline parse/validate/build, and `backend/src/testGenerationWorkflow/workflowStore.ts` `startWorkflow` to accept and store `input` on the workflow (`workflow.input`). Keep `WorkflowInProgressError` and discard behaviour as is. Depends on T022.
- [ ] T024 [P] [US1] Update `backend/src/api/specifications.ts` to call `loadApiInput` and return `{ apiModel, input }` (additive); keep the 405 handler, the missing-file response and the logging shape. Depends on T022.
- [ ] T025 [US1] Update `backend/src/api/testGenerationWorkflow.ts` POST handler: unchanged request handling, `workflow.input` flows through `toWorkflowResponse`. No new route logic (CLAUDE.md section 22). Depends on T023.
- [ ] T026 [P] [US1] Create `frontend/src/components/InputFormatBadge.tsx`: shows the label ("OpenAPI (YAML)", "OpenAPI (JSON)", "HAR capture", "ApiPilot API definition") as text with an icon, Tailwind v4 tokens, light and dark variants, no color-only meaning.
- [ ] T027 [US1] Update `frontend/src/pages/TestGenerationWorkflowPage.tsx`: `accept=".yaml,.yml,.json,.har"`; replace the `/\.ya?ml$/i` guard with a check for the four extensions and a message listing them; update the hero, card subtitle ("OpenAPI 3.x · YAML · up to 10 MB") and upload copy to name OpenAPI (YAML or JSON), HAR capture and ApiPilot API definition (FR-041); show an indeterminate `role="status"` line ("Analyzing capture…" for `.har`, "Uploading…" otherwise); show `InputFormatBadge` in the Active run header. Depends on T026.
- [ ] T028 [US1] Update `frontend/src/services/testGenerationWorkflowClient.ts` `toWorkflowResult` to also surface `redirectTo` and `report` when present (keep `problems`), and extend the `WorkflowResult` error variant type accordingly.
- [ ] T029 [US1] Handle `postman_collection_detected` in `frontend/src/pages/TestGenerationWorkflowPage.tsx`: render the message plus an "Open Import & Run Collection" button using the existing navigation module (`frontend/src/navigation/destinations.ts`, `useRoute.ts`); render `problems[]` as a list inside the existing `ErrorState` (`frontend/src/components/ErrorState.tsx`, extend it with an optional `problems` prop if needed). Depends on T027, T028.
- [ ] T030 [US1] Make T015 to T019 pass; run `npm test -- backend/tests/unit/apiInput backend/tests/integration/apiInput.upload.test.ts`, the frontend upload test, and the existing OpenAPI suites unmodified. Fix implementation, never expected values of pre-existing tests.

**Checkpoint**: Story 1 works end to end for OpenAPI YAML and JSON, Postman redirect and rejections. This is the MVP.

---

## Phase 4: User Story 5 - Handle captures that contain credentials and hostile content safely (Priority: P2, release gate for Story 2)

**Goal**: Credentials never reach the model, report, logs, AI prompts or artifacts; the file is never executed, replayed or fetched; raw bytes are not retained; limits refuse abuse without affecting other sessions.

**Independent Test**: Upload the seeded-secret HAR and search every output surface for the markers; upload files past each limit; confirm another session keeps being served ([quickstart.md](quickstart.md), *Story 5*). The end-to-end parts run once the HAR pipeline exists (T058 is the gate).

### Tests for User Story 5

- [ ] T031 [P] [US5] Create `backend/tests/unit/apiInput/redaction.test.ts`: every row of the redaction table in [contracts/har-import-rules.md](contracts/har-import-rules.md) (header names including the added `x-auth-token`, `x-csrf-token`, `x-xsrf-token`, `x-amz-security-token`; query, form, cookie and JSON field names including exact `key`, `sig`, `sid`, `code`, `jwt`; value patterns JWT, Bearer, Basic, AWS key; URL userinfo; all cookie values); placeholder text is `[redacted:<kind>]`; structure of a body is preserved; no false positive on ordinary fields such as `monkey` or `author`; the recorded `CredentialObservation` has no value.
- [ ] T032 [P] [US5] Create `backend/tests/unit/testDesign/redactionPlaceholder.test.ts`: `redactionPlaceholderKind` accepts exactly `[redacted:token|apiKey|password|cookie|session]` (mapping cookie and session to `token`), rejects look-alikes (`[redacted]`, `[redacted:other]`, extra text), and the existing predicates' results for non-placeholder inputs are unchanged (compare against a table captured from current behaviour).
- [ ] T033 [P] [US5] Create `backend/tests/unit/apiInput/noNetworkOrFilesystemImports.test.ts`: scan every `.ts` file under `backend/src/apiInput/` and fail if any imports `http`, `https`, `net`, `dns`, `child_process`, `fs`, `node:`-prefixed variants of those, `vm`, or `worker_threads` (FR-046, research R26). The one permitted exception list is empty. Also fail if any module under `backend/src/apiInput/` imports `postman-collection`, `newman`, or a HAR-conversion package (FR-031, FR-032).
- [ ] T034 [P] [US5] Create `backend/tests/fixtures/apiInput/har/seeded-secrets.har`: a small, valid HAR whose entries carry `SEEDED-SECRET-*` markers in `Authorization`, `Cookie`, `Set-Cookie`, query strings (`api_key`, `access_token`, `code`), JSON request and response bodies (`password`, `token`), form and multipart text fields, a `Bearer` value under a non-credential field name, and URL userinfo.
- [ ] T035 [P] [US5] Create `backend/tests/integration/apiInput.limits.test.ts` covering the limits that need no HAR pipeline: JSON nested past `INPUT_MAX_JSON_DEPTH` returns `413 input_limit_exceeded` naming `INPUT_MAX_JSON_DEPTH`, the existing 10 MiB limit is unchanged, and a concurrent second session's `GET /api/test-generation-workflow` completes while a large upload is processed. Entry-count, body-size and operation-count cases are added in T054.

### Implementation for User Story 5

- [ ] T036 [US5] Implement `backend/src/apiInput/redaction.ts`: `redactHeader`, `redactQueryParam`, `redactFormField`, `redactJsonValue` (recursive, depth-bounded, null-prototype safe), `redactUrl` (strips userinfo and returns the observation), value-pattern detection, `REDACTION_PLACEHOLDER` formatting `[redacted:<kind>]`, and a collector that accumulates `CredentialObservation` counts per `(location, name, kind)`. Reuse `isSensitiveHeaderName`, `isSensitiveFieldName`, `isBearerTokenValue`, `credentialKindForHeader`, `credentialKindForField` from `backend/src/testDesign/sensitiveValueDetection.ts` and add only the extended names and patterns locally. Depends on T038.
- [ ] T037 [US5] Create `backend/src/apiInput/logging.ts` with `logInputEvent(event, fields)`, whose field type admits only `format`, `durationMs`, the five import counts, `errorCategory`, `limit` and `problemCount` (no free-text field), and use it for every `apiInput` log event (`input_detected`, `input_rejected`, `har_analyzed`, `definition_validated`) in place of direct logger calls; add `backend/tests/unit/apiInput/logging.test.ts` asserting an event never carries a string longer than a format name or error category and that no apiInput module calls `createLogger` directly (constitution XX).
- [ ] T038 [US5] Add `redactionPlaceholderKind(value: unknown): CredentialKind | undefined` and the shared placeholder format constant to `backend/src/testDesign/sensitiveValueDetection.ts` (additive; leave every existing function's behaviour unchanged). The exporter will consume it in US4.
- [ ] T039 [US5] Enforce the document depth limit in the format-detection path (`backend/src/apiInput/detectFormat.ts` already calls `scanJsonDepth`; ensure it throws `InputLimitExceededError` naming `INPUT_MAX_JSON_DEPTH` and the maximum) and confirm T035's depth case passes.
- [ ] T040 [US5] In both upload routes (`backend/src/api/specifications.ts`, `backend/src/api/testGenerationWorkflow.ts`) overwrite the multer buffer with `req.file.buffer.fill(0)` in a `finally` after `loadApiInput` returns or throws (best effort; FR-049); add a unit-style test that the buffer is zeroed after a successful and a failed load.
- [ ] T041 [US5] Make T031 to T033 and T035 pass. T034's fixture is consumed by T058.

**Checkpoint**: Redaction, the placeholder contract, limits that apply before parsing, and the import-safety scan exist. The HAR pipeline can now be built.

---

## Phase 5: User Story 2 - Turn a browser or proxy capture (HAR) into a reviewable API model (Priority: P2)

**Goal**: A HAR becomes one operation per method and normalized path, with merged examples, observed statuses, inferred path parameters and structural schemas, reviewable in the existing API review stage. Deterministic for identical input.

**Independent Test**: Upload a realistic HAR and verify operations, merged examples, observed statuses, the path parameter decision and the issues; upload the same file again and get an identical result ([quickstart.md](quickstart.md), *Stories 2 and 3*).

### Fixtures and test helpers

- [ ] T042 [P] [US2] Create `backend/tests/fixtures/apiInput/har/realistic.har`: analytics beacon, third-party font, CORS preflight, redirect, `304`, failed (`status 0`), websocket entry, repeated calls to one endpoint, a varying id path, a path with a single id-like segment, several query-string sets, JSON request and response bodies with a field type conflict, several statuses for one endpoint, a login response whose token and a created id are reused in later requests, one body in each unavailable state (base64, gzip, binary, oversized, truncated, invalid JSON), urlencoded and multipart (text and file) bodies, two first-party origins with one colliding method and path, and malformed entries (missing URL, missing status, relative URL). Also create `invalid-not-json.har`, `invalid-no-log.har`, `invalid-no-entries.har`, `all-excluded.har` in the same directory.
- [ ] T043 [P] [US2] Create `backend/tests/fixtures/apiInput/harBuilders.ts`: pure helpers that build synthetic HAR objects (N entries, deeply nested JSON, oversized body, many origins) for limit and timing tests, so no large file is committed.

### Tests for User Story 2 (write first, expect failure)

- [ ] T044 [P] [US2] `backend/tests/unit/apiInput/har/validateHar.test.ts`: not an object, no `log`, `entries` not an array, empty entries, entry count over `INPUT_HAR_MAX_ENTRIES` (FR-009, FR-045).
- [ ] T045 [P] [US2] `backend/tests/unit/apiInput/har/normalizeUrl.test.ts`: every step of the normalization in [contracts/har-import-rules.md](contracts/har-import-rules.md): lower-cased scheme and host, default ports, userinfo removal, dot segments, duplicate slashes, unreserved decoding, `%2F` stays encoded, hex upper-cased, one trailing slash folded, case preserved, query and fragment dropped, relative and unparseable URLs, non-HTTP schemes, counters for the report.
- [ ] T046 [P] [US2] `backend/tests/unit/apiInput/har/classifyEntry.test.ts` and `originScope.test.ts`: each row of the ordered exclusion table with exactly one reason, order precedence (a preflight to an analytics host is `cors-preflight`), analytics host suffix matching, anchors from `log.pages[].title`, primary API origin ties, site-key rule including `co.uk`-style suffixes, IP and `localhost`, and that the primary origin is computed only from entries that reach rule 11.
- [ ] T047 [P] [US2] `backend/tests/unit/apiInput/har/decodeBody.test.ts`: every row of the body-handling table (missing, empty, base64, unknown encoding, compressed never decompressed, binary, oversized, invalid JSON, truncated, too deep, urlencoded from `params` and from text, duplicate form field, multipart text-only, multipart with a file part).
- [ ] T048 [P] [US2] `backend/tests/unit/apiInput/har/inferPathParameters.test.ts`: identifier-like predicate cases, two distinct values become a parameter, one value stays literal with an `ambiguous-path` issue, `/users/list` versus `/users/search` never merge, `/users/me` versus `/users/{userId}`, two parameters in `/users/1/orders/9` and `/users/2/orders/8`, a position with one distinct value stays literal while the other varies, name inference and collision suffix, 10-value cap.
- [ ] T049 [P] [US2] `backend/tests/unit/apiInput/har/inferSchema.test.ts`: structural-only output (no enum, format, ranges), `required` equals fields present in every observation, per-status separation, conflicting types produce no `type` and a `conflicting-types` issue with no value, integer plus float is `number`, arrays merge element shapes, `__proto__` key harmless, `SchemaEvidence` counts, form-field evidence.
- [ ] T050 [P] [US2] `backend/tests/unit/apiInput/har/extractEntry.test.ts`: allow-list extraction (unknown and `_`-prefixed fields never copied), malformed reasons (`not-an-object`, `missing-url`, `missing-method`, `invalid-url`, `relative-url`, `missing-response-status`), credentials replaced at extraction (no raw value survives in the returned object, checked by serializing it and searching for the marker).
- [ ] T051 [P] [US2] `backend/tests/unit/apiInput/har/mergeObservations.test.ts`: grouping, counts, `statusCounts` contain only observed statuses, query and header counts with the right denominator, transport-noise headers dropped, example dedupe and 5-example cap with `droppedExampleCount`, ordering rules, `requiredUnknown` on non-path parameters.
- [ ] T052 [P] [US2] `backend/tests/unit/apiInput/har/buildHarModel.test.ts`: the `imported + excluded + malformed = total` invariant on the realistic fixture and on property-style mutations (SC-005), every exclusion has a reason, multi-origin collision keeps the busier origin, excludes the other with `duplicate-method-path-other-origin` and raises `duplicate-operation`, issue cap with a summary issue, `securitySchemes` empty, no status, field, scheme or assertion that is absent from the input appears (SC-006), and determinism: building twice and comparing `JSON.stringify` of model and report is identical (SC-003, FR-022).
- [ ] T053 [P] [US2] Extend `backend/tests/integration/apiInput.upload.test.ts` with HAR cases: success returns `input.format: "har"` and `importReport`, `invalid_har` for each invalid fixture, `no_operations_derived` with the report counts for `all-excluded.har`, and the response and workflow contain no raw credential marker.
- [ ] T054 [P] [US2] Extend `backend/tests/integration/apiInput.limits.test.ts`: entry count over the limit returns `413 input_limit_exceeded` naming `INPUT_HAR_MAX_ENTRIES`; an oversized body is skipped and reported under `limitsApplied`; more than the derived-operation limit returns `413`; a 500-entry synthetic HAR (T043) completes in under 10 s as a generous CI bound (the product target in SC-007 is 30 s) and a second session stays responsive during a 5,000-entry analysis (SC-009).

### Implementation for User Story 2

- [ ] T055 [US2] Implement the HAR modules under `backend/src/apiInput/har/`, each a pure function with the signature its test in T044 to T052 expects: `validateHar.ts`, `normalizeUrl.ts`, `analyticsHosts.ts` (the frozen, alphabetized list from the contract) with `classifyEntry.ts`, `originScope.ts`, `decodeBody.ts`, `extractEntry.ts` (allow-list plus redaction at source via T036), `inferPathParameters.ts`, `inferSchema.ts`, `mergeObservations.ts`. Respect the pipeline order and the chronological-ordering rule in [contracts/har-import-rules.md](contracts/har-import-rules.md). Modules `normalizeUrl`, `classifyEntry`, `originScope`, `decodeBody`, `inferPathParameters`, `inferSchema` are independent of each other and may be built in parallel; `extractEntry` and `mergeObservations` follow them.
- [ ] T056 [US2] Implement `backend/src/apiInput/har/buildHarModel.ts`: orchestrate the pipeline asynchronously with `yieldToEventLoop()` every 100 entries; apply the multi-origin collision rule; build `ApiOperation`s with `provenance`, `observed`, parameters (`requiredUnknown`), request body content types (including form content types as string properties), responses (observed statuses only, `provenance` with count and confidence per research R7), `credentialsObserved`; raise `ambiguous-path`, `conflicting-types`, `unsupported-content`, `incomplete-observation`, `credential-detected` and `duplicate-operation` issues with the per-kind cap; build `ImportAnalysisReport`; assert the reconciliation invariant (throw an internal error on mismatch); enforce the derived-operation limit. Emit `har_analyzed` (the five counts and duration only). Depends on T055. Also populate `importReport.credentialUrlCount` and `credentialUrlEntries` (first 20 entries by position and host, never the userinfo) for credential-embedded URLs (FR-050).
- [ ] T057 [US2] Add the confidence function (`high` at 3 or more consistent observations, `medium` at 2, `low` for 1 or any conflict) as a pure helper in `backend/src/apiInput/har/confidence.ts` with `backend/tests/unit/apiInput/har/confidence.test.ts`, and use it in `buildHarModel.ts`.
- [ ] T058 [US2] **Release gate (Story 5)**: create `backend/tests/integration/apiInput.secrets.test.ts` part A. Call `loadHar` (`backend/src/apiInput/har/loadHar.ts`) directly on `seeded-secrets.har`, without the route, and assert zero `SEEDED-SECRET-` markers in the returned model and report, in captured logger and console output, and in the serialized result. This must pass before T059.
- [ ] T059 [US2] Enable the HAR family in `backend/src/apiInput/index.ts`: route the HAR marker to a new `backend/src/apiInput/har/loadHar.ts` (validate, run `buildHarModel`, throw `NoOperationsDerivedError` when no operation results), remove the HAR rejection stub from T022, and list HAR in the unrecognized-format message. Depends on T056, T058. After enabling, add a second case to `backend/tests/integration/apiInput.secrets.test.ts` that uploads `seeded-secrets.har` through both routes and repeats the zero-marker assertions on the HTTP responses and the stored workflow state.
- [ ] T060 [US2] Make T044 to T054 pass and confirm determinism and reconciliation on the fixture. Run `npm test -- backend/tests/unit/apiInput backend/tests/integration/apiInput`.

**Checkpoint**: A HAR upload produces a reviewable model through the existing workflow, safely.

---

## Phase 6: User Story 3 - Understand exactly what was imported, excluded and inferred (Priority: P2)

**Goal**: The user sees the import summary before generating, and every fact in the operation review is labelled documented, declared, observed or inferred with its observation count, using text and not color alone.

**Independent Test**: Upload the realistic HAR; the counts reconcile, every exclusion has a reason, and the review distinguishes observed from inferred values in light and dark themes and by keyboard ([quickstart.md](quickstart.md), *Stories 2 and 3*).

### Tests for User Story 3

- [ ] T061 [P] [US3] `frontend/tests/unit/FactOriginBadge.test.tsx`: renders "Documented", "Declared", "Observed ×N", "Inferred ×N" as text, confidence shown as text, accessible name, no reliance on color class names in assertions (semantic queries only).
- [ ] T062 [P] [US3] `frontend/tests/unit/HarImportSummary.test.tsx`: the five counts and the reconciliation line, exclusion groups in a semantic table with reason and count and samples, malformed entries list with position and reason, `limitsApplied` notices, the all-excluded variant, nothing rendered for an OpenAPI model without `importReport`. Also the credential-URL entries (position and host, no userinfo) and their count.
- [ ] T063 [P] [US3] Extend or create `frontend/tests/unit/ApiReviewStage.har.test.tsx`: the summary and format badge appear for a HAR model; parameters, statuses, schema facts and path-parameter decisions in `OperationDetail` carry origin labels; an OpenAPI model renders exactly as before (no new labels).

### Implementation for User Story 3

- [ ] T064 [P] [US3] Create `frontend/src/components/FactOriginBadge.tsx`: props `origin`, `observationCount?`, `confidence?`; text label plus icon; Tailwind v4 semantic tokens with dark variants; reuse `frontend/src/components/StatusBadge.tsx` or `ProvenanceBadge.tsx` patterns where they fit rather than duplicating styles (CLAUDE.md sections 35, 59).
- [ ] T065 [P] [US3] Create `frontend/src/components/HarImportSummary.tsx`: `KeyValueGrid` for counts (`frontend/src/components/patterns/KeyValueGrid.tsx`), semantic exclusion table with horizontal scroll, `<details>` for malformed entries, a text notice per `limitsApplied`; loading, empty and error states per CLAUDE.md section 39. Render `credentialUrlEntries` and `credentialUrlCount` from the report in a short text list (position and host only).
- [ ] T066 [US3] Update `frontend/src/components/ApiReviewStage.tsx` to render `HarImportSummary` above `AnalysisSummary` when `apiModel.importReport` is present, pass the origin of each operation to the list, and, when present, show the declared base URL line from `apiModel.declaredBaseUrl` (populated only by US6). Depends on T064, T065.
- [ ] T067 [US3] Update `frontend/src/components/OperationDetail.tsx` and `OperationList.tsx`: `FactOriginBadge` beside parameters (including "requirement unknown" text for `requiredUnknown`), statuses (observed counts from `provenance`), schema facts, path-parameter decisions (observed values as examples), request examples (up to 5, with the dropped count), credentials observed (kind and location, never a value), and the operation's origin as informational text. OpenAPI operations without `provenance` render unchanged.
- [ ] T068 [US3] Verify `frontend/src/components/AnalysisSummary.tsx` renders the five new issue kinds through its existing generic list (each warning identifies the operation or entry via `location`); adjust only if a kind label needs wording, and add a case to its existing test.
- [ ] T069 [US3] Responsive, dark-mode and keyboard pass over the new components in the running app (`npm run dev`): no horizontal page overflow with a wide exclusions table, visible focus, tab order, `aria` names; record what was checked.
- [ ] T070 [US3] Make T061 to T063 pass; run `npm test -- frontend/tests/unit` for the touched files.

**Checkpoint**: Stories 1 to 3 and 5 together deliver a trustworthy, reviewable HAR import.

---

## Phase 7: User Story 4 - Generate tests only as far as the evidence supports (Priority: P2)

**Goal**: Observed operations get example-backed positive scenarios asserting only an observed status, and evidence-gated negatives; dependency analysis proposes capped-confidence relationships; the Postman exporter sends form bodies and substitutes redaction placeholders; AI enhancement is validated against the model; OpenAPI output is byte-identical.

**Independent Test**: Generate for a HAR-derived model and an OpenAPI model: OpenAPI scenarios and artifacts unchanged, HAR scenarios carry evidence, no assertion for an unobserved status, negatives only at 3 or more observations ([quickstart.md](quickstart.md), *Story 4*).

### Exporter baseline and tests first

- [ ] T071 [US4] Before any exporter edit, run `backend/tests/unit/postman/existingArtifactsUnchanged.test.ts` (created in T002a) and confirm it still passes against the unmodified exporter. Do not regenerate or edit any golden file; if a later task makes it fail, stop and review (SC-002; plan open item 1).
- [ ] T072 [P] [US4] `backend/tests/unit/postman/formBodies.test.ts` per [contracts/postman-artifact-amendment.md](contracts/postman-artifact-amendment.md): `urlencoded` and `formdata` items, key order, values as text (null as empty), `Content-Type` set for urlencoded and not set for multipart, non-flat body keeps the existing `unsupported-content-type` limitation, credential substitution in query, path, header, JSON field and form field via the placeholder, declared secret variables, unchanged output for inputs without form bodies or placeholders.
- [ ] T073 [P] [US4] Extend `backend/tests/unit/postman/credentialSubstitution.test.ts`: placeholder values become `{{token}}`, `{{apiKey}}`, `{{password}}`; cookie and session placeholders map to `token`; a `validateCollection` problem is raised for any remaining `[redacted:` text and for form credential literals.
- [ ] T074 [P] [US4] `backend/tests/integration/execution/formBodiesNewman.test.ts`: start a local HTTP test server on an ephemeral loopback port, run generated urlencoded and multipart items through the existing Newman runner, assert the server received the fields (no external network).
- [ ] T075 [P] [US4] `backend/tests/unit/testDesign/observedExampleScenarios.test.ts` per [contracts/observed-generation-rules.md](contracts/observed-generation-rules.md): one positive per observed 2xx status from the most-observed example (ties by first entry index), only the observed `status-code` assertion with `basis: "observed"` and no schema or header assertion, examples filtered to the primary content type, `bodyUnavailable` examples skipped, `missing-field` negatives only for fields present in every one of at least 3 observations (JSON and form), `invalid-type` only for single-type JSON fields at 3 or more, none below threshold, negative assertion only when an observed non-2xx example's request equals the mutated request, evidence block text, no boundary, enum or format scenarios, and each `GenerationNote` reason in order.
- [ ] T076 [P] [US4] `backend/tests/unit/testDesign/generateTestModelDispatch.test.ts`: operations without `provenance` and with `documented` use only the existing `RULES` and produce output identical to a pre-change snapshot for all OpenAPI fixtures; `observed` uses only the new rule module; the designer imports no module from `backend/src/apiInput/`.
- [ ] T077 [P] [US4] `backend/tests/unit/apiInput/har/detectDependencies.test.ts`: distinctive-value rules (length, digits, boolean and null excluded, stoplist, unique producer, not shared by 3 or more fields), later-entry and other-operation requirement, path segment, query, header and body consumers, credential-position matches kept with the value withheld, sample truncation to 32 characters, withheld for credential-like names and email or credential-pattern values, `POSSIBLE` for one consuming entry and `LIKELY` for two or more, never confirmed, leaf cap of 500.
- [ ] T078 [P] [US4] `backend/tests/unit/dependencies/inputHints.test.ts`: `analyzeDependencies` converts `dependencyHints` into relationships with source `observed` or `declared`, merges with a deterministic match keeping the higher confidence and `source: "deterministic"` plus `inputEvidence`, an observed hint alone is never `CONFIRMED`, existing OpenAPI analyses are unchanged.
- [ ] T079 [P] [US4] `backend/tests/unit/testDesign/aiPromptProvenance.test.ts`: the scenario prompt for an OpenAPI model is byte-identical to the stored snapshot; for an observed model it contains the single provenance sentence; AI candidates referencing an operation, field or status absent from an observed model are rejected by the existing validator.
- [ ] T080 [P] [US4] Extend `backend/tests/integration/apiInput.secrets.test.ts` part B: drive the seeded-secret HAR through deterministic generation, AI enhancement (mock provider), dependency analysis and Postman generation, and assert no `SEEDED-SECRET-` marker in the AI prompt text, the generated collection and environment JSON, the README, the responses and the logs (SC-004), and that no `[redacted:` text remains in any artifact.
- [ ] T080a [P] [US4] Create `backend/tests/integration/apiInput.executionSafety.test.ts`: drive the HAR fixture through to Postman generation, then start execution without selecting an environment and assert the existing refusal; start with a production-tier environment and a write operation and assert `409 confirmation_required`; assert that the collection and environment JSON contain none of the capture's hosts and that `{{baseUrl}}` is the only address base (FR-052, US4 scenario 8, US5 scenario 7).
- [ ] T081 [P] [US4] Frontend tests: `frontend/tests/unit/TestScenarioDetail.evidence.test.tsx` (evidence origin, count, summary and "Inference-derived" label; assertion `basis` text "Observed" or "Declared"; no label for documented assertions) and `frontend/tests/unit/GenerationNotes.test.tsx` (operations with no scenarios listed with the reason).

### Implementation for User Story 4

- [ ] T082 [US4] Widen `PostmanBody` in `packages/shared-domain/src/postmanArtifact.ts` to `PostmanRawBody | PostmanUrlencodedBody | PostmanFormdataBody` per [data-model.md](data-model.md), rebuild the shared-domain package, then run `npm run build` and fix every compile error the widening reveals (these are the consumers to review; expected: `backend/src/postman/validateCollection.ts`, `backend/src/performance/plan/stepRequest.ts`). Depends on T071.
- [ ] T083 [US4] Update `backend/src/postman/requestItem.ts` per the amendment: placeholder-aware substitution in `credentialKindForHeader` and `credentialKindForField` callers and in `urlValueText` (via `redactionPlaceholderKind` from T038), `urlencoded` and `formdata` branches in `buildBody` selected by the operation's primary content type, multipart sends no `Content-Type` header. Depends on T082.
- [ ] T084 [US4] Update `backend/src/postman/validateCollection.ts`: accept `raw`, `urlencoded`, `formdata`; add the form credential-literal check and the "no `[redacted:` text remains" check (both over URL, headers and every body mode). Depends on T082.
- [ ] T085 [US4] Update `backend/src/performance/plan/stepRequest.ts`: in `templateFromItem`, `raw` is unchanged and `urlencoded` becomes the percent-encoded `key=value&…` text with the existing `form` body kind. For `formdata`, have `buildStepRequest` (the `templateFromItem` call near line 305) return a discriminated `{ unsupported: { reason: "multipart-body" } }` instead of a template; the call near line 184 is the OAuth2 token-fetch item and needs no change. Update both callers, `backend/src/performance/plan/buildJourneys.ts` (near line 113) and `backend/src/performance/plan/planStepRequest.ts` (near line 94), to skip that step and record it as a left-out step with the reason, using the existing seeding note type (find it in `backend/src/performance/chain/seed/`; `seedFromCollection.ts` already records `left-out-request`). Add tests for `raw`, `urlencoded` and the `formdata` skip. Depends on T082.
- [ ] T086 [US4] Update the limitation wording in `backend/src/postman/readme.ts` and `frontend/src/components/PostmanExportLimitations.tsx` for `unsupported-content-type` to name the supported set (JSON, text, urlencoded, multipart text fields); then run T071 and confirm the golden files are still byte-identical (update no golden file; if one differs, stop and review).
- [ ] T087 [US4] Implement `backend/src/testDesign/rules/observedExampleScenarios.ts` per the contract, reusing `buildScenario` (`backend/src/testDesign/scenario.ts`), `valueGenerators.ts`, `singleFieldMutation.ts`/`requestHelpers.ts` helpers rather than copying them; extend `buildScenario`'s input to carry `evidence` and assertion `basis`. Return both scenarios and `GenerationNote`s.
- [ ] T088 [US4] Update `backend/src/testDesign/generateTestModel.ts`: choose the rule list per operation from `operation.provenance?.origin` (absent or `documented`: today's `RULES` unchanged; `observed`: the new module); keep `deduplicate` over the combined list and `generatePositiveScenarios` for AP-032 unchanged for documented operations. Keep `generateTestModel(apiModel): TestModel` unchanged in signature. Add `generateTestModelWithNotes(apiModel): { testModel: TestModel; notes: GenerationNote[] }` in the same file, and have `generateTestModel` call it and return only `testModel`. Depends on T087.
- [ ] T089 [US4] Update `backend/src/testGenerationWorkflow/deterministicGenerationStage.ts` to call `generateTestModelWithNotes` and store non-empty `generationNotes` on the workflow (written once, only when non-empty). `backend/src/api/testModels.ts` and `backend/src/ai/benchmark/workloads.ts` keep calling `generateTestModel`. Depends on T088.
- [ ] T090 [US4] Implement `backend/src/apiInput/har/detectDependencies.ts` per research R19 and the contract (pure; pre-redaction values exist only inside it; returns `DependencyHint[]` and nothing else) and call it from `buildHarModel.ts` to fill `ApiModel.dependencyHints`.
- [ ] T091 [US4] Update `backend/src/dependencies/analyzeDependencies.ts` and `backend/src/dependencies/mergeRelationships.ts` to convert `dependencyHints` into `ApiDependencyRelationship`s (observed capped at `LIKELY`, `POSSIBLE` for one match; declared per research R20), pass them through the existing disambiguation, cycle detection and workflow assembly, and attach `inputEvidence`. Depends on T090.
- [ ] T092 [US4] Update `backend/src/testDesign/aiScenarioPrompt.ts` to add the single provenance sentence only for models with non-OpenAPI operations; leave the OpenAPI prompt text byte-identical. Do not change `AI_SCENARIO_RESPONSE_VERSION` (it stays 5; the OpenAPI prompt is byte-identical and a bump would break existing version assertions, SC-002). Add a dated note to the version-history comment at the top of the file stating that a provenance sentence is added for non-OpenAPI models only (constitution XXIII).
- [ ] T093 [US4] Frontend: show `evidence` and assertion `basis` in `frontend/src/components/TestScenarioDetail.tsx` and `TestScenarioReviewDetail.tsx` (text labels, no color-only meaning), and list `generationNotes` in the deterministic-generation and scenario-review views (`frontend/src/components/ScenarioReviewStage.tsx`, `TestScenarioReviewSummary.tsx`) so operations with no scenarios stay visible with their reason (FR-040). OpenAPI scenarios render unchanged.
- [ ] T094 [US4] Make T071 to T081 (including T080a) pass; run the full backend and frontend suites and confirm the existing tests pass unmodified.

**Checkpoint**: HAR-derived models flow through generation, AI enhancement, dependency review and Postman export, with OpenAPI artifacts byte-identical.

---

## Phase 8: User Story 6 - Describe an API in a simple, strictly validated JSON format (Priority: P3)

**Goal**: A versioned `apipilot.api-definition` JSON file is validated strictly, every violation reported with a location, and mapped into the same model as the other formats.

**Independent Test**: Upload a valid definition and each invalid one; the valid one yields a model equivalent to the corresponding OpenAPI model, the invalid ones yield location-bearing error lists ([quickstart.md](quickstart.md), *Story 6*).

### Tests for User Story 6

- [ ] T095 [P] [US6] Create fixtures in `backend/tests/fixtures/apiInput/definitions/`: `valid.json` (the example from [contracts/api-definition-format-v1.md](contracts/api-definition-format-v1.md)), `minimal.json` (no schemas, examples or responses), `credential-example.json` (an `Authorization` header example holding `SEEDED-SECRET-1`), and one invalid fixture per violation class in that document's table.
- [ ] T096 [P] [US6] `backend/tests/unit/apiInput/definition/validateDefinition.test.ts`: the schema file `specs/056-har-json-input-support/contracts/api-definition.v1.schema.json` compiles under Ajv strict mode, the valid fixture passes, every invalid fixture returns exactly its expected `"<pointer>: <message>"` entries together in one response, `oneOf` status alternatives collapse to one message, unknown fields are rejected, `$ref`, `$schema` and `$id` inside embedded schemas are rejected as unknown fields, and each cross-check (duplicate method and path, duplicate id, path parameter not in path or not declared, `required: false` on a path parameter, status range, `baseUrl` rules, undefined security reference, hint naming an unknown operation or field).
- [ ] T097 [P] [US6] `backend/tests/unit/apiInput/definition/buildDefinitionModel.test.ts`: mapping table in [data-model.md](data-model.md) (`info`, ids, descriptions, tags, parameters with `declared` provenance and `requiredUnknown` when `required` is absent, path parameters always required, request examples, responses as declared with statuses normalized to strings, `authentication` to `securitySchemes`, `security`, `declaredBaseUrl`, `dependencyHints`), omitted information stays unknown and produces no scenario or assertion, credential examples replaced by placeholders with a `credential-detected` issue and the marker absent from the model.
- [ ] T098 [P] [US6] `backend/tests/unit/testDesign/declaredExampleScenarios.test.ts` and an equivalence test `backend/tests/unit/apiInput/definition/definitionEquivalence.test.ts`: a definition and its hand-written OpenAPI equivalent produce equivalent deterministic scenarios (existing rules apply to declared schemas unchanged); an operation with a declared request example and no body schema gets the single declared-example positive scenario with `basis: "declared"`.
- [ ] T099 [P] [US6] Extend `backend/tests/integration/apiInput.upload.test.ts`: definition success (`input.format: "api-definition"`), `invalid_definition` with `problems` for each invalid fixture, arbitrary JSON with an `operations` list but no `format` gets `unrecognized_input_format`, the credential-example fixture leaves no marker in any output, and a verified declared dependency appears as `CONFIRMED` in dependency analysis (extend `backend/tests/unit/dependencies/inputHints.test.ts` for verified and unverified hints).
- [ ] T100 [P] [US6] Frontend: extend `frontend/tests/unit/TestGenerationWorkflowUpload.test.tsx` for an `invalid_definition` error rendering `problems` as a list with locations, and `frontend/tests/unit/ApiReviewStage.har.test.tsx` (or a sibling file) for "Declared" labels and the declared base URL line.

### Implementation for User Story 6

- [ ] T101 [US6] Add `ajv` as a direct backend dependency: `npm install ajv@^8.17 -w backend`, then verify with a one-line check run from `backend/` that `require("ajv/package.json").version` starts with `8.` (the hoisted root `ajv` is 6.x) and that nothing imports `ajv` from outside `backend/`. Let npm update the lockfile; do not edit it by hand (CLAUDE.md section 50).
- [ ] T102 [US6] Create `backend/src/apiInput/definition/definitionSchema.ts` exporting the schema as a typed constant identical to `specs/056-har-json-input-support/contracts/api-definition.v1.schema.json` (a test asserts deep equality of the two, so the runtime reads no file), and `backend/src/apiInput/definition/validateDefinition.ts`: compile once with Ajv (`allErrors: true`, `strict: true`), map each Ajv error to `"<JSON Pointer>: <corrective message>"` (`additionalProperties` to "unknown field 'x'; check the spelling or remove it", `enum`, `pattern`, `required`, `const`, bounds), collapse `oneOf` alternatives to one message per location, then run the code-level cross-checks from [contracts/api-definition-format-v1.md](contracts/api-definition-format-v1.md) and merge all problems into one `InvalidDefinitionError`. Messages are rewritten, never Ajv's raw text. Depends on T101.
- [ ] T103 [US6] Implement `backend/src/apiInput/definition/buildDefinitionModel.ts` per the mapping table: provenance `declared`, `requiredUnknown`, `securitySchemes` from `authentication`, `declaredBaseUrl`, `dependencyHints` with `verified` computed against declared schemas, credential values in examples passed through `redaction.ts` with a `credential-detected` issue, and the summary counts. Depends on T102.
- [ ] T104 [US6] Enable the definition family in `backend/src/apiInput/index.ts` (replace the stub from T022) via `backend/src/apiInput/definition/loadDefinition.ts`: validate, build, log `definition_validated` (`problemCount` only), list the family in the unrecognized-format message. Depends on T103.
- [ ] T105 [US6] Implement `backend/src/testDesign/rules/declaredExampleScenarios.ts` and add the `declared` branch (existing `RULES` plus this module) to the dispatch in `backend/src/testDesign/generateTestModel.ts`; set `evidence` and `basis: "declared"`. Depends on T088.
- [ ] T106 [US6] In `backend/src/dependencies/analyzeDependencies.ts` apply the declared-hint verification rule from research R20 (`verified` gives `CONFIRMED`; otherwise `LIKELY` with the reason in `explanation`). Depends on T091.
- [ ] T107 [US6] Make T095 to T100 pass; run the backend and frontend suites.

**Checkpoint**: All four input formats work end to end.

---

## Phase 9: User Story 7 - Documentation explains the formats, the inference limits and the safety rules (Priority: P3)

**Goal**: A new user can follow the docs and bundled example files to a reviewed operation list for a HAR and for a definition without reading source code.

**Independent Test**: Follow the docs with only the example files (SC-010).

- [ ] T108 [P] [US7] Create `docs/examples/sample-capture.har` (synthetic, credential-free, a small subset of the realistic fixture covering analytics exclusion, a varying id, two statuses, a form body and a login-token reuse) and `docs/examples/sample-api-definition.json` (the format document's example), and `docs/examples/sample-openapi.json` (the JSON form of `backend/tests/fixtures/openapi/valid.yaml`). Add a test `backend/tests/integration/docsExamples.test.ts` that uploads each and checks the representative output numbers stated in the docs.
- [ ] T109 [P] [US7] Create `docs/api-definition-format.md` from [contracts/api-definition-format-v1.md](contracts/api-definition-format-v1.md) (field reference, validation messages, versioning, the example), plus a note pointing to the published schema; copy `api-definition.v1.schema.json` to `docs/api-definition.v1.schema.json` and add a parity test against the contracts copy.
- [ ] T110 [P] [US7] Update `README.md`: supported inputs (all four formats and the Postman routing rule), HAR quick start, the definition format link, security handling of captures, link to the examples.
- [ ] T111 [P] [US7] Update `docs/architecture.md`: the input layer and `loadApiInput`, provenance and evidence, why HAR is not converted into OpenAPI, redaction placement and the placeholder contract with the exporter, the `PostmanBody` widening, limits.
- [ ] T112 [P] [US7] Update `docs/USER_MANUAL.md`: capturing a HAR from browser developer tools and from a proxy, stripping secrets before sharing, uploading, reading the import summary and origin labels, HAR versus OpenAPI differences (observed is not documented), known limitations (no decompression, multipart file parts, first-party heuristic, one operation per method and path across servers, redirects and 304 excluded, evidence threshold of 3, AI negatives not threshold-gated), unsupported content. Document the exclusion rules table and the analytics host list, the URL and path normalization rules, the identifier-like segment rule, the evidence threshold of 3, and the limits table with their environment variables (FR-019, FR-045).
- [ ] T113 [P] [US7] Update `docs/http-api.md` (the `input` envelope, new fields, error table) and confirm `docs/configuration.md` and `.env.example` carry the three variables from T012. Add the same limits table and the new import-report fields to `docs/http-api.md`.
- [ ] T114 [P] [US7] Add amendment pointers to `specs/002-openapi-specification-engine/contracts/specifications-api.md`, `specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md` and `specs/007-postman-collection-generator/contracts/postman-collection-api.md` linking to the matching files in `specs/056-har-json-input-support/contracts/`.
- [ ] T115 [US7] Add the AP-056 entry to `specs/ROADMAP.md` (what shipped, the clarifications, the constitution 3.2.0 amendment, the version) following the format of entry 101 (AP-055).
- [ ] T116 [US7] Walk through [quickstart.md](quickstart.md) with only the docs and example files and note the time to a reviewed HAR operation list and definition operation list (SC-010 target under 10 minutes); fix any doc gap found.

---

## Phase 10: Polish and cross-cutting concerns

- [ ] T117 Run the repository-wide checks and report honestly: `npm test`, `npm run lint`, `npm run build`; compare with the T002 baseline; every pre-existing test must pass unmodified (SC-002). Fix findings; do not weaken a rule, skip a test or add an `eslint-disable` to pass.
- [ ] T118 Review the full diff against the Definition of Done (CLAUDE.md section 66 and the plan's Constitution Check): no `any` without a boundary reason, no route logic beyond adapting input, no duplicated shared types, no new CSS outside Tailwind, no unrelated files changed, no secrets, `specs/056-har-json-input-support/` artifacts match behaviour (update spec, plan or contracts where implementation differed, rather than leaving drift).
- [ ] T119 Execute every scenario in [quickstart.md](quickstart.md) by hand against the running app (`npm run dev`) for Stories 1 to 6, including light and dark themes and keyboard-only navigation for the new UI, and record any gap as a fix or an explicit documented limitation.
- [ ] T120 Bump the version last: `npm run version:bump -- feature` (expected 19.58.0 to 19.59.0 across the root, backend, frontend and shared-domain `package.json` files), update the lockfile only through npm, and set the version in the roadmap entry from T115. Leave all changes uncommitted for the user to review.

---

## Dependencies and Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies; T001 (governance) must be done before any merge.
- **Foundational (Phase 2)**: depends on Setup; blocks every story.
- **US1 (Phase 3)**: depends on Foundational. MVP.
- **US5 (Phase 4)**: depends on Foundational and on `detectFormat.ts` from US1 only for T039; otherwise independent of US1's UI. Must finish, including T058, before the HAR family is enabled in US2 (T059).
- **US2 (Phase 5)**: depends on US1 (`loadApiInput`) and US5 (redaction, placeholder contract).
- **US3 (Phase 6)**: depends on US2 for a real HAR model in the UI, and on US1 for the page; can start with fixtures of `importReport` while US2 finishes.
- **US4 (Phase 7)**: depends on US2 (observed models). The exporter subset (T071 to T074, T082 to T086) depends only on T038 and can start as soon as Foundational and US5's T038 are done.
- **US6 (Phase 8)**: depends on US1 and the dispatch from US4 (T088) for T105; its validator and builder (T101 to T104) are independent of HAR.
- **US7 (Phase 9)**: depends on the behaviour being final; docs are written last against what shipped.
- **Polish (Phase 10)**: depends on all stories; T120 is last.

### Story dependency graph

```text
Setup -> Foundational -> US1 -> US5 -> US2 -> US3
                          |            \-> US4 -> US6(T105, T106)
                          \-> US6 (T101..T104, independent of HAR)
                       all -> US7 -> Polish
```

### Within each story

- Tests first, confirmed failing, then implementation.
- Pure modules before the orchestrator that uses them (for example `normalizeUrl` before `buildHarModel`).
- The exporter baseline (T071) before any exporter edit (T082 to T086).
- Shared-domain types (Phase 2) before anything that imports them; rebuild the package after changing it.

### Parallel opportunities

- Phase 2: T004 to T008, T010, T011, T013 touch different files and run in parallel.
- US1 tests T015 to T019 in parallel; T026 in parallel with backend work.
- US5 tests T031 to T035 in parallel.
- US2: fixtures T042 and T043, all unit-test tasks T044 to T052, and the independent HAR modules in T055 (`normalizeUrl`, `classifyEntry`, `originScope`, `decodeBody`, `inferPathParameters`, `inferSchema`) in parallel.
- US3 tests T061 to T063 and components T064, T065 in parallel.
- US4: T072 to T081 tests in parallel; the exporter chain (T082 to T086) and the generation chain (T087 to T089) can proceed in parallel by two people after T082 and T088's prerequisites.
- US6 fixtures and tests T095 to T100 in parallel; US7 documentation tasks T108 to T114 in parallel.

### Parallel example: User Story 2 unit tests

```text
T044 validateHar.test.ts      T045 normalizeUrl.test.ts      T046 classifyEntry + originScope tests
T047 decodeBody.test.ts       T048 inferPathParameters.test  T049 inferSchema.test.ts
T050 extractEntry.test.ts     T051 mergeObservations.test    T052 buildHarModel.test.ts
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 and Phase 2.
2. Phase 3 (US1): OpenAPI JSON, format label, Postman redirect, rejection messages, YAML unchanged.
3. Stop and validate with [quickstart.md](quickstart.md) *Story 1*. This is a shippable increment on its own (many teams export specifications as JSON).

### Incremental delivery

1. US1 (MVP), then US5 and US2 together as the HAR increment (the gate T058 is the hinge), then US3 for the review UI, so a HAR becomes usable and trustworthy.
2. US4 next: generation, dependencies, exporter. Do the exporter sub-chain with its byte-equality guard first within the phase.
3. US6 (definition format) is independent of HAR and can be reordered ahead of US4 if a team needs it sooner; its only link to US4 is the dispatch in T105.
4. US7 and Polish last.

### Rules of engagement

- Never edit an expected value of a pre-existing test to make it pass. If a golden file in T071 differs after an exporter change, stop and review.
- Never claim a command passed unless it was run; report failures with their output.
- Leave all changes uncommitted for the user's review.
