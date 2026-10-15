# Feature Specification: AI Test Scenario Designer

**Feature Branch**: `005-ai-test-scenario-designer`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "AP-005 — AI Test Scenario Designer"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Enrich Deterministic Coverage With Semantic Scenarios (Priority: P1)

As a QA engineer, I want ApiPilot to suggest meaningful scenarios that are difficult to
derive from schemas alone, so I can identify semantic and business-oriented risks without
manually inventing every test idea.

**Why this priority**: Semantic coverage is the primary value of this feature. It extends
the deterministic baseline while preserving the existing test-design foundation.

**Independent Test**: Provide an analyzed API model and its deterministic test model to the
designer, then verify that returned suggestions target existing operations and add useful
coverage that is not already represented by equivalent deterministic scenarios.

**Acceptance Scenarios**:

1. **Given** an analyzed API model and deterministic test model, **When** semantic design is
   requested, **Then** the system returns zero or more structured scenario candidates linked
   to existing API operations.
2. **Given** an operation whose contract and description indicate a meaningful semantic risk,
   **When** the designer evaluates it, **Then** it may propose a negative scenario or edge
   case that explains the risk and identifies the relevant operation or input.
3. **Given** an API model with no defensible semantic opportunities, **When** design is
   requested, **Then** the system returns no executable AI scenario rather than fabricating
   coverage.

### User Story 2 - Understand and Trust AI Suggestions (Priority: P2)

As a QA engineer, I want each AI-generated scenario to show why it was suggested and how
confident the system is, so I can distinguish inference from contract facts and decide
whether the scenario is useful.

**Why this priority**: AI suggestions are only useful when their limits and origins are
visible. Explainability also enables the later human review experience.

**Independent Test**: Inspect every accepted AI candidate from a representative request and
verify that its provenance identifies AI generation, its rationale describes the semantic
reason, and its confidence is present within the defined range.

**Acceptance Scenarios**:

1. **Given** a valid AI-generated scenario candidate, **When** it is returned, **Then** it
   includes AI provenance, confidence, rationale, and any assumptions or uncertainty that
   materially affect its interpretation.
2. **Given** an AI suggestion references information not established by the API model,
   **When** the suggestion is presented, **Then** the unsupported information is explicitly
   identified as an inference and the suggestion is not treated as specification truth.
3. **Given** a candidate has insufficient confidence or explanation, **When** validation is
   applied, **Then** it is surfaced as a non-executable suggestion or rejected according to
   the validation outcome.

### User Story 3 - Preserve a Clean, Non-Duplicative Test Model (Priority: P3)

As a QA engineer, I want AI suggestions merged with deterministic scenarios without
duplicating equivalent tests, so the resulting suite increases useful coverage without
becoming noisy or expensive to review.

**Why this priority**: The feature enhances an existing deterministic suite; it must not
undermine the quality and reproducibility of that baseline.

**Independent Test**: Supply deterministic scenarios and AI candidates containing exact and
semantic duplicates, then verify that equivalent executable scenarios appear once and their
origins remain traceable.

**Acceptance Scenarios**:

1. **Given** an AI candidate is equivalent to an existing deterministic scenario, **When**
   the enhanced test model is assembled, **Then** no duplicate executable scenario is added
   and the retained scenario preserves the contributing provenance.
2. **Given** two AI candidates are equivalent, **When** they are merged, **Then** one
   representative is retained with the contributing AI provenance or source details preserved.
3. **Given** an AI candidate cannot be mapped to an existing operation, parameter, schema,
   or supported test intent, **When** the enhanced model is assembled, **Then** it cannot
   enter the executable scenario set and its rejection or non-executable status is visible.

### User Story 4 - Continue Using the Feature When AI Is Unavailable (Priority: P4)

As a QA engineer, I want deterministic scenarios to remain available when the configured AI
provider is unavailable or returns invalid output, so an AI outage does not prevent me from
using the trustworthy baseline test suite.

**Why this priority**: AI is an enhancement, not a prerequisite for deterministic API test
design. Explicit degradation protects reliability and user trust.

**Independent Test**: Run enhancement with an unavailable provider, a timeout, and malformed
output, and verify that the deterministic test model remains intact while the AI failure is
reported explicitly.

**Acceptance Scenarios**:

1. **Given** the AI provider is unavailable, **When** enhancement is requested, **Then** the
   deterministic scenarios are returned unchanged and an actionable AI-unavailable outcome
   is reported.
