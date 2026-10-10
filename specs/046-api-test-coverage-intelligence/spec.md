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

**Normative definitions.** Every counting rule, state, denominator and control behavior below is defined precisely in [coverage-rules.md](./coverage-rules.md). Open decisions are in [decision-log.md](./decision-log.md); verification cases are in [acceptance-checklist.md](./acceptance-checklist.md).

## Clarifications

### Session 2026-10-10 (refinement)

- Q: Is "coverage" one thing? → A: No. Two levels are defined separately: **operation coverage** (unit: unique `METHOD /path` within a revision; five metrics OC1 to OC5) and **requirement-level coverage** (unit: a stable, traceable requirement with its own state). An operation with one generated scenario is counted as having generated scenarios and is never reported as fully covered.
- Q: How are positive, negative, boundary and security coverage defined? → A: Each requirement belongs to exactly one group; each category's spec and runtime-verified figures are computed over the eligible requirements of that group. Response keys other than exact `2xx`/`4xx` are shown as "unclassified" and excluded from category denominators. Security stays unavailable (never zero) until scenarios carry explicit authorization intent.
- Q: What is the status of an operation with mixed outcomes? → A: It has no single status. It shows a requirement-state profile, scenario verdict counts and membership in both "runtime-verified" and "with execution failures" where both apply. Each requirement is judged only by the checks relevant to it, so a failing scenario never invalidates unrelated requirements and a passing scenario never hides a failing one.
- Q: How are assertion failure, transport error, infrastructure failure and not-evaluated assertions told apart? → A: By a typed `cause` shown beside the state. Only a relevant evaluated check that failed yields "Executed, failed".
- Q: Which executions feed runtime figures? → A: Either the latest qualifying result per scenario (default, may span runs and is disclosed as such) or one selected run. All views and exports read the same snapshot.
- Q: Can evidence survive a specification change? → A: In this release, only through the join to the current generation's scenarios (unchanged from the earlier clarification). The materiality rule (per-requirement contract hash) is specified but not enabled; enabling it needs decision D-1.
- Q: What do category figures count? → A: Classified testable requirements, never scenarios.
- Q: How is Stale different from Generated, not executed? → A: Stale means evidence exists but no longer matches the current contract; it carries a reason and a re-execution flag and is never shown as unexecuted. It remains reserved until decision D-1.
- Q: When latest-per-scenario finds results from different environments, what happens? → A: Only runs from the same environment as the newest qualifying run are combined; excluded runs are listed with the reason (D-2 resolved).
- Q: What proves the happy path and exercised parameters? → A: Only positive-group (valid-request) scenarios; negative and boundary scenarios never credit them (D-3 resolved).
- Q: Where do `default`, `5xx`, `3xx` and range keys such as `2XX` belong? → A: Unclassified: counted in response-code coverage as their own keys, excluded from every category denominator, shown as an "Unclassified: n" line (D-6 resolved).
- Q: When several scenarios map to one requirement and disagree, what is its state? → A: A failure outranks a pass, and the requirement shows an evidence tally so passes stay visible (D-7 resolved).
- Q: Does a review edit after a run invalidate that run's evidence? → A: No. Evidence stays valid with a visible "scenario edited after run" note, accepted knowing a verification may describe a request that has since changed (D-9 confirmed).
- Q: Do the summary cards follow filters? → A: Yes, as FR-024 already states; each shows a scope label so a filtered figure is never mistaken for the full figure.

### Session 2026-10-10

