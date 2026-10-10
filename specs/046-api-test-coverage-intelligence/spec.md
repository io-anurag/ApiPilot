# Feature Specification: API Test Coverage Intelligence

**Feature Branch**: `046-api-test-coverage-intelligence`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Implement a new API Test Coverage Intelligence feature in ApiPilot: a measurable, traceable view of how thoroughly an API is covered by generated test scenarios and how much of that coverage has been verified through actual test execution, with two distinct coverage dimensions (specification coverage and runtime-verified coverage), gap prioritization, recommended next tests, filtering, export, and light/dark theme support."

## Overview

QA engineers using ApiPilot can generate test scenarios from an OpenAPI specification and execute them, but today they cannot see, in one place, how much of the API those scenarios actually cover, how much of that has been proven by a real run, or what to test next. This feature adds a **Coverage** view that answers five questions: what is covered by generated tests, what has been executed, what remains untested (response codes, schema branches, parameters, scenario categories), which endpoints have the largest gaps, and what to test next.

Two principles govern every number shown:

1. **Specification coverage** (a qualifying generated scenario exists for a requirement) and **runtime-verified coverage** (an actual execution produced sufficient evidence for it) are always separate, and generation alone never counts as verification.
2. Every figure is computed deterministically from real application data, with its numerator, denominator and basis retained. No AI is involved in any count, percentage or verification status, and no demo data is ever substituted.

## Clarifications

### Session 2026-10-10

- Q: Where should Coverage appear, given the described "Results" navigation group? → A: Resolved as an assumption (see Assumptions): Coverage is added to the application's existing post-run results area following its current navigation conventions; no new top-level category is introduced.
- Q: Should a generated scenario still awaiting human review count toward specification coverage? → A: Yes. Pending and accepted scenarios count; rejected scenarios never count; the accepted/pending split is shown beside each specification-coverage figure.
- Q: When a request edited before a run is executed, how should its scenario count for runtime verification? → A: Inconclusive. The run is shown as evidence, but nothing it exercised counts as verified.
- Q: After a changed specification is uploaded, is earlier execution evidence stale for the whole specification or per operation? → A: Whole specification. Earlier results are not attributable to the regenerated scenarios, so all of it is stale; no per-operation carry-over.
- Q: When only some operations were selected for generation, what forms the coverage denominator? → A: The selected operations only. Unselected operations are listed separately as out of scope and are not counted as gaps.
- Q: Should filters, sort order and selected run survive a full browser refresh? → A: No. They reset on refresh and are retained while switching tabs within the session; no URL or local-storage state is added.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See specification coverage for a generated test suite (Priority: P1)

A QA engineer who has generated scenarios for a specification opens the Coverage view and sees, per operation and per contract element, whether at least one qualifying generated scenario exists, with counts and percentages, and a clear list of what is not covered.

**Why this priority**: This is the core value and the minimum viable slice. It works with no execution data at all and already answers questions 1, 3 and 4.

**Independent Test**: Load a specification with several operations, generate scenarios for only some of them, open Coverage, and confirm that covered operations, parameters and response codes match the generated scenarios and the remainder is listed as not covered.

**Acceptance Scenarios**:

1. **Given** a specification has been uploaded and no scenarios generated, **When** the user opens Coverage, **Then** specification coverage shows 0 of N for every dimension that has eligible items, the missing items are listed, a link to scenario generation is offered, and no runtime-verification figures are shown as achieved.
2. **Given** scenarios exist for an operation, **When** Coverage is calculated, **Then** that operation counts as covered, and a documented parameter counts as covered only if a scenario deliberately exercises that parameter (not merely because its endpoint has a scenario).
3. **Given** ten scenarios target the same query parameter, **When** coverage is calculated, **Then** that parameter counts once, not ten times.
4. **Given** one path declares both GET and DELETE, **When** coverage is calculated, **Then** they are two separate operations with independent coverage.

---

### User Story 2 - Distinguish generated, executed, failed, verified, inconclusive and stale (Priority: P1)

After running tests, the engineer sees for each requirement which of six states it is in, and can tell a failing test apart from a missing one.

**Why this priority**: The distinction between "generated" and "verified" is the reason this feature exists; without it the view would overstate quality.

**Independent Test**: Generate scenarios, execute a subset with a mix of passing and failing results, and confirm the states in Coverage match the evidence for each requirement.

**Acceptance Scenarios**:

