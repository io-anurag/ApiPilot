# Feature Specification: Deterministic Test Designer

**Feature Branch**: `003-deterministic-test-designer`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "AP-003 — Deterministic Test Designer"

## Clarifications

### Session 2026-08-27

- Q: Should missing/null/empty-value and invalid-type scenarios be generated recursively for required fields nested inside object-typed request body properties, or only for top-level request fields? → A: Recursive — every required field at any nesting depth inside the request body gets these scenarios.
- Q: Should fields with a declared string format (e.g., email, uuid, date-time) or pattern (regex) constraint get a dedicated invalid-format scenario, in addition to the general invalid-type scenario? → A: Yes — a dedicated invalid-format/invalid-pattern scenario is generated for any field with a declared format or pattern constraint.
- Q: Should required path/query/header parameters receive the same full set of scenarios as request body fields, or a reduced set appropriate to how parameters actually behave? → A: Reduced, location-appropriate set — path parameters get invalid-type/invalid-enum/boundary only (no missing/null/empty, since a missing path segment is a routing concern); query/header parameters get the full set including missing-value scenarios.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a Baseline Test Suite from an Analyzed Specification (Priority: P1)

As a QA engineer, I want ApiPilot to automatically generate a baseline set of test
scenarios for every discovered API operation as soon as a specification has been analyzed,
so that I have meaningful test coverage before writing a single test by hand.

**Why this priority**: This is the entry point of test intelligence
(`ApiModel → TestModel`). Nothing downstream — AI enhancement, review, dependency
analysis, or artifact generation — has anything to operate on until a baseline suite
exists.

**Independent Test**: Can be fully tested by analyzing a specification with known
operations and schema constraints, then confirming a positive scenario and the applicable
negative/boundary scenarios are generated for each operation, independent of any AI or
review feature.

**Acceptance Scenarios**:

1. **Given** an analyzed specification with a discovered operation, **When** the baseline
   suite is generated, **Then** a positive ("happy path") scenario is produced using
   specification-conformant values for that operation.
2. **Given** an operation with one or more required request body fields, including fields
   nested at any depth inside object-typed properties, **When** the baseline suite is
   generated, **Then** a missing-field scenario, a null-value scenario, and (for
   string/array/object fields) an empty-value scenario are produced for each required
   field.
3. **Given** a field with a declared data type, **When** the baseline suite is generated,
   **Then** an invalid-type scenario is produced for that field using a value of a
   different, incompatible type.
4. **Given** a field with a declared string `format` (e.g., email, uuid, date-time) or
   `pattern` (regex) constraint, **When** the baseline suite is generated, **Then** a
   dedicated invalid-format scenario is produced using a value that violates that
   constraint.
5. **Given** a required path parameter, **When** the baseline suite is generated, **Then**
   invalid-type, invalid-enum, and boundary scenarios are produced for it, but no
   missing-field, null-value, or empty-value scenario is produced, since a missing path
   segment is a routing concern rather than a payload validation concern.
6. **Given** a required query or header parameter, **When** the baseline suite is
   generated, **Then** it receives the full set of applicable scenarios (missing, null,
   empty where applicable, invalid-type, invalid-enum, boundary), the same as a required
   request body field.
7. **Given** a field with a declared enum constraint, **When** the baseline suite is
   generated, **Then** an invalid-enum scenario is produced using a value outside the
   declared enum set.
8. **Given** a numeric field with declared minimum/maximum constraints, **When** the
   baseline suite is generated, **Then** below-minimum, at-minimum, at-maximum, and
   above-maximum boundary scenarios are produced for that field.
9. **Given** a string field with declared minLength/maxLength constraints, **When** the
   baseline suite is generated, **Then** below-minLength, at-minLength, at-maxLength, and
   above-maxLength boundary scenarios are produced for that field.
10. **Given** an array field with declared minItems/maxItems constraints, **When** the
    baseline suite is generated, **Then** below-minItems, at-minItems, at-maxItems, and
    above-maxItems boundary scenarios are produced for that field.

---

### User Story 2 - Understand Why Each Scenario Was Generated (Priority: P2)

As a QA engineer, I want every generated scenario to clearly state which deterministic rule
produced it and which response is expected, so that I can trust and verify the baseline
suite instead of treating it as a black box.

**Why this priority**: Trust in the generated `TestModel` is what makes every downstream
feature (AI enhancement, review, artifact generation) credible. Once scenarios exist
(P1), a QA engineer must be able to see their origin and expected outcome.

**Independent Test**: Can be tested independently by inspecting any generated scenario and
confirming it displays its category (e.g., "required-field-missing",
"numeric-boundary-above-maximum"), the operation it belongs to, and the expected
assertions, without needing AI-enhanced or reviewed scenarios to exist.