- Q: Where should Coverage appear, given the described "Results" navigation group? → A: Resolved as an assumption (see Assumptions): Coverage is added to the application's existing post-run results area following its current navigation conventions; no new top-level category is introduced.
- Q: Should a generated scenario still awaiting human review count toward specification coverage? → A: Yes. Pending and accepted scenarios count; rejected scenarios never count; the accepted/pending split is shown beside each specification-coverage figure.
- Q: When a request edited before a run is executed, how should its scenario count for runtime verification? → A: Inconclusive. The run is shown as evidence, but nothing it exercised counts as verified.
- Q: After a changed specification is uploaded, how is earlier execution evidence treated? → A: As a whole, never per operation. Runs record no specification revision, so results that no longer match a scenario of the current specification are never counted as verified and are reported as "unattributed, possibly from an earlier specification", with a count. The Stale state is kept in the contract and interface for attributable evidence flagged for revalidation, but this feature does not produce it for regenerated specifications.
- Q: Does editing a scenario in the review step after a run invalidate its earlier run evidence? → A: No. The evidence stays attributable by scenario ID and a visible "scenario edited after run" note is shown. This is separate from requests edited in Import & Run, which are Inconclusive.
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

When the specification changes, coverage is recalculated for the new revision and evidence from the old revision is never silently carried over: results that no longer match a current scenario are reported as unattributed and are not counted as verified. When a scenario is run several times, it is not double-counted.

**Why this priority**: Prevents misleading verification claims over time.

**Independent Test**: Run tests, change a requirement in the specification, reload, and confirm earlier results are reported as unattributed and nothing from them counts as verified; run the same scenario twice and confirm counts do not double.

**Acceptance Scenarios**:

1. **Given** evidence from revision A, **When** a changed specification (revision B) is uploaded and scenarios are regenerated, **Then** all of revision A's results are reported as unattributed (possibly from an earlier specification), with their count, and none of them is counted as verified.
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

### User Story 8 - Read mixed outcomes and category coverage without being misled (Priority: P1)

The engineer sees, for an operation that has a passing happy path, a failing invalid-input scenario and an unexecuted boundary scenario, exactly which requirements are verified, which failed and which remain unexecuted, and sees positive, negative, boundary and security coverage as separate, honest figures.

**Why this priority**: Without it a single green or red status would hide the real picture, defeating the purpose of separating specification coverage from verification.

**Independent Test**: Use a fixture with that operation; confirm per-requirement states, scenario verdict counts, OC3 and OC4 membership, category figures and the "Unavailable" security entry.

**Acceptance Scenarios**:

1. **Given** the mixed operation, **When** Coverage is calculated, **Then** it is in both runtime-verified and with-failures counts, its exercised parameters and documented success code are `verified`, the requirement targeted by the failing scenario is `executed-failed` with cause assertion failed, the boundary requirement is `generated-not-executed`, and no single status is shown.
2. **Given** a happy-path scenario whose status check passed and whose schema check failed, **When** Coverage is calculated, **Then** its parameters and success code are `verified` and only its response-schema requirement is `executed-failed`.
3. **Given** a scenario that timed out, **When** Coverage is calculated, **Then** its requirements are `inconclusive` with cause transport error and none is `executed-failed`.
4. **Given** an operation with one generated scenario, **When** Coverage is calculated, **Then** it counts once in "with generated scenarios" and its requirement coverage shows the remaining uncovered requirements.
5. **Given** no scenario carries authorization intent, **When** the category section renders, **Then** security shows "Unavailable" with its reason, and positive, negative and boundary show spec and runtime figures whose denominators are their own eligible requirements.
6. **Given** two runs with different outcomes for a scenario, **When** the user switches between latest-per-scenario and one run, **Then** every figure changes together and the header names the contributing runs.

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
- Executions run against an environment or specification revision other than the selected one: reported as unattributed or excluded, with an explanation.
- A scenario edited in the review step after it was run: its evidence stays attributable and a "scenario edited after run" note is shown; it is not invalidated.
- Executions imported from external collections with no link to generated scenarios: not used as evidence.
- A scenario passed its HTTP call but evaluated no assertions: "Inconclusive".
- A request edited by the user before it was run: its result is shown as evidence but is "Inconclusive", because the request that ran may differ from the generated scenario.
- Very large specifications: the view remains responsive and does not block interaction.
- A newer selection (different specification, run or filter) made while an earlier calculation is in flight: the earlier result must not overwrite the newer one.
- Documented responses using ranges or defaults (for example `2XX`, `default`): handled explicitly, not matched to arbitrary specific codes.
- An operation with passing, failing, inconclusive and unexecuted scenarios at once: no single status; counted in both runtime-verified and with-failures.
- A request that received no response (timeout, connectivity failure): inconclusive, never an assertion failure; an infrastructure request failure (for example an OAuth2 token fetch) is a run notice and its dependants are generated-not-executed with cause blocked by dependency.
- A scenario that passed on its status check but failed its schema check: only the response-schema requirement fails.
- A scenario failed in an older run and passed in a newer one: latest-per-scenario reports it passed; the older failure remains visible only through run selection.
- Results from more than one environment: latest-per-scenario uses only the newest qualifying run's environment; the other runs are listed as excluded with the reason. A single selected run is always evaluated as is.
- A requirement mapped by several scenarios with different results: failure outranks pass, and the evidence tally shows all of them.
- Documented keys `default`, `2XX`/`4XX`, `5xx`, `3xx`: unclassified for category purposes, still counted in the response-code metric as their own keys.
- Security scenarios: no scenario category currently identifies authorization intent, so security/authorization coverage is "unavailable" until reliable classification exists, rather than inferred from ordinary successful requests.