1. **Given** scenarios are generated but never executed, **When** the user views Coverage, **Then** runtime verification shows nothing achieved, and affected requirements are labeled "Generated, not executed".
2. **Given** a scenario executed and all its evaluated checks passed, **When** Coverage is calculated, **Then** the requirement it targets is "Verified".
3. **Given** a scenario executed and failed, **When** Coverage is calculated, **Then** the requirement is "Executed, failed", is counted separately from missing coverage, is not counted as verified, and links to the failing result.
4. **Given** a run received a response but evaluated no check relevant to a requirement (for example, no response-schema assertion), **When** Coverage is calculated, **Then** that requirement is "Inconclusive", not "Verified".
5. **Given** a scenario was not attempted because an earlier dependency failed, **When** Coverage is calculated, **Then** it is not counted as executed evidence.

---

### User Story 3 - Find and prioritize the biggest gaps (Priority: P2)

The engineer reviews a sortable, filterable table of operations with specification and runtime figures, missing items and a priority, and filters it to focus on what matters.

**Why this priority**: Turns the numbers into a work queue; valuable once P1 stories exist.

**Independent Test**: With a mixed dataset, filter by HTTP method, coverage state and priority, sort by priority, and confirm rows, summary values and counts update consistently.

**Acceptance Scenarios**:

1. **Given** Coverage data is loaded, **When** the user filters by method, endpoint text, coverage state, scenario category, priority, or "missing" versus "failed", **Then** the table shows only matching operations and the visible summary values reflect the filtered set.
2. **Given** two operations with equal gaps where one is destructive and unverified, **When** priorities are assigned, **Then** the destructive, unverified one ranks higher and the ranking rationale is shown.
3. **Given** a single underlying gap (for example one unverified documented 404), **When** priorities are assigned, **Then** it is reported once and not as several independent high-priority issues.
4. **Given** a row, **When** the user selects an action, **Then** they navigate to the operation detail or the related scenario or result, with specification and run context preserved.

---

### User Story 4 - Get ranked recommendations for what to test next (Priority: P2)

The engineer sees an ordered list of missing or unverified coverage items, each stating the operation, the uncovered requirement, why it is a gap, the supporting evidence, the priority with its rationale, and an action.

**Why this priority**: Answers question 5 and makes the view actionable.

**Independent Test**: With known gaps, confirm each recommendation traces to a specific requirement and evidence, and that ordering follows the documented prioritization rules.

**Acceptance Scenarios**:

1. **Given** documented responses lacking scenarios or verification, **When** recommendations are produced, **Then** each lists operation, requirement, reason, evidence, priority, rationale and a review/generate action.
2. **Given** identical input, **When** recommendations are produced twice, **Then** the order and content are identical.

---

### User Story 5 - Specification changes and repeated runs stay honest (Priority: P2)

When the specification changes, coverage is recalculated for the new revision and evidence from the old revision is marked stale rather than silently carried over. When a scenario is run several times, it is not double-counted.

**Why this priority**: Prevents misleading verification claims over time.

**Independent Test**: Run tests, change a requirement in the specification, reload, and confirm all earlier execution evidence becomes stale and nothing from it counts as verified; run the same scenario twice and confirm counts do not double.

**Acceptance Scenarios**:

1. **Given** evidence from revision A, **When** a changed specification (revision B) is uploaded and scenarios are regenerated, **Then** all of revision A's evidence is shown as "Stale" and none of it is counted as verified.
2. **Given** a scenario executed in two runs, **When** coverage is calculated, **Then** the requirement counts once and its state derives from the defined run-selection rule (latest qualifying run by default, with the selected run indicated).

---

### User Story 6 - Navigate in and out of Coverage, and export (Priority: P3)

The engineer reaches Coverage from the results area and from scenario review and execution results, and exports the current view.

**Why this priority**: Integration and sharing polish on top of working coverage.

**Independent Test**: Navigate from scenario review to Coverage and back with context intact; export filtered and unfiltered views and compare figures with the screen.

**Acceptance Scenarios**:

1. **Given** the user is reviewing generated scenarios, **When** they follow the Coverage link, **Then** Coverage opens for the same specification and run context without restarting the workflow.
2. **Given** a filtered view, **When** the user exports, **Then** the export figures match the visible filtered set (or the full set if "export all" is chosen), include metric definitions and denominators, and contain no secrets or unredacted sensitive data.
3. **Given** a full browser refresh, **When** the view reloads, **Then** filters, sort and selected run reset to defaults and the view shows the current specification and latest run; switching to another view and back retains them.

---

### User Story 7 - Empty, error and theme states (Priority: P3)

Every state (loading, empty, error, stale, incomplete) is explained, and the view is fully usable in both light and dark themes.

**Why this priority**: Required quality bar, but depends on the main view existing.

