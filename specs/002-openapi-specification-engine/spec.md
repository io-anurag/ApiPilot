# Feature Specification: OpenAPI Specification Engine

**Feature Branch**: `002-openapi-specification-engine`

**Created**: 2026-08-26

**Status**: Draft

**Input**: User description: "AP-002 — OpenAPI Specification Engine"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload and Parse an OpenAPI Specification (Priority: P1)

As a QA engineer, I want to upload an OpenAPI specification file and have it parsed and
validated, so that I know immediately whether ApiPilot understood my API contract before
relying on it for anything else.

**Why this priority**: This is the entry point of the entire ApiPilot pipeline
(`OpenAPI → ApiModel`). No other capability — analysis, test generation, review, or
artifact generation — can function without a specification first being accepted and
understood.

**Independent Test**: Can be fully tested by uploading a valid OpenAPI 3.x YAML file and
confirming it is accepted with an analysis summary, and separately uploading an invalid or
unsupported file and confirming a clear rejection message — independent of any downstream
feature.

**Acceptance Scenarios**:

1. **Given** a well-formed OpenAPI 3.x YAML specification, **When** a QA engineer uploads
   it, **Then** the system accepts it, parses it successfully, and displays an analysis
   summary (e.g., number of operations, schemas, and security schemes found).
2. **Given** a file that is not valid YAML, **When** a QA engineer uploads it, **Then** the
   system rejects it with a clear, specific error identifying that the content could not be
   parsed.
3. **Given** a file that is valid YAML but not a supported OpenAPI version (e.g., Swagger
   2.0 or an unrecognized document type), **When** a QA engineer uploads it, **Then** the
   system rejects it with a clear message stating the version/format is unsupported.
4. **Given** a file larger than the documented maximum size, **When** a QA engineer
   attempts to upload it, **Then** the system rejects it before processing and states the
   size limit.

---

### User Story 2 - Review Discovered APIs and Extracted Details (Priority: P2)

As a QA engineer, I want to see every API operation the system discovered, along with its
parameters, request/response schemas, and security requirements, so that I can verify
ApiPilot correctly understood my API before it is used to design tests.

**Why this priority**: Trust in the extracted `ApiModel` is what makes every downstream
feature (deterministic test design, AI enhancement, artifact generation) credible. A QA
engineer must be able to confirm the extraction is accurate.

**Independent Test**: Can be tested independently by uploading a specification with known
operations and confirming every discovered operation, parameter, schema, and security
requirement shown on screen matches the source specification exactly.

**Acceptance Scenarios**:

1. **Given** a successfully parsed specification, **When** the QA engineer views the
   discovered APIs, **Then** every path + HTTP method combination defined in the
   specification is listed.
2. **Given** a specific discovered operation, **When** the QA engineer opens its details,
   **Then** its parameters (path, query, header, cookie), request body schema, and
   documented response status codes/schemas are shown exactly as defined in the
   specification.
3. **Given** an operation with a declared security requirement, **When** the QA engineer
   views its details, **Then** the required security scheme(s) are shown.
4. **Given** a schema field with constraints (e.g., required, enum, min/max, pattern),
   **When** the QA engineer views that field, **Then** the constraints shown match the
   specification exactly, with no invented values.

---

### User Story 3 - Understand Specification Ambiguities and Unsupported Constructs (Priority: P3)

As a QA engineer, I want the system to clearly flag any part of my specification it could
not fully resolve or understand, so that I never mistake a silent gap for complete
coverage.

**Why this priority**: Builds essential trust and transparency once the core parsing (P1)
and review (P2) experiences exist; a specification that mostly works but has one
unresolved reference must never look "fully understood."

**Independent Test**: Can be tested independently by uploading a specification containing
a deliberately unresolved `$ref`, a circular reference, or an unsupported OpenAPI
construct, and confirming the analysis summary explicitly calls it out rather than omitting
it silently.

**Acceptance Scenarios**:

1. **Given** a specification containing a `$ref` that cannot be resolved within the
   document, **When** it is analyzed, **Then** the analysis summary explicitly lists the
   unresolved reference and its location.
2. **Given** a specification containing a circular `$ref` chain, **When** it is analyzed,
   **Then** the system detects the cycle, does not hang or crash, and reports it clearly.
3. **Given** a specification containing an OpenAPI construct the engine does not support,
   **When** it is analyzed, **Then** the construct is explicitly listed as unsupported
   rather than silently dropped.

---

### Edge Cases

- What happens when the uploaded file has a valid file extension but corrupted or
  non-YAML content? The system must reject it with a parsing error, not a generic failure.
- What happens when the specification is technically valid OpenAPI 3.x but declares zero
  operations? The system should accept it and report an analysis summary showing zero
  discovered operations, not treat it as an error.
- How does the system handle duplicate `operationId` values or duplicate path+method
  combinations in the same specification? It must report the duplication rather than
  silently keeping only one.
- What happens when a `$ref` points outside the uploaded document (e.g., another file or a
  URL)? The system must report it as unresolved rather than attempting a network fetch or
  silently ignoring it.
- What happens when a specification has no security schemes at all? The system should
  treat this as a valid, fully public API and report it as such, not as an error.
- How does the system handle an upload while a previous upload from the same session is
  still being analyzed? It should either queue or clearly reject the concurrent upload
  rather than corrupting either analysis.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a user to upload an OpenAPI specification file in
  YAML format.
