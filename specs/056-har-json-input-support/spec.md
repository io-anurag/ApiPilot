# Feature Specification: HAR and JSON API Input Support

**Feature Branch**: `AP-056` (the spec directory name is independent of the git branch name)

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Extend ApiPilot to accept HAR files and JSON-based API definitions as input alongside the existing OpenAPI YAML workflow, inside the existing architecture and without a parallel test-generation pipeline. Supported inputs: OpenAPI YAML (unchanged), OpenAPI 3.x serialized as JSON (same validation, normalization and model building; equivalent YAML and JSON must give equivalent models and scenarios), HAR captures (validate structure; extract method, URL, path, query, headers, bodies, response status, timing and content types; group repeated requests into operations by method and normalized path; infer path parameters cautiously; merge compatible examples; infer schemas from observed JSON; preserve observed examples, status codes and provenance; identify possible request dependencies from response values reused in later requests; filter or flag analytics, telemetry and unrelated third-party traffic with transparent diagnostics; tolerate missing, empty, malformed, binary, encoded and non-JSON bodies; report ambiguous paths, unsupported content types and incomplete observations as analysis issues; never treat an unobserved status code, field, authentication scheme or assertion as documented fact; deterministic for identical input), and a generic, versioned, strictly validated JSON API-definition format (metadata and optional base URL; operations with method, path, identifier, description; path and query parameters; request headers and body examples; expected response statuses and body examples; optional request and response schemas; explicit authentication metadata; optional dependency hints). Recognized OpenAPI JSON and Postman collection JSON must be routed correctly, and arbitrary JSON must never be interpreted as an API definition. All inputs map into the existing normalized API model through a format-independent input layer, then flow through the existing workflow (operation selection, deterministic generation, optional AI enhancement, scenario review, dependency and workflow review, Postman artifact generation). Frontend: accept .har and .json, show the detected format, show HAR analysis (imported entries, identified operations, excluded entries, inference warnings), let users review operations before generating, and distinguish documented information from observed and inferred metadata. Security: size, entry-count and nesting limits; never execute content, replay requests or fetch referenced URLs; redact credentials in logs, diagnostics and AI prompts; do not persist raw HAR content; reuse session isolation; keep execution confirmation and environment safety controls. Documentation: README and architecture docs cover formats, the definition format, HAR capture, HAR-versus-OpenAPI differences, limitations, security handling and examples."