**Independent Test**: Trigger each state and view the page in both themes, checking legibility, focus indicators and status labels.

**Acceptance Scenarios**:

1. **Given** an empty specification, malformed schemas, missing execution history or incomplete evidence, **When** Coverage loads, **Then** a specific message and a recovery action are shown and nothing is silently replaced by sample data.
2. **Given** either theme, **When** the view is displayed, **Then** cards, charts, table, filters, notices and status labels are legible, and meaning is never conveyed by color alone.

---

### Edge Cases

- Specification with zero operations, or a dimension with zero eligible items: percentage shown as "not available" with 0/0, never NaN or Infinity.
- Path-level and operation-level parameters that share name and location: the operation-level one overrides, counted once.
- Parameters, schemas or branches the system cannot reliably map to scenarios (unresolved or circular references, `oneOf`/`anyOf`/`allOf`, discriminators, callbacks, links, webhooks): shown as "not measurable" with the reason, excluded from denominators, and listed so the gap in measurement is visible.
- Scenarios whose target element cannot be determined: not counted toward element-level coverage; counted at operation level only where the operation is known.
- Executions run against an environment or specification revision other than the selected one: marked stale or excluded with an explanation.
- Executions imported from external collections with no link to generated scenarios: not used as evidence.
- A scenario passed its HTTP call but evaluated no assertions: "Inconclusive".
- A request edited by the user before it was run: its result is shown as evidence but is "Inconclusive", because the request that ran may differ from the generated scenario.
- Very large specifications: the view remains responsive and does not block interaction.
- A newer selection (different specification, run or filter) made while an earlier calculation is in flight: the earlier result must not overwrite the newer one.
- Documented responses using ranges or defaults (for example `2XX`, `default`): handled explicitly, not matched to arbitrary specific codes.
- Security scenarios: no scenario category currently identifies authorization intent, so security/authorization coverage is "unavailable" until reliable classification exists, rather than inferred from ordinary successful requests.

## Requirements *(mandatory)*

### Functional Requirements

**Calculation and definitions**

- **FR-001**: The system MUST compute all counts, percentages and verification states deterministically from specification, scenario and execution data, with no AI involvement; identical inputs MUST yield identical outputs.
- **FR-002**: The system MUST keep specification coverage and runtime-verified coverage as separate dimensions; a generated scenario MUST NOT contribute to runtime-verified coverage.
- **FR-003**: A scenario MUST count toward specification coverage of a contract element only when its relationship to that element can be established from its recorded target; otherwise it counts only toward the operation it belongs to. Scenarios in review state pending or accepted MUST count; rejected scenarios MUST NOT. Each specification-coverage figure MUST show how many of its contributing scenarios are accepted versus pending.
- **FR-004**: Each requirement MUST be in exactly one of these states: Not covered, Generated not executed, Executed failed, Verified, Inconclusive, Stale, with the precedence between states defined and documented.
- **FR-005**: A requirement MUST be Verified only when its scenario was executed, the result is attributable to it, the checks relevant to that dimension were actually evaluated and passed, and the evidence belongs to the selected specification revision and test context. A successful HTTP response alone MUST NOT suffice.
- **FR-006**: Executed failures MUST be reported separately from missing coverage and MUST never be labeled as untested.
- **FR-007**: Every metric MUST retain and display its numerator, denominator and calculation basis; percentage = covered eligible items ÷ eligible items × 100; a zero denominator MUST yield an explicit "not available" state.
- **FR-008**: Denominators MUST be defined per metric and documented; scenario counts, specification elements and execution counts MUST NOT be mixed in one metric.
- **FR-009**: Repeated or duplicate scenarios, and repeated runs, MUST NOT inflate any coverage figure; each requirement is counted once.
- **FR-010**: The system MUST NOT present an overall coverage score unless a documented aggregation method is defined; otherwise only per-dimension figures are shown.

**Coverage dimensions**