**Acceptance Scenarios**:

1. **Given** any generated scenario, **When** a QA engineer inspects it, **Then** its
   scenario category and the specification rule that produced it are shown.
2. **Given** a generated scenario, **When** a QA engineer inspects its expected outcome,
   **Then** the expected status code and, where applicable, the expected response schema
   conformance are shown as deterministic assertions.
3. **Given** a scenario whose category expects a specification-documented status code
   (e.g., a positive scenario expecting a documented success response), **When** the
   assertion is generated, **Then** it references only status codes and schemas present in
   the `ApiModel` for that operation.

---

### User Story 3 - Receive a Clean, Non-Redundant Baseline Suite (Priority: P3)

As a QA engineer, I want the generated baseline suite to avoid duplicate or redundant
scenarios, so that reviewing and maintaining the suite stays manageable as specifications
grow larger.

**Why this priority**: Once scenarios are generated (P1) and explainable (P2), the
remaining risk is that overlapping deterministic rules produce noisy duplicate scenarios
that erode confidence in the suite without adding coverage.

**Independent Test**: Can be tested independently by analyzing a specification where two
or more deterministic rules would otherwise produce an identical request/assertion
combination for the same operation, and confirming only one representative scenario is
retained in the generated suite.

**Acceptance Scenarios**:

1. **Given** two deterministic rules that would generate scenarios with an identical
   request and identical expected assertions for the same operation, **When** the baseline
   suite is generated, **Then** only one scenario is retained for that combination.
2. **Given** a deduplicated scenario, **When** a QA engineer inspects it, **Then** it
   remains traceable to at least one of the deterministic rules that produced it.

---

### Edge Cases

- What happens when an operation has no request body (e.g., a simple `GET`)? The system
  must still generate a positive scenario and any applicable parameter-based negative
  scenarios, without fabricating a request body.
- What happens when an operation has no required fields at all? No missing-field,
  null-value, or empty-value scenarios are generated for that operation; a positive
  scenario is still generated.
- What happens when a field has an enum with only a single allowed value? An invalid-enum
  scenario is still generated using any value outside that single-value set.
- What happens when a numeric, string, or array field has no declared min/max, length, or
  item-count constraints? No boundary scenarios are generated for that field, since the
  specification provides no basis for one.
- What happens when a field's minimum and maximum constraints are equal (e.g.,
  `minLength == maxLength`)? The boundary logic must produce a well-defined, non-duplicated
  set of scenarios rather than generating nonsensical or repeated cases.
- How does the system handle an operation whose only documented responses are error
  status codes (no documented success response)? The positive scenario's expected
  assertion must reflect the documented response(s) rather than assuming a `200`.
- What happens when a specification contains an unresolved or unsupported construct
  (as flagged by the OpenAPI Specification Engine) for a given operation? The system must
  skip deterministic generation for the unresolved portion and report it rather than
  silently fabricating a scenario.
- What happens when a required field is nested several levels deep inside optional parent
  objects? The required field still receives its full scenario set; the nesting depth
  does not exempt it from coverage.
- What happens when a field has both a `pattern`/`format` constraint and an `enum`
  constraint? Both an invalid-format scenario and an invalid-enum scenario are generated,
  since they represent distinct violations of distinct declared constraints.
- What happens when a required path parameter also declares an enum or boundary
  constraint? It still receives invalid-type, invalid-enum, and boundary scenarios; only
  missing/null/empty-value scenarios are withheld for path parameters.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST generate a positive ("happy path") test scenario for every
  discovered API operation in the `ApiModel`, using specification-conformant values.
- **FR-002**: For every required request body field — including required fields nested at
  any depth inside object-typed properties — and for every required query or header
  parameter, the system MUST generate a missing-field scenario and a null-value scenario,
  and, for string/array/object-typed fields, an empty-value scenario.
- **FR-003**: For every field or parameter (path, query, header, or request body,
  including body fields nested at any depth) with a declared data type, the system MUST
  generate an invalid-type scenario using a value of an incompatible type.
- **FR-004**: For every field or parameter with a declared enum constraint, the system
  MUST generate an invalid-enum scenario using a value outside the declared enum set.
- **FR-005**: For every numeric field or parameter with declared minimum and/or maximum
  constraints, the system MUST generate below-minimum, at-minimum, at-maximum, and
  above-maximum boundary scenarios.
- **FR-006**: For every string field or parameter with declared minLength and/or
  maxLength constraints, the system MUST generate below-minLength, at-minLength,
  at-maxLength, and above-maxLength boundary scenarios.