**Extends**: `specs/002-openapi-specification-engine` (the specification upload and `ApiModel` contract), `specs/009-e2e-test-generation-workflow` (the workflow's upload and analysis stages), and `specs/003-deterministic-test-designer` (scenario provenance and grounding). **Relates to**: `specs/026-external-collection-execution` (the standalone Postman collection import, reused as the destination for Postman uploads, not duplicated), `specs/017-session-workflow-isolation` (session scoping), and `specs/032-quick-performance-test` (unchanged by this feature).

## Clarifications

### Session 2026-10-18

- Q: When a capture shows the same method and path on two different servers, what should ApiPilot do? → A: Keep one operation per method and path. The origin with more observations wins (ties: the lexicographically smaller origin); the other origin's entries are excluded with a stated reason and an analysis issue naming both origins.
- Q: How should ApiPilot decide which servers in a capture are "unrelated third-party" and exclude them? → A: An origin is related if it shares a site name (for example `example.com`; the plan calls this the site key) with the page the capture was taken on or with the busiest API origin; every other origin is excluded as third-party. The rule is documented and deterministic, and every exclusion is reported with its reason.
- Q: For an endpoint that was only ever called with a form-style body, should ApiPilot generate a test scenario for it? → A: Yes. A positive scenario is generated using the observed form field values (credential values replaced), which requires extending Postman artifact generation to send form-encoded and multipart text-field bodies. The extension is additive and must not change the output for any existing input.
- Q: When a capture contains paths like `/users/1/orders/9` and `/users/2/orders/8`, how should path parameters be inferred? → A: Paths that differ only in identifier-like segments (numbers, UUIDs, long mixed tokens) count as the same pattern. Each such position with at least 2 distinct values becomes a parameter; a position with only one distinct value stays literal and is reported as ambiguous.
- Q: How should redirect responses (301, 302, 307, 308) and "not modified" responses (304) in a capture be treated? → A: They are excluded from the model with the reasons "redirect" and "not modified", counted in the exclusion totals; the page a redirect leads to is its own entry and is judged on its own. Their status codes are never recorded as observed statuses.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload any supported file and have its format recognized (Priority: P1)

A user starts the guided workflow and chooses a file. They no longer have to know that only `.yaml` is accepted: an OpenAPI document saved as JSON works exactly like the YAML one, and the product tells them which format it recognized. If the file is a Postman collection, it is not forced through a workflow it does not belong in; the user is pointed to the standalone collection workflow. If the file is JSON that the product cannot identify, the user is told what was found and what is supported, and nothing is guessed.

**Why this priority**: Format recognition is the entry point for every other story, and OpenAPI JSON is the smallest slice that delivers value on its own (many teams export specifications as JSON). It also carries the strongest regression obligation: the YAML experience must not change.

**Independent Test**: Upload the same OpenAPI document once as YAML and once as JSON. Both produce the same operations, the same analysis summary and the same deterministic scenarios; the detected format differs (`OpenAPI (YAML)` versus `OpenAPI (JSON)`). Upload a Postman collection and an unrecognizable JSON object and observe the two distinct, actionable messages. No HAR or definition support is needed.

**Acceptance Scenarios**:

1. **Given** a valid OpenAPI 3.x document serialized as JSON, **When** the user uploads it, **Then** the workflow proceeds exactly as for YAML, the detected format is shown as OpenAPI (JSON), and every assertion remains grounded in the specification.
2. **Given** an OpenAPI document available in both YAML and JSON with identical content, **When** each is analyzed, **Then** the normalized API models are equivalent (same operations, parameters, schemas, security, analysis issues) and the deterministic test scenarios are equivalent.
3. **Given** a valid OpenAPI YAML document, **When** the user uploads it, **Then** behavior, error messages, analysis issues and generated scenarios are identical to those before this feature.
4. **Given** a JSON document that is a Postman collection, **When** the user uploads it in the guided workflow, **Then** no workflow is started, the message says a Postman collection was recognized and directs the user to the standalone collection import and run workflow, and nothing from the file is imported.
5. **Given** a JSON document that is none of the supported formats, or that carries markers of more than one supported format, **When** it is uploaded, **Then** it is rejected with a message that names what was detected (or that nothing could be identified), lists the supported formats, and creates no workflow and no partial model.
6. **Given** a Swagger 2.0 or other unsupported-version JSON document, **When** it is uploaded, **Then** it receives the same unsupported-version outcome the YAML equivalent receives today.
7. **Given** a file whose extension disagrees with its content (for example a `.json` file holding YAML, or a `.har` file that is not valid JSON), **When** it is uploaded, **Then** the file is judged by its content, and any failure names the actual problem rather than the extension.

---

### User Story 2 - Turn a browser or proxy capture (HAR) into a reviewable API model (Priority: P2)

A tester has no OpenAPI document for a service, but can capture traffic from a browser's developer tools or a proxy and save it as a HAR file. They upload it, and ApiPilot derives the API that the capture actually exercised: one operation per distinct method and path, with the parameters, bodies and response statuses that were seen. Repeated calls to the same endpoint are merged. The tester reviews the resulting operations in the existing API review stage, selects the ones they care about, and continues through the normal workflow.

**Why this priority**: This is the headline capability and unlocks API testing for services with no formal contract. It depends on Story 1's recognition step and on Story 5's protections, and it is more complex than OpenAPI JSON, so it follows them.

**Independent Test**: Upload a realistic HAR containing several methods, a path with a varying identifier, query parameters, JSON request and response bodies, and more than one response status for one endpoint. Verify the operation list, the merged examples, the observed statuses, the path parameter decision and the analysis issues, and verify that uploading the identical file again yields an identical result.

**Acceptance Scenarios**:

1. **Given** a HAR capture with repeated requests to the same method and normalized path, **When** it is analyzed, **Then** they become one operation whose observed examples, query parameters and response statuses are the merged union, and each carries a count of how many observations support it.
2. **Given** several observations of the same method and path pattern in which one segment takes different identifier-like values and all other segments are identical, **When** it is analyzed, **Then** that segment becomes a path parameter, the observed values become examples, and the decision is recorded as inferred.
3. **Given** a path with identifier-like text in a single observation only, **When** it is analyzed, **Then** the segment stays literal, and an analysis issue reports the ambiguity (possible path parameter, insufficient evidence) instead of silently choosing.
4. **Given** repeated JSON request or response bodies for one operation, **When** they are analyzed, **Then** a structural schema is inferred from the union of observations, fields not present in every observation are not treated as always present, and conflicting types for the same field are reported as an issue rather than resolved by guesswork.
5. **Given** an operation observed only with successful responses, **When** it is analyzed, **Then** only those statuses are recorded, each marked as observed, and no error status, field, authentication scheme or constraint that was not observed appears in the model.
6. **Given** an entry with a missing, empty, binary, encoded (for example compressed or base64), oversized or non-JSON body (other than a form-encoded or multipart body, which FR-056 covers), **When** it is analyzed, **Then** the entry is still used for what it does reveal (method, path, status), the body is recorded as unavailable with a reason, and an analysis issue reports the unsupported or incomplete content.
7. **Given** a HAR file that is structurally invalid (not JSON, no `log`, no entries collection) or contains no entries, **When** it is uploaded, **Then** it is rejected with an actionable message and no workflow is created.
8. **Given** a HAR file in which some entries are malformed (for example no request URL or no response status), **When** it is analyzed, **Then** the usable entries are processed, each malformed entry is listed with its position and reason, and the malformed entries do not contribute to the model.
9. **Given** the same HAR file and the same configuration, **When** it is analyzed any number of times, **Then** the resulting model, issues, exclusions and ordering are identical every time.

---

### User Story 3 - Understand exactly what was imported, excluded and inferred (Priority: P2)

After a HAR upload, the user sees an analysis summary before they generate anything: how many entries were in the file, how many were imported, how many operations were identified, which entries were excluded and why (analytics, telemetry, unrelated third-party hosts, static assets), and which inferences carry warnings. In the operation review, every piece of information is labelled by origin: documented in a specification, declared in a definition, observed in the capture, or inferred by ApiPilot. A user can tell at a glance that a status code is "seen once in the capture" rather than "guaranteed by a contract."

**Why this priority**: The value of HAR-derived tests rests on the user trusting what they are reviewing. Without this, inferred metadata looks like documented contract. It is delivered together with Story 2 but is independently verifiable.

**Independent Test**: Upload a HAR that includes analytics beacons, a third-party font request, a preflight request and a handful of API calls. Verify that the summary counts reconcile (imported plus excluded plus malformed equals total), every exclusion has a reason, and the review screen distinguishes observed from inferred values in light and dark themes and with keyboard-only navigation.

**Acceptance Scenarios**:

1. **Given** a HAR containing analytics, telemetry, unrelated third-party and static-asset requests, **When** it is analyzed, **Then** those entries are excluded from the model, and the summary lists each excluded entry (or group of identical exclusions) with the rule that excluded it.
2. **Given** an analyzed HAR, **When** the user views the summary, **Then** the counts of total entries, imported entries, excluded entries, malformed entries and identified operations are shown, and they reconcile exactly.
3. **Given** an analyzed HAR, **When** the user reviews an operation, **Then** each status code, example, parameter, schema fact and path-parameter decision is labelled with its origin (observed, inferred, documented, declared) and its supporting observation count where applicable.
4. **Given** inference warnings exist (ambiguous path, conflicting types, incomplete observation, unsupported content), **When** the user views the analysis, **Then** each warning identifies the affected operation or entry and is also available through the existing analysis-issue presentation, and none is conveyed by color alone.
5. **Given** analysis is running on a large file, **When** the user waits, **Then** progress is visible, and any failure is shown with a specific message and a way to try another file.
6. **Given** a HAR in which every entry is excluded or malformed, **When** it is analyzed, **Then** no workflow is created and the user sees the exclusion and malformation counts by reason so they can understand why nothing was imported.

---

### User Story 4 - Generate tests only as far as the evidence supports (Priority: P2)

A user continues from a HAR-derived or definition-derived model through the existing stages: operation selection, deterministic scenario generation, optional AI enhancement, scenario review, dependency review and Postman generation. For OpenAPI input nothing changes. For HAR input, scenarios are built from what was observed, and the product never claims that one observed successful request proves that all other inputs should fail. For a generic JSON definition, the supplied contract and examples are the source of truth, as an OpenAPI document is.

**Why this priority**: This is how the new inputs become executable test assets, but it is only meaningful after Stories 2 and 3 produce a trustworthy model.

**Independent Test**: Run a HAR-derived model and an OpenAPI model through deterministic generation. The OpenAPI scenarios are unchanged. The HAR scenarios reuse observed examples as data, every scenario names the evidence it rests on, there are no assertions for status codes that were never observed, and negative scenarios appear only where the evidence thresholds are met.

**Acceptance Scenarios**:

1. **Given** a HAR-derived operation with an observed request example, **When** deterministic scenarios are generated, **Then** a positive scenario uses that observed example as its request data, its provenance states it came from observation, and its only response assertion is the observed status code, labelled as observed rather than documented.
2. **Given** a HAR-derived operation whose observations were too few or too inconsistent to support a constraint (for example a field seen in some but not all observations, or fewer than the minimum number of observations), **When** scenarios are generated, **Then** no negative scenario is generated for that constraint.
3. **Given** a HAR-derived constraint that does meet the evidence threshold, **When** a negative scenario is generated from it, **Then** the scenario is labelled as inference-derived, carries no assertion about the expected failure status unless a matching failure was observed, and states the evidence it rests on.
4. **Given** any HAR-derived scenario, **When** it is reviewed, **Then** no assertion about response headers, response body values or response schema appears unless it is directly supported by an observation of that exact fact, and none is presented as documented.
5. **Given** a definition-derived operation with declared statuses, schemas and examples, **When** scenarios are generated, **Then** assertions and constraint-based negative scenarios follow the existing specification-grounded rules, using the definition as the source of truth.
6. **Given** a HAR in which a value returned by one response is later used in a request path, query or body, **When** dependencies are analyzed, **Then** a possible dependency is proposed with the matching values and observation order as evidence, and it is never marked confirmed on value matching alone; coincidental values (very short, boolean, or very common values) are not treated as evidence.
7. **Given** AI enhancement is enabled, **When** it is run on a non-OpenAPI model, **Then** AI may suggest additional scenarios and relationships, every suggestion is validated against the normalized model and its evidence, and suggestions that reference operations, fields or statuses absent from the model are rejected exactly as they are today.
8. **Given** an approved HAR-derived test model, **When** a Postman artifact is generated, **Then** generation is deterministic, executable only against an environment the user explicitly selects and confirms, and never targets the hosts recorded in the capture by default.
9. **Given** a HAR-derived operation observed with a form-encoded or multipart text-field body, **When** scenarios are generated and a Postman artifact is produced, **Then** a positive scenario uses the observed field values with credential values replaced, the artifact sends the body as a form-encoded or multipart request, and the output for non-form inputs is unchanged.

---

### User Story 5 - Handle captures that contain credentials and hostile content safely (Priority: P2)

Real captures contain session cookies, bearer tokens, API keys and personal data, and a malicious or accidental upload can be huge, deeply nested or full of malformed URLs. The user can upload a capture knowing that credentials never reach logs, diagnostics, AI prompts, generated artifacts or the review screen in clear text; that the file is never executed, replayed or used to fetch anything; that the raw capture is not retained; and that oversized or abusive input is refused without affecting other users of the instance.

**Why this priority**: This is a release gate for Story 2: the HAR capability must not ship without it. It is ordered with the HAR stories because it has no standalone user value, but no HAR path may be enabled before it is satisfied.

**Independent Test**: Upload a HAR seeded with recognizable secret values in headers, cookies, query strings, JSON bodies and URLs. Search every output surface (logs, API responses other than the explicit review data, diagnostics, AI prompts, generated Postman artifacts) for those values and find none. Upload files exceeding each limit and observe refusal with a specific message while another session's requests continue to be served.

**Acceptance Scenarios**:

1. **Given** a capture containing authorization headers, cookies, API keys, bearer tokens and credential-named body or query fields, **When** it is analyzed, **Then** those values are replaced by explicit placeholders in the model, the analysis report, application logs and AI prompts, and the model records that a credential of that kind was observed without recording its value.
2. **Given** the observed credentials, **When** a Postman artifact is generated, **Then** it contains no captured secret value and instead references variables for the user to supply at execution time.
3. **Given** a file larger than the upload limit, a capture with more entries than the entry limit, JSON nested deeper than the nesting limit, or entries with oversized bodies, **When** it is uploaded, **Then** it is rejected, or the offending bodies are skipped and reported, with a specific message naming which limit applied, and the backend continues to serve other sessions normally.
4. **Given** entries with malformed, relative, non-HTTP(S) or credential-embedded URLs, **When** the capture is analyzed, **Then** each such entry is reported with a reason and does not break analysis of other entries.
5. **Given** any uploaded file containing scripts, URLs, `$ref`-style references or other active content, **When** it is processed, **Then** nothing is executed, no network request is made to any address named in the file, and no file-system path named in the file is read.
6. **Given** an analysis completes or fails, **When** the user's session continues, **Then** the raw uploaded bytes are no longer retained; only the normalized model, the analysis report and the workflow state exist, scoped to the user's session exactly as for OpenAPI uploads.
7. **Given** a model derived from a HAR, **When** the user reaches execution, **Then** the existing explicit execution confirmation and environment safety controls apply unchanged and are not bypassed or pre-confirmed because of the input format.

---

### User Story 6 - Describe an API in a simple, strictly validated JSON format (Priority: P3)

A team that has neither an OpenAPI document nor a HAR can write a small JSON document in an ApiPilot-defined, versioned format: API metadata, an optional base URL, and a list of operations each with method, path, optional identifier and description, parameters, request headers and body examples, expected response statuses and body examples, optional schemas, explicit authentication metadata, and optional hints about which operations depend on which. The product validates the document strictly and tells the user precisely what is wrong, with the location, when it is invalid.

**Why this priority**: It serves a smaller audience than OpenAPI and HAR and depends on the same input layer. It is also the cleanest demonstration that the input layer is format independent.

**Independent Test**: Upload a valid definition and an invalid one (wrong version, unknown field, duplicate operation, malformed path, bad status code). The valid one produces a model equivalent to the corresponding OpenAPI model, and the invalid one produces an error list with locations.

**Acceptance Scenarios**:

1. **Given** a valid definition document in the documented version, **When** it is uploaded, **Then** it is detected as an API definition, validated, and mapped into the same normalized model the other formats produce, with declared information labelled as declared.
2. **Given** a definition that violates the format (unsupported or missing version, unknown or misspelled field, missing method or path, invalid status code, duplicate method-and-path, schema that is not valid, dependency hint naming a nonexistent operation), **When** it is uploaded, **Then** every violation found is reported with its location and a corrective message, and nothing is imported.
3. **Given** a definition that omits optional information (no schemas, no examples, no response statuses), **When** it is analyzed, **Then** the omitted information is represented as unknown, not defaulted, and no scenarios or assertions depend on it.
4. **Given** a definition that declares authentication metadata, **When** it is analyzed, **Then** the authentication appears as declared and credentials are not part of the definition; a definition containing credential values is flagged.
5. **Given** a definition that declares dependency hints, **When** dependencies are analyzed, **Then** the hints are used as declared evidence, subject to the same validation as inferred dependencies, and are labelled as declared.
6. **Given** an arbitrary JSON object that merely resembles a definition (for example it has a list of items with `path` fields but no format identifier), **When** it is uploaded, **Then** it is not interpreted as a definition and receives the unrecognized-format message from Story 1.

---

### User Story 7 - Documentation explains the formats, the inference limits and the safety rules (Priority: P3)

A new user can read the README and the architecture documentation and learn which formats are supported, what the JSON definition format expects (with an example file), how to capture a HAR from a browser or proxy and how to strip secrets before sharing it, how HAR inference differs from a formal contract, what is known not to work, and how sensitive data is handled.

**Why this priority**: Required to ship, but it has no runtime effect and is written last against the behavior actually delivered.

**Independent Test**: Follow the documented steps with the bundled example HAR and example definition files and reach reviewed operations without reading source code.

**Acceptance Scenarios**:

1. **Given** the documentation, **When** a reader looks for supported inputs, **Then** all four formats and the Postman routing rule are described accurately.
2. **Given** the documentation, **When** a reader looks for HAR guidance, **Then** it explains capturing, uploading, what is inferred, what is never assumed, known limitations and unsupported content.
3. **Given** the bundled example files, **When** they are uploaded, **Then** they succeed and the documented representative outputs match what the product produces.

---

### Edge Cases

- A JSON file is valid for two families at once (for example it contains both an OpenAPI version marker and a HAR `log`): it is rejected as ambiguous, never resolved by precedence.
- A HAR whose entries target several first-party origins: operations are derived per origin and the origin is shown in review. An operation is identified by method and path everywhere in the product, so when the same method and path appear on two origins only one operation is kept: the origin with more observations (ties: the lexicographically smaller origin). The other origin's entries are excluded with a stated reason, counted in the exclusion totals, and reported as an analysis issue naming both origins.
- A HAR where one URL is called with different query-string sets: the query parameters are the union, each marked with how often it was observed.
- A HAR path containing percent-encoding, trailing slashes, duplicate slashes, dot segments, fragments, or default ports: normalized deterministically, and the normalization is not lossy in a way that merges genuinely different resources.
- A HAR where the same endpoint returns different JSON shapes on different statuses: schemas are kept per status, never merged across statuses.
- A HAR request with a JSON body that is invalid JSON, or declares JSON but sends text: the body is recorded as unparseable and reported, not coerced.
- Form-encoded and multipart request bodies: recognized as such, with field names and text-field values kept as observations (credential-named values replaced); no schema beyond field presence is inferred. A multipart part that carries file content cannot be reproduced: it is recorded as unavailable with a reason, and an operation whose observed requests all include such a part is reviewable but gets no scenario, with the reason stated.
- Response bodies that are compressed, base64-encoded, or truncated by the capturing tool: decoded only when the encoding is declared and standard; otherwise recorded as unavailable with a reason.
- Redirect chains, preflight (`OPTIONS`) requests, cached (`304`) and failed (status `0`) entries: handled by explicit, reported rules, never silently dropped or treated as normal successes. Redirect responses (3xx other than 304), `304` responses, CORS preflight requests and failed requests are each excluded under their own stated reason, and none of their statuses is recorded as an observed status.
- WebSocket, server-sent-event and streaming entries: reported as unsupported content.
- A HAR exported with sensitive values already stripped or replaced by capture-tool placeholders: treated as ordinary values, with no assumption either way.
- Very large capture with thousands of entries, or a bomb-like body (highly repetitive or deeply nested): refused or truncated at the documented limits with an explicit message.
- A definition operation whose path parameter is declared in the path but not in the parameter list (or vice versa): reported as a validation error.
- An upload that is empty, whitespace only, or contains only a byte-order mark: rejected with the existing empty-document message, which states that the document is empty or not an object, and creates no workflow.
- A user uploads a second file while a workflow is in progress: the existing confirm-before-discard behavior applies unchanged to every format.
- The AP-032 quick performance test continues to accept only the formats it accepts today, and its behavior does not change.

## Requirements *(mandatory)*

### Functional Requirements

**Format recognition and routing**

- **FR-001**: The system MUST determine the input format of an uploaded file from its content, not from its filename or extension alone, and MUST report the detected format to the user (OpenAPI YAML, OpenAPI JSON, HAR, API definition, or Postman collection).
- **FR-002**: The system MUST accept the file extensions `.yaml`, `.yml`, `.json` and `.har` in the guided workflow's upload control, and MUST apply the same size limit and the same content validation regardless of extension.
- **FR-003**: The system MUST NOT interpret an arbitrary JSON document as an API definition; a JSON document is processed as a definition only if it carries the definition format's identifier and a supported version.
- **FR-004**: A JSON document recognized as a Postman collection MUST NOT be converted into the normalized API model or started as a guided workflow; the user MUST be told it was recognized and directed to the standalone collection import and run workflow, which MUST remain functionally unchanged.
- **FR-005**: A JSON document that matches no supported format, or matches more than one, MUST be rejected with a message naming what was detected (or that nothing could be identified), listing the supported formats, and MUST create no workflow and no partial model.
- **FR-006**: Non-JSON content MUST continue to be processed as OpenAPI YAML with the existing parse errors, analysis issues and outcomes unchanged.

**OpenAPI JSON**

- **FR-007**: The system MUST accept OpenAPI 3.x documents serialized as JSON and process them through the same validation, normalization and model-building behavior as YAML, with unsupported versions (including Swagger 2.0) receiving the same outcome as YAML.
- **FR-008**: Equivalent OpenAPI YAML and JSON documents MUST produce equivalent normalized models and equivalent deterministic test scenarios.

**HAR import**

- **FR-009**: The system MUST validate a HAR file's structure before processing entries, and MUST reject files that are not valid JSON, lack the capture container or entries collection, or contain no entries, each with an actionable message.
- **FR-010**: The system MUST extract from each entry, where present: method, full URL, path, query parameters, request headers, request body and its content type, response status, response headers, response body and its content type, and timing metadata, and MUST tolerate any of these being absent.
- **FR-011**: Malformed entries MUST be skipped individually, listed with their position and reason, and MUST NOT prevent the remaining entries from being processed.
- **FR-012**: The system MUST group observations into operations by origin, HTTP method and normalized path, using a documented, deterministic path normalization. When the same method and normalized path occur on more than one origin, the system MUST keep the operation from the origin with more observations (ties: the lexicographically smaller origin) and exclude the other origin's entries with a stated reason and an analysis issue naming both origins.
- **FR-013**: The system MUST treat a path segment as a path parameter only when the capture contains multiple distinct values at that position across otherwise identical paths for the same method; a single observation, or a dynamic-looking segment without such evidence, MUST remain literal and MUST produce an ambiguous-path analysis issue. Paths are "otherwise identical" when they differ only in identifier-like segments (for example numbers, UUIDs and long mixed letter-and-digit tokens), so a path with several varying identifiers yields one parameter per position that has at least 2 distinct values; a position with a single distinct value stays literal. A varying segment that is not identifier-like (for example `list` and `search`) is never a parameter.
- **FR-014**: The system MUST merge compatible observations of an operation (examples, query parameters, headers, response statuses) and MUST record, for each merged fact, how many observations support it.
- **FR-015**: The system MUST infer a structural schema from observed JSON bodies, kept separately per operation and per response status, MUST NOT mark a field as always present unless every observation includes it, and MUST report conflicting observed types as an analysis issue rather than choosing one.
- **FR-016**: The system MUST NOT represent as documented, or include in the model, any status code, field, constraint, authentication scheme or assertion that was not observed in the capture.
- **FR-017**: The system MUST represent unknown values (for example requiredness of a non-path parameter, or authentication scheme) as unknown, and MUST NOT substitute fabricated defaults.
- **FR-018**: Entries with missing, empty, binary, compressed, encoded, truncated, oversized or non-JSON bodies (form-encoded and multipart text fields are not unavailable: they are handled as FR-056 states) MUST still contribute whatever they validly reveal, MUST record the body as unavailable or unparsed with a reason, and MUST produce an analysis issue for unsupported or incomplete content.
- **FR-019**: The system MUST classify and exclude, with a stated reason per exclusion, traffic that is not part of the API under observation, including static assets, known analytics and telemetry destinations, unrelated third-party origins, preflight requests, and non-HTTP(S) entries, and MUST apply those rules deterministically. Exclusion rules MUST be documented. An origin is related, and therefore not third-party, when it shares a site name with the origin of the page the capture was taken on or with the origin that has the most API-like entries; every other origin is unrelated.
- **FR-020**: The analysis result MUST include counts of total, imported, excluded and malformed entries and of identified operations, and these counts MUST reconcile exactly.
- **FR-021**: When no operation can be derived from a capture, the system MUST create no workflow and MUST return the exclusion and malformation counts by reason.
- **FR-022**: HAR analysis MUST be deterministic: identical input and configuration MUST produce identical output, including operation order, example order, issue order and identifiers, independent of wall-clock time, randomness or environment.

**Generic JSON API definition**

- **FR-023**: The system MUST define, version and document a generic JSON API-definition format that can express: API metadata and an optional base URL; operations with method and path and optional identifier and description; path and query parameters; request headers and request-body examples; expected response statuses and response-body examples; optional request and response schemas; explicit authentication metadata (scheme kind and where credentials go, never credential values); and optional operation dependency hints.
- **FR-024**: The system MUST validate a definition strictly against its documented version, MUST report every violation found with its location and a corrective message, and MUST reject unknown fields and unsupported versions rather than ignoring them.
- **FR-025**: Information supplied in a definition MUST be treated as the source of truth for that input in the same way an OpenAPI document is, MUST be labelled as declared, and omitted information MUST remain unknown.
- **FR-026**: A definition containing credential values MUST be flagged, and the values MUST NOT be carried into the model, logs, AI prompts or artifacts.

**Input layer, model and provenance**

- **FR-027**: All supported input formats MUST be converted to the existing normalized API model (or a backward-compatible extension of it) by a format-independent input layer, so that every downstream stage consumes one model regardless of origin.
- **FR-028**: Every operation, parameter, example, response status, schema fact and dependency in the model MUST carry provenance identifying its origin (documented, declared, observed, or inferred) and, for observed and inferred facts, the supporting observation count and a confidence indication.
- **FR-029**: The model changes MUST be additive: existing consumers of the model, including every field and meaning they currently rely on, MUST continue to work unchanged for OpenAPI input.
- **FR-030**: Format-specific parsing MUST remain separate from deterministic test design: the test designer MUST consume only the normalized model and MUST NOT depend on the input format's parser.
- **FR-031**: Postman MUST remain an output format only; no input format's processing may use a Postman collection as its internal representation.
- **FR-032**: The input layer MUST NOT depend on a single third-party HAR conversion library for its core behavior; the behavior in this specification MUST be satisfiable and testable independent of any such library.

**Test generation and AI**

- **FR-033**: Normalized models from every format MUST flow through the existing operation selection, deterministic generation, optional AI enhancement, scenario review, dependency and workflow review, and Postman artifact generation stages without a parallel pipeline.
- **FR-034**: For OpenAPI input, the existing deterministic rules and specification-grounded assertions MUST remain unchanged.
- **FR-035**: For HAR-derived models, deterministic generation MUST reuse observed examples as test data, MUST label the evidence behind every scenario, and MUST limit response assertions to the observed status code of the matching example, labelled as observed and not documented.
- **FR-036**: For HAR-derived models, a negative scenario MUST be generated only for a constraint whose evidence meets a documented minimum (a minimum number of consistent observations), MUST be labelled inference-derived, and MUST NOT assert an expected failure status unless a matching failure was observed.
- **FR-037**: For definition-derived models, deterministic generation MUST apply the existing specification-grounded rules, treating declared statuses, schemas and examples as authoritative.
- **FR-038**: Dependency analysis on HAR input MUST use response-to-later-request value matches and observation order as evidence, MUST never rate a relationship confirmed on value matching alone, and MUST ignore coincidental values; declared dependency hints MUST be treated as declared evidence subject to the same validation.
- **FR-039**: AI enhancement MUST remain optional and local-first, and every AI suggestion for any input format MUST be validated against the normalized model and its evidence; suggestions referencing operations, fields, or statuses absent from the model MUST be rejected.
- **FR-040**: Operations whose information is too incomplete for any justified scenario MUST remain reviewable and MUST say why no scenarios were generated, rather than being dropped.
- **FR-056**: For HAR-derived operations observed with form-encoded or multipart text-field request bodies, deterministic generation MUST produce a positive scenario that reuses the observed field values (credential values replaced by placeholders), asserting only the observed status code, and Postman artifact generation MUST send such a body as a form-encoded or multipart request. This extension MUST be additive: generated artifacts for every input that does not use form-style bodies MUST be unchanged, and credential-named form fields MUST be referenced through user-supplied variables (FR-048).

**Frontend**

- **FR-041**: The guided workflow's upload step MUST accept the new file types, MUST show progress during analysis, and MUST show the detected format and any validation errors with a way to choose another file; its wording MUST no longer state that only OpenAPI YAML is supported, while the YAML experience otherwise remains unchanged.
- **FR-042**: For HAR input, the user MUST be able to see, before generating scenarios, the imported entry count, identified operations, excluded entries with reasons, malformed entries, and inference warnings.
- **FR-043**: The operation review MUST label documented, declared, observed and inferred information distinctly using text (not color alone) and MUST present supporting observation counts for observed and inferred facts.
- **FR-044**: The new UI MUST follow the existing design system, accessibility requirements (semantic structure, accessible names, keyboard operation, visible focus, non-color indicators), responsive behavior, and light and dark themes, and MUST NOT add controls or workflow stages that duplicate existing ones.

**Security and limits**

- **FR-045**: The system MUST enforce documented limits on file size, HAR entry count, per-body size, and JSON nesting depth, MUST reject or skip input that exceeds them with a message naming the limit, and MUST keep serving other sessions while doing so. The existing upload size limit MUST NOT be raised by this feature.
- **FR-046**: The system MUST NOT execute any content from an uploaded file, MUST NOT replay captured requests, MUST NOT issue any network request to an address named in an uploaded file, and MUST NOT read any file-system location named in an uploaded file, during parsing, analysis or generation.
- **FR-047**: Credentials and sensitive values (authorization and proxy-authorization headers, cookies and set-cookie values, API keys, bearer and session tokens, and values of credential-named query, header and body fields) MUST be redacted before entering the model, analysis report, logs, diagnostics and AI prompts, and the redaction MUST record that a credential of that kind was observed without recording its value.
- **FR-048**: Generated Postman artifacts MUST NOT contain captured credential values and MUST reference user-supplied variables for them.
- **FR-049**: Raw uploaded bytes MUST NOT be persisted or retained beyond the analysis request; only the normalized model, analysis report and workflow state are kept, under the existing session isolation and in-memory workflow lifetime.
- **FR-050**: Malformed, relative, non-HTTP(S) and credential-embedded URLs MUST be reported per entry, and any embedded credentials MUST be redacted in the report.
- **FR-051**: Errors MUST follow the existing structured error conventions, expose no stack traces or internal paths, and use distinct, actionable messages per failure class.
- **FR-052**: The existing execution confirmation and environment safety controls MUST apply unchanged to artifacts from every input format, and the origins recorded in a capture or definition MUST NOT be used as an execution target without the user's explicit selection.

**Compatibility and documentation**

- **FR-053**: Existing endpoint request and response contracts MUST remain backward compatible; any new field MUST be additive, and the contracts in the specification artifacts MUST be updated to describe them.
- **FR-054**: The AP-032 quick performance test MUST continue to behave as it does today.
- **FR-055**: The README, the architecture documentation and the user manual MUST describe supported formats, the definition format (with an example), HAR capture and upload, how HAR inference differs from a formal contract, known limitations and unsupported content, and security and sensitive-data handling, and MUST ship example HAR and definition files with representative outputs.

### Key Entities *(include if feature involves data)*

- **API Input**: An uploaded file and its detected format. Attributes: filename, detected format, size, outcome (accepted, rejected with reason, redirected to the Postman workflow).
- **Detected Format**: One of OpenAPI YAML, OpenAPI JSON, HAR, API definition, Postman collection, or unrecognized/ambiguous. Determined from content.
- **Normalized API Model**: The existing format-independent API representation, extended additively so each fact can carry provenance. The only model downstream stages consume.
- **Provenance**: The origin of a model fact: documented (OpenAPI), declared (definition), observed (capture), or inferred (derived by ApiPilot), plus supporting observation count and confidence.
- **HAR Observation**: One imported capture entry reduced to the facts the product keeps (method, URL parts, parameters, redacted headers, body facts, status, content types). Never retains raw credential values. Timing metadata is read only to order observations chronologically and is not kept in the model.
- **Observed Operation**: A group of observations sharing origin, method and normalized path, with merged examples, query parameters, statuses, inferred schemas and path-parameter decisions.
- **Excluded Entry**: A capture entry left out of the model, with the rule that excluded it.
- **Malformed Entry**: A capture entry that could not be used, with position and reason.
- **Import Analysis Report**: Counts (total, imported, excluded, malformed, operations), exclusions by reason, malformed entries, entries whose URL carried credentials (position and host only), and inference warnings, presented before generation. Contains no credential values.
- **Analysis Issue**: The existing finding type, extended to cover ambiguous paths, conflicting types, unsupported or incomplete content and definition validation findings.
- **API Definition Document**: The versioned, documented generic JSON format: metadata, optional base URL, operations, parameters, examples, statuses, optional schemas, authentication metadata, dependency hints.
- **Dependency Evidence**: A proposed relationship between operations with its basis (value match and order, or declared hint) and a confidence level never above likely for value matching alone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every YAML and JSON pair of the same OpenAPI document in the test corpus, the normalized models and deterministic scenarios are equivalent in 100% of pairs.
- **SC-002**: All existing OpenAPI YAML behavior is unchanged: 100% of pre-existing automated tests for the upload, workflow, test design, dependency, review and Postman generation stages pass without modification.
- **SC-003**: Analyzing the same HAR file and configuration repeatedly yields byte-identical results in 100% of repeated runs.
- **SC-004**: In a corpus of captures seeded with known secret values across headers, cookies, query strings, bodies and URLs, zero secret values appear in any log line, analysis report, AI prompt or generated artifact.
- **SC-005**: For every analyzed HAR, imported plus excluded plus malformed entries equals the total entry count, and every excluded or malformed entry has a stated reason, in 100% of cases.
- **SC-006**: Every fact displayed in operation review for non-OpenAPI input shows its origin label, and no status code, field, constraint or authentication scheme absent from the input appears in the model, in 100% of corpus cases.
- **SC-007**: A tester with a typical capture of up to 500 entries goes from choosing the file to a reviewable operation list in under 30 seconds of waiting and no more than the existing workflow's upload-to-review steps.
- **SC-008**: 100% of invalid inputs in the corpus (malformed HAR, malformed definition, ambiguous JSON, Postman, unsupported version, empty file) are rejected with a message that names the specific problem, and none leaves a partial model or workflow.
- **SC-009**: Inputs exceeding each documented limit are refused or truncated with a message naming the limit in 100% of cases, and concurrent sessions' requests continue to complete normally during these uploads.
- **SC-010**: A first-time reader following only the documentation and the bundled example files reaches a reviewed operation list for a HAR and for a definition in under 10 minutes.

## Assumptions

- **Audience and register**: ApiPilot is a developer and test-engineering platform, so product-contract vocabulary (OpenAPI, HAR, Postman, analysis issue, provenance) is used where it is the user's vocabulary. The spec names no language, library or file.
- **Governance prerequisite**: The constitution currently frames the specification as the single source of truth and distinguishes five categories of information. HAR-derived "observed" information is an additional evidence category. Before implementation, the constitution should be reviewed and, if needed, amended (through the constitution workflow) so observed and inferred information is governed explicitly. This spec already keeps the categories separate so that amendment is a documentation step, not a design change.
- **Scope of entry points**: The shared input layer replaces the YAML-only parsing in the specification upload endpoint and the guided workflow start. The AP-032 quick performance test keeps its current OpenAPI-YAML-only path and its upload control; adopting the new layer there is a follow-up.
- **Limits**: The existing ~10 MB upload limit is kept for all formats. A HAR larger than that is refused with advice to capture a narrower session or filter before saving. Entry-count, per-body and nesting limits are initial defaults fixed at planning and documented; they are configuration, not product contract.
- **Evidence threshold**: The minimum number of consistent observations before an inferred constraint can justify a negative scenario is an initial default of 3, fixed and documented at planning. It can be tuned without changing this specification.
- **HAR assertions**: To stay conservative, HAR-derived scenarios assert at most the observed status code; no body, header or schema assertions are generated from inferred metadata.
- **Dependency confidence**: Value-match evidence from a HAR produces at most a "likely" relationship; "confirmed" requires a declared hint or an existing confirming signal, consistent with the constitution's conservative dependency rule.
- **Exclusion rules**: Exclusion is rule-based, deterministic and documented (static assets, known analytics and telemetry destinations, preflight, non-HTTP(S), unrelated third-party origins). User-configurable exclusion rules and re-including an excluded entry are out of scope; the operation selection stage remains the user's control over what is generated. This is a recognized risk: an over-eager exclusion rule can hide a real API call, which is why every exclusion is reported with its reason.
- **Origins**: A capture with several first-party origins yields operations per origin, except where the same method and path appear on more than one origin (see Clarifications 2026-10-18 and the Edge Cases). The origin is informational and is never an execution target.
- **Redaction placement**: Redaction happens before data enters the model, so downstream stages (review, AI, artifact generation) cannot leak a secret they never received. Observed examples keep their structure with placeholders substituted for sensitive values.
- **Persistence**: Guided-workflow state stays in-memory and session-scoped as today. No new persistence is introduced, and no raw capture is stored.
- **Postman handling**: A Postman collection uploaded to the guided workflow is identified and redirected, not converted. The standalone collection import is the only path that processes it.
- **Definition format identity**: The definition format identifies itself with a format identifier and a version number; the concrete field names and the machine-readable schema are fixed in the plan's contracts. Only version 1 exists in this feature.
- **Fixtures**: Realistic sample HAR and definition files are created for tests and documentation, contain no real credentials, and need no network access.
- **Dependencies**: Reuses the existing OpenAPI engine, workflow stages, session isolation, analysis-issue presentation, API review stage, design system and standalone Postman collection workflow.