- **FR-002**: The system MUST parse uploaded YAML content into a structured document
  before any further processing.
- **FR-003**: The system MUST validate that an uploaded document conforms to the OpenAPI
  3.x specification format.
- **FR-004**: The system MUST reject specifications that are not valid YAML, or that are
  not a supported OpenAPI version, with a clear and specific error message rather than a
  generic failure.
- **FR-005**: The system MUST resolve internal (same-document) `$ref` references into
  their fully resolved definitions.
- **FR-006**: The system MUST detect unresolved or circular `$ref` references and report
  them explicitly rather than silently failing, guessing, or looping indefinitely.
- **FR-007**: The system MUST discover every API operation (unique path + HTTP method
  combination) defined in an accepted specification.
- **FR-008**: The system MUST extract, for each discovered operation: its parameters
  (path, query, header, cookie), request body schema(s), response schemas per documented
  status code, and declared security requirements.
- **FR-009**: The system MUST extract schema-level constraints (required fields, data
  types, enums, formats, minimum/maximum values, patterns) exactly as defined in the
  specification, without inventing or altering them.
- **FR-010**: The system MUST extract documented examples where present in the
  specification.
- **FR-011**: The system MUST produce a normalized internal representation (`ApiModel`)
  capturing all discovered operations and their extracted details, independent of any
  specific test framework or artifact format.
- **FR-012**: The system MUST produce a human-readable analysis summary after processing,
  including counts of discovered operations, schemas, and security schemes, and any
  unresolved or unsupported constructs found.
- **FR-013**: The system MUST explicitly flag specification constructs it cannot fully
  understand or resolve (e.g., unsupported OpenAPI features, unresolved references) rather
  than silently omitting or guessing at their meaning.
- **FR-014**: The system MUST NOT use AI/LLM inference to derive any part of the
  `ApiModel`; every extracted value MUST be traceable to explicit specification content.
- **FR-015**: The system MUST enforce a documented maximum upload file size and reject
  files exceeding it with a clear error before attempting to parse them.
- **FR-016**: The system MUST NOT execute any code contained in, or referenced by, an
  uploaded specification.
- **FR-017**: Users MUST be able to view the list of discovered operations and drill into
  the extracted details (parameters, request/response schemas, security requirements) for
  any individual operation.

### Key Entities *(include if feature involves data)*

- **ApiModel**: The normalized, framework-independent representation of an entire parsed
  specification — the complete set of discovered operations, schemas, and security
  schemes, plus analysis metadata.
- **API Operation**: A single path + HTTP method combination, with its parameters, request
  body, responses, and security requirements.
- **Parameter**: A named input to an operation (path, query, header, or cookie location),
  with its schema/type and whether it is required.
- **Request Body**: The content type(s) and associated schema(s) accepted by an operation.
- **Response**: A documented status code for an operation, with its description, schema,
  and examples if present.
- **Schema Constraint**: An extracted validation rule for a field (type, required, enum,
  format, min/max, pattern).
- **Security Scheme**: An authentication/authorization mechanism declared by the
  specification (e.g., API key, OAuth2, HTTP bearer) and the operations that require it.
- **Analysis Summary**: Aggregate counts and metadata about a processed specification,
  including any ambiguities or unsupported constructs discovered.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A QA engineer can upload a typical OpenAPI 3.x specification (on the order
  of 50-100 operations) and receive a complete analysis summary in under 30 seconds.
- **SC-002**: 100% of operations, parameters, and response status codes explicitly
  defined in a well-formed OpenAPI 3.x specification are represented in the resulting
  `ApiModel`, with zero omissions.
- **SC-003**: When given a specification containing an invalid or unsupported construct,
  the system surfaces the specific issue and its location in 100% of tested cases, rather
  than succeeding silently.
- **SC-004**: A QA engineer can determine, from the analysis summary alone, whether a
  given specification was fully or only partially understood, without inspecting raw
  output.
- **SC-005**: Zero fabricated endpoints, parameters, or schema fields appear in the
  `ApiModel` for any tested specification — every element traces back to explicit
  specification content.

## Assumptions

- Only OpenAPI 3.x is supported; Swagger 2.0 and other formats are explicitly rejected
  with a clear message, consistent with the product roadmap's "OpenAPI 3.x support" scope.
- Specifications are uploaded as single YAML files; JSON-format OpenAPI documents are out
  of scope for this feature, consistent with the roadmap's "YAML file upload"/"YAML
  parsing" scope.
- Only internal (same-document) `$ref` resolution is required for this feature; resolving
  references that point to external files or URLs is out of scope and is reported as
  unresolved rather than fetched, consistent with avoiding unnecessary external/network
  dependencies.
- A documented maximum upload file size (an initial default on the order of 10 MB) is
  enforced; this may be revisited later without changing this feature's intent.
- This feature covers specification understanding only; generating test scenarios from
  the `ApiModel` is explicitly out of scope and is covered by a later feature (the
  Deterministic Test Designer).
- No user authentication or multi-tenancy is required at this stage, consistent with the
  single local user assumption established by the Application Foundation feature.
- No AI/LLM inference is used anywhere in this feature; all extraction is deterministic,
  consistent with the product's deterministic-before-AI architecture.