## Requirements *(mandatory)*

### Functional Requirements

**Calculation and definitions**

- **FR-001**: The system MUST compute all counts, percentages and verification states deterministically from specification, scenario and execution data, with no AI involvement; identical inputs MUST yield identical outputs.
- **FR-002**: The system MUST keep specification coverage and runtime-verified coverage as separate dimensions; a generated scenario MUST NOT contribute to runtime-verified coverage.
- **FR-003**: A scenario MUST count toward specification coverage of a contract element only when its relationship to that element can be established from its recorded target; otherwise it counts only toward the operation it belongs to. Scenarios in review state pending or accepted MUST count; rejected scenarios MUST NOT. Each specification-coverage figure MUST show how many of its contributing scenarios are accepted versus pending.
- **FR-004**: Each requirement MUST be in exactly one of these states: Not covered, Generated not executed, Executed failed, Verified, Inconclusive, Stale, with the precedence between states defined and documented (coverage-rules.md §6). Each non-verified executed or unexecuted state MUST also show a typed cause (for example assertion failed, transport error, check not evaluated, request edited, blocked by dependency, never run).
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
- **FR-016**: Scenario-category coverage MUST support positive, negative, boundary and security/authorization categories, derived from existing scenario classification; where a category cannot be reliably classified it MUST be shown as unknown or unavailable. Details in FR-043.
- **FR-017**: Schema-branch coverage MUST identify testable branches for supported constructs and MUST list unsupported constructs and the reason they are not measurable, never silently ignoring them.

**Dashboard**