2. **Given** the provider returns malformed or semantically invalid output, **When** the
   response is processed, **Then** invalid candidates are rejected or marked non-executable,
   the deterministic scenarios remain available, and the failure category is distinguishable.
3. **Given** a valid provider response contains no additional relevant scenarios, **When**
   enhancement completes, **Then** the deterministic test model is returned without adding
   trivial or unsupported scenarios.

### Edge Cases

- The API model contains operations with sparse descriptions or no examples; the system
  returns only candidates supported by available evidence and may return none.
- An AI response proposes a new endpoint, HTTP method, request field, response field, or
  status code; the candidate is rejected or marked non-executable and is never promoted to
  contract information.
- A candidate references an existing field but proposes an unsupported value, format, or
  relationship; semantic validation identifies the mismatch before model assembly.
- A candidate has a confidence value outside the allowed range, missing rationale, malformed
  provenance, or an unrecognized scenario category; it is invalid and cannot be executable.
- The deterministic model already covers a proposed semantic risk; deduplication retains one
  scenario and preserves its relevant origins.
- The provider returns a partial response, times out, or fails after producing some output;
  no unvalidated partial candidate becomes executable.
- The same valid input is enhanced repeatedly; deterministic processing and request
  construction produce stable merging and deduplication behavior, while model variability
  remains visible as AI inference.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST accept an analyzed ApiModel and its deterministic TestModel as the
  input boundary for AI scenario enhancement.
- **FR-002**: System MUST request semantic negative scenarios, business-rule candidates,
  meaningful edge cases, or semantic coverage gaps only through the AIProvider abstraction.
- **FR-003**: System MUST treat the deterministic TestModel as the baseline and MUST add AI
  candidates only as validated enhancements; it MUST NOT regenerate or replace the baseline
  suite through AI.
- **FR-004**: System MUST represent each AI candidate with a structured scenario intent that
  identifies its target operation and supported request, response, or assertion information.
- **FR-005**: System MUST include AI provenance for every AI-generated candidate and preserve
  the candidate's rationale, confidence, source context, and material assumptions when those
  values are available.
- **FR-006**: System MUST validate AI output against the expected structured response
  contract before attempting to add any candidate to the TestModel.
- **FR-007**: System MUST validate each candidate against the ApiModel and deterministic
  TestModel, rejecting or clearly marking non-executable any candidate that references an
  unknown operation, method, parameter, request field, response field, schema, or unsupported
  contract value.
- **FR-008**: System MUST NOT promote AI-inferred information to specification-derived
  information and MUST keep AI provenance distinguishable from specification and rule
  provenance.
- **FR-009**: System MUST NOT allow an AI candidate to invent an endpoint, HTTP method,
  parameter, request field, response field, authentication mechanism, or status code as an
  executable contract fact.
- **FR-010**: System MUST deduplicate AI candidates against deterministic scenarios and
  against one another using stable scenario identity and request/assertion equivalence, while
  preserving contributing provenance where duplicates are merged.
- **FR-011**: System MUST exclude trivial, unsupported, malformed, irrelevant, or insufficiently
  explained candidates from the executable scenario set and MUST expose the reason for
  rejection or non-executable status.
- **FR-012**: System MUST return an enhanced TestModel that retains all valid deterministic
  scenarios and includes only candidates that pass structural and semantic validation.
- **FR-013**: System MUST preserve deterministic ordering and repeatable merging behavior for
  identical input and equivalent validated AI output.
- **FR-014**: System MUST expose confidence using a documented, bounded representation and
  MUST reject or flag confidence values that are missing, malformed, or outside that bound.
- **FR-015**: System MUST preserve the deterministic TestModel and report a structured,
  actionable outcome when the AI provider is unavailable, times out, or returns invalid
  output.
- **FR-016**: System MUST provide a structured enhancement result that distinguishes added,
  deduplicated, rejected, and non-executable AI candidates without exposing sensitive prompt
  or specification content unnecessarily.
- **FR-017**: System MUST remain independent of a particular AI provider, model, or inference
  runtime; scenario-design logic may depend only on the AIProvider contract and domain
  contracts.
- **FR-018**: System MUST NOT authorize execution, approval, or artifact generation solely
  because an AI candidate passed validation; downstream review and approval policy remains
  responsible for execution eligibility.

### Key Entities

- **Scenario Enhancement Request**: The analyzed ApiModel, deterministic TestModel, and
  bounded context supplied for identifying semantic coverage opportunities.
- **AI Scenario Candidate**: A structured, AI-inferred test intent targeting an existing API
  operation, including category, inputs or assertions, rationale, confidence, assumptions,
  and AI provenance.