- **FR-007**: For every array field with declared minItems and/or maxItems constraints,
  the system MUST generate below-minItems, at-minItems, at-maxItems, and above-maxItems
  boundary scenarios.
- **FR-008**: For every field or parameter with a declared string `format` (e.g., email,
  uuid, date-time) or `pattern` (regex) constraint, the system MUST generate a dedicated
  invalid-format scenario using a value that violates that constraint, distinct from the
  general invalid-type scenario.
- **FR-009**: For required path parameters, the system MUST NOT generate missing-field,
  null-value, or empty-value scenarios, since a missing path segment is a routing concern
  rather than a payload validation concern; path parameters still receive applicable
  invalid-type, invalid-enum, invalid-format, and boundary scenarios.
- **FR-010**: The system MUST generate deterministic response assertions for every
  scenario, based only on status codes and response schemas documented in the `ApiModel`
  for that operation.
- **FR-011**: The system MUST generate schema-based assertions verifying that an expected
  successful response conforms to its declared response schema.
- **FR-012**: The system MUST deduplicate generated scenarios that share an identical
  request and identical expected assertions within the same operation, retaining exactly
  one representative scenario.
- **FR-013**: Every generated scenario MUST carry deterministic provenance identifying the
  rule/category that produced it (e.g., "required-field-missing",
  "numeric-boundary-above-maximum").
- **FR-014**: The system MUST NOT invoke AI/LLM inference to generate, select, or modify
  any scenario in this feature.
- **FR-015**: The system MUST NOT generate a scenario category for a field or operation
  when the specification provides no basis for it (e.g., no boundary scenario without a
  declared min/max constraint).
- **FR-016**: Users MUST be able to view the generated baseline test suite for an analyzed
  specification, organized by operation and scenario category.
- **FR-017**: The system MUST produce the generated baseline suite as a
  framework-independent `TestModel`, structurally ready for later enhancement or artifact
  generation without depending on any specific test-execution framework.
- **FR-018**: When a specification operation contains an unresolved or unsupported
  construct, the system MUST skip deterministic scenario generation for that construct and
  report it rather than fabricating a scenario.

### Key Entities *(include if feature involves data)*

- **TestModel**: The framework-independent collection of generated test scenarios for an
  analyzed specification, organized by operation.
- **Test Scenario**: A single deterministic test case tied to an operation, a scenario
  category, a generated request, expected assertions, and provenance.
- **Scenario Category**: The classification of a scenario's intent (e.g., positive,
  missing-field, null-value, empty-value, invalid-type, invalid-format, invalid-enum,
  numeric-boundary, string-boundary, array-boundary).
- **Assertion**: An expected, deterministic response condition (status code and/or schema
  conformance) attached to a test scenario.
- **Provenance**: The record identifying which deterministic rule produced a given
  scenario, distinguishing it from any future AI-derived or user-defined scenario.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A baseline test suite is generated for a typical analyzed specification (on
  the order of 50-100 operations) in under 30 seconds.
- **SC-002**: 100% of required request body fields (at any nesting depth) and required
  query/header parameters in a well-formed specification receive their applicable
  missing-field, null-value, and empty-value scenarios.
- **SC-003**: 100% of fields or parameters with declared numeric, string-length,
  array-size, enum, format, or pattern constraints receive their applicable boundary,
  invalid-enum, or invalid-format scenarios.
- **SC-004**: Zero duplicate scenarios (identical request and expected assertions within
  the same operation) appear in a generated baseline suite.
- **SC-005**: 100% of generated scenarios carry an identifiable deterministic rule
  provenance, with zero scenarios of unknown origin.
- **SC-006**: Zero generated scenarios reference an endpoint, parameter, field, or status
  code that is not present in the source `ApiModel`.

## Assumptions

- This feature consumes the `ApiModel` produced by the OpenAPI Specification Engine; it
  does not re-parse, re-validate, or attempt to resolve specification ambiguities itself.
- Deduplication of equivalent scenarios is scoped per operation, not across the entire
  suite, since identical-looking requests on different operations represent distinct test
  intents.
- Synthetic values used for invalid-type, invalid-enum, and boundary scenarios are
  produced deterministically from the field's declared schema (type, format, constraints),
  following common QA test-data conventions, and are not derived from AI inference.
- The generated baseline suite is not yet an approved or executable artifact; approval and
  Postman/other artifact generation are covered by later features (Test Scenario Review,
  Postman Collection Generator).
- Semantic/business-rule test scenarios beyond deterministic specification-derived rules
  are explicitly out of scope for this feature and are covered by the later AI Test
  Scenario Designer feature.
- No user authentication or multi-tenancy is required at this stage, consistent with the
  single local user assumption established by the Application Foundation feature.