- **FR-018**: A Coverage view titled "API Test Coverage" MUST be reachable from the application's results area, reusing the existing shell, navigation, theme handling and shared components, and MUST NOT add a new top-level navigation category.
- **FR-019**: The header MUST show the specification name and revision, environment context where available, last qualifying execution time, a recalculation action, an export action, and a link to the execution workflow, making clear which revision and run the page represents.
- **FR-020**: The view MUST show a notice stating "Generated scenarios contribute to specification coverage. Runtime-verified coverage requires qualifying execution evidence.", plus a specific explanation whenever data is stale, incomplete or unavailable.
- **FR-021**: The view MUST show separate metric groups for specification coverage (operations, parameters, request schemas, response schemas) and runtime-verified coverage (operations verified, response codes verified, contract assertions evaluated and passed, last qualifying execution), each with numerator, denominator and percentage where applicable.
- **FR-022**: The view MUST show compact breakdowns of operation, parameter and schema coverage that separate specification coverage, runtime-verified coverage and remaining gaps, with textual counts and accessible labels.
- **FR-023**: The view MUST show a sortable, filterable gaps table with method, endpoint, specification coverage, runtime verification, missing coverage, priority and actions, filterable by method, endpoint, coverage state, scenario category, priority and gap type (missing, failed, insufficient evidence, needs re-execution). Each operation row MUST be expandable to its requirements, scenarios and evidence.
- **FR-024**: Filtering MUST update the table and the summary values it affects consistently (cards, breakdowns, category section, recommendations and exports all use the filtered scope and show a scope label naming it), and filter, sort and selected-run state MUST be retained while the user switches between application views within a session, and MUST reset on a full browser refresh.
- **FR-025**: The view MUST show a ranked list of recommended next tests, each with operation, uncovered requirement, reason, supporting evidence, priority with rationale, and an action; recommendations MUST be deterministic and traceable to actual gaps.
- **FR-026**: Rows and recommendations MUST link to the operation detail or related scenario/result, preserving specification and run context.
- **FR-027**: Contextual links to Coverage MUST be offered from scenario generation/review and from execution results.

**Prioritization**

- **FR-028**: Priority MUST be assigned by documented, deterministic rules considering missing runtime verification, missing specification coverage, destructive operations, security-sensitive or authenticated operations, and contract complexity (and failure history when available), with the rationale shown per item.
- **FR-029**: Priority MUST be labeled as a heuristic, not an objective security assessment; where inputs are unavailable a simpler classification MUST be used and labeled.
- **FR-030**: One underlying gap MUST appear once and MUST NOT be duplicated as several independent high-priority items without a stated reason.

**Workflow states and data integrity**

- **FR-031**: Coverage records MUST be tied to a specification revision; on revision change, specification coverage MUST be recalculated and execution results that cannot be joined to a scenario of the current specification MUST NOT be counted as verified and MUST be reported as unattributed (possibly from an earlier specification), with a count and an explanation, never silently carried forward to changed requirements. The treatment is for the specification as a whole; per-operation carry-over of verification is not supported. The Stale state is retained for attributable evidence flagged for revalidation; no current rule produces it for regenerated specifications.
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

**Refinement requirements (2026-10-10; rules in [coverage-rules.md](./coverage-rules.md))**