- **Validation Finding**: A structured result explaining whether a candidate is valid,
  rejected, or non-executable and identifying the failed contract or semantic check.
- **Enhanced TestModel**: The deterministic TestModel plus validated, non-duplicative AI
  scenarios, with origins and statuses preserved.
- **Enhancement Result**: The outcome of one enhancement request, including retained,
  added, deduplicated, rejected, and non-executable candidates and any provider failure.
- **AI Provenance**: Traceability information identifying AI as the origin and recording the
  model/provider identity, rationale, confidence, and relevant source context.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In a representative evaluation set, at least 90% of AI candidates that enter
  the executable enhanced TestModel reference only operations and contract elements present
  in the ApiModel.
- **SC-002**: In a representative evaluation set containing known duplicate cases, 100% of
  equivalent AI and deterministic scenarios are represented by one executable scenario while
  all contributing origins remain traceable.
- **SC-003**: Across 100% of tested provider failures and invalid-response cases, the
  deterministic baseline remains available and the user receives a distinguishable outcome
  that explains whether the provider was unavailable, timed out, malformed, or semantically
  invalid.
- **SC-004**: 100% of executable AI scenarios in evaluation results contain AI provenance,
  rationale, and a confidence value within the documented range.
- **SC-005**: In a review by QA engineers using representative outputs, at least 90% can
  correctly distinguish AI-derived scenarios from specification-derived and rule-derived
  scenarios without inspecting source code.
- **SC-006**: For identical input and equivalent validated provider output, repeated
  enhancement produces the same executable scenario identities, ordering, and deduplication
  result.
- **SC-007**: AI enhancement does not prevent a QA engineer from obtaining the deterministic
  baseline in under 5 seconds after an AI provider failure is reported.

## Assumptions

- AP-002 provides a validated, normalized ApiModel with enough operation, parameter, schema,
  response, and example information for semantic validation.
- AP-003 provides a valid deterministic TestModel and established scenario identity,
  assertion, provenance, and deduplication concepts that this feature extends.
- AP-004 provides the AIProvider abstraction, structured inference transport, provider
  readiness states, timeout behavior, and deterministic mock provider for automated tests.
- AI enhancement is requested for one analyzed API model and its deterministic TestModel at a
  time; cross-specification semantic reasoning is outside this feature.
- Confidence is a bounded numeric value and the exact calibration method is established during
  planning and evaluation; confidence is an inference signal, not a guarantee of correctness.
- AI-generated scenarios may be shown as non-executable suggestions for later review, but
  only validated candidates in the enhanced TestModel may proceed to downstream approval.
- Human review workflows, approval state transitions, API dependency workflows, Postman
  generation, and test execution are outside this feature and belong to later roadmap items.
- Prompt wording, model choice, output schema version, and evaluation corpus are versioned
  engineering assets defined during planning and must remain traceable.

## Amendments

### 2026-10-14: one requested candidate per operation, and omitted empty request maps (specs/013 T072)

Measured on six operations (`ap013-enhancement-v2`), the prompt that let the model answer
`{"candidates":[]}` produced no usable candidate from either model tried: Qwen2.5-0.5B answered empty or
echoed the prompt, and Qwen3-1.7B answered empty for every operation. Prompt contract version 4 therefore
asks for exactly one candidate per operation and states that an empty list is not an answer, lists the
targets and status codes the operation allows, and shows a worked example whose status code the operation
documents. Qwen3-1.7B then produced a usable candidate for 5 of 6 operations.

- **US1 acceptance scenario 3 is amended, not removed.** The system still accepts an empty or fully
  rejected reply without error and adds no AI scenario for it, and every candidate is still validated
  (FR-006, FR-007, FR-009), deduplicated against the deterministic baseline (FR-010) and left `pending`
  for review (FR-018). What changes is the request: the model is no longer invited to decline, so it may
  now propose a low-value scenario for an operation that is already well covered. Review is the control
  for that, and it is a deliberate trade for a feature that otherwise produced nothing.
- **Candidate contract.** `request.pathParameters`, `request.queryParameters` and `request.headers` may be
  omitted or `null`; an omitted map is read as `{}`. A map that is present but not an object is still
  `invalid-shape`, and a candidate with no `request` object is still rejected. No other field is repaired.
- FR-007, FR-009 and FR-014 are unchanged.

### 2026-10-15: operations with no inputs, regeneration wording, and an invented request body (specs/013 T071 follow-up)