- **FR-011**: When the user selected a subset of operations for generation, only the selected operations MUST form the denominator of every coverage metric; unselected operations MUST be listed separately as out of scope and MUST NOT be counted as gaps. Operation coverage MUST be measured per unique operation (normalized path plus HTTP method) within a specification revision, reporting total eligible, with generated scenarios, runtime-verified, with execution failures, and with no generated coverage.
- **FR-012**: Parameter coverage MUST include path, query, header and cookie parameters, resolving path-level and operation-level declarations so that overridden parameters count once, and MUST report parameters exercised, verified, and lacking negative, boundary or required/optional cases where applicable.
- **FR-013**: Request-schema coverage MUST track, where reliably analyzable, properties, required/optional status, numeric and string constraints, formats, enum values, nullability, array items, nested objects and composition branches, using stable element identifiers; a property merely present in a body MUST NOT be treated as proof of boundary or branch coverage.
- **FR-014**: Response-schema coverage MUST distinguish documented from observed-and-verified, and MUST NOT mark a schema verified merely because a body was received.
- **FR-015**: Response-code coverage MUST, for each documented success and error code, show documented, scenario generated, executed, expected outcome verified, and actual outcome matched or failed, and MUST distinguish an absent test from an unexecuted test from an unobserved runtime response.
- **FR-016**: Scenario-category coverage MUST support positive, negative, boundary and security/authorization categories, derived from existing scenario classification; where a category cannot be reliably classified it MUST be shown as unknown or unavailable.
- **FR-017**: Schema-branch coverage MUST identify testable branches for supported constructs and MUST list unsupported constructs and the reason they are not measurable, never silently ignoring them.

**Dashboard**

- **FR-018**: A Coverage view titled "API Test Coverage" MUST be reachable from the application's results area, reusing the existing shell, navigation, theme handling and shared components, and MUST NOT add a new top-level navigation category.
- **FR-019**: The header MUST show the specification name and revision, environment context where available, last qualifying execution time, a recalculation action, an export action, and a link to the execution workflow, making clear which revision and run the page represents.
- **FR-020**: The view MUST show a notice stating "Generated scenarios contribute to specification coverage. Runtime-verified coverage requires qualifying execution evidence.", plus a specific explanation whenever data is stale, incomplete or unavailable.
- **FR-021**: The view MUST show separate metric groups for specification coverage (operations, parameters, request schemas, response schemas) and runtime-verified coverage (operations verified, response codes verified, contract assertions evaluated and passed, last qualifying execution), each with numerator, denominator and percentage where applicable.
- **FR-022**: The view MUST show compact breakdowns of operation, parameter and schema coverage that separate specification coverage, runtime-verified coverage and remaining gaps, with textual counts and accessible labels.
- **FR-023**: The view MUST show a sortable, filterable gaps table with method, endpoint, specification coverage, runtime verification, missing coverage, priority and actions, filterable by method, endpoint, coverage state, scenario category, priority and missing-versus-failed.
- **FR-024**: Filtering MUST update the table and the summary values it affects consistently, and filter, sort and selected-run state MUST be retained while the user switches between application views within a session, and MUST reset on a full browser refresh.
- **FR-025**: The view MUST show a ranked list of recommended next tests, each with operation, uncovered requirement, reason, supporting evidence, priority with rationale, and an action; recommendations MUST be deterministic and traceable to actual gaps.
- **FR-026**: Rows and recommendations MUST link to the operation detail or related scenario/result, preserving specification and run context.
- **FR-027**: Contextual links to Coverage MUST be offered from scenario generation/review and from execution results.

**Prioritization**

- **FR-028**: Priority MUST be assigned by documented, deterministic rules considering missing runtime verification, missing specification coverage, destructive operations, security-sensitive or authenticated operations, and contract complexity (and failure history when available), with the rationale shown per item.
- **FR-029**: Priority MUST be labeled as a heuristic, not an objective security assessment; where inputs are unavailable a simpler classification MUST be used and labeled.
- **FR-030**: One underlying gap MUST appear once and MUST NOT be duplicated as several independent high-priority items without a stated reason.

**Workflow states and data integrity**

- **FR-031**: Coverage records MUST be tied to a specification revision; on revision change, specification coverage MUST be recalculated and incompatible execution evidence MUST be marked Stale, never silently carried forward to changed requirements. When a changed specification is uploaded and scenarios are regenerated, all execution evidence from the earlier specification MUST be treated as stale as a whole; per-operation carry-over of verification is not supported.
- **FR-032**: The system MUST define and display which run determines verification state (latest qualifying run by default, or an explicitly selected run) and MUST keep earlier runs available where the existing system retains them.
- **FR-033**: Empty specifications, missing history, malformed or unresolvable schemas and incomplete evidence MUST produce specific empty, warning or error states with recovery actions, and MUST NOT be replaced by sample data.
- **FR-034**: Element identifiers MUST be stable across re-renders, recalculations and runs, and MUST account for the specification revision rather than relying on list position or display labels.
- **FR-035**: A later selection MUST NOT be overwritten by an earlier, slower calculation or fetch.
- **FR-036**: Coverage records, exports and logs MUST NOT contain credentials, tokens, cookies, passwords or unredacted sensitive request/response data.

**Export**