- **FR-042 (two levels)**: The system MUST report operation-level coverage as five separate counts over eligible operations: total eligible, with generated scenarios, with passing verification (≥1 passed scenario; deliberately not called "verified"), with execution failures (≥1 failed scenario), with no generated scenarios. Invariants: with-scenarios plus no-scenarios equals total; runtime-verified and with-failures are not mutually exclusive and are shown together. The system MUST also report requirement-level coverage, where each requirement has a stable id, specification source, kind, group, applicable operation, specification state, runtime state with cause, mapped scenarios, evidence, and, when excluded, a measurability reason. An operation with a generated scenario MUST NOT be presented as fully covered.
- **FR-043 (categories)**: The view MUST show positive, negative, boundary and security/authorization coverage. Each requirement belongs to exactly one group (or "unclassified" for response keys other than exact `2xx`/`4xx`). For each available category the view MUST show specification coverage and runtime-verified coverage as numerator/denominator/percentage over that group's eligible requirements, plus its failed, inconclusive, generated-not-executed and not-covered counts. A category with no eligible requirements MUST read "not available (0 eligible)". Security MUST read "Unavailable" with its reason, never 0%, and MUST NOT be inferred from declared authentication or successful requests. Unclassified requirements and scenarios MUST be listed with counts and excluded from category denominators.
- **FR-044 (check scope)**: A requirement MUST be judged only by the checks relevant to it (status-code check for exercised, case and response-code requirements; schema-conformance check for response-schema requirements). The `operation` (happy path) and exercised-parameter/property requirements MUST be credited only by positive-group scenarios. A failing scenario MUST NOT change the state of a requirement it does not exercise or whose relevant check passed; a passing scenario MUST NOT hide the failure of another requirement.
- **FR-045 (mixed outcomes)**: An operation MUST NOT be assigned a single verification status. Its row MUST show the requirement-state profile, scenario verdict counts (passed, failed, inconclusive, not executed), membership in OC3 (with passing verification) and OC4 (with execution failures), and the number of requirements still unexecuted or uncovered. When several scenarios map to one requirement, the state follows the documented precedence and the requirement MUST show an evidence tally.
- **FR-046 (failure causes)**: An assertion failure, a transport error (no response), an unevaluated check, an edited request, a dependency-blocked or cancelled run and an infrastructure-request failure MUST be distinguishable by a typed cause. Only an evaluated, failed relevant check yields "Executed, failed".
- **FR-047 (run selection)**: The view MUST support "latest qualifying result per scenario" (default) and "single run". Latest-per-scenario MUST combine only runs whose environment (name and tier) equals that of the newest qualifying run; runs from other environments MUST be excluded and listed with that reason. The mode, contributing run ids and environment MUST be shown in the header and in every export. Cards, breakdowns, gaps, recommendations, operation detail, filters and exports MUST be derived from the same snapshot for the chosen mode. Results from different runs MUST NOT be combined by any rule other than the documented per-scenario latest.
- **FR-048 (evidence validity)**: Evidence MUST remain valid only as defined in coverage-rules.md §9.1 for this release. The contract-hash materiality rule in §9.2 is specified but MUST NOT be enabled until decision D-1 is made; the Stale state MUST NOT be produced before then. When it is produced, a stale requirement MUST carry a reason naming the changed contract fragment, the time or revision it became stale, and a re-execution-required flag, and MUST never be displayed or counted as generated-not-executed or verified.
- **FR-049 (controls)**: Every control on the view MUST be bound to snapshot data and behave as defined in coverage-rules.md §13: run selector, Recalculate, each filter, reset, sort, row expansion, operation/scenario/result links, generate/review actions, exports, and theme. A link MUST be absent when its target does not exist. No control may be decorative in the product.
- **FR-050 (UI states)**: The view MUST distinguish loading, no active workflow, empty, error and out-of-date snapshot (a previous snapshot retained after a failed recalculation, labelled with its time). "Out-of-date snapshot" MUST NOT be labelled "stale", which is reserved for the requirement state.
- **FR-051 (assertion figures)**: The assertion card MUST show passed, failed and not-evaluated counts, with not-evaluated outside the denominator, computed from the selected evidence excluding edited and no-response results.

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
- **SC-007**: After a specification change, 0% of results that no longer match a current scenario are counted as verified, and 100% of them are reported as unattributed with a count.
- **SC-008**: Every recommendation shows operation, requirement, reason, evidence, priority rationale and an action; none lacks a traceable source gap.
- **SC-009**: An exported view matches the on-screen figures for the same scope in 100% of tested cases, with no secrets present.
- **SC-010**: The view meets the application's accessibility and theming standards in both themes: all status labels are readable and meaning is never color-only.
- **SC-011**: All existing automated tests continue to pass.
- **SC-012**: For every snapshot, with-scenarios plus no-scenarios equals eligible operations, runtime-verified and with-failures never exceed with-scenarios, every numerator is at most its denominator, and a category's covered, executed-failed, inconclusive, generated-not-executed and not-covered counts sum to its denominator.
- **SC-013**: In fixtures with mixed outcomes, 0 cases in which a failing scenario changes the state of a requirement whose relevant check passed, or a passing scenario changes the state of a failing requirement.
- **SC-014**: Zero cases in which a transport error, unevaluated check, edited request or dependency block is labelled "Executed, failed", or in which a request that is only generated or only partly evaluated is labelled "Verified".
- **SC-015**: The same snapshot yields identical figures on the dashboard, in operation detail and in both export formats for the same run selection and filter scope.

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