- **Operations with no parameters and no request body.** Prompt version 5 no longer gives such an
  operation an empty `allowedTargets` list and an instruction to pick from it (the model had nothing it was
  permitted to aim at and returned no candidate). It is told to leave out `targetLocation` and
  `targetField`, and its worked example carries the operation's own path and method and no target. A
  candidate with no target was always valid and still is.
- **Regeneration asks for a replacement.** A request to regenerate a scenario (specs/006) now says
  "replacement ... different from the one in existingCoverage" instead of "one more ... prefer something not
  already covered". Enhancement wording is unchanged.
- **FR-009 is enforced for request bodies.** A candidate that sends content in `request.body` for an
  operation that declares no request body is rejected as `field-not-found` (`request.body`). An absent,
  null or empty-object body is accepted, because that is what a candidate with nothing to send looks like.
  Previously an invented body for such an operation passed validation.

### 2026-10-15: an undocumented status code removes the assertion, not the candidate (FR-007, FR-009, FR-016)

A candidate whose request is valid but whose assertion names a status code the operation does not
document used to be reported `nonExecutable` as a whole (`undocumented-status-code`), discarding a usable
request because of one guessed value. The candidate is now kept and only the unsupported assertion is
removed. This changes what is done with the candidate, not what is allowed to become a contract fact:
FR-009 still forbids an AI-invented status code from becoming an executable fact, and removal is how that
is enforced here.

- **What is stripped.** An assertion whose `expectedStatusCode` is not among the operation's documented
  response codes is removed from the candidate, whatever its type. A `schema-conformance` assertion carried
  on that same undocumented code is removed with it, because there is no documented response to ground it
  in. The remaining assertions are validated exactly as before and keep their order.
- **What is not stripped.** An assertion on a documented status code whose `expectedSchema` does not match
  that response's documented schema is not repaired: the candidate is still `nonExecutable` with
  `schema-not-found`. A schema mismatch under a documented code is a stronger sign that the model
  invented contract content than a wrong status code is. All other findings (`operation-not-found`,
  `method-not-found`, `field-not-found`, request-shape and confidence findings) are unchanged, and a
  candidate that has any of them is not kept merely because its assertion was also stripped.
- **No silent mutation.** Each removed assertion is recorded, with its original status code and the reason
  (`undocumented-status-code`), on the added candidate in the enhancement result and on the scenario's AI
  provenance, so a reviewer can see what the model proposed and what was removed. The AI's `rationale` is
  kept verbatim as AI-inferred text and may still mention the removed code; it is never promoted to
  specification information (FR-008).
- **Candidate with no assertions left.** A candidate whose assertions were all removed is still kept. An
  empty assertion set is valid when the specification documents no expectation, and it is not padded with a
  fabricated one. It is left `pending` for review (FR-018), which is the control for a weak scenario.
- **Result reporting (FR-016).** Stripping is reported as a distinct, countable signal on `added`
  candidates and not as a fifth outcome: the four existing outcomes keep their meaning. A candidate that
  previously appeared under `nonExecutable` for this finding alone now appears under `added`.
- **Order of operations.** Stripping happens after structural validation and before deduplication, so
  FR-010's request/assertion equivalence is evaluated on the retained assertions. Two candidates that
  differ only in a removed assertion are therefore equivalent and deduplicate; the contributing provenance
  is preserved as before. For identical input and equivalent provider output, the result is identical
  (FR-013).
- **Unchanged.** The deterministic baseline, the prompt contract (the allowed status codes are still
  listed to the model), FR-014 and every other validation rule are unchanged. No provider retry or
  re-prompt is introduced to repair the assertion.

- **Where it applies.** The same stripping applies to a single-scenario regeneration (specs/006): the
  replacement is kept and the removal is recorded on its provenance. The benchmark's "usable reply" check
  uses the same rule, so it measures what the pipeline would keep. `validateAICandidateSemantics` itself
  is unchanged and still reports `undocumented-status-code`; the pipeline strips before calling it.
- **Implemented in version 19.51.0** (`stripUndocumentedStatusAssertions` in
  `backend/src/testDesign/validateAICandidate.ts`; `AIStrippedAssertion` and
  `AIProvenance.aiStrippedAssertions` in `packages/shared-domain/src/testModel.ts`;
  `AIAddedCandidate.strippedAssertions`). `data-model.md`, `contracts/enhanced-test-models-api.md`,
  `docs/architecture.md` and `docs/USER_MANUAL.md` are updated, and the review detail panel lists the
  removed assertions.