- **FR-037**: The view MUST support exporting the current coverage view using an existing export capability where one fits, including specification name and revision, generation and execution context, metric definitions and denominators, both coverage dimensions, gaps with priorities and execution evidence references; exported figures MUST match the chosen scope (filtered or full).

**Presentation and quality**

- **FR-038**: The view MUST work in light and dark themes using the existing theme system, be responsive, keyboard accessible with visible focus, and convey state with text or icons in addition to color.
- **FR-039**: Loading, success, empty and error conditions MUST be distinguishable, and an API failure MUST NOT be shown as empty coverage.
- **FR-040**: Existing workflows (generation, review, export, execution, performance, failure analysis) MUST continue to behave as before.
- **FR-041**: Metric definitions, denominators, state precedence, prioritization rules and every unsupported or unmeasurable dimension with its reason MUST be documented.

### Key Entities

- **Coverage Requirement**: A single measurable contract element (operation, parameter, request-schema element, response code, response-schema element, schema branch, scenario category) with a stable identifier tied to a specification revision and a calculation basis.
- **Coverage Mapping**: The established relationship between a generated scenario and the requirement(s) it exercises, including the evidence for that relationship; absent when the relationship cannot be established.
- **Coverage State**: The single classification of a requirement (Not covered, Generated not executed, Executed failed, Verified, Inconclusive, Stale) with the reason and evidence references.
- **Coverage Metric**: A named figure with numerator, denominator, percentage or "not available", dimension (specification or runtime) and denominator definition.
- **Coverage Gap**: A requirement that is not covered, not verified, failed, inconclusive or stale, with its operation, reason, evidence and priority.
- **Priority Assessment**: The heuristic priority of a gap with the contributing factors and rationale.
- **Recommendation**: A ranked, traceable suggestion derived from a gap, with an action.
- **Coverage Snapshot**: The calculated result for one specification revision, scenario set and selected run, with its calculation time and any staleness or incompleteness notices.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a specification with known scenarios and results, 100% of displayed counts, percentages and states match independently computed expected values in the acceptance test fixtures.
- **SC-002**: A user can identify the five highest-priority gaps for a specification of 100 operations within 30 seconds of opening Coverage.
- **SC-003**: Zero cases across the test suite in which a generated-only, failed, inconclusive or stale requirement is counted as verified.
- **SC-004**: Zero occurrences of NaN, Infinity or blank in any metric, including zero-denominator cases.
- **SC-005**: Identical inputs produce byte-identical metrics and recommendation ordering across repeated calculations.
- **SC-006**: For a specification of 500 operations, the view becomes usable within 3 seconds of data availability, and filter or sort changes reflect within 1 second.
- **SC-007**: After a specification change, 100% of evidence from the earlier specification is shown as stale and 0% is counted as verified.
- **SC-008**: Every recommendation shows operation, requirement, reason, evidence, priority rationale and an action; none lacks a traceable source gap.
- **SC-009**: An exported view matches the on-screen figures for the same scope in 100% of tested cases, with no secrets present.
- **SC-010**: The view meets the application's accessibility and theming standards in both themes: all status labels are readable and meaning is never color-only.
- **SC-011**: All existing automated tests continue to pass.

## Assumptions

- **Navigation**: The repository's navigation has no existing "Results" group with Overview, Test Results, Performance and Failure Analysis entries as described. Coverage will be placed in the application's existing post-run results area following current navigation and routing conventions; planning must confirm the exact location after inspecting the current shell. No new top-level category is introduced.
- **Evidence sources**: Runtime evidence comes only from executions linked to generated scenarios by scenario identifier. Imported external collection runs have no such link and are not used as evidence.
- **Scenario classification**: Existing scenario categories (positive, missing-field, invalid-type, boundary types and so on) map to the positive, negative and boundary groups. No existing category identifies authorization intent, so security/authorization coverage is reported as unavailable until a reliable classification is introduced by a separate, explicit decision.
- **Specification revision**: A revision is identified by a deterministic fingerprint of the normalized specification content, since the specification's own version string cannot detect edits.
- **Run selection**: The latest qualifying run per scenario determines verification state by default; the user may select a specific run.
- **Persistence**: Coverage is derived on demand from existing data and is not stored independently; no new persistence mechanism is assumed.
- **Authorization categories as denominators**: Security-sensitivity of an operation is inferred only from what the specification declares (security requirements) and is labeled as such.
- **Out of scope**: AI-calculated metrics, AI-fabricated evidence, an aggregate "overall score" without a documented method, and cloud or external services.
- **Dependencies**: Existing OpenAPI analysis (AP-002), deterministic test model (AP-003), scenario review (AP-006), test execution and results (AP-017), the design system and shell (AP-027), and the project's export capabilities.
